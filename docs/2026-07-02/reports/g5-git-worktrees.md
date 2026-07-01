# Report: Group 5 — Git & worktrees (agent a5fc40b44bbf5824d)

## Architecture finding
Both apps mount same shared SidebarApp. GPUI git BUSINESS LOGIC surprisingly complete: gxserver-runtime.ts reimplements runSidebarGitAction, commit/PR review, worktree create/open, merge-to-main, diff/state reads (cases 2279-2438). Server-side typed ops shared via gxserver-rs. Gaps = missing ENTRY POINTS + modal/toast plumbing, not logic:
- GPUI titlebar is native Rust, not React titlebar-host.tsx; git control not wired.
- GpuiAppModalKind (main.rs:1309-1352) omits gitCommit/gitFileDiff/worktree/deleteWorktree → openAppModal silently no-ops (from_modal_id None → early return 21822-29).
- App toasts from sidebar dropped: "toast" => {} (main.rs:21925).

## 1. Titlebar git menu — MISSING (high)
- macOS: split git button + dropdown; buildSidebarGitMenuItems (shared/sidebar-git.ts:124-139): Commit, Push, Create PR/View PR, Sync with Main (worktree-only), Multicommit & Release, Release. Primary label resolveSidebarGitPrimaryActionState (160-190). Rendered titlebar-host.tsx:2977-3518 (runGitAction → postNative runSidebarGitActionFromTitlebar), menu :5190.
- GPUI: "git" icon button rendered (main.rs:43197-203) but NO handler for id=="git" (match arms 43366-438 cover settings/keep-awake/resources/open-project/actions only). "git" TitlebarDropdownPanelKind exists in shared code (titlebar-host.tsx:131) but GPUI wires only tips panel (19489-90, 21440-95). Dead placeholder.
- Work: click handler computing SidebarGitState + open git menu (native menu from buildSidebarGitMenuItems OR CEF titlebar-host.html?ghostexTitlebarPanel=git popover mirroring tips 21474-95); split primary action labels; gate via getSidebarGitDisabledReason; route selections into runtime runSidebarGitAction; drive state from #2 refresh.

## 2. Quick git state — MISSING/PARTIAL (med)
- macOS: refreshGitState() in native-sidebar.tsx computes branch/dirty/ahead-behind/PR/diff per project (quick-git-state-source.test.ts), feeds titlebar + header.
- GPUI: runtime CAN compute — readSidebarGitState (gxserver-runtime.ts:4014-90: branch, statusPorcelain, diffNumstat, upstreamCounts, prView), handles refreshGitState (:2391). BUT nothing in shared SidebarApp posts refreshGitState — trigger is macOS-native. Never refreshed in GPUI; consumer (titlebar menu) dead. Branch metadata on worktree rows from gxserver domain still appears.
- Work: periodic/on-focus refreshGitState driver for visible non-Quick projects (mirror getVisibleProjectDiffStatsRefreshTargets); decide where indicators surface in GPUI.

## 3. Git commit modal — PARTIAL (med-high)
- Shared: GitCommitModal inline in SidebarApp (sidebar-app.tsx:76, :4593), opened by promptGitCommit (1457-69 → gitCommitDraft). Staging ChangedFilesTree (git-commit-modal.tsx:34,449).
- GPUI runtime full flow: promptSidebarGitActionReview posts promptGitCommit (4442); confirmSidebarGitCommit (2406/4495), cancel (2409), runSidebarGitMultipleCommits (2413/5148), blank-message generation, staging by trusted paths.
- GAP = reachability: only trigger is worktree "Create PR" header button (session-group-section.tsx:2026-44 → action:"pr"). Main projects: NO commit entry (header shows only Add Worktree 2045-63; palette only Clone Repository command-palette.tsx:529-33; titlebar dead). Toasts dropped.
- Work: commit/push/PR entry for main projects (titlebar menu, header/context, palette); fix toasts.

## 4. Git file-diff viewer — PARTIAL (med)
- Diff-within-commit WORKS: openSidebarGitChangedFileDiff (2426/5224) → sidebarGitFileDiff (5445) → gitFileDiffDraft (sidebar-app.tsx:1462-69) → commit modal fileDiffDraft (4607).
- Standalone GitFileDiffModal MISSING: macOS registers in modal-host.tsx:33 (rendered :2830). GPUI omits gitFileDiff from GpuiAppModalKind; macOS trigger (titlebar changed-files) dead anyway.
- Work: if standalone diff desired, add modal kind + trigger (git menu changed-files list).

## 5. PR review — PARTIAL (med; macOS uncertainty)
- macOS: Create PR opens GitCommitModal review mode (design note session-group-section.tsx:1977-81); View PR opens browser. No separate PR-diff surface found (mild uncertainty).
- GPUI: same inline modal; runtime implements PR path: open-existing-in-browser (4446-53 postNativeProjectPathAction), PR agent workflow (4465), /api/createPullRequest (main.rs:51721), Rust PR-URL helpers (65438).
- Gap: worktree-only reachability; toasts; verify openExistingPullRequestInBrowser handled by Rust NativeProjectPathAction bridge git subtype.

## 6. Sync-with-main + toasts — PARTIAL/broken feedback (med-high)
- Runtime implements: syncMain agent prompt workflow (4412-24 buildGpuiGitSyncWithMainPrompt); syncRemote direct mutation with progress toasts (4432).
- GAPS: (1) no UI trigger (titlebar menu dead, no sidebar trigger) → unreachable. (2) ALL git toasts dropped: postGitToast/postRemoteToast/postWorktreeToast send type:"toast" via postAppModalHostMessage (6305-21); GPUI router "toast" => {} (main.rs:21925). Rust dispatch_gpui_app_modal_toast (24204) only into OPEN modal window. All git/worktree/sync/clone feedback invisible.
- Work: render inbound toast (real GPUI toast surface); add sync trigger.

## 7. Worktree create — MISSING modal, backend WORKS (high)
- Backend wired: modal posts createProjectWorktree/requestProjectWorktrees (modal-host.tsx ~2895-2918); runtime handles (2279, 2288) with createNewProjectWorktree/openExisting (3655, 3812, /api/runWorktreeAction, setup command, registration).
- Modal cannot open: Add Worktree → openAppModal({modal:"worktree"}) (session-group-section.tsx:1373-85, 2046-52); from_modal_id unknown → early return (21822-29). SidebarApp doesn't render WorktreeCreateModal inline.
- Work: add Worktree to GpuiAppModalKind (+from_modal_id/modal_id/title/size), forward payload (projectId/Name/Path, remoteMachine*). modal-host.tsx already renders it.

## 8. Worktree delete — MISSING (high)
- macOS: promptDeleteWorktreeForGroup (native-sidebar.tsx:13928) reads fresh branch/status/remote-branch → opens deleteWorktree modal with worktreeDeleteDraft (13970-82). Modal in modal-host.tsx:36-38,113. Shared trigger: promptDeleteWorktree → promptDeleteWorktreeForGroup (session-group-section.tsx:1581-90).
- GPUI: (a) deleteWorktree not in GpuiAppModalKind; (b) runtime does NOT handle promptDeleteWorktreeForGroup (0 matches). Delete backend EXISTS in Rust (/api/deleteWorktreeProject main.rs:51117/51361, remote payload 51749); runtime handles commitWorktreeBeforeDelete (2419). No path to collect status/open/confirm.
- Work: runtime handler for promptDeleteWorktreeForGroup; add DeleteWorktree modal kind; wire confirm → /api/deleteWorktreeProject.

## 9. Merge-back — WORKING when reachable (med)
- GitCommitModal onDirectMerge + deleteWorktreeAfter (git-commit-modal.tsx:89-130,175); runtime confirmSidebarGitDirectMerge (2416/4755) → mergeWorktreeIntoMain → /api/mergeWorktreeIntoMain (4941-44); Rust 51526.
- Gaps: reachable only via worktree Create PR modal; delete-after-merge depends on #8; toasts. Verify cleanup end-to-end.

## 10. Repository clone — PARTIAL: remote works, LOCAL broken (high)
- Entry works: Clone Repository in palette (529-33, 859) + Projects header → AddRepository modal (main.rs:1310/1380). Parsing shared (repository-clone.ts), server impl shared (repository_clone.rs).
- LOCAL clone broken: modal onClone posts cloneRepository WITHOUT remoteMachineId for local (modal-host.tsx:3236-47). GPUI routes to handle_gpui_start_remote_repository_clone_message (21886-89) which REQUIRES remoteMachineId else "The remote machine is unavailable." (22571-90). previewRepositoryClone same. Runtime has no cloneRepository case (only openRemoteCloneRepository :2304).
- Work: local clone path when remoteMachineId absent (drive local daemon); restore clone toasts.

## 11. Project diff stats — MISSING (high)
- macOS: projectDiffStatsByProjectId + background refresh interval, git diff --numstat (native-sidebar.tsx:1800-03, 12701-927), overlay into projection diffStats (18390), rendered in headers (session-group-section.tsx:359-467).
- GPUI: runtime only ever sets createDefaultSidebarProjectDiffStats() zeros (gxserver-runtime.ts:10651; projection default :548). No map, no refresh, no overlay → header +/- always "no changes". (readSidebarGitState computes additions/deletions :4054 but feeds SidebarGitState, not editor.diffStats.)
- Work: port diff-stats refresh loop (tracked numstat HEAD + optional untracked per project-diff-stats.ts:70-85) for visible non-Quick projects, overlay into editor.diffStats pre-publish.

## Cross-cutting (fix once, unblocks several)
1. Render inbound type:"toast" (main.rs:21925) — unblocks #3,5,6,7,8,9,10 feedback.
2. Extend GpuiAppModalKind with worktree/deleteWorktree/gitFileDiff — unblocks #4,7,8.
3. Titlebar git menu + main-project git entries — unblocks #3,5,6 reachability.
4. Git-state refresh driver (#2) + diff-stats loop (#11).
5. promptDeleteWorktreeForGroup handler + local cloneRepository (#8,#10).

## Uncertainties
- PR review surface beyond commit-modal review + browser (native-sidebar.tsx 1.8MB not exhaustively read).
- multiRelease/release agent workflows not traced.
- Commit modal inline in both (believed yes — shared SidebarApp).
