# Plan: Make gpui T3 Chat sessions match macOS app behavior (fix /pair bounce)

## Overall goal

In the gpui app (`gpui/`), opening a T3 Chat session currently loads the T3 web UI at
`http://127.0.0.1:3774` in the embedded CEF Browser tab **unauthenticated**, so the T3
web app bounces to its `/pair` route ("Pair with this environment", pairing-token form).
In the macOS app the user never sees `/pair`: the native host authenticates the webview
BEFORE navigation by exchanging a native credential for a browser-session cookie and
installing that cookie into the webview's cookie store. Port that exact behavior to gpui.

Source of truth: the macOS app implementation. Do not invent alternative auth schemes
(no query-param tokens on the route URL, no localStorage injection, no `window.desktopBridge`
shims, no navigating to `/pair#token=`). The T3 web app's auth gate
(`t3code/apps/web/src/environments/primary/auth.ts` — `bootstrapServerAuth`) only accepts:
an existing browser-session cookie, a desktopBridge bootstrap credential (not present in
our CEF), or manual token entry on `/pair`. The macOS app uses the cookie path; gpui must too.

### macOS source-of-truth spec (read these before coding)

All in `native/macos/ghostexHost/Sources/ghostexHost/`:

- `NativeT3CodePaneReproLog.swift` — despite the name, this is the core implementation
  (~3,776 lines), not a log:
  - `enum NativeT3RuntimeBrowserAuth` (line ~3193): the embedded-pane auth chain,
    `prepareManagedWebSession` (~3218):
    1. `checkSession`: GET `/api/auth/session` (~3244). If already authenticated AND the
       native side holds an owner bearer → done. A stale cookie alone is NOT trusted
       (comment ~3280-3285).
    2. Owner bearer comes from bootstrap-token exchange — POST `/oauth/token` form-encoded,
       `grant_type=token-exchange`, subject type `urn:t3:params:oauth:token-type:environment-bootstrap`
       (~3326-3421). NOTE for gpui: this minting already lives in the gxserver-rs daemon
       (`gxserver-rs/src/t3_runtime.rs`, `spawn_owner_bearer_mint_task` ~509-542); gpui reads
       the persisted token from `~/.ghostex/t3-runtime/auth-state.json` via
       `gpui_wait_for_t3_owner_bearer_token` (`gpui/src/main.rs:69387`). Do NOT re-implement
       minting in gpui; reuse the daemon + persisted-token read.
    3. `exchangePairingCredential` (~3532): POST `/api/auth/pairing-token` with
       `Authorization: Bearer <ownerBearer>`, JSON body `{}`, cookies disabled → single-use
       `credential`.
    4. `exchangeBrowserCredential` (~3432): POST `/api/auth/browser-session` JSON
       `{"credential": "..."}` → parse the response `Set-Cookie` headers (~3472) and install
       them into the webview cookie store (~3631-3658). Navigation happens ONLY after the
       cookies are installed.
    - Auth exchanges are serialized (one at a time, others queue, ~3232-3238); up to
      40 attempts @ 0.5s (~3196, ~3609-3628).
    - 401 during exchange with a native bootstrap → discard token, force-replace the runtime,
      retry (~3390-3410).
  - `enum NativeT3RuntimeSessionBootstrap` (~2602): thread-route resolution (gpui already
    mirrors this as `gpui_local_t3_session_route_url`, `gpui/src/main.rs:69795`).
- `TerminalWorkspaceView.swift`:
  - `loadWebPane` (~17701): the load gate — `prepareManagedWebSession` (auth) →
    `prepareThreadRoute` (URL) → `webView.load(...)` (~17794) → `scheduleWebPaneReload`
    (16 attempts, ~17795).
  - `retryT3ThreadRouteIfStartupIsStillSettling` (~17872): up to 80 retries @ 0.5s on
    transient errors — 404 / 503 / timeout / "owner bearer not ready" (~17919-17932).
  - `reloadManagedT3WebPanes(reason:)` (~17820): after a runtime replacement/spawn, re-run
    the FULL auth + route bootstrap for live T3 panes and reload them.
  - `handleT3WebPaneRuntimeFailure` (~17934): terminal failure state.
- `AppDelegate.swift` `startT3CodeRuntime` (~4020, ~4422): on a NEW runtime spawn calls
  `reloadManagedT3WebPanes(reason: "runtimeSpawned")`.

### gpui current state (where to integrate)

All in `gpui/src/main.rs` unless noted:

- `GPUI_T3_LOCAL_SERVER_ORIGIN = "http://127.0.0.1:3774"` (:68961).
- Entry points that end in navigation (ALL must be authenticated):
  1. Sidebar focus: `SidebarBridgeEvent::T3SessionFocus` (:32455) →
     `receive_sidebar_t3_session_focus_payload` (:32810) →
     `gpui_prepare_local_t3_session_route` (:69091) → `open_gpui_t3_session_browser_url` (:32880).
  2. Sidebar create: `receive_sidebar_t3_session_create_payload` (:32841) →
     `gpui_create_local_t3_session` (:68963) → same open call (:32866).
  3. Tab-bar create: `create_t3_session_from_workspace_tab_bar` (:38740).
- `open_gpui_t3_session_browser_url` (:32880) sets `TitlebarMode::Browser` and calls
  `commit_browser_address` (:24189) → `load_browser_cef_url_for_pane` → `CefSurface::load_url`
  (`gpui/src/cef/shell.rs:2537`).
- Loopback HTTP helper: `gpui_t3_loopback_json_request` (:69703) — raw HTTP over TcpStream,
  loopback-only, Bearer auth. `gpui_read_t3_owner_bearer_token` (:69610),
  `gpui_wait_for_t3_owner_bearer_token` (:69387), runtime start
  `gpui_ensure_local_t3_runtime_started` (:69359) → daemon POST `/api/t3Runtime/start`.
- Pairing-credential minting already exists for Remote Access:
  `gpui_issue_t3_browser_access_link` (:69441) POSTs `/api/auth/pairing-token`. Reuse the
  request shape, but the embedded flow must then exchange the credential at
  `/api/auth/browser-session` instead of building a `/pair#token=` link.
- CEF: `gpui/src/cef/shell.rs`. Browser request contexts are per-profile with
  `persist_session_cookies: 0` (:2716) and empty cache_path — this is a privacy requirement
  (no DURABLE cookies). In-memory session cookies for the live process are fine and are
  exactly what the browser-session cookie is. The cef crate (path dep
  `/Users/madda/dev/_references/cef-rs/cef`) exposes `CookieManager` with `set_cookie` and
  `flush_store`, `cookie_manager_get_global_manager`, and request-context cookie managers
  (bindings in `src/bindings/aarch64_apple_darwin.rs`, `CookieManager` ~8863,
  `cookie_manager_get_global_manager` ~57351). `set_cookie` completes via a callback —
  navigation must be gated on completion (macOS gates load on cookie install; do the same).

### Repo rules for all workers

- NO tests anywhere under `gpui/` or the macOS app — do not add test code.
- NO fallbacks that mask the real fix (e.g. do not "fall back to showing /pair"): fix the
  root cause. The ONLY acceptable terminal state on unrecoverable failure is the explicit
  failure handling described in Phase 2.
- Never run `bun run start` or any command that restarts/launches the Ghostex or gpui app.
- Do not commit, stage, revert, or clean anything. The worktree has unrelated uncommitted
  changes from other agents — leave every file you are not told to touch exactly as it is.
- Rust changes must compile: prove with
  `cargo check --manifest-path /Users/madda/dev/_active/Ghostex/gpui/Cargo.toml` (expect
  pre-existing warnings; no new errors).
- Match surrounding code style; gpui T3 code has explicit "macOS parity" comments — keep
  that convention (cite the Swift function you are mirroring).

---

## Phase 1: Embedded browser-session cookie auth for T3 CEF tabs
- depends_on: []
- parallel_ok: false
- goal: Port `NativeT3RuntimeBrowserAuth.prepareManagedWebSession` to gpui so every T3
  session navigation installs a valid T3 browser-session cookie into the CEF Browser tab's
  cookie store BEFORE loading the thread/draft route. After this phase, opening or creating
  a T3 session in gpui lands on the chat UI, never on `/pair`.
- files: `gpui/src/main.rs`, `gpui/src/cef/shell.rs` (and, only if a new bridge surface is
  genuinely required, `gpui/src/cef/sidebar_bridge_manifest.rs` — expected NOT needed).
- do_not_touch: `gpui/sidebar/**` (TS side already correct), `gxserver-rs/**`,
  `native/**`, `shared/**`, `t3code/**`, anything outside `gpui/src/`.
- approach:
  1. In `gpui/src/main.rs`, add `gpui_prepare_t3_browser_session(...)` (background/blocking
     context, same executor pattern as `gpui_prepare_local_t3_session_route`), mirroring
     `prepareManagedWebSession`:
     a. GET `/api/auth/session` via `gpui_t3_loopback_json_request`. If response says
        authenticated AND `gpui_read_t3_owner_bearer_token()` returns a token → return Ok
        (cookie already installed earlier in this process; note CEF cookies are per-profile
        in-memory, so also track/verify that this process already installed a cookie for the
        target profile — a plain "session authenticated" from a cookieless Rust HTTP client
        will NOT reflect the webview's cookie state; the session check must be performed
        WITH the cookies currently installed in the CEF store, or simply keep a process-local
        record of which browser profile already completed the exchange, matching the spirit
        of the macOS "native holds owner bearer + session authenticated" gate).
     b. Ensure runtime started (`gpui_ensure_local_t3_runtime_started`) and wait for owner
        bearer (`gpui_wait_for_t3_owner_bearer_token`).
     c. POST `/api/auth/pairing-token` with Bearer owner token, body `{}` (reuse the request
        shape from `gpui_issue_t3_browser_access_link` :69441; use a distinct client label
        for the embedded pane, e.g. "Ghostex Embedded", if the API accepts a label).
     d. POST `/api/auth/browser-session` with JSON `{"credential": <credential>}`; capture
        ALL `Set-Cookie` response headers. `gpui_t3_loopback_json_request` parses JSON bodies —
        extend it (or add a sibling helper) to also return response headers; keep it
        loopback-only.
     e. Parse each Set-Cookie into name/value/path/domain/expiry (host is 127.0.0.1; secure
        flag will be absent on http — preserve HttpOnly). Hand them to a new CEF-side API.
     f. Retry/serialization parity: single in-flight exchange (queue concurrent callers),
        bounded retries 40 × 500ms on transient failures; on 401 minting the pairing token,
        force runtime replacement via the daemon start endpoint and retry (mirror Swift
        ~3390-3410).
  2. In `gpui/src/cef/shell.rs`, add cookie installation: given the target tab's request
     context (the same profile/request context the Browser tab's `CefSurface` uses — follow
     how `CefSurface::new` builds its request context ~2702-2716), obtain its cookie manager
     (request-context `get_cookie_manager`; fall back to
     `cookie_manager_get_global_manager` ONLY if the tab genuinely uses the global context),
     call `set_cookie` for each parsed cookie with the T3 origin URL
     (`http://127.0.0.1:3774/`), and signal completion once all `set_cookie` callbacks have
     fired (then `flush_store` is unnecessary for in-memory stores but harmless). Expose this
     to main.rs as an async-completable operation. Respect the privacy audit comments: do not
     enable cookie persistence, do not log cookie values or tokens.
  3. Gate navigation on the exchange: in all three entry points (focus :32810, sidebar
     create :32841, tab-bar create :38740), the flow must be: prepare browser session
     (cookie installed) → resolve route URL → `open_gpui_t3_session_browser_url`. The
     cleanest shape: perform the cookie preparation inside the same background task that
     already prepares the route (`gpui_prepare_local_t3_session_route` /
     `gpui_create_local_t3_session`) BEFORE returning the URL, then have
     `open_gpui_t3_session_browser_url` ensure the CEF-side install has completed for the
     target surface before `commit_browser_address`. Keep ordering airtight: cookie install
     must complete before `CefSurface::load_url` fires for the T3 URL. Watch the lazy
     surface-creation path (`ensure_browser_surface_for_tab` :24269): if the surface is
     created during navigation with the URL passed to `browser_host_create_browser_sync`
     (:2392), cookies must be installed in the profile's cookie manager BEFORE that creation,
     or the surface must be created with a neutral URL first and then navigated.
  4. Keep the Remote Access `/pair#token=` flow (`gpui_issue_t3_browser_access_link`)
     untouched — it serves external devices and is correct.
- acceptance_criteria:
  - `cargo check --manifest-path /Users/madda/dev/_active/Ghostex/gpui/Cargo.toml` completes
    with no new errors.
  - `rg -n "browser-session" gpui/src/main.rs` shows the new exchange, and reading the code
    confirms: pairing credential minted with owner bearer → POST `/api/auth/browser-session`
    → Set-Cookie parsed → CEF cookie install → completion-gated navigation, with the
    40×500ms retry + single-flight serialization and the 401→force-runtime-replace path.
  - All three entry points (`receive_sidebar_t3_session_focus_payload`,
    `receive_sidebar_t3_session_create_payload`, `create_t3_session_from_workspace_tab_bar`)
    route through the cookie preparation before any T3 URL reaches `commit_browser_address` /
    `load_url` / browser-surface creation; verified by reading each call chain.
  - The live auth chain works end-to-end (proves the endpoints + payload shapes the Rust code
    uses): with the T3 runtime running (start it via
    `curl -s -X POST http://127.0.0.1:<gxserver-port>/api/t3Runtime/start` only if needed —
    NEVER by launching the app; the gxserver daemon port is discoverable from
    `~/.ghostex/` state / `ghostex state`),
    `BEARER=$(python3 -c "import json;print(json.load(open('$HOME/.ghostex/t3-runtime/auth-state.json'))['ownerBearerToken'])")`;
    `CRED=$(curl -s -X POST http://127.0.0.1:3774/api/auth/pairing-token -H "Authorization: Bearer $BEARER" -H 'Content-Type: application/json' -d '{}' | python3 -c "import sys,json;print(json.load(sys.stdin)['credential'])")`;
    `curl -si -X POST http://127.0.0.1:3774/api/auth/browser-session -H 'Content-Type: application/json' -d "{\"credential\":\"$CRED\"}"` returns Set-Cookie header(s); and
    `curl -s http://127.0.0.1:3774/api/auth/session -H "Cookie: <that cookie>"` reports an
    authenticated session. (Adjust field names to what the API actually returns — inspect the
    JSON; the criterion is: credential → browser-session cookie → authenticated session.)
  - No cookie values, credentials, or bearer tokens are written to logs (grep the new code
    for log statements).

## Phase 2: Startup-settling retries, runtime-replacement reload, and failure state
- depends_on: [1]
- parallel_ok: false
- goal: Match macOS lifecycle behavior around the load: transient startup errors retry
  instead of showing a broken tab; a replaced/respawned runtime causes open T3 tabs to
  re-authenticate and reload; unrecoverable failure surfaces an explicit failure state.
- files: `gpui/src/main.rs` (and `gpui/src/cef/shell.rs` only if a reload hook is missing).
- do_not_touch: `gpui/sidebar/**`, `gxserver-rs/**`, `native/**`, `shared/**`, `t3code/**`,
  and the Phase 1 auth-exchange internals except where integration requires calling them.
- approach:
  1. Route-settling retries: wrap the route/auth preparation used by all three entry points
     with the macOS retry policy from `retryT3ThreadRouteIfStartupIsStillSettling`
     (`TerminalWorkspaceView.swift` ~17872): retry on 404, 503, connection-refused/timeout,
     and owner-bearer-not-ready, up to 80 attempts @ 500ms, then fail terminally. Reuse — do
     not duplicate — whatever partial retry logic Phase 1 added inside the auth exchange;
     the settling retry is about the ROUTE + runtime availability layer.
  2. Runtime-replacement reload: gpui learns a runtime spawn happened from
     `gpui_ensure_local_t3_runtime_started` (:69359) — the daemon response indicates whether
     an existing responsive runtime was adopted or a new one spawned (inspect
     `gxserver-rs/src/t3_runtime.rs` response shape; read-only). When a NEW runtime spawned
     while T3 browser tab(s) are already open on the T3 origin, mirror
     `reloadManagedT3WebPanes(reason: "runtimeSpawned")`: re-run the full Phase 1 auth
     exchange (old cookies are now invalid), then reload the affected tab(s) with a freshly
     resolved route URL. Find open T3 tabs by checking browser tab URLs against
     `GPUI_T3_LOCAL_SERVER_ORIGIN`.
  3. Failure state: when preparation fails terminally (retries exhausted / non-transient
     error), mirror `handleT3WebPaneRuntimeFailure`: do NOT navigate the tab to the T3
     origin (that would show /pair or a dead page). Follow the existing gpui error-surfacing
     convention used by the current code when `gpui_prepare_local_t3_session_route` fails
     (inspect `receive_sidebar_t3_session_focus_payload` :32810 error arm) and make it
     consistent across all three entry points; a visible toast/log-line per existing app
     conventions is sufficient. No silent hangs.
- acceptance_criteria:
  - `cargo check --manifest-path /Users/madda/dev/_active/Ghostex/gpui/Cargo.mtoml`
    — typo guard: use `gpui/Cargo.toml` — completes with no new errors.
  - Reading the code confirms: bounded 80×500ms settling retry on the documented transient
    errors, wired into all three entry points; single implementation, no copy-paste triplication.
  - Reading the code confirms: new-spawn detection from the daemon start response triggers
    re-auth + reload of open T3-origin tabs, and adopted-existing-runtime does NOT trigger it.
  - Reading the code confirms: terminal failure never navigates the tab to the T3 origin and
    surfaces the error via the existing convention in all three entry points.

## Handoff notes

(append per-phase COMPLETE summaries here before launching the next phase)
