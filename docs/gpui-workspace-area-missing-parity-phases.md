# GPUI Workspace Area Missing Parity Phases

<!--
CDXC:GPUIWorkspaceParityHandoff 2026-06-22-18:49:
This handoff splits the remaining GPUI workspace-area parity gaps into orchestrator-sized phases after the placeholder-shell pass captured the shell-level macOS behavior. The next orchestrator should continue from the existing GPUI shell, preserve current placeholder behavior until each real surface is ready, and avoid fallback project detection or overlapping hit-test workarounds.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-13:33:
The handoff intro must not imply final workspace-area parity or signoff while Source, Kanban, and Manage real surfaces still depend on explicit readiness and mount contracts. Describe prior work as shell-level capture only so placeholder paths stay until their real surfaces are verified.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-14:19:
The continuation must use one worker at a time only; even read-only planning for later phases should be queued instead of spawned in parallel. Slices should be larger bounded bundles when dependency order allows so progress is faster without weakening privacy, no-fallback/project-detection, non-overlap layout, and validation-ban constraints.

CDXC:GPUIProjectSidebarBridge 2026-06-23-15:12:
After slice 199, Phase 1 is no longer a wholly pending bridge. The strict sidebar active-project bridge can carry explicit project context plus identity-only Source, Kanban, and gated Manage ids derived from the explicit project-editor identity. Those ids are not readiness, URL, CEF, file-bridge, or mount contracts, and they do not unblock the real Source, Kanban, or Manage surfaces.

CDXC:GPUIProjectSidebarBridge 2026-06-23-15:18:
Slice 201 keeps Browser identity out of the Phase 1 active-project contract. Rust must reject `browserWorkareaId` even when Browser availability is true; later Browser identity/readiness work must stay in a separate boundary instead of widening Phase 1.

CDXC:GPUIProjectSidebarBridge 2026-06-23-19:19:
Slice 234 mirrors the Phase 1 Browser exclusion at the TypeScript payload boundary. The exported surface-id type and helper allow only Source, Kanban, and gated Manage identity in active-project payloads; Browser readiness remains the separate source-only boundary and this does not claim validation or a Browser identity product contract.

CDXC:GPUIProjectSidebarBridge 2026-06-23-15:25:
After slices 200-202, Phase 1 can hand off to Phase 2 as source-side bridge work. The live strict active-project snapshot, identity-only Source/Kanban/gated Manage ids, Browser id rejection, latest-valid snapshot preference over env fallback, malformed/duplicate-payload guard, and titlebar availability/active-mode fallback behavior are represented in source, but no runtime/app validation has been run. Later slices keep Browser identity outside Phase 1 by contract and retire the Browser source-ledger gates while runtime checks remain outside this workflow.

CDXC:GPUIValidationHandoff 2026-06-23-15:44:
The user made the no-validation step persistent for this continuation. Agents must not schedule formatting, tests, checks, whitespace validation, app launch/restart, browser automation, visual automation, or equivalent validation/app commands as a later worker step; keep those as outside-workflow records rather than queued work.

CDXC:GPUIRuntimeTransfer 2026-06-23-16:02:
Cross-surface movement across Agents terminal runtime, Command pane terminal runtime, Browser, Source, Kanban, and Manage is currently shell-only title, identity, tab/card, or placeholder movement. Real runtime/process/content transfer remains a deferred product decision until explicit mount/runtime contracts exist, and it must not move Ghostty processes, CEF content, file-editor state, command payload/status, terminal buffers, clipboard callbacks, focus/key identity, private runtime data, or user-owned content.

CDXC:GPUIRuntimeTransfer 2026-06-23-17:25:
Slice 223 refines the cross-surface handoff into source-only evidence categories: Agents/command visible-title placeholders, tab/group/card shell movement, identity-only Source/Kanban/gated Manage movement, Browser profile/tab shell identity preservation, and the no-runtime-transfer privacy boundary. Missing gates are the allowed-family product decision, per-source/target mount/runtime contracts, terminal runtime/process transfer contract, Browser CEF content transfer contract, Source file-editor/runtime transfer contract, Kanban/Manage CEF/file-bridge transfer contracts, and runtime transfer privacy proof.

CDXC:GPUIRuntimeTransfer 2026-06-24-04:15:
Slice 253 accepts the cross-surface source ledger as shell-only movement with no live runtime/process/content transfer families allowed in this source-only pass. Because no runtime family is allowed, per-source/target runtime contracts and terminal, Browser, Source, Kanban, and Manage family transfer contracts are intentionally not required unless future product work enables live transfer.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-17:30:
Slice 224 consolidates slices 218-223 as a handoff status refresh. The guardrail ledger is split into source-only evidence versus missing real product, bridge, mount, runtime, privacy, and external-evidence gates; future queueing should target those real gates rather than more source-only guardrail splitting unless a concrete source/docs mismatch appears.

CDXC:GPUIPhase10BlockerLedger 2026-06-24-04:29:
Slice 254 reconciles current handoff wording after slices 250, 252, and 253. No source-ledger blockers remain; Source, Kanban, Manage, and Browser runtime instantiation/checking remains user-side/outside this workflow, Browser Phase 1 still rejects browserWorkareaId by contract, import stays unsupported/no-op unless future importer work is explicitly requested, blank/script-created popup transfer remains no-transfer, Browser lifecycle remains CEF-only hide-and-hold/restored-placeholder evidence, terminal physical-key/product behavior is accepted without runtime key-forwarding changes, cross-surface transfer is accepted as shell-only/no-live-runtime-transfer, and validation/app commands are not queued.

CDXC:GPUIKanbanPlaceholderReplacement 2026-06-24-05:22:
Slice 260 adds a Kanban placeholder-replacement preflight gate formed from existing Kanban CEF mount request/runtime-parity evidence. Future Kanban CEF runtime work must pass this CEF-only gate before replacing the colored placeholder, and current source still denies replacement because no runtime URL, CEF browser, normal-layout CEF surface, hidden mount, private runtime data, or explicit replacement permission exists.

CDXC:GPUIManagePlaceholderReplacement 2026-06-24-05:27:
Slice 261 adds a Manage placeholder-replacement preflight gate formed only from the existing source-only Manage CEF/file-bridge runtime-parity plan. Future Manage runtime work must pass this CEF-only gate before replacing the colored placeholder, and current source still denies replacement because no issued runtime URL, CEF browser, normal-layout CEF surface, runtime file bridge, runtime file operation, CEF/file-bridge payload, hidden mount, private runtime data/logging/persistence, or explicit replacement permission exists; rejected WKWebView/WebKit/non-CEF labels must not be retained in privacy JSON.

CDXC:GPUIProjectWorkareaPaneEngine 2026-06-24-05:45:
Slice 262 adds a central source-only Source/Browser/Kanban/Manage pane-engine policy. The source ledger counts these panes for runtime parity only when existing evidence exposes CEF as the web-pane engine, rejects WKWebView/WebKit/non-CEF/candidate labels without retaining rejected labels in safe JSON, and leaves runtime checking to the user without CEF instantiation, code-server startup, file-bridge mounting, file I/O, hidden surfaces, private logging/persistence, or placeholder replacement.

CDXC:GPUIProjectWorkareaCefSlots 2026-06-24-05:58:
Slice 263 adds source-side Source/Kanban/Manage CEF surface ownership slots keyed only by safe surface kind after the existing ready runtime-parity and placeholder-preflight gates. The slots are not runtime instantiation: Browser remains excluded because it already uses tab-owned CEF, Phase 10 tracks the slot boundary separately from the pane-engine policy, no URL is issued, no CefSurface is created, no file bridge or file I/O is mounted, no hidden surface or private payload/logging/persistence is added, and no placeholder is replaced.

CDXC:GPUIProjectWorkareaRuntimeUrlIssuance 2026-06-24-06:13:
Slice 264 adds source-side Source/Kanban/Manage runtime URL issuance decisions after ready runtime-parity, placeholder-preflight, and ownership-slot evidence. The decisions remain CEF-only and normal-layout-only, keep Browser excluded because Browser uses tab-owned CEF, require a real URL authority before any future issued URL, and currently report no authority, no issued URL, no retained URL value, no CefSurface creation, no code-server/file-bridge/file-I/O payload, no hidden/offscreen mount, no private runtime data/logging/persistence, and no placeholder replacement.

CDXC:GPUIProjectWorkareaSourceStartupNavigationReadiness 2026-06-24-06:24:
Slice 265 adds source-side Source startup navigation readiness evidence derived only from the Source runtime URL issuance decision. It keeps Source/code-mode CEF-backed and normal-layout-only, records that first code-server navigation remains deferred until a future runtime readiness gate succeeds and an issued runtime URL exists, excludes Browser/Kanban/Manage because non-code destinations do not use this wait, and still adds no direct Source navigation, URL value, URL scheme/host payload, code-server startup, CefSurface creation, hidden/offscreen mount, fallback probe, private payload, logging/persistence, placeholder replacement, validation, or app check.

CDXC:GPUIProjectWorkareaSourceRuntimeCefSurfaceOwnerGate 2026-06-24-06:37:
Slice 266 adds source-side Source runtime CEF surface owner/creation-gate evidence derived only from Source startup navigation readiness and wired into the Source render/refresh path. It records future replacement prerequisites: runtime readiness, real URL authority, issued runtime URL, code-server process availability, normal-layout CEF surface creation, and explicit replacement permission, while current source creates no CEF/file-bridge/runtime surface, stores no URL/private payload, starts no code-server, mounts no hidden/offscreen view, adds no WKWebView/WebKit/non-CEF path, and runs no validation.

CDXC:GPUIProjectWorkareaKanbanRuntimeCefSurfaceOwnerGate 2026-06-24-06:49:
Slice 267 adds source-side Kanban runtime CEF surface owner/creation-gate evidence derived only from the Kanban runtime URL issuance decision and wired into the Kanban render/refresh path. It records future replacement prerequisites: real URL authority, issued runtime URL, normal-layout CEF surface creation, and explicit replacement permission, while current source creates no CEF/runtime surface, stores no URL/private payload, mounts no hidden/offscreen view, adds no WKWebView/WebKit/non-CEF path, and runs no validation.

CDXC:GPUIProjectWorkareaManageRuntimeCefSurfaceOwnerGate 2026-06-24-07:00:
Slice 268 adds source-side Manage runtime CEF/file-bridge owner/creation-gate evidence derived only from the Manage runtime URL issuance decision and wired into the Manage render/refresh path. It records future replacement prerequisites: real URL authority, issued runtime URL, normal-layout CEF surface creation, runtime file-bridge mounting, runtime file-operation execution, and explicit replacement permission, while current source creates no CEF/file-bridge/runtime surface, stores no URL/private/file payload, mounts no runtime bridge or hidden/offscreen view, runs no file operation, adds no WKWebView/WebKit/non-CEF path, and runs no validation.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:10:
Slice 269 clarifies that Source, Kanban, and Manage owner gates are accepted source-ledger guardrails after slice 268, not current source-ledger blockers. Runtime CEF/file-bridge creation and placeholder replacement remain future runtime work outside this no-validation source-ledger workflow.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:18:
The user now accepts source-only work as runtime parity for this pass and will perform runtime checks later. Treat Source, Browser, Kanban, and Manage CEF-only source contracts as the current parity target; terminal is accepted as working; future web-pane work must stay CEF-only and must not add WKWebView/WebKit/non-CEF paths.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:49:
Slice 280 aligns active handoff docs with the source comments from slice 279. Source, Browser, Kanban, and Manage source-ledger CEF contracts are accepted for this pass; future web-pane runtime replacement must be explicit, CEF-only, normal-layout-only, privacy-safe, and must not add WKWebView/WebKit/non-CEF paths, while runtime checks remain user-side.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:55:
Slice 281 keeps active Phase 5-7 handoff wording from reopening source-ledger blockers after the 07:18 source-only/CEF-only acceptance requirement. Source CEF/code-server, Kanban CEF, and Manage CEF/file-bridge source contracts are accepted for this pass, while actual runtime CEF/code-server/file-bridge instantiation, runtime URL issuance, file I/O, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work with no WKWebView/WebKit/non-CEF path.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-08:04:
Slice 283 keeps active Phase 1, Phase 2, and Phase 4 acceptance wording aligned with the current source-only parity requirement. Source-ledger bridge and terminal evidence are accepted for this pass, terminal is accepted as working, validation/app/check commands stay banned, runtime checks remain user-side, and all future web panes must be CEF-only with no WKWebView/WebKit/non-CEF path.

CDXC:GPUIProjectSidebarBridge 2026-06-24-09:22:
Phase 1 source-side bridge evidence counts as the source-only runtime-parity unit for this pass. Keep validation, app launch/restart, visual automation, and running-app proof as user-side checks without reopening Phase 1 or weakening the Browser identity exclusion.

CDXC:GPUISourceReadiness 2026-06-23-16:10:
Slice 213 creates the GPUI-side Source readiness contract as source-only boundary code: versioned type, explicit activeProjectId, explicit sourceWorkareaId, and loading/ready/loadFailed state only. It must not carry URLs, paths, code-server details, logs, persistence, fallback localhost probes, CEF creation, or placeholder replacement; stale or malformed readiness cannot mutate current runtime state.

CDXC:GPUISourceCefCodeServerMount 2026-06-23-21:43:
Slice 243 added a source-only Source CEF/code-server mount-request boundary keyed to the exact ready Source runtime identity. Slice 245 supersedes its first-party entrypoint gap with a fixed app-resource entrypoint contract, slice 246 supersedes the process gap with a source-only app-resource launch-plan contract, slice 247 supersedes the URL gap with source-ledger URL-boundary evidence, and slice 248 supersedes the CEF materialization source-ledger gap. The visible Source path remains placeholder-only without URL/path/project-name/.git/fixture/localhost inference, runtime CEF browser creation, or fallbacks.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-02:53:
Slice 245 recognizes the fixed app-resource code-server entrypoint and Node runtime resource labels for Source requests. Slice 246 recognizes a source-only app-resource process launch plan from the exact ready Source request, slice 247 recognizes source-ledger URL-boundary evidence without issuing a runtime URL value, and slice 248 recognizes a CEF-only source-ledger materialization contract. The visible Source path remains placeholder-only because runtime CEF browser instantiation and placeholder replacement are still absent.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-02:59:
The Source process launch-plan evidence is source-only and non-spawning. It must not allocate ports, issue URLs, probe localhost, create CEF, mount hidden surfaces, persist/log process details, or carry cwd, args, env, pid, stdout/stderr, paths, raw URLs, terminal content, or project data.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-03:06:
The Source code-server URL gap is retired only as source-ledger URL-boundary evidence formed from exact ready Source runtime identity, fixed app-resource entrypoint, and non-spawning process launch plan. It is not a runtime URL and must not carry hostname, localhost/127.0.0.1, port, token, query, fragment, path, project data, process detail, CEF payload, log, persistence, hidden mount, or placeholder replacement.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-03:12:
The Source CEF materialization source-ledger gap is retired only as a CEF-only source-ledger contract formed after exact ready Source identity, fixed app-resource entrypoint, non-spawning launch plan, and source-ledger URL-boundary evidence. It is not runtime CEF browser creation, issued URL, code-server startup, logging/persistence, private payload, validation, or placeholder replacement.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-04:34:
Slice 255 adds a source-only Source CEF/code-server runtime-parity plan formed only after the exact ready Source request already has app-resource entrypoint, non-spawning launch-plan, URL-boundary, and CEF-only materialization evidence. This counts for the source ledger, accepts only CEF as the web-pane engine, rejects non-CEF labels by contract, and still leaves actual CEF/code-server runtime instantiation, runtime URL issuance, hidden mounts, validation, logging/persistence, and placeholder replacement outside this workflow.

CDXC:GPUISourcePlaceholderReplacement 2026-06-24-05:20:
Slice 259 adds a Source placeholder-replacement preflight gate formed from the existing Source CEF/code-server request/runtime-parity evidence. Future Source runtime work must pass this CEF-only gate before replacing the colored placeholder, and the current gate denies replacement because there is no runtime code-server process, issued runtime URL, instantiated CEF browser, normal-layout CEF surface, or explicit replacement permission; it must not add WKWebView/WebKit/non-CEF paths, hidden mounts, private payloads, logs/persistence, fallback probes, validation, or runtime instantiation.

CDXC:GPUIProjectWorkareaReadiness 2026-06-23-16:17:
Slice 214 creates the GPUI-side Kanban/Manage readiness contract as source-only boundary code: versioned type, `kanban`/`manage` surface, explicit activeProjectId, explicit surfaceId, and mounting/ready/loadFailed state only. It must not carry URLs, paths, file names, file contents, failure details, logs, persistence, fallback probes, file I/O, CEF mounts, or placeholder replacement; stale or malformed readiness cannot mutate current runtime state.

CDXC:GPUIKanbanWorkareaParity 2026-06-23-16:59:
Slice 219 historically reconciled Phase 6 at the real Kanban web-surface mount blocker; slice 239 supersedes the old macOS-specific web-surface target with CEF. Later Kanban request, entrypoint, materialization, runtime-parity, placeholder-preflight, URL-boundary, and owner-gate slices accept source-ledger CEF contracts for this pass, but readiness remains parser/store evidence only and must not be widened into URL/path/CEF payloads, fallback probes, logging, persistence, CEF creation, hidden surfaces, placeholder replacement, or synthetic mount state.

CDXC:GPUIKanbanCefMount 2026-06-23-21:32:
Slice 241 adds a source-only Kanban CEF mount-request boundary keyed to exact active-project plus Kanban surface identity. Slice 249 supersedes the first-party entrypoint gap with a fixed CEF app-resource label, slice 250 supersedes the source-ledger materialization gap with a CEF-only contract, slice 256 adds source-only runtime-parity acceptance with CEF as the only accepted web-pane engine, and slice 260 adds the placeholder-replacement preflight gate. This is not runtime CEF browser creation, URL/path acceptance, hidden-surface creation, fallback probing, placeholder replacement, non-CEF engine usage, retained rejected-engine labels, logging, persistence, or running evidence.

CDXC:GPUIKanbanCefMount 2026-06-24-03:32:
Phase 6 now has a source-only first-party CEF entrypoint contract for exact-identity Kanban requests, represented only by safe app-resource and CEF labels. Do not list the Kanban first-party entrypoint as a current source-ledger blocker; keep placeholders until a future runtime CEF browser path exists.

CDXC:GPUIKanbanCefMount 2026-06-24-03:41:
Phase 6 now has a CEF-only source-ledger materialization contract for exact-identity Kanban requests after the fixed first-party CEF app-resource entrypoint exists. Do not list Kanban CEF materialization as a current source-ledger blocker; keep the runtime caveat explicit because no runtime CEF browser, runtime URL, hidden mount, validation, logging/persistence, private payload, or placeholder replacement exists.

CDXC:GPUIKanbanCefMount 2026-06-24-04:49:
Phase 6 now has Kanban source-only runtime parity acceptance after exact ready identity, fixed first-party CEF app-resource entrypoint, and CEF-only source-ledger materialization evidence exist. It counts for the source ledger with CEF as the only accepted web-pane engine and non-CEF labels rejected by contract, but it still does not create a runtime CEF browser, issue/store a runtime URL, mount hidden surfaces, log/persist private data, run validation, or replace the placeholder.

CDXC:GPUIKanbanPlaceholderReplacement 2026-06-24-05:22:
Phase 6 now has a centralized Kanban placeholder-replacement preflight gate after source-only runtime parity. It reports `canReplaceKanbanPlaceholder:false` until a future runtime slice proves an issued runtime URL, instantiated CEF browser, normal-layout CEF surface, no hidden mount, no private runtime data, and explicit replacement permission, and it must not add WKWebView/WebKit/non-CEF paths, fallback probes, logs/persistence, validation, or runtime instantiation.

CDXC:GPUIBrowserWorkareaReadiness 2026-06-23-16:24:
Slice 215 creates the GPUI-side Browser active-project/readiness contract as source-only boundary code outside Phase 1: versioned type, explicit activeProjectId, explicit browserWorkareaId, and loading/ready/loadFailed state only. It must not make browserWorkareaId valid in the active-project snapshot, carry URLs, paths, titles, profile names or paths, cookies, history, imported content, failure details, logs, persisted private data, fallback probes, CEF request-context data, CEF mounts/materialization, Browser tab/profile/popup creation, import work, or placeholder replacement; stale or malformed readiness cannot mutate current runtime state.

CDXC:GPUIBrowserRuntimeParity 2026-06-23-17:15:
Slice 221 reconciled Phase 8 Browser and the Phase 10 Browser guardrail ledger as source-only evidence only. Slice 252 and slice 258 now accept Browser source-ledger CEF contracts for this pass while preserving generated profile/tab shell state, feedback injection boundaries, restored-placeholder no-op policy, unsupported/no-op import, blank-popup no-transfer, hide-and-hold, sanitized persistence, and strict readiness parser/store evidence; runtime checks and future Browser CEF lifecycle changes remain user-side/future explicit work.

CDXC:GPUIBrowserRuntimeParity 2026-06-24-04:10:
Slice 252 records explicit Browser source-only contracts accepted for this pass. The Phase 1 contract continues to reject browserWorkareaId while strict Browser readiness owns Browser identity, compatible import remains unsupported/no-op, blank/script-created popup transfer remains no-op/no-transfer, and lifecycle remains CEF-only hide-and-hold plus restored-placeholder evidence with no runtime CEF creation, URL issuance, suspend/teardown, hidden mount, fallback probe, private logging/persistence, placeholder replacement, or WKWebView/WebKit/non-CEF path.

CDXC:GPUIBrowserRuntimeParity 2026-06-24-09:09:
Slice 305 aligns the active Browser handoff with the tightened privacy JSON shape from slice 304. Browser runtime-parity evidence exposes only the accepted `cef` engine label plus generic unsupported-engine rejection; WKWebView/WebKit-specific capability fields stay absent, and runtime CEF checks remain user-side.

CDXC:GPUIManageFileWorkareaBridge 2026-06-23-16:35:
Slice 216 creates the GPUI-side Manage file/workarea operation request contract as source-only boundary code separate from readiness: versioned type, explicit activeProjectId, explicit manageWorkspaceId, and operation-name string only. It must not carry args, paths, file names, file contents, URLs, raw JSON payloads, command args, stdout/stderr, failure details, tokens, credentials, cookies, env values, CEF state, bridge/runtime payloads, file I/O, logs, persisted private data, CEF/file-bridge mounts, fallback probes, or placeholder replacement; stale, wrong-surface, Quick/projectless, malformed, extra-key, or private-shaped requests cannot mutate the stored decision.

CDXC:GPUIManageWorkareaParity 2026-06-23-17:09:
Slice 220 historically recorded Phase 7 at the real Manage web-surface plus file-bridge mount step; slice 239 supersedes the old macOS-specific web-surface target with CEF, slice 251 adds accepted source-ledger CEF materialization, file-bridge mount, and file-operation proof contracts, slice 257 adds source-only runtime-parity acceptance, and slice 261 adds placeholder-replacement preflight gating. Current runtime Manage remains caveated because no CEF browser, runtime URL, file bridge, file I/O, validation, runtime check, or placeholder replacement was added.

CDXC:GPUIManageCefMount 2026-06-23-21:36:
Slice 242 adds a source-only Manage CEF mount-request boundary keyed to exact active-project plus Manage surface identity. Slice 250 adds the first-party CEF app-resource entrypoint label, slice 251 adds source-ledger CEF materialization, file-bridge mount, and file-operation proof contracts, slice 257 adds source-only runtime-parity evidence with CEF as the only accepted web-pane engine, and slice 261 adds the placeholder-replacement preflight gate. This is not runtime CEF materialization, file-bridge creation, URL/path acceptance, operation-args acceptance, hidden-surface creation, fallback probing, placeholder replacement, file I/O, logging, persistence, non-CEF engine usage, retained rejected-engine labels, or running evidence.

CDXC:GPUIManageCefMount 2026-06-24-03:41:
Slice 250 adds a source-only first-party CEF app-resource entrypoint label to exact-identity Manage requests. Slice 251 supersedes the remaining Manage source-ledger CEF/file-bridge/proof gates, slice 257 adds source-only runtime-parity acceptance, and slice 261 adds source-only placeholder-replacement preflight acceptance; do not list Manage CEF materialization, file-bridge mount, project-scoped file-operation proof, source-only runtime parity, or placeholder-replacement preflight as current source-ledger blockers. Runtime CEF/file-bridge creation, file I/O, URLs, paths, private payloads, logging/persistence, hidden mounts, and placeholder replacement remain absent.

CDXC:GPUIManageCefMount 2026-06-24-04:55:
Phase 7 now has Manage source-only runtime parity after exact ready identity, the fixed first-party CEF app-resource entrypoint, CEF-only materialization, source-only file-bridge mount, and project-scoped file-operation proof evidence exist. It counts for the source ledger with CEF as the only accepted web-pane engine and non-CEF labels rejected by contract, but it still does not create a runtime CEF browser, issue/store a runtime URL, mount a runtime file bridge, run file operations, create CEF/file-bridge payloads, log/persist private data, mount hidden surfaces, run validation, or replace the placeholder.

CDXC:GPUIManagePlaceholderReplacement 2026-06-24-05:27:
Phase 7 now has a centralized Manage placeholder-replacement preflight gate after source-only runtime parity. It reports `canReplaceManagePlaceholder:false` until a future runtime slice proves an issued runtime URL, instantiated CEF browser, normal-layout CEF surface, runtime file bridge, runtime file operation, no CEF/file-bridge payload, no hidden mount, no private runtime data/logging/persistence, and explicit replacement permission, and it must not add WKWebView/WebKit/non-CEF paths, fallback probes, logs/persistence, validation, runtime instantiation, or retained rejected labels.

CDXC:GPUIProjectSidebarBridge 2026-06-23-18:29:
Slice 231 adds a source-only sidebar-scoped safe external bridge into the strict Source, Browser, Kanban/Manage readiness stores and Manage operation-request store. The bridge is allowlisted to fixed one-string `window.ghostexGpui` functions and ordinary Browser CEF pages do not receive it; real Source CEF/code-server mount, Kanban/Manage CEF or file-bridge mounts, Browser runtime evidence, and validation outside this agent workflow remain separate.

CDXC:GPUITerminalActivationRuntimeGuard 2026-06-23-18:12:
Slice 229 records restored shell-state `presentationState:"mounting"` as presentation-only/non-startup-eligible while preserving runtime-created startup eligibility for new terminal Mounting sessions and in-process failed-startup retry. The restore path must not infer startup eligibility, launch data, wake/materialize/reattach success, duplicate runtime sessions, logs, terminal content, or persistent runtime data from shell JSON.

CDXC:GPUITerminalStartupRetryIdentity 2026-06-23-18:19:
Slice 230 adds source-only evidence for failed-startup retry attempt identity. Explicit retry rotates the process-local Agents runtime id for the same durable shell session before retry startup sync/intent; sleeping and popped-out activation stay non-startup-eligible, and restored-unmounted materialization must not rotate as a retry attempt.

CDXC:GPUITerminalRestoredMaterialization 2026-06-23-19:26:
Slice 235 credits only the source-side restored-unmounted materialization startup contract. Explicit restored activation becomes startup-eligible Mounting through the existing startup candidate/body-slot/launch-plan/completion-intent path while keeping the current process-local runtime id; restored shell-state `mounting` after restart stays presentation-only. Slice 236 handles sleeping wake and popped-out reattach through a separate source-only parked-owner contract, and slice 239 accepts the combined terminal evidence for the source-ledger purpose.

CDXC:GPUTerminalParkedOwnerReattach 2026-06-23-19:41:
Slice 236 credits only the source-side runtime parked-owner contract for Agents Sleeping wake and PoppedOutPlaceholder reattach. The contract parks an existing Running AppKit host view plus Ghostty surface owner when the shell presentation leaves the visible Running path, then moves that exact owner for the same durable shell session and process-local runtime id to current body geometry after explicit activation without startup maps, launch payloads, runtime id rotation, fallback surface creation, or duplicate running ownership. Slice 239 accepts this terminal evidence for the source-ledger purpose while keeping validation and physical-key identity separate.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-20:44:
Source-only runtime parity evidence may now satisfy the GPUI source-ledger purpose when it matches current source/runtime contracts. Keep blockers for explicit missing contracts and product/API decisions; do not keep blockers solely because accepted evidence is source-only.

CDXC:GPUIProjectWorkareaParity 2026-06-23-20:44:
GPUI must use CEF for Kanban and Manage panes. Future work should target Source CEF/code-server, Kanban CEF, Manage CEF, and the separate Manage file-bridge contracts without claiming real CEF mount implementation exists.

CDXC:GPUITerminalLifecycle 2026-06-23-20:44:
The user accepts terminal as working for the source-ledger purpose. Terminal source/runtime evidence is no longer blocked by generic app/runtime acceptance wording, and slice 253 later accepts the physical-key/product difference for the source ledger without changing runtime input.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-24-04:15:
Slice 253 accepts current terminal physical-key/product behavior for the source ledger without runtime/key-forwarding changes. GPUI still lacks native keycode/UIEvents-code identity, physical keys are not synthesized from layout-only key data, Control/Cmd physical-key cases stay rejected by the existing helper, and committed key_char, IME, preedit, and text-service paths remain current behavior.

CDXC:GPUIPhase10BlockerLedger 2026-06-23-21:50:
Source-only runtime parity is accepted for this source-ledger effort, and the user will runtime-check later. Agent-side external running evidence, runtime visual evidence, formatting/tests/checks/app launch validation, and equivalent validation are not run and stay outside this workflow, not on the current source-ledger blocker list. Future web panes must target CEF only; Manage file bridge remains a separate contract.
-->

This file is a continuation record for the source-only parity pass recorded in `gpui/WORKSPACE_PARITY_PROGRESS.md`.

The macOS app remains the source of truth. The current GPUI shell already covers the placeholder layout, tab, split, command-pane, Browser shell, project-editor placeholder, drag/drop, persistence, and titlebar availability behavior listed in `docs/gpui-workspace-area-parity-requirements.md`.

## Ground Rules For The Next Orchestrator

- Preserve the existing placeholder-shell behavior while replacing one placeholder boundary at a time.
- Keep interactive regions as normal non-overlapping GPUI/native child views. Do not add transparent overlays, hidden hit regions, broad hit-test routing, or synthetic coordinate rerouting.
- Do not add fake project detection from paths, `.git`, workspace names, fixture names, or sidebar titles. Replace the temporary bridge only with real GPUI sidebar/project state.
- Keep persistent logs and shell-state persistence privacy-safe: no paths, command text, stdout/stderr, page titles, raw URLs with query/fragment, tokens, cookies, file contents, or terminal content.
- Run exactly one worker at a time. Do not spawn parallel subagents, including parallel read-only planning workers.
- Prefer larger bounded worker bundles when dependencies allow, but preserve phase order and keep each bundle scoped to one coherent boundary. Each bundle should update `gpui/WORKSPACE_PARITY_PROGRESS.md` with user-facing behavior delivered, files changed, checks run or explicitly skipped, and remaining gaps.
- Keep the current no-validation instruction in force: no formatting, tests, checks, whitespace validation, app launch/restart, browser/visual automation, or equivalent validation/app commands. Do not queue these as a later agent step.
- Do not run or restart the app unless the user explicitly asks. When app verification is approved, record the exact command and viewports/screens tested.

## Phase 1: Real GPUI Project And Sidebar State Bridge

Why first: project-scoped Browser/Kanban/Manage behavior, real Source/Kanban/Manage surfaces, and Quick/projectless availability cannot fully match macOS until GPUI receives the same active project facts the macOS native layout uses.

Current source-only state after slice 234:

- Phase 1 source-side bridge work counts as the source-only runtime-parity unit for this pass and is complete enough to move the queue to Phase 2 terminal work. Validation, app launch/restart, visual automation, and running-app proof remain user-side checks because those commands are currently forbidden.
- The live sidebar bridge can send a strict active-project snapshot with active project identity, display name, Quick/projectless state, project-scoped availability, and the allowlisted in-memory project path.
- The TypeScript payload derives explicit identity-only Source, Kanban, and gated Manage ids from the active project editor identity. Manage identity is present only when the strict Debugging Mode plus Show Beta Features gate is open.
- The TypeScript payload helper and Rust contract accept only Source, Kanban, and gated Manage surface ids. `browserWorkareaId` is rejected even when Browser availability is true, because Browser surface identity/readiness is handled by the separate source-only Browser boundary and the source-ledger Browser identity contract keeps Phase 1 closed to Browser ids.
- These ids are identity facts only. They are not readiness, URL, CEF, file-bridge, or mount contracts, and they do not replace the Source, Kanban, or Manage placeholders.
- The app runtime prefers the latest valid sidebar active-project snapshot for titlebar and workarea availability source behavior, using the env bridge only when no valid live snapshot exists.
- Malformed, duplicate, or Browser-id payloads do not replace the stored active-project state.
- Project-change source behavior for titlebar availability and active-mode fallback is represented: unavailable Browser/Kanban/Manage modes fall back through the existing Agents path.
- Actual Source, Kanban, and Manage runtime CEF/file-bridge instantiation remain separate from Phase 1. Browser identity/readiness has a separate source-only boundary and sidebar-scoped bridge route, but Browser identity is not part of the Phase 1 active-project snapshot.
- Browser import, blank/script-created popup transfer, and CEF lifecycle are accepted only as source-ledger no-op/no-transfer/CEF-only hide-and-hold contracts after slice 252; no runtime behavior was added. Terminal physical-key/product behavior is accepted for the source ledger after slice 253 as an explicit layout-only product difference with no runtime key-forwarding change. Source-side restored materialization, parked-owner reattach, close-confirm UI surface, GhosttyKit `needs_confirm_quit` ABI evidence, exact confirmed shell/session removal evidence, and runtime clipboard handoff evidence are accepted as current terminal source-ledger evidence, but no validation commands were run.
- Slice 263 adds only app-owned Source/Kanban/Manage CEF ownership-slot scaffolding after the current ready runtime-parity and placeholder-preflight evidence. Slice 264 adds the source-only runtime URL issuance boundary on top of those slots: decisions require CEF, normal-layout child boundaries, and future real URL authority before any issued runtime URL or CefSurface creation. Slice 265 adds Source-only startup navigation readiness on top of the Source URL boundary: first code-server navigation stays deferred until a future runtime readiness gate and issued runtime URL exist, Browser/Kanban/Manage stay out of this wait, and current placeholders remain unreplaced. Slice 266 records the future Source runtime CEF surface owner/creation prerequisites and explicit replacement permission without creating a runtime surface. Slice 267 records the future Kanban runtime CEF surface owner/creation prerequisites and explicit replacement permission without creating a runtime surface. Slice 268 records the future Manage runtime CEF/file-bridge owner/creation prerequisites and explicit replacement permission without creating a CEF/file-bridge/runtime surface.

Accepted Phase 1 source-ledger guardrails and user-side/future checks:

- Keep the typed GPUI project snapshot contract strict as later real surfaces attach to it.
  - Fields may include active project id, display name, project path or redacted project identity boundary, Quick/projectless boolean, project-scoped feature availability, and identity-only editor/workarea ids needed by later surfaces.
  - Do not accept Browser surface identity in Phase 1; the Browser readiness boundary is separate source-only code and must not infer identity from Browser tabs, URLs, titles, profiles, CEF state, or project data.
  - Keep private paths out of logs and persistence unless a later surface explicitly needs an internal in-memory path.
- Keep the CEF sidebar-to-Rust message bridge narrow.
  - Use only the allowlisted active-project context message from the embedded sidebar page to GPUI Rust.
  - Do not widen this into a general sidebar event bus or add fallback project detection.
- Preserve live-snapshot-first behavior where the source now has it.
  - Keep the existing strict env bridge only as a development/test override if needed.
  - Route `ProjectScopedWorkareaAvailability::current()` through the real snapshot when present.
- Runtime/visual project-change proof remains user-side until validation is allowed.
  - Switching projects should update titlebar availability and active mode fallback.
  - If Browser/Kanban/Manage becomes unavailable, active mode should fall back through the existing Agents path.
- Add or run tests for the typed contract and availability transitions only when validation is allowed; do not queue validation/app/check commands for this pass.

Accepted Phase 1 source-ledger state and user-side/future runtime checks:

- For this pass, Browser, Kanban, and Manage availability is accepted as source-ledger behavior only when it derives from real GPUI project/sidebar state without fallback project detection.
- Quick/projectless context behavior is accepted for the source ledger with Agents and Source selectable, Browser/Kanban disabled, and Manage hidden until the feature gate opens and disabled when visible.
- Source, Kanban, and Manage identity-only ids are accepted source-ledger bridge facts and remain separate from readiness, URL, CEF, file-bridge, and mount contracts.
- Browser surface identity remains rejected in Phase 1 by the slice 252 source-ledger identity contract. The separate Browser readiness boundary and sidebar-scoped bridge route are accepted source evidence only and must not make `browserWorkareaId` valid in active-project snapshots.
- No project detection heuristics are introduced.
- Real Source, Kanban, and Manage runtime surfaces remain outside Phase 1 source-ledger acceptance rather than current source-ledger blockers. Actual runtime CEF/file-bridge instantiation, placeholder replacement, Manage runtime file-bridge mounting, and file-operation execution are user-side or future explicit CEF-only work.
- Runtime/visual/app validation remains user-side under the persistent no-validation instruction; app launch/restart, checks, tests, and visual/interaction validation are not agent steps in this continuation.

## Phase 2: Real Libghostty Terminal Surface Mounting

<!--
CDXC:GPUITerminalSurfaceHandoff 2026-06-23-15:25:
Phase 2 is no longer a black-placeholder-only source plan. GPUI source now contains an App-owned native terminal host, AppKit host view, Ghostty surface, all-visible Agents mount-slot, runtime-session, startup handoff, source-side restored-unmounted materialization through the startup pipeline, source-side runtime parked-owner reattach for Agents Sleeping/PoppedOutPlaceholder without startup, close/process-exit, focus, resize/frame, command-surface, explicit-string paste, no file-path clipboard synthesis, source-side surface-scoped app-thread runtime clipboard handoff, committed `key_char` forwarding, IME/preedit text-service, layout-only/no-native-physical-key rejection, close-confirm callback/pending/cancel/confirmed-cleanup evidence, source-side normal-layout close-confirm UI surface evidence, source-side GhosttyKit `needs_confirm_quit` ABI evidence, exact confirmed shell/session removal evidence, and runtime-only privacy pipeline. Slice 239 accepts this as current terminal evidence for the source-ledger purpose; slice 253 later accepts the physical-key/product difference for the source ledger without changing runtime input.

CDXC:GPUITerminalLifecycle 2026-06-23-17:37:
Slice 225 narrows the startup handoff evidence: source already has runtime-only Ghostty metadata readiness/failure snapshots, readiness handoff plans, process-exited failure results, and startup host/surface ownership transfer into Running maps. Slice 235 adds restored-unmounted materialization to the same source-side startup path, slice 236 adds source-side parked-owner wake/reattach outside startup, and slice 237 adds source-side close-confirm ABI/exact-removal evidence. Slice 239 accepts this terminal source/runtime evidence for the source-ledger purpose, slice 253 accepts current physical-key/product behavior without runtime key-forwarding changes, and validation remains outside this workflow.

CDXC:GPUITerminalCloseConfirm 2026-06-23-17:45:
Slice 226 reconciles close-confirm handoff wording with source evidence. Request-close pending callback handling, exact pending identity tracking, cancel handling, confirmed callback cleanup, Agents/command isolation, and privacy boundaries were source evidence; later UI/ABI work plus slice 239 now accept close-confirm for the source-ledger purpose, and no fake shell removal from confirm actions is allowed.

CDXC:GPUITerminalCloseConfirm 2026-06-23-18:48:
Slice 232 adds the source-side close-confirm UI surface contract. Pending Agents and command close confirmations gained family-scoped normal-layout banners with generic copy, Keep Open wired to the existing cancel path, and a then-unavailable close action; slice 237 supersedes that with source-side `needs_confirm_quit` ABI/exact-removal evidence, and slice 239 accepts it for the source-ledger purpose.

CDXC:GPUITerminalCloseConfirm 2026-06-23-20:04:
Slice 237 replaces the unavailable close-confirm action with source-side GhosttyKit `ghostty_surface_needs_confirm_quit` ABI evidence and exact confirmed shell/session removal through existing model close paths. Slice 239 accepts this for the source-ledger purpose without claiming validation commands were run, and it must not synthesize runtime callbacks or broad fallback close behavior.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-23-17:51:
Slice 227 credited the terminal input evidence that existed before the runtime clipboard handoff. Explicit-string Cmd+V paste, no file-path clipboard synthesis, denied runtime clipboard drains caused by missing requester identity, committed `key_char` forwarding, and IME/preedit text-service delivery were source-only boundaries; slice 233 supersedes the denied-drain status with source-side handoff evidence.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-23-19:07:
Slice 233 implements the source-side surface-scoped app-thread runtime clipboard handoff for mounted Agents and command owners. Credit only standard clipboard read/write handoff for exact still-mounted surfaces, explicit-string reads, and runtime-text-only writes; slice 253 later accepts the current no-native-physical-key behavior as a source-ledger product decision.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-24-04:15:
Slice 253 accepts terminal physical-key/product behavior for the source ledger without changing runtime input. GPUI still lacks native keycode/UIEvents-code identity, physical keys are not synthesized from layout-only key data, Control/Cmd physical-key cases stay rejected by the existing helper, and committed key_char, IME, preedit, and text-service paths remain current behavior.

CDXC:GPUITerminalActivationRuntimeGuard 2026-06-23-18:00:
Slice 228 fixed the broad activation/startup mismatch by keeping blocked placeholder activation and restored shell-state `mounting` out of hidden new-startup host/surface creation. Slice 235 narrows restored-unmounted activation into a source-side materialization startup contract, and slice 236 narrows sleeping wake plus popped-out reattach into a separate source-side parked-owner contract. In-process failed-startup retry remains startup eligible; slice 239 accepts this evidence for the source-ledger purpose.

CDXC:GPUITerminalActivationRuntimeGuard 2026-06-23-18:12:
Slice 229 splits out the restore edge: persisted `presentationState:"mounting"` restores as presentation-only because shell state intentionally omits the runtime-only startup eligibility bit. New terminal creation and in-process failed-startup retry remain startup eligible only through runtime transitions after restore.

CDXC:GPUITerminalStartupRetryIdentity 2026-06-23-18:19:
Slice 230 credits source-only retry-attempt identity evidence. The shell session id, tab, title, and presentation flow remain stable, but explicit failed-startup retry replaces the process-local runtime id before startup sync creates the next candidate/launch-plan/intent; slice 239 accepts this as current source-ledger evidence without claiming validation commands were run.

CDXC:GPUITerminalRestoredMaterialization 2026-06-23-19:26:
Slice 235 credits source-only restored-unmounted materialization through the existing startup candidate/body-slot/launch-plan/completion-intent path. The durable shell id and process-local runtime id stay stable, retry attempt identity is not rotated, restored shell-state `mounting` after restart remains presentation-only, and slice 239 accepts the evidence for the source-ledger purpose.

CDXC:GPUTerminalParkedOwnerReattach 2026-06-23-19:41:
Slice 236 credits source-only Agents Sleeping wake and PoppedOutPlaceholder reattach through a runtime parked-owner contract. It preserves and moves only the existing AppKit host view plus Ghostty surface owner for the same durable shell session and process-local runtime id into current visible body geometry; it does not use startup candidates, startup body slots, launch plans, completion intents, fallback surfaces, runtime id rotation, or fake Running. Slice 239 accepts this for the source-ledger purpose.

CDXC:GPUITerminalSurfaceHandoff 2026-06-24-08:07:
Slice 284 keeps active Phase 2 headings aligned with accepted terminal source evidence. Terminal source/runtime evidence is accepted as working for this pass; remaining rows are user-side runtime proof, validation-forbidden evidence notes, or future explicit product decisions, validation/app/check commands remain banned, and future web panes must stay CEF-only with no WKWebView/WebKit/non-CEF path.

CDXC:GPUITerminalSurfaceHandoff 2026-06-24-09:24:
The latest source-only parity override keeps terminal accepted as working for this pass. Phase 2 should preserve no-validation, privacy, normal-layout, and physical-key product-difference caveats without listing terminal as remaining user-side runtime-check work; Source, Browser, Kanban, and Manage runtime checks remain user-side and future web panes stay CEF-only with WKWebView/WebKit/non-CEF paths rejected.
-->

Current accepted terminal source/runtime state after the terminal slices:

- Agents running slots have an App-owned terminal host/native view/Ghostty surface pipeline in source. The model expanded from a one-pane rollout to all visible rendered Agents leaves whose selected session is `Running`; sleeping, restored, mounting, startup-failed, popped-out, missing, and inactive-tab states remain on placeholder paths unless their current source contract says otherwise.
- Runtime session registry, source-side failed-startup retry attempt identity rotation before retry startup sync/intent, startup-owned host/surface preparation, runtime-only startup Ghostty metadata readiness/failure snapshots, readiness handoff plans, process-exited failure results, ownership transfer into Running maps, source-side restored-unmounted materialization through startup candidate/body-slot/launch-plan/completion-intent state without retry runtime-id rotation, source-side parked-owner reattach for Agents Sleeping/PoppedOutPlaceholder that moves only an exact existing AppKit host view plus Ghostty surface owner for the same durable shell session and process-local runtime id into current body geometry, activation/restore startup eligibility guarding for sleeping/popped-out placeholders and restored `mounting` shell state versus restored materialization and in-process failed-startup retry, close request handling, confirmation-needed pending callback state, normal-layout Agents close-confirm UI surface with Keep Open cancel, GhosttyKit `needs_confirm_quit` source evidence, exact confirmed shell removal through `WorkspaceModel::close_tab`, confirmed-close callback cleanup, process-exit cleanup, focus mirroring/AppKit first-responder handoff, and resize/frame reconciliation are represented in source.
- Command-pane terminals have a separate mounted Ghostty pipeline with command-scoped body bounds, focus mirroring, close-confirm callback/pending/cancel/confirmed-cleanup handling, a normal-layout command close-confirm UI surface with Keep Open cancel, GhosttyKit `needs_confirm_quit` source evidence, exact confirmed command-session removal through `CommandPaneModel::close_session`, process-exit cleanup, input forwarding boundaries, and map isolation from Agents/startup state.
- Mouse, scroll, pressure, committed `key_char` text, explicit-string Cmd+V paste without file-path clipboard synthesis, IME/preedit text-service delivery, source-side surface-scoped app-thread runtime clipboard handoff for exact still-mounted Agents and command owners, layout-only/no-native-physical-key rejection, and related surface-scoped routing boundaries are represented in source. Slice 253 accepts the current physical-key/product behavior for the source ledger while preserving the technical truth that native keycode/UIEvents-code identity is absent and runtime physical-key forwarding is unchanged.
- Terminal host, Ghostty surface, runtime ids, launch payloads, geometry, process metadata, callbacks, and private input values remain runtime-only and must not enter shell-state JSON or persistent logs.
- Terminal source/runtime evidence is accepted as working for this pass, while app launch, visual verification, interaction testing, and validation/check commands remain user-side because validation/app commands are forbidden in the current thread.

Terminal guardrails after source-ledger acceptance:

- Physical-key/binding behavior is accepted for the source ledger as a product difference, not as runtime physical-key forwarding. Do not fake native keycode or UIEvents-code identity from layout-only GPUI key data.
- Keep the global no-validation row accurate: this source-ledger acceptance did not run app launch, restart, checks, tests, browser automation, or visual verification.
- Preserve normal layout ownership for terminal host/native-view frames. Do not add overlays, hidden hit regions, broad hit-test routing, or synthetic coordinate routing to compensate for terminal input or focus gaps.
- Keep terminal runtime/private data out of shell-state JSON and persistent logs.
- Keep sleeping/restored/mounting/startup-failed/popped-out placeholders selectable without auto-waking unless the matching lifecycle contract explicitly wakes or materializes them.

Terminal historical/runtime caveats retained without queued checks:

- Source evidence records that Running Agents tabs and command terminal bodies mount real libghostty surfaces in existing body slots, but agents did not run app launch, visual proof, interaction testing, or validation/check commands in this thread.
- Source evidence records all visible rendered Running Agents leaves and command terminal bodies as normal-layout mounted surfaces without overlapping tab bars, split handles, command pane chrome, Browser CEF, sidebar, or project-editor regions; no overlay, hidden hit region, broad hit-test routing, or synthetic coordinate routing exception was added.
- Sleeping/restored/mounting/startup-failed/popped-out placeholders remain selectable without unintended runtime creation unless the matching lifecycle contract explicitly wakes or materializes them.
- Runtime clipboard handoff stays accepted through safe source contracts, and physical-key/binding behavior stays accepted as an explicit product difference without native physical-key forwarding.

## Phase 3: Terminal Session Lifecycle Parity

<!--
CDXC:GPUITerminalLifecycle 2026-06-23-15:31:
Slice 204 reconciles Phase 3 as source-side lifecycle status, not acceptance. Agents runtime sessions are process-local and distinct from shell `TerminalSessionId` values and mount slots; startup launch payloads cross an explicit boundary but the production source map stays empty unless an explicit payload is provided. Startup host/surface ownership moves to Running maps only after metadata-backed ready handoff, failed launches stay retryable Failed placeholders without fallback success, and mounted Running Agents cleanup must remain runtime-only and privacy-safe.

CDXC:GPUIAgentsTerminalActivation 2026-06-23-15:54:
Slice 209 reconciles explicit Agents placeholder activation as source-only shell lifecycle evidence. Selecting sleeping, restored-unmounted, popped-out, or startup-failed placeholders must stay presentation-only; activating the placeholder body or card may move those sessions to Mounting as wake, materialize, reattach, or retry pending, but it must not fabricate Running state, launch a process, mount libghostty, create terminal content, duplicate runtime sessions, or persist runtime/private data.

CDXC:GPUITerminalLifecycle 2026-06-23-17:19:
Slice 222 reconciled the Phase 10 terminal ledger against Phase 3 source evidence only and recorded denied clipboard drain/no-op behavior as the then-current runtime clipboard state. Slice 233 supersedes that clipboard substatus with source-side handoff evidence, slice 235 adds source-side restored materialization, slice 236 adds source-side sleeping/popped-out parked-owner reattach evidence, and slice 237 adds source-side close-confirm ABI/exact-removal evidence; slice 239 accepts the source/runtime terminal evidence for the source-ledger purpose, and slice 253 accepts current physical-key/product behavior without runtime key-forwarding changes.

CDXC:GPUITerminalLifecycle 2026-06-23-17:37:
Slice 225 updates Phase 3 to credit the narrower startup path already visible in source: runtime-only startup metadata can prepare readiness handoff plans, process-exited metadata can produce Failed startup results, and ready handoff can transfer startup host/surface ownership into Running maps. Slice 235 adds restored-unmounted materialization to that source-side startup path, slice 236 adds source-side parked-owner wake/reattach outside startup, and slice 237 adds source-side close-confirm ABI/exact-removal evidence. Slice 239 accepts this source/runtime evidence for the source-ledger purpose.

CDXC:GPUTerminalParkedOwnerReattach 2026-06-23-19:41:
Slice 236 adds the source-side parked-owner contract for Sleeping wake and PoppedOutPlaceholder reattach. It moves only an exact parked AppKit host view plus Ghostty surface owner for the same durable shell session and process-local runtime id into current body geometry, and otherwise leaves the shell honestly Mounting. Slice 239 accepts this for the source-ledger purpose without changing the global no-validation row.

CDXC:GPUITerminalCloseConfirm 2026-06-23-17:45:
Slice 226 narrows Phase 3 close-confirm status to runtime-only evidence: request-close waits for callbacks, confirmation-needed callbacks create typed pending state for exact current Agents/command slots, cancel clears matching pending runtime state, confirmed callbacks remove only exact matching shell sessions, stale/mismatched state is ignored, and maps remain isolated. Slice 237 adds the UI/ABI/exact-removal evidence, and slice 239 accepts it for the source-ledger purpose.

CDXC:GPUITerminalCloseConfirm 2026-06-23-18:48:
Slice 232 adds the source-side UI surface to the Phase 3 close-confirm handoff. The surface is normal-layout, family-scoped, privacy-safe, and can only cancel through Keep Open; slice 237 adds the GhosttyKit ABI and exact confirmed removal evidence, and slice 239 accepts the combined source-ledger evidence.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-23-17:51:
Slice 227 narrowed Phase 3 terminal input status before the runtime clipboard handoff existed. Source evidence included explicit-string paste to the exact focused mounted surface, no file-path clipboard synthesis, denied runtime clipboard drains when requester identity was absent, committed `key_char` forwarding, and IME/preedit text-service delivery; slice 233 supersedes the denied runtime clipboard drain with source-side handoff evidence.

CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:40:
Slice 294 is docs-only Phase 3 lifecycle wording cleanup. Terminal lifecycle source/runtime evidence is accepted for this source-ledger pass; startup geometry/launch plans, hidden startup host/surface ownership, metadata readiness/failure snapshots, ready handoff, restored materialization, parked-owner wake/reattach, close-confirm UI/ABI/exact removal, privacy boundaries, and no validation/app proof remain accurately separated from queued implementation work. Slice 311 supersedes earlier runtime-proof wording by recording that terminal is accepted as working for this pass.

CDXC:GPUITerminalLifecycle 2026-06-24-09:27:
Slice 311 updates Phase 3 for the latest source-only parity requirement. Terminal is accepted as working for this pass, so Phase 3 must preserve terminal runtime caveats and future explicit product contracts without queuing terminal runtime proof/checks; Source/Browser/Kanban/Manage runtime checks remain user-side outside this terminal handoff.
-->

Why after Phase 2: once terminal surfaces can mount, the app can safely connect real process/session lifecycle without losing shell layout identity.

Current source-ledger state after slice 268:

- The Agents lifecycle path is represented by a process-local runtime session registry that stays separate from shell `TerminalSessionId` values and terminal mount slots.
- All visible rendered running Agents leaves have source-side terminal host/native-view/Ghostty pipeline and mount-slot evidence only; this is not app-verified and does not prove runtime wake, reattach, or real terminal content.
- Startup launch payloads now have an explicit boundary, but the production launch-payload source map remains empty unless an explicit payload is supplied. Do not synthesize launch data from shell titles, paths, commands, environment, or other fallback project/session detection.
- Startup geometry, launch plans, hidden startup terminal hosts, startup Ghostty surfaces, runtime-only metadata readiness/failure snapshots, readiness handoff plans, process-exited failure results, and ready ownership transfer into the Running maps are represented in source.
- Launch failure handling creates a retryable Failed placeholder from explicit failed startup results, including process-exited startup metadata, without deleting the tab and without treating missing runtime data as a fallback success.
- Close request handling, confirmation-needed pending callback state, exact pending identity tracking, a family-scoped normal-layout UI surface with generic copy and Keep Open cancel, confirmed-close callback cleanup, and process-exit cleanup are represented for mounted Running Agents and command terminals, with runtime ids, process metadata, host/surface handles, command text, paths, stdout/stderr, and terminal content kept out of shell-state persistence and persistent logs. Slice 237 adds the GhosttyKit ABI and exact confirmed-removal source evidence.
- Focus mirroring, resize/frame reconciliation, mouse/scroll/pressure/text boundaries, explicit-string Cmd+V paste without file-path clipboard synthesis, IME/preedit text-service delivery, source-side surface-scoped app-thread runtime clipboard handoff for exact still-mounted owners, committed `key_char` forwarding, and layout-only/no-native-physical-key rejection are represented as source/runtime boundaries. Slice 253 accepts current physical-key/product behavior for the source ledger without native physical-key identity or runtime key-forwarding changes.
- Selecting sleeping, restored-unmounted, popped-out, or startup-failed Agents placeholders remains presentation-only. Activating the selected placeholder body/card is represented as a source-only shell transition to `Mounting`; explicit restored-unmounted materialization enters the existing startup pipeline with the current process-local runtime id, while a runtime-only startup eligibility guard keeps sleeping/popped-out activation and restored shell-state `mounting` out of the hidden new-startup host/surface path. Sleeping wake and PoppedOutPlaceholder reattach can move only an exact parked AppKit host view plus Ghostty surface owner for the same durable shell session and process-local runtime id into current body geometry; missing/stale identity, slot, owner, or geometry leaves honest Mounting pending. In-process startup-failed retry remains startup eligible and rotates the process-local runtime attempt id before retry startup sync/intent. Slice 239 accepts this as current terminal evidence for the source-ledger purpose without claiming validation commands were run.
- This has not been app-launched, visually verified, interaction-tested, or validation-checked because validation/app commands are forbidden in the current thread.

Accepted source-represented terminal lifecycle evidence:

- Accepted shell-to-runtime identity evidence.
  - Source status: represented by process-local runtime sessions, with stable shell ids preserved separately from runtime ids, user-facing titles, and persisted shell ids.
- Accepted startup placeholder and metadata-backed ready/failure evidence.
  - Source status: represented by startup geometry/launch plans, hidden startup host/surface ownership, runtime-only startup metadata readiness/failure snapshots, readiness handoff plans, process-exited failure results, ownership transfer into Running maps, source-side restored-unmounted materialization through the same startup path without retry runtime-id rotation, and retryable Failed placeholders for failed launches.
- Accepted close-confirm and teardown evidence.
  - Source status: represented for mounted Running Agents by close request handling, confirmation-needed pending callback state, exact pending identity tracking, family-scoped normal-layout UI surface, Keep Open cancel handling, GhosttyKit `ghostty_surface_needs_confirm_quit` boolean ABI evidence, exact confirmed shell/session removal through the existing model close path, confirmed-close callback cleanup, and process-exit cleanup paths. Confirm actions must validate pending/current slot/runtime/owner identity and must not synthesize runtime callbacks or broad fallback removal.
- Accepted placeholder activation, restored materialization, parked-owner wake/reattach, and retry evidence.
  - Source status: represented as explicit body/card activation that moves sleeping, restored-unmounted, popped-out, and startup-failed Agents sessions to `Mounting`, source-side restored-unmounted materialization through startup candidate/body-slot/launch-plan/completion-intent state, source-side parked-owner wake/reattach for exact existing AppKit host view plus Ghostty surface owner identity, a runtime-only startup eligibility guard, and failed-startup retry attempt-id rotation before retry startup sync/intent. Tab selection alone remains presentation-only; sleeping/popped-out activation and restored shell-state `mounting` do not enter new-startup candidate discovery or hidden startup geometry, restored materialization does not rotate as a retry attempt, stale parked-owner inputs remain Mounting, and no app-accepted Ready success, replacement terminal content, duplicate startup, duplicate running ownership, or runtime/private persistence is implied.

Accepted terminal caveats and future explicit product decisions:

The terminal source/runtime ledger is accepted for this source-only runtime-parity pass, and terminal is not queued for runtime proof/checks in this continuation. The rows below preserve validation-forbidden caveats and explicit future product decisions rather than terminal source-ledger blockers.

- Define the real launch payload source and product contract. Until then, production startup payloads remain empty unless an explicit payload is supplied, and no fallback launch data should be inferred.
- Keep close-confirm source-ledger acceptance tied to the exact current source/runtime contract; no validation commands were run.
- Preserve the source-side runtime clipboard handoff limits: exact still-mounted owners only, standard clipboard only, explicit-string reads, runtime-text-only writes, no file-path synthesis, no stale-owner use, and no private payload/logging/persistence.
- Preserve the slice 253 physical-key/product acceptance: do not fake native keycode or UIEvents-code identity from layout-only GPUI key data, and do not imply runtime key-forwarding changes were made.
- Keep sleeping wake, popped-out reattach, and restored materialization constrained to their explicit runtime contracts. Do not add fallback startup or duplicate owner paths.
- Preserve the startup-failed retry contract: Ready may be reached only through the explicit startup metadata/readiness path rather than fallback success; the source guard and attempt-id rotation keep failed retry startup eligible with a fresh process-local attempt identity without claiming agent runtime evidence.
- Preserve the PoppedOutPlaceholder parked-owner reattach contract: only an exact parked owner may be moved without duplicate runtime ownership, and missing/stale parked-owner inputs remain Mounting instead of being treated as successful reattach.
- Preserve the outside-workflow validation row: no app launch, restart, checks, tests, browser automation, visual verification, or terminal runtime checks were run or queued by agents for this pass.

Source-ledger invariants to preserve for any future explicit terminal product/runtime work:

- Real terminal lifecycle matches the existing placeholder shell behavior instead of replacing it.
- Sleeping/restored/popped-out tabs survive drag/drop, persistence, tab cycling, and focus movement.
- No terminal content, command text, stdout/stderr, or paths are persisted in GPUI shell state.

## Phase 4: Real Command Terminal Runtime

<!--
CDXC:GPUICommandTerminalRuntime 2026-06-23-15:31:
Slice 204 reconciles Phase 4 as source-side command runtime status, not acceptance. Command terminals use separate command host/native view/Ghostty state with command-scoped body bounds, focus, close, process-exit, input, and final-close-collapse paths; these maps must stay isolated from Agents and startup runtime state. Command launch payload policy/status sources remain separate runtime/product work, while slice 253 accepts current physical-key/product behavior for the source ledger; validation stays outside this agent workflow.

CDXC:GPUICommandTerminalRuntime 2026-06-23-15:58:
Slice 210 sharpens the Phase 4 handoff around command launch and status source boundaries. Command terminal surfaces may mount through the command-only host/native view/Ghostty pipeline with command-scoped body bounds, but the Ghostty launch request stays intentionally empty until an explicit command launch payload policy and source exist. Idle, working, attention, and delayed-send status remains shell enum/boolean metadata for tab chrome and persistence only; it is not real process status and must not be used to infer command text, cwd, env, stdout/stderr, terminal content, delayed-send deadlines, or launch data.

CDXC:GPUICommandTerminalLaunchPayloadSource 2026-06-23-16:46:
Slice 217 adds the source-only command launch payload boundary without implementing real command process/status behavior. The command Ghostty config path now consults an empty production source keyed by exact command body mount slot plus derived command runtime id; future explicit matching payloads may attach only after Ghostty validation, while invalid explicit payloads suppress/prune the config request and never fall back to titles, status, delayed-send state, project/workspace data, paths, cwd, command args, env, initial input, wait policy, stdout/stderr, terminal content, or helper detection.

CDXC:GPUIRuntimeTransfer 2026-06-23-16:02:
Phase 4 owns command terminal runtime status, but cross-surface transfer is broader than command launch/status. Current Agents-command drag paths may create placeholders with visible titles only; they do not transfer Ghostty process ownership, terminal buffers, command payload/status, clipboard callbacks, focus/key identity, Browser CEF content, Source file-editor state, Kanban/Manage CEF content, file bridges, private runtime data, or user-owned content.

CDXC:GPUICommandTerminalRuntime 2026-06-23-17:19:
Slice 222 recorded command runtime isolation, command host/native-view/Ghostty pipeline evidence, denied clipboard drain/no-op behavior, committed-text-only key handling, and runtime-only privacy boundaries as source-only Phase 10 evidence before runtime clipboard handoff existed. Slice 233 supersedes the denied command clipboard substatus with source-side handoff evidence, and slice 253 accepts current physical-key/product behavior for the source ledger; this does not add command process/status behavior, native physical-key identity, runtime key forwarding, logging, persistence, fallback routing, or validation.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-23-17:51:
Slice 227 reconciled command terminal clipboard/key evidence with the shared terminal boundary before runtime clipboard handoff existed. Explicit-string paste, no file-path clipboard synthesis, denied runtime clipboard drains, committed `key_char` forwarding, and IME/preedit text-service delivery were credited for command surfaces; slice 233 supersedes the denied-drain status with source-side handoff evidence.

CDXC:GPUITerminalCloseConfirm 2026-06-23-18:48:
Slice 232 adds the command-side close-confirm UI surface contract as source-only evidence. Slice 237 adds the real GhosttyKit `needs_confirm_quit` query plus exact confirmed command-session removal through `CommandPaneModel::close_session`; slice 239 accepts this for the source-ledger purpose.

CDXC:GPUIRuntimeTransfer 2026-06-23-17:25:
Slice 223 keeps Phase 4 cross-surface handoff shell-only. Agents-command movement may preserve visible titles in placeholders only, while tab/group/card layout movement, project-editor identity-only Source/Kanban/gated Manage movement, Browser profile/tab shell identity preservation, and no-runtime-transfer privacy boundaries are evidence only until explicit product, per-source/target mount/runtime, family-specific transfer, and privacy gates exist.

CDXC:GPUIWorkspaceParityDocsAlignment 2026-06-24-08:40:
Slice 294 is docs-only Phase 4 command-terminal wording cleanup. Command terminal source evidence is accepted for this source-ledger pass as real terminal evidence, while real command launch payload product contract/policy/producer and real command process/status source remain future explicit product decisions; slice 312 supersedes earlier runtime-proof wording so command terminal runtime proof/checks are not queued for this pass.

CDXC:GPUICommandTerminalRuntime 2026-06-24-09:29:
Slice 312 updates Phase 4 for the latest source-only runtime-parity rule. Terminal and command terminal are accepted as working for this pass, so Phase 4 must preserve explicit future command launch/status product decisions, clipboard/physical-key limits, shell-only transfer caveats, and no-validation evidence without listing command terminal runtime proof/checks as active remaining work; Source/Browser/Kanban/Manage runtime checks remain user-side.
-->

Why separate: command-pane terminals are not workspace terminals. They have separate layout, focus, close, drag/drop, status, and persistence rules.

Current accepted command source-ledger state after slice 268:

- Command-pane terminal source evidence is accepted for source-ledger purposes through a separate command host/native view/Ghostty pipeline, not the Agents startup or Running maps.
- Command-scoped body bounds, focus mirroring, command input boundaries, and map isolation from Agents/startup state are represented in source.
- The command-mounted surface path uses the shared host/native view/Ghostty maps and a source-only launch payload boundary keyed by exact command body mount slot plus derived command runtime id. The production source is empty, so current command launch requests remain payload-less unless a future explicit matching payload is injected.
- Explicit future payloads may attach only through that exact key after Ghostty launch-payload validation. Invalid explicit payloads suppress/prune the config request instead of falling back to command titles, shell status, delayed-send booleans, project/workspace data, paths, cwd, command args, env, initial input, wait policy, delayed-send deadlines, stdout/stderr, terminal content, or helper detection.
- Command-only close request handling, confirmation-needed pending callback state, exact pending identity tracking, command-scoped normal-layout close-confirm UI surface with generic copy and Keep Open cancel, GhosttyKit `needs_confirm_quit` source evidence, exact confirmed command-session removal through `CommandPaneModel::close_session`, confirmed-close callback cleanup, process-exit cleanup, and final-close collapse through the command model are represented in source.
- Command idle/working/attention/delayed-send status is represented as shell enum/boolean metadata for tab chrome and persistence only. It is privacy-safe placeholder status, not real process status, and it must not be used to infer command text, cwd, env, stdout/stderr, terminal content, delayed-send deadlines, or launch data.
- Explicit-string paste, no file-path clipboard synthesis, source-side surface-scoped app-thread runtime clipboard handoff for exact still-mounted command owners, committed `key_char` forwarding, IME/preedit text-service delivery, and layout-only/no-native-physical-key rejection are represented as source/runtime command input boundaries. Slice 253 accepts current physical-key/product behavior for the source ledger; these paths still do not forward native physical keys or infer native key identity from layout-only key data or mouse modifier mapping.
- Command terminal runtime ids, host/surface handles, command input, paths, stdout/stderr, delayed-send deadlines, launch data, and terminal content remain runtime-only or absent and must not enter shell-state JSON or persistent logs.
- Cross-surface transfer remains shell-only across all current surface families. Agents-command drag/drop paths preserve visible titles in new placeholders, tab/group/card layout may move only as shell structure, project-editor surface ids are identity-only for Source/Kanban/gated Manage, Browser tab/profile shell state preserves identity only, and the no-runtime-transfer privacy boundary forbids implicit content or process ownership transfer.
- Command terminal source evidence remains accepted separately from Agents for source-ledger purposes. Terminal and command terminal are accepted as working for this pass, so command terminal runtime proof/check work is not queued in this continuation; app launch, visual verification, interaction testing, and validation/check commands remain forbidden for agents in the current thread.

Accepted source-represented command terminal evidence:

- Accepted command-body terminal surface mount evidence.
  - Source status: represented through command-only host/native view/Ghostty maps with command-scoped body bounds, while preserving separate command layout/state, keeping command surfaces out of normal Agents runtime maps, and consulting an empty production launch-payload source boundary.
- Accepted command config boundary evidence with future launch/status decisions.
  - Source status: surface mounting is represented by the command host/native view/Ghostty pipeline, and command config preparation has a source-only explicit payload boundary. Real command launch payload product contract/policy/producer and real command process/status source remain future product decisions rather than current source-ledger blockers. The empty production source does not launch from command text, cwd, env, stdout/stderr, terminal content, status labels, project/workspace data, helper detection, or delayed-send metadata.
- Accepted command semantic status metadata evidence.
  - Source status: represented only as idle/working/attention enum plus delayed-send boolean metadata for tab chrome and shell-state persistence. It is not real process status and is not an input to launch, cwd/env, output, terminal content, delayed-send deadline, or process inference.
- Accepted command teardown and final-close collapse evidence.
  - Source status: represented by command-only close request handling, confirmation-needed pending callback state, exact pending identity tracking, command-scoped normal-layout UI surface, Keep Open cancel handling, GhosttyKit `needs_confirm_quit` source evidence, exact confirmed command-session removal through the command model, confirmed-close callback cleanup, process-exit cleanup, and final-close collapse through the command model. Command confirm actions validate pending/current slot/runtime/owner identity and must not synthesize runtime callbacks or broad fallback removal.

Future command product decisions and preserved caveats after source-ledger acceptance:

- Future command launch product work needs an explicit payload product contract, policy, and producer before production command Ghostty launch requests can include cwd, command, env, initial input, wait policy, or related launch data.
- Future command status product work needs a real command process/status source before replacing placeholder idle/working/attention/delayed-send shell metadata with runtime status.
- Command close-confirm behavior is accepted for this pass through the source-side normal-layout UI surface, GhosttyKit `needs_confirm_quit` ABI evidence, exact confirmed command-session removal, and cleanup boundaries; no command close-confirm runtime proof/check is queued in this continuation.
- The source-side clipboard handoff remains accepted only for exact still-mounted command owners, standard clipboard reads/writes, explicit-string reads, runtime-text-only writes, no file-path synthesis, no stale-owner use, and no private payload/logging/persistence; no running command-pane clipboard proof/check is queued in this continuation.
- Preserve the same slice 253 physical-key/product acceptance for command surfaces: no native physical-key identity is inferred and no runtime key-forwarding change is implied.
- Preserve command pane pinned/floating/collapsed, F12 focus/return, tab/split selection, final-close collapse, close-confirm, and command/Agents isolation as accepted source-ledger behavior and caveats for this pass rather than active command terminal runtime-check work.
- Cross-surface runtime transfer is accepted as shell-only for this pass; any implementation beyond shell movement remains a future explicit product decision.
  - Current Agents-to-command and command-to-Agents transfers preserve only visible titles as placeholders.
  - Tab/group/card movement is shell layout movement only, project-editor Source/Kanban/gated Manage movement is identity-only, and Browser profile/tab shell identity preservation is not page-content transfer.
  - Any future transfer among Agents terminal runtime, Command pane terminal runtime, Browser, Source, Kanban, or Manage needs an allowed-transfer-family product decision, per-source/per-target mount/runtime contract, terminal runtime/process transfer contract if terminal transfer is allowed, Browser CEF content transfer contract if Browser transfer is allowed, Source file-editor/runtime transfer contract if Source transfer is allowed, Kanban/Manage CEF/file-bridge transfer contracts if those transfers are allowed, and runtime transfer privacy proof.
  - Do not infer transfer of Ghostty processes, terminal buffers, command payload/status, clipboard callbacks, focus/key identity, CEF content, file-editor state, file bridges, private runtime data, or user-owned content from title, identity, tab, group, card, profile, or placeholder movement.
- Keep safe enum-like persisted metadata only; do not persist command text, raw process arguments, paths, stdout/stderr, terminal content, or runtime ids.

Accepted command source-ledger state:

- Command terminal source evidence is accepted as real terminal evidence for source-ledger purposes while remaining separate from Agents workspace terminals.
- Command pane mode, height, split, tab, and focus compatibility remain accepted source-ledger caveats or future explicit product work, not current source-ledger blockers and not active command runtime-proof work for this continuation.

<!--
CDXC:GPUIProjectEditorSurfaceHandoff 2026-06-23-15:37:
Slice 205 reconciles Phases 5-7 as one source-only blocker handoff, not implementation signoff. Source may record explicit identity; loading, ready, and load-failed bridge states; static loading/load-failed placeholder copy; privacy-boundary runtime JSON; and shell sleep/wake preservation of identity, companion, and command-pane state, with later slices adding Source entrypoint, launch-plan, URL-boundary, and CEF-only source-ledger materialization evidence. Kanban may record explicit project/board identity, availability checks, lifecycle bridge states, CEF request evidence, first-party CEF entrypoint evidence, CEF-only source-ledger materialization evidence, placeholder copy, privacy-boundary runtime JSON, and shell sleep/wake preservation. Manage may record strict gates, explicit project/workarea identity, lifecycle bridge states, a first-party CEF entrypoint label, CEF-only source-ledger materialization, source-only file-bridge mount, project-scoped file-operation proof, file/workarea operation allowlists, project-context routing, privacy-safe decision categories, and shell sleep/wake preservation. Source, Kanban, and Manage runtime CEF/file-bridge instantiation remain not done in this workflow; do not unblock runtime work through fallback URLs, path probes, .git/project-name inference, or synthetic readiness.

CDXC:GPUIProjectWorkareaReadiness 2026-06-23-16:17:
Slice 214 adds strict source-only Kanban/Manage readiness parser/store evidence to the Phase 6/7 handoff. The contract accepts only exact current active-project plus Kanban/Manage surface identity and mounting/ready/loadFailed state; it does not mount CEF, mount Manage, perform file I/O, log/persist private details, accept paths, URLs, file names, file contents, failure details, fallback probes, or replace placeholders.

CDXC:GPUIManageFileWorkareaBridge 2026-06-23-16:35:
Slice 216 adds strict source-only Manage operation request parser/store evidence to the Phase 7 handoff. The contract accepts only exact current Manage active-project/workarea identity plus operation-name string and stores only the privacy-safe allowlist decision category; it does not execute file operations, mount CEF or file bridges, accept private payloads, log/persist private details, mark readiness, or replace placeholders.

CDXC:GPUISourceReadiness 2026-06-23-16:54:
Slice 218 historically reconciled Phase 5 at the real Source mount blocker before later Source request slices. Later Source CEF/code-server request, URL-boundary, CEF materialization, runtime-parity, placeholder-preflight, URL-issuance-boundary, startup-navigation, and owner-gate source contracts supersede that current source-ledger blocker for this pass. Runtime CEF/code-server instantiation, runtime URL issuance, first navigation, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work; do not advance readiness by accepting URL/path/code-server payloads, fallback localhost probes, logging, persistence, CEF creation, placeholder replacement, or synthetic mount state.

CDXC:GPUIKanbanWorkareaParity 2026-06-23-16:59:
Slice 219 historically reconciled Phase 6 at the real Kanban CEF mount blocker after slice 239. Later Kanban CEF request, first-party entrypoint, CEF materialization, runtime-parity, placeholder-preflight, URL-issuance-boundary, and owner-gate source contracts supersede that current source-ledger blocker for this pass. Runtime CEF instantiation, runtime URL issuance, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work; do not advance runtime Kanban by accepting URL/path/CEF payloads, fallback probes, logging, persistence, CEF creation, hidden surfaces, placeholder replacement, or synthetic mount state.

CDXC:GPUIManageCefMount 2026-06-23-21:36:
Slice 242 adds source-only Manage CEF mount-request evidence to this Phase 7 handoff, slice 250 adds the fixed first-party CEF app-resource entrypoint label, slice 251 adds source-ledger CEF materialization, file-bridge mount, and file-operation proof contracts, slice 257 adds source-only runtime-parity evidence with CEF as the only accepted web-pane engine, and slice 261 adds placeholder-replacement preflight evidence. These source-ledger CEF/file-bridge contracts are accepted for this pass; runtime CEF browser creation, runtime URL issuance, runtime file-bridge mounting, file I/O, validation, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-03:04:
Slice 246 retires the Source process gap only as a non-spawning app-resource launch-plan contract, and slice 247 retires the URL gap only as source-ledger URL-boundary evidence. Slice 248 retires Source CEF materialization only as a CEF-only source-ledger contract; do not reintroduce process spawning, ports, runtime URLs, paths, hidden mounts, logs, persistence, actual runtime CEF instantiation, or placeholder replacement into the source-only handoff.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-03:12:
Source Phase 5 no longer has a current source-ledger CEF materialization blocker after the CEF-only source-ledger materialization contract. Runtime Source remains uninstantiated by this workflow: no runtime URL was issued, code-server was not started, no CEF browser was created, no hidden mount was made, no validation/app command was run, and the placeholder was not replaced.
-->

Combined Phase 5-7 source-only handoff after slice 268:

- Source has explicit source identity, strict source-only v1 readiness parser/store keyed to exact current active project plus Source workarea id, a sidebar-scoped safe external bridge route into the strict store, loading/ready/load-failed bridge states, a source-only CEF/code-server mount-request boundary for the exact ready Source runtime identity with a fixed app-resource entrypoint, a non-spawning app-resource process launch plan, source-ledger URL-boundary evidence, a CEF-only source-ledger materialization contract, source-only runtime parity and placeholder-replacement preflight evidence, a Source-only startup navigation readiness boundary that keeps first code-server navigation deferred until a future runtime readiness gate succeeds and an issued runtime URL exists, and a Source-only runtime CEF surface owner/creation gate wired into refresh/render bookkeeping while recording that real runtime facts are still absent, static loading/load-failed placeholder copy, privacy-boundary runtime JSON, and shell sleep/wake preservation for identity, companion layout, and command-pane state.
- Kanban has explicit project/board identity, strict source-only v1 readiness parser/store keyed to exact current active project plus Kanban surface id, a sidebar-scoped safe external bridge route into the strict store, availability checks, missing/mounting/ready/load-failed lifecycle bridge states, a source-only CEF mount-request boundary for the exact ready Kanban runtime identity with a fixed first-party CEF app-resource entrypoint label and CEF-only source-ledger materialization contract, source-only runtime parity and placeholder-replacement preflight evidence, a Kanban-only runtime CEF surface owner/creation gate wired into refresh/render bookkeeping while recording that real runtime facts are still absent, static mounting/load-failed placeholder copy, privacy-boundary runtime JSON, and shell sleep/wake preservation for identity, companion layout, and command-pane state.
- Manage has strict Debugging Mode plus beta gating, explicit project/workarea identity, strict source-only v1 readiness parser/store keyed to exact current active project plus Manage surface id, a source-only Manage CEF mount-request boundary for the exact ready Manage runtime identity with a fixed first-party CEF app-resource entrypoint label, source-ledger CEF materialization, source-only file-bridge mount, project-scoped file-operation proof contracts, source-only runtime parity with CEF as the only accepted web-pane engine, a placeholder-replacement preflight gate that denies replacement until a future runtime URL, CEF browser, normal-layout CEF surface, runtime file bridge, runtime file operation, no CEF/file-bridge payload, no hidden mount, no private runtime data/logging/persistence, and explicit replacement permission exist, strict source-only v1 operation request parser/store keyed to exact current Manage identity, a sidebar-scoped safe external bridge route into those stores, availability checks, missing/mounting/ready/load-failed lifecycle bridge states, file/workarea operation allowlist policy, project-context routing, privacy-safe decision categories, and shell sleep/wake preservation for identity, load-failed bridge state, companion layout, and command-pane state.
- Source, Kanban, and Manage share source-only runtime URL issuance decisions formed only after ready runtime-parity, placeholder-preflight, and ownership-slot evidence. These decisions require future real URL authority before any issued URL or CefSurface creation, keep Browser excluded, and currently carry no authority, issued URL, retained URL value, code-server/file-bridge/file-I/O payload, hidden/offscreen mount, private runtime data/logging/persistence, or placeholder replacement.
- Source startup navigation readiness is a separate Source-only evidence boundary derived from the Source runtime URL issuance decision. It records that non-code destinations do not use the Source startup readiness wait and currently allows no direct Source navigation, readiness probe, URL scheme/host payload, code-server startup, CefSurface creation, hidden/offscreen mount, private payload, logging/persistence, or placeholder replacement.
- Source runtime CEF surface owner/creation is a separate Source-only gate derived from startup navigation readiness. It records that future placeholder replacement may use only a normal-layout CEF child surface after runtime readiness success, real URL authority, issued runtime URL, code-server process availability, CEF surface creation, and explicit replacement permission exist; current source still has none of those runtime facts and creates no surface.
- Kanban runtime CEF surface owner/creation is a separate Kanban-only gate derived from the Kanban runtime URL issuance decision. It records that future placeholder replacement may use only a normal-layout CEF child surface after real URL authority, issued runtime URL, CEF surface creation, and explicit replacement permission exist; current source still has none of those runtime facts and creates no surface.
- Manage runtime CEF/file-bridge owner/creation is a separate Manage-only gate derived from the Manage runtime URL issuance decision. It records that future placeholder replacement may use only a normal-layout CEF child surface after real URL authority, issued runtime URL, CEF surface creation, runtime file-bridge mounting, runtime file-operation execution, and explicit replacement permission exist; current source still has none of those runtime facts and creates no surface, bridge, file operation, or payload.
- The central project-workarea pane-engine policy now combines Source, Browser, Kanban, and Manage source evidence only through CEF web-pane labels and safe booleans. It rejects WKWebView/WebKit/non-CEF/candidate labels without retaining rejected labels in safe JSON, and it leaves runtime checking to the user.
- The source-ledger blocker boundary no longer leaves Source, Kanban, or Manage with current Phase 5/6/7 source-ledger gates after their CEF-only/source-ledger contracts. Runtime Source, Kanban, and Manage instantiation remain not done in this workflow. No fallback URLs, runtime URL values, hostnames, ports, query strings, fragments, path probes, .git/project-name inference, synthetic readiness, URL/path/CEF/code-server payloads, non-CEF engine usage, retained rejected-engine labels, hidden surfaces, file names, file contents, operation args, failure details, logging, persistence, CEF creation, file-bridge creation, placeholder replacement, or file I/O should be used to bypass runtime contracts.

## Phase 5: Real Source Workarea

<!--
CDXC:GPUISourceWorkarea 2026-06-24-08:21:
Phase 5 first recorded source-only Source sleep/wake evidence for preserving explicit runtime identity, accepted loading/load-failed lifecycle visibility, companion state, and command-pane state. This sleep/wake-only evidence is accepted source-ledger lifecycle visibility for this pass and does not by itself authorize runtime Source CEF/code-server instantiation, runtime URL issuance, first navigation, hide/suspend/wake proof, or Source placeholder replacement.

CDXC:GPUISourceWorkarea 2026-06-24-07:23:
After the 07:18 requirement update, Source's CEF-only source contracts count as source-only runtime parity for this pass. Actual CEF/code-server instantiation, first navigation, and placeholder replacement stay future runtime work or user-side checks, not agent blockers.

CDXC:GPUISourceWorkarea 2026-06-24-08:21:
Source loading/load-failed lifecycle states now have distinct static placeholder copy so users can tell startup from failure while Source remains placeholder-only. That copy is accepted source-ledger evidence for this pass, not runtime UI replacement or running-app evidence; runtime Source CEF/code-server instantiation, runtime URL issuance, first navigation, hide/suspend/wake proof, and normal-layout CEF surface replacement remain user-side or future explicit CEF-only work.

CDXC:GPUISourceWorkarea 2026-06-24-08:27:
Slice 291 aligns Phase 5 small-slice and acceptance wording with the current source-only CEF parity requirement. Source CEF/code-server contracts are accepted for this source-ledger pass; runtime CEF/code-server instantiation, runtime URL issuance, first navigation, hide/suspend/wake proof, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work, not current agent acceptance criteria.

CDXC:GPUISourceReadiness 2026-06-23-16:10:
Phase 5 now has a strict source-only readiness parser/store keyed to the explicit current active project/source identity. The readiness message is enum-only evidence and must not include a code-server URL, path, project detail, failure detail, CEF mount instruction, log/persistence payload, fallback probe, or permission to replace the placeholder.

CDXC:GPUISourceReadiness 2026-06-23-16:54:
Phase 5 was historically blocked at the real Source mount step before later Source CEF/code-server request contracts. The source-only readiness boundary and sidebar-scoped bridge route are not by themselves runtime CEF/code-server instantiation, real hide/suspend/wake proof, or placeholder replacement proof; the later source-ledger CEF contracts are accepted for this pass while actual runtime URL issuance, CEF/code-server creation, first navigation, runtime checks, and placeholder replacement remain user-side or future explicit CEF-only work. Do not widen readiness into URL/path/code-server payloads, fallback localhost probes, logging, persistence, CEF creation, placeholder replacement, or fake mount state.

CDXC:GPUISourceCefCodeServerMount 2026-06-23-21:43:
Phase 5 now has a source-only CEF/code-server mount-request boundary for the exact ready Source runtime identity. Current source records a fixed app-resource code-server entrypoint, a source-only `appResourceCodeServerLaunchPlan` process state, source-ledger `sourceLedgerCodeServerUrlContract`, and CEF-only `sourceLedgerCefMaterializationContract`; actual runtime CEF/code-server instantiation and placeholder replacement are still not done and must not be synthesized from runtime URLs, hostnames, ports, queries, fragments, paths, process details, project names, fixture routes, localhost probes, hidden mounts, logs, persistence, or fallbacks.
-->

Why after project bridge: Source needs real project identity and project paths. It is currently a colored placeholder.

Small slices and source-ledger status:

- Future explicit CEF runtime work only: mount the Source/code-server surface as a project-editor surface.
  - It should replace only the Source colored placeholder body after runtime CEF/code-server instantiation, runtime URL issuance, first navigation, and explicit replacement permission are proven.
  - It must preserve titlebar mode switching and command-pane coexistence.
- Wire project-scoped Source identity.
  - Source should use the active project's real editor context from the Phase 1 bridge.
  - Quick/projectless behavior should match macOS.
- Preserve companion pane behavior.
  - Left companion resize, hide/restore, focus, and persistence should continue working.
- Future explicit CEF runtime work only: add Source hide/suspend/wake proof.
  - Sleeping Source should hide or suspend the real CEF/code-server surface only after that runtime surface exists, while keeping the selected sleeping placeholder.
  - Activating the placeholder should wake without resetting companion or command-pane state.
  - Source-only status: shell sleep/wake preserves explicit Source runtime identity, loading/ready/load-failed lifecycle bridge states and copy, companion layout state, and command-pane shell state. Runtime Source hide/suspend/wake proof, CEF/code-server instantiation, runtime URL issuance, first navigation, and placeholder replacement were not performed in this workflow and remain user-side or future explicit CEF-only work.
- Accepted Source lifecycle persistence boundary evidence.
  - Persist only safe shell metadata, not editor buffers, project paths, file paths, or code contents.
  - Source-only status: Source runtime persistence evidence uses privacy-boundary runtime JSON with safe booleans and enum labels only; it does not persist private project ids, workarea ids, paths, URLs, editor titles, code-server details, or load failure details.
- Keep the readiness boundary source-only until runtime instantiation is deliberately implemented.
  - Source-only status: GPUI can parse and store a strict v1 readiness message containing only `activeProjectId`, `sourceWorkareaId`, and `state` for the current explicit Source identity. Nonmatching, stale, Quick/projectless, malformed, extra-key, unsupported-state, or missing-identity payloads no-op or error without changing readiness.
  - This readiness boundary does not provide a code-server URL, create CEF, mount Source, log or persist private details, probe localhost or paths, or replace placeholders.
- Keep the Source CEF/code-server mount request source-only until runtime instantiation is deliberately implemented.
  - Source-only status: GPUI can form an in-memory CEF/code-server mount request from the exact ready Source runtime identity, the fixed app-resource code-server entrypoint, a non-spawning app-resource process launch-plan state, source-ledger URL-boundary evidence, and a CEF-only source-ledger materialization contract.
  - This request is still not a runtime-instantiated Source surface in this workflow. Do not start CEF/code-server mounting, issue runtime URLs, replace placeholders, claim real hide/suspend/wake, fallback probe, log, persist, expand URL/path/code-server payloads, create hidden mounts, probe localhost, infer project names/.git/fixtures, or synthesize mount state from the source-only readiness or request evidence.

Acceptance:

- Current source-ledger acceptance for this pass: Source CEF/code-server source contracts satisfy source-only runtime parity, and Source may remain placeholder-only until future explicit CEF runtime work replaces it.
- Future explicit CEF runtime acceptance, if requested: Source no longer shows the colored placeholder when awake and available after runtime CEF/code-server instantiation, runtime URL issuance, first navigation, and explicit replacement permission are proven.
- Future explicit CEF runtime acceptance, if requested: Sleeping Source hides or suspends the real CEF/code-server surface while the selected mode-specific placeholder wakes through the normal project-editor path without resetting companion or command-pane state.
- Runtime Source CEF/code-server instantiation, runtime URL issuance, first navigation, hide/suspend/wake proof, placeholder replacement, and runtime checking remain user-side or future explicit CEF-only work outside this no-validation source-ledger workflow.

## Phase 6: Real Kanban Workarea

<!--
CDXC:GPUIKanbanWorkareaParity 2026-06-24-08:19:
Phase 6 first recorded source-only Kanban sleep/wake evidence for preserving explicit project/board runtime identity, accepted source-ledger lifecycle/CEF contract visibility, companion state, and command-pane state. This sleep/wake-only evidence remains source-ledger-only: it does not authorize runtime CEF instantiation, runtime URL issuance, synthesized readiness, private Kanban fact persistence, companion or command-pane shell-state resets, or placeholder replacement.

CDXC:GPUIKanbanWorkareaParity 2026-06-24-07:23:
After the 07:18 requirement update, Kanban's CEF-only source contracts count as source-only runtime parity for this pass. Actual CEF browser instantiation and placeholder replacement stay future runtime work or user-side checks, not agent blockers.

CDXC:GPUIKanbanWorkareaParity 2026-06-24-08:02:
Slice 282 reclassifies stale Phase 6 small-slice wording: Kanban source-ledger CEF contracts are accepted for this pass, while readiness remains source-only and separate from runtime CEF instantiation, runtime URL issuance, hidden mounts, placeholder replacement, fallback probes, logging/persistence/private payloads, and any WKWebView/WebKit/non-CEF path. Do not widen this docs cleanup into runtime CEF work.

CDXC:GPUIKanbanWorkareaParity 2026-06-24-08:27:
Slice 291 aligns Phase 6 small-slice and acceptance wording with the current source-only CEF parity requirement. Kanban CEF contracts are accepted for this source-ledger pass; runtime CEF instantiation, runtime URL issuance, hide/suspend/wake proof, placeholder replacement, and runtime checking remain user-side or future explicit CEF-only work, not current agent acceptance criteria.

CDXC:GPUIProjectWorkareaReadiness 2026-06-23-16:17:
Phase 6 now has a strict source-only project-workarea readiness parser/store keyed to the exact current active project and Kanban surface identity. The message is enum-only readiness evidence and must not include URLs, paths, file names, file contents, failure details, CEF mount instructions, log/persistence payloads, fallback probes, or permission to replace the placeholder.

CDXC:GPUIKanbanWorkareaParity 2026-06-23-16:59:
Phase 6 was historically blocked at the real Kanban CEF mount step before later source-ledger request, materialization, runtime-parity, placeholder-preflight, URL-issuance-boundary, and owner-gate slices. Those CEF-only source contracts are accepted for this pass; actual runtime URL issuance, runtime CEF creation, runtime checks, and placeholder replacement remain user-side or future explicit CEF-only work. The source-only readiness boundary and sidebar-scoped bridge route are not by themselves runtime CEF creation, real hide/suspend/wake proof, or placeholder replacement proof; do not widen them into URL/path/CEF payloads, fallback probes, logging, persistence, CEF creation, hidden surfaces, placeholder replacement, or fake mount state.

CDXC:GPUIKanbanCefMount 2026-06-23-21:32:
Phase 6 now has a source-only Kanban CEF mount-request boundary keyed to the exact active project plus Kanban surface identity. Slice 249 adds a fixed first-party CEF app-resource entrypoint label, slice 250 adds CEF-only source-ledger materialization, slice 256 adds source-only runtime-parity evidence with CEF as the only accepted web-pane engine, and slice 260 adds the placeholder-replacement preflight gate, so keep rendering the placeholder until a real runtime CEF browser path exists without URLs, paths, board names, page titles, CEF payloads, localhost probes, fixture names, fallbacks, non-CEF engine usage, retained rejected-engine labels, logging, persistence, hidden surfaces, private payloads, or placeholder replacement.

CDXC:GPUIKanbanCefMount 2026-06-24-03:41:
Phase 6 now has a CEF-only source-ledger materialization contract for exact-identity Kanban requests after the fixed first-party CEF app-resource entrypoint exists. This removes the current Kanban source-ledger gate but not the runtime caveat: no runtime CEF browser, runtime URL, hidden mount, validation, logging/persistence, private payload, or placeholder replacement exists.
-->

Why after project bridge: Kanban is project-scoped and must be disabled without a project.

Small slices and source-ledger status:

- Future explicit CEF runtime work only: mount the bundled Kanban project board through a GPUI CEF surface.
  - Use a normal child/native surface in the Kanban project-editor body.
  - Do not overlap command pane, companion pane, tab bars, or dividers.
- Route project board context.
  - Use the active project snapshot from Phase 1.
  - Keep Quick/projectless disabled behavior.
- Future explicit CEF runtime work only: add Kanban hide/suspend/wake proof.
  - Sleeping Kanban hides or suspends the CEF surface only after that runtime surface exists, while keeping the selected sleeping placeholder.
  - Waking restores the same project board identity.
  - Kanban source-only status: shell sleep/wake preserves explicit Kanban project/board runtime identity, accepted missing/mounting/ready/load-failed lifecycle bridge states and copy, companion layout state, and command-pane shell state. Runtime Kanban hide/suspend/wake proof, CEF instantiation, runtime URL issuance, and placeholder replacement were not performed in this workflow and remain user-side or future explicit CEF-only work.
- Add lifecycle and error states.
  - Startup/mounting should be visible.
  - Load failures should not remove the titlebar mode or corrupt shell state.
  - Source-only status: availability checks, lifecycle bridge state, static mounting/load-failed placeholder copy, and privacy-boundary runtime JSON are accepted as source-only lifecycle evidence for this pass, but they do not instantiate a runtime CEF browser, issue a runtime URL, replace placeholders, create hidden mounts, add fallback probes, log or persist private payloads, or prove runtime mount behavior.
- Keep the readiness boundary source-only and separate from runtime CEF instantiation, runtime URL issuance, hidden mounts, and placeholder replacement even though the Kanban CEF source-ledger contracts are accepted for this pass.
  - Source-only status: GPUI can parse and store a strict v1 project-workarea readiness message containing only `surface`, `activeProjectId`, `surfaceId`, and `state` for the current explicit Kanban identity. Nonmatching, stale, Quick/projectless, malformed, extra-key, unsupported-state/surface, or missing-identity payloads no-op or error without changing lifecycle state.
  - This readiness boundary does not provide a URL, create or mount CEF, log or persist private details, probe fallbacks, carry file details, replace placeholders, or add WKWebView/WebKit/non-CEF paths.
- Add the Kanban CEF mount-request boundary before real mounting.
  - Source-only status: GPUI can form an in-memory request boundary from runtime-ready Kanban availability, carrying only the exact active project plus Kanban surface identity, a fixed first-party CEF app-resource entrypoint label, and a CEF-only `sourceLedgerCefMaterializationContract` state.
  - The request boundary does not accept or synthesize arbitrary URLs, file paths, project paths, board names, failure details, page titles, CEF payloads, localhost probes, fixture names, fallback paths, logging, persistence, hidden surfaces, or placeholder replacement.
- Keep dependent Kanban runtime implementation outside this source-ledger pass until future product work explicitly requests a normal child CEF browser mount path.
  - Do not start CEF mounting, hidden-surface creation, placeholder replacement, real hide/suspend/wake, fallback probing, non-CEF engine usage, logging, persistence, URL/path/CEF payload expansion, private payload carriage, or synthetic mount state from the source-only readiness or mount-request evidence.

Acceptance:

- Current source-ledger acceptance for this pass: Kanban CEF source contracts satisfy source-only runtime parity, and Kanban may remain placeholder-only until future explicit CEF runtime work replaces it.
- Future explicit CEF runtime acceptance, if requested: Kanban is a real first-party project board surface when available after runtime CEF instantiation, runtime URL issuance, and explicit replacement permission are proven.
- It remains project-scoped and disabled without a project.
- Future explicit CEF runtime acceptance, if requested: Sleeping Kanban hides or suspends the real CEF surface and wakes with the same project board identity.
- Runtime Kanban CEF instantiation, runtime URL issuance, hide/suspend/wake proof, placeholder replacement, and runtime checking remain user-side or future explicit CEF-only work outside this no-validation source-ledger workflow.

## Phase 7: Real Manage Workarea And File Bridge

Why after project bridge and feature gate: Manage is beta/debug gated and project-scoped, with a real file/workarea bridge in macOS.

<!--
CDXC:GPUIManageWorkareaParity 2026-06-23-14:10:
Phase 7 has source-ledger GPUI progress for Manage operation allowlisting, project-context routing, lifecycle bridge state, shell sleep/wake identity preservation, CEF-only materialization, source-only file-bridge mount, project-scoped file-operation proof, and source-only runtime parity. Keep these slices documented as runtime boundaries, not runtime instantiation signoff.

CDXC:GPUIManageWorkareaParity 2026-06-23-14:48:
Phase 7 Manage source-only sleep/wake evidence now preserves explicit project/workarea runtime identity, load-failed bridge state, companion layout state, and command-pane shell state without synthesizing runtime readiness or mounting CEF/file bridges. Slice 251 accepts the source-ledger CEF/file-bridge/proof contracts; runtime Manage still needs actual CEF/file-bridge instantiation, file-operation execution, validation, and placeholder replacement outside this workflow.

CDXC:GPUIProjectWorkareaReadiness 2026-06-23-16:17:
Phase 7 now has a strict source-only project-workarea readiness parser/store keyed to the exact current active project and Manage surface identity. The message is enum-only readiness evidence and must not include URLs, paths, file names, file contents, failure details, Manage/CEF/file-bridge mount instructions, file I/O, log/persistence payloads, fallback probes, or permission to replace the placeholder.

CDXC:GPUIManageFileWorkareaBridge 2026-06-23-16:35:
Phase 7 now has a strict source-only Manage operation request parser/store keyed to the exact current Manage runtime identity. The message is decision-boundary evidence only and must not include args, paths, file names, file contents, URLs, raw payloads, command args, stdout/stderr, failure details, tokens, credentials, cookies, env values, CEF state, bridge/runtime payloads, file I/O, logs, persistence, fallback probes, readiness promotion, or permission to replace the placeholder.

CDXC:GPUIManageWorkareaParity 2026-06-23-17:09:
Phase 7 source-ledger gates are accepted after slice 268. The source-only readiness parser/store, lifecycle bridge states, operation request parser/store, file-operation allowlist, sidebar-scoped bridge route, CEF-only materialization, source-only file-bridge mount, project-scoped proof, source-only runtime-parity plan, placeholder-replacement preflight gate, Manage runtime CEF/file-bridge owner gate, and sleep/wake preservation are still not runtime CEF creation, runtime file-bridge mounting, file I/O, validation, or placeholder replacement.

CDXC:GPUIManageCefMount 2026-06-23-21:36:
Phase 7 now has a source-only Manage CEF mount-request boundary keyed to the exact ready Manage runtime identity. Slice 250 adds the fixed first-party CEF app-resource entrypoint label, slice 251 adds accepted source-ledger CEF materialization, file-bridge mount, and file-operation proof contracts, slice 257 adds source-only runtime-parity evidence with CEF as the only accepted web-pane engine, and slice 261 adds placeholder-replacement preflight evidence. The contracts are accepted for this pass, while runtime CEF/file-bridge instantiation, runtime URL issuance, file I/O, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work; do not widen the request into URLs, paths, project paths, file names, file contents, operation args, failure details, page titles, CEF payloads, file-bridge payloads, localhost probes, fixture names, fallbacks, hidden mounts, logging, persistence, file I/O, non-CEF engine state, retained rejected-engine labels, or placeholder replacement.

CDXC:GPUIManageCefMount 2026-06-24-03:41:
Phase 7 now has a source-only first-party CEF app-resource entrypoint label for exact-identity Manage requests. Slice 251 supersedes the remaining source-ledger CEF/file-bridge/proof gaps, slice 257 adds source-only runtime-parity acceptance, and slice 261 adds placeholder-replacement preflight acceptance; the request must still not be widened into runtime CEF/file-bridge creation, file I/O, URLs, paths, private payloads, non-CEF engines, retained rejected-engine labels, hidden mounts, logging, persistence, or placeholder replacement.

CDXC:GPUIManageWorkareaParity 2026-06-24-08:24:
Slice 290 is docs/progress wording cleanup for Phase 7 Manage. Strict feature gating, active project/workarea routing, lifecycle bridge states/copy, and shell sleep/wake identity preservation are accepted source-ledger evidence for this pass; runtime Manage CEF/file-bridge surface update/instantiation, runtime URL issuance, file I/O, placeholder replacement, hide/suspend/wake proof, and runtime checks remain user-side or future explicit CEF-only work.

CDXC:GPUIManageWorkareaParity 2026-06-24-08:32:
Slice 292 aligns Phase 7 small-slice and acceptance wording with the current source-only CEF/file-bridge parity requirement. Manage CEF/file-bridge source-ledger contracts are accepted for this pass; runtime CEF browser instantiation, runtime URL issuance, runtime file-bridge mounting, file-operation execution, hide/suspend/wake proof, placeholder replacement, and runtime checking remain user-side or future explicit CEF-only work.
-->

Small slices and source-ledger status:

- Future explicit CEF runtime/file-bridge work only: mount the bundled Manage page through a GPUI CEF surface and runtime file bridge.
  - It should replace only the Manage colored placeholder body after runtime CEF browser instantiation, runtime URL issuance, runtime file-bridge mounting, project-scoped file-operation execution, and explicit replacement permission are proven.
  - Keep the strict Debugging Mode plus Show Beta Features gate.
  - Source-only status: an exact-identity Manage CEF mount-request boundary exists with a fixed first-party CEF app-resource entrypoint label plus accepted source-ledger CEF materialization, file-bridge mount, file-operation proof contracts, source-only runtime-parity plan, and placeholder-replacement preflight evidence. No runtime CEF browser, issued runtime URL, hidden mount, fallback probe, runtime file bridge, file I/O, validation, runtime check, or placeholder replacement exists.
- Add the Manage file/workarea bridge.
  - Use explicit allowlisted operations.
  - Sanitize logs at the writer boundary.
  - Do not expose paths or file contents in persistent logs.
  - Source-only status: file/workarea operation-name allowlisting, a strict v1 operation request parser/store for exact current Manage identity, and privacy-safe decision categories are accepted source-ledger state for this pass; runtime bridge/file I/O not performed in this workflow, and runtime CEF mounting, logging/persistence changes, fallback behavior, readiness promotion, and placeholder replacement were not added.
- Route active project context.
  - Manage must be disabled without a real project.
  - Project switches should update the Manage surface or fall back to Agents if unavailable.
  - Source-only status: strict feature gating, explicit project/workarea identity, availability/coercion, project-context routing, and runtime identity reset are accepted source-ledger state for this pass; runtime Manage CEF/file-bridge surface update/instantiation, runtime URL issuance, file I/O, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work.
- Future explicit CEF runtime/file-bridge work only: add Manage hide/suspend/wake proof and error states.
  - Sleeping Manage should preserve shell state and hide or suspend the real CEF/file-bridge surface only after that runtime surface and bridge exist.
  - Wake should restore the same project/workarea identity.
  - Source-only status: accepted source-only lifecycle bridge states/copy and shell sleep/wake identity preservation are source-ledger evidence for this pass: explicit project/workarea runtime identity, missing/mounting/ready/load-failed bridge states, companion layout state, and command-pane shell state are preserved without synthesizing readiness or claiming runtime CEF/file-bridge instantiation. Runtime Manage hide/suspend/wake proof, CEF/file-bridge instantiation, runtime URL issuance, file I/O, placeholder replacement, and runtime checks remain user-side or future explicit CEF-only work.
- Keep the readiness boundary source-only until a later runtime implementation intentionally instantiates CEF and a runtime file bridge.
  - Source-only status: GPUI can parse and store a strict v1 project-workarea readiness message containing only `surface`, `activeProjectId`, `surfaceId`, and `state` for the current explicit Manage identity. Nonmatching, stale, Quick/projectless, malformed, extra-key, unsupported-state/surface, or missing-identity payloads no-op or error without changing lifecycle state.
  - This readiness boundary does not provide a URL, create or mount Manage/CEF/file bridges, perform file I/O, log or persist private details, probe fallbacks, carry paths/file names/file contents/failure details, or replace placeholders.
- Keep dependent Manage real-mount and file-bridge work outside the current source-ledger scope until the user asks for runtime implementation/checking.
  - Do not start CEF mounting, file-bridge mounting, file I/O, placeholder replacement, real hide/suspend/wake, fallback probing, logging, persistence, URL/path/file/operation-args/CEF/file-bridge payload expansion, or synthetic mount state from the source-only readiness, mount-request, runtime-parity, placeholder-replacement preflight, and operation-request evidence.

Acceptance:

- Current source-ledger acceptance for this pass: Manage CEF/file-bridge source contracts satisfy source-only runtime parity with strict Debugging Mode plus Show Beta Features gating, project scope, and disabled-without-project behavior preserved.
- It remains hidden when the gate is closed and disabled without a project when visible.
- Future explicit CEF runtime acceptance, if requested: Manage is a real first-party project workarea only after runtime CEF browser instantiation, runtime URL issuance, runtime file-bridge mounting, project-scoped file-operation execution, and explicit placeholder replacement permission are proven.
- Future explicit CEF runtime acceptance, if requested: Sleeping Manage hides or suspends the real CEF/file-bridge surface and wakes with the same project/workarea identity after the runtime surface and bridge exist.
- Runtime Manage CEF/file-bridge instantiation, runtime URL issuance, file I/O, hide/suspend/wake proof, placeholder replacement, and runtime checking remain user-side or future explicit CEF-only work outside this no-validation source-ledger workflow.

## Phase 8: Browser Runtime Parity Beyond Placeholder Shell

Why separate: Browser shell parity is broad, and runtime Browser checks plus any future CEF lifecycle changes remain user-side or future explicit work after the accepted source-ledger CEF contracts.

<!--
CDXC:GPUIBrowserRuntimeParity 2026-06-23-14:12:
Phase 8 has accepted source-ledger CEF contracts for generated Browser profiles, feedback injection, tab-owned CEF identity, hide-and-hold visibility, restored-placeholder policy, popup target policy, explicit unsupported/no-op Browser import, blank/script-created popup no-transfer, and sanitized persistence. Runtime checks and any future Browser CEF lifecycle changes remain user-side or future explicit work.

CDXC:GPUIBrowserRuntimeParity 2026-06-23-14:52:
Browser sleep/wake has accepted source-ledger preservation evidence for generated profile state, Browser tab/split shell state, companion layout state, command-pane shell state, and the current hide-and-hold boundary for existing CEF surfaces. It preserves unsupported/no-op import, blank-popup no-transfer, restored-placeholder no-materialization, sanitized persistence, and no runtime CEF suspend/teardown or WKWebView/WebKit/non-CEF path.

CDXC:GPUIBrowserRuntimeParity 2026-06-23-15:41:
Slice 206 reconciles Phase 8 Browser as source-only handoff evidence, not final product signoff. Generated Browser profile ids, active profile persistence, profile-owned tab-surface plumbing, beta-only Profile visibility, fixed unsupported Import Browser Data policy, feedback injection boundaries with GitHub disabled behavior, tab-owned CEF identity, hide-and-hold visibility for existing CEF surfaces, restored-placeholder rendering, non-empty popup target tab creation, empty/script-created popup no-op behavior, shell sleep/wake preservation, and sanitized persistence boundaries are accepted source-ledger state for this pass. Slice 215 keeps `browserWorkareaId` rejected by Phase 1, and slices 252 and 258 accept the Browser CEF contracts while runtime checks and future CEF lifecycle changes remain user-side/future explicit work.

CDXC:GPUIBrowserRuntimeParity 2026-06-23-17:15:
Slice 221 captured historical Browser runtime-boundary gaps. Current Browser source-ledger CEF contracts are accepted for this pass through the Phase 1 browserWorkareaId rejection contract, unsupported/no-op compatible import, blank/script-created popup no-transfer, and CEF-only hide-and-hold/restored-placeholder lifecycle evidence; runtime Browser checking and any future CEF lifecycle changes remain outside this workflow unless explicitly requested.

CDXC:GPUIBrowserRuntimeParity 2026-06-24-04:10:
Slice 252 accepts Browser for the source ledger through explicit source-only contracts. Phase 1 keeps rejecting browserWorkareaId, Browser identity remains owned by the strict readiness boundary, compatible import remains unsupported/no-op without import data or probes, blank/script-created popups remain no-transfer, and the CEF lifecycle decision is hide-and-hold/restored-placeholder evidence only; no runtime CEF browser, URL, suspend/teardown, hidden surface, logging/persistence, private payload, placeholder replacement, WKWebView path, WebKit path, or non-CEF path exists.

CDXC:GPUIBrowserRuntimeParity 2026-06-24-05:06:
Slice 258 adds Browser source-only runtime parity acceptance with CEF as the only web-pane engine. The plan may count existing tab-owned CEF visibility plus Phase 1 Browser identity rejection, strict readiness, unsupported/no-op import, blank-popup no-transfer, and restored-placeholder contracts for the source ledger, but it must reject WKWebView/WebKit/non-CEF labels and must not create extra CEF surfaces, issue runtime URLs, import data, transfer popup content, suspend/tear down CEF, mount hidden surfaces, log/persist private details, or replace restored placeholders.

CDXC:GPUIBrowserRuntimeParity 2026-06-24-08:36:
Slice 293 aligns Phase 8 Browser docs with the accepted source-ledger state for this pass. Generated profile ids, active profile persistence, profile-owned tab/surface plumbing, beta-only Profile visibility, unsupported/no-op import, Settings-selected feedback boundaries, tab-owned CEF identity, CEF-only hide-and-hold/restored-placeholder lifecycle, popup no-transfer policy, shell sleep/wake preservation, sanitized persistence, strict readiness outside Phase 1, Phase 1 browserWorkareaId rejection, and existing tab-owned CEF visibility are accepted source-only Browser parity; runtime Browser checks plus future importer/content-transfer/CEF lifecycle changes remain user-side or future explicit CEF-only work.

CDXC:GPUIBrowserRuntimeParity 2026-06-24-09:09:
Browser runtime-parity privacy JSON must stay CEF-only and generic: expose the accepted `cef` engine label, record unsupported-engine rejection without retaining rejected labels or WKWebView/WebKit-specific capability fields, and leave runtime checks to the user.
-->

Combined Phase 8-10 source-only handoff after slice 258:

- Browser current source-ledger state includes generated Browser profile ids, active profile persistence, profile-owned tab/surface plumbing, beta-only Profile visibility, the fixed unsupported Import Browser Data policy, Settings-selected feedback injection boundaries with GitHub disabled behavior, tab-owned CEF identity, hide-and-hold visibility for existing CEF surfaces, restored-placeholder render policy, popup target policy where non-empty targets create loaded tabs and empty/script-created targets no-op/no-transfer, shell sleep/wake preservation of profile/tab/split/companion/command-pane state, sanitized persistence boundaries, strict Browser active-project/readiness parser/store evidence outside Phase 1, the sidebar bridge route into that strict store, the Phase 1 browserWorkareaId rejection contract, an unsupported/no-op compatible-import contract, a blank/script-created popup no-transfer contract, a CEF-only hide-and-hold/restored-placeholder lifecycle contract, and a source-only runtime-parity plan whose privacy JSON exposes only the accepted `cef` engine label plus generic unsupported-engine rejection while accepting only existing tab-owned CEF visibility and rejecting WKWebView/WebKit/non-CEF labels.
- This current Browser source-ledger state does not implement runtime CEF mount/materialization beyond existing tab-owned CEF visibility, import data ingestion, popup content transfer, profile creation changes, feedback injection changes, logging, persistence, fallback probes, hidden mounts, URL issuance, runtime suspend/teardown, extra CEF creation, restored-placeholder replacement, WKWebView/WebKit-specific capability fields, or broader message contracts.
- No Browser source-ledger blocker remains after slice 258. `browserWorkareaId` remains rejected in the Phase 1 active-project snapshot by contract, Browser import remains unsupported/no-op unless a future importer is explicitly built, blank/script-created popup content remains untransferred, and hide-and-hold/restored-placeholder behavior is the accepted CEF-only lifecycle source-ledger decision.
- Phase 9 remains outside this agent workflow because the current user instruction forbids formatting, checks, tests, typecheck, cargo check, whitespace checks, app launch/restart, browser/visual automation, and equivalent validation/app commands. Do not phrase validation as available or queue it as a later agent step in this continuation.
- No Phase 10 source-ledger blockers remain after slice 268. Source Phase 5, Kanban Phase 6, Manage Phase 7, Browser Phase 8, terminal physical-key/product behavior, cross-surface shell-only transfer, the central Source/Browser/Kanban/Manage CEF-only pane-engine policy, the Source/Kanban/Manage CEF ownership-slot scaffold, the Source/Kanban/Manage source-only runtime URL issuance boundary, the Source-only startup navigation readiness boundary, the Source runtime CEF surface owner/creation gate, the Kanban runtime CEF surface owner/creation gate, and the Manage runtime CEF/file-bridge owner/creation gate have source-ledger evidence through CEF-only/source-only/no-runtime contracts, including the Source, Kanban, and Manage placeholder-replacement preflight gates that still deny replacement until runtime prerequisites exist. Runtime Source/Kanban/Manage/Browser checks were not performed, no validation/app commands were run, no URL was issued or retained, no first Source navigation was started, no CEF surface or runtime file bridge was created, no file operation ran, and placeholders were not replaced. The source-side restored materialization contract, parked-owner reattach contract, close-confirm UI surface, `needs_confirm_quit` ABI/exact-removal evidence, runtime clipboard handoff, and no-native-physical-key product decision are accepted terminal source-ledger evidence. Placeholder paths and the ledger remain guardrails for future runtime work, not current source-ledger blockers.

Small slices and source-ledger status:

- Browser profile persistence is accepted source-ledger state for this pass.
  - Current status: generated profile ids, active profile persistence, profile-owned tab/surface plumbing, and beta-only Profile visibility are represented.
  - Keep Import Browser Data unsupported/no-op unless future importer work is explicitly requested.
  - Keep Profile hidden unless Show Beta Features is true.
- Future-only: add Browser import flow only if future importer work is explicitly requested.
  - Import should be explicit and user-initiated.
  - Do not import cookies, credentials, or history without a clear approved product requirement.
  - Source-ledger status: import dispatch is an explicit fixed unsupported/no-op notification and does not read browser stores, cookies, credentials, history, bookmarks, profile paths, file paths, shell state, CEF request-context data, logs, persistence, fallback probes, or payloads.
- Browser feedback injection boundaries are accepted source-ledger state for this pass.
  - Current status: Settings-selected Agentation/React Grab injection boundaries are represented with GitHub disablement, pinned script/module boundaries, and page-data-free notifications.
  - Keep the GitHub disabled rule and tooltip behavior.
  - Future feedback action changes, if requested, must preserve the accepted Settings-selected injection boundaries and GitHub disabled behavior.
- Browser CEF lifecycle management is accepted as source-ledger hide-and-hold/restored-placeholder state for this pass.
  - Current status: tab-owned CEF identity, CEF-only hide-and-hold visibility policy, restored-placeholder no-materialization behavior, and Browser shell sleep/wake preservation of generated profile state, tab/split state, companion layout, and command-pane state are represented without runtime CEF instantiation, URL issuance, suspend/teardown, hidden mounts, logging/persistence, private payloads, or placeholder replacement.
  - Future explicit CEF lifecycle work, if requested, can decide hide/suspend/teardown behavior while preserving tab-owned CEF identity and restored-placeholder no-materialization.
- Browser popup/content-transfer policy is accepted source-ledger state for this pass.
  - Current status: non-empty popup targets keep existing shell behavior, while empty/script-created targets are ignored without address-only fallback, transferable content, page title/URL/HTML/script/content/CEF payload/opener data serialization, logging, persistence, or private payload transfer.
  - Future explicit content-transfer work, if requested, must be split into a dedicated CEF-only privacy-safe slice.

Acceptance:

- Current source-ledger acceptance for this pass: Browser CEF/source-ledger parity is accepted through generated profile ids, active profile persistence, profile-owned tab/surface plumbing, beta-only Profile visibility, unsupported/no-op import, Settings-selected feedback injection boundaries, tab-owned CEF identity, CEF-only hide-and-hold visibility, restored-placeholder no-materialization, non-empty popup target behavior, empty/script-created popup no-transfer, shell sleep/wake preservation, sanitized persistence, strict Browser readiness outside Phase 1, Phase 1 `browserWorkareaId` rejection, existing tab-owned CEF visibility, and privacy JSON that exposes only the accepted `cef` engine label plus generic unsupported-engine rejection with no WKWebView/WebKit-specific capability fields.
- Browser import remains unsupported/no-op unless future importer work is explicitly requested.
- Runtime Browser checks and any future CEF lifecycle, importer, or content-transfer changes remain user-side or future explicit CEF-only work outside this no-validation source-ledger workflow.
- No app/runtime validation is claimed for Phase 8 in this workflow.

## Phase 9: Visual And Interaction Validation

Why late: app launch/restart and visual automation were intentionally skipped during the placeholder-shell pass. They remain outside this agent workflow under the persistent user instruction and are not a later agent step.

<!--
CDXC:GPUIValidationHandoff 2026-06-23-14:13:
The current continuation explicitly forbids running the bundled validation step: no formatting, targeted tests, full GPUI test/check, whitespace checks, app restart, launch, or visual automation should be run by agents in this thread. Slice 244 records Phase 9 as outside this source-ledger workflow, not queued agent work.

CDXC:GPUIValidationHandoff 2026-06-23-15:41:
Slice 206 kept Phase 9 blocked by user instruction; slice 244 supersedes that for the source-ledger effort by recording validation as outside this agent workflow. Future handoff notes must not describe formatting, checks, tests, app launch/restart, browser automation, visual automation, whitespace checks, or equivalent commands as allowed or queued agent work in this continuation.

CDXC:GPUIValidationHandoff 2026-06-23-15:44:
Treat the user's "don't do this step ever" instruction as persistent for this handoff. Phase 9 is an outside-workflow record, not queued agent work; keep checks, formatting, app launch/restart, browser automation, visual automation, and whitespace validation out of future slices.
-->

Outside-workflow validation records, not agent slices under the current no-validation instruction:

- Define approved app launch workflow for GPUI verification.
  - This remains outside the current agent workflow.
  - Do not schedule command/port capture as a worker task while the persistent no-validation instruction is active.
- Desktop and mobile-sized viewport evidence remains missing for sidebar divider, titlebar tabs, command pane, Browser toolbar, project-editor companion, and real surfaces.
- Interaction smoke evidence remains missing for tab selection, tab drag, split resize, command F12, mode switching, sleep/wake, and focus traversal.
- Surface overlap evidence remains missing for terminal, CEF-backed web, sidebar, titlebar, command pane, and dividers.
- Regression screenshots or documented manual checkpoints remain missing.

Acceptance:

- Phase 9 cannot be run by agents in this continuation while validation/app commands are forbidden.
- The user will check runtime later outside the current no-validation agent workflow.

## Phase 10: Cleanup, Migration, And Parity Signoff

Why last: after source-ledger contracts are accepted for this pass, temporary placeholder assumptions and old progress assumptions need to be retired deliberately without implying fake runtime surfaces.

<!--
CDXC:GPUIWorkspaceParityHandoff 2026-06-23-13:31:
Phase 10 can record source-only reconciliation work before final product signoff without hiding placeholder and runtime caveats.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-07:23:
After the 07:18 requirement update, Source, Browser, Kanban, and Manage CEF-only source contracts are runtime parity for this pass, terminal is accepted as working, and runtime checks are user-side. Future web-pane work remains CEF-only and must reject WKWebView/WebKit/non-CEF paths.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-08:46:
Slice 298 names the current Phase 10 mirror as a source-level guardrail ledger and guardrail table. No source-ledger blockers remain after slice 268; the ledger stays executable evidence and caveat data, and source-only assumptions without explicit contracts still do not clear guardrails or authorize runtime placeholder replacement or validation.

CDXC:GPUIWorkspaceParityHandoff 2026-06-24-08:54:
Phase 10 cleanup must keep placeholder-only paths until future runtime facts exist, not merely source-ledger contracts. Source, Kanban, and Manage source-ledger proof now includes CEF-only materialization contracts and source-only runtime-parity evidence, and Manage also has source-only file-bridge mount plus project-scoped file-operation proof contracts; those contracts satisfy the source-ledger purpose for this pass but do not authorize placeholder removal. Real placeholder retirement needs the matching real runtime CEF/code-server, CEF, or CEF/file-bridge surface as applicable, a normal-layout child surface, issued runtime URL/authority where that surface uses URL issuance, explicit placeholder replacement permission, and user/runtime proof.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-14:52:
Phase 8 Browser sleep/wake preservation evidence is accepted source-ledger CEF evidence for this pass, not runtime app signoff. Slice 252 adds explicit source-ledger contracts for unsupported/no-op import, blank/script-created popup no-transfer, and CEF-only hide-and-hold/restored-placeholder lifecycle, while runtime Browser checks and any future Browser CEF lifecycle changes remain user-side/future explicit work.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-14:59:
Phase 10 continuation after slices 193-197 is reconciliation-only. Keep runtime Source/Kanban/Manage mount caveats on the runtime caveat map, while slices 252 and 253 retire the Browser import/popup/lifecycle, physical-key/product, and cross-surface shell-only source-ledger gates. Slice 244 records validation outside this agent workflow, slices 256 and 260 accept Kanban for the source ledger without runtime creation or placeholder replacement, and slices 257 and 261 accept Manage source-only runtime parity plus placeholder-replacement preflight gating without runtime creation.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-15:02:
Phase 10 has a source-level guardrail ledger that mirrors the guardrail table. After slice 268 no source-ledger blockers remain, but the ledger remains executable guardrail data; source-only sleep/wake, placeholder, pane-engine policy, CEF-slot, runtime URL issuance-boundary, Source startup navigation readiness, Source runtime CEF owner-gate evidence, Kanban runtime CEF owner-gate evidence, and Manage runtime CEF/file-bridge owner-gate evidence still cannot justify runtime placeholder replacement or validation signoff.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-15:18:
Phase 10 reconciliation must keep Browser active-project surface identity/readiness out of the Phase 1 snapshot. Slice 201 intentionally rejects `browserWorkareaId`, and slice 252 accepts that rejection as the Browser source-ledger identity contract without claiming Browser runtime signoff.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-15:25:
Slice 203 reconciles the handoff out of Phase 1 source-only bridge work and into Phase 2 terminal status. Slice 239 accepts terminal host/native-view/Ghostty pipeline and clipboard evidence for the source-ledger purpose; later slices 248, 250, and 251 accept Source/Kanban/Manage CEF mount source-ledger evidence with runtime caveats. Slice 252 accepts Browser source-ledger contracts, and slice 253 accepts current physical-key/product behavior plus cross-surface shell-only transfer without runtime changes.

CDXC:GPUIWorkspaceParityHandoff 2026-06-23-15:41:
Slice 206 reconciles Phases 8-10 as one source-only guardrail handoff. Browser source evidence updated the then-current guardrail map, and Source/Kanban/Manage runtime caveats remain recorded for user runtime checking without being current source-ledger blockers after slices 248, 250, and 251. Slice 252 later retires Browser source-ledger gates, and slice 253 retires the physical-key plus cross-surface source-ledger gates while keeping runtime checks and validation outside this workflow.

CDXC:GPUIRuntimeTransfer 2026-06-23-16:02:
Slice 211 keeps cross-surface runtime transfer on the Phase 10 guardrail map as a product decision, not a validation task. Title, identity, tab, card, and placeholder movement may be represented in source, but runtime/process/content transfer across Agents, command, Browser, Source, Kanban, and Manage must wait for explicit contracts and privacy proof.

CDXC:GPUIPhase10BlockerLedger 2026-06-23-16:06:
Slice 212 makes the source-level guardrail ledger mirror the Phase 10 Terminal lifecycle activation/reattach and cross-surface runtime/process/content transfer rows; slice 222 extends the terminal rows with historical clipboard/physical-key evidence. This remains source-ledger alignment only, with no runtime wake, reattach, app-thread clipboard, native physical-key forwarding, process/content transfer, validation, logging, or persistence behavior added.

CDXC:GPUIBrowserWorkareaReadiness 2026-06-23-16:24:
Slice 215 adds Browser active-project/readiness to the source-only evidence map as a strict parser/store boundary, not a running Browser surface. Slice 252 later accepts the Browser source-ledger contracts while Phase 1 still rejects `browserWorkareaId`, import remains unsupported/no-op, blank/script-created popup transfer remains no-transfer, and lifecycle remains CEF-only hide-and-hold/restored-placeholder evidence.

CDXC:GPUIBrowserRuntimeParity 2026-06-23-17:15:
Slice 221 made the Browser ledger split explicit for the historical blocker map. Source-only profile/tab shell state, feedback injection, restored-placeholder no-op, unsupported import, blank-popup no-op, hide-and-hold, sanitized persistence, readiness parser/store evidence, sidebar bridge routing, Phase 1 browserWorkareaId rejection, unsupported/no-op import, blank-popup no-transfer, and CEF-only hide-and-hold/restored-placeholder lifecycle are now accepted source-ledger CEF contracts for this pass.

CDXC:GPUIBrowserRuntimeParity 2026-06-24-04:10:
Slice 252 records Browser Phase 10 source-ledger contracts for Phase 1 identity rejection, unsupported/no-op compatible import, blank/script-created popup no-transfer, and CEF-only hide-and-hold/restored-placeholder lifecycle. Browser runtime checks remain user-side, future Browser CEF lifecycle changes must be explicit, and the contracts must not be widened into URLs, import/profile/cookie/history/bookmark/path payloads, CEF instantiation, suspend/teardown, hidden surfaces, fallback probes, private logging/persistence, opener data serialization, placeholder replacement, or WKWebView/WebKit/non-CEF paths.

CDXC:GPUITerminalLifecycle 2026-06-23-17:19:
Slice 222 made the Terminal lifecycle and clipboard/physical-key ledger split explicit before runtime clipboard handoff existed. Source-only terminal host/native-view/Ghostty pipelines, all-visible Agents mount slots, startup handoff, close/process-exit cleanup, focus/resize/input boundaries, command runtime isolation, close-confirm callback/pending/cancel/confirmed-cleanup evidence, runtime-only privacy boundaries, denied clipboard drain/no-op behavior, and committed-text-only key handling stayed blocked by missing runtime/API gates at that point; slice 233 supersedes the denied clipboard substatus with source-side handoff evidence.

CDXC:GPUITerminalLifecycle 2026-06-23-17:37:
Slice 225 reconciles the Phase 10 terminal startup guardrail map. Startup Ghostty metadata readiness/failure snapshots, readiness handoff plans, process-exited failure results, startup host/surface ownership transfer into Running maps, slice 235 restored-unmounted materialization startup state, slice 236 parked-owner wake/reattach state, and slice 237 close-confirm ABI/exact-removal state are accepted source/runtime evidence for the source-ledger purpose after slice 239.

CDXC:GPUITerminalCloseConfirm 2026-06-23-17:45:
Slice 226 reconciles close-confirm evidence versus missing confirm acceptance. Later slices add UI and `needs_confirm_quit` source evidence, and slice 239 accepts the combined source-ledger evidence without claiming validation commands were run.

CDXC:GPUITerminalCloseConfirm 2026-06-23-18:48:
Slice 232 adds the source-side close-confirm UI surface contract as current evidence only. Slice 237 adds source-side GhosttyKit `needs_confirm_quit` ABI evidence and exact confirmed shell/session removal; slice 239 accepts this for the source-ledger purpose.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-23-17:51:
Slice 227 reconciled Terminal clipboard/current-key evidence before the runtime clipboard handoff existed. Explicit app paste, no file-path clipboard synthesis, denied runtime clipboard drains, committed `key_char` text, and IME/preedit text-service boundaries were source-only evidence; slice 233 supersedes the denied-drain substatus with source-side handoff evidence.

CDXC:GPUITerminalClipboardPhysicalKeys 2026-06-23-19:07:
Slice 233 credits the source-side surface-scoped app-thread runtime clipboard handoff for exact still-mounted Agents and command owners. Slice 239 accepts clipboard evidence for the source-ledger purpose, and slice 253 accepts current physical-key/product behavior without native physical-key identity or runtime key-forwarding changes.

CDXC:GPUIRuntimeTransfer 2026-06-23-17:25:
Slice 223 splits the Phase 10 cross-surface row so source-only shell movement categories cannot be mistaken for runtime transfer. Slice 253 later accepts shell-only movement and no live runtime/process/content transfer as the current source-ledger product decision; runtime transfer contracts are intentionally not required unless future product work enables live transfer.

CDXC:GPUIRuntimeTransfer 2026-06-24-04:15:
Slice 253 records the current cross-surface transfer acceptance as shell-only. No Ghostty process, terminal buffer, command payload/status, Browser CEF content, Source editor/runtime state, Kanban/Manage CEF/file-bridge content, clipboard/focus/key identity, URL, path, page title, payload, log, persistence, hidden mount, fallback transfer, private runtime data, or user-owned content may move between surface families in this source-only pass.

CDXC:GPUIManageFileWorkareaBridge 2026-06-23-16:35:
Slice 216 adds Manage file/workarea operation requests to the source-only evidence map as a strict parser/store boundary, not a running Manage bridge. Slice 251 supersedes the current source-ledger gap with a project-scoped file-operation proof tied to exact Manage identity and the source-only file-bridge mount contract; it still does not run file operations or mount a runtime bridge.

CDXC:GPUIManageCefMount 2026-06-23-21:36:
Slice 242 adds Manage CEF mount-request evidence to the source-only guardrail map, slice 250 adds first-party CEF app-resource entrypoint evidence, slice 251 adds source-ledger CEF materialization, source-only file-bridge mount, and project-scoped file-operation proof evidence, slice 257 adds source-only runtime-parity evidence with CEF as the only accepted web-pane engine, and slice 261 adds placeholder-replacement preflight evidence. Phase 10 no longer has a current Manage source-ledger gate, but runtime CEF/file-bridge creation, file I/O, validation, and placeholder replacement remain absent.

CDXC:GPUISourceReadiness 2026-06-23-16:54:
Slice 218 keeps Phase 10 honest about Source: the source-only readiness parser/store is evidence only, and later slices add entrypoint, launch-plan, URL-boundary, and CEF-only source-ledger materialization evidence without runtime Source instantiation. Do not retire placeholders or proceed with dependent Source runtime work by widening readiness into URL/path/code-server payloads, fallback localhost probes, logging, persistence, CEF creation, placeholder replacement, or fake mount state.

CDXC:GPUISourceCefCodeServerMount 2026-06-23-21:43:
Slice 243 adds Source CEF/code-server mount-request evidence to the source-only guardrail map. Slice 245 supersedes its first-party entrypoint gap, slice 246 supersedes its process gap, slice 247 supersedes its URL gap with source-ledger URL-boundary evidence, and slice 248 supersedes the CEF materialization source-ledger gap without runtime Source instantiation.

CDXC:GPUISourceCefCodeServerMount 2026-06-24-02:53:
Slice 245 adds the fixed app-resource code-server entrypoint evidence to the Source request map. Slice 246 adds a non-spawning app-resource process launch-plan state, slice 247 adds source-ledger URL-boundary evidence, and slice 248 adds CEF-only source-ledger materialization evidence, so Phase 10 no longer has a current Source source-ledger gate while runtime Source remains uninstantiated.
-->

Current status:

- Migration handling, persistence/logging privacy audit, and requirements reconciliation have source-only progress entries.
- Slices 218-237 split the historical Phase 10 guardrail map into explicit source-only evidence versus missing gates and fixed concrete terminal activation/startup/input/close-confirm mismatches, including the restored-shell-state `mounting` edge, source-side restored-unmounted materialization startup contract, source-side parked-owner wake/reattach contract, failed-startup retry attempt identity, the sidebar-scoped workarea bridge into strict readiness/operation stores, the family-scoped terminal close-confirm UI surface, GhosttyKit `needs_confirm_quit` ABI/exact-removal evidence, and the source-side terminal runtime clipboard handoff. Slice 239 accepts terminal source/runtime evidence for the source-ledger purpose, slice 252 accepts Browser source-ledger contracts without runtime behavior changes, slice 253 accepts terminal physical-key/product behavior plus cross-surface shell-only transfer for the source ledger, slices 255-257 add source-only runtime-parity evidence for Source, Kanban, and Manage, slice 258 adds Browser source-only runtime parity with CEF as the only accepted web-pane engine, slice 259 adds Source placeholder-replacement preflight evidence without runtime replacement permission, slice 260 adds the matching Kanban placeholder-replacement preflight evidence without runtime replacement permission, slice 261 adds matching Manage placeholder-replacement preflight evidence without runtime replacement permission, slice 262 adds the central CEF-only Source/Browser/Kanban/Manage pane-engine policy without runtime checking, slice 263 adds source-side Source/Kanban/Manage CEF ownership slots without runtime creation, slice 264 adds the source-side Source/Kanban/Manage runtime URL issuance boundary without issuing or retaining URL values, slice 265 adds Source-only startup navigation readiness without runtime navigation, slice 266 adds the Source-only runtime CEF surface owner/creation gate without creating a surface, slice 267 adds the Kanban-only runtime CEF surface owner/creation gate without creating a surface, and slice 268 adds the Manage-only runtime CEF/file-bridge owner/creation gate without creating a surface, file bridge, file operation, or payload. Under the latest requirement, source-only CEF parity is the current target and runtime checking is user-side, not an agent queue.
- Terminal host/native view/Ghostty pipelines for Agents and command surfaces have accepted source-ledger progress entries, including all-visible Agents mount slots, runtime-only startup metadata readiness/failure snapshots, readiness handoff plans, process-exited failure results, startup host/surface ownership transfer into Running maps, explicit restored-unmounted materialization through startup candidate/body-slot/launch-plan/completion-intent state without retry runtime-id rotation, source-side parked-owner wake/reattach that moves only an exact existing AppKit host view plus Ghostty surface owner for the same durable shell session and process-local runtime id into current body geometry without startup maps or duplicate running ownership, activation/restore startup eligibility guarding that blocks sleeping/popped-out `Mounting` placeholders and restored `mounting` shell state from the hidden new-startup path while preserving restored materialization and in-process failed retry eligibility, failed-startup retry attempt identity rotation before retry startup sync/intent, focus/resize, close/process-exit cleanup, request-close pending callback handling, exact pending identity tracking, cancel handling, family-scoped normal-layout close-confirm UI surfaces with generic copy and Keep Open cancel, GhosttyKit `needs_confirm_quit` ABI evidence, exact confirmed shell/session removal through existing model close paths, confirmed callback cleanup, Agents/command close-confirm isolation, command runtime isolation, explicit-string paste with no file-path clipboard synthesis, source-side surface-scoped app-thread runtime clipboard handoff for exact still-mounted owners, committed `key_char` forwarding, IME/preedit text-service delivery, layout-only/no-native-physical-key rejection, runtime-only privacy boundaries, and the slice 253 source-ledger product acceptance that leaves runtime physical-key forwarding unchanged.
- Source has source-only identity, strict readiness parser/store, sidebar-scoped bridge routing, accepted source-only loading/ready/load-failed lifecycle bridge states and placeholder copy evidence, a source-only CEF/code-server mount-request boundary with a fixed app-resource entrypoint plus non-spawning app-resource process launch plan, source-ledger URL-boundary evidence, a CEF-only source-ledger materialization contract, source-only runtime parity with CEF as the only accepted web-pane engine, a placeholder-replacement preflight gate that still denies replacement because no runtime process, issued runtime URL, CEF browser, normal-layout CEF surface, or explicit replacement permission exists, Source-only startup navigation readiness, and a Source-only runtime CEF surface owner/creation gate wired into render/refresh while blocked for runtime readiness, URL authority, issued URL, code-server availability, CEF surface creation, and replacement permission, privacy-boundary runtime JSON, and sleep/wake preservation evidence. Source has no current Phase 5 source-ledger gate after slice 266; runtime Source checks and any future Source CEF/code-server replacement work are user-side or future explicit CEF-only work for this pass.
- Kanban has source-only project/board identity, strict project-workarea readiness parser/store, sidebar-scoped bridge routing, missing/mounting/ready/load-failed lifecycle bridge states, a source-only CEF mount-request boundary with a fixed first-party CEF app-resource entrypoint label plus CEF-only source-ledger materialization contract, source-only runtime parity with CEF as the only accepted web-pane engine, a placeholder-replacement preflight gate that still denies replacement because no runtime URL, CEF browser, normal-layout CEF surface, hidden mount, private runtime data, or explicit replacement permission exists, a Kanban-only runtime CEF surface owner/creation gate wired into render/refresh while blocked for URL authority, issued URL, CEF surface creation, and replacement permission, privacy-boundary runtime JSON, placeholder copy, and sleep/wake preservation evidence. No current Kanban source-ledger gate remains after slice 267; runtime Kanban checks are user-side for this pass.
- Manage has source-only strict gating, project/workarea identity, readiness parser/store evidence, a CEF mount-request boundary keyed to exact ready Manage runtime identity with a fixed first-party CEF app-resource entrypoint label, source-ledger CEF materialization, source-only file-bridge mount, project-scoped file-operation proof contracts, source-only runtime parity with CEF as the only accepted web-pane engine, a placeholder-replacement preflight gate that still denies replacement because no issued runtime URL, CEF browser, normal-layout CEF surface, runtime file bridge, runtime file operation, CEF/file-bridge payload, hidden mount, private runtime data/logging/persistence, or explicit replacement permission exists, and a Manage-only runtime CEF/file-bridge owner/creation gate wired into render/refresh while blocked for URL authority, issued URL, CEF surface creation, runtime file-bridge mounting, runtime file-operation execution, and replacement permission, sidebar-scoped bridge routing, operation allowlist policy, operation request parser/store evidence, project routing, privacy-safe decision categories, accepted source-only lifecycle bridge state/copy evidence, and sleep/wake preservation. No current Manage source-ledger gate remains after slice 268; runtime Manage checks and any future Manage CEF/file-bridge replacement work are user-side or future explicit CEF-only work for this pass.
- Browser has accepted source-ledger profile/tab shell state, feedback injection boundaries, popup target/no-op/no-transfer policy, CEF-only hide-and-hold, sleep/wake, restored-placeholder no-materialization behavior, unsupported/no-op compatible import, sanitized persistence, strict active-project/readiness parser/store evidence, sidebar bridge routing, a Phase 1 identity contract that keeps `browserWorkareaId` rejected, and source-only runtime parity with existing tab-owned CEF visibility as the only accepted web-pane engine. Browser runtime-parity privacy JSON exposes only the accepted `cef` engine label plus generic unsupported-engine rejection, with no WKWebView/WebKit-specific capability fields. No Browser source-ledger gate remains after slice 258, but no extra CEF creation, URL issuance, import ingestion, popup content transfer, suspend/teardown, hidden surface, fallback probe, private logging/persistence, opener data serialization, non-CEF pane path, or restored-placeholder replacement was added.
- Source, Browser, Kanban, and Manage now share a central CEF-only project-workarea pane-engine policy for the source ledger. It counts all four panes for source-only runtime parity only when existing evidence exposes CEF as the web-pane engine, rejects WKWebView/WebKit/non-CEF/candidate labels without retaining rejected labels in safe JSON, exposes Browser privacy JSON as accepted `cef` plus generic unsupported-engine rejection only, and keeps runtime creation plus placeholder replacement booleans false pending user runtime checks.
- Source, Kanban, and Manage now also have app-owned CEF ownership-slot scaffolding for future normal-layout child surfaces. The slots are keyed only by safe surface kind, Browser stays excluded on its tab-owned CEF path, Phase 10 tracks the slot boundary separately from the pane-engine policy, and current source still issues no URL, creates no CefSurface or file bridge, runs no file I/O, mounts no hidden surface, stores no private runtime data, and replaces no placeholder.
- Source, Kanban, and Manage now also have a source-only runtime URL issuance boundary keyed only by the same safe slot kind. It requires ready runtime-parity, placeholder-preflight, and ownership-slot evidence; keeps Browser excluded; records absent real URL authority plus absent issued URL state; stores no URL value; and still cannot create CefSurface, code-server/file-bridge/file-I/O payloads, hidden/offscreen mounts, private runtime data/logging/persistence, or placeholder replacement.
- Source now also has a Source-only startup navigation readiness boundary derived only from the Source runtime URL issuance decision. It keeps Source/code-mode CEF-backed, excludes Browser/Kanban/Manage from the Source startup wait, defers first code-server navigation until a future runtime readiness gate succeeds and an issued runtime URL exists, and still cannot directly navigate Source, store or emit URL scheme/host payloads, start code-server, create CefSurface, mount hidden/offscreen views, persist/log private data, or replace the placeholder.
- Source now also has a Source-only runtime CEF surface owner/creation gate derived only from startup navigation readiness and used by the Source render/refresh path. It stays CEF-only and normal-layout-only, rejects non-Source inputs, stores no URL/project/path/payload/Entity<CefSurface>, and keeps the placeholder until runtime readiness success, real URL authority, issued runtime URL, code-server process availability, CEF surface creation, and explicit replacement permission all exist.
- Kanban now also has a Kanban-only runtime CEF surface owner/creation gate derived only from the Kanban runtime URL issuance decision and used by the Kanban render/refresh path. It stays CEF-only and normal-layout-only, rejects missing and non-Kanban decisions, stores no URL/project/path/payload/Entity<CefSurface>, and keeps the placeholder until real URL authority, issued runtime URL, CEF surface creation, and explicit replacement permission all exist.
- Manage now also has a Manage-only runtime CEF/file-bridge owner/creation gate derived only from the Manage runtime URL issuance decision and used by the Manage render/refresh path. It stays CEF-only and normal-layout-only, rejects missing and non-Manage decisions, stores no URL/project/path/file/payload/Entity<CefSurface>, and keeps the placeholder until real URL authority, issued runtime URL, CEF surface creation, runtime file-bridge mounting, runtime file-operation execution, and explicit replacement permission all exist.
- Cross-surface runtime transfer is accepted for the source ledger as shell-only movement across Agents terminal runtime, Command pane terminal runtime, Browser, Source, Kanban, and Manage. Current source evidence is limited to visible title/placeholder movement between Agents and command surfaces, tab/group/card shell movement, identity-only Source/Kanban/gated Manage movement, Browser profile/tab shell identity preservation, and an explicit no-runtime-transfer privacy boundary; it must not expand into live process, CEF, file-editor, command payload/status, terminal buffer, clipboard callback, focus/key identity, URL, path, page title, payload, log, persistence, hidden mount, fallback transfer, private runtime data, or user-owned content transfer unless future product work enables live transfer and adds the required runtime contracts.
- Phase 9 remains outside the current agent workflow. Formatting, tests, checks, typecheck, Rust checks, whitespace checks, app launch/restart, browser automation, visual automation, and equivalent validation/app commands are not run by agents in this continuation and must not be queued as later work.
- No source-ledger blockers remain after slice 268. Source, Kanban, Manage, and Browser runtime instantiation or runtime behavior checks remain later user/runtime checks, not current source-ledger blockers after slices 252, 253, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, and 268.
- Placeholder-only code paths should remain in place until the corresponding real runtime CEF/code-server, CEF, or CEF/file-bridge surface exists as applicable, owns a normal-layout child surface, has issued runtime URL/authority where that surface uses URL issuance, has explicit placeholder replacement permission, and has user/runtime proof; accepted source-ledger materialization, runtime-parity, preflight, URL-boundary, or owner-gate contracts alone do not authorize removal.
- Use the Phase 10 source-ledger guardrail evidence table in `docs/gpui-workspace-area-parity-requirements.md` as the guardrail. Accepted source-only CEF contracts are recorded there as accepted evidence rather than current blockers for this pass; source-only assumptions without contracts still do not clear a guardrail.
- Use the source-level guardrail ledger as the executable companion to that guardrail table. Terminal lifecycle/clipboard entries are accepted for the source-ledger purpose after slice 239, Browser source-ledger contracts are accepted after slice 252 with runtime caveats, terminal physical-key/product behavior plus cross-surface shell-only transfer are accepted after slice 253 with runtime caveats, Source/Kanban/Manage source-ledger materialization plus source-only runtime-parity evidence and Manage file-bridge/proof evidence are accepted after slices 255-257 with runtime caveats, Browser source-only runtime parity is accepted after slice 258 with CEF as the only web-pane engine, Source placeholder-replacement preflight evidence is accepted after slice 259 while replacement remains denied, Kanban placeholder-replacement preflight evidence is accepted after slice 260 while replacement remains denied, Manage placeholder-replacement preflight evidence is accepted after slice 261 while replacement remains denied, the central CEF-only Source/Browser/Kanban/Manage pane-engine policy is accepted after slice 262 while runtime checking remains deferred to the user, the Source/Kanban/Manage CEF ownership-slot scaffold is accepted after slice 263 while runtime creation remains deferred, the Source/Kanban/Manage runtime URL issuance boundary is accepted after slice 264 while URL issuance remains deferred, the Source startup navigation readiness boundary is accepted after slice 265 while runtime navigation remains deferred, the Source runtime CEF surface owner/creation gate is accepted after slice 266 while runtime CEF creation remains deferred, the Kanban runtime CEF surface owner/creation gate is accepted after slice 267 while runtime CEF creation remains deferred, and the Manage runtime CEF/file-bridge owner/creation gate is accepted after slice 268 while runtime CEF/file-bridge creation remains deferred. Validation remains outside this agent workflow.

Small slices:

- Remove obsolete placeholder-only code paths only after the corresponding future runtime prerequisites exist: the matching real runtime CEF/code-server, CEF, or CEF/file-bridge surface as applicable, a normal-layout child surface, issued runtime URL/authority where applicable, explicit placeholder replacement permission, and user/runtime proof. Source-ledger materialization contracts alone are not enough.
- Fix concrete mismatches between the source ledger, requirements table, missing-parity handoff, and progress log when found.
- Do not make generic source-only ledger splitting, pure test passes, migration passes, privacy audits, or final checklist wording the main queue under the current no-validation workflow.

Acceptance:

- Current Phase 10 acceptance for this source-ledger pass is that GPUI has accepted evidence and guardrails for terminal, command pane, Browser, Source, Kanban, Manage, layout, focus, sleep/wake, and persistence; source-only CEF parity is accepted for Browser, Source, Kanban, and Manage, and runtime checks remain user-side.
- Remaining source-ledger differences must stay explicit product decisions or runtime/user-side caveats, not accidental gaps; future real runtime web-pane work must be explicit, CEF-only, privacy-safe, normal-layout-only, and avoid fallback paths, WKWebView/WebKit/non-CEF paths, private payloads/logging/persistence, hidden or overlapping interactive surfaces, and accidental placeholder replacement.

## Suggested Orchestrator Order

1. Stop source-ledger splitting unless a concrete mismatch appears between source, requirements, handoff, and progress.
2. Let the user runtime-check Source, Browser, Kanban, and Manage behavior. Terminal is already accepted as working for this source-ledger pass. Do not run formatting, tests, checks, typecheck, Rust checks, whitespace checks, app launch/restart, browser automation, visual automation, or equivalent validation/app commands.
3. If future product work explicitly requests real runtime surfaces, implement only CEF-backed Source, Browser, Kanban, and Manage pane paths; do not introduce WKWebView, WebKit, non-CEF engines, fallback URL probes, hidden surfaces, or private runtime payloads.
4. Preserve the slice 253 terminal physical-key product decision unless future runtime work adds a real native keycode/UIEvents-code identity. Do not synthesize physical keys from layout-only data.
5. Preserve the slice 253 cross-surface shell-only transfer decision unless future product work explicitly enables live transfer and adds per-source/target runtime contracts, family-specific terminal/Browser/Source/Kanban/Manage transfer contracts, and runtime transfer privacy proof.

Use this order as a queue, not a parallel work pool. The orchestrator should hand off exactly one worker at a time, wait for that worker's progress entry, then choose the next bounded bundle. Do not spawn parallel subagents for Phase 1 or for read-only planning.

Within that sequential queue, future worker slices should be larger bounded bundles when dependencies allow. A bundle can combine adjacent work inside one real contract boundary, or status reconciliation for a concrete mismatch, if it does not skip phase order or blur contracts. Every bundle must preserve the privacy rules, no fallback/project-detection rule, non-overlap layout/input rule, and current validation ban.

Do not treat this order as permission to reopen runtime implementation. More source-only ledger splitting should not be presented as the main queue unless a concrete mismatch appears; no source-ledger blockers remain after slice 268 plus the 2026-06-24 source-only runtime-parity requirement update. Phase 9 validation remains outside this agent workflow under the current persistent no-validation instruction.
