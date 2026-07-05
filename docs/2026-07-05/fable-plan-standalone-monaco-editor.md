# Fable Plan: Extract the Monaco Prompt Editor into a Standalone App

Date: 2026-07-05
Repo: /Users/madda/dev/_active/Ghostex

## Overall goal

Today the Monaco editor (the Ctrl+G "floating prompt editor") is embedded inside
both the macOS Ghostex app (WKWebView child window rendering the shared
`native/sidebar/modal-host.tsx` React bundle, plus a legacy standalone-HTML
fallback overlay) and the gpui app (CEF window rendering the same modal-host
bundle). It is opened by `ghostex floating-monaco-editor <file>` (alias `fme`),
which connects to a loopback TCP bridge (127.0.0.1:58743) of whichever app is
running, sends `{type:"openFloatingEditor", editorKind:"monaco", ...}`, and
blocks polling a status file until the app writes `saved` or `cancelled`.

We are extracting this into a **standalone macOS app** (`GhostexEditor.app`,
display name "Ghostex Editor") that:

- is its own process/bundle, completely independent of Ghostex.app and the gpui
  app — any terminal tool can launch it like `vi` (blocking binary, exit code
  semantics), e.g. `EDITOR="/Applications/GhostexEditor.app/Contents/MacOS/GhostexEditor"`;
- hosts Monaco in a plain WKWebView (NO CEF, NO React — a small self-contained
  web page);
- keeps the exact status-file handshake the CLI already uses, so all zmx
  prompt-editor capability routing above the final hop is untouched.

Then `ghostex floating-monaco-editor` launches this app directly (no app
bridge), and both Ghostex apps DELETE their embedded Monaco editor hosting.

Key architectural invariants (do not violate):

- Monaco routing stays a per-attach-client zmx capability (see
  `docs/prompt-editor-cross-client-routing-plan.md`). We only change the final
  hop: what the CLI does once "monaco" is selected.
- The CLI and the editor app always run on the same machine when monaco is
  selected (guaranteed by the capability routing; the old bridge was
  loopback-only too).
- The terminal-kind floating editor (`editorKind:"terminal"`, a Ghostty
  overlay) is NOT part of this work. Only the monaco kind moves. Do not break
  the terminal kind.

## Repo rules every worker MUST follow

- Do NOT write any tests anywhere for this task (macOS app and gpui trees are
  explicitly test-free by repo policy; keep the new `editor/` tree test-free
  too for now).
- Never add fallback code where fixing the actual behavior is possible.
  (Exception that stays: the CLI's existing degrade-to-`vi` when no editor is
  available on the machine — that is an environment condition, keep it.)
- NEVER run `bun run start` or any command that starts/restarts the Ghostex or
  gpui apps.
- The working tree has UNCOMMITTED user changes (e.g. `gpui/src/main.rs`,
  `gpui/src/cef/shell.rs`, `gpui/sidebar/*`, `gpui/src/bin/ghostex_gpui_cef_helper.rs`,
  `gpui/src/terminal_element.rs`). Edit on top of them; NEVER revert, stash,
  checkout, or reset anything you did not write. Do not run destructive git
  commands. Do NOT commit — leave all changes in the working tree.
- Search discipline: exclude `ghostty/**`, `tui/vendor/**`, `iOS/Vendor/**`,
  `node_modules/**`, `dist/**`, `build/**`, `out/**`, `storybook-static/**`,
  `target/**`, `.git/**` from searches unless specifically needed.
- Native layout discipline: no hitTest overrides, no invisible overlays, no
  overlapping interactive regions. The editor app is a normal window with a
  normal WKWebView filling it.
- `scripts/ghostex-cli.mjs` is the CANONICAL CLI source.
  `native/macos/ghostexHost/CLI/ghostex-cli.mjs` is a build-time copy (see
  `build-ghostex-host.sh:1920`). Edit `scripts/ghostex-cli.mjs`; after editing,
  also copy it over the `native/macos/ghostexHost/CLI/ghostex-cli.mjs` copy so
  the tree stays consistent.

## Shared contracts (fixed — implement exactly this)

### Editor app CLI contract (implemented in Phase 2, consumed in Phases 3/5)

```
GhostexEditor <file> [--language <monacoLanguageId>] [--title <windowTitle>] [--status-file <path>]
```

- Binary path inside the bundle: `GhostexEditor.app/Contents/MacOS/GhostexEditor`.
- Each invocation is its own process with its own window (direct exec, never
  LaunchServices/`open`), so concurrent editors just work.
- Reads `<file>` at startup (missing file = start empty; create on save).
- Language: `--language` wins; otherwise the web layer creates the Monaco model
  with a file URI derived from `<file>` so Monaco auto-detects; final fallback
  `markdown`.
- Status file protocol (only if `--status-file` given): write the single word
  `started` once the editor is ready (web posted `ready`), then exactly one of
  `saved` / `cancelled` before exit. Overwrite the file content each time
  (that is what the current apps do — CLI polls file content).
- Exit codes: 0 = saved, 1 = cancelled, 2 = startup/usage error.
- Save & close: Cmd+Enter, or the window Save button → write draft to `<file>`,
  status `saved`, exit 0.
- Save without closing: Cmd+S → write draft to `<file>`, stay open.
- Cancel: Esc or Cancel button → status `cancelled`, exit 1, file untouched
  (except prior Cmd+S saves).
- Window close button, SIGTERM, SIGINT, SIGHUP, app termination: FORCE-SAVE the
  latest draft to `<file>`, status `saved`, exit 0. (This mirrors the current
  apps' save-on-lifecycle-close behavior — the draft must never be lost when
  the originating session dies.)
- The app must foreground itself when launched from a terminal:
  `NSApp.setActivationPolicy(.regular)` + activate, normal Dock presence while
  running.
- Window frame persistence via `frameAutosaveName` ("GhostexEditorWindow").

### JS <-> native contract inside the editor app (Phase 1 web side, Phase 2 native side)

- Native injects a `WKUserScript` at documentStart:
  `window.__GHOSTEX_EDITOR_BOOTSTRAP__ = {"initialText": <string>, "language": <string|null>, "filePath": <string>, "title": <string>}`
  (JSON-serialize safely; never string-concatenate raw text into JS).
- Web → native via `window.webkit.messageHandlers.ghostexEditorHost.postMessage({type, ...})`:
  - `{type:"ready"}` — posted only after the Monaco editor instance is created
    and populated with initialText.
  - `{type:"draftUpdate", text}` — debounced (~300ms) on every content change;
    native keeps the latest draft in memory for force-save.
  - `{type:"saveAndClose", text}`
  - `{type:"save", text}` (Cmd+S; native writes file, stays open)
  - `{type:"cancel"}`
  - `{type:"pasteImage", requestId, base64Data, suggestedName}` — when the user
    pastes image data; native writes it to a `ghostex-editor-images` dir under
    the draft file's directory (or tmp), replies with result below; web inserts
    the returned path at the cursor.
- Native → web via
  `window.dispatchEvent(new CustomEvent("ghostex-editor-host-message", {detail: {...}}))`:
  - `{type:"imagePasteResult", requestId, path?, error?}`
- Keybindings implemented in the web layer: Cmd+Enter = saveAndClose,
  Esc = cancel, Cmd+S = save. A minimal header row with Save and Cancel
  buttons; dark, matches Monaco `vs-dark`.

### Editor app resolution order (Phase 3 in JS, Phase 5 in Rust — keep identical)

1. `GHOSTEX_EDITOR_APP` env var — may point at the `.app` bundle or directly at
   the executable. If a `.app` dir, use `<it>/Contents/MacOS/GhostexEditor`.
2. `~/Applications/GhostexEditor.app/Contents/MacOS/GhostexEditor`
3. `/Applications/GhostexEditor.app/Contents/MacOS/GhostexEditor`
4. (CLI only, dev convenience) `<repo>/editor/dist/GhostexEditor.app/Contents/MacOS/GhostexEditor`,
   where `<repo>` is resolved from the CLI script location the same way other
   repo-relative dev paths are handled in `ghostex-cli.mjs` (the canonical
   script lives at `<repo>/scripts/ghostex-cli.mjs`).
A candidate counts only if the resolved executable exists and is executable.

## Current-state map (verified 2026-07-05; line numbers approximate)

macOS app:
- Dispatch: `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift`
  `handle(_:)` case `.openFloatingEditor` ~3912; `ghostexRootView.openFloatingEditor`
  ~7542 routes `editorKind == "monaco"` → `openFloatingPromptEditor` ~7727.
- Modal host window: `openNativeAppModalWindow` ~11590, `AppModalWindowController`
  ~16270, loads `Web/modal-host.html` ~17337. Prewarm:
  `prewarmFloatingPromptEditorIfNeeded` ~7894-8065.
- Message handling: `handleAppModalHostMessage` ~13246 (`floatingPromptEditorSave`,
  `floatingPromptEditorCancel`, `floatingPromptEditorDraftUpdate`, image paste/preview);
  status file writer `writeFloatingPromptEditorStatusFile` ~8828; lifecycle
  force-save `saveActiveFloatingPromptEditorForAppLifecycleClose` ~8233;
  state struct `ActiveFloatingPromptEditor` ~6733, var ~6881.
- Legacy fallback overlay: `TerminalWorkspaceView.swift` `openFloatingEditor`
  ~3445, `openFloatingMonacoEditor` ~3561-3719, `saveFloatingMonacoEditor` ~3721,
  loads `native/sidebar/floating-monaco-editor.html`.
- Bridge: `NativeHostBridge.swift` (port 58743, special-case decode of
  openFloatingEditor ~152-173); command struct `HostProtocol.swift:528-539`
  (`OpenFloatingEditor`, `editorKind`).
- TS protocol mirror: `shared/native-ghostty-host-protocol.ts:161-173`
  (`editorKind?: "terminal" | "monaco"`).
- Web: `native/sidebar/modal-host.tsx` — `FloatingPromptEditorModal` ~866+,
  monaco loader `loadModalHostMonaco()` ~649-692, message types ~262-374,
  `floatingPromptEditor` modal kind ~92, monaco create ~1135.
- Build: `native/macos/ghostexHost/build-ghostex-host.sh` — copies
  `floating-monaco-editor.html` (~1905), rsyncs `node_modules/monaco-editor/min/vs`
  → `Web/monaco/vs` (~2112), builds TSX bundles (~2154), inlines modal-host
  (~2169-2251). CSS: `sidebar/styles/modals.css` `.floating-prompt-editor-monaco`
  (~353, ~539).

gpui app:
- Modal kind: `GpuiAppModalKind::FloatingPromptEditor` `gpui/src/main.rs` ~1941
  (enum ~1916, id string ~2004, title ~2035, size ~2078).
- State: `GpuiActiveFloatingPromptEditor` ~2966, field ~20924; window handle
  `app_modal_window` ~20920.
- Open path: CLI bridge `gpui/src/cli_bridge.rs` (port 58743; decode
  openFloatingEditor ~94-110; server start wired ~main.rs:26655-26688, boot
  ~54533) → `receive_gpui_cli_bridge_open_floating_editor` ~31074 → builds
  `open` payload ~31148 → `open_gpui_app_modal_window(FloatingPromptEditor)`
  ~31168 / window creation ~23594-23748.
- Message handlers ~24009-24022 → save ~31184 (fs::write ~31196), cancel ~31205,
  draftUpdate ~31217, pasteImage ~31237, imagePreview ~31273; close-and-save
  dispatch ~31333; status writer `write_gpui_floating_prompt_editor_status_file`
  (~31082, ~31201, ~31213, app close ~26612); prompt-editor window-frame
  persistence ~23698-23748.
- Attach capability advertisement: main.rs ~64182-64193 appends
  `--prompt-editor monaco` gated by
  `gpui_current_zmx_prompt_editor_attach_mode_is_monaco()` (currently requires
  the CLI bridge running AND shared setting `promptEditorBackend == "monaco"`).
- Build: `gpui/vite.config.ts` `stageMonacoEditorAssets()` ~106 stages
  `monaco/vs` into `gpui/dist/sidebar/`; modal-host entry mapping ~26.
- Note: the app-modal CEF window and the `ghostexAppModalHost` V8 bridge in
  `gpui/src/cef/shell.rs` serve ALL modal kinds (settings, palette, etc.) —
  they STAY. Only floating-prompt-editor-specific code goes.

CLI:
- `scripts/ghostex-cli.mjs` — command registration ~129 (`floating-monaco-editor`,
  `fme`), `floatingMonacoEditorCommand` ~3401-3523 (bridge connect ~3466, send
  ~3473-3486, status poll `waitForFloatingMonacoStatus` ~3492, exit-0-iff-saved
  ~3503, vi fallback ~3516), prompt-editor selection ~3262-3334 (maps monaco →
  `["ghostex","floating-monaco-editor",filePath]` ~3334), help ~6273.

gxserver: not involved in rendering; only carries the transient monaco attach
intent. No gxserver changes in this plan.

---

## Phase 1: Standalone editor web bundle

- depends_on: []
- parallel_ok: true
- goal: Create the self-contained Monaco editor web page for the standalone
  app: a single HTML entry plus the Monaco AMD runtime staged beside it,
  implementing the web side of the JS<->native contract above. No React, no
  Ghostex imports — this page must have zero dependencies on the rest of the
  repo apart from `node_modules/monaco-editor`.
- files: `editor/web/**` (new; suggest `editor/web/index.html` and
  `editor/web/editor.ts`), `editor/scripts/build-editor-web.mjs` (new),
  `editor/README.md` (new, short: what this is, how to build).
- do_not_touch: `package.json`, `scripts/ghostex-cli.mjs`, anything under
  `native/`, `gpui/`, `shared/`, `sidebar/`. Do not modify
  `native/sidebar/floating-monaco-editor.html` (you may READ it as a reference
  for the monaco AMD loader pattern — loader.js + workerMain.js + require.config
  paths — but the new page is a fresh file).
- approach: Write `editor/web/editor.ts` (bundled to an IIFE with `Bun.build`,
  mirroring the style of `scripts/build-native-web-bundles.mjs`) that: reads
  `window.__GHOSTEX_EDITOR_BOOTSTRAP__`; loads Monaco via the AMD loader from
  `./monaco/vs` (MonacoEnvironment.getWorkerUrl → `./monaco/vs/base/worker/workerMain.js`);
  creates the editor (theme `vs-dark`, automaticLayout, wordWrap on for
  markdown) with a model whose URI is derived from `filePath` for language
  auto-detection unless `language` is set; posts `ready` after content is set;
  wires draftUpdate (debounced ~300ms), Cmd+Enter saveAndClose, Esc cancel,
  Cmd+S save, paste handler for image clipboard data (`pasteImage` +
  `imagePasteResult` listener inserting the returned path); renders a slim
  header bar with the title and Save/Cancel buttons. Keep all styling inline in
  `index.html` (dark background matching vs-dark so there is no white flash).
  The build script `editor/scripts/build-editor-web.mjs`: bundle editor.ts,
  emit `editor/dist/web/index.html` (with the bundle inlined or as a sibling
  `editor.js` script tag — inlined preferred, matching how modal-host is
  inlined), and rsync/copy `node_modules/monaco-editor/min/vs` →
  `editor/dist/web/monaco/vs`. Idempotent, no network.
- acceptance_criteria:
  - `bun editor/scripts/build-editor-web.mjs` exits 0 and produces
    `editor/dist/web/index.html` and `editor/dist/web/monaco/vs/loader.js`.
  - `rg -n "ghostexEditorHost|__GHOSTEX_EDITOR_BOOTSTRAP__|ghostex-editor-host-message" editor/web` shows the
    contract implemented (postMessage bridge, bootstrap read, host-message listener).
  - The built `index.html` references only relative assets (`./monaco/vs/...`),
    no absolute paths, no network URLs: verify with
    `rg -n "https?://" editor/dist/web/index.html` returning nothing
    (monaco's own internal strings inside `monaco/vs/**` are fine and out of scope).
  - No imports from anywhere outside `editor/` and `node_modules/monaco-editor`
    in `editor/web/**` (check the source imports by reading them).

## Phase 2: Standalone macOS editor app (GhostexEditor.app)

- depends_on: []
- parallel_ok: true
- goal: Create the native standalone app: a minimal SwiftPM executable that
  shows one window with a WKWebView loading the Phase 1 page, implements the
  native side of the JS<->native contract, the CLI argument contract, the
  status-file protocol, exit codes, and lifecycle force-save — exactly as
  specified in "Shared contracts" above.
- files: `editor/macos/**` (new; SwiftPM package, e.g.
  `editor/macos/Package.swift` + `editor/macos/Sources/GhostexEditor/*.swift`),
  `editor/scripts/build-editor-app.sh` (new).
- do_not_touch: `package.json`, `scripts/ghostex-cli.mjs`, anything under
  `native/`, `gpui/`, `shared/`, `sidebar/`, `editor/web/**` (Phase 1 owns it;
  rely only on the contract and on `editor/dist/web/` existing at runtime).
- approach: Executable target (macOS 13+ is fine; match the ghostexHost
  package's minimum if easy to check). main.swift parses args per the CLI
  contract (arg errors → stderr usage + exit 2). AppDelegate builds an
  NSWindow (titled from `--title`, default "Ghostex Editor";
  frameAutosaveName "GhostexEditorWindow"; sensible default 900x620, min
  ~480x320) containing a WKWebView with a `WKUserContentController` script
  message handler named `ghostexEditorHost`. Inject the bootstrap user script
  at documentStart with JSON-encoded initialText/language/filePath/title (use
  JSONEncoder/JSONSerialization — never manual string escaping). Load the web
  assets with `loadFileURL(indexHtml, allowingReadAccessTo: webRoot)` where
  webRoot resolves to `Bundle.main.resourceURL/Web` in the packaged app, with
  a `GHOSTEX_EDITOR_WEB_ROOT` env override for development. Track the latest
  draft (initialText until the first draftUpdate). Handle the five message
  types; write files atomically; on `ready` write `started` to the status
  file. Install signal handlers (SIGTERM/SIGINT/SIGHUP via DispatchSource, not
  raw signal handlers doing UI work) and `applicationShouldTerminate` /
  window-close delegate → force-save path (write draft, status `saved`,
  exit 0). Save button/Cmd+Enter → saved/exit 0; Esc/Cancel → cancelled/exit 1.
  `NSApp.setActivationPolicy(.regular)` + `NSApp.activate(ignoringOtherApps:true)`
  so the window fronts when launched from a terminal.
  `editor/scripts/build-editor-app.sh`: run `bun editor/scripts/build-editor-web.mjs`
  first, `swift build -c release` the package, then assemble
  `editor/dist/GhostexEditor.app` (Contents/MacOS/GhostexEditor binary,
  Contents/Info.plist with CFBundleIdentifier following the main app's id
  prefix convention with an `.editor` suffix — check the identifier used in
  `native/macos/ghostexHost/build-ghostex-host.sh` and mirror its prefix —
  CFBundleName "Ghostex Editor", NSHighResolutionCapable, LSMinimumSystemVersion),
  copy `editor/dist/web/` → `Contents/Resources/Web/`, and ad-hoc codesign
  (`codesign --force --deep --sign -`). No app icon needed yet.
- acceptance_criteria:
  - `bash editor/scripts/build-editor-app.sh` exits 0 and produces
    `editor/dist/GhostexEditor.app/Contents/MacOS/GhostexEditor` and
    `Contents/Resources/Web/monaco/vs/loader.js`.
  - End-to-end smoke (run it and show the transcript): create a temp file with
    known content, run the binary with the file plus `--status-file`, poll
    until the status file contains `started` (allow up to ~20s), then send
    SIGTERM to the process; the process must exit with code 0, the status file
    must contain `saved`, and the file content must be unchanged. This proves
    the full launch → WKWebView → Monaco → ready → force-save round trip.
  - Second smoke: same launch, wait for `started`, then kill with SIGINT —
    also `saved`/exit 0 (force-save applies to all lifecycle signals).
  - `--help` (or missing file arg) prints usage and exits 2.

## Phase 3: CLI launches the standalone app

- depends_on: [1, 2]
- parallel_ok: false
- goal: `ghostex floating-monaco-editor <file>` spawns GhostexEditor directly
  and blocks on its exit, instead of connecting to the app loopback bridge.
  The zmx capability selection, temp draft dir, status-file, logging, and
  exit-code semantics stay identical from the caller's point of view.
- files: `scripts/ghostex-cli.mjs` (canonical), then copy the file over
  `native/macos/ghostexHost/CLI/ghostex-cli.mjs`; `package.json` (add a
  `"build:editor"` script running `bun editor/scripts/build-editor-web.mjs && bash editor/scripts/build-editor-app.sh`).
- do_not_touch: anything under `native/macos/ghostexHost/Sources/`, `gpui/`,
  `shared/`, `editor/` (consume Phase 1/2 outputs only). Do not touch the
  `floating-editor` terminal-kind command path or any other bridge command —
  the bridge code in the CLI stays for the remaining commands that use it.
- approach: In `floatingMonacoEditorCommand` (~3401): keep argument parsing,
  requestId, temp workDir + statusFile creation, and the
  `promptEditorSelectionTrace` logging. Replace the connectBridge +
  `openFloatingEditor` send + `waitForFloatingMonacoStatus` block with:
  resolve the editor executable via the shared resolution order (env
  `GHOSTEX_EDITOR_APP` → `~/Applications` → `/Applications` → repo-dev
  `editor/dist/...`); if not found, keep the existing degrade path (currently
  inline `vi`) with a clear stderr note naming `GHOSTEX_EDITOR_APP`; spawn the
  executable with `[file, "--language", "markdown", "--title", "Prompt Editor", "--status-file", statusFile]`
  (stdio ignore/inherit-stderr), forward SIGTERM/SIGINT from the CLI to the
  child, wait for child exit, and exit 0 iff the child exited 0 (cross-check
  the status file content `saved` like today where convenient). Remove
  now-dead helpers that existed only for the monaco bridge round trip (e.g.
  `waitForFloatingMonacoStatus` if nothing else uses it) — do not leave dead
  code. Update the help text (~6273) to say it opens the standalone Ghostex
  Editor app. Keep `selectPromptEditorCommand` mapping monaco →
  `["ghostex","floating-monaco-editor",filePath]` unchanged.
- acceptance_criteria:
  - `node scripts/ghostex-cli.mjs help` (or `--help`) exits 0 and mentions the
    standalone editor for `floating-monaco-editor`.
  - E2E smoke: with `GHOSTEX_EDITOR_APP=<repo>/editor/dist/GhostexEditor.app`,
    run `node scripts/ghostex-cli.mjs floating-monaco-editor <tmpfile>` in the
    background; wait for the GhostexEditor process to appear and its status
    file to reach `started`; SIGTERM the GhostexEditor process; the CLI must
    exit 0 (force-save = saved). Show the transcript.
  - `rg -n "openFloatingEditor" scripts/ghostex-cli.mjs` shows no remaining
    monaco-kind usage (terminal-kind/floating-editor usages may remain).
  - `cmp scripts/ghostex-cli.mjs native/macos/ghostexHost/CLI/ghostex-cli.mjs`
    exits 0 (copies in sync).
  - `node --check scripts/ghostex-cli.mjs` passes.

## Phase 4: Remove embedded Monaco from the macOS app

- depends_on: [3]
- parallel_ok: true (files disjoint from Phase 5)
- goal: The macOS Ghostex app no longer hosts Monaco at all. The
  `editorKind:"monaco"` path, the floating-prompt-editor modal (including
  prewarm), the legacy standalone-HTML overlay, and the Monaco asset copies in
  the build are removed. The terminal-kind floating editor and every other
  app-modal keep working. Ctrl+G keeps working because the CLI (Phase 3) now
  launches the standalone app — the macOS app's only remaining role is
  advertising the monaco attach capability, which lives in settings/attach
  code, not in the removed hosting code (verify that advertisement path still
  compiles and does not reference removed code).
- files: `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift`,
  `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`,
  `native/macos/ghostexHost/Sources/ghostexHost/NativeHostBridge.swift`,
  `native/macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift`,
  `native/sidebar/modal-host.tsx`, delete
  `native/sidebar/floating-monaco-editor.html`,
  `native/macos/ghostexHost/build-ghostex-host.sh`,
  `sidebar/styles/modals.css`, `shared/native-ghostty-host-protocol.ts`.
- do_not_touch: `scripts/ghostex-cli.mjs` and
  `native/macos/ghostexHost/CLI/ghostex-cli.mjs` (Phase 3 owns them; if the
  build script references the CLI copy step leave it as is), anything under
  `gpui/` (Phase 5 owns it), `editor/**`, gxserver code.
- approach: Remove in this order and keep the app compiling: (1) In
  `AppDelegate.swift` remove the monaco branch of `openFloatingEditor`
  (~7542-7561 keeps only the terminal path), `openFloatingPromptEditor`
  (~7727-7878), prewarm machinery (~7894-8065),
  `ActiveFloatingPromptEditor` state (~6733, ~6881), the
  floating-prompt-editor cases in `handleAppModalHostMessage` (~13246-13255),
  `writeFloatingPromptEditorStatusFile` (~8828) and its call sites,
  `saveActiveFloatingPromptEditorForAppLifecycleClose` (~8233; call sites
  ~1195, ~2251), and `dispatchFloatingPromptEditorHostMessage` (~11977). Keep
  `openNativeAppModalWindow`/`AppModalWindowController` — other modals use
  them. (2) In `TerminalWorkspaceView.swift` remove `openFloatingMonacoEditor`
  (~3561-3719) and `saveFloatingMonacoEditor` (~3721+) and the monaco branch
  in `openFloatingEditor` (~3445-3448). (3) In `HostProtocol.swift` and
  `shared/native-ghostty-host-protocol.ts` drop the `"monaco"` editorKind
  value (keep `"terminal"`); in `NativeHostBridge.swift` keep the
  openFloatingEditor special-case decode (terminal kind still uses it) but if
  a monaco-kind command arrives, respond with a clear error instead of
  silently ignoring (old CLIs). (4) In `modal-host.tsx` remove
  `FloatingPromptEditorModal`, `loadModalHostMonaco`, the
  floatingPromptEditor modal kind and its message/state types; remove
  `.floating-prompt-editor-monaco` CSS from `sidebar/styles/modals.css`.
  (5) In `build-ghostex-host.sh` remove the `floating-monaco-editor.html`
  copy (~1905) and the monaco `min/vs` rsync (~2112-2113). Delete
  `native/sidebar/floating-monaco-editor.html`. Then chase remaining compile
  errors from removed symbols (search `floatingPromptEditor`,
  `FloatingPromptEditor`, `floatingMonaco`, `monaco` case-insensitively under
  `native/` and `sidebar/` and `src/` to find stragglers — some sidebar/src
  code may reference the modal kind; remove those references too, keeping
  other modals intact).
- acceptance_criteria:
  - `swift build` (run it from `native/macos/ghostexHost` with the same
    package layout the repo build uses — check how `build-ghostex-host.sh`
    invokes the Swift build and use that compile step) succeeds.
  - The web bundles still build: run the TSX bundle step the same way
    `build-ghostex-host.sh` does (`scripts/build-native-web-bundles.mjs` with
    the entries it passes, or the narrowest equivalent) — exits 0.
  - `rg -in "floatingPromptEditor|floatingMonaco" native/ sidebar/ src/ shared/ -g '!node_modules/**'`
    returns nothing (or only comments/strings that are clearly not code paths —
    ideally nothing).
  - `rg -n "monaco" native/macos/ghostexHost/Sources native/macos/ghostexHost/build-ghostex-host.sh`
    returns nothing except (allowed) the bridge error message for stale
    monaco-kind commands and the untouched CLI copy step.
  - `test ! -f native/sidebar/floating-monaco-editor.html`.

## Phase 5: Remove embedded Monaco from the gpui app and rewire the attach gate

- depends_on: [3]
- parallel_ok: true (files disjoint from Phase 4)
- goal: The gpui app no longer hosts Monaco and no longer runs the CLI bridge
  (which existed solely for openFloatingEditor). The monaco attach-capability
  gate switches from "CLI bridge running" to "standalone editor app
  resolvable". All other app-modals and the shared app-modal CEF window stay
  working.
- files: `gpui/src/main.rs`, `gpui/src/cli_bridge.rs` (delete),
  `gpui/vite.config.ts`, `gpui/ARCHITECTURE.md`, and any small references in
  `gpui/src/**` that mention the removed items. WARNING: `gpui/src/main.rs`
  and other gpui files carry uncommitted user changes — edit surgically on
  top, never revert.
- do_not_touch: `native/**`, `sidebar/**`, `shared/**`, `scripts/**`,
  `editor/**`, `gpui/src/cef/shell.rs` app-modal bridge machinery (the
  `ghostexAppModalHost` V8 bridge serves all modals — leave it; only remove
  code that exists exclusively for the floating prompt editor, and prefer
  leaving shell.rs untouched entirely), `gpui/scripts/build-macos-app.sh`
  (rsyncs whole dist, no change needed).
- approach: In `gpui/src/main.rs` remove: the
  `GpuiAppModalKind::FloatingPromptEditor` variant and its id/title/size arms
  (~1916-2078) plus any hotkey mapping arm (~2231);
  `GpuiActiveFloatingPromptEditor` (~2966) and the
  `active_floating_prompt_editor` field (~20924); the CLI-bridge server start
  wiring (~26655-26688, boot ~54533) and
  `receive_gpui_cli_bridge_open_floating_editor` (~31074-31168); the
  floatingPromptEditor* message router arms (~24009-24022) and their handler
  fns (~31184-31333); `write_gpui_floating_prompt_editor_status_file` and all
  call sites (~31082, ~31201, ~31213, ~26612); prompt-editor-specific
  window-frame persistence (`persist_gpui_floating_prompt_editor_frame_state`,
  restored-bounds arm ~23698-23748) while keeping generic app-modal window
  creation for the other kinds. Delete `gpui/src/cli_bridge.rs` and its `mod`
  declaration. Rework `gpui_current_zmx_prompt_editor_attach_mode_is_monaco()`
  (~64193): keep the shared-settings `promptEditorBackend == "monaco"` check,
  replace the bridge-running condition with "standalone editor resolvable"
  implementing the shared resolution order in Rust (env `GHOSTEX_EDITOR_APP`
  file-or-bundle, `~/Applications`, `/Applications`; skip the repo-dev step or
  include it behind the env var only). In `gpui/vite.config.ts` remove
  `stageMonacoEditorAssets()` (~106) and its registration. Update
  `gpui/ARCHITECTURE.md`: the prompt editor is now the external GhostexEditor
  app launched by the CLI; the gpui CLI bridge is gone. Search
  `gpui/src gpui/sidebar` for `floating_prompt_editor|floatingPromptEditor|cli_bridge|FloatingPromptEditor|monaco`
  (case-insensitive) and clean every code-path reference (docs/comments about
  the external app are fine).
- acceptance_criteria:
  - `cargo check` in `gpui/` succeeds (both the main binary and
    `ghostex_gpui_cef_helper`; use `cargo check --all-targets` or the
    project's usual check invocation).
  - The gpui web bundle builds: run the vite build the way the repo does
    (check `gpui/package.json` scripts; e.g. `bun run build` inside `gpui/`)
    — exits 0, and `gpui/dist/sidebar/monaco` is no longer produced by a
    fresh build (delete the stale dir first or verify the config no longer
    references monaco).
  - `rg -in "floating_prompt_editor|floatingPromptEditor|cli_bridge" gpui/src gpui/sidebar gpui/vite.config.ts`
    returns nothing except (allowed) comments explaining the external editor.
  - `test ! -f gpui/src/cli_bridge.rs`.
  - `rg -n "prompt-editor monaco" gpui/src/main.rs` still shows the attach
    flag emission, now gated by editor-app resolvability (read the gate fn and
    confirm no bridge references).

---

# Fix round (2026-07-05): install story + non-monaco-client routing

User-reported problems after the extraction:

1. Rebuilding the macOS app and pressing Ctrl+G prints "Ghostex standalone
   editor unavailable; falling back to vi". Root cause: nothing installs
   `GhostexEditor.app`; the terminal `ghostex` is the installed CLI at
   `/Applications/Ghostex.app/Contents/Resources/CLI/ghostex-cli.mjs`, so the
   repo-dev resolution step cannot apply and `~/Applications` /
   `/Applications` have no GhostexEditor.app.
2. Ctrl+G from the Android/iOS/TUI clients while settings select monaco must
   open the user's default (machine) editor, never Monaco. Verified failure
   modes (see evidence below): (FM2) zmx `util.isUserInput` excludes `0x07`
   (BEL = Ctrl+G), so a Ctrl+G from a non-leader client is dropped and never
   promotes the pressing client to leader — the later
   `zmx prompt-editor-capability` query answers with the stale leader (often
   the monaco-capable macOS/gpui client); (FM3) with `ZMX_SESSION` missing
   the CLI falls back to pure env (`GHOSTEX_PROMPT_EDITOR_BACKEND=monaco` +
   `GHOSTEX_PROMPT_EDITOR_CLIENT=macos-app`, both baked into session env at
   creation) and selects monaco with no live-client check; and when the
   editor app is missing the CLI degrades to `vi` instead of the configured
   machine editor.

Key evidence (verified):
- Installed launcher: `/opt/homebrew/bin/ghostex` execs
  `/Applications/Ghostex.app/Contents/Resources/CLI/ghostex-cli.mjs`.
- Local-start install flow: `scripts/start-ghostex.mjs` (INSTALL_DIR default
  `/Applications` at line ~25) mirrors the built Ghostex.app into
  /Applications under a repository-wide local-start lock (~line 145, 628).
- CLI selection: `scripts/ghostex-cli.mjs` `zmxPromptEditorCapability`
  ~3288-3316 (returns undefined when ZMX_SESSION empty; "editor" when
  GHOSTEX_ZMX_BIN unset or probe fails), `isMacosAppPromptEditorClient`
  ~3318-3323 (env fallback when capability undefined),
  `selectPromptEditorCommand` ~3325-3341 (monaco branch),
  `machinePromptEditorCommandFromEnvironment` (machine/default editor),
  `resolveGhostexEditorExecutable` ~3507, vi fallback ~3495. Existing tests:
  `scripts/ghostex-cli.test.mjs` ~968-1273 cover this routing — update them
  with any behavior change (tests in scripts/ are allowed; the no-test rule
  covers the macOS app and gpui trees only).
- zmx leadership: `zmx/src/main.zig` `handleInput` ~1001-1014 (non-leader
  input is promoted+queued only when `util.isUserInput(payload)`; otherwise
  DROPPED), `handlePromptEditorCapability` ~1016-1040 (reports the LEADER
  client's capability), monaco bit set only by `--prompt-editor=monaco`
  attach init (~154-161, ~2816-2820). `zmx/src/util.zig` `isUserInput`
  ~446-477 allows execute codes 0x0D/0x0A/0x09/0x08 but NOT 0x07 (BEL).
- Mobile/TUI clients attach as plain zmx clients with no monaco bit and have
  no client-side Ctrl+G UI (Android `GhostexSshCommandBuilder.java:179`; iOS
  `RemoteTmuxManager.swift`; tui2 `src/remote/unix.rs` — zero prompt-editor
  refs). Ctrl+G is just byte 0x07 into the PTY; the agent spawns $EDITOR →
  `ghostex prompt-editor`.
- gxserver is Rust now (`gxserver-rs/src/zmx.rs`); providers bake
  `GHOSTEX_PROMPT_EDITOR_BACKEND=monaco` when the requesting client asked for
  monaco (~1845-1846). `GHOSTEX_PROMPT_EDITOR_CLIENT=macos-app` comes from
  the macOS host terminal env (`TerminalWorkspaceView.swift:1420-1421`,
  `native-sidebar.tsx:21885-21886`).

Design decisions for this round:
- The pressing client must decide: adding 0x07 to zmx `isUserInput` makes a
  Ctrl+G press promote the pressing attach client to leader and forward the
  byte, so the capability query reflects the presser. Mobile/TUI leader has
  no monaco bit → capability "editor" → machine/default editor. A ~ms race
  with concurrent typing from another client remains and is accepted.
- "Monaco unavailable" must route to the configured machine/default editor
  (the same selection `machinePromptEditorCommandFromEnvironment` already
  implements, which honors the user's default editor and gte), NOT vi.
- We do NOT plumb an editor-resolvability check into the macOS sidebar
  webview advertisement (native-sidebar.tsx:4835): with the install step in
  Phase 6 plus the CLI-side resolvability gate in Phase 7, advertisement
  gating would add native<->webview plumbing for no additional safety.
- Release/DMG shipping of GhostexEditor.app is explicitly out of scope for
  this round (local dev install flow only); note it in the final summary.

## Phase 6: Build and install GhostexEditor.app with the macOS app

- depends_on: []
- parallel_ok: true
- goal: After the user's normal local rebuild+start flow for the macOS app,
  `/Applications/GhostexEditor.app` exists and is current, so the installed
  CLI resolves it. The editor app stays a separate bundle — it is installed
  BESIDE Ghostex.app, never inside it.
- files: `native/macos/ghostexHost/build-ghostex-host.sh`,
  `scripts/start-ghostex.mjs`.
- do_not_touch: `scripts/ghostex-cli.mjs` and its CLI copy (Phase 7 owns
  them), `zmx/**` (Phase 8 owns it), `editor/**` source (consume its build
  scripts as-is), `gpui/**`.
- approach: In `build-ghostex-host.sh`, add a step (near the other web/CLI
  staging steps) that builds the standalone editor:
  `bun editor/scripts/build-editor-web.mjs && bash editor/scripts/build-editor-app.sh`,
  producing `editor/dist/GhostexEditor.app`; fail the build with a clear
  message if it fails. In `scripts/start-ghostex.mjs`, inside the same
  locked install section that mirrors Ghostex.app into INSTALL_DIR
  (default /Applications), mirror `editor/dist/GhostexEditor.app` →
  `<INSTALL_DIR>/GhostexEditor.app` (rsync/ditto with delete semantics,
  matching how the main app is copied). Do not launch the editor app; do
  not change how Ghostex.app itself is signed/installed. Respect the
  existing local-start lock comments (CDXC:LocalStartConcurrency).
  IMPORTANT: never run `bun run start` or `scripts/start-ghostex.mjs` —
  verify that file by code review and `node --check` only.
- acceptance_criteria:
  - `bash native/macos/ghostexHost/build-ghostex-host.sh` (the same
    invocation Phase 4 used for its build acceptance) completes and
    `editor/dist/GhostexEditor.app/Contents/MacOS/GhostexEditor` exists and
    is newer than the script start time.
  - `node --check scripts/start-ghostex.mjs` passes and
    `rg -n "GhostexEditor" scripts/start-ghostex.mjs` shows the install step
    inside the locked install path (show the surrounding code in the
    transcript for review).
  - `rg -n "GhostexEditor" native/macos/ghostexHost/build-ghostex-host.sh`
    shows the build step with a failure message.

## Phase 7: CLI routes monaco-unavailable and non-monaco clients to the machine/default editor

- depends_on: []
- parallel_ok: true
- goal: `ghostex prompt-editor` selects Monaco only when (a) the live zmx
  capability answer is "monaco", or (b) there is no zmx capability answer
  (undefined) AND the baked env marks a monaco-selecting macos-app client —
  and in BOTH cases only when the GhostexEditor executable actually
  resolves. In every other case, including "monaco selected but app
  missing", it runs the configured machine/default editor
  (machinePromptEditorCommandFromEnvironment), never vi. Direct
  `ghostex floating-monaco-editor` invocations with no resolvable app also
  degrade to the machine/default editor.
- files: `scripts/ghostex-cli.mjs` (canonical), `scripts/ghostex-cli.test.mjs`
  (update the existing routing tests; adding cases is fine — tests in
  scripts/ are allowed), then copy the canonical CLI over
  `native/macos/ghostexHost/CLI/ghostex-cli.mjs`.
- do_not_touch: `native/macos/ghostexHost/build-ghostex-host.sh`,
  `scripts/start-ghostex.mjs` (Phase 6 owns them), `zmx/**` (Phase 8),
  `editor/**`, `gpui/**`, gxserver-rs.
- approach: (1) In `selectPromptEditorCommand` (~3325): before returning the
  monaco selection, check `resolveGhostexEditorExecutable()`; on failure,
  emit ONE concise stderr note (mention GHOSTEX_EDITOR_APP and the expected
  /Applications install) and return the machine-editor selection instead.
  (2) In `floatingMonacoEditorCommand` (~3401): replace the inline-vi
  degrade with the machine/default editor selection
  (machinePromptEditorCommandFromEnvironment + the existing runEditorInline
  path). Remove the now-dead vi-specific code. (3) Do not change
  `zmxPromptEditorCapability` or the capability-precedence semantics — a
  truthy capability answer must keep overriding baked env, exactly as today.
  (4) Update `scripts/ghostex-cli.test.mjs` routing tests for the new
  behavior and add cases: monaco-selected-but-unresolvable → machine editor;
  capability "editor"/"gte" with baked monaco env → machine editor
  (existing, keep passing); capability "monaco" + resolvable → monaco.
  Find how the repo runs this test file (check package.json scripts /
  header comments; likely `node --test scripts/ghostex-cli.test.mjs` or
  `bun test scripts/ghostex-cli.test.mjs`) and run it.
- acceptance_criteria:
  - The ghostex-cli test suite passes (show the run).
  - E2E: in a temp HOME-ish env with `GHOSTEX_EDITOR_APP` unset, no
    GhostexEditor.app in `~/Applications` or `/Applications` visible to the
    resolver (if one exists on this machine, prove the branch with
    `GHOSTEX_EDITOR_APP=/nonexistent` semantics instead — the resolver must
    treat a set-but-invalid override as unresolvable for this test),
    `GHOSTEX_PROMPT_EDITOR_BACKEND=monaco`,
    `GHOSTEX_PROMPT_EDITOR_CLIENT=macos-app`, no `ZMX_SESSION`, and
    `GHOSTEX_PROMPT_EDITOR_MACHINE_VISUAL` pointing at a marker script that
    records its argv to a file and exits 0: run
    `node scripts/ghostex-cli.mjs prompt-editor <tmpfile>` and verify the
    marker script ran with the tmpfile (machine editor chosen) and vi never
    ran. Show the transcript.
  - E2E monaco path still works: with `GHOSTEX_EDITOR_APP` pointing at the
    built `editor/dist/GhostexEditor.app`, the same command spawns
    GhostexEditor (SIGTERM it after status `started`; CLI exits 0).
  - `rg -n '"vi"|fallback' scripts/ghostex-cli.mjs` shows no vi fallback
    remaining in the prompt-editor/monaco paths.
  - `cmp scripts/ghostex-cli.mjs native/macos/ghostexHost/CLI/ghostex-cli.mjs`
    exits 0.

## Phase 8: zmx — Ctrl+G promotes the pressing client to leader

- depends_on: []
- parallel_ok: true
- goal: A Ctrl+G (byte 0x07, BEL) sent by any attached zmx client counts as
  user input: it is forwarded to the PTY even when the sender is not the
  current leader, and it promotes the sender to leader — so the subsequent
  `zmx prompt-editor-capability` query reports the PRESSING client's
  capability. This makes Ctrl+G from Android/iOS/TUI (no monaco bit) select
  the machine/default editor even when a monaco-capable macOS/gpui client is
  also attached, and fixes the adjacent bug where a non-leader client's
  Ctrl+G was silently dropped.
- files: `zmx/src/util.zig` (`isUserInput` ~446-477), plus any zmx test file
  that covers isUserInput/leadership if one exists (zmx tests are allowed;
  do NOT add tests under native/macos or gpui).
- do_not_touch: everything outside `zmx/`. Do not change
  `handlePromptEditorCapability` semantics or the attach-time capability
  bits; only widen what counts as user input.
- approach: Add `0x07` to the allowed execute codes in `isUserInput` with a
  comment explaining Ctrl+G/prompt-editor leadership (the pressing client
  must become leader before the agent queries prompt-editor-capability).
  Check how `isUserInput` classifies input first: if 0x07 arrives as a
  different action kind than `.execute` in the VT parser, handle the kind it
  actually arrives as (verify against the parser, do not guess). Then check
  how the repo builds/tests zmx (look at `zmx/build.zig`, CI scripts, or
  `package.json` scripts) and run the zmx test suite. Also investigate how
  the zmx binary reaches the macOS app bundle (build-ghostex-host.sh stages
  a zmx; there are mentions of "pinned zmx" for remote packages): if the
  app-bundled zmx is built from this tree, note that a macOS app rebuild
  picks the fix up; if it is a pinned prebuilt artifact, do NOT try to
  re-pin — state precisely in your completion summary what artifact needs
  re-pinning so the orchestrator can report it.
- acceptance_criteria:
  - The zmx test suite passes (`zig build test` in `zmx/` or the repo's
    actual invocation — show it).
  - `rg -n "0x07" zmx/src/util.zig` shows the new code with the explanatory
    comment.
  - A live proof: create a zmx session with two clients where client A
    attaches with `--prompt-editor=monaco` and client B without; make A the
    leader (send qualifying input from A); then send 0x07 from B and run
    `zmx prompt-editor-capability` against the session — it must report
    B's capability ("editor"), not "monaco". Script this with the freshly
    built zmx binary and show the transcript. If the zmx CLI surface makes
    this two-client scripting impractical, prove it with the closest unit
    test in zmx/test and explain why.

## Handoff notes

(Orchestrator appends a 2-3 line summary of each completed phase here before
launching dependent phases.)

- Phase 1 COMPLETE: Added `editor/web/index.html` + `editor/web/editor.ts`
  (standalone Monaco page implementing the JS<->native contract),
  `editor/scripts/build-editor-web.mjs` (inlines the bundle, stages monaco AMD
  assets to `editor/dist/web/`), and `editor/README.md`. Build verified with
  `bun editor/scripts/build-editor-web.mjs`.

- Phase 2 COMPLETE: Added `editor/macos` SwiftPM app (CLI parsing, WKWebView
  bootstrap injection, ghostexEditorHost message handling, status-file
  protocol, save/cancel/image-paste, lifecycle force-save) and
  `editor/scripts/build-editor-app.sh` (builds web assets, assembles
  `editor/dist/GhostexEditor.app`, ad-hoc signs). Verified: --help/missing
  arg exit 2; SIGTERM and SIGINT smokes both reached `started`, exited 0,
  wrote status `saved`, file content unchanged.

- Phase 3 COMPLETE: `ghostex floating-monaco-editor` now resolves the editor
  executable (env `GHOSTEX_EDITOR_APP` → `~/Applications` → `/Applications` →
  repo dev build) and spawns it directly with `--status-file`; no bridge
  connection for the monaco kind anymore. Kept blocking semantics, signal
  forwarding, and the vi degrade path. Added `build:editor` to package.json;
  bundled CLI copy synced (cmp identical). Verified via help/syntax/grep
  checks and a SIGTERM E2E smoke through the real app.

- Phase 5 COMPLETE: Deleted `gpui/src/cli_bridge.rs` and its wiring; removed
  the FloatingPromptEditor modal kind, state, message handlers, status-file
  writers, and prompt-editor frame persistence from `gpui/src/main.rs`;
  attach gating now advertises monaco only when GhostexEditor.app resolves
  (env → ~/Applications → /Applications); removed monaco staging from
  `gpui/vite.config.ts`; updated `gpui/ARCHITECTURE.md`. Verified with
  `cargo check --all-targets`, vite build, and stale-symbol greps.

- Phase 4 COMPLETE: Removed macOS embedded Monaco hosting (prompt-editor
  modal, prewarm, status handling, legacy overlay), the floating prompt
  editor UI/state from `modal-host.tsx` and modal CSS/types, and the
  build-script staging of `floating-monaco-editor.html` + monaco `vs`
  assets; kept the terminal-kind floating editor and the monaco attach
  advertisement. Verified with xcodebuild, the native web-bundle build, and
  source-cleanup greps.

- Phase 6 COMPLETE: `build-ghostex-host.sh` now builds GhostexEditor.app
  (with clear failure checks for the expected executable), and
  `scripts/start-ghostex.mjs` syncs `editor/dist/GhostexEditor.app` →
  `<INSTALL_DIR>/GhostexEditor.app` inside the locked local-start install
  section. Verified: native build, executable freshness, `node --check`,
  greps. (Orchestrator also manually installed the current build to
  /Applications/GhostexEditor.app for immediate relief and smoke-tested the
  installed CLI end-to-end: editor launched, SIGTERM → exit 0.)

- Phase 8 COMPLETE: `zmx/src/util.zig` now counts .execute code 0x07 (BEL /
  Ctrl+G) as user input, with the leadership comment; verified C0 controls
  arrive as .execute in the VT parser. `zig build test` passed (Zig 0.15.2);
  live two-client proof: A attached with monaco, B without; B pressed Ctrl+G
  → capability reported "editor". Note: zmx/ is a nested git checkout (change
  tracked there), and remote pinned zmx packages need separate re-pinning;
  macOS rebuilds pick the fix up from source.

- Phase 7 COMPLETE: prompt-editor selection now requires a resolvable
  GhostexEditor before choosing monaco (invalid GHOSTEX_EDITOR_APP counts as
  unavailable); direct `floating-monaco-editor` unavailable handling runs
  machinePromptEditorCommandFromEnvironment instead of vi; routing tests
  expanded in `scripts/ghostex-cli.test.mjs` (run via
  `node_modules/.bin/vitest run scripts/ghostex-cli.test.mjs`). Verified
  with vitest, node --check, cmp copy sync, machine-editor E2E, and a real
  GhostexEditor SIGTERM E2E.
