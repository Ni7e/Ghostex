# Handover: ghostex-mobile unified app (2026-07-20)

## Mission (user's words, condensed)

Replace the two mobile apps (VVTerm-fork iOS at `iOS/`, Termux-fork Android at `android/`) with ONE React Native (Expo) app sharing as much as possible. Only the terminal + SSH stay native per platform. Requirements: terminal screen UI from the VVTerm iOS fork (both platforms), sessions list UI from the Android fork (both platforms), VVTerm first-machine onboarding, Android app's defaults, preserve pinch-zoom / scrolling / file-attach-and-send / 2-row key bar exactly as iOS has them. New git repo `ghostex-mobile`, submodule at `mobile/`. Expo required. User is away — keep going autonomously. Latest instruction: "qaa" → QA pass (in progress, see §5).

## Current state: DONE and pushed

- Repo: `github.com/maddada/ghostex-mobile` (private), submodule at `mobile/` (registered + pointer bumped in parent). All work INCLUDING the QA-phase scene-lifecycle fix is committed and pushed through mobile commit `9e569db` on main. Nothing is uncommitted in `mobile/` except whatever QA work you add next.
- Expo SDK 57 / RN 0.86 / New Architecture / TypeScript. GPL-3.0.
- `bunx tsc --noEmit` clean. iOS `xcodebuild` Debug **arm64 simulator** BUILD SUCCEEDED. Android `:app:assembleDebug` BUILD SUCCESSFUL (APK at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`).

### Architecture (authoritative docs IN THE REPO — read these first)
- `mobile/docs/ARCHITECTURE.md` — layout + the 16-function native contract (`modules/ghostex-native/src/GhostexNativeModule.ts` + `GhostexNative.types.ts`). PTY bytes never cross the JS bridge.
- `mobile/docs/specs/terminal-screen.md`, `onboarding.md`, `sessions-drawer.md` — implementation-grade UI specs extracted verbatim from both forks (copy, sizes, colors, behaviors). The screens were built from these.
- Shared TS in `mobile/src/` (screens, contract parser + grouping ported from Android Java semantics, machines/settings stores, ghostex CLI builders, inventory 5s polling, warm-session LRU max 7, secure credentials).
- Native: `mobile/modules/ghostex-native/ios` (ported VVTerm GhosttyTerminal wrapper + libssh2 actor; Vendor has GhosttyKit.xcframework with macOS slice stripped) and `.../android` (vendored Termux terminal-emulator/-view byte-identical, SSHJ transport, ExternalTerminalProcess seam, NO JNI).
- Server contract unchanged: `"$SHELL" -lc 'ghostex sessions --json --mobile-summary'` + `ghostex attach` over SSH. No Mac-side changes needed.

## Build gotchas already solved (don't re-fight these)

1. `ios/` + `android/` are **gitignored (CNG)** — regenerate with `bunx expo prebuild`. All fixes live in config plugins under `mobile/plugins/`.
2. `plugins/withPodfileMinDeploymentTarget.js` — clamps pod IPHONEOS_DEPLOYMENT_TARGET to 15.0 (new Xcode rejects 12.4/13.4 resource bundles).
3. Podspec pitfalls (all fixed in `modules/ghostex-native/ios/GhostexNative.podspec`): `exclude_files` globs apply to vendored_frameworks too; SDK-conditional xcconfig keys REPLACE unconditional values (need `$(inherited)`); xcframework slices must share one binary name (macOS slice was stripped from GhosttyKit).
4. iOS simulator builds need `ARCHS=arm64` (no x86_64 slices in GhosttyKit or Expo prebuilt pods).
5. `mobile/bunfig.toml` relaxes bun's global 10-day minimum-release-age (fresh Expo point releases).
6. Android gradle downloads from dl.google.com flake under the sandbox ("Tag mismatch", "No route to host") — just retry; cache converges.
7. **iOS 27 beta SDK requires UIScene adoption** — apps trap at launch (`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, EXC_BREAKPOINT). Fixed by `plugins/withSceneLifecycle.js` (committed): injects SceneDelegate.swift, patches AppDelegate (cachedLaunchOptions, no window creation), adds UIApplicationSceneManifest. After this the app launches into the Expo dev launcher. RN 0.86/Expo 57 ship NO scene support of their own — the plugin's AppDelegate regex must be re-checked whenever Expo's template changes.

## QA environment facts (macOS 27 beta, this machine)

- No `Simulator.app` — Xcode-beta ships **DeviceHub.app** (`/Applications/Xcode-beta.app/Contents/Applications/DeviceHub.app`). `simctl` works headless as usual. Booted device: iPhone 17 Pro, udid `4AE9AC50-17CB-471A-9AF8-452B24A137C1`.
- App installed via `xcrun simctl install <udid> ~/Library/Developer/Xcode/DerivedData/Ghostex-*/Build/Products/Debug-iphonesimulator/Ghostex.app`; launch via `xcrun simctl launch <udid> io.ghostex.mobile`; screenshots via `xcrun simctl io <udid> screenshot <path>`.
- Metro dev server IS running: `bunx expo start --port 8081` from `mobile/` (verify `curl localhost:8081/status` → `packager-status:running`). Crash logs land in `~/Library/Logs/DiagnosticReports/Ghostex-*.ips`.
- Driving the sim: DeviceHub window (pid changes; find via cua-driver `list_windows`, title "iPhone 17 Pro"). iOS UI is NOT in the host AX tree — **pixel clicks only** against the DeviceHub window screenshot. Click reliability is POOR from background CGEvents: one click (dialog) landed, later clicks did not. Not yet tried: `delivery_mode: "foreground"` on cua-driver clicks (likely fix), `debug_image_out` to verify the coordinate mapping, or `xcrun simctl ui` / hardware-keyboard typing via DeviceHub "Capture Keyboard".

## Where QA stopped (task #9 in progress)

App state right now: launches cleanly into **Expo dev launcher** ("Ghostex Development Build"), stuck at "Searching for development servers…" — it does not auto-discover Metro on localhost:8081, and `simctl openurl` with `ghostex://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081` was consumed without loading the bundle (dialog may have appeared and been lost; later opens showed no dialog and no effect). Background pixel-click on "Enter URL manually" (≈ x855 y375 in a 1568×1140 window grab) did not land.

### Next steps (in order)

1. Get the JS bundle loading. Options, easiest first:
   a. cua-driver click with `delivery_mode: "foreground"` on "Enter URL manually", then type `http://localhost:8081` (DeviceHub Device menu → Keyboard → Capture Keyboard, or type_text targeting DeviceHub) and connect.
   b. Investigate why the deep link no-ops: `xcrun simctl launch --console-pty` to see dev-launcher logs, or `log stream` in the sim for EXDevLauncher.
   c. Fallback: build a release-ish bundle so no Metro is needed: `bunx expo export:embed` … or simplest, `bunx expo run:ios --configuration Release` (embeds the bundle; no dev launcher).
2. Once the app UI loads, walk the flows against the specs: Welcome → Continue → Sessions empty-state ("Add your Mac" card) → Machines → Add machine form → (optionally: SSH to this Mac itself if Remote Login is enabled — the Mac runs the ghostex CLI, so the full sessions list + attach + Ghostty terminal can be tested end-to-end against localhost/Tailscale) → terminal screen: key bar, tabs, pinch zoom (send two-finger pinch via DeviceHub), file attach.
3. Fix what breaks (expect first-run JS issues: event subscription shapes, NativeModule name mismatches, `requireNativeView('GhostexNative', 'GhostexTerminalView')` registration name vs the Swift `View()` definition name — check `modules/ghostex-native/ios/GhostexNativeModule.swift` if the view doesn't resolve).
4. Commit the QA fixes in `mobile/` (scene plugin + app.json + anything new), push, bump the parent submodule pointer (commit ONLY `.gitmodules`/`mobile` paths — parent repo has other agents' uncommitted work; never `git add -A` in the parent).
5. Android runtime QA blocked: no emulator AVDs on this machine (`emulator` not on PATH). Either create one via avdmanager, or hand the APK to the user's device. Compile-verified only so far.

## Task list state

Tasks #1–#8 completed (scaffold, TS core, onboarding, sessions UI, terminal UI, iOS native, Android native, build verification). Task #9 (simulator QA) in_progress — everything in §5.

## Known gaps (deliberate, user-approved scope)

Settings subset only; no Files/Stats tabs, mosh/Cloudflare, notifications/foreground service, iCloud, voice; app icons are Expo defaults; iOS `generateSshKey` ignores passphrase (donor VVTerm behavior — Android supports it); zmx-refresh OSC is one-shot per session key and not re-sent after in-screen reconnect (`src/terminal/sessions.ts`); "copy to clipboard" actions show selectable-text dialogs (expo-clipboard not installed).

## Memory

Project memory exists: `~/.claude/projects/-Users-madda-dev--active-Ghostex/memory/ghostex-mobile-unified-app.md` — update it if QA changes any conclusions.
