> Archived implementation history. The retired Termux-fork app now lives at
> `/Users/madda/dev/_active/ghostex-deprecated/android/`. Active mobile work
> and releases use the React Native Android app in `mobile/`.

<!--
CDXC:AndroidRemoteSessions 2026-05-17-09:55:
This document records the Android requirements from the first Ghostex Android planning prompt so later Android and iOS work can share the same product contract.

CDXC:AndroidConnectionManagement 2026-05-17-10:13:
Ghostex Android must manage multiple saved SSH machines from Settings, auto-reconnect to the last selected machine on app reopen, and provide a complete first-run setup tutorial before the user reaches the terminal overlay.

CDXC:AndroidConnectionManagement 2026-05-17-14:12:
Saved-machine settings must behave like a multi-machine account manager: adding a new machine or editing the active machine may connect immediately, but editing a different saved machine must not change the selected SSH account until the user explicitly taps Connect.

CDXC:AndroidConnectionManagement 2026-05-17-10:37:
The failed-connection machine dropdown must be a recovery control, not just a selector: it lists saved machines and offers add-new-machine from the same surface, while saved-password machines require secure password storage before they are accepted.

CDXC:AndroidSidebar 2026-05-17-10:43:
The Android sidebar must preserve project/group rows from the macOS sidebar, expose project and session long-press menus, and avoid launcher shortcuts that reintroduce ordinary local Termux session workflows.

CDXC:AndroidOnboarding 2026-05-17-10:51:
Ghostex Android must make connection setup actionable in-app: the drawer should expose a Setup action, reconnect should use the app-owned SSHJ transport, and the tutorial should point users to Tailscale, saved-machine, and host-key repair flows.

CDXC:AndroidConnectionSecurity 2026-05-17-11:17:
An SSH password entered with Save password unchecked is still valid for the current app process, but must remain session-only and must not be written to normal settings, files, logs, command arguments, or docs.

CDXC:AndroidConnectionManagement 2026-05-17-11:17:
Reopening Ghostex Android from the background should refresh the last selected machine, with throttling so normal activity resumes do not spam SSH or disrupt the active terminal.

CDXC:AndroidBranding 2026-05-17-11:38:
A released Ghostex Android package must not use a package id that disagrees with the Termux bootstrap prefix.

CDXC:AndroidSideBySideInstall 2026-05-17-23:39:
Ghostex Android must install beside upstream Termux. The current side-by-side id is `io.ghostex`, and the build must generate bootstrap archives patched to `/data/data/io.ghostex/files/usr` before packaging. A longer package id remains blocked until Ghostex has rebuilt bootstrap/package artifacts for that prefix.

CDXC:AndroidOnboarding 2026-05-17-11:55:
The first-run tutorial and saved-machine settings should use Ghostex-styled, scrollable product panels with setup step cards and machine action cards, not raw list dialogs.

CDXC:AndroidConnectionSecurity 2026-05-17-12:06:
The add/edit machine and password recovery forms should use the same Ghostex-styled panels and field treatments while preserving Keystore-only saved passwords and process-only unsaved passwords.

CDXC:AndroidConnectionManagement 2026-05-17-13:02:
The drawer must show visible state cards for setup, connecting, failed reconnect, and empty-session cases so the machine dropdown and recovery actions are not paired with an unexplained blank session list.

CDXC:AndroidOnboarding 2026-05-17-13:25:
The Setup flow should be a Ghostex-styled panel with built-in SSHJ transport status, host-key repair, machine management, Tailscale, and tutorial actions instead of a raw Android action list.

CDXC:AndroidSidebar 2026-05-17-13:48:
Long-press sidebar actions should use Ghostex-styled action sheets with short descriptions and destructive-action styling, because these menus replace macOS hover controls on Android.

CDXC:AndroidRemoteSessions 2026-05-17-14:09:
Android attach and context-menu commands must target the Ghostex CLI by stable session id, while aliases remain display labels only.

CDXC:AndroidSidebar 2026-05-17-14:34:
Android session context menus should include focus and rename because those are core macOS sidebar session actions and the Ghostex CLI exposes stable remote commands for them.

CDXC:AndroidSidebar 2026-05-17-14:58:
Destructive confirmations and details panels should use the same Ghostex-styled surface as Android action sheets so sidebar workflows never fall back to raw Android message dialogs.

CDXC:AndroidSidebar 2026-05-17-17:40:
All drawer-driven Android dialogs, including onboarding, machine settings, setup, action sheets, details, confirmations, rename, and password prompts, should use a shared Ghostex dark dialog style instead of raw platform `AlertDialog.show()` surfaces.

CDXC:AndroidSidebar 2026-05-17-17:44:
Drawer-driven Android dialogs should render titles inside the Ghostex-styled content panel, not through platform `AlertDialog` title chrome, so onboarding, settings, context menus, details, confirmations, and credential prompts do not show a mismatched native title band.

CDXC:AndroidSidebar 2026-05-17-17:47:
In-content Ghostex dialog and panel titles must be marked as accessibility headings so screen-reader navigation preserves structure after removing platform `AlertDialog` title chrome.

CDXC:AndroidOnboarding 2026-05-17-16:05:
First-run tutorial completion must lead directly into SSH machine setup when no saved machine exists. The setup page is educational, but the initial app path still has to ask for the Mac host and credential details before the user can meaningfully use the drawer.

CDXC:AndroidReleaseSurface 2026-05-17-16:42:
The released app should not expose generic Termux file receivers, document providers, IoT launchers, or external run-command APIs. Ghostex Android should keep those upstream components available for future syncs but disabled at the manifest boundary unless a Ghostex workflow explicitly needs them.

CDXC:AndroidRemoteSessions 2026-05-17-17:05:
Ghostex Android startup should not create an ordinary local Termux shell. Local terminal sessions are allowed only when they are intentionally created by Ghostex flows such as phone setup or SSH attach to a remote ZMX session.

CDXC:AndroidRemoteSessions 2026-05-17-17:34:
The last-seven warm session pool must be scoped to both saved machine and Ghostex session id. Multi-machine support should never reuse a terminal attached to a different Mac, and deleting a machine should close its warm attach surfaces.

CDXC:AndroidRemoteSessions 2026-05-17-17:55:
When a remote kill or sleep action succeeds, Android must evict the matching warm attach terminal surfaces. These actions change the ZMX lifecycle on the Mac, so quick switching must not return the user to a stale SSH attach surface.

CDXC:AndroidConnectionSecurity 2026-05-17-18:31:
Saved or session-only SSH passwords may be used only inside the app-owned SSHJ transport, and diagnostic logging must never write password values.

CDXC:AndroidRemoteSessions 2026-05-17-18:24:
Non-interactive reconnect, session inventory, remote actions, and setup checks must run through the app-owned SSHJ transport and the Mac login shell, with host-key state stored in Ghostex Android's app-owned SSHJ verifier.

CDXC:AndroidConnectionManagement 2026-05-17-18:46:
Saved-machine forms must reject malformed SSH targets in the editor, including user@host entered into the host field, whitespace/control characters, option-like leading dashes, and invalid ports.

CDXC:AndroidConnectionSecurity 2026-05-17-14:15:
Persisted saved-machine ports must be validated on load. Missing ports can remain backward-compatible as SSH port 22, but invalid stored ports must reject the machine record instead of silently reconnecting to port 22.

CDXC:AndroidConnectionSecurity 2026-05-17-14:57:
Saved-machine storage must reject invalid machine ids and self-heal malformed persisted machine JSON so automatic reconnect cannot reuse corrupt SSH targets, credential keys, or last-selected state.

CDXC:AndroidConnectionManagement 2026-05-17-14:16:
Saved-machine labels, details, copy actions, and SSH commands must use bracketed IPv6 host formatting so custom ports and Tailscale IPv6 literals remain unambiguous.

CDXC:AndroidConnectionManagement 2026-05-17-14:18:
The Open Tailscale action must work on Android 11+ by declaring a narrow Tailscale package visibility query, while avoiding broad package-query permissions.

CDXC:AndroidConnectionRecovery 2026-05-17-14:20:
Reset SSH host key must clear the app-owned SSHJ fingerprint stored for the selected saved machine target.

CDXC:AndroidReleaseSurface 2026-05-17-19:08:
The release manifest must request only permissions needed by the Ghostex remote-session workflow. Stock Termux storage, package-install, overlay, boot, usage-stats, log, dump, alarm, and secure-settings permissions should stay absent unless a Ghostex feature explicitly requires them.

CDXC:AndroidReleaseSurface 2026-05-17-17:00:
Release builds should target API 35 or newer for current Google Play submission compatibility. Android 13+ notification permission and Android 14+ foreground-service type requirements must be handled explicitly, including a reviewer-readable special-use foreground-service subtype for the remote terminal service.

CDXC:AndroidReleaseSurface 2026-05-17-20:24:
Because Android 15 makes target API 35 apps edge-to-edge by default, the Ghostex Android release surface must apply system-bar and display-cutout insets so the drawer, terminal rows, and floating keyboard button remain visible and touchable.

CDXC:AndroidReleaseSurface 2026-05-17-17:32:
Because Ghostex Android disables stock Termux plugin and utility entry points, modern Android releases must cap the retained legacy shared UID with `sharedUserMaxSdkVersion=32`; compatibility for older installs can remain, but new Android 13+ installs should not join deprecated shared-user behavior.

CDXC:AndroidReleaseSurface 2026-05-17-17:00:
The release manifest should not request Android's battery-optimization exemption permission while Ghostex Android only exposes a foreground service and explicit Keep awake notification action.

CDXC:AndroidReleaseSurface 2026-05-17-20:09:
The Keep awake notification action must not open Android's battery-optimization exemption flow; it may acquire the explicit wake/Wi-Fi locks but broad exemption consent needs a separate Ghostex UX before returning.

CDXC:AndroidReleaseSurface 2026-05-17-19:43:
The released APK must not declare the stock Termux RUN_COMMAND permission/action or static boot-completed receiver path. Ghostex Android should expose remote sessions only through its own UI.

CDXC:AndroidReleaseSurface 2026-05-17-19:58:
Dynamic receivers registered for Ghostex/Termux app-private activity broadcasts must declare `RECEIVER_NOT_EXPORTED` so target API 35 release lint passes and those actions do not become an external app API.

CDXC:AndroidReleaseSurface 2026-05-17-20:01:
Internal broadcasts sent to those non-exported activity receivers must be package-scoped before `sendBroadcast`, avoiding unsafe implicit broadcast delivery on modern Android.

CDXC:AndroidReleaseE2E 2026-05-17-16:30:
Before a release can be considered complete, a real Android device or emulator must run the Ghostex Android E2E harness against a real Tailscale-reachable macOS Ghostex/zmx host, proving SSH readiness, live ZMX inventory parsing, stable-id attach command construction, and stable-session-id remote actions from the Android runtime.

CDXC:AndroidReleaseE2E 2026-05-17-17:35:
The release E2E and first-run UI smoke harnesses must discover `adb` from PATH, `GHOSTEX_ANDROID_ADB`, Android SDK environment variables, or common platform-tools locations so release QA is not blocked by a shell that can build Android but has not exported platform-tools.

CDXC:AndroidReleaseE2E 2026-05-17-17:35:
Those same release harnesses must fail before install/data-clear work when no Android device is attached, with an actionable message and `adb devices -l` output.

CDXC:AndroidReleaseE2E 2026-05-17-18:24:
The first-run UI smoke harness must require explicit confirmation before clearing Ghostex Android data on a selected device.

CDXC:AndroidReleaseE2E 2026-05-17-19:34:
Because the live E2E harness uninstalls Ghostex Android before debug instrumentation, it must prepare the fresh app runtime itself: launch the app, add a saved machine, and verify phone-to-Mac SSHJ checks without requiring phone-side package installation.

CDXC:AndroidReleaseE2E 2026-05-17-19:26:
Release-facing Android README instructions must stay aligned with the actual harnesses: final UI smoke exercises the selected release candidate or explicit signed APK, debug APKs are development-only for UI smoke, and both UI smoke and live E2E document package uninstall/data-clear confirmation before they touch a connected device.

CDXC:AndroidReleaseE2E 2026-05-17-20:21:
Release-candidate CI summaries are release runbooks. The live E2E command shown after artifact upload must include `GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1` because the harness intentionally refuses to uninstall/clear Android packages without that disposable-device confirmation.

CDXC:AndroidReleaseE2E 2026-05-17-18:39:
The live Android E2E harness may accept `GHOSTEX_ANDROID_PASSWORD` from the release QA shell, but it must not forward that password as a Gradle or instrumentation command-line argument, stage it through host temp files, or stage it through shared device temp storage. Stream it into debug app private storage, read it from the instrumentation test, and clean staged files after the run.

CDXC:AndroidReleaseE2E 2026-05-17-18:52:
After the live Android E2E instrumentation test first reads the private staged SSH password, it must delete that file immediately, including read-failure paths, and keep the password only in the running test process so device-side cleanup is not dependent only on the host harness trap.

CDXC:AndroidReleaseE2E 2026-05-17-18:36:
Release validation should have a top-level runner that checks the Mac-side `ghostex android-check --json` contract, root CLI tests, Android release gates, release lint, APK/AAB build, connected-device E2E, and first-run UI smoke from one documented command.

CDXC:AndroidReleaseE2E 2026-05-17-18:31:
The default top-level release runner must be final-release strict and require connected-device E2E plus first-run UI smoke. Local source/build validation may exist as an explicit `--local` mode, but it must be clearly labeled as not final release proof.

CDXC:AndroidReleaseSurface 2026-05-17-19:26:
The strict top-level release runner must preflight required final-release environment before long checks run: publish signing opt-in and credentials, live SSH target host/user, and `GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1` for disposable-device E2E/UI smoke.

CDXC:AndroidReleaseSurface 2026-05-17-21:03:
The strict top-level release runner must verify the generated release APK signatures with Android build-tools `apksigner` and the generated release AAB signature with `jarsigner` before connected-device QA starts. Local `--local` validation may remain unsigned and must not require those signature checks.

CDXC:AndroidReleaseSurface 2026-05-17-21:14:
Signed release-candidate CI must run the same Android-side APK/AAB signature verification helper as the strict top-level runner and upload that helper with the device QA harnesses. Signature evidence should not depend only on Gradle task success.

CDXC:AndroidReleaseSurface 2026-05-17-21:25:
The Android release signature helper must run on both macOS release machines and Linux CI. Android build-tools discovery and artifact collection must avoid GNU-only shell features such as `sort -V` and Bash 4-only helpers such as `mapfile`.

CDXC:AndroidReleaseSurface 2026-05-17-21:31:
The Android release signature helper must treat `jarsigner` output as evidence for AAB signatures, not just its exit code. Unsigned AAB output such as `jar is unsigned.` must fail strict release proof, and signed output must include `jar verified.`.

CDXC:AndroidOnboarding 2026-05-17-16:59:
Release QA should also have a repeatable device UI smoke script that verifies a fresh install opens the required scrollable first-run tutorial and routes Done into Add Machine before a live Mac is available.

CDXC:AndroidBranding 2026-05-17-16:37:
Release store metadata must describe Ghostex Android as a Tailscale SSH client for Mac-hosted Ghostex CLI and ZMX sessions, and must not ship stock Termux terminal-emulator copy.

CDXC:AndroidBranding 2026-05-17-16:38:
The Android submodule README and docs landing page must present Ghostex Android as the shipped app, while keeping Termux only as upstream lineage and implementation context for syncability.

CDXC:AndroidBranding 2026-05-17-16:42:
Fastlane screenshots and icon must be Ghostex Android assets generated from the checked-in store asset generator, with release gates rejecting old upstream Termux screenshot markers.

CDXC:AndroidBranding 2026-05-17-20:13:
Fastlane screenshots and icon should use the same neutral macOS-style palette as the shipped Android drawer (`#181818`, `#0e0e0e`, `#7dd3fc`, `#f59e0b`, `#22c55e`) so app-store preview assets do not advertise an outdated Android-only blue-slate concept.

CDXC:AndroidBranding 2026-05-17-20:16:
Release gates should validate the checked-in Fastlane screenshot binaries, not only the generator source. At minimum, screenshot dimensions and sampled neutral background pixels must prove the committed images were regenerated for the current shipped drawer palette.

CDXC:AndroidBranding 2026-05-17-20:17:
The release launcher icon must use the same neutral Ghostex palette as the app drawer and store assets on both adaptive-icon Android versions and legacy PNG launcher fallbacks. Release gates should reject stale green/blue concept colors and validate generated PNG dimensions/background pixels.

CDXC:AndroidReleaseSurface 2026-05-17-14:49:
Release builds must fail if merged manifest entry points re-export stock Termux file receivers, document providers, IoT launch, run-command service, settings, or boot-style surfaces, or if stock local-session launcher shortcuts become enabled.

CDXC:AndroidReleaseSurface 2026-05-17-15:02:
Publishable Android release builds must use signing material supplied outside the repository and must never use Termux's checked-in shared test key. Local unsigned release builds may remain available for verification, but distribution jobs should require signing explicitly.

CDXC:AndroidReleaseCI 2026-05-17-17:50:
Release-candidate CI must build both install-test APKs and a publish-ready Android App Bundle, attach Ghostex-versioned AAB artifacts, and generate checksums for both APK and AAB outputs.

CDXC:AndroidReleaseCI 2026-05-17-20:58:
Local and CI release verification must use the same Gradle checksum task for Ghostex APK/AAB artifacts. The generated `SHA256SUMS` files must be verified against the current artifacts before a release candidate is considered handoff-ready.

CDXC:AndroidReleaseE2E 2026-05-17-20:54:
Android release documentation must lead with the strict root `npm run android:verify-release` command and clearly label `npm run android:verify-release:local` as source/build validation only, not final release proof.

CDXC:AndroidReleaseE2E 2026-05-17-20:57:
The strict `npm run android:verify-release` path must not allow `--skip-mac-check`. Skipping the Mac-side `ghostex android-check --json` readiness contract is valid only with local source/build validation.

CDXC:AndroidReleaseE2E 2026-05-17-20:59:
The root CLI test suite must cover the strict release runner's missing-environment preflight, proving it fails before Mac CLI, Gradle, or adb work when signing, live host, SSH user, or disposable-device confirmation are absent.

CDXC:AndroidReleaseSurface 2026-05-17-21:01:
The strict top-level release runner must preflight the configured publish keystore before long checks run. A missing keystore or a path inside `android/termux-app` must fail before Mac CLI, Gradle, signature, or adb work begins.

CDXC:AndroidReleaseCI 2026-05-17-21:44:
Release APK output directories must be cleaned before packaging and checksum generation must use Gradle `output-metadata.json` as the authoritative APK list. Stale Ghostex APKs from previous split/universal builds must fail verification instead of being uploaded or signed accidentally.

CDXC:AndroidReleaseSurface 2026-05-17-20:47:
APK/AAB signature verification must use the generated `SHA256SUMS` files as the artifact manifest. Strict local proof and signed CI must inspect the same files that release QA checksums and uploads.

CDXC:AndroidReleaseCI 2026-05-17-18:08:
Local `bundleRelease` verification should also emit a Ghostex-versioned Android App Bundle so CI and local release checks hand off the same publish artifact naming contract.

CDXC:AndroidReleaseCI 2026-05-17-19:18:
Release-candidate CI must run `:app:lintRelease` before uploading APK/AAB artifacts so target API 35, manifest, notification, and release UX lint regressions fail in CI instead of only during local verification.

CDXC:AndroidReleaseSurface 2026-05-17-15:04:
Configured publish signing must point at an existing keystore outside the Android checkout so release credentials cannot be accidentally committed or sourced from an in-repo relative path.

CDXC:AndroidRemoteSessions 2026-05-17-15:06:
Release builds must also guard the terminal input surface: hardware shortcuts and terminal context menus must stay redirected to Ghostex drawer workflows instead of reopening stock Termux local-session create, switch, rename, kill, settings, help, style, or report actions.

CDXC:AndroidBranding 2026-05-17-15:08:
The released APK must use Ghostex-owned package/version metadata and must not default to upstream Termux `0.118.0`.

CDXC:AndroidReleaseSurface 2026-05-17-15:10:
Stock Termux Settings must stay disabled in release builds because Ghostex settings are the drawer machine-management flows; plugin/debug/local-terminal preferences should not become an alternate release settings surface.

CDXC:AndroidConnectionRecovery 2026-05-17-15:12:
Open Tailscale actions should try the installed Tailscale app, then a store listing, then a web listing, and should fail into visible Ghostex status copy instead of crashing if no Android handler is available.

CDXC:AndroidConnectionManagement 2026-05-17-20:06:
Async SSH reconnects and remote actions must be machine-scoped. A slow response from a previous saved machine must not replace the drawer, status, or password prompts after the user switches accounts.

CDXC:AndroidConnectionManagement 2026-05-17-14:47:
Remote action and attach-preflight callbacks must also be generation-scoped, because users can switch from machine A to machine B and back to machine A before an older SSH action returns.

CDXC:AndroidConnectionManagement 2026-05-17-14:52:
Queued Android SSH callbacks must expire after Activity/controller teardown so reconnects, setup checks, and remote actions cannot update destroyed drawer, dialog, or terminal surfaces.

CDXC:AndroidRemoteSessions 2026-05-17-13:23:
Android remote context actions that accept user text must use documented Ghostex CLI argument forms with stable session ids and structured flags, so SSH shell quoting does not turn titles into selectors or command fragments.

CDXC:AndroidRemoteSessions 2026-05-17-14:24:
Android-facing Ghostex CLI actions must return a nonzero process exit when the macOS bridge replies with `{ ok: false }`, because Android's SSH action runner uses exit status to decide whether to show recovery or success.

CDXC:AndroidConnectionRecovery 2026-05-17-14:25:
Android must summarize failed Ghostex CLI JSON payloads by their `error` or `message` fields before showing recovery copy, so focus, rename, wake, sleep, and kill failures do not surface raw JSON in the drawer.

CDXC:AndroidSidebar 2026-05-17-14:27:
Successful remote context-menu actions must leave action-specific status copy after the drawer refreshes, so focus, wake, sleep, kill, rename, and project actions do not look like a generic reconnect.

CDXC:AndroidSidebar 2026-05-17-20:05:
Primary Ghostex drawer layout copy should live in Android string resources, not hardcoded layout text, so release lint remains useful and the shipped drawer surface is localization-ready.

CDXC:AndroidSidebar 2026-05-17-20:08:
The Android drawer, dialogs, machine switcher, and session cards should use the macOS sidebar's neutral dark chrome (`#181818` app shell, `#0e0e0e` modal/input shell) with color reserved for focus, status, and destructive accents. Avoid blue-slate Android-only theming that drifts away from the Mac sidebar.

CDXC:AndroidSidebar 2026-05-17-20:51:
Every visible text, hint, and content description in `view_ghostex_drawer.xml` must use Android string resources. Release gates should reject hardcoded drawer copy so localization readiness does not depend only on lint.

CDXC:AndroidRemoteSessions 2026-05-17-14:29:
Cold remote session attach should use the same short SSH connection timeout as inventory and context actions so offline Tailscale machines do not hang the foreground terminal on SSH's default network wait.

CDXC:AndroidRemoteSessions 2026-05-17-14:55:
Android SSH command construction must validate remote Ghostex session action names at the builder boundary so unsupported or shell-shaped action strings cannot become Mac-side commands.

CDXC:AndroidRemoteSessions 2026-05-17-14:30:
The seven-entry warm session cache must preserve access-order recency while cleaning dead terminal surfaces, so cleanup cannot mutate the order used to decide the last clicked sessions.

CDXC:AndroidRemoteSessions 2026-05-17-14:32:
Android session inventory and failed-action parsing must skip shell/profile brace snippets, including unmatched braces, before reading the Ghostex CLI JSON payload.

CDXC:AndroidConnectionManagement 2026-05-17-14:34:
Deleting a non-selected saved machine from Settings must not switch or reconnect the active SSH account; reconnect only when the deleted machine was selected.

CDXC:AndroidConnectionManagement 2026-05-17-14:37:
Saving or updating a machine password from Settings must not switch accounts or reconnect; Connect is the only settings action that makes a saved machine active.

CDXC:AndroidConnectionManagement 2026-05-17-14:40:
Open credential prompts must expire if their target saved machine is deleted before the user accepts them, so stale UI cannot recreate a removed account.

CDXC:AndroidConnectionManagement 2026-05-17-14:40:
Machine-scoped Settings dialogs and action sheets must verify their target still exists before mutating credentials, editing, checking, repairing, or reconnecting, so stale UI cannot operate on a deleted account or fall through to another machine.

CDXC:AndroidSidebar 2026-05-17-14:44:
Android Last Active labels and sidebar ordering must parse standard ISO timestamps with UTC `Z`, fractional seconds, or explicit timezone offsets so recency cues remain stable across Mac-side timestamp emitters.

CDXC:AndroidRemoteSessions 2026-05-17-13:42:
Session inventory parsing must identify the Ghostex CLI JSON object by the `sessions` payload, not by the first brace in SSH output, because real Mac login shells may print profile/MOTD text before the command response.

CDXC:AndroidOnboarding 2026-05-17-13:52:
Opening a cold remote session attach must use the same app-owned SSHJ transport as reconnect, so users see consistent setup recovery paths for credentials, Tailscale reachability, and host-key verification.

CDXC:AndroidConnectionManagement 2026-05-17-14:03:
Saved-machine management should provide a Check connection action that verifies local SSH tools, SSH reachability, and the remote Ghostex CLI before users commit to switching machines or opening a session.

CDXC:AndroidConnectionRecovery 2026-05-17-13:33:
Missing or rejected SSH password failures must open the password recovery prompt consistently, whether the failure happens during reconnect, machine checks, session actions, project actions, or rename.

CDXC:AndroidConnectionManagement 2026-05-17-13:41:
Password entry triggered by Check connection must preserve the non-destructive nature of the check: after saving or holding the password, re-run the check without changing the selected machine.

CDXC:AndroidConnectionRecovery 2026-05-17-13:48:
Password recovery should resume the user action that failed for credential reasons, including reconnect, machine check, remote session action, project action, and rename.

CDXC:AndroidConnectionManagement 2026-05-17-13:57:
Saved-machine management should expose an inspectable details panel with selected state, SSH target, password mode, Last Connected, and machine id for support/debugging without reconnecting.

CDXC:AndroidRemoteSessions 2026-05-17-13:57:
Android must parse the live Ghostex CLI session fields `provider` and `providerSessionName` as well as sidebar-shaped `sessionPersistenceProvider` and `sessionPersistenceName`.

CDXC:AndroidConnectionRecovery 2026-05-17-14:05:
When project-level actions partially succeed and then require password recovery, retry should target only failed sessions so successful lifecycle changes are not repeated.

CDXC:AndroidConnectionManagement 2026-05-17-13:45:
Saved-machine actions should let users copy the exact SSH target string for setup, support, and debugging across devices.

CDXC:AndroidOnboarding 2026-05-17-13:49:
Remote sidebar actions should use the same app-owned SSHJ transport as reconnect and attach so focus, wake, sleep, kill, project actions, and rename fail into the Ghostex setup recovery path when credentials, Tailscale, or host-key verification need attention.

CDXC:AndroidConnectionManagement 2026-05-17-13:50:
Check connection should open setup recovery when credentials, Tailscale, host-key verification, Ghostex CLI, or zmx readiness need attention, because that action is a repair path and should not leave users with only compact status text.

CDXC:AndroidConnectionManagement 2026-05-17-13:52:
Saved-machine readiness checks must suppress stale asynchronous results so an older Check connection request cannot replace the latest status, setup panel, or SSH password recovery prompt.

CDXC:AndroidConnectionManagement 2026-05-17-13:53:
Pending saved-machine readiness checks must verify that the target machine still exists before opening setup or credential recovery, so deleting an account cannot be undone by a late async callback.

CDXC:AndroidConnectionManagement 2026-05-17-13:55:
The persisted last selected machine id must be cleared if it points at a deleted or unknown machine, so automatic reconnect always starts from a real saved account.

CDXC:AndroidRemoteSessions 2026-05-17-13:57:
Android remote context actions should use documented `--session-id` CLI flag forms for focus, wake, sleep, kill, and rename so all sidebar actions share one stable-id selector contract.

CDXC:AndroidRemoteSessions 2026-05-17-13:59:
Android attach should also call the documented `ghostex attach --session-id <id>` form so terminal opening and context actions share one stable-id CLI contract.

CDXC:AndroidOnboarding 2026-05-17-14:00:
On the required first-run tutorial, opening Tailscale must not dismiss setup or mark tutorial completion; the user should return to the tutorial until Add Machine or Done continues the onboarding path.

CDXC:AndroidConnectionManagement 2026-05-17-14:02:
Saved-machine settings actions should replace the settings panel instead of stacking editor, setup, password, action-sheet, or tutorial dialogs on top of it, keeping machine management usable on small screens.

CDXC:AndroidConnectionRecovery 2026-05-17-14:04:
If Check connection detects an SSH host-key mismatch, Android should open the confirmed Reset SSH host key prompt for the checked machine instead of requiring the user to find the repair action manually.

CDXC:AndroidConnectionRecovery 2026-05-17-14:06:
Resetting a host key from Check connection must preserve the selected machine and re-run Check connection for the checked machine rather than switching accounts or opening a full reconnect.

CDXC:AndroidConnectionManagement 2026-05-17-14:07:
Check connection should explicitly verify the remote `zmx` executable as well as SSH and the Ghostex CLI because the first Android release only supports ZMX-backed sessions.

CDXC:AndroidConnectionManagement 2026-05-17-18:20:
Check connection should use a dedicated Mac-side `ghostex android-check --json` readiness command that verifies zmx is installed, Ghostex Settings has Session persistence set to zmx, and the running Ghostex bridge can return the session inventory Android will render.

CDXC:AndroidOnboarding 2026-05-17-14:09:
The first-run tutorial should include exact Mac-side verification commands for `ghostex` and `zmx` so users can confirm the SSH login shell can see both tools before saving a machine.

CDXC:AndroidConnectionSecurity 2026-05-17-15:17:
Session-only SSH passwords must be cleared on Android controller teardown so unchecked Save password credentials are not retained after the app lifecycle ends.

CDXC:AndroidConnectionSecurity 2026-05-17-20:17:
Saved SSH machines, last-selected machine state, and credential bookkeeping must remain local to the phone. Android backup, cloud backup, and device-transfer extraction rules should exclude all app data unless a future Ghostex migration feature defines an explicit safe format.

CDXC:AndroidRemoteSessions 2026-05-17-15:19:
Editing a saved machine's SSH host, username, or port must evict warm attach terminals for that machine id so old SSH sessions cannot be reused after the target changes.

CDXC:AndroidConnectionManagement 2026-05-17-15:21:
Editing a saved machine's SSH target must expire in-flight checks and selected-machine SSH work for that stable id so callbacks started against the old host cannot update the edited account.

CDXC:AndroidConnectionManagement 2026-05-17-15:23:
Machine-scoped dialogs and recovery callbacks must require both the same machine id and same SSH target so UI opened before a host/user/port edit cannot mutate credentials or SSHJ host-key state for the edited account.

CDXC:AndroidConnectionManagement 2026-05-17-15:25:
Credential writes from prompts must preserve the latest saved-machine metadata, because a prompt can stay valid across display-name or Last Connected updates when the SSH target is unchanged.

CDXC:AndroidConnectionManagement 2026-05-17-15:27:
Saved-machine self-healing must clear a persisted last-selected id if the selected record is scrubbed, keeping startup reconnect and the account switcher aligned with the cleaned machine list.

CDXC:AndroidConnectionSecurity 2026-05-17-15:29:
The encrypted password vault must prune entries for machine ids no longer present in the cleaned saved-machine list so deleted or scrubbed accounts do not leave orphan credentials.

CDXC:AndroidRemoteSessions 2026-05-17-15:33:
Session alias is display-only; Android must keep a valid ZMX session visible when the CLI returns a stable session id without alias by deriving a compact badge from the id.

CDXC:AndroidConnectionSecurity 2026-05-17-15:40:
The session-only password cache must prune entries for machine ids no longer present in the cleaned saved-machine list so deleted or self-healed-away accounts do not keep process-memory credentials.

CDXC:AndroidConnectionManagement 2026-05-17-15:52:
Saved-machine destructive confirmations must re-check that the saved machine still exists with the same SSH target when accepted, so a stale delete prompt cannot remove a same-id machine after host, username, or port was edited.

CDXC:AndroidRemoteSessions 2026-05-17-16:04:
Remote sidebar action sheets must bind to the saved machine that opened them and expire after machine switches or same-id SSH target edits, so session ids from one Mac cannot be sent to another selected machine.

CDXC:AndroidRemoteSessions 2026-05-17-16:16:
Project action sheets must snapshot the sessions visible under the long-pressed project and guard project utilities with the opener machine, so later drawer refreshes or machine switches cannot change the action target before acceptance.

CDXC:AndroidRemoteSessions 2026-05-17-16:28:
Release builds must gate the empty-service startup path so Ghostex Android cannot regress into creating an ordinary local Termux shell before the SSH/ZMX reconnect flow.

CDXC:AndroidSidebar 2026-05-17-16:42:
Release builds must gate the Ghostex drawer wiring so the app cannot ship with the stock Termux local-session drawer, missing machine/recovery controls, or a drawer keyboard button instead of the floating terminal keyboard control.

CDXC:AndroidOnboarding 2026-05-17-16:58:
The first-run tutorial copy must live in a tested onboarding contract so release users keep exact setup steps for Tailscale, macOS Remote Login, Ghostex CLI, zmx persistence, built-in SSHJ transport, saved-machine setup, reconnect, and the SSH-to-Ghostex-CLI-to-ZMX model.

CDXC:AndroidRemoteSessions 2026-05-17-17:12:
Android SSH command construction must reject missing stable session ids for attach, focus, wake, sleep, kill, and rename so an empty selector is never sent to the Mac-side Ghostex CLI.

CDXC:AndroidConnectionRecovery 2026-05-17-17:24:
Open Tailscale must treat Android activity launch failures, including security and runtime start failures, as recoverable setup status instead of crashing the app.

CDXC:AndroidConnectionSecurity 2026-05-17-17:36:
The Android password vault must validate saved-machine ids at the credential boundary and prune corrupt credential keys, so saved passwords cannot be addressed through malformed ids even if a future caller bypasses the machine store.

CDXC:AndroidRemoteSessions 2026-05-17-17:49:
Android session parsing must treat JSON nulls from the Mac CLI as missing optional fields, so the drawer never shows literal "null" aliases, titles, or project labels.

CDXC:AndroidSidebar 2026-05-17-18:01:
Android drawer grouping must keep sessions with missing project id/path/name scoped by stable session id instead of merging every unknown project into one destructive project-action target.

CDXC:AndroidSidebar 2026-05-17-18:14:
The floating keyboard button replaces the labeled drawer keyboard action, so release builds must keep an accessibility label on the icon-only control.

CDXC:AndroidSidebar 2026-05-17-18:26:
The always-visible floating keyboard button must keep a phone-usable touch target of at least 48dp high, and release gates should catch regressions.

CDXC:AndroidSidebar 2026-05-17-18:38:
Remote drawer state cards, project headers, and session rows must expose content descriptions that describe the target and tap or long-press action, because these rows are controls in the Android sidebar.

CDXC:AndroidSidebar 2026-05-17-16:12:
Android action-sheet rows must expose accessibility descriptions that include the action name, action detail, and tap/destructive context, because long-press sidebar workflows move macOS hover controls into custom touch rows.

CDXC:AndroidRemoteSessions 2026-05-17-16:16:
Warm SSH attach terminals must be recoverable from the running TermuxService after Android Activity recreation, so fast switching does not open duplicate remote attach terminals after rotation or UI process churn.

CDXC:AndroidRemoteSessions 2026-05-17-16:22:
Warm-session rehydration must preserve the currently visible attach terminal while trimming overflow entries, even if TermuxService iteration makes the current terminal appear oldest.

CDXC:AndroidConnectionManagement 2026-05-17-16:20:
Saved-machine and setup panels must keep compact command buttons readable on narrow phones by using wrapped two-column rows instead of squeezing three or four text buttons into one row.

CDXC:AndroidBranding 2026-05-17-16:25:
Release APK filenames should include the Ghostex Android version name and version code by default so install-test artifacts remain traceable outside Gradle metadata.
-->

# Ghostex Android Requirements

## Requirement Update 2026-05-18

- Supersedes the earlier phone-side OpenSSH/sshpass setup requirement: Ghostex Android must use the app-owned SSHJ/SFTP transport for reconnect, session inventory, attach, remote actions, create/rename, readiness checks, and file upload.
- The Android app must not require installing OpenSSH, sshpass, or patched Termux packages on the phone for Ghostex workflows.
- Setup should remain available for Tailscale guidance, machine management, tutorial review, connection checks, and SSHJ host-key repair.
- Reset SSH host key should clear Ghostex Android's app-owned SSHJ host-key fingerprint for the saved machine, not edit Termux `known_hosts`.

## Product Goal

Ghostex Android should be a Termux-based Android app for connecting to already persistent Ghostex sessions running on a main macOS machine. For now, the remote session persistence provider is ZMX only. The Android app should abstract away local terminal management and use the Ghostex CLI on the main machine to list, attach to, and manage those sessions.

## First Launch And Connection

- On first app open, ask for the IP address or host of the machine to SSH into.
- Ask for the SSH password.
- Provide a checkbox to save the password.
- If the password is saved, store it using Android secure credential storage, not plaintext preferences or files.
- If the password is not saved, keep it only in memory for the current app process so first-run connection can still proceed without persisting the secret.
- Session-only passwords must be cleared when the Ghostex Android controller is destroyed.
- Session-only passwords for deleted or self-healed-away machine ids must be removed when the cleaned saved-machine list is refreshed.
- Passwords used for saved-password reconnect may be injected only through process environment and must be redacted from any execution environment logs.
- The expected environment is a macOS machine with Ghostex using ZMX as the persistence provider, the Ghostex CLI installed, and Tailscale configured for remote reachability.

## First-Run Tutorial

- Show a one-page tutorial the first time the app loads.
- The tutorial must be scrollable.
- The tutorial must list exact setup steps in full, using readable step cards so a new user can get going without guessing.
- The setup steps must explain how to configure the main machine, including installing Tailscale, logging into Tailscale, enabling SSH reachability, installing Ghostex CLI, and configuring Ghostex to use ZMX persistence.
- The setup steps should include the Mac verification command `command -v ghostex && command -v zmx`.
- The setup steps must explain how to configure the phone, including installing Tailscale, joining the same tailnet, opening Ghostex Android, adding the SSH machine, and connecting.
- The tutorial must briefly explain that Ghostex Android connects over SSH to the main machine, asks the Ghostex CLI for the live session list, and attaches the Termux terminal surface to selected ZMX-backed sessions.
- The tutorial title, intro, and steps must be testable as an onboarding contract so future UI refactors cannot silently remove required setup instructions.
- The tutorial should be available again from Settings after first run.
- On a fresh install, dismissing or completing the tutorial must not strand the user in an empty app state; if no SSH machine exists, continue directly to the Add Machine form.
- On the required first-run tutorial, the Open Tailscale action should launch Tailscale without dismissing the tutorial or marking setup complete.

## Saved Machines And Reconnect

- Settings must include a simple system to manage saved SSH machines.
- Saved-machine settings should be a polished machine-management panel with per-machine cards and direct actions for connect, password, edit, and more options.
- Saved-machine settings actions should dismiss the settings panel before opening a follow-up panel or reconnect flow so the UI does not stack multiple stale dialogs.
- Saved-machine and setup action buttons should stay readable on phone-width panels, using wrapped rows instead of over-compressed one-line controls.
- Saved-machine cards should show selected state and Last Connected status so users can distinguish the active target and recently working machines.
- Editing a non-selected saved machine from Settings must save the record without switching the active SSH account or starting a reconnect; account switching should happen only when the user explicitly taps Connect.
- Saving or updating a password from Settings must save credential state only; it must not change the selected machine or reconnect until the user taps Connect.
- Machine switchers should show both the friendly display name and SSH target when available so multiple saved Macs/accounts remain easy to distinguish.
- Machine switcher rows should be styled for the Ghostex dark drawer rather than relying on Android default spinner text colors.
- A saved machine should include at least a display name, host or IP address, SSH username, SSH port, and whether password saving is enabled.
- Users must be able to add a new machine/account from Settings and from the failed-connection state.
- CDXC:AndroidConnectionManagement 2026-05-17-21:07: Saved-machine settings must reject duplicate SSH targets with the same host, username, and port so auto-reconnect and the drawer switcher stay unambiguous. The same host may still be saved with a different SSH username or port. Older duplicate persisted entries should self-heal on load.
- Users must be able to select a different saved machine/account from a dropdown when reconnect fails or when they want to switch targets.
- The saved-machine dropdown must also include a direct add-new-machine action.
- The machine editor must keep invalid entries open with field-level errors instead of closing and leaving the user to infer what failed.
- The machine editor must validate host, username, and port before saving so malformed SSH targets produce clear field errors instead of later reconnect failures.
- The machine editor and password prompt must use polished Ghostex-styled panels and clearly explain saved-password versus session-only password behavior.
- Machine management must protect destructive actions with confirmation dialogs.
- Deleting a secondary saved machine must leave the active machine and active terminal alone.
- Machine management should provide a details view for each saved machine with selected state, SSH target, password mode, Last Connected, and machine id.
- Machine management should let users copy the exact saved SSH target string.
- Users must be able to forget a saved password without deleting the machine entry.
- Users should be able to check a saved machine from its actions to confirm SSH reachability, credentials, the remote Ghostex CLI, zmx, Ghostex's zmx persistence setting, and the running Ghostex bridge inventory endpoint are ready through the app-owned SSHJ transport.
- Check connection should call `ghostex android-check --json` on the Mac after SSH reaches the host, rather than inferring readiness from a generic session-list command.
- Check connection must not require phone-side SSH package installation; local setup recovery should focus on Tailscale, credentials, saved machines, tutorial steps, and SSHJ host-key repair.
- If Check connection requires a password, entering it should re-run the check without switching the currently selected saved machine.
- If multiple Check connection requests overlap, only the latest request should update visible status, setup recovery, or password prompts.
- If a saved machine is deleted while Check connection is still running, the pending check must not update UI, open credential recovery, or recreate that machine.
- If an already-open credential prompt targets a machine that is deleted before the prompt is accepted, accepting the prompt must not save credentials or recreate the deleted machine.
- If an already-open machine editor, action sheet, or repair confirmation targets a machine that is deleted before the action is accepted, the action must expire instead of mutating credentials, reconnecting, or operating on another saved machine.
- If an already-open credential prompt, machine editor, action sheet, or host-key repair callback targets a machine whose host, username, or port changed before the action is accepted, the action must expire instead of mutating credentials, reconnecting, checking, or resetting the SSHJ host-key store for the edited account.
- If an already-open destructive machine confirmation targets a machine whose host, username, or port changed before the action is accepted, the destructive action must expire instead of deleting the newly edited same-id account.
- If an already-open credential prompt is still valid because the SSH target did not change, saving or clearing password mode must preserve the latest saved-machine display name, connection fields, and Last Connected metadata.
- Editing a saved machine's host, username, or port must require a fresh password before keeping saved-password reconnect enabled, so an old secret is not silently reused for a different SSH target.
- Editing a saved machine's host, username, or port must close warm attach terminals and clear active session state for that machine id, because the id stays stable while the SSH target changes.
- Editing a saved machine's host, username, or port must expire pending Check connection callbacks for that machine id, and if it is the selected machine it must also expire in-flight reconnect, attach preflight, and remote action callbacks.
- Saved machine host fields must accept Tailscale/MagicDNS hostnames, IPv4-style addresses, and bracketless IPv6 literals, and must reject malformed or shell-metacharacter targets before persistence.
- Saved machine display/copy labels and SSH command destinations must bracket IPv6 literals when composing user@host targets.
- Saved machine username fields must accept simple SSH account tokens only and reject ambiguous or shell-metacharacter values before persistence.
- Startup reconnect must ignore older persisted machine records that no longer satisfy the saved-machine SSH target validation contract.
- Startup reconnect must ignore persisted machine records with invalid saved SSH ports instead of coercing them to port 22.
- Startup reconnect must ignore persisted machine records with invalid machine ids and scrub invalid or corrupt saved-machine JSON from normal settings.
- If self-healing removes the persisted last-selected machine record, the last-selected id must be cleared during that same store rewrite.
- When the app reopens, automatically try to reconnect to the last selected machine.
- If the persisted last selected machine id no longer exists, clear it and fall back to the first valid saved machine instead of keeping stale reconnect state.
- Saved passwords for deleted or self-healed-away machine ids must be removed from the encrypted vault when the cleaned saved-machine list is refreshed.
- The encrypted password vault must reject malformed machine ids for save, read, delete, and has-password operations, and must prune corrupt `ssh_password_*` keys during vault cleanup.
- The encrypted password vault must remove malformed or unreadable saved-password envelopes when discovered, and the saved machine must stop advertising saved-password reconnect after a vault read failure so the next recovery flow asks for credentials explicitly.
- When the app returns from the background, refresh the last selected machine with a throttle so the session list stays current without repeated SSH attempts.
- If the user switches machines while reconnect or remote actions are still in flight, stale results from the previous machine must be ignored.
- If the user switches away from a machine and then back before an older remote action or attach preflight returns, that older callback must still be ignored.
- CDXC:AndroidConnectionManagement 2026-05-17-21:05: If reconnect succeeds after the user edits saved-machine settings, the success callback may update Last Connected only on the current saved record and must not roll back display name, password mode, or other Settings metadata from the older request snapshot.
- If a remote session or project action sheet stays open while the selected machine changes or the same machine id is edited to a new SSH target, accepting an action from that sheet must expire instead of running the captured session ids against the new selected machine.
- Project-level action sheets must operate on the project sessions visible when the menu was opened; a later drawer refresh must not silently replace the action target before the user accepts wake, sleep, or kill.
- If the Android Activity or Ghostex controller is destroyed while SSH work is in flight, queued callbacks must not update UI or terminal state.
- If auto-reconnect succeeds, continue directly into the remote Ghostex session overlay.
- If auto-reconnect fails, show an intuitive recovery state with the current machine, the failure reason, a retry action, a saved-machine dropdown, and an add-new-account action.
- SSH and remote CLI stderr must be captured for reconnect/action failures so recovery states and password prompts are based on the real SSH error, not only stdout.
- Failed Ghostex CLI JSON payloads should be reduced to their error/message text before recovery copy is shown.
- Common SSH and remote CLI failures must be mapped to actionable recovery copy, including host-key verification failures, SSH connection refused, DNS/Tailscale reachability, missing remote Ghostex CLI, and missing ZMX.
- Host-key verification recovery should include a confirmed in-app action that removes only the selected machine's app-owned SSHJ host-key fingerprint from this phone, then retries connection.
- Check connection host-key failures should open that confirmed reset action for the checked machine.
- Check connection host-key reset should re-run Check connection for that machine without changing the selected saved machine.
- IPv6 default-port host-key reset should clear the selected saved machine's SSHJ host-key fingerprint regardless of the display format used for the host, so the next reconnect can accept the current host key.
- The recovery state should include a visible drawer card explaining what happened and which nearby actions can repair it.
- Drawer recovery state cards should be tappable and open repair actions for retry, Tailscale, phone setup, machine management, add machine, and tutorial.
- If SSH reports a missing or rejected password, prompt for a password from the recovery flow and let the user choose session-only use or secure saved-password reconnect.
- Missing or rejected password prompts should also appear after remote wake, sleep, kill, project actions, rename, or machine checks fail for credential reasons.
- After a credential prompt succeeds, the app should continue the interrupted intent: reconnect should reconnect, Check connection should re-check, and failed remote action or rename flows should retry that same action.
- If password recovery is completed with Save password unchecked, any stale saved password for that machine must be removed and the machine must stop auto-retrying saved-password reconnect on future launches.
- Show a button that opens the Tailscale app from onboarding, Settings, and connection-failure states.
- The Tailscale app launcher must use only a narrow package visibility query for Tailscale and must not request broad package-query permission.
- If Tailscale is not installed or the device cannot open the app, store, or web fallback, Ghostex Android should show clear recovery status instead of dismissing setup or crashing.
- If Android rejects a Tailscale, store, or web launch intent with a runtime or security start failure, the launcher should return failure so the setup/recovery panel can show status copy instead of crashing.
- Show a first-level Setup action for connection guidance, saved-machine management, Tailscale, tutorial review, and SSHJ host-key repair.
- The Setup action should open a polished setup panel that explains the built-in SSHJ transport and provides check, host-key repair, machine management, Tailscale, and tutorial actions in one place.
- Before reconnecting, attaching, or running sidebar actions such as focus, wake, sleep, kill, project actions, or rename, use the app-owned SSHJ transport directly; do not require or install phone-side `ssh`, `sshpass`, or patched Termux packages.
- Non-interactive Ghostex CLI commands must execute through the macOS login shell over SSHJ so they see the remote PATH where Homebrew or app-bundled `ghostex` launchers are installed.
- Session inventory parsing must use the Ghostex CLI JSON payload even when SSH login banners or shell text appear before or after the JSON object.
- Session inventory parsing must ignore earlier brace-delimited shell/profile output and select the first valid JSON object that contains the `sessions` array.
- Session inventory and failed-action JSON parsing must keep scanning after malformed or unmatched brace snippets from shell/profile output.
- Remote Ghostex CLI commands should run through the macOS login shell so SSH sees the PATH where Homebrew or app-bundled `ghostex` launchers are installed.
- If the built-in SSHJ transport cannot connect, show a clear recovery state with Retry, Tailscale, machine management, tutorial, and host-key repair actions.
- Only support ZMX-backed Ghostex sessions for now; unsupported providers should not become part of the main Android workflow.
- Remote provider and lifecycle tokens should be normalized before filtering so harmless CLI case/whitespace differences do not hide valid ZMX sessions.

## Main Experience

- After a successful connection, show the full list of remote Ghostex sessions.
- Render the session list as a polished overlay menu over the Termux terminal interface.
- The session UI should match the current Ghostex macOS sidebar as closely as Android allows.
- The Termux terminal itself is the execution surface for SSH and Ghostex CLI attach commands; session selection should make the chosen remote session usable without exposing ordinary Termux terminal-session management as the primary UX.
- Terminal long-press utilities should not expose stock Termux session management, styling, help, settings, report, or local process-kill workflows while Ghostex mode is active; remote session lifecycle actions belong in the Ghostex drawer context menus.
- Hardware keyboard shortcuts must not create, rename, or switch raw local Termux sessions while Ghostex mode is active; those shortcuts should direct users back to the Ghostex drawer instead.
- Release builds should include a source gate that keeps terminal long-press and hardware shortcut input paths locked to Ghostex remote-session workflows after future Termux upstream syncs.
- On normal startup, do not create a default local Termux shell just because the terminal service is empty.
- Release builds must include a source gate that fails if the empty-service startup path can create a default local Termux shell while Ghostex Android mode is active.
- Keep the last seven clicked threads warm in the background so switching between recently used sessions is fast.
- Warm background attach surfaces must be machine-aware so multiple saved Macs cannot collide on the same remote session id.
- Warm background attach surfaces should survive Android Activity/controller recreation while the Termux service and SSH terminals are still running.
- Warm-session overflow cleanup after Activity rehydration must keep the current terminal reusable before closing older non-current entries.
- Warm-session cleanup must not disturb click-recency order while removing dead terminals.
- Successful remote kill and sleep actions must close the matching warm attach surfaces; wake, focus, rename, refresh, and details actions should keep warm terminals available because the remote session remains reusable.
- Project-level remote actions must handle partial success: any successfully slept/killed sessions should still evict matching warm terminals and refresh the drawer even if another session action reports an SSH/CLI failure.
- If password recovery is needed after a partial project action, retry only the failed sessions rather than repeating wake, sleep, or kill on sessions that already succeeded.

## Sidebar Drawer

- Use a copy of Termux's current sidebar/drawer code as the main customization area.
- Keep original Termux files unchanged as much as possible.
- Prefer modular Ghostex-specific classes, layouts, drawables, and resources over editing upstream Termux code directly.
- Import or wire the Ghostex drawer in place of the original drawer through the smallest possible upstream-facing changes.
- If Ghostex reuses upstream drawer view ids for syncability, the stock Termux button binders must skip those views when the Ghostex drawer layout is installed so they never temporarily open local Termux settings or create local sessions.
- Release builds must include a source gate that verifies the Ghostex drawer controller and layout remain wired instead of falling back to the stock Termux local-session drawer.
- Remove the keyboard button from the sidebar/drawer.
- Add a floating keyboard button at the bottom-right of the screen that is always visible and toggles soft keyboard hide/show.
- The floating keyboard button must have an accessibility content description because it is icon-only.
- The floating keyboard button must keep at least a 48dp-high touch target.
- Match the aesthetics and structure of the current Ghostex macOS sidebar, including grouped sessions, active-session styling, status, provider/session metadata, and polished session-card treatment.
- Ghostex Android drawer, dialogs, machine switcher, and session rows should consume one shared macOS-sidebar palette instead of carrying divergent ad hoc color constants.
- The saved-machine spinner should use rounded Ghostex drawer surfaces in both collapsed and dropdown states, because it is the main multi-machine recovery control after failed reconnects.
- Android session rows should use Ghostex/macOS-sidebar colors, rounded card surfaces, rounded badges, and active accent styling rather than flat stock Termux list rows.
- State cards, project headers, and session rows must have accessibility descriptions that summarize the row and available tap or long-press action.
- If the Mac sidebar inventory provides `groupId` and `groupTitle` but sparse project metadata, Android should use that group metadata as the drawer grouping fallback so it still mirrors the macOS sidebar.
- Sessions without project id, project path, or project name should render as Ungrouped but remain grouped by stable session id so project-level actions do not target unrelated sessions.
- Match the macOS sidebar's session-card ordering cues by sorting project rows by attention, working, then Last Active recency, and show Last Active metadata on Android session cards.
- Last Active metadata and ordering should accept ISO timestamps with UTC `Z`, fractional seconds, or explicit timezone offsets.
- Active-session styling must be scoped by saved machine and remote session id so switching between machines with overlapping session ids cannot highlight the wrong row.
- Launcher icons, shortcuts, and app-facing labels should present Ghostex Android, not stock Termux local-session entry points.
- Release version metadata should be configured as Ghostex Android metadata, with `GHOSTEX_ANDROID_VERSION_NAME` and `GHOSTEX_ANDROID_VERSION_CODE` available for distribution builds.
- Release builds must fail if the visible APK version name falls back to upstream Termux `0.118.0`.
- Release APK output filenames should include the Ghostex version name and version code unless CI supplies an explicit artifact tag.
- Release QA must run `android/termux-app/tools/ghostex-android-device-e2e.sh` with `GHOSTEX_ANDROID_HOST`, `GHOSTEX_ANDROID_USER`, and optional password/session arguments against a live Mac before calling the Android app release-ready.
- Release QA should run `android/termux-app/tools/ghostex-android-ui-smoke.sh` on a connected emulator/device to prove the first-run tutorial is visible, scrollable, and hands off to Add Machine on a fresh install.
- The first-run UI smoke harness should also save a disposable SSH machine through the real Add Machine UI, restart the app, and verify the saved-machine settings/action surfaces so automatic reconnect and multi-machine management are covered without depending on a live Mac.
- After that restart, the first-run UI smoke harness should verify that reconnect recovery leads to the Setup repair panel when the loopback target is unavailable, as long as the user can reach setup actions from the drawer.
- Final release validation should support `npm run android:verify-release`, which runs the Mac `ghostex android-check --json` contract, root CLI tests, Android release gates, release lint, APK/AAB build, APK/AAB checksum verification, live connected-device E2E, and first-run UI smoke.
- Local source/build validation may use `npm run android:verify-release:local`, but that mode must skip connected-device checks only with explicit copy that it is not final release proof.
- The live E2E and first-run UI smoke scripts should require `GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1` before uninstalling or clearing Ghostex Android app data.
- Fastlane store metadata should use Ghostex Android title, short description, and full description copy that matches the remote Ghostex/ZMX product, not upstream Termux terminal-emulator marketing.
- Fastlane image metadata should include Ghostex Android screenshots and icon, not upstream Termux terminal screenshots.
- The Android submodule README and docs index should describe Ghostex Android setup, release verification, package-id constraints, and Termux upstream lineage instead of shipping the upstream Termux landing page.
- Release manifest entry points should not expose generic Termux file share/view, documents provider, IoT launcher, or external run-command APIs.
- Release manifest entry points should keep stock Termux Settings disabled; Ghostex machine management and setup settings belong in the drawer.
- Release manifest permissions should stay least-privilege for the Ghostex remote-session client and avoid broad stock Termux permissions unrelated to SSH, foreground terminal operation, and network state.
- Release builds should target Android API 35 or newer and include the runtime notification permission path needed for a visible foreground-service notification on Android 13+.
- The retained foreground terminal service should declare an Android 14+ foreground-service type and a Ghostex-specific special-use subtype that explains the user-visible SSH/ZMX remote terminal session.
- The release manifest should not request Android's battery-optimization exemption permission unless a dedicated Ghostex UX for that exceptional power behavior exists.
- Release manifest attributes should not request legacy external-storage compatibility while stock Termux file workflows are disabled.
- The released APK should not advertise or reserve the stock Termux `RUN_COMMAND` API or boot automation surface while those workflows are outside the Ghostex Android product.
- The app runtime must not start Termux's `termux-am` local socket server because local Android automation is outside the SSH-to-Ghostex-CLI/ZMX product boundary.
- The app runtime must not dynamically register package update listeners for stock Termux plugin environment refreshes; Ghostex Android does not integrate local Termux plugin packages.
- Release builds must include automated gates that verify disabled/non-exported stock entry points and disabled stock Termux launcher shortcuts after manifest merging.
- Publishable release builds must use local or CI-provided Ghostex Android signing configuration outside the repository and must fail if release signing points at the upstream Termux shared test key.
- Configured publish signing must fail if the keystore path is missing or resolves inside the Android checkout.
- Local unsigned release builds may stay available for build verification, but distribution/release jobs should explicitly require release signing before producing a publishable artifact.
- GitHub Actions should include a Ghostex Android release-candidate workflow that validates version inputs, runs source/manifest/signing/metadata gates, compiles Android instrumentation tests, runs release lint, assembles release APKs and the Android App Bundle, uploads Ghostex-named artifacts and checksums, and reminds release QA to run the live Tailscale/SSH/Ghostex/ZMX device harness.
- Upstream Termux workflows that publish debug APKs or trigger Termux library release behavior should stay manual-only in the Ghostex fork unless they are rewritten for Ghostex Android artifacts.
- The foreground notification should use Ghostex remote-session language, not stock Termux local-session/task/wakelock wording.
- Foreground, crash, and retained upstream plugin-error notification PendingIntents should be immutable because they open fixed app-owned actions and do not need caller mutation.
- Runtime package identity must match the bootstrap and package repository prefix. The current side-by-side package id is `io.ghostex`, with build-local bootstrap archives patched to the matching private prefix; a manifest-only rename to a different-length id is invalid because it would break the terminal environment.

## Touch Interaction Model

- macOS hover-only sidebar actions must move to Android context menus.
- Long-pressing a session, group, project, or other sidebar element should open the matching context menu centered in the screen.
- Context menus should be styled as Ghostex action sheets with readable action descriptions and clear destructive-action treatment.
- Action-sheet rows should provide accessibility descriptions that include the action label, supporting detail, and tap/destructive context.
- Session context menus should include attach, focus on Mac, rename, wake, sleep, kill, copy attach command, refresh, and details where the current CLI supports those actions.
- Successful session and project context-menu actions should confirm the actual action in the drawer status after refresh.
- Session/project details and destructive confirmations should use Ghostex-styled panels with clear target names and impact copy.
- Session details should include enough remote context to debug from Android, including selected machine, project path, focus state, Last Active, provider session, agent, and stable session id.
- Bring the context menu behavior for each macOS sidebar element type into the Android drawer where that element exists.

## CLI And Remote Session Requirements

- Use the Ghostex CLI as the bridge to sessions running on the main machine.
- If the current Ghostex CLI is missing a function needed by the Android app, add that CLI function instead of inventing an Android-only workaround.
- The CLI should expose `ghostex android-check --json` as Android's readiness command for zmx, settings, and bridge inventory checks.
- Android should use ZMX attach behavior for now and should not try to manage arbitrary tmux/zellij providers in the first version.
- Session list data should come from machine-readable CLI output, not screen-scraping terminal text.
- Android must accept both live CLI provider fields and sidebar-shaped persistence provider fields from the sessions JSON payload.
- Android session parsing must treat JSON null values as missing optional fields rather than rendering literal `null` text in aliases, titles, project names, provider metadata, or recency details.
- Session attach should run through SSH into the main machine and execute the Ghostex CLI attach/resume path for the selected session.
- Android should use stable session ids from the CLI JSON payload for attach and session actions, not mutable numeric/sidebar aliases.
- Android must not drop a ZMX session solely because its display alias is missing; if `sessionId` is present, derive a compact display badge from that stable id.
- Android SSH command construction must reject a missing or blank stable session id before composing attach, focus, wake, sleep, kill, or rename commands.
- Android focus, wake, sleep, kill, and rename actions should call documented Ghostex CLI `--session-id` flag forms instead of relying on positional selector text.
- Android remote session action command construction must reject unsupported action names before building an SSH command.
- Android attach should call `ghostex attach --session-id <id>` through SSH instead of relying on positional selector text.
- Android attach SSH commands should include a short connection timeout like non-interactive inventory and context commands.
- Android rename actions should call `ghostex rename-session --session-id <id> --title <title> --json`, and the macOS CLI should keep that flag form documented and covered by tests.
- Android focus and rename CLI paths must exit nonzero when the Ghostex macOS bridge reports `{ ok: false }`, so the Android SSH runner cannot mistake a failed remote action for success.

## Upstream Sync Requirement

- Keep Ghostex Android easy to rebase onto upstream Termux.
- Avoid broad rewrites in Termux core files.
- When copying upstream components, name Ghostex variants clearly and keep the delta localized.
- Record implementation decisions in `docs/android-decisions.md`.
