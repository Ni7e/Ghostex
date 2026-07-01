# Report: Groups 11 (Kanban/automations) + 12 (Notifications/ambient) (agent ab31628bdcf53a0e0)

## Scope note
GPUI reuses tasks-placeholder.tsx (kanban+automations) + manage.tsx in CEF, but macOS board conversation/automation logic lives in native-sidebar.tsx which GPUI does NOT load. GPUI routes board/beads bridge calls to Rust (project_board_bridge_response_for_request_payload, main.rs:62824). That fact drives most G11 gaps.

## F1 Beads kanban board — PARTIAL (high)
- macOS: project-board-shared.ts BOARD_COLUMNS (backlog/todo/in_progress/test/review/done), BeadsBridgeAction union; tasks-placeholder.tsx posts via ghostexProjectBeads (198, ~5795) + ghostexProjectBoard (201, ~400/5834); TWV ProjectBeadsBridge/ProjectBoardBridge (~21173).
- GPUI: kanban-main.tsx installs CEF bridge + imports same board page; project-workarea-cef-bridge.ts shims ghostexProjectBeads/Board/BoardImages/ManageFiles; main.rs:62853 run_project_beads_bridge_request_for_context → gxserver /api/runBeadsAction; :62947 action mapping.
- GAPS: (1) generateTitle explicitly REJECTED in GPUI (62947) — bead title auto-generation dead. Route through gxserver prompt-agent like macOS. (2) verify drag-between-lanes end-to-end (updateStatus maps; confirm CEF shim responses live incl. image bridge).

## F2 Manage surface — WORKING/PARTIAL (med)
- Bridge present + routed (manage-main.tsx; receive_project_workarea_bridge_event main.rs:26673). Verification item: confirm postManageFilesRequest returns real data (response path not fully traced). (G9/10 report has detail: only list/read/save supported.)

## F3 Bead↔conversation links — MISSING (high)
- macOS: bead-conversation-links.ts (BeadConversationLink; ProjectBoardBridgeAction incl. startWork, associateFocusedSession, jumpToConversation, unlinkConversation, getState); native-sidebar.tsx handleProjectBoardRequest (41582), startWork (41702/42203); buildAgentWorkPrompt (gx bd comment / gx bd update --status).
- GPUI: main.rs:62824 handles ONLY getState + projectEditorFocusOwnerChanged; everything else → "Project board conversation action is not handled by this GPUI runtime surface." :62795 builds EMPTY runtime context (agents/links/sessions).
- Work: (1) implement startWork (launch/attach agent session currentProject or newWorktree, seed buildAgentWorkPrompt, create link); (2) link lifecycle (associate/jump/unlink) + durable Ghostex-owned link storage; (3) populate runtime context so getState live.

## F4 Orchestrator board integration — N/A (high)
- No orchestrator/subagent board UI on macOS. "Agent Orchestration" = CLI skill install (native-sidebar.tsx:7086, 7449, 22144), shipped via gxserver agent-skills — available to GPUI already. Product clarification only.

## F5 Automations — MISSING client wiring (high)
- Shared model: shared/automations.ts (AutomationSchedule interval/daily/weekly/cron, ExecutionMode local/worktree/thread, computeNextRunAt). Engine real: gxserver-rs/src/automations/mod.rs (AutomationRuntime :29, handle_automation_endpoint :179); routes /api/readAutomationState, saveAutomation, deleteAutomation, runAutomationNow, setAutomationEnabled, archiveAutomationRun, markAutomationRunRead (server.rs:1120-27, 1459).
- UI present in reused tasks-placeholder.tsx (ProjectSurfaceTab triage/automations/runs/board; ?surface=automations), gated behind Enable Experimental Features/showBetaFeatures (230-245). Automation actions are ProjectBoardBridgeActions via ghostexProjectBoard (201/400).
- macOS handlers in native-sidebar.tsx (automationSave/RunNow 34258, 40697+, 40929+; parse 41058) — NOT loaded by GPUI.
- GPUI: NO automation* action handled at main.rs:62824 → entire Automations surface non-functional.
- Work: (1) implement all automation* board-bridge actions forwarding to gxserver endpoints (pure client wiring); (2) automationGetState/GetAllState live so Overview renders; (3) wire automationOpenRunSession/OpenWorktree to navigation; (4) confirm showBetaFeatures reachable in GPUI settings.

## F6 Delayed send (session-level) — VERIFY (med)
- macOS TWV has modal + countdown. GPUI not positively confirmed in this pass (G2 report found full command-pane delayed-send system incl. modal/countdown/persistence main.rs:25295-25608 but Agents-terminal hotkey → RuntimeNoOp). Follow-up: session-grid delayed send parity for Agents sessions.

## F7 Completion sounds — PARTIAL (high)
- Clarification: per-EVENT sounds: actionCompletionSound (default "shamisen", ghostex-settings.ts:1139) for action/command; completionSound (default "arcade", :1272) + completionBellEnabled (:1271) for agent-turn. completion-sound.ts 34 options.
- Action-completion WORKING: main.rs:20902 should_play_completion_sound → gpui_play_completion_sound (54649) → afplay (55135).
- Agent-turn MISSING: macOS plays via native-sidebar.tsx playNativeSound(settings.completionSound) 8916/9180. Shared path: type:"playCompletionSound" defined once (session-grid-contract-sidebar.ts:705), handled by sidebar-app.tsx:1381/1410, NO producer anywhere — GPUI runtime + gxserver never emit. Agent-turn sound never fires in GPUI. (Matches G7/8 F4 finding.)
- Work: emit playCompletionSound from GPUI runtime on attention/agent-turn (or Rust-side trigger with completionSound); ensure correct per-event sound selection.

## F8 Terminal bell → attention notification — PARTIAL/VERIFY (med)
- macOS: TWV:4253 surfaceView.$bell → sendEvent(.terminalBell(sessionId:)) → native-sidebar.tsx.
- GPUI: attention notification delivery exists (27498+, 54708 → GhostexGpuiDeliverSessionAttentionNotification in GpuiSettingsNotifications.m; enabled flag 54699 showMacOSAttentionNotifications default true; click 375). NOT confirmed: libghostty bell event feeds pipeline (GPUI is status-transition-driven; also G2 found RING_BELL unhandled in action callback → bell likely never surfaces). Trace bell → attention.

## F9 Menu-bar status item — WORKING (high)
- macOS SessionStatusIndicatorController.swift (NSStatusItem + Running Agents panel, count priority, click callbacks, Restart/Quit footer; floating desktop badge removed).
- GPUI GpuiMenuBarStatusItem.m (55KB) mirrors: panel, project/session click externs, Restart/Quit (905-919), hover scrollbar, hide (1345), applied via main.rs:54747. Optional: diff count-priority ordering.

## F10 Phone notifications — N/A / not found (med)
- No macOS→phone push mechanism found in scope (local UserNotifications only). iOS/** excluded from search — receiver could exist there. Confirm with product; likely no GPUI gap.

## F11 Desktop pets — PARTIAL (high)
- Key divergence: macOS pet = free-floating desktop NSPanel (borderless, non-activating, .floating, canJoinAllSpaces/.stationary, pet-host.html WKWebView; draggable, persisted origin + edge anchoring ghostex.petOverlayOrigin; context menu Sleep Pet/Go to Ghostex; activity bubbles + aggregate badge + visibility toggle) — PetOverlayController.swift. shared/pets.ts 9 options (boo default).
- GPUI pet = IN-WINDOW bottom-right (main.rs:472-82 spritesheet 8x9; 44213 right inset; 44243/44385 render; 44400 image; 48005 frames idle/review=attention/running=working/jumping=hover; reduce-motion honored; actions Sleep/GoTo 954-55).
- Work: (1) free-floating cross-space desktop pet window; (2) draggable + persisted origin/edge anchoring; (3) activity bubbles + status badge + visibility toggle; (4) confirm 9 pets + state mapping.

## F12 App Shots — WORKING (high)
- = double-tap-modifier hotkey screenshot capture. GpuiAppShots.m full impl (BothCommand/DoubleLeftShift/DoubleLeftOption/BothShift/BothOption, cooldown 0.9s, externs); main.rs:292+. Optional: diff hotkey set/cooldown vs macOS.

## Naming corrections
- GpuiSessionAttentionNotification*.m does not exist — functionality in GpuiSettingsNotifications.m.
- Completion sounds are per-event, not per-agent.

## Severity summary
1. F5 Automations — entire surface non-functional (pure client wiring).
2. F3 startWork/bead links — core "work a ticket" flow stubbed.
3. F7 agent-turn completion sound — no producer.
4. F11 pet — missing desktop overlay window.
5. F1 generateTitle rejected.
6. F8 bell→attention verify.
7. F2 Manage, F6 delayed send — verify.
8. F9, F12 — working. F4, F10 — likely N/A.
