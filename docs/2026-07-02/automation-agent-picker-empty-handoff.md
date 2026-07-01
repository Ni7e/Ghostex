# Automation Agent Picker Empty Handoff

Date: 2026-07-02

## Current Status

The issue is still not fixed. The Agent picker in the automation creation dialog still shows `No agents configured` even though Ghostex has agents configured in the app.

The user reports this happens in both automation surfaces:

- Quick/global Automations Overview
- Project-specific Automate page

Earlier screenshots showed the Create automation dialog with:

- Project value stuck on `quick-automations`
- Agent value `No agents configured`
- Execution mode forced to Local because no valid target project/agent state was loaded

## Expected Behavior

The automation dialog should use the agents configured in the Ghostex app, not an empty automation-local list.

Expected picker behavior:

- List configured app agents, excluding only agents intentionally not launchable for automation.
- Select the Default Prompt Agent when it is present in the launchable options.
- Otherwise select the first configured launchable app agent.
- In Overview, the Project picker should target a real user code project, not the Quick/system `quick-automations` overview project.

## Important Files

Primary frontend surface:

- `native/sidebar/tasks-placeholder.tsx`
  - `loadAutomationState`
  - `applyAutomationState`
  - `openNewAutomationDialog`
  - `resolveAutomationDraftProjectId`
  - Agent `SelectValue` placeholder: `No agents configured`

Primary native bridge:

- `native/sidebar/native-sidebar.tsx`
  - `createProjectAutomationAgentOptions`
  - `createProjectAutomationsBridgeState`
  - `createAllProjectGxserverAutomationsBridgeState`
  - `handleGxserverProjectAutomationRequest`
  - `postProjectAutomationsResponse`

Gxserver automation endpoint:

- `gxserver-rs/src/automations/mod.rs`
  - `/api/readAutomationState`
  - `read_project_automation_state`
  - `hud_agents_to_automation_agents`

Shared log summarizer:

- `shared/automations-debug.ts`
- `shared/automations-debug.test.ts`

## Work Already Attempted

1. The first suspicion was stale app resources.
   - Source already contained a fix around `2026-06-30-21:28`.
   - The running Debug app bundle was older than source.
   - User rebuilt the app, but the issue persisted.

2. Overview bridge hardening was added in `native/sidebar/native-sidebar.tsx`.
   - `createAllProjectGxserverAutomationsBridgeState` now seeds `nativeAgents` from `createProjectAutomationAgentOptions(activeProject())` plus all native automation target projects.
   - Per-project automation reads use `Promise.allSettled` so one failed project read should not empty the whole Overview payload.
   - Target project option worktree checks degrade per project instead of rejecting the full target list.

3. Frontend draft target handling was hardened in `native/sidebar/tasks-placeholder.tsx`.
   - `resolveAutomationDraftProjectId` keeps a current draft project only if it exists in the loaded automation target list.
   - This should prevent `quick-automations` from being saved or displayed as the selected project after bridge hydration.

4. Sanitized diagnostics were added.
   - Frontend events:
     - `projectAutomations.load.skipped`
     - `projectAutomations.load.requested`
     - `projectAutomations.load.response`
     - `projectAutomations.load.failed`
     - `projectAutomations.state.applied`
     - `projectAutomations.dialog.open`
     - `projectAutomations.agentPicker.empty`
   - Native events:
     - `projectAutomations.bridgeState.overview.targets`
     - `projectAutomations.bridgeState.overview.reads`
     - `projectAutomations.bridgeState.overview.result`
     - `projectAutomations.bridgeState.gxserverProject.result`
     - `projectAutomations.bridgeState.nativeProject.result`

5. Validation that was run after the diagnostic work:
   - `bun run typecheck`
   - `bunx vitest run shared/automations-debug.test.ts --config vitest.config.ts`
   - `git diff --check`

## Logging Notes

The new diagnostics are intended to be support-bundle safe. They should log only counts, booleans, fixed phases/surface names, and sanitized error metadata.

They should not log:

- Project names
- Project paths
- Agent names or labels
- Agent commands
- Prompts
- URLs
- Raw error messages
- Tokens or secrets

The diagnostic scenario gate is `native.project.board`.

To inspect the new breadcrumbs after reproducing, search the Ghostex log directory:

```bash
rg -n "projectAutomations\\." ~/.ghostex/logs
```

Also verify the running bundle actually contains the new event strings:

```bash
rg -n "projectAutomations\\.(agentPicker|bridgeState|load)" native/macos/ghostexHost/Web build/arm64/Build/Products/Release/Ghostex.app/Contents/Resources/Web -g '!*.map'
```

## High-Probability Root Causes

### 1. Project Automate page may bypass native app agents

For `automationGetState`, `handleGxserverProjectAutomationRequest` calls gxserver `/api/readAutomationState` and posts `response.automationState` as-is.

That response gets its agents from `gxserver-rs/src/automations/mod.rs` via `read_sidebar_hud` and `hud_agents_to_automation_agents`.

If the gxserver HUD response has `agents: []`, the project Automate page will stay empty even if the native app has populated `agents`.

Likely fix path:

- Merge native `createProjectAutomationAgentOptions(project)` into gxserver automation state before posting it back to the webview.
- Apply this to `automationGetState` and probably mutation responses too, not only Overview.
- Alternatively, fix gxserver `read_sidebar_hud` or `hud_agents_to_automation_agents` so `/api/readAutomationState` always returns the app-visible default/custom agents.

### 2. Overview may still receive `nativeAgents.length === 0`

If Overview still logs empty after the attempted hardening, check `projectAutomations.bridgeState.overview.targets`.

Important fields:

- `nativeAgentCount`
- `nativeTargetProjectCount`
- `targetProjectCount`
- `gxserverProjectCount`

If `nativeAgentCount` is `0`, inspect why the native `agents` array is empty at bridge time. `createProjectAutomationAgentOptions` filters to:

- `agent.agentId !== "t3"`
- `Boolean(agent.command?.trim())`

So possible causes are:

- Native `agents` was not hydrated yet.
- All visible app agents are commandless.
- A recent gxserver/sidebar HUD ownership change has hidden or removed default agents unexpectedly.

### 3. Experimental feature gate may be blocking load

Current frontend code has:

```ts
if (!experimentalFeaturesEnabled) {
  logAutomationPickerDebug("projectAutomations.load.skipped", ...);
  return;
}
```

If logs show `projectAutomations.load.skipped` with `experimentalFeaturesEnabled: false`, the picker is empty because automation state loading is intentionally skipped.

In that case, decide whether:

- The surface should be hidden behind a coming-soon overlay when experimental features are disabled, or
- The picker state should still load even when experimental features are disabled.

### 4. Bridge response may not reach the correct WKWebView

If native logs show non-empty bridge result counts but frontend logs never show `projectAutomations.load.response`, inspect response routing.

Relevant function:

- `postProjectAutomationsResponse` in `native/sidebar/native-sidebar.tsx`

It routes replies using:

```ts
projectId: request.projectEditorId ?? request.projectId
```

If `projectEditorId` is missing or wrong for one surface, the page may time out and keep initial empty state.

### 5. UI select may be rendering empty despite non-empty state

If frontend logs show `agentCount > 0` in `projectAutomations.load.response` and `projectAutomations.state.applied`, but the picker still displays `No agents configured`, then the bug is probably in the Select wiring.

Check:

- `automationAgentSelectItems`
- `createSidebarAgentSelectItems`
- `automationDraft.agentId`
- The `Select` `items`, `value`, `SelectContent`, and `SelectItem` relationship

The empty visible placeholder currently depends directly on:

```tsx
automationState.agents.length === 0 ? "No agents configured" : "Choose agent"
```

So if the UI still shows `No agents configured`, either `automationState.agents.length` is truly `0` in React, or the screenshot is from stale built resources.

## Recommended Next Debugging Sequence

1. Confirm the running app bundle contains the new diagnostics.
   - Search for `projectAutomations.agentPicker.empty` and `projectAutomations.bridgeState.overview.result` in the actual app resources being launched.

2. Enable the `native.project.board` diagnostic scenario.

3. Reproduce the empty picker in Overview and Automate.

4. Search logs:

```bash
rg -n "projectAutomations\\." ~/.ghostex/logs
```

5. Interpret the first failure point:

- `load.skipped`: feature flag/gating problem.
- `load.requested` with no `load.response`: bridge timeout/routing problem.
- Native bridge result has `agentCount: 0`: source-of-truth agent population problem.
- Native bridge result has `agentCount > 0`, frontend response has `agentCount: 0`: serialization or wrong response problem.
- Frontend response/apply has `agentCount > 0`, but UI shows empty: Select/UI state bug.

6. If Automate logs `projectAutomations.bridgeState.gxserverProject.result` with `agentCount: 0`, patch native to merge app agents into every gxserver automation response before `postProjectAutomationsResponse`.

## Likely Fix Direction

The strongest candidate is to stop trusting gxserver automation responses as the final source for the picker agent list.

The user requirement is explicit: use agents configured in the app.

Implement a native helper similar to:

```ts
function mergeNativeAutomationAgents(
  project: NativeProject,
  state: ProjectAutomationsBridgeState,
): ProjectAutomationsBridgeState {
  const nativeAgents = createProjectAutomationAgentOptions(project);
  return {
    ...state,
    agents: nativeAgents.length > 0 ? nativeAgents : state.agents,
    defaultAgentId: state.defaultAgentId ?? resolveDefaultPromptAgentId(),
  };
}
```

Apply it before posting responses for:

- `automationGetState`
- `automationSave`
- `automationDelete`
- `automationRunNow`
- `automationSetEnabled`
- `automationArchiveRun`
- `automationMarkRunRead`

Overview already has partial native merging, but should still be checked with the new logs.

## Cautions

- Do not add raw logging. Existing diagnostics must remain sanitized.
- Do not log project names, paths, agent labels, commands, prompts, URLs, raw errors, or environment values.
- Do not add macOS app tests or gpui tests unless the project guidance changes.
- Do not run `bun run start` unless the user explicitly asks.
- The current worktree has unrelated changes from other work. Keep fixes surgical and avoid broad restores or cleanup.

## Failed Attempts So Far

As of 2026-07-02, every attempted fix below has failed to resolve the live issue. The user still sees `No agents configured` in the automation Agent dropdown. Do not treat any of these as a confirmed fix.

### 1. Stale running bundle hypothesis

Initial observation:

- The screenshot filename from 2026-06-30 showed the issue shortly before a source-level fix timestamp.
- The source already contained logic around `createProjectAutomationAgentOptions` intended to use app-owned configured agents.
- The Debug app bundle under `native/macos/ghostexHost/DerivedData/.../Resources/Web/native-sidebar.js` was older than the source and still had older all-project aggregation code.

What was suggested:

- Rebuild/refresh the app so the running Web resources pick up the newer source.

Why it failed:

- The user rebuilt the app and reproduced the same empty Agent picker.
- This means stale Web resources were not the only cause.
- Any next agent should still verify the launched bundle contains current strings, but should not stop at "rebuild the app" as the solution.

### 2. Overview state seeding from native app agents

Attempted change:

- In `native/sidebar/native-sidebar.tsx`, the Overview all-project bridge path was changed to seed `nativeAgents` from:
  - `createProjectAutomationAgentOptions(activeProject())`
  - every `nativeTargetProjects.flatMap(createProjectAutomationAgentOptions)`
- The returned Overview state then preferred `nativeAgents` before gxserver-returned aggregated agents.

Targeted path:

- `createAllProjectGxserverAutomationsBridgeState`
- `createProjectAutomationAgentOptions`

Reasoning:

- The Overview page should not depend only on `/api/readAutomationState` returning agents for each project.
- The app already has configured agents in native sidebar state, so the bridge should pass those to the automation page.

Why it failed:

- The issue is still visible after this work.
- Possible explanations:
  - `nativeAgents` is still empty when the Overview request runs.
  - The running app is not executing this code path.
  - A later payload or frontend state update overwrites non-empty agents with an empty list.
  - The visible problem is primarily the project Automate path, which still receives gxserver automation state as-is.
  - The active project at the moment may be the Quick Automations system surface, and app agent hydration may not have completed or may have been replaced by gxserver HUD state.

How to confirm:

- Inspect `projectAutomations.bridgeState.overview.targets`.
- If `nativeAgentCount` is `0`, this attempted fix failed before response construction.
- If `nativeAgentCount > 0` but `projectAutomations.load.response` has `agentCount: 0`, the response is being lost, replaced, or routed incorrectly.

### 3. Per-project automation reads changed from `Promise.all` to `Promise.allSettled`

Attempted change:

- In `createAllProjectGxserverAutomationsBridgeState`, per-project `/api/readAutomationState` calls were changed from `Promise.all(...)` to `Promise.allSettled(...)`.
- Rejected project reads are now counted in diagnostics instead of rejecting the entire Overview automation state.

Reasoning:

- One bad project read or gxserver automation endpoint failure should not leave the Overview dialog stuck with initial empty state.
- The page should still receive native app agents and whatever automation/run data can be read.

Why it failed:

- The issue still reproduces.
- This means either:
  - Per-project read rejection was not the actual cause.
  - The frontend never receives the response.
  - The response is received but still contains `agents: []`.
  - The empty dropdown is caused by the project Automate path, which is not fixed by Overview aggregation changes.

How to confirm:

- Check `projectAutomations.bridgeState.overview.reads`.
- If `rejectedCount` is `0`, this was not the relevant failure.
- If `fulfilledCount > 0` and `agentCount` remains `0`, look at agent source-of-truth/hydration rather than RPC rejection.

### 4. Worktree/project target option failures made non-fatal

Attempted change:

- `createProjectAutomationTargetOptions` now calls `createProjectAutomationTargetOption`.
- If `resolveProjectAutomationWorktreeAvailability` throws for one project, that project still appears as an automation target with `canUseWorktrees: false`.

Reasoning:

- A Git/worktree probe failure should not make the whole Project picker empty.
- Overview Create automation should still show projects and let users choose Local mode.

Why it failed:

- The user’s reported failure is the Agent picker being empty.
- Making target project construction non-fatal may prevent one class of state-load failure, but it does not guarantee agents are populated.
- If the frontend state is never updated, or if gxserver returns no agents, the Agent dropdown still shows `No agents configured`.

How to confirm:

- Check `projectOptionCount` and `projectsWithWorktreeUnavailableReasonCount` in `projectAutomations.bridgeState.overview.result` and `projectAutomations.load.response`.
- If project counts are non-zero but `agentCount` is zero, project target construction is no longer the blocking issue.

### 5. Frontend draft project resolver to avoid `quick-automations`

Attempted change:

- Added/used `resolveAutomationDraftProjectId` in `native/sidebar/tasks-placeholder.tsx`.
- New automation drafts in global Overview should only keep an existing draft project id if it exists in `automationState.projects`.
- Otherwise they select the first loaded real automation target project.

Reasoning:

- The screenshot showed the Project select stuck on `quick-automations`.
- `quick-automations` is a Quick/system overview page, not a real automation target.
- If the dialog opens before bridge hydration, it should not preserve the Quick overview id as the target.

Why it failed:

- This only fixes the project id selection after a valid `automationState.projects` list exists.
- If automation state loading is skipped, fails, times out, routes to the wrong WKWebView, or returns empty `projects`, the resolver has no real target to select.
- It also does not populate `automationState.agents`; it only prevents an invalid project id from sticking.

How to confirm:

- Check `projectAutomations.dialog.open` and `projectAutomations.state.applied`.
- If `draftProjectKnown` is false and `projectOptionCount` is zero, this resolver cannot help.
- If `draftProjectKnown` is true but `agentCount` is zero, the remaining bug is agent population.

### 6. Frontend request/response diagnostics

Attempted change:

- Added sanitized frontend diagnostics in `native/sidebar/tasks-placeholder.tsx`:
  - `projectAutomations.load.skipped`
  - `projectAutomations.load.requested`
  - `projectAutomations.load.response`
  - `projectAutomations.load.failed`
  - `projectAutomations.state.applied`
  - `projectAutomations.dialog.open`
  - `projectAutomations.agentPicker.empty`

Reasoning:

- The previous fixes were blind; they did not prove whether the webview loaded state, received empty state, or failed to receive any bridge response.
- These logs should identify the first empty state boundary.

Why it failed as a fix:

- This was diagnostic-only and does not change the picker data source.
- It should help the next agent find the cause, but it intentionally does not force the dropdown to show agents.

How to use it:

- Enable `native.project.board`.
- Reproduce both surfaces.
- Search:

```bash
rg -n "projectAutomations\\." ~/.ghostex/logs
```

### 7. Native bridge diagnostics

Attempted change:

- Added sanitized native bridge diagnostics in `native/sidebar/native-sidebar.tsx`:
  - `projectAutomations.bridgeState.overview.targets`
  - `projectAutomations.bridgeState.overview.reads`
  - `projectAutomations.bridgeState.overview.result`
  - `projectAutomations.bridgeState.gxserverProject.result`
  - `projectAutomations.bridgeState.nativeProject.result`

Reasoning:

- The native bridge can now report whether it constructed a non-empty agent list before posting a response.
- This separates native state construction bugs from frontend rendering bugs.

Why it failed as a fix:

- This is also diagnostic-only.
- It does not merge native app agents into every gxserver automation response.
- In particular, `automationGetState` can still post gxserver `response.automationState` as-is unless the next fix explicitly merges or repairs it.

Most important event for the next agent:

- `projectAutomations.bridgeState.gxserverProject.result`

If this event has `agentCount: 0` on the Automate page, the likely fix is to merge native `createProjectAutomationAgentOptions(project)` into gxserver project automation responses before `postProjectAutomationsResponse`.

### 8. Shared sanitized log summarizer and tests

Attempted change:

- Added `shared/automations-debug.ts`.
- Added `shared/automations-debug.test.ts`.
- Tests assert that diagnostics do not serialize project names, paths, agent labels, commands, prompts, URLs, secret-looking tokens, or raw error messages.

Reasoning:

- The repo logging rules require persistent logs to be support-bundle safe.
- Since this bug needs logs, a shared summarizer reduces the chance of leaking private user data.

Why it failed as a fix:

- The summarizer only controls log payload shape.
- It does not alter agent state, bridge response routing, or Select rendering.

Validation that passed:

- `bun run typecheck`
- `bunx vitest run shared/automations-debug.test.ts --config vitest.config.ts`
- `git diff --check`

### 9. What was not successfully fixed

No attempted change has yet proven that:

- `automationState.agents.length > 0` in the Overview React page after load.
- `automationState.agents.length > 0` in the project Automate React page after load.
- gxserver `/api/readAutomationState` returns app-configured agents for the selected project.
- Native merges app-configured agents into every gxserver automation response.
- The Select component renders non-empty items after `automationState.agents` is populated.

The next agent should assume the core issue remains open and should use the new diagnostics to identify the first boundary where the agent list becomes empty.
