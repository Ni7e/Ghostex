# Plan: GhostexEditor daemon — save keybindings, no Dock icon, Linux/Windows hosts, instant multi-instance windows

Date: 2026-07-05. Planner: Fable orchestration session. Workers: Codex gpt-5.5.

## Overall goal

The Ctrl+G Monaco prompt editor was recently extracted from the macOS/gpui apps
into a standalone `GhostexEditor.app` (`editor/` tree). Today it is a
**one-shot process per invocation**: `ghostex floating-monaco-editor <file>`
(in `scripts/ghostex-cli.mjs`) resolves the app binary, spawns it with
`<file> --language markdown --title "Prompt Editor" --status-file <path>`,
waits for process exit, and reads the status file (`saved`/`cancelled`).

This plan converts it into a **resident daemon** and adds cross-platform hosts.
User requirements:

1. **Cmd+S or Ctrl+G saves and closes** the editor window (Cmd+Enter already
   does; Cmd+S currently only saves without closing; Ctrl+G is unbound).
2. **No macOS Dock icon** (LSUIElement + accessory activation policy).
3. **Linux and Windows implementations** using each OS's built-in webview
   (WebKitGTK on Linux, WebView2 on Windows) to render the same Monaco web
   bundle — like macOS uses WKWebView today.
4. **Editor stays loaded after the Ghostex app launches** so Ctrl+G in a
   terminal shows the window instantly — daemon is pre-warmed at app startup
   and keeps a hidden, Monaco-loaded window ready.
5. **Multiple simultaneous editor windows** — Ctrl+G in several sessions shows
   several independent editor windows at once.

## Repo rules all workers MUST follow

- **No tests** anywhere under the macOS app trees (`native/`,
  `native/macos/`, `editor/macos/`) or the `gpui/` tree. Do not add test
  targets or test files there. Tests in `scripts/` (e.g. updating existing
  `scripts/ghostex-cli.test.mjs`) are allowed.
- **No fallback code paths** where the right fix is correct behavior from the
  start. (The existing CLI machine-editor fallback when GhostexEditor is not
  installed is pre-existing policy — keep it, do not extend the pattern.)
- **Never run** `bun run start` or anything that restarts the running Ghostex
  app.
- The repo has **unrelated uncommitted changes** (e.g.
  `native/sidebar/modal-host.tsx`). Never revert, reformat, or touch files
  outside your phase's `files` list. Never run `git restore .`, `git clean`,
  `git reset`, or similar.
- JS tooling is `bun`. Swift builds via `swift build` /
  `editor/scripts/build-editor-app.sh`. Rust via `cargo`.
- macOS native/hit-testing discipline: no transparent overlays, no hitTest
  hacks. Editor windows are normal standalone NSWindows/tao windows.

## Pinned daemon protocol (all phases implement EXACTLY this)

Transport: newline-delimited JSON (one JSON object per `\n`-terminated line,
UTF-8) over a local IPC socket. Protocol version `1`.

**Socket path resolution** (identical logic in Swift host, Rust host, JS CLI,
and the gpui Rust gate):

- Env override `GHOSTEX_EDITOR_SOCKET` (absolute path) wins everywhere.
- macOS and Linux: `$XDG_RUNTIME_DIR/ghostex-editor.sock` if `XDG_RUNTIME_DIR`
  is set and non-empty, else `$HOME/.ghostex/ghostex-editor.sock` (create the
  directory with mode 0700 if missing).
- Windows: named pipe `\\.\pipe\ghostex-editor-<USERNAME>` where `<USERNAME>`
  is the current user name with every char outside `[A-Za-z0-9._-]` replaced
  by `-`.

**Requests (client → daemon)** — every request includes `"v": 1`:

- `{"v":1,"type":"ping"}` → reply `{"type":"pong","v":1,"openCount":<int>,"warm":<bool>}`
  (`warm` = a preloaded hidden editor window is ready).
- `{"v":1,"type":"warm"}` → ensure a warm window exists (create if missing),
  reply `{"type":"warmed","v":1}` once Monaco in the warm window has posted
  `ready` (or immediately if already warm).
- `{"v":1,"type":"open","requestId":"<nonempty string>","filePath":"<abs path>","language":"markdown","title":"Prompt Editor","statusFile":"<abs path>"}`
  → daemon reads the current file contents (empty string if the file does not
  exist), configures a window (warm one if available, freshly created
  otherwise), shows + focuses it, writes `started` to `statusFile`, and
  replies `{"type":"opened","requestId":"..."}`. Later, when that window
  finishes, the daemon sends **on the same connection**
  `{"type":"closed","requestId":"...","status":"saved"|"cancelled"}`.
  `language` and `title` are optional (defaults: infer/`markdown`, "Prompt
  Editor"). If the opener's connection drops, the window stays open and the
  outcome is still recorded in `statusFile`.
- `{"v":1,"type":"close","requestId":"...","action":"save"|"cancel"}` →
  programmatically finish that session exactly as if the user pressed
  Cmd+S (`save`) or Escape (`cancel`); reply `{"type":"ok","v":1}` to the
  sender (the `closed` event still goes to the opener's connection). Unknown
  requestId → `{"type":"error","v":1,"message":"unknown requestId"}`.
- `{"v":1,"type":"status"}` → `{"type":"status","v":1,"sessions":[{"requestId":"...","title":"..."}],"warm":<bool>}`.
- `{"v":1,"type":"shutdown"}` → reply `{"type":"ok","v":1}`; exit immediately
  if no sessions are open, otherwise exit right after the last open session
  closes. (Used by `start-ghostex.mjs` after installing a new bundle so a
  stale daemon does not keep serving old code.)
- Malformed JSON or unknown `type` → `{"type":"error","v":1,"message":"..."}`,
  connection stays open.

**Session end semantics** (per window): on save → write the draft to
`filePath` atomically, write `saved` to `statusFile`, emit `closed` with
`"saved"`, destroy the window. On cancel → write `cancelled` to `statusFile`,
emit `closed` with `"cancelled"`, destroy the window. Window close button →
save-and-close (matches current force-save behavior). Daemon SIGTERM/SIGINT →
save-and-close every open session, then exit. The daemon **never** exits just
because the last window closed.

**Single instance**: on startup, if connecting to the socket and a `ping`
round-trips, exit 0 silently (another daemon is healthy). Otherwise remove the
stale socket file (unix) and bind. Warm one window immediately after binding.

**Web ⇄ host bridge** (inside each webview): unchanged message names
(`ready`, `draftUpdate`, `saveAndClose`, `save`, `cancel`, `pasteImage` /
`imagePasteResult`) plus new host→web `configure` and web→host `configured`:

- Page loads Monaco with an empty model and NO bootstrap global, posts
  `{"type":"ready"}` when Monaco is up.
- Host dispatches `window` CustomEvent `ghostex-editor-host-message` with
  `detail = {"type":"configure","initialText":"...","language":"markdown"|null,"filePath":"...","title":"..."}`;
  page applies it (model value + language + uri, title element, cleared undo
  stack, focus) and posts `{"type":"configured"}`.
- Web→host transport: `window.webkit.messageHandlers.ghostexEditorHost.postMessage(obj)`
  when present (WKWebView), else `window.ipc.postMessage(JSON.stringify(obj))`
  (wry on Linux/Windows).

## Handoff notes

(Orchestrator appends a 2-3 line summary after each phase completes.)

- Phase 1 COMPLETE: `editor/web/editor.ts` now boots Monaco warm with an empty
  model and applies host `configure` events on demand (posts `configured`);
  `__GHOSTEX_EDITOR_BOOTSTRAP__` is gone. Cmd/Ctrl+S, Ctrl+G, and Cmd/Ctrl+Enter
  all save-and-close (Monaco commands + document-level capture), Escape cancels.
  `postToHost` supports both WKWebView messageHandlers and wry `window.ipc`.
  Rebuilt `editor/dist/web` via `bun editor/scripts/build-editor-web.mjs`.

- Phase 2 COMPLETE: macOS host is now `GhostexEditor --daemon [--socket <path>]`
  only (one-shot mode removed), with AF_UNIX JSON-line IPC implementing ping,
  warm, open, close, status, shutdown per the pinned protocol; single-instance
  behavior; warm hidden WKWebView preloading; one NSWindow per session with
  cascading; per-session save/cancel + statusFile writes; `.accessory` policy +
  LSUIElement (no Dock icon). New files: `EditorDaemon.swift`,
  `EditorSession.swift`, `EditorWindowController.swift` beside `main.swift`.
  Verified via real socket end-to-end against the built dist bundle.

- Phase 4 COMPLETE: new `editor/desktop` Rust/wry daemon (JSON-line IPC, warm
  hidden windows, multi-session lifecycle, image paste, shutdown, platform
  socket resolution), `editor/scripts/build-editor-desktop.sh` staging
  `editor/dist/desktop/ghostex-editor` + `web/`. gpui `main.rs` resolver now
  covers macOS/Linux/Windows candidates and prewarms `<exe> --daemon` once at
  startup. Real two-window socket e2e passed on macOS wry backend;
  Linux/Windows paths compile-scoped only. gpui checks with
  `RUSTUP_TOOLCHAIN=1.95.0 cargo check`.

- Phase 3 COMPLETE: `floating-monaco-editor` is daemon-backed (auto-spawn +
  poll-connect, open/closed protocol, signal → save-close), resolver and
  socket rules are platform-aware, new `ghostex editor-daemon
  ensure|status|warm|shutdown` subcommand, best-effort daemon shutdown after
  bundle sync in `start-ghostex.mjs`, non-blocking prewarm in the macOS host
  AppDelegate. `npx vitest run scripts/ghostex-cli.test.mjs` passed 85/85;
  real e2e against the Phase 2 daemon passed (save, cancel, concurrent
  windows, ensure no-op).

- VERIFICATION PASSED (Fable verifier, 2026-07-05): every acceptance
  criterion in all four phases independently re-run and confirmed, including
  the full 16-check socket e2e against both the Swift and Rust daemons and a
  live CLI-driven window. One benign observation: a `close` sent in the
  sub-second window between `open` registration and window show means
  `opened` is never sent, so the CLI's 15s opened-timeout fires into the
  machine-editor fallback even though the save was recorded — unreachable
  through normal user flow, only relevant to automation that closes
  instantly.

---

## Phase 1: Web runtime — save keybindings, host bridge abstraction, configure-on-demand lifecycle

- depends_on: []
- parallel_ok: false
- goal: Rework the shared Monaco web bundle (used by every native host) so
  that (a) Cmd/Ctrl+S and Ctrl+G both save-and-close, (b) the page can talk to
  both WKWebView and wry hosts, and (c) the page boots warm with an empty
  editor and is configured later via a `configure` host message instead of the
  load-time `__GHOSTEX_EDITOR_BOOTSTRAP__` global.
- files: `editor/web/editor.ts`, `editor/web/index.html`,
  `editor/scripts/build-editor-web.mjs` (only if the build needs changes),
  `editor/README.md` (update the bootstrap description).
- do_not_touch: `editor/macos/**`, `scripts/ghostex-cli.mjs`, `gpui/**`,
  `native/**`, anything outside `editor/web`, `editor/scripts`,
  `editor/README.md`.
- approach:
  - Read `editor/web/editor.ts` fully first. Keep all existing behavior
    (draftUpdate debounce, image paste, buttons) unless listed below.
  - Keybindings: change the Monaco `CmdCtrl+KeyS` command from
    `{type:"save"}` to `{type:"saveAndClose"}`. Add a Monaco command for
    `KeyMod.WinCtrl | KeyCode.KeyG` posting `saveAndClose` (WinCtrl = literal
    Ctrl on macOS too — that is what the user wants; extend the local
    `MonacoApi` type with `WinCtrl` and `KeyG`). Keep `CmdCtrl+Enter` →
    `saveAndClose` and `Escape` → `cancel`.
  - Add a document-level `keydown` capture listener so the shortcuts work
    even when focus is outside the Monaco text area (e.g. on the buttons):
    (metaKey||ctrlKey)+`s` → saveAndClose (preventDefault), ctrlKey+`g` →
    saveAndClose (preventDefault), plain Escape → cancel. Guard against
    double-firing alongside the Monaco commands (posting saveAndClose twice
    is harmless at the host, but still preventDefault/stopPropagation).
  - `postToHost`: use `window.webkit?.messageHandlers?.ghostexEditorHost`
    when available, else `(window as any).ipc?.postMessage(JSON.stringify(message))`.
  - Boot lifecycle: delete the `__GHOSTEX_EDITOR_BOOTSTRAP__` handling. On
    Monaco load, create the editor with an empty markdown model, post
    `{"type":"ready"}`, and listen (via the existing
    `ghostex-editor-host-message` CustomEvent listener) for
    `{"type":"configure", ...}` per the pinned protocol: set model text and
    language (`monaco.editor.setModelLanguage` / recreate model with
    `monaco.Uri.file(filePath)` uri), set the title element, clear the undo
    stack so Cmd+Z cannot undo into emptiness (recreating the model is the
    simplest way and is acceptable), focus the editor, then post
    `{"type":"configured"}`. A second `configure` on the same page is not
    required (hosts use one webview per session) but must not crash.
  - Do not introduce React or any Ghostex app imports; the page stays
    self-contained.
- acceptance_criteria:
  - `bun editor/scripts/build-editor-web.mjs` exits 0 and regenerates
    `editor/dist/web/` including `editor/dist/web/index.html`.
  - `rg -n "WinCtrl|KeyG" editor/web/editor.ts` shows the Ctrl+G command, and
    the `CmdCtrl|KeyS` handler posts `saveAndClose` (not `save`).
  - `rg -n "__GHOSTEX_EDITOR_BOOTSTRAP__" editor/web` returns no matches.
  - `rg -n "ipc" editor/web/editor.ts` shows the wry transport branch in
    `postToHost`.
  - A `configure` handler exists that posts `configured` after applying text,
    language, title, and focus.

## Phase 2: macOS host — daemon mode, multi-window, warm window, no Dock icon

- depends_on: [1]
- parallel_ok: false
- goal: Rewrite `editor/macos` from a one-shot single-window app into the
  resident daemon defined in "Pinned daemon protocol": unix-socket JSON-line
  server, one NSWindow+WKWebView per open session (many at once), one hidden
  pre-warmed window kept ready, accessory activation policy and LSUIElement so
  it never appears in the Dock.
- files: `editor/macos/Sources/GhostexEditor/**` (split `main.swift` into
  multiple files as needed), `editor/macos/Package.swift` (only if needed),
  `editor/scripts/build-editor-app.sh` (Info.plist: add `LSUIElement` true).
- do_not_touch: `editor/web/**` (owned by Phase 1 — if the web layer is
  missing something you need, print `PHASE 2 BLOCKED: <reason>`),
  `scripts/**`, `gpui/**`, `native/**`.
- approach:
  - CLI surface of the binary: `GhostexEditor --daemon [--socket <path>]`.
    Any other invocation prints usage to stderr and exits 2 (the old one-shot
    file-argument mode is removed; Phase 3 rewrites the only caller).
  - Socket path per the pinned resolution rules (`GHOSTEX_EDITOR_SOCKET` env
    → `--socket` flag may also override → XDG_RUNTIME_DIR → ~/.ghostex).
    Implement single-instance behavior exactly as pinned.
  - Server: BSD `AF_UNIX` listener + `DispatchSourceRead` per connection (or
    `Network.framework` `NSListener` with unix path — worker's choice, no new
    package dependencies). Line-buffered JSON parsing; all AppKit work
    dispatched to the main thread. Multiple concurrent connections.
  - Session object per `open` request: owns its NSWindow, WKWebView,
    requestId, filePath, statusFile, latestDraft, and the opener connection
    reference. Keep the existing WKScriptMessageHandler messages and image
    paste handling (move them onto the per-session object). Send `configure`
    to the page via the existing `ghostex-editor-host-message` CustomEvent
    mechanism once the page has posted `ready` (for a warm window `ready` has
    already happened — send `configure` immediately).
  - Warm pool: after binding the socket, create one hidden (never
    `orderFront`ed) window whose webview has loaded `index.html` and posted
    `ready`. On `open`: if a warm window exists, configure it, then
    `makeKeyAndOrderFront` + `NSApp.activate(ignoringOtherApps: true)` after
    `configured` arrives (or immediately after sending configure — do not
    wait more than needed; showing on `configured` avoids a flash of empty
    editor). Immediately start warming a replacement window. If no warm
    window is available (burst), create one on demand and configure when
    ready. Write `started` to the statusFile when the window is shown.
  - Cascade window positions (`NSWindow.cascadeTopLeft(from:)`) instead of a
    single shared `setFrameAutosaveName`, so multiple simultaneous windows
    do not stack exactly on top of each other.
  - Window close button → save-and-close for that session only. Remove
    `applicationShouldTerminateAfterLastWindowClosed` (must return false /
    be absent). `applicationShouldTerminate` and SIGTERM/SIGINT → save all
    open sessions, then exit. `exit(0)`-style process exits must no longer
    happen when an individual session finishes.
  - Dock hiding: `NSApp.setActivationPolicy(.accessory)` in
    `applicationDidFinishLaunching`, and add `<key>LSUIElement</key><true/>`
    to the Info.plist heredoc in `editor/scripts/build-editor-app.sh`.
  - Session end semantics exactly per the pinned protocol (atomic file
    write, statusFile, `closed` event to the opener connection if still
    connected, window teardown including
    `removeScriptMessageHandler`/webview cleanup).
  - Implement `ping`, `warm`, `close`, `status`, `shutdown` per protocol.
  - No test files (repo rule). Verify by running the real daemon.
- acceptance_criteria:
  - `bash editor/scripts/build-editor-app.sh` exits 0.
  - `plutil -p editor/dist/GhostexEditor.app/Contents/Info.plist | grep LSUIElement`
    shows 1/true.
  - Scripted end-to-end (run it, do not just claim it): start
    `editor/dist/GhostexEditor.app/Contents/MacOS/GhostexEditor --daemon --socket /tmp/gx-ed-test.sock`
    in the background; with a small python3 socket script: (a) `ping` returns
    `pong` with `warm` true within ~5s of startup; (b) send `open` for a temp
    file `A.md` containing `hello` with a temp statusFile → receive `opened`,
    statusFile becomes `started`, a visible editor window appears; (c) send a
    second `open` for `B.md` on a second connection → two sessions in
    `status`; (d) `close` requestId A with action `save` → opener connection
    receives `closed` `saved`, statusFile A reads `saved`; (e) `close` B with
    `cancel` → `closed` `cancelled`, statusFile B reads `cancelled`, daemon
    still alive (`ping` works, openCount 0); (f) `shutdown` → process exits.
  - While the daemon is running with a visible window: `lsappinfo info -only
    ApplicationType $(lsappinfo find bundleid=com.madda.ghostex.host.editor)`
    (or equivalent check) shows it is not a regular Dock app — acceptable
    alternative proof: code sets `.accessory` and Info.plist has LSUIElement.
  - `rg -n "setActivationPolicy\(.accessory\)" editor/macos/Sources` matches.

## Phase 3: CLI daemon client, `editor-daemon` command, prewarm at app startup

- depends_on: [2]
- parallel_ok: true   # disjoint files from Phase 4; may run alongside Phase 4
- goal: Point `ghostex floating-monaco-editor` at the daemon (spawn it if not
  running), add a `ghostex editor-daemon <ensure|status|warm|shutdown>`
  subcommand, make executable+socket resolution platform-aware
  (macOS/Linux/Windows), refresh stale daemons when `start-ghostex.mjs`
  installs a new bundle, and pre-warm the daemon when the macOS host app
  starts so the first Ctrl+G is instant.
- files: `scripts/ghostex-cli.mjs`, `scripts/ghostex-cli.test.mjs` (update
  existing expectations only), `scripts/start-ghostex.mjs`,
  `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift` (plus at
  most one small new helper file in that same ghostexHost Sources tree).
- do_not_touch: `editor/**`, `gpui/**` (Phase 4 owns gpui), `native/sidebar/**`
  (has unrelated uncommitted user work).
- approach:
  - In `scripts/ghostex-cli.mjs` (~line 3400, `floatingMonacoEditorCommand`):
    keep the request breadcrumb logging and the machine-editor fallback on
    total failure, but replace the spawn-and-wait with: resolve socket path
    (pinned rules; reuse one helper), try `net.connect` on the unix socket
    (`\\.\pipe\...` on win32 also works with `net.connect`); if no daemon,
    resolve the editor executable (existing `resolveGhostexEditorExecutable`,
    made platform-aware per the pinned candidates below) and spawn it
    detached (`spawn(exe, ["--daemon"], {detached:true, stdio:"ignore"})`,
    `unref()`), then poll-connect for up to ~5s. Send `open` per the pinned
    protocol with a fresh requestId and the existing statusFile, wait for
    `opened` then `closed`. Exit code 0 iff status `saved`. On CLI
    SIGINT/SIGTERM send `{"type":"close","action":"save"}` (matches the old
    force-save-on-signal behavior). If the socket dies before `closed`,
    read the statusFile to determine the outcome (existing crash-safety
    semantics, keep the timeline logging events roughly intact).
  - Platform-aware executable candidates (must match the gpui mirror Phase 4
    implements):
    - darwin (existing, unchanged): env `GHOSTEX_EDITOR_APP` →
      `~/Applications/GhostexEditor.app` → `/Applications/GhostexEditor.app`
      → repo `editor/dist/GhostexEditor.app` (each → `Contents/MacOS/GhostexEditor`).
    - linux: env `GHOSTEX_EDITOR_APP` (binary path) →
      `~/.local/bin/ghostex-editor` → `/usr/local/bin/ghostex-editor` → repo
      `editor/dist/desktop/ghostex-editor`.
    - win32: env `GHOSTEX_EDITOR_APP` →
      `%LOCALAPPDATA%\\Ghostex\\GhostexEditor\\GhostexEditor.exe` → repo
      `editor\\dist\\desktop\\GhostexEditor.exe`.
  - New subcommand `ghostex editor-daemon <ensure|status|warm|shutdown>`:
    `ensure` = connect-or-spawn then send `warm`, print a one-line result;
    `status`/`warm`/`shutdown` = send the corresponding request and print the
    reply JSON; all exit 0 on success. Non-fatal (exit 0 with a stderr note)
    when the editor app is not installed — startup prewarm must never break
    app launch.
  - `scripts/start-ghostex.mjs`: in `syncInstalledGhostexEditorAppBundle()`
    (~line 695), after a successful sync, best-effort send `shutdown` to a
    running daemon (direct socket write or via the CLI) so the next Ctrl+G
    or prewarm starts the freshly installed binary. Never fail the start
    flow because of this.
  - Prewarm from the macOS host app: in
    `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift`
    `applicationDidFinishLaunching`, spawn the editor daemon detached and
    non-blocking: resolve the executable with the same candidate order as
    the CLI (env → ~/Applications → /Applications; skip the repo-dist
    candidate unless an existing dev-mode hint in the host makes the repo
    root known), then `Process` launch `<exe> --daemon` with a `warm`
    request after connect, or simplest: launch `<exe> --daemon` (the daemon
    warms itself and exits instantly if one is already running — that is the
    designed single-instance behavior, so just launching it is enough).
    Failure to find the app is silently ignored (log breadcrumb only). Do
    not block or delay app startup.
  - Keep `selectPromptEditorCommand` behavior (capability gating) unchanged
    apart from resolution being platform-aware.
  - If `scripts/ghostex-cli.test.mjs` covers the old spawn flow, update those
    tests to the daemon flow (tests here are allowed); run them.
- acceptance_criteria:
  - `node --check scripts/ghostex-cli.mjs` and `node --check scripts/start-ghostex.mjs` exit 0.
  - `bun scripts/ghostex-cli.test.mjs` (or however that test file is run
    today — check its header) passes.
  - Scripted end-to-end against the real Phase 2 daemon (run it): with
    `GHOSTEX_EDITOR_SOCKET=/tmp/gx-ed-cli-test.sock` and no daemon running,
    run `echo draft > /tmp/gx-prompt.md && GHOSTEX_EDITOR_SOCKET=/tmp/gx-ed-cli-test.sock ghostex floating-monaco-editor /tmp/gx-prompt.md`
    (via `scripts/ghostex-cli.mjs`) in the background → daemon auto-spawns,
    window appears; then `ghostex editor-daemon status` shows 1 session;
    send `close` `save` via `editor-daemon`-style socket script → CLI exits 0.
    Repeat with `cancel` → CLI exits 1.
  - Two concurrent `floating-monaco-editor` invocations on different files
    both get windows and resolve independently with correct exit codes.
  - `ghostex editor-daemon ensure` with no daemon running starts one and
    reports warm; running it again is a no-op (single instance).
  - `swift build --package-path native/macos/ghostexHost` (or the tree's
    normal build command, e.g. `bash native/macos/ghostexHost/build-ghostex-host.sh`
    if that is how it is compiled) succeeds with the AppDelegate change.
  - `rg -n "editor-daemon|editorDaemon" scripts/ghostex-cli.mjs` shows the new
    subcommand wired into the CLI dispatch table.

## Phase 4: Linux/Windows host (Rust + wry: WebKitGTK / WebView2), gpui mirror + prewarm

- depends_on: [1, 2]
- parallel_ok: true   # disjoint files from Phase 3; may run alongside Phase 3
- goal: New Rust crate `editor/desktop` producing a `ghostex-editor` binary
  that implements the exact same daemon protocol and window lifecycle as the
  macOS host, rendering `editor/dist/web` through the OS webview via `wry`
  (WebKitGTK on Linux, WebView2 on Windows; wry's WKWebView backend makes it
  runnable on macOS for local verification only — macOS production stays on
  the Swift app). Also update the gpui app's Rust resolution mirror to be
  platform-aware and make gpui pre-warm the daemon at startup.
- files: `editor/desktop/**` (new), `editor/scripts/build-editor-desktop.sh`
  (new), `editor/README.md` (append a Linux/Windows section), `gpui/src/main.rs`
  (only the GhostexEditor resolution/advertise block around line 64726 and a
  startup prewarm hook), `gpui/Cargo.toml` only if strictly needed (avoid).
- do_not_touch: `editor/macos/**`, `editor/web/**` (owned by Phase 1 — if the
  web bridge is missing something, print `PHASE 4 BLOCKED: <reason>`),
  `scripts/**` (Phase 3 owns them and runs concurrently), `native/**`.
- approach:
  - Crate: `editor/desktop/Cargo.toml`, package name `ghostex-editor`,
    binary `ghostex-editor`. Dependencies: `tao`, `wry`, `serde`,
    `serde_json`; for IPC use unix domain sockets via `std::os::unix::net`
    on unix and a named-pipe (or `AF_UNIX`-equivalent) implementation on
    Windows — the `interprocess` crate's local sockets are the recommended
    single abstraction; choose it unless there is a concrete blocker. Pin
    versions compatible with the repo toolchain (`rustc --version`).
  - CLI surface identical to the Swift host: `ghostex-editor --daemon
    [--socket <path>]`, otherwise usage+exit 2. Socket path resolution and
    single-instance behavior exactly per the pinned protocol (including the
    Windows named-pipe name rule).
  - Architecture: tao `EventLoop` on the main thread with a
    `EventLoopProxy<DaemonEvent>` custom-event channel; socket accept loop on
    a background thread sends parsed requests through the proxy; replies go
    back through per-connection writer handles (e.g. `Arc<Mutex<Write>>`).
    One tao `Window` + `wry::WebView` per session, plus one warm hidden
    window (created `with_visible(false)`, shown on configure). Web root:
    `GHOSTEX_EDITOR_WEB_ROOT` env override, else a `web/` directory next to
    the executable; load `index.html` via a custom file protocol or
    `WebViewBuilder::with_url("file://...")` — whichever lets Monaco's AMD
    loader fetch its assets on all three backends (wry's
    `with_custom_protocol` is the reliable cross-platform choice; use it).
  - Web→host messages arrive via `WebViewBuilder::with_ipc_handler` (the page
    posts JSON strings through `window.ipc.postMessage` — Phase 1 added that
    branch). Host→web (`configure`, `imagePasteResult`) via
    `webview.evaluate_script` dispatching the `ghostex-editor-host-message`
    CustomEvent, exactly like the Swift host does.
  - Implement the full session lifecycle from the pinned protocol: statusFile
    writes (`started`/`saved`/`cancelled`), atomic draft save (write temp +
    rename), image paste (same directory scheme as the Swift host:
    `ghostex-editor-images` beside the draft, UUID-prefixed sanitized names),
    close-button = save-and-close, SIGTERM/SIGINT = save-all-and-exit
    (`ctrlc`-style handling; on Windows a console handler is unnecessary —
    best effort), never exit on last-window-closed, `shutdown` semantics.
  - Taskbar/Dock hygiene: `with_skip_taskbar(true)` on Windows and Linux
    builds (tao supports it on those platforms; keep windows normal
    otherwise). On macOS builds set tao's `ActivationPolicy::Accessory`
    (dev/test parity only).
  - `editor/scripts/build-editor-desktop.sh`: build the web bundle
    (`bun editor/scripts/build-editor-web.mjs`), `cargo build --release
    --manifest-path editor/desktop/Cargo.toml`, then stage
    `editor/dist/desktop/ghostex-editor` (or `GhostexEditor.exe` naming on
    Windows) with `editor/dist/desktop/web/` beside it. The script runs on
    the current host OS only; no cross-compilation.
  - Keep platform-specific code behind `#[cfg(...)]` and small: the daemon
    core, protocol, and session logic must be platform-independent so that
    verifying on macOS meaningfully covers Linux/Windows behavior. Where
    Linux/Windows-only APIs are used, keep them isolated in one module.
  - gpui `src/main.rs` (~64726 `GHOSTEX_EDITOR_APP` block): extend the
    resolver so non-macOS targets use the pinned Linux/Windows candidate
    paths (matching Phase 3's JS list exactly), and add a startup prewarm:
    once at app launch (find where gpui finishes initializing its app state
    — a `cx.spawn`/background executor hook near startup is fine), if an
    editor executable resolves, spawn `<exe> --daemon` detached and ignore
    all errors. Do not add tests (repo rule) and touch nothing else in gpui.
- acceptance_criteria:
  - `cargo build --release --manifest-path editor/desktop/Cargo.toml` exits 0
    on this macOS machine.
  - `bash editor/scripts/build-editor-desktop.sh` exits 0 and stages
    `editor/dist/desktop/ghostex-editor` + `editor/dist/desktop/web/index.html`.
  - Scripted end-to-end on macOS via wry (run it): start
    `editor/dist/desktop/ghostex-editor --daemon --socket /tmp/gx-ed-rs-test.sock`;
    the same python3 socket script sequence as Phase 2's criterion (ping/warm,
    open two files, status shows 2, close save + close cancel, statusFiles
    correct, daemon survives, shutdown exits) passes against the Rust host.
  - `rg -n "skip_taskbar|ActivationPolicy" editor/desktop/src` shows the
    Windows/Linux taskbar hiding and macOS accessory policy, each behind the
    right `cfg`.
  - `rg -n "target_os" editor/desktop/src` shows Linux/Windows code paths
    exist and are isolated (compile-verified only for the macOS backend on
    this machine — state this honestly in the completion summary).
  - `cargo check` (gpui): the gpui crate still compiles —
    `cargo check --manifest-path gpui/Cargo.toml` (or the tree's standard
    check command) exits 0 with the resolver + prewarm change.
