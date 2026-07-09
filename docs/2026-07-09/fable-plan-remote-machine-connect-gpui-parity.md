# Plan: Remote machine connect — port macOS implementation to the gpui app

## Overall goal

The macOS app's remote-machine-connect feature works reliably; the gpui app's port of it
fails intermittently. Bring the gpui implementation into behavioral parity with the macOS
app, which is the **source of truth**. Where the two differ, change gpui to match macOS —
do not invent improvements macOS does not have, and do not change any macOS app code.

Source-of-truth files (READ ONLY, never modify):
- `native/macos/ghostexHost/Sources/ghostexHost/RemoteGxserverClient.swift` (all native remote logic)
- `native/macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift` (command dispatch, remote parts)
- `native/sidebar/native-sidebar.tsx` (renderer-side status/presentation handling, remote parts)
- `shared/gxserver-protocol.ts`, `shared/ghostex-settings.ts` (shared contracts — already shared with gpui)

gpui files to change:
- `gpui/src/main.rs` (single large file; all Rust remote transport lives here)
- `gpui/sidebar/gxserver-runtime.ts` (renderer-side remote runtime)

## Rules every worker must follow

- **No tests.** Do not add any test code anywhere in `gpui/` or the macOS app trees. If a
  change breaks an existing test elsewhere, do not write new tests to compensate.
- **No fallbacks.** Never solve a problem by adding a fallback path; fix the behavior at
  the source. If macOS has exactly one code path, gpui gets exactly one code path.
- **Never run the app.** Do not run `bun run start`, `bun run gpui`, or anything that
  starts or restarts Ghostex. Verification is `cargo check` (run inside `gpui/`) and
  `bun run typecheck` (repo root) plus code reading only.
- **Preserve the privacy boundary.** The gpui renderer (TypeScript) must never receive
  SSH hosts, users, ports, identity paths, tokens, or raw error output. Status events
  carry bounded state enums and sanitized messages only, exactly as today.
- The worktree contains unrelated uncommitted changes (in `gpui/src/main.rs`,
  `gpui/sidebar/gxserver-runtime.ts`, and others). Never revert, stash, or clean anything;
  only make targeted edits for your phase.
- Line numbers below were captured on 2026-07-09 and may drift slightly; locate symbols
  by name if a line does not match.
- macOS parity means **exact behavioral parity**: same command strings modulo naming,
  same timeouts, same retry counts, same state names on the wire, same ordering of
  operations. When in doubt, open the Swift/TSX reference and mirror it.

## Phase 1: SSH process execution and token-read parity

- depends_on: []
- parallel_ok: false
- goal: Audit gpui's SSH subprocess layer and token acquisition side-by-side against the
  macOS app's and eliminate every behavioral difference. IMPORTANT correction from the
  orchestrator: macOS itself wraps every SSH remote command in a `zsh -lic` login shell
  (`loginShellRemoteCommand`, RemoteGxserverClient.swift ~1566, applied inside `runSsh`
  ~1443), macOS `runProcess` (~1484) polls `isRunning` every 0.05s and reads pipes only
  after exit (124 on deadline), and macOS `extractRemoteAuthToken` (~1707) DOES have
  fallbacks (markers first, then first 32+ char token run, then trimmed stdout). Those
  are the source-of-truth behaviors — keep gpui matching them. Do NOT "fix" or redesign
  them; this phase is about finding and removing real drift, not improving on macOS.
- files: `gpui/src/main.rs` only (functions: `gpui_run_remote_process` ~line 69859,
  `gpui_run_remote_ssh` ~67330, scp runner ~67356, `gpui_remote_token_read_command`
  ~66876, `gpui_login_shell_remote_command` ~67465, `gpui_extract_remote_gxserver_token`
  ~66833, `gpui_is_valid_remote_gxserver_token` ~66868, `gpui_remote_ssh_client_options`
  ~67390, related constants ~62646-62678).
- do_not_touch: install/upload functions (`gpui_install_bundled_remote_gxserver_and_read_token`
  and below, Phase 4 owns those), tunnel/health functions (~69917+, Phase 2 owns those),
  presentation stream functions (~82061+, Phase 3 owns those), `gpui/sidebar/**`, all
  macOS app files.
- approach:
  1. Read the macOS reference first: `RemoteGxserverClient.swift` — `runProcess` (~1484),
     `runSsh` (~1431), `runScp` (~1452), `remoteTokenReadCommand` (~501),
     `loginShellRemoteCommand` (~1566), `shellSingleQuoted` (~1583),
     `sshTargetArguments` (~1548), `extractRemoteAuthToken` (~1707), `isValidAuthToken`
     (~1703), `sshClientOptions` (~1368), `makeSshAskpassScript` (~1395),
     `sanitizedProcessFailure` (~1717), `processLaunchInputIsSafe` (~1524).
  2. For each gpui counterpart (`gpui_run_remote_process`, `gpui_run_remote_ssh`, scp
     runner, `gpui_remote_token_read_command`, `gpui_login_shell_remote_command`,
     `gpui_extract_remote_gxserver_token`, `gpui_is_valid_remote_gxserver_token`,
     `gpui_remote_ssh_client_options`, askpass handling, sanitized failure mapping, NUL
     guard) do a line-by-line comparison with the Swift and correct any drift in gpui:
     command strings, argument order, option sets, quoting/escaping, marker strings,
     exit-code semantics (127 not installed / 126 token unreadable / 124 timeout / 126
     askpass-prep failure), poll interval, stdin handling (`/dev/null`), environment
     handling, and timeout values (token read 18s, probe 12s, etc.).
  3. Process runner parity specifically: match macOS semantics — launch with piped
     stdout/stderr and null stdin, poll aliveness on a 0.05s interval until the
     deadline, on deadline overrun terminate and return exit 124 with the macOS timeout
     message shape, otherwise read the pipes to end after exit. If gpui's runner
     deviates from that in any observable way (ordering, kill signal handling, partial
     reads, error mapping), align it to macOS. Do not introduce concurrent draining or
     other enhancements macOS does not have.
  4. Login-shell wrapper parity: gpui must produce the same wrapper chain as
     `loginShellRemoteCommand` (`/bin/zsh -lic` if present, else `zsh -lic` from PATH,
     else `/bin/sh -lc`), with identical single-quote escaping, applied at the same
     layer (inside the ssh runner for every remote command).
  5. Token extraction parity: markers first, then first `[A-Za-z0-9_-]{32,}` run, then
     trimmed stdout; `isValidAuthToken` (`^[A-Za-z0-9_-]{32,}$`) applied where macOS
     applies it (in `finishConnectWithTokenResult`, mapping invalid to tokenUnavailable).
  6. SSH client options parity for both auth modes: key-only auth uses `BatchMode=yes`;
     saved-password auth disables BatchMode, sets `NumberOfPasswordPrompts=1` and the
     askpass helper reading the Keychain; `UseKeychain=yes`,
     `StrictHostKeyChecking=accept-new`, `ConnectTimeout=8`. Do not add options macOS
     does not set (no ServerAliveInterval etc. unless the Swift has it).
  7. Port the NUL-byte launch-input guard if gpui lacks it (`processLaunchInputIsSafe`),
     and the sanitized stderr-to-message mapping (`sanitizedProcessFailure`) if gpui's
     differs.
  8. If after the audit a gpui function is already exactly equivalent, leave it alone
     and note that in your completion summary. An outcome of "few or no code changes,
     drift list documented" is acceptable for this phase if that is what the audit shows.
- acceptance_criteria:
  - `cd gpui && cargo check` completes with no new errors or warnings introduced by this phase.
  - The token-read command string, login-shell wrapper chain, and marker strings in gpui
    match `remoteTokenReadCommand` + `loginShellRemoteCommand` in
    `RemoteGxserverClient.swift` modulo language syntax (verify by side-by-side read).
  - Token extraction and validation order in gpui match `extractRemoteAuthToken` +
    `isValidAuthToken` including the macOS fallback order (side-by-side read).
  - SSH client options in gpui match `sshClientOptions` in Swift for both key and
    password auth modes, with no extra options (side-by-side read).
  - Process-runner semantics (poll interval, deadline handling, exit 124 mapping, null
    stdin, post-exit pipe reads) match Swift `runProcess` (side-by-side read).
  - The completion summary lists every drift found and fixed, and every function
    confirmed already-equivalent.

## Phase 2: Connection lifecycle, single-connection semantics, and state parity

- depends_on: [1]
- parallel_ok: false
- goal: Make connect/reconnect/stop semantics match macOS: exactly one live connection
  and at most one in-flight connect attempt per machine, prior tunnel and stream torn
  down before a new connect, superseded attempts never clobber newer ones or leak ssh
  children, and the full macOS status-state vocabulary reported to the renderer.
- files: `gpui/src/main.rs` (functions: `handle_gpui_reconnect_remote_machine_message`
  ~26192, `gpui_connect_remote_gxserver` ~66655 and `_platform_inner` ~66703,
  `finish_gpui_reconnect_remote_machine` ~26269, `stop_gpui_remote_gxserver_connection`
  ~27959, `stop_all_gpui_remote_gxserver_connections` ~27965, state enum
  `GpuiRemoteGxserverConnectState` ~65568, `gpui_open_remote_gxserver_tunnel` ~69917,
  `gpui_wait_for_remote_authenticated_health` ~70008, connection struct ~2336,
  keychain save ~66757). Renderer-visible status strings may require a small matching
  update in `gpui/sidebar/gxserver-runtime.ts` status handling — allowed, keep minimal.
- do_not_touch: SSH exec/token functions Phase 1 owns (do not rework them; call them),
  presentation stream internals (~82061+, Phase 3), install functions (Phase 4), macOS files.
- approach:
  1. Read macOS reference: `RemoteGxserverClient.swift` `connectSynchronously` (~281),
    `terminateExistingConnection` (~316 caller, ~1604 impl — kills prior tunnel AND
    cancels prior websocket subscription), `openTunnel` (~1083),
    `waitForAuthenticatedHealth` (~1284), `storeTokenInKeychain` (~1615), status
    emission (~408, ~432, ~481). Also `native-sidebar.tsx`
    `handleRemoteGxserverStatusEvent` (~4424) for the exact status state strings the
    renderer consumes.
  2. Introduce a per-machine connect epoch/generation: each
     `handle_gpui_reconnect_remote_machine_message` bumps it, records it in the spawned
     task, and `finish_gpui_reconnect_remote_machine` discards results whose epoch is
     stale (killing any tunnel child the stale attempt created). This gives macOS
     single-connection semantics under rapid reconnect clicks with no leaked ssh
     processes. The macOS serial-queue model (`connect` runs on a serial dispatch queue)
     is the behavior to reproduce; an epoch guard plus up-front
     `stop_gpui_remote_gxserver_connection` is the idiomatic Rust equivalent.
  3. Ensure stop tears down BOTH the tunnel child and the presentation stream cancel
     flag before a new connect proceeds (parity with `terminateExistingConnection`).
  4. Verify tunnel parity against `openTunnel`: 8 attempts, random local port in
     42000-58999, `ExitOnForwardFailure=yes`, 0.35s liveness sleep + early-exit check,
     health wait 7s deadline with 0.2s poll issuing authenticated
     `GET /api/health/server` with Bearer token and protocol-version header, 1s
     per-request timeout. Fix any drift.
  5. State vocabulary parity: the set of states macOS can emit to its renderer is:
     `connecting`, `connected`, `invalid`, `sshFailed`, `installApprovalRequired`,
     `installFailed`, `unsupportedRemotePlatform`, `tokenUnavailable`, `keychainFailed`,
     `tunnelFailed`, `presentationSubscribeFailed`, `presentationStreamFailed`,
     `downloadingRemoteServerPackage` (with progress), plus install/download progress
     statuses. Extend `GpuiRemoteGxserverConnectState` and the status strings dispatched
     to the renderer to cover this set with the same names on the wire, and map exit
     codes the same way macOS does (127 without approval -> installApprovalRequired;
     126 -> tokenUnavailable). Remove gpui-only names that macOS never emits if they
     duplicate a macOS state (keep `unsupported` for non-macOS builds).
  6. Keychain parity: token stored under service `com.madda.ghostex.remote-gxserver-token`
     keyed by remoteMachineId, matching Swift `storeTokenInKeychain`.
- acceptance_criteria:
  - `cd gpui && cargo check` passes with no new errors/warnings.
  - Code inspection shows a per-machine epoch/generation checked in
    `finish_gpui_reconnect_remote_machine`, and the stale-attempt path kills its tunnel
    child (no leak).
  - The gpui state enum plus wire status strings cover exactly the macOS state set above
    (side-by-side read against `handleRemoteGxserverStatusEvent` in
    `native/sidebar/native-sidebar.tsx` and the Swift emit sites).
  - Tunnel constants (attempt count, port range, sleeps, health deadline/poll/timeouts)
    match the Swift values (side-by-side read).
  - Exit-code -> state mapping matches macOS (127/approval, 126) — verify
    `gpui_remote_token_read_failure_state` against Swift ~328/~408.

## Phase 3: Presentation stream recovery and renderer snapshot/delta parity

- depends_on: [2]
- parallel_ok: false
- goal: Stop dropping the machine when the presentation websocket hiccups. Match macOS:
  a stream failure emits `presentationStreamFailed` while the tunnel/connection stays
  up, and the renderer runs a debounced recovery (refresh snapshot + resubscribe from
  lastRevision). Also match macOS delta/snapshot bookkeeping so deltas are never
  silently lost and stale snapshots never clobber newer state.
- files: `gpui/src/main.rs` (presentation stream: `start_gpui_remote_gxserver_presentation_stream`
  ~27896, generation counter ~27875, foreground event loop ~27915,
  `gpui_remote_gxserver_presentation_stream_loop` ~82061, `_once` ~82089, websocket open
  ~82139, subscribe send ~82211, constants ~62669-62673) and
  `gpui/sidebar/gxserver-runtime.ts` (`handleGpuiSidebarRemoteEvent` ~2809, snapshot/delta
  handling ~2841-2876, `publishRemotePresentationPatch` ~4016,
  `refreshRemotePresentationFromGxserver` ~10602, `reconnectRemoteMachine` ~10305).
- do_not_touch: SSH exec/token functions (Phase 1), connect/tunnel lifecycle beyond what
  recovery requires (Phase 2 owns; you may call its stop/status helpers), install
  functions (Phase 4), macOS files.
- approach:
  1. Read macOS reference: `native-sidebar.tsx` `handleRemoteGxserverStatusEvent` (~4424:
     on `presentationStreamFailed` -> `scheduleRemoteGxserverPresentationRecovery`),
     `scheduleRemoteGxserverPresentationRecovery` (~4645: 500ms debounce -> refresh
     snapshot via `/api/readPresentationSnapshot` -> resubscribe with lastRevision),
     `handleRemoteGxserverPresentationEvent` (~4666: snapshot stored; delta applied via
     `reduceGxserverPresentationDelta` only when revision strictly increases; delta with
     missing base snapshot triggers a snapshot refresh, not a silent drop; ~4700),
     `startRemoteGxserverPresentationSubscription` (~4606), subscription dedupe via
     `remotePresentationSubscribedMachineIds` (~1458). Swift side:
     `subscribePresentationSynchronously` (~1183) and `receivePresentationMessages`
     (~1241): websocket failure emits `presentationStreamFailed` — it does NOT tear down
     the tunnel or the connection.
  2. Rust: change the stream loop so exhausting its reconnect attempts dispatches a
     `presentationStreamFailed` status for the machine WITHOUT calling
     `stop_gpui_remote_gxserver_connection` and WITHOUT marking the machine failed. The
     connection (tunnel + RPC target) stays live, matching macOS. Keep the existing
     generation guard so stale streams stay inert.
  3. TS runtime: on `presentationStreamFailed`, schedule a 500ms debounced recovery per
     machine (parity with `scheduleRemoteGxserverPresentationRecovery`): refresh the
     snapshot via the existing remote RPC, then ask Rust to resubscribe the stream
     passing the last known revision. Add the Rust message handler for resubscription if
     one does not exist (reuse `start_gpui_remote_gxserver_presentation_stream` with a
     fresh generation). Dedupe so only one recovery timer per machine exists.
  4. TS runtime delta parity: when a delta arrives with no base snapshot or a
     non-monotonic revision, trigger a snapshot refresh for that machine (macOS ~4700)
     instead of silently dropping. When an RPC snapshot refresh returns, do not
     overwrite `remotePresentations[id]` if the stored revision is already newer than
     the snapshot's revision (prevents the stream/refresh race from clobbering state).
  5. Machine-level failure stays where macOS has it: RPC/transport-level failures (the
     macOS `ok === false` path, native-sidebar ~4477) clear subscription and snapshot
     and surface the failure toast. Websocket-stream failures alone never remove the
     machine.
  6. Verify the subscribe frame parity: `subscribePresentation` message with `clientId`
     and optional `lastRevision`, websocket URL `/api/events?protocolVersion=1&authToken=...`
     matching Swift.
- acceptance_criteria:
  - `cd gpui && cargo check` passes and `bun run typecheck` (repo root) passes.
  - Code inspection: stream-attempt exhaustion dispatches `presentationStreamFailed` and
    does not call `stop_gpui_remote_gxserver_connection` or emit a `failed` machine status.
  - Code inspection: TS handles `presentationStreamFailed` with a 500ms debounced
    refresh-plus-resubscribe (one timer per machine), passing lastRevision through to a
    fresh Rust stream subscription.
  - Code inspection: delta-with-missing-base and non-monotonic-revision paths trigger a
    snapshot refresh; RPC snapshot writes are revision-guarded against clobbering.
  - Subscribe frame and websocket URL parameters match the Swift implementation
    (side-by-side read).

## Phase 4: Install flow parity

- depends_on: [3]
- parallel_ok: false
- goal: Make the install-if-missing path match macOS: stale-listener cleanup, the same
  remote install script semantics (atomic release switch, CLI links), the same package
  selection order including on-demand download with integrity verification, and the same
  progress/status reporting.
- files: `gpui/src/main.rs` (install functions: `gpui_install_bundled_remote_gxserver_and_read_token`
  ~66896, probe command ~66924, `gpui_bundled_remote_gxserver_package_dir` ~66970,
  upload/install helpers and timeout constants ~62656-62658,
  `gpui_remote_token_read_failure_state` ~66782). If packaging resources are needed for
  on-demand manifests, `gpui/build.rs` and `gpui/scripts/build-macos-app.sh` may be
  touched minimally.
- do_not_touch: Phase 1-3 owned functions except calling them; macOS app files;
  `Web/on-demand-resources.json` (read-only input).
- approach:
  1. Read macOS reference: `RemoteGxserverClient.swift` install path — exit-code
     handling (~318-432), `probeRemoteInstallTarget` (~772) and
     `extractRemoteInstallTarget` (~796), `bundledGxserverPackageURL` (~820),
     `onDemandGxserverArchive` (~972: version-pinned GitHub release tarball, SHA256
     verified against the sealed `Web/on-demand-resources.json`, cached under
     Application Support `Ghostex/on-demand/<version>/`, quarantine xattr stripped,
     atomic move), `installBundledGxserverAndReadToken` (~583),
     `installGxserverArchiveAndReadToken` (~656), the remote install script (~696), and
     `remoteStopStaleGxserverListenerCommand` (~523: stops the prior package's server
     and kills only a verified Ghostex-owned listener on fixed port 58744).
  2. Port the stale-listener stop into the gpui install script so reinstall over a
     half-dead server works (identical command semantics).
  3. Make the gpui remote install script match macOS: unpack into `releases/<id>`,
     atomically retarget the `package` symlink, link tools into `~/.local/bin`, write
     the `ghostex` CLI wrapper, then re-run the token read command.
  4. Package selection parity: bundled package first (dev/bundled priority as macOS
     defines it for a packaged app — note gpui policy: packaged-only, no dev-checkout
     fallback, keep that), else on-demand download with SHA256 verification against the
     sealed manifest, cached, with `downloadingRemoteServerPackage` progress statuses
     dispatched to the renderer (Phase 2 added the state). Timeouts: archive 60s,
     upload 120s, install 45s, download 900s, tar 60s — match macOS values where they
     differ.
  5. Exit-code state mapping: after this phase, 127 with `installApproved=true` should
     attempt install (bundled then on-demand) and only fail with `installFailed`/
     `unsupportedRemotePlatform` per macOS semantics — the current gpui
     `InstallUnavailable` shortcut for missing bundled package must be replaced by the
     on-demand path. If the gpui app packaging genuinely cannot carry or resolve the
     on-demand manifest, print PHASE 4 BLOCKED with the specific packaging gap instead
     of inventing an alternative distribution mechanism.
  6. Install debug logging stays in the existing gpui support-log channel
     (`support_logs.rs` RemoteGxserverInstall) with the same privacy constraints (no
     hosts, paths, or tokens).
- acceptance_criteria:
  - `cd gpui && cargo check` passes with no new errors/warnings.
  - The gpui remote install script contains the stale-listener stop, `releases/<id>`
    unpack, atomic `package` symlink retarget, `~/.local/bin` links, and `ghostex`
    wrapper (side-by-side read against Swift ~523/~583/~656/~696).
  - Package selection implements bundled-then-on-demand with SHA256 verification against
    `Web/on-demand-resources.json` and local caching, or the phase is BLOCKED with a
    concrete packaging gap.
  - Exit-code -> state mapping after install matches macOS (no InstallUnavailable
    shortcut when on-demand is possible).

## Handoff notes

(appended by the orchestrator as phases complete)

- Phase 1 COMPLETE: SSH layer audited side-by-side against Swift; token-read command,
  markers, login-shell wrapper, extraction fallback order, SSH/SCP options and askpass
  were already equivalent. Fixed drift only in: NUL launch-input guard (added),
  process environment replacement, signal exit status, and timeout termination in
  `gpui_run_remote_process`. Only `gpui/src/main.rs` changed; `cargo check` passes.
- Phase 2 COMPLETE: per-machine connect generations added; stale connect completions
  terminate their own tunnel children and never clobber a newer connect. Reconnect
  teardown (tunnel + presentation cancel flag) runs before each new connect. Rust state
  enum and renderer status vocabulary extended to the macOS state names
  (presentationStreamFailed, presentationSubscribeFailed, downloadingRemoteServerPackage,
  etc.). Exit 126 now maps to tokenUnavailable. Tunnel constants and keychain service
  already matched Swift. cargo check + bun run typecheck pass.
- Phase 3 COMPLETE: Rust stream-attempt exhaustion now emits presentationStreamFailed
  without stopping the tunnel or failing the machine. New renderer-to-Rust resubscribe
  message carries clientId + optional lastRevision. Renderer debounces recovery 500ms,
  refreshes the snapshot, then resubscribes. Delta with missing base or non-monotonic
  revision triggers snapshot refresh; RPC snapshot writes are revision-guarded.
  cargo check + bun run typecheck pass.
- Phase 4 COMPLETE: bundled-then-on-demand package selection with sealed-manifest
  SHA256 verification, local cache, curl download, xattr strip, and download status
  dispatch. Remote install script matches macOS (stale-listener cleanup, UUID release
  dir, atomic package symlink retarget, tool links, ghostex/gx wrapper). Approved-127
  InstallUnavailable shortcut removed. gpui packaging stages the on-demand manifest.
  cargo check, bun run typecheck, and bash -n gpui/scripts/build-macos-app.sh pass.

## Verifier findings round 1

FINDING 1 (phase 2, exit-code state mapping): `gpui/src/main.rs` ~line 67056 maps
token-read exit code `(126, _)` to `GpuiRemoteGxserverConnectState::TokenUnavailable`
with a 126-specific message (~67072-67074). The Swift source of truth
(`native/macos/ghostexHost/Sources/ghostexHost/RemoteGxserverClient.swift` ~327 and
~416-427) only special-cases exit 127; every other nonzero token-read exit, including
126, returns state `sshFailed` with `sanitizedProcessFailure(defaultMessage: "Remote
gxserver SSH setup failed.")`. Swift emits `tokenUnavailable` only for an invalid
extracted token after exit 0 (~442-456), which gpui already mirrors separately
(~67015-67021). The plan's earlier Phase 2 note saying "126 -> tokenUnavailable" was
wrong; follow the actual Swift.

Fix for FINDING 1: delete the `(126, _)` match arm in
`gpui_remote_token_read_failure_state` so exit 126 falls through to the existing
catch-all `SshFailed` arm and its existing sanitized message path
(`gpui_remote_token_read_failure_message` ~67075-67078); remove any now-dead
126-specific message code; then run `cd gpui && cargo check`.
