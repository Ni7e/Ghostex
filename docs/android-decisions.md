> Archived implementation history. The retired Termux-fork app now lives at
> `/Users/madda/dev/_active/ghostex-deprecated/android/`. Active mobile work
> and releases use the React Native Android app in `mobile/`.

<!--
CDXC:AndroidRemoteSessions 2026-05-17-09:55:
This document records initial architecture decisions after inspecting the Ghostex sidebar, Ghostex CLI, and Termux drawer code.

CDXC:AndroidConnectionManagement 2026-05-17-10:13:
Connection state should be modeled as saved SSH machine records plus a last-selected machine, with startup auto-reconnect and failure recovery paths instead of a single one-off host prompt.

CDXC:AndroidConnectionManagement 2026-05-17-14:12:
The saved-machine editor now separates record management from account switching. Saves for non-selected machines update Settings in place, while Add and selected-machine edits continue to connect so first-run and active-account changes remain direct.

CDXC:AndroidConnectionManagement 2026-05-17-10:37:
The Android recovery UI keeps machine switching and add-new-machine in the same dropdown, validates the machine editor in place, and refuses saved-password reconnect records unless Android Keystore storage succeeds.

CDXC:AndroidSidebar 2026-05-17-10:43:
Android now keeps project/group rows in the remote session drawer, exposes project-level long-press actions, and disables stock Termux launcher shortcuts so release entry points stay aligned with the Ghostex remote-session model.

CDXC:AndroidOnboarding 2026-05-17-10:51:
Phone-side OpenSSH/sshpass setup is now a first-class in-app flow instead of a manual command buried in tutorial copy; reconnect preflights local tools before making remote SSH calls.

CDXC:AndroidConnectionSecurity 2026-05-17-11:17:
The Android machine form treats unchecked Save password as a session-only password, not a discarded password. This keeps first-run password SSH usable while preserving the no-plaintext-persistence requirement.

CDXC:AndroidConnectionManagement 2026-05-17-11:17:
Foreground resume now refreshes the last selected machine through a throttled controller hook so app reopen behavior is covered beyond cold service binding.

CDXC:AndroidBranding 2026-05-17-11:38:
The Android build must keep the runtime package id and Termux bootstrap prefix in agreement. A Gradle gate verifies this so release builds cannot ship a manifest-only package rename that breaks Termux binaries.

CDXC:AndroidSideBySideInstall 2026-05-17-23:39:
Ghostex Android now installs beside upstream Termux by using the runtime package id `io.ghostex`. The Java namespace remains `com.termux` for upstream sync, while the build generates local bootstrap archives patched from `/data/data/com.termux/files/usr` to `/data/data/io.ghostex/files/usr`. The package id is intentionally the same byte length as `com.termux`; a longer branded id requires rebuilt Ghostex bootstrap and package artifacts.

CDXC:AndroidOnboarding 2026-05-17-11:55:
Onboarding and saved-machine settings now use Ghostex-styled custom Android views: scrollable setup step cards and compact machine cards with direct actions. This keeps release UX consistent with the sidebar instead of exposing raw system list dialogs.

CDXC:AndroidConnectionSecurity 2026-05-17-12:06:
The machine editor and SSH password recovery prompt now share the Ghostex dark panel treatment and explicit credential copy while preserving the existing Keystore/session-only password split.

CDXC:AndroidConnectionManagement 2026-05-17-13:02:
The Ghostex drawer now renders setup, connecting, failed reconnect, and no-session state cards in the list area. This keeps recovery guidance inside the same overlay surface as machine switching and Retry/Setup/Tailscale/Add actions.

CDXC:AndroidOnboarding 2026-05-17-13:25:
The phone setup action now opens a Ghostex-styled panel with inline SSH-tool status, install repair, Tailscale, and tutorial actions, keeping setup UX aligned with the first-run and machine-management panels.

CDXC:AndroidSidebar 2026-05-17-13:48:
Session, project, and saved-machine long-press actions now use a shared Ghostex action sheet instead of raw Android list dialogs, with descriptive rows and destructive-action color.

CDXC:AndroidRemoteSessions 2026-05-17-14:09:
Android remote attach and wake/sleep/kill commands now pass stable CLI session ids instead of sidebar aliases so actions remain bound to the tapped row even when alias ordering changes.

CDXC:AndroidConnectionManagement 2026-05-17-18:20:
Android Check connection now calls a dedicated `ghostex android-check --json` CLI command on the Mac. The readiness decision lives in the Mac CLI because it can verify zmx on PATH, the persisted Ghostex Session persistence setting, and the running bridge inventory endpoint without Android scraping implementation files.

CDXC:AndroidSidebar 2026-05-17-14:34:
Android session action sheets now include Focus on Mac and Rename. Both route through the Ghostex CLI with stable session ids, while rename passes the title through a structured flag to preserve spaces and quoting.

CDXC:AndroidSidebar 2026-05-17-14:58:
Destructive confirmations and session/project details now use shared Ghostex-styled panels, keeping kill/delete/password-forget prompts and metadata views visually consistent with the action-sheet flow.

CDXC:AndroidSidebar 2026-05-17-17:40:
Ghostex drawer-driven dialogs now route through `GhostexDialogStyler`, which applies the dark Ghostex window, readable action-button colors, and destructive positive-button color consistently across onboarding, machine settings, setup, action sheets, details, confirmations, rename, and password prompts.

CDXC:AndroidSidebar 2026-05-17-17:44:
Ghostex drawer dialogs no longer call `AlertDialog.setTitle`. Titles now live inside the styled content view, including the first-run "Set up Ghostex Android" smoke-test title, so native title chrome cannot clash with the dark Ghostex panels.

CDXC:AndroidSidebar 2026-05-17-17:47:
Ghostex panel title creation now calls `GhostexTextSemantics.markHeading`, backed by AndroidX `ViewCompat.setAccessibilityHeading`, and a Robolectric test pins that behavior. This keeps screen-reader heading navigation after the app-owned dialog chrome replaced native `AlertDialog` titles.

CDXC:AndroidSidebar 2026-05-17-15:47:
The styled destructive confirmation path was smoke-tested from a seeded saved-machine card on the Android emulator so the release log reflects the actual machine-management flow, not only the unit/build gates.

CDXC:AndroidOnboarding 2026-05-17-16:05:
First-run tutorial completion now routes to Add Machine when the saved-machine list is empty, while later tutorial opens stay optional. This keeps setup copy and credential entry connected in the actual install path.

CDXC:AndroidReleaseSurface 2026-05-17-16:42:
Ghostex Android disables unused exported Termux manifest entry points while leaving the upstream classes in place. This keeps release identity focused on remote Ghostex sessions and reduces external attack surface without making upstream sync harder.

CDXC:AndroidRemoteSessions 2026-05-17-17:05:
The Termux service bootstrap still runs on first launch, but Ghostex mode no longer creates a default local shell session. This keeps the terminal surface empty until a Ghostex setup or remote attach action intentionally opens it.

CDXC:AndroidRemoteSessions 2026-05-17-17:34:
Warm attach sessions are now keyed by saved machine id plus remote session id, and deleting a saved machine closes its warm SSH terminals. This preserves fast switching without cross-machine terminal reuse.

CDXC:AndroidSidebar 2026-05-17-19:30:
The activity now skips stock Termux Settings and New Session button binders when the Ghostex drawer layout is installed. Ghostex reuses upstream ids to minimize layout churn, but those drawer controls should never point at local Termux settings or local-session creation before the Ghostex controller binds machine-management actions.

CDXC:AndroidRemoteSessions 2026-05-17-16:16:
Ghostex attach terminals now carry parseable command-label metadata, and the Android controller rehydrates the warm pool from TermuxService after Activity recreation.

CDXC:AndroidRemoteSessions 2026-05-17-16:22:
Warm-pool rehydration now protects the current visible attach terminal while trimming overflow entries, so UI recreation cannot orphan the active session outside the reuse cache.

CDXC:AndroidRemoteSessions 2026-05-17-17:55:
Successful kill and sleep actions now close matching warm SSH attach terminals. The lifecycle policy stays in a small Ghostex helper so Android can test the ZMX invalidation rules without depending on the Termux activity runtime.

CDXC:AndroidRemoteSessions 2026-05-17-18:24:
Non-interactive inventory/action/setup processes now use a shared Ghostex Termux shell wrapper. This keeps PATH, HOME, PREFIX, TMPDIR, and known_hosts behavior aligned with the terminal attach path instead of relying on a partial Android shell.

CDXC:AndroidConnectionSecurity 2026-05-17-18:31:
Termux environment logging now redacts secret-like variables, including SSHPASS, before verbose logs are written. Ghostex can keep passwords out of command text without moving the leak into diagnostics.

CDXC:AndroidConnectionManagement 2026-05-17-18:46:
Saved-machine validation is a small Ghostex helper instead of more inline dialog logic. This keeps SSH target rules unit-testable while preserving the localized Termux integration surface.

CDXC:AndroidReleaseSurface 2026-05-17-19:08:
The Ghostex manifest now trims stock Termux permissions that belong to disabled generic utility workflows. The released app keeps network, wake/foreground terminal, and vibration permissions while avoiding storage, package install, overlay, boot, app-usage, logs, dump, alarm, and secure-settings requests.

CDXC:AndroidReleaseSurface 2026-05-17-17:00:
Ghostex Android now targets API 35 by default, matching the current Google Play target API requirement. The release manifest declares POST_NOTIFICATIONS, `FOREGROUND_SERVICE_SPECIAL_USE`, and a `specialUse` subtype for the retained foreground terminal service; the launcher activity requests notification permission on Android 13+ so the remote-session notification stays visible.

CDXC:AndroidReleaseSurface 2026-05-17-20:24:
Ghostex Android now applies Android 15 system-bar and display-cutout insets to the drawer/terminal release surface through a small Ghostex helper. This keeps the sidebar and floating keyboard button usable under target API 35 edge-to-edge enforcement without rewriting Termux's activity root.

CDXC:AndroidReleaseSurface 2026-05-17-17:32:
The manifest now caps the retained Termux shared UID with `sharedUserMaxSdkVersion=32`. Ghostex still preserves older-device/bootstrap compatibility, but new Android 13+ installs should not join a deprecated shared UID now that plugin and generic utility surfaces are disabled for release.

CDXC:AndroidReleaseSurface 2026-05-17-17:00:
Ghostex Android no longer requests Android's battery-optimization exemption permission. The release UX has a foreground service plus explicit Keep awake notification action; a broad exemption prompt should only return with a dedicated Ghostex explanation and consent flow.

CDXC:AndroidReleaseSurface 2026-05-17-20:09:
The retained Keep awake action no longer calls `requestDisableBatteryOptimizations`; it only acquires the explicit wake and Wi-Fi locks and uses locale-stable lock tags. The runtime-surface gate now rejects reintroducing that exemption prompt.

CDXC:AndroidReleaseSurface 2026-05-17-19:16:
Release builds now include a Gradle permission gate that inspects the merged manifest. This keeps least-privilege behavior durable across future Termux upstream syncs.

CDXC:AndroidReleaseSurface 2026-05-17-19:24:
Disabled stock file share/view aliases now have no SEND/VIEW intent filters. This keeps the upstream alias names in place for syncability while removing stale generic file-workflow matches from lint and implicit intent resolution.

CDXC:AndroidReleaseSurface 2026-05-17-19:43:
The manifest now removes the stock RUN_COMMAND permission/action and static boot receiver path from the release surface. The classes remain in the upstream tree, but Ghostex Android does not advertise third-party command execution or boot automation.

CDXC:AndroidReleaseSurface 2026-05-17-19:58:
The retained Termux activity broadcast receiver now uses AndroidX `ContextCompat.registerReceiver(..., RECEIVER_NOT_EXPORTED)`. These broadcasts are app-private release plumbing, not a Ghostex integration API, and target API 35 lint requires that exported state to be explicit.

CDXC:AndroidReleaseSurface 2026-05-17-20:01:
The retained style-reload broadcast is now scoped with `setPackage(context.getPackageName())` before `sendBroadcast`. This keeps the internal receiver path compatible with Android's unsafe implicit intent checks while avoiding a broader exported receiver.

CDXC:AndroidReleaseE2E 2026-05-17-16:30:
Release validation now has a real-device harness instead of relying only on source gates. The host script installs the debug APK/test APK and runs Android instrumentation against a supplied Tailscale macOS host, while the release gate keeps that harness and its stable-id attach check present for future syncs.

CDXC:AndroidReleaseE2E 2026-05-17-17:35:
The device E2E and first-run UI smoke scripts now share an adb discovery helper. The helper accepts `GHOSTEX_ANDROID_ADB`, PATH, Android SDK environment variables, and common platform-tools locations so release validation is not blocked when Gradle can build Android but the interactive shell does not expose `adb`.

CDXC:AndroidReleaseE2E 2026-05-17-17:35:
The shared adb helper now also owns the "no connected device" check so release QA gets a clear instruction to start an emulator or connect a USB-debuggable phone, plus the current `adb devices -l` output, before any script can clear data or install APKs.

CDXC:AndroidOnboarding 2026-05-17-16:59:
Release validation now also has a first-run UI smoke harness. The host script clears app data on a connected emulator/device, installs the selected Ghostex Android APK, verifies the setup tutorial is visible and scrollable, captures screenshots, and confirms Done routes a fresh user into Add Machine.

CDXC:AndroidBranding 2026-05-17-16:37:
Fastlane metadata now presents Ghostex Android instead of upstream Termux. A release gate checks title, short description, full description, and required Tailscale/Ghostex CLI/ZMX terms so store copy cannot drift back to the wrong product.

CDXC:AndroidBranding 2026-05-17-16:38:
The Android submodule README and docs index now introduce Ghostex Android directly, while keeping Termux as upstream lineage. A release gate checks these repo-facing docs so the GitHub remote cannot present as stock Termux after future syncs.

CDXC:AndroidBranding 2026-05-17-16:42:
Fastlane image assets now come from a deterministic Swift generator that draws Ghostex Android setup, machine management, sidebar, and action-sheet screenshots plus a Ghostex icon. The store metadata gate validates dimensions and rejects stale upstream Termux screenshot markers.

CDXC:AndroidReleaseCI 2026-05-17-16:49:
Ghostex Android now has a dedicated release-candidate workflow for branded release APK assembly, optional CI-provided signing, artifact checksums, and live device E2E handoff notes. Upstream Termux debug-release and JitPack workflows stay manual-only in this fork so publishing a Ghostex release cannot attach Termux-branded debug APKs or trigger upstream library-release behavior.

CDXC:AndroidReleaseCI 2026-05-17-17:50:
The release-candidate workflow now builds `:app:bundleRelease` alongside `:app:assembleRelease`, uses the Gradle-produced Ghostex-versioned AAB artifact, generates AAB checksums, and uploads the AAB with the APKs. This keeps CI useful for both sideload/install testing and publish-channel handoff.

CDXC:AndroidReleaseCI 2026-05-17-20:58:
Checksum generation moved into Gradle as `:app:verifyGhostexReleaseChecksums`. The root release runner and CI workflow both use that task now, so local validation and release-candidate uploads prove the same APK/AAB `SHA256SUMS` handoff state.

CDXC:AndroidReleaseCI 2026-05-17-21:44:
Gradle now removes stale Ghostex release APK handoff files before packaging and derives APK checksums from `output-metadata.json`. The checksum task rejects extra Ghostex APKs not listed in metadata so stale split/universal artifacts cannot leak into uploads or signature proof.

CDXC:AndroidReleaseCI 2026-05-17-18:08:
The Gradle `bundleRelease` path now finalizes by copying the generated AAB to the same Ghostex-versioned artifact name that CI uploads. This keeps local release verification from depending on a CI-only rename step.

CDXC:AndroidReleaseCI 2026-05-17-19:18:
The release-candidate workflow now runs `:app:lintRelease` before checksums and artifact upload. This keeps CI aligned with local release verification and catches target API 35, manifest, notification, and UI-surface lint failures before an artifact can be handed off.

CDXC:AndroidReleaseE2E 2026-05-17-18:24:
The first-run UI smoke harness now refuses to clear Ghostex Android data unless `GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1` is set. This preserves the required fresh-install smoke path while preventing accidental deletion of a real Ghostex Android install on a selected device.

CDXC:AndroidReleaseE2E 2026-05-17-19:22:
The live device E2E harness now also requires `GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1` and uninstalls `io.ghostex` plus `io.ghostex.test` before installing the debug app/test APKs. This keeps a signed release candidate from blocking the instrumentation proof with a signature mismatch and makes the disposable-device requirement explicit without touching upstream Termux.

CDXC:AndroidReleaseE2E 2026-05-17-19:34:
The live device E2E harness now prepares the phone runtime after the required disposable-device uninstall: it starts Ghostex Android, waits for the fresh Termux bootstrap to expose `pkg`, then installs/verifies OpenSSH and sshpass before instrumentation. This keeps final E2E proof self-contained instead of relying on packages that the preceding uninstall necessarily removed.

CDXC:AndroidOnboarding 2026-05-17-19:11:
First-run tutorial completion is now tied to saved-machine setup. On a fresh install, tapping Add machine or Done from the tutorial no longer marks onboarding complete until an SSH machine is actually saved, so canceling the editor cannot strand users past the required setup page.

CDXC:AndroidOnboarding 2026-05-17-19:11:
The first-run UI smoke harness now cancels the Add Machine editor after the tutorial handoff, restarts the app, and verifies the tutorial is still shown. This gives release QA device-level proof that onboarding is not marked complete before a saved SSH machine exists.

CDXC:AndroidReleaseE2E 2026-05-17-19:15:
The first-run UI smoke harness now accepts `GHOSTEX_ANDROID_UI_SMOKE_APK`, supports `GHOSTEX_ANDROID_UI_SMOKE_BUILD=auto|release|debug`, and prefers an existing release universal APK in auto mode. This makes final release QA exercise the installable release candidate when available while keeping debug fallback for standalone development smoke runs.

CDXC:AndroidReleaseE2E 2026-05-17-19:17:
UI smoke APK selection now redirects Gradle build output to stderr because the helper returns the selected APK path through command substitution. This keeps `adb install` from receiving a path contaminated by build logs when the script builds debug or release on demand.

CDXC:AndroidReleaseSurface 2026-05-17-19:19:
The default `scripts/ghostex-android-release-readiness.sh` path now refuses to run unless `GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1` is set with external signing credentials, and it defaults first-run UI smoke to the release variant. Unsigned release builds remain limited to `--local` source/build validation.

CDXC:AndroidReleaseSurface 2026-05-17-19:26:
The strict root release runner now preflights every required final-proof environment variable: publish signing opt-in and credentials, live SSH target host/user, and disposable-device data-clear confirmation. Missing release context should fail before Mac CLI checks, Gradle builds, or device installs begin.

CDXC:AndroidReleaseSurface 2026-05-17-21:03:
The strict root release runner now verifies generated release APK signatures with `apksigner` and the Ghostex release AAB with `jarsigner` after the build/checksum step and before connected-device QA. Local `--local` validation stays unsigned-source/build proof only.

CDXC:AndroidReleaseSurface 2026-05-17-21:14:
APK/AAB signature inspection now lives in `tools/ghostex-android-verify-release-signatures.sh`. The strict root runner delegates to it, signed release-candidate CI runs it after checksum verification, and CI uploads it with the other QA harnesses so release operators use one signature proof path.

CDXC:AndroidReleaseSurface 2026-05-17-21:25:
The signature helper now chooses Android build-tools with Bash dotted-version comparison instead of GNU `sort -V`, and collects artifacts with Bash 3-compatible read loops instead of `mapfile`. This keeps strict release proof portable on macOS while still working in Linux CI.

CDXC:AndroidReleaseSurface 2026-05-17-21:31:
The signature helper now rejects unsigned AABs by inspecting `jarsigner` output for `jar is unsigned.` and requiring `jar verified.`. This closes the gap where `jarsigner -verify` can return success for an unsigned bundle.

CDXC:AndroidReleaseSurface 2026-05-17-20:47:
The signature helper now reads APK/AAB paths from the generated `SHA256SUMS` files instead of scanning release output directories. That keeps strict local proof and signed CI pinned to the exact artifact manifest that release QA checks and uploads.

CDXC:AndroidReleaseE2E 2026-05-17-20:54:
The Android README release section now leads with the root `npm run android:verify-release` command and its required signing/device/live-Mac environment. The repo-doc gate checks that strict path, the local-only command, signature verification, and "not final release proof" wording stay documented.

CDXC:AndroidReleaseE2E 2026-05-17-20:57:
The root release runner now rejects `--skip-mac-check` unless `--local` is also present, and the root CLI test suite covers that behavior. This keeps final release proof from skipping the Mac-side Ghostex/ZMX readiness contract.

CDXC:AndroidReleaseE2E 2026-05-17-20:59:
The root CLI test suite now also covers the strict runner's missing-environment preflight. It asserts the runner reports signing, host, user, and disposable-device requirements and does not reach Mac CLI or Gradle work without final-proof context.

CDXC:AndroidReleaseSurface 2026-05-17-21:01:
The strict root release runner now validates `GHOSTEX_ANDROID_SIGNING_STORE_FILE` before starting Mac CLI, Gradle, or adb work. Missing keystores and files inside `android/termux-app` fail at the root command, while the Gradle signing gate remains as a second layer during release builds.

CDXC:AndroidReleaseE2E 2026-05-17-19:20:
The first-run UI smoke harness now uninstalls `com.termux` and `com.termux.test` after explicit data-clear confirmation and before installing the selected APK. This keeps final release proof from failing when a debug instrumentation run leaves a differently signed app installed before signed-release UI smoke.

CDXC:AndroidReleaseE2E 2026-05-17-19:26:
The Android README release-verification section now mirrors the actual final proof: UI smoke should install the selected release candidate or explicit signed APK, and both UI smoke and live E2E require disposable-device confirmation before package uninstall/data-clear work. The repo-doc Gradle gate now rejects stale wording that describes first-run UI smoke as debug-APK only.

CDXC:AndroidReleaseE2E 2026-05-17-20:21:
The release-candidate workflow summary now includes `GHOSTEX_ANDROID_CONFIRM_CLEAR_DATA=1` in the live E2E command, and the CI-surface gate checks that exact command prefix. This keeps the artifact handoff runbook aligned with the harness safety preflight.

CDXC:AndroidReleaseE2E 2026-05-17-18:39:
The live device E2E harness now streams optional SSH passwords directly from the QA shell environment into the debug app's private `files/ghostex-e2e/password` path using `run-as`, and the instrumentation test reads that file instead of receiving a `ghostexPassword` argument. This keeps release QA from exposing SSH secrets in Gradle process arguments, host temp files, or shared Android temp paths while preserving password-based Tailscale SSH verification.

CDXC:AndroidReleaseE2E 2026-05-17-18:52:
The instrumentation test now deletes the private E2E password file in a `finally` block after the first read attempt and caches the value in the test process for the remaining E2E methods. The host harness still cleans the path, but device-side cleanup no longer waits for Gradle/test teardown or depends on a successful read.

CDXC:AndroidReleaseE2E 2026-05-17-18:36:
Added a root `scripts/ghostex-android-release-readiness.sh` runner and `npm run android:verify-release` alias so release validation covers the Mac-side Android readiness CLI, root CLI tests, Android release gates, release lint, APK/AAB build, connected-device E2E, and first-run UI smoke checks from one command.

CDXC:AndroidReleaseE2E 2026-05-17-18:31:
Changed the root release runner so `npm run android:verify-release` is final-release strict and runs connected-device E2E plus first-run UI smoke by default. Added `npm run android:verify-release:local` for no-adb source/build validation, with explicit output that local mode is not final release proof.

CDXC:AndroidReleaseSurface 2026-05-17-16:54:
Crash report, foreground service, and retained upstream plugin-error notification PendingIntents now use immutable flags, and release builds gate that behavior. These notifications open fixed app-owned destinations, so mutable notification PendingIntents are unnecessary release risk.

CDXC:AndroidConnectionManagement 2026-05-17-20:06:
Reconnect results are guarded by generation plus machine id, and remote action callbacks are guarded by current machine id. This prevents stale SSH work from overwriting the drawer after users switch saved machines.

CDXC:AndroidConnectionSecurity 2026-05-17-14:15:
Persisted machine loading now rejects invalid saved SSH ports instead of defaulting them to 22. Missing port fields still load as port 22 for older records, but corrupted or malformed ports require the user to re-add the machine.

CDXC:AndroidConnectionManagement 2026-05-17-14:16:
Saved-machine target formatting now brackets IPv6 literals for visible labels, clipboard copy, and SSH command destinations. This keeps IPv6 custom-port targets readable without changing the bracketless host entry validation contract.

CDXC:AndroidConnectionManagement 2026-05-17-14:18:
The Android manifest now declares only the Tailscale package visibility query needed by Open Tailscale. The release manifest gate keeps that query present and rejects `QUERY_ALL_PACKAGES`.

CDXC:AndroidConnectionRecovery 2026-05-17-14:20:
Known-host repair now removes both raw and bracketed `[host]:22` entries for default-port IPv6 machines, while custom-port machines still remove only the exact saved `[host]:port` target.

CDXC:AndroidRemoteSessions 2026-05-17-13:23:
The Android-facing Ghostex CLI contract now treats `rename-session --session-id <id> --title <title> --json` as a documented and tested form, while retaining positional rename for human CLI usage.

CDXC:AndroidRemoteSessions 2026-05-17-14:24:
Android-facing focus and rename CLI paths now convert `{ ok: false }` bridge replies into nonzero process exits. This keeps Android's SSH command runner aligned with the macOS bridge result instead of relying only on printed JSON.

CDXC:AndroidConnectionRecovery 2026-05-17-14:25:
Android reconnect/action failure summarization now extracts `error` or `message` from failed Ghostex CLI JSON payloads before applying recovery mapping. This keeps drawer status and password prompts readable after remote context-menu failures.

CDXC:AndroidSidebar 2026-05-17-14:27:
Remote context-menu actions now pass action-specific success copy into the post-action reconnect refresh. This keeps focus, wake, sleep, kill, rename, and project actions visibly confirmed instead of collapsing back to a generic connected status.

CDXC:AndroidRemoteSessions 2026-05-17-14:29:
Android attach SSH commands now include `ConnectTimeout=8`, matching inventory and context actions. This keeps offline Tailscale machines from tying up the foreground terminal on SSH's default connection wait.

CDXC:AndroidRemoteSessions 2026-05-17-14:30:
Warm-session dead-entry cleanup now uses a policy helper that reads entry values directly instead of calling `get()` on the access-order cache. This preserves the last-clicked order used for seven-session retention.

CDXC:AndroidRemoteSessions 2026-05-17-14:32:
The Android SSH-output parser now skips unmatched brace snippets before looking for complete Ghostex CLI JSON objects. This keeps shell profile text from breaking both session inventory and failed-action recovery parsing.

CDXC:AndroidConnectionManagement 2026-05-17-14:34:
Saved-machine deletion now distinguishes selected from secondary accounts. Removing a secondary machine cleans credentials and warm terminals for that machine but does not reconnect or change the active SSH target.

CDXC:AndroidRemoteSessions 2026-05-17-13:42:
Android session inventory parsing now scans SSH output for the first JSON object with a `sessions` array, so shell profile/MOTD brace text before `ghostex sessions --json` cannot hide the real CLI payload.

CDXC:AndroidOnboarding 2026-05-17-13:52:
Cold remote session attaches now re-run the phone-side SSH tool preflight before opening a terminal, preventing missing OpenSSH/sshpass from appearing as an avoidable failed attach terminal.

CDXC:AndroidConnectionManagement 2026-05-17-14:03:
Saved-machine action sheets now include Check connection, a lightweight readiness probe that validates phone SSH tooling, SSH reachability, and the remote Ghostex CLI without switching machines or opening a session.

CDXC:AndroidConnectionRecovery 2026-05-17-13:33:
Password recovery is now shared across reconnect, machine checks, remote session actions, project actions, and rename so any SSH missing/rejected-password failure opens the same credential prompt.

CDXC:AndroidConnectionManagement 2026-05-17-13:41:
Check connection password recovery now re-runs the readiness check after storing or holding the password, without switching the selected machine or opening a full reconnect.

CDXC:AndroidConnectionRecovery 2026-05-17-13:48:
Password recovery now resumes the interrupted intent: reconnect prompts reconnect, machine-check prompts re-check, and remote action/rename prompts retry the same action after the password is accepted.

CDXC:AndroidConnectionManagement 2026-05-17-13:57:
Saved-machine action sheets now include Details so users can inspect selected state, SSH target, password mode, Last Connected, and machine id without reconnecting.

CDXC:AndroidRemoteSessions 2026-05-17-13:57:
Android unit coverage now pins both live CLI `provider`/`providerSessionName` fields and sidebar-shaped `sessionPersistence*` fields so ZMX filtering remains compatible with the macOS CLI contract.

CDXC:AndroidConnectionRecovery 2026-05-17-14:05:
Project action summaries now track failed sessions and the first credential error so password recovery can retry only failed rows after partial success, avoiding repeated wake/sleep/kill calls against sessions that already changed.

CDXC:AndroidConnectionManagement 2026-05-17-13:45:
Saved-machine action sheets now include Copy SSH target so users can move the exact `user@host[:port]` value into Tailscale, macOS Remote Login setup, or support/debug notes without transcription errors.

CDXC:AndroidOnboarding 2026-05-17-13:49:
Remote sidebar actions now share the phone-side OpenSSH/sshpass preflight with reconnect and attach so local setup failures stay in the Ghostex setup/recovery UX instead of becoming raw SSH action errors.

CDXC:AndroidConnectionManagement 2026-05-17-13:50:
Check connection now opens the phone setup panel when local SSH tooling is missing. This keeps multi-machine readiness checks actionable without changing the selected machine.

CDXC:AndroidConnectionManagement 2026-05-17-13:52:
Check connection callbacks now use their own generation guard. This preserves the non-destructive multi-machine check behavior while preventing stale readiness probes from overwriting the latest recovery UI.

CDXC:AndroidConnectionManagement 2026-05-17-13:53:
Check connection callbacks now require the target saved machine to still exist before mutating UI or credential state, preventing deleted accounts from being recreated by late recovery flows.

CDXC:AndroidConnectionManagement 2026-05-17-13:55:
The machine store now refuses unknown last-machine ids and scrubs stale selections during reconnect resolution, keeping automatic reconnect tied to an existing saved account.

CDXC:AndroidRemoteSessions 2026-05-17-13:57:
Android wake, sleep, kill, and focus commands now use the Ghostex CLI `--session-id` flag form, matching rename and keeping remote context actions on a documented stable-id contract.

CDXC:AndroidRemoteSessions 2026-05-17-13:59:
Android attach now uses `ghostex attach --session-id <id>`, completing the same stable-id flag contract for the primary terminal-open path.

CDXC:AndroidOnboarding 2026-05-17-14:00:
The required first-run tutorial now keeps its Tailscale action non-dismissive so onboarding cannot be exited through a helper button before machine setup or reconnect begins.

CDXC:AndroidConnectionManagement 2026-05-17-14:02:
Machine settings card/setup actions now dismiss the settings panel before opening follow-up flows, avoiding stacked stale dialogs on small Android screens.

CDXC:AndroidConnectionManagement 2026-05-17-16:20:
Machine-management and phone-setup panels now render compact action controls in wrapped two-column rows with two-line labels so they remain usable on phone-width dialogs.

CDXC:AndroidConnectionRecovery 2026-05-17-14:04:
Check connection now detects host-key mismatch recovery messages and opens the confirmed Reset SSH host key prompt for the checked machine, keeping the known_hosts repair targeted and explicit.

CDXC:AndroidConnectionRecovery 2026-05-17-14:06:
Host-key reset launched from Check connection now re-runs Check connection without switching the active machine, preserving the readiness probe's non-destructive account semantics.

CDXC:AndroidConnectionManagement 2026-05-17-14:07:
Check connection now runs the Mac-side `ghostex android-check --json` readiness contract, making missing Ghostex CLI support, missing ZMX, non-zmx persistence, or an unavailable bridge inventory endpoint fail before users switch machines or open a session.

CDXC:AndroidConnectionRecovery 2026-05-17-19:07:
Remote SSH timeout copy now uses a shared Android helper so reconnect, Check connection, rename, and session actions all point users to Tailscale/retry recovery instead of terse generic timeout strings.

CDXC:AndroidOnboarding 2026-05-17-14:09:
The first-run tutorial now tells users to run `command -v ghostex && command -v zmx` on the Mac so onboarding matches the readiness probe and catches PATH issues before machine setup.

CDXC:AndroidConnectionSecurity 2026-05-17-14:57:
Saved-machine persistence now validates machine ids at the same boundary as host, username, and port. Invalid saved records are scrubbed from preferences and invalid programmatic saves are rejected so reconnect, credential lookup, and warm-session keys cannot be driven by corrupt machine metadata.

CDXC:AndroidReleaseSurface 2026-05-17-15:02:
Release signing is now explicit and externalized. Local release builds can stay unsigned for verification, while publish jobs can require Ghostex signing environment variables and the Gradle gate rejects the upstream shared Termux test key.

CDXC:AndroidReleaseSurface 2026-05-17-15:04:
The release signing gate now also validates that the configured keystore exists and resolves outside the Android checkout, keeping publish credentials out of git and making misconfigured CI fail before APK packaging.

CDXC:AndroidRemoteSessions 2026-05-17-15:06:
The release build now verifies Ghostex-mode terminal input backdoors stay closed: hardware shortcuts redirect create/switch/rename actions to the drawer, and terminal context menus omit stock local-session kill/reset/settings/help/style/report items.

CDXC:AndroidBranding 2026-05-17-15:08:
App version metadata now belongs to Ghostex Android even while the runtime package stays tied to the Termux bootstrap. Distribution builds can set `GHOSTEX_ANDROID_VERSION_NAME` and `GHOSTEX_ANDROID_VERSION_CODE`, and release gates reject the upstream Termux `0.118.0` fallback.

CDXC:AndroidBranding 2026-05-17-16:25:
APK output names now include Ghostex Android version name/code by default while still allowing a CI-provided artifact tag override.

CDXC:AndroidReleaseSurface 2026-05-17-15:10:
The stock Termux Settings activity is now disabled in the release manifest. Ghostex settings are the drawer machine-management and setup panels, so plugin/debug/local-terminal preferences stay out of the shipped settings surface.

CDXC:AndroidConnectionRecovery 2026-05-17-15:12:
Tailscale opening is now isolated in a small launcher helper that tries installed app, store, and web intents in order and returns failure to the controller so recovery status can stay inside Ghostex Android.

CDXC:AndroidConnectionSecurity 2026-05-17-15:17:
Ghostex Android now clears the session-only password cache during controller teardown and release-gates that cleanup, keeping unchecked-password credentials scoped to the promised app lifecycle.

CDXC:AndroidConnectionSecurity 2026-05-17-20:17:
Android backup and Android 12+ data extraction rules now exclude all app data. Saved SSH machines are device-local configuration, and restoring stale machine ids or encrypted-password bookkeeping onto another phone would be more surprising than helpful.

CDXC:AndroidRemoteSessions 2026-05-17-15:19:
Saved-machine SSH target edits now evict warm attach terminals for that stable machine id so quick switching cannot return to an SSH session opened against the previous Mac.

CDXC:AndroidConnectionManagement 2026-05-17-15:21:
Saved-machine SSH target edits now advance async request generations for affected work so late callbacks from the previous host/user/port cannot update the edited machine.

CDXC:AndroidConnectionManagement 2026-05-17-15:23:
Machine-scoped dialogs and host-key repair callbacks now require the saved SSH target to still match the opener, preventing stale same-id UI from writing credentials or known_hosts actions onto an edited machine.

CDXC:AndroidConnectionManagement 2026-05-17-15:25:
Password prompt writes now rebase on the current saved-machine record before toggling password mode, preventing older prompts from reverting newer non-target metadata.

CDXC:AndroidConnectionManagement 2026-05-17-15:27:
Saved-machine rewrites now clear a last-selected id that no longer exists after self-healing, so cleaned storage cannot keep stale reconnect state.

CDXC:AndroidConnectionSecurity 2026-05-17-15:29:
The Android password vault now prunes encrypted password entries whose machine ids are absent from the cleaned saved-machine list, preventing orphan credentials after deletion or self-healing.

CDXC:AndroidConnectionSecurity 2026-05-17-15:40:
Session-only password cache pruning now mirrors encrypted-vault pruning during machine-list refresh so orphan process-memory credentials are removed promptly.

CDXC:AndroidConnectionManagement 2026-05-17-15:52:
Saved-machine delete confirmations now re-check same-id SSH target freshness at accept time, preventing stale destructive prompts from deleting a newly edited account.

CDXC:AndroidRemoteSessions 2026-05-17-16:04:
Remote sidebar actions now carry their opener machine through attach/action/rename/copy flows and expire unless that same SSH target is still selected when accepted.

CDXC:AndroidRemoteSessions 2026-05-17-16:16:
Project action sheets now snapshot the visible project sessions at menu-open time and guard project copy/details utilities with the opener machine.

CDXC:AndroidRemoteSessions 2026-05-17-16:28:
The release runtime-surface gate now checks the empty-service startup branch so upstream syncs cannot re-enable stock local shell creation before Ghostex reconnects.

CDXC:AndroidSidebar 2026-05-17-16:42:
The release build now verifies Ghostex drawer controller/layout wiring, hidden upstream drawer reference, and floating keyboard-button placement so upstream syncs cannot restore the stock Termux drawer surface.

CDXC:AndroidOnboarding 2026-05-17-16:58:
First-run tutorial copy now lives in `GhostexOnboardingGuide` with unit coverage for the complete Mac/phone/Tailscale/SSH/Ghostex CLI/zmx setup contract.

CDXC:AndroidRemoteSessions 2026-05-17-17:12:
Android SSH command construction now rejects missing stable session ids before composing attach, lifecycle/focus, or rename commands.

CDXC:AndroidConnectionRecovery 2026-05-17-17:24:
The Tailscale launcher now treats runtime and security activity-start failures as recoverable, letting the controller show setup status instead of crashing.

CDXC:AndroidConnectionSecurity 2026-05-17-17:36:
The password vault now validates machine ids for direct credential operations and prunes corrupt `ssh_password_*` entries even when the caller's keep-list includes malformed ids.

CDXC:AndroidConnectionSecurity 2026-05-17-19:59:
The Android password vault now removes malformed or unreadable saved-password envelopes when `hasPassword` or `readPassword` sees them, and the controller clears saved-password mode on that machine after a read failure. This keeps Settings and reconnect from repeatedly claiming a saved password exists after keystore invalidation, restore, or local data corruption.

CDXC:AndroidSidebar 2026-05-17-20:03:
Android remote session parsing now treats Mac sidebar `groupId` and `groupTitle` as fallback project metadata. This preserves macOS-style grouping when the bridge has group metadata but sparse project metadata, while rows with neither still remain per-session Ungrouped for safe project actions.

CDXC:AndroidRemoteSessions 2026-05-17-17:49:
Android session parsing now normalizes CLI JSON nulls to missing values so optional sidebar metadata never renders as literal "null" text.

CDXC:AndroidSidebar 2026-05-17-18:01:
Unknown-project drawer rows now display as Ungrouped but group by stable session id, preventing project-level actions from spanning unrelated sessions when CLI project metadata is missing.

CDXC:AndroidSidebar 2026-05-17-18:14:
The floating keyboard FAB now carries the existing Keyboard accessibility label, and the drawer release gate verifies that label remains on the icon-only control.

CDXC:AndroidSidebar 2026-05-17-18:26:
The floating keyboard FAB now uses a 56x48dp frame and the drawer release gate verifies that touch target size.

CDXC:AndroidSidebar 2026-05-17-18:38:
Remote drawer rows now compose accessibility descriptions for recovery cards, project action headers, and session attach/action cards.

CDXC:AndroidSidebar 2026-05-17-16:12:
Ghostex Android now uses shared accessibility copy for custom drawer and action-sheet rows so touch targets announce their visible label, details, and action context consistently.

CDXC:AndroidSidebar 2026-05-17-20:05:
The primary Ghostex drawer labels and keyboard-button glyph now live in Android resources, and the SSH failure matcher uses `Locale.ROOT`. This removes Ghostex-owned release lint noise without touching disabled upstream Termux settings/file surfaces.

CDXC:AndroidSidebar 2026-05-17-20:51:
The release drawer gate now rejects hardcoded `android:text`, `android:hint`, and `android:contentDescription` values in `view_ghostex_drawer.xml`. The layout was already resource-backed; the gate now protects the whole primary drawer copy surface instead of only the title.

CDXC:AndroidSidebar 2026-05-17-20:08:
Android sidebar colors now track the macOS neutral sidebar shell instead of the earlier blue-slate drawer palette. Java widgets use `GhostexPalette` literal ARGB tokens and XML chrome uses matching resource colors, with the release gate rejecting stale blue-slate literals in the copied drawer layout.

CDXC:AndroidBranding 2026-05-17-20:13:
The Fastlane store asset generator now uses the same neutral Android drawer palette as the shipped UI and the store metadata gate rejects stale blue-slate generator tokens. Regenerated screenshots and icon therefore preview the release app instead of an older concept direction.

CDXC:AndroidBranding 2026-05-17-20:16:
The store metadata gate now samples the checked-in Fastlane screenshot pixels for the neutral `#181818` shell. This makes the gate prove the binaries were regenerated, not just that the generator source has the right palette.

CDXC:AndroidBranding 2026-05-17-20:17:
The adaptive launcher foreground and legacy launcher PNGs now use a deterministic neutral Ghostex terminal mark. A new launcher-icon generator owns the pre-adaptive PNG fallbacks, and the version-identity gate checks vector colors plus PNG dimensions/background pixels so launcher branding stays aligned with the app and store assets.

CDXC:AndroidSidebar 2026-05-17-20:12:
The Ghostex drawer keeps its own opaque dark background because it is an overlay surface inside TermuxActivity, not the activity root. Suppress only that layout overdraw warning so the sidebar keeps macOS-style contrast.

CDXC:AndroidRemoteSessions 2026-05-17-15:33:
Android session parsing now treats alias as optional display metadata and falls back to a compact session-id badge so stable-id sessions remain visible.
-->

# Ghostex Android Decisions

## Initial Codebase Findings

- Termux's current drawer lives in `android/termux-app/app/src/main/res/layout/activity_termux.xml` as `left_drawer`, with `terminal_sessions_list`, `toggle_keyboard_button`, and `new_session_button`.
- Termux's session drawer behavior is driven by `TermuxActivity.setTermuxSessionsListView()` and `TermuxSessionsListViewController`.
- Ghostex's macOS sidebar is primarily React code under `sidebar/`, with session card rendering in `sidebar/session-card-content.tsx`, grouped session UI in `sidebar/session-group-section.tsx`, and shared session contracts under `shared/`.
- The Ghostex CLI already has `sessions --json`, `attach`, `sleep`, `wake`, `kill`, and related commands in `scripts/ghostex-cli.mjs`.
- The CLI session list already exposes project, title, status, provider, provider session name, attach command, resume command, focused/visible state, and last interaction data through `listNativeCliSessions()`.

## Architecture Direction

- Use a Git submodule for Android, with `android/termux-app` tracking `https://github.com/maddada/ghostex-android.git`; this keeps Android source separate from the macOS app repository history while allowing the parent repo to pin a reviewed Android commit.
- Build Ghostex Android as a thin Termux app variant rather than a standalone terminal emulator rewrite.
- Keep Termux's terminal view, session process model, input pipeline, and SSH execution surface.
- Keep the runtime package id tied to the bootstrap prefix. The bundled upstream bootstrap contains `/data/data/com.termux/files/usr` inside binaries and symlink metadata, so a separate package id requires a matching Ghostex-built bootstrap and package repository rather than an AndroidManifest rename.
- Add a Ghostex-specific drawer module that is copied/adapted from Termux's current drawer path instead of mutating `TermuxSessionsListViewController` heavily.
- Wire `TermuxActivity` to the Ghostex drawer with the smallest possible integration point, ideally through a dedicated controller/factory and a Ghostex-specific layout include.
- Move the existing sidebar keyboard toggle into a floating bottom-right button over the terminal view, using the existing `TermuxTerminalViewClient.onToggleSoftKeyboardRequest()` path.

## Remote Session Model

- Treat each visible Android terminal session as an SSH-backed Ghostex attach surface, not as an independent local Termux workflow.
- Fetch the remote sidebar inventory by running `ssh <host> ghostex sessions --json` or an equivalent CLI JSON command on the macOS machine.
- Attach by opening or reusing a Termux terminal session that runs `ssh -t <host> ghostex attach <selector>`.
- Keep a warm LRU pool of up to seven recently clicked remote session attach surfaces. Evict the oldest warm session when an eighth distinct remote session is selected.
- For the first version, filter or mark unsupported sessions so the Android UX centers on ZMX-backed sessions as requested.

## Security Decisions

- Saved SSH passwords must use Android encrypted credential storage.
- Do not write passwords to Termux files, regular shared preferences, logs, command histories, or CLI arguments.
- Passwords entered without the save checkbox are kept only in process memory for the current app run; they can power immediate connect/attach flows but are lost on process death.
- Clear session-only password memory during Ghostex Android controller teardown, and keep this behavior guarded by the release runtime-surface gate.
- Prefer SSH key setup or system-backed credential prompts when feasible; if password automation is required, isolate it behind a Ghostex Android credential component.
- Do not expose the Ghostex CLI bridge directly over the network. The existing local CLI bridge can remain loopback-only on macOS because Android reaches it by SSHing into the Mac and running the CLI locally there.
- Store non-secret machine metadata separately from secrets so display name, host, username, port, and last-selected machine can be managed without exposing passwords.
- Treat the Tailscale app as a network prerequisite helper: provide deep links or package-intent launch from onboarding, Settings, and connection failure, but keep SSH and Ghostex CLI status checks inside Ghostex Android.

## Settings And Onboarding Direction

- Add a Ghostex Android Settings area for saved SSH machines instead of relying on a single first-run host prompt.
- Preserve the last selected machine and attempt reconnect on every cold app start.
- Refresh the last selected machine on foreground resume with throttling, so app reopen behavior stays current without repeatedly interrupting the active terminal.
- Use one scrollable first-run tutorial page before the connection form; it should explain exact host and phone setup steps plus the app's SSH-to-Ghostex-CLI-to-ZMX attach model.
- Use connection failure as a recovery screen with retry, open Tailscale, switch saved machine dropdown, and add-new-account actions.
- Keep the first version provider scope strict: ZMX only.

## Implementation Slice 2026-05-17

- Added `com.termux.app.ghostex` as the Ghostex-specific Android module so upstream Termux files stay limited to activity/layout wiring.
- Added a saved machine store, Android Keystore-backed password vault, first-run tutorial, machine editor, saved-machine dropdown, Tailscale launch action, reconnect flow, and ZMX-only session inventory.
- Replaced the visible Termux drawer content with `view_ghostex_drawer.xml` and kept a hidden upstream drawer template in `activity_termux.xml` as a local reference for future upstream syncs.
- Added a bottom-right floating keyboard toggle over the terminal surface while removing the visible drawer keyboard control.
- Added an accessibility label to the icon-only floating keyboard toggle and release-gated that label.
- Increased the floating keyboard toggle to a 56x48dp touch target and release-gated the size.
- Added a release drawer-surface gate that verifies Ghostex controller creation, Ghostex drawer layout wiring, hidden upstream drawer template status, first-level machine/recovery controls, and absence of a drawer keyboard toggle.
- Added long-press session context actions for attach, wake, sleep, kill, copy attach command, refresh, and details.
- Added a Ghostex-only Termux session creation path that can pass `SSHPASS` through process environment for saved-password SSH attach without embedding the password in command text.
- Updated launcher-facing app naming to Ghostex Android while retaining the current Termux package namespace during the upstream-based implementation phase.
- Versioned APK output filenames now include Ghostex version name and version code by default, with `GHOSTEX_ANDROID_APK_VERSION_TAG` available for CI channel/commit overrides.
- `tools/ghostex-android-device-e2e.sh` is the repeatable live verifier for release QA: it installs the app/test APKs and proves phone-side SSH tooling, Tailscale SSH reachability, remote `ghostex`/`zmx`, live ZMX inventory parsing, stable-id attach command construction, and a stable-session-id `focus` action.
- `tools/ghostex-android-ui-smoke.sh` is the repeatable first-run UI smoke verifier: it installs the selected APK on a connected device/emulator, checks the scrollable tutorial copy, captures screenshots, and verifies Done opens Add Machine on a clean install.
- Fastlane metadata now uses Ghostex Android release copy and `verifyGhostexReleaseStoreMetadata` fails release builds if the title/description stop matching the remote Tailscale SSH/Ghostex CLI/ZMX workflow.
- Fastlane screenshots and icon now come from `tools/generate-ghostex-store-assets.swift`, and `verifyGhostexReleaseStoreMetadata` validates image dimensions plus stale Termux markers.
- The Android README and docs index now use Ghostex Android release docs, and `verifyGhostexReleaseRepoDocs` fails release builds if they regress to upstream Termux landing copy.
- Added a Ghostex Android release-candidate workflow and `verifyGhostexReleaseCiSurface`; the workflow runs release lint, builds release APKs plus the Android App Bundle, handles optional signing secrets outside the checkout, uploads Ghostex artifacts/checksums, and points release QA to the live E2E harness.
- Changed upstream Termux debug-APK release and JitPack workflows to manual dispatch only so they remain sync references without running on Ghostex release events.
- Added `verifyGhostexReleaseNotificationSurface` and made retained notification PendingIntents immutable for foreground, crash report, and plugin-error notification paths.
- Hardened the saved-machine editor so invalid host, username, port, and save-password states stay in the dialog with field-level errors.
- Added an add-new-machine row to the machine dropdown so connection failures can be resolved from the same selector used to switch accounts.
- Added focused unit coverage for SSH command quoting, saved-password `sshpass` usage, noninteractive inventory refresh, and attach command construction.
- Renamed debug and release APK outputs to `ghostex-android_*` while keeping the Termux namespace during the upstream-based bootstrap phase.
- Replaced the flat session list with a grouped drawer model that renders project headers before session cards and adds project-level long-press actions for refresh, wake, sleep, kill, copy path, and details.
- Added content descriptions to drawer state cards, project headers, and session rows so tap and long-press controls are accessible outside visual scanning.
- Added shared accessibility copy for custom drawer and action-sheet rows so long-press action menus announce label, detail, and tap/destructive context.
- Changed missing-project drawer grouping to use stable session ids under an Ungrouped label, so sparse CLI metadata cannot merge unrelated sessions into one project-level action target.
- Expanded remote session parsing to accept the macOS/sidebar CLI contract fields, including project ids, primary titles, activity, focus, sleep state, and `sessionPersistenceProvider`/`sessionPersistenceName`.
- Updated adaptive launcher foreground branding and disabled stock Termux launcher shortcuts so the release launcher surface opens into the Ghostex reconnect experience only.
- Added a phone setup module that checks local `ssh` and `sshpass`, blocks reconnect with a clear recovery message when required tools are missing, and opens a setup terminal that runs `pkg update -y && pkg install -y openssh sshpass`.
- Added a first-level Setup button in the drawer and a Settings action for phone-side SSH setup.
- Extracted first-run tutorial copy into `GhostexOnboardingGuide` and added unit coverage that pins the required release setup steps and SSH-to-Ghostex-CLI-to-ZMX explanation.
- Added session-only password handling so unchecked Save password still allows immediate SSH list/attach without persisting the secret.
- Added password recovery prompts for missing/rejected SSH passwords, an explicit enter-password machine action, forget-saved-password support, confirmed machine deletion, and throttled reconnect on foreground resume.
- Added `verifyGhostexBootstrapPrefix` to the Android Gradle build so package/bootstrap prefix mismatch fails during compilation instead of producing a broken APK.
- Replaced raw tutorial text and machine list dialogs with Ghostex-styled onboarding and machine-management panels built inside the Ghostex controller.
- Replaced raw machine/password forms with Ghostex-styled credential panels while keeping field validation and secure password handling unchanged.
- Added drawer state cards for first setup, connecting, missing phone SSH tools, failed reconnects, and connected-but-empty ZMX session lists.
- Replaced the raw phone setup action list with a Ghostex-styled setup panel that can check tools inline and launch install, Tailscale, or the tutorial.
- Changed machine-management and setup panel command buttons to wrapped two-column rows so Add/Setup/Tailscale/Tutorial and machine-card actions stay readable on narrow phones.
- Replaced raw session, project, and saved-machine action lists with a shared Ghostex-styled action sheet for Android long-press and More actions.
- Changed Android attach and session action commands to use stable `sessionId` selectors from `ghostex sessions --json` instead of mutable aliases.
- Android session parsing now keeps sessions with `sessionId` even when alias is missing, deriving a compact badge from the id because command execution never depends on alias.
- Android session parsing now treats JSON nulls as missing optional fields before deriving aliases and drawer metadata.
- Added Android session Focus on Mac and Rename actions to close the gap with the macOS session context menu.
- Replaced raw destructive confirmation and metadata detail message dialogs with shared Ghostex-styled panels.
- Changed first-run tutorial behavior so a fresh install cannot finish setup without being handed into the Add Machine form.
- Disabled unused exported Termux entry points in the manifest: IoT launcher alias, file share/view aliases, documents provider, open-file content provider, and external run-command service. Internal activity launches remain available where Ghostex still uses them.
- Stopped Ghostex startup from creating a default local Termux shell when the service has no sessions; setup and remote attach still create terminal sessions explicitly.
- Added a release runtime-surface gate that fails if the empty-service startup branch can create a default local Termux shell while the Ghostex controller is active.
- Trimmed the terminal long-press menu in Ghostex mode to text/URL/autofill/keep-screen-on utilities so stock Termux session management, styling, help, settings, report, and local process-kill actions do not leak into the Ghostex remote-session experience.
- Redirected Termux hardware shortcuts for local session create/switch/rename back to the Ghostex drawer while Ghostex mode is active, preserving keyboard, paste, URL, menu, and font-size utilities on the terminal surface.
- Scoped the seven-entry warm terminal LRU by machine id and remote session id, with cleanup when a saved machine is deleted.
- Ghostex attach terminals are tagged with machine/session metadata and restored from TermuxService on controller bind so Android UI recreation does not create duplicate SSH attach surfaces.
- Rehydrated warm-pool overflow now keeps the current visible attach terminal in the cache before evicting older non-current sessions.
- Added lifecycle eviction for warm SSH attach terminals after successful remote kill or sleep actions, while preserving warm terminals for wake, focus, rename, refresh, and details workflows.
- Added a shared Ghostex Termux shell process wrapper for inventory refreshes, remote actions, and phone setup checks so non-interactive commands inherit the same Termux runtime environment and `.ssh` directory as visible terminal sessions.
- Redacted sensitive environment variables from verbose Termux execution logs so SSHPASS cannot be exposed by diagnostics.
- Added reusable saved-machine field validation for SSH host, username, and port values, with unit coverage for Tailscale hostnames, IP literals, ambiguous user@host input, whitespace, leading dashes, and invalid ports.
- Trimmed the manifest permission surface to the Ghostex remote-session workflow by removing stock Termux storage, package install, overlay, boot, usage-stats, log, dump, alarm, and secure-settings permissions.
- Added `verifyGhostexReleasePermissions` to fail release builds if manifest merging reintroduces broad stock Termux permissions.
- Raised the default target SDK to API 35 and extended the release permission gate to require notification permission plus a special-use foreground-service declaration for the remote terminal service.
- Removed `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` from the release manifest and added it to the permission gate because Ghostex Android does not expose a dedicated battery-exemption UX.
- Removed Termux's `requestLegacyExternalStorage` manifest flag and added it to the release manifest gate, because Ghostex Android does not expose stock file workflows and keeps SSH/ZMX work inside the app-private runtime.
- Removed external SEND/VIEW intent filters from disabled stock file share/view aliases so release lint and implicit intent resolution no longer see generic Termux file workflows.
- Removed the stock `RUN_COMMAND` permission/action and static boot-completed receiver action from the manifest, and extended the release manifest gate to keep those surfaces out.
- Added machine-scoped async guards for reconnect, wake/sleep/kill, and rename callbacks so stale SSH results are ignored after saved-machine switches.
- Disabled the `termux-am` local socket server at Ghostex Android startup and added a release runtime-surface gate so upstream syncs cannot silently restore a generic local Android automation bridge.
- Removed dynamic package update registration from the foreground service so Ghostex Android does not monitor local Termux plugin package installs/removals while running as a remote SSH/ZMX client.
- Reworded the foreground notification through a Ghostex formatter so visible service state says remote terminals, background operations, Disconnect, Keep awake, and Allow sleep instead of stock Termux sessions/tasks/wakelock copy.
- Scoped the drawer active-session highlight by saved machine and remote session id, matching the warm terminal key used for attach reuse.
- Merged SSH subprocess stderr into captured inventory/action output so failed reconnect states can summarize permission, sshpass, and Tailscale reachability errors accurately.
- Changed password recovery so unchecked passwords delete any stale saved password and flip the machine back to session-only reconnect behavior.
- Made drawer recovery state cards tappable so failed/setup/empty states open a Ghostex-styled repair action sheet instead of acting as inert explanatory text.
- Hardened Android session inventory parsing to extract the first complete Ghostex CLI JSON object from SSH output while continuing to ignore human-readable tables.
- Wrapped remote Ghostex CLI invocations in `/bin/zsh -lc` so macOS SSH commands use the user's login-shell PATH when resolving the installed `ghostex` launcher.
- Added a shared Android session-card formatter so drawer rows display Last Active metadata and sort each project by attention, working, then recency like the macOS sidebar.
- Saved-machine switcher labels now include the SSH target when a friendly display name is present, keeping multi-Mac/account switching unambiguous without changing the underlying machine store.
- Saved passwords are treated as bound to host, username, and port. Editing those fields with Save password enabled requires entering a fresh password instead of silently reusing the previous secret for a different SSH target.
- Tightened saved-machine host and username validation to the expected Tailscale/DNS/IP and SSH-account token shapes, and applied the same validation when loading persisted machine JSON so invalid older records cannot participate in automatic reconnect.
- Persisted saved-machine ports are now validated during JSON loading; invalid stored ports reject the machine record instead of silently changing the reconnect target to port 22.
- Saved-machine storage now validates machine ids, scrubs invalid persisted records, clears corrupt machine JSON and stale reconnect selection, and rejects invalid programmatic saves at the store boundary.
- Saved-machine self-healing now clears stale last-selected ids during the same rewrite that removes invalid records, keeping reconnect state in sync with the cleaned list.
- IPv6 saved-machine targets now use bracketed host formatting in Settings labels, details, clipboard copy, and SSH commands so custom ports are not confused with IPv6 segments.
- Added a narrow Android 11+ package visibility query for Tailscale and a release gate that rejects broad package-query permission while requiring the Tailscale query.
- IPv6 default-port known_hosts repair now clears both raw IPv6 and bracketed `[host]:22` entries so Reset SSH host key can fix the entry used by the next reconnect.
- Replaced the machine spinner's default Android row rendering with a Ghostex-styled adapter so the selected machine and dropdown rows remain readable on the dark drawer.
- Android normalizes remote provider, activity, and lifecycle tokens before filtering and rendering sessions, keeping the ZMX-only workflow strict without being brittle to CLI token casing.
- Saved-machine cards now show selected state and Last Connected recency from the machine model, making the multi-machine settings panel useful as a connection manager rather than only a host list.
- Editing a saved machine that is not currently selected now updates that record without changing `lastMachineId` or reconnecting, preserving Settings as a safe manager for multiple Macs/accounts.
- Editing a saved machine's SSH target now closes warm attach terminals and clears active session state for that machine id before saving the new target, preventing same-id reuse of SSH sessions connected to the previous host.
- Editing a saved machine's SSH target now also invalidates pending machine checks, and invalidates selected-machine reconnect/action/attach work when the edited machine is active.
- Project-level remote action handling now tracks successful rows separately from the final SSH/CLI failure so partial sleep/kill success still cleans up stale warm terminals and refreshes the drawer.
- Session Details now includes selected machine, project path, focus state, Last Active, provider session, agent, and stable id so Android users can inspect the same remote context they rely on in the macOS sidebar.
- Connection recovery now maps common SSH and remote CLI failures to Ghostex-specific next actions instead of showing raw stderr for host-key, refused SSH, DNS/Tailscale, missing Ghostex CLI, and missing zmx cases.
- Added a confirmed Reset SSH host key action in machine/setup recovery. It runs `ssh-keygen -R` against only the selected machine's current host/port in Termux known_hosts, then retries the Ghostex reconnect path.
- Documented and tested the Android SSH action contract for `ghostex rename-session --session-id <id> --title <title> --json`, and updated CLI help for the JSON session action forms used by Android.
- Focus and rename CLI paths now fail the process when the macOS bridge reports `{ ok: false }`, so Android remote action recovery is based on exit status as well as JSON output.
- Android now extracts `error`/`message` from failed Ghostex CLI JSON output before summarizing reconnect or remote action failures, avoiding raw JSON in drawer recovery states.
- Lifecycle CLI actions now treat bridge-level failures as failed Android-facing commands and preserve JSON output for `--json`, so Android wake, sleep, and kill recovery cannot mistake a disconnected macOS bridge for success.
- `ghostex sessions --json` now treats bridge-level failures as inventory failures instead of empty successful lists, so Android reconnect shows recovery copy when the macOS bridge is unreachable.
- Successful remote context-menu actions now preserve action-specific confirmation copy through the refresh that reloads the ZMX session list.
- Cold Android attach commands now include a short SSH connection timeout, aligning foreground terminal attach with inventory and remote action behavior.
- Warm-session dead terminal cleanup now preserves access-order recency so the last-seven-clicked retention policy is not disturbed by maintenance.
- Android JSON extraction now skips unmatched shell/profile brace snippets before session inventory and failed-action JSON payloads.
- Deleting a non-selected saved machine now leaves the active account connected instead of forcing a reconnect to the current machine.
- Settings password edits now save credential state without switching or reconnecting; the explicit Connect action remains the only settings path that changes the active saved machine.
- Open password prompts now verify their target machine still exists before saving credentials, preventing stale dialogs from recreating deleted saved machines.
- Machine-scoped settings actions now expire after their target machine is deleted, preventing stale editors, action sheets, and host-key repair confirmations from mutating or reconnecting the wrong account.
- Machine-scoped settings actions and host-key repair callbacks now also expire after same-id SSH target edits, so stale panels cannot save credentials, reconnect, check, or reset known_hosts for a newly edited host.
- Machine delete confirmations now re-check same-id target freshness when accepted, so stale destructive prompts expire instead of deleting a machine that was edited while the confirmation was open.
- Password prompt and forget-password writes now update password mode on the current saved-machine record instead of the prompt opener, preserving display-name and Last Connected edits made while the prompt was open.
- The password vault now prunes orphan encrypted entries during machine-list refresh so deleted or scrubbed machine ids do not keep credentials on device.
- The password vault now validates machine ids at the credential boundary and removes corrupt credential-key entries during pruning.
- Session-only password memory now prunes orphan machine ids during machine-list refresh, matching encrypted vault cleanup.
- Android Last Active parsing now accepts UTC `Z`, fractional seconds, and explicit timezone offsets, preserving sidebar recency labels and ordering if the Mac bridge emits local-offset ISO timestamps.
- Android project headers now sort by the best visible session in each project, using attention, working, then Last Active priority, instead of preserving incidental CLI project order.
- The floating keyboard button now uses a 56dp square overlay target so it looks and behaves like a persistent terminal affordance while still exceeding Android's 48dp touch target minimum.
- Ghostex machine/setup panel action pills and checkbox rows now keep 48dp minimum heights, preserving touch-target ergonomics while allowing labels to wrap in compact two-column panels.
- The saved-machine spinner now keeps 48dp rows and lets keyboard or screen-reader users activate the Add SSH machine recovery row without requiring a touch-down marker.
- The drawer's first-level controls now keep 48dp collapsed targets for machine switching, Machines, Tailscale, Setup, Retry, and Add so the main recovery/navigation surface is not smaller than the styled dialogs.
- Saved-machine storage and the editor now reject duplicate SSH targets by host, username, and port while allowing the same Tailscale host to be saved for a different account or SSH port; older duplicate persisted entries self-heal on load.
- Android session rows now use a Ghostex-owned macOS-sidebar palette, rounded card surfaces, rounded status badges, and an active accent border in the copied `GhostexRemoteSessionAdapter`; the release drawer gate checks these snippets so upstream Termux syncs cannot flatten the primary remote-session list back into stock row styling.
- The saved-machine spinner now uses rounded Ghostex row surfaces for both collapsed and dropdown rows, with a release gate beside the 48dp touch-target check so multi-machine recovery does not look like a stock Android picker.
- Ghostex Android now centralizes the macOS-sidebar color tokens in `GhostexPalette` and consumes them from dialogs, machine switcher rows, and session rows. The constants are literal ARGB values so plain JVM tests can load UI helpers without Android framework color initialization.
- Remote action and attach-preflight callbacks now use generation-scoped guards so stale SSH work expires even if the user switches away from a machine and then back to the same machine id.
- Reconnect success now rebases its Last Connected write on the current saved-machine record, preserving Settings edits made while SSH inventory was still running.
- Remote sidebar action sheets now bind callbacks to the saved machine that opened them, preventing stale session/project menus from running captured session ids against a different selected Mac.
- Project action sheets now snapshot the sessions visible under the long-pressed project, so wake/sleep/kill use the displayed target set even if the drawer refreshes before the user accepts.
- Added `verifyGhostexReleaseEntryPoints` so release builds fail if merged manifests re-enable stock Termux file/document/run-command/settings/boot entry points or local-session launcher shortcuts.
- Added externalized Ghostex Android release signing configuration and `verifyGhostexReleaseSigning` so publish jobs can require signing without committing key material, and release builds cannot use Termux's shared test key.
- Tightened `verifyGhostexReleaseSigning` so configured signing must use an existing keystore outside the Android checkout.
- Added `verifyGhostexRemoteSessionInputSurface` so release builds fail if terminal hardware shortcuts or long-press menus re-expose stock Termux local-session management in Ghostex mode.
- Switched app-level release metadata to Ghostex-owned version inputs, with `0.1.0` as the local default and a release gate preventing the upstream Termux `0.118.0` version name from shipping.
- Extended the release version/identity gate to require the Ghostex Android manifest placeholder, app-label string entity, and source manifest label wiring, preventing upstream Termux launcher branding from returning silently.
- Disabled stock Termux Settings in the manifest and extended the release entry-point gate so release builds cannot expose the upstream preferences activity.
- Extracted Tailscale launch recovery into a helper with pinned app/store/web fallback intents and visible failure status when Android cannot handle any fallback.
- Hardened Tailscale launch recovery so runtime/security failures from Android activity start are treated like missing handlers and surface as visible setup status.
- Ghostex Android controller teardown now marks the controller destroyed, advances async generations, clears queued callbacks, and ignores later status/drawer writes from in-flight SSH work.
- Ghostex Android controller teardown now also clears the process-only SSH password cache, and `verifyGhostexReleaseRuntimeSurface` fails if that cleanup is removed.
- Android SSH command construction now validates supported remote session action names before composing Mac-side Ghostex commands.
- Android SSH command construction now also requires a nonblank stable session id before composing attach, focus, wake, sleep, kill, or rename commands.
- Hardened Android session inventory parsing to ignore earlier brace-delimited profile output and select the first complete JSON object that actually contains the Ghostex CLI `sessions` array.
- Added attach-time phone setup preflight so a cold remote session attach opens the setup recovery state when OpenSSH/sshpass are missing instead of launching a terminal that cannot connect.
- Added a saved-machine Check connection action that runs the existing remote Ghostex CLI readiness command through the same Termux/SSH path and reports actionable recovery messages.
- Centralized the password-recovery trigger and reused it for wake/sleep/kill, project actions, rename, machine checks, and reconnect failures.
- Split password prompt behavior so Check connection remains non-destructive after credential recovery instead of switching the active saved machine.
- Reworked the password prompt to accept an intent-specific primary action, so credential recovery can retry failed remote session actions and rename instead of only reconnecting.
- Added saved-machine Details to expose inspectable connection metadata and password mode from the machine action sheet.
- Added Android parser coverage for the live Ghostex CLI provider field names used by `ghostex sessions --json`.
- Extended project-action recovery so partial-success password recovery retries only failed sessions while preserving warm-terminal cleanup for successful lifecycle changes.
- Added Copy SSH target to saved-machine actions.
- Added phone-side SSH tool preflight before focus, wake, sleep, kill, project actions, and rename.
- Changed Check connection missing-tool failures to open the phone setup panel directly.
- Added stale-result suppression for overlapping saved-machine Check connection requests.
- Added saved-machine existence checks for pending Check connection callbacks.
- Hardened last-machine persistence so deleted or unknown ids cannot remain selected.
- Switched Android remote action commands to `--session-id` flag forms and documented CLI help for focus/wake/sleep/kill.
- Switched Android attach commands to `ghostex attach --session-id <id>` and documented the CLI help form.
- Made the required first-run tutorial's Open Tailscale action keep the tutorial open.
- Changed saved-machine settings actions to replace the settings panel instead of stacking dialogs.
- Added machine-specific Reset SSH host key recovery when Check connection reports a host-key mismatch.
- Split Check connection host-key reset from reconnect host-key reset so the checked machine is rechecked without switching accounts.
- Updated Check connection to verify the remote `zmx` executable as part of readiness.
- Added `ghostex android-check --json` as the Mac-side readiness contract used by Android Check connection, so machine readiness now verifies zmx on PATH, Ghostex Settings set to zmx, and the running Ghostex bridge inventory endpoint.
- Normalized the `ghostex android-check --json` persistence-provider token before enforcing zmx so harmless casing or whitespace in shared settings cannot fail Android readiness while non-zmx providers still block the first release.
- Normalized Android GitHub Actions to stable action major versions and Ghostex-branded artifact names, and made the release-candidate artifact include the adb helper plus both live-device QA scripts.
- The release-candidate workflow now uploads release lint reports and unit-test HTML output alongside APK/AAB artifacts and device QA scripts, so a candidate has reviewable evidence before final device proof.
- The first-run UI smoke harness now saves a disposable `Smoke_Mac` loopback SSH machine through the real Add Machine form, restarts the app, verifies that machine remains the automatic reconnect target, and opens the saved-machine settings/action surfaces. This gives release QA checked-in proof for multi-machine management without requiring a live Mac for the onboarding smoke.
- The first-run UI smoke harness now also verifies post-restart reconnect recovery and opens the phone Setup panel from the drawer before entering saved-machine settings. The loopback target may fail because phone SSH tools are missing or because no local SSH server/Ghostex exists, but either case must lead to the same visible repair path.
- Added Mac-side `command -v ghostex && command -v zmx` verification to the first-run tutorial.
- Verified the Android debug build, unit tests, app lint gate, and release APK build with `./gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:assembleRelease`.
- For the earlier side-by-side debug app, phone setup downloaded the official Termux OpenSSH/sshpass packages, rewrote same-length `/data/data/com.termux` payload and script paths, rebuilt local debs, and installed those patched archives. This historical path was removed after the SSHJ transport became complete.
- Added SSHJ as the first Play-compliant app-owned SSH transport. Reconnect/session listing, readiness checks, session actions, session creation, rename, and image upload now use Java SSH/SFTP instead of Termux `ssh`/`sshpass`/`scp`; visible terminal attach still needs a follow-up PTY bridge before phone-side OpenSSH setup can be removed completely.
- The Play-compliant app-owned SSH transport uses SSHJ with AndroidConfig and filters out Curve25519/X25519 key exchange factories. Android's active BouncyCastle provider can reject X25519 before SSHJ negotiates another algorithm, while macOS OpenSSH supports the remaining ECDH/DH algorithms needed for Ghostex Android connections.
- The app-owned SSH transport replaces Android's process-local platform `BC` provider with the bundled BouncyCastle provider before constructing SSHJ clients. Some Android platform `BC` providers reject `EC`, which breaks ECDH key exchange even after Curve25519 is disabled.
- Remote session attach now uses an SSHJ-backed interactive PTY registered as a normal Termux session instead of spawning Termux-installed `sshpass` and `ssh`. This keeps tap-to-attach compatible with target SDK 35 and preserves drawer switching, warm-session reuse, service notification lifetime, and normal finished-session cleanup.
- SSHJ-backed attach now starts a shell channel after PTY allocation and execs the Mac-side login-shell command inside that shell, matching a real `ssh -tt` terminal more closely than a direct SSH exec channel for interactive `zmx attach`.
- The PTY pixel-geometry and SSHJ auto-expand experiment did not change the resize crash, so it was reverted. Attach diagnostics now record resize counts, stdin/stdout byte counters, SSH channel window values, terminal queue wait time, and the source operation for non-attach `zmx=none` SSH calls.
- Resize diagnostics showed SSHJ `window-change` was writing to the network socket from Android's UI thread during pinch zoom, causing `NetworkOnMainThreadException`. Remote PTY resize now runs on a single background worker and coalesces rapid zoom/layout resize events.
- After SSHJ attach, actions, readiness, create/rename, and SFTP upload proved viable, the phone-side OpenSSH/sshpass installer and preflight were removed. Setup now explains the built-in SSHJ transport, and host-key reset clears SSHJ's persisted host-key fingerprint instead of editing Termux `known_hosts`.
- The default Android runtime package id changed to `io.ghostex`. It is the same byte length as `com.termux`, so the bootstrap prefix patch remains valid while package-visible Android surfaces now spell Ghostex correctly.
- The Android launcher/app-drawer label changed from `Ghostex Android` to `Ghostex`. Android-specific docs and explanatory copy can still say Ghostex Android, but system-facing app labels should use the short product name.
- Activity resume reconnect is suppressed while the foreground terminal is already a warm Ghostex attach session. Manual Retry still refreshes the drawer, but normal app resume should not open extra `zmx=none` inventory SSH sessions while an attached terminal is active.
- Added persistent Ghostex Android attach diagnostics in the single shareable file `Downloads/ghostex/ghostex-android.log`. Each line includes a timestamp and ZMX session tag (`zmx=<sidebar alias> sessionId=<stable id>`) and records SSH connect/auth, PTY allocation, remote command start, EOF, exit status, signal/error metadata, close errors, and the log path without writing saved SSH passwords.
- The Android logger now removes legacy `ghostex-android.previous.log`, duplicate `ghostex-android*.log` MediaStore entries, and older app-private fallback copies before appending new diagnostics, so the phone should expose only `Downloads/ghostex/ghostex-android.log`.
- Android Downloads can rewrite text/plain `.log` files as `ghostex-android.log.txt` and then allocate numbered `(N)` copies. The logger now treats every `ghostex-android*` Downloads row as one log family, normalizes the kept row to `application/octet-stream`, deletes the rest, and appends to the kept row.

## Verification Notes 2026-05-17

- Build verification passes locally for unit tests, debug APK, lint, and release APK. The release merged manifest was inspected after the release-surface change and confirms the unused Termux IoT alias, file share/view aliases, documents provider, open-file provider, and run-command service are disabled and non-exported.
- Latest local release validation passes with `npm run android:verify-release:local`, including Mac-side `ghostex android-check --json`, root CLI tests, Android harness syntax checks, Ghostex Android unit tests, instrumentation-test compilation, release APK, release AAB, APK/AAB checksum verification, release lint, and release gates.
- The strict `npm run android:verify-release` path passes the same local checks and then stops at the intended connected-device gate in this environment because no Android device/emulator is reachable over adb. Final release proof still requires running the live E2E and first-run UI smoke harnesses on an attached disposable Android device or emulator.
- Generated APKs are under `android/termux-app/app/build/outputs/apk/debug` and `android/termux-app/app/build/outputs/apk/release`.
- Local release APK generation may be unsigned unless `GHOSTEX_ANDROID_SIGNING_STORE_FILE`, `GHOSTEX_ANDROID_SIGNING_STORE_PASSWORD`, `GHOSTEX_ANDROID_SIGNING_KEY_ALIAS`, and `GHOSTEX_ANDROID_SIGNING_KEY_PASSWORD` are configured. Distribution jobs should also set `GHOSTEX_ANDROID_REQUIRE_RELEASE_SIGNING=1`; configured keystores must exist outside `android/termux-app`.
- Runtime smoke verification now passes on a local Android 35 ATD emulator for bootstrap install, app launch, no default local Termux login/shell process on fresh Ghostex startup, custom first-run tutorial display, scrollable tutorial step cards, first-run Done-to-Add-Machine handoff, custom machine settings display, Add Machine launch from settings, styled add-machine credential panels, styled saved-machine cards, styled explicit password prompt, Ghostex drawer display, drawer recovery state card display, styled machine action sheet display, styled destructive machine confirmation display, add-machine dialog validation, session-only password entry while Save password is unchecked, password-save field enablement, styled phone setup panel display, inline phone setup check status, and missing-SSH-tools recovery messaging.
- Runtime smoke screenshots are stored in `/tmp/ghostex-android-smoke/` for the custom first-run tutorial, first-run Done-to-Add-Machine handoff, custom empty machine settings, styled add-machine dialog, styled machine settings with a saved machine, styled password prompt, styled machine action sheet, styled delete-machine confirmation, session-only password dialog state, drawer state card, styled phone setup panel, styled phone setup check state, and setup preflight state.
- The Ghostex Android device E2E harness now compiles with `:app:compileDebugAndroidTestJavaWithJavac`, its release-presence gate runs during `:app:assembleRelease`, and `tools/ghostex-android-device-e2e.sh --help` documents the live Tailscale/macOS inputs required to run the final network proof.
- The live Android E2E password staging path now reads the private debug-app password file to EOF before deleting it, preserving long QA secrets while keeping the password out of command-line arguments and shared storage.
- The release E2E harness gate now checks for that EOF password read loop so the final-release verifier catches regressions before a connected-device run.
- End-to-end remote attach verification is still pending because this environment does not have a real Tailscale-connected macOS host with SSH, Ghostex CLI, and ZMX sessions available to the emulator.
- `aapt dump badging` confirms the release APK label is `Ghostex Android`; the package name remains `com.termux` because the current Termux bootstrap path is hardcoded to `/data/data/com.termux/files/usr`. The Gradle bootstrap-prefix gate now enforces this. Shipping under a separate package id requires matching Ghostex-specific bootstrap and package repository artifacts, not just a manifest rename.

## CLI Gap Assessment

- Android now depends on machine-readable CLI output and documented stable-id commands: `sessions --json`, `attach --session-id`, focus/wake/sleep/kill `--session-id --json`, and `rename-session --session-id --title --json`.
- Avoid Android-specific fallback parsing of human-readable CLI tables; if data is missing from JSON, add it to the CLI response.

## UI Direction

- Recreate the macOS sidebar card hierarchy in Android native views: project/group headers, session cards, status, title, provider metadata, and last active state.
- Translate hover affordances into centered long-press context menus.
- Keep the overlay visually polished over the terminal while preserving terminal readability and touch targets.
- Remove ordinary Termux drawer controls that conflict with the Ghostex remote-session model, especially the drawer keyboard button.
