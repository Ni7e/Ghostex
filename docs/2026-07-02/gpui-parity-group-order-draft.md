# GPUI Parity — Suggested Feature-Group Order (Draft 1)

Date: 2026-07-02

**This is a draft for you to reorder.** Move whole `##` blocks around (or renumber them) — whatever order this file ends up in is the order the plan will use. Delete groups you don't want, add inline notes freely.

Agreed context this draft assumes:

- The hybrid architecture is final: GPUI shell + CEF-hosted React surfaces + libghostty terminals. Parity = behavior/feature completeness, not UI rewrites.
- Phase A = everything needed for you to daily-drive the GPUI app. Phase B = long-tail/pre-release extras.
- The old parity-tracker docs are ignored. Statuses below come from a light code recon only — before detailed planning of each group I'll verify its real status against both codebases.

Legend: ✅ appears working · 🟡 partially there · ❌ not found · ❓ not yet checked

---

# Phase A — daily-driver parity

## 1. Core session lifecycle & sidebar

- Covers: session create / restore / fork, grouped workspace state, session cards (activity/lifecycle states, context menus, tags, pinning), group collapse/reorder, drag & drop, visible-session slots, project/workspace switching, add-repository.
- gpui status: 🟡 — the React sidebar + gxserver runtime are reused wholesale in CEF, so core flows likely function; native-side wiring for per-card actions, restore/fork launch plans, and DnD edge cases ❓.
- Rationale for position: it's the app's front door; every other feature is reached through it.

## 2. Terminal panes & tabs

- Covers: splits + tabs, hotkey navigation (cmd+t / cmd+d / cmd+opt+arrows), focus borders, close-confirm, sleeping/overflow placeholders, IME input, file drop, full-width rows, merge-tabs; command panes (pinned/floating/collapsed command terminals).
- gpui status: 🟡→✅ — deep implementation exists (pane/tab/split tree, real Ghostty surfaces, placeholder states, command-pane model). Edge behaviors (IME, file drop, close-confirm parity) ❓.
- Rationale: the surface you stare at all day; must feel identical to the Swift app.

## 3. Prompt editor & prompts

- Covers: floating prompt editor (Ctrl+G) with image insert/preview, cross-client prompt routing, pinned prompts, scratch pad, first-prompt auto session-title, delayed send.
- gpui status: ❓ likely ❌ — nothing prompt-editor-shaped surfaced in the gpui recon; needs verification.
- Rationale: prompts are the primary input to agent sessions — right behind terminals in daily use.

## 4. Command palette, hotkeys & custom commands

- Covers: command palette + session search, hotkeys editor + recorder, configure-actions panel / custom commands, command icons.
- gpui status: 🟡 — Command Palette and Hotkeys modals exist in the GPUI app-modal host; recorder behavior, custom actions, palette completeness ❓.
- Rationale: power-user navigation glue used constantly once terminals and prompts work.

## 5. Git & worktrees

- Covers: titlebar git menu, quick git state, commit modal, file-diff viewer, sync-with-main, PR review, running toasts, worktree create/delete/merge-back, repository clone.
- gpui status: 🟡 — Rust side has gxserver git-action plumbing; the UI surfaces (git menu, commit/diff modals, worktree modals) ❓.
- Rationale: core to the agent workflow (review what agents did, merge worktrees) — daily but slightly less constant than 1–4.

## 6. Settings

- Covers: full settings modal (settings / integrations / osIntegration / remote / projects / agents / actions / openTargets / hotkeys tabs), embedded Ghostty terminal settings + themes + font presets, auto-sleep policy per surface.
- gpui status: 🟡 — shared settings parsing exists (`shared_settings.rs`) and a Settings modal is wired; per-tab completeness and write-back paths ❓.
- Rationale: touched less often, but daily-driving is impossible if a setting you need isn't reachable.

## 7. Agents

- Covers: agents hub, supported-CLI catalog, configure-agents + per-agent config, agent hook status, attention events, completion detection.
- gpui status: 🟡 — Agents Hub modal present; Rust has gxserver agent settings/policy; attention-notification shims exist. Depth of config surfaces ❓.
- Rationale: mostly set-and-forget after initial config, but attention/completion signals are daily-critical (they may already work via gxserver).

## 8. Session history & search

- Covers: previous-sessions modal, fuzzy search across all prior sessions by prompt text (zehn / ghostex-history backends), resume with context, daemon-sessions viewer.
- gpui status: 🟡 — Previous Sessions and Running Sessions modals exist in the modal host; search-backend wiring and resume flows ❓.
- Rationale: reached several times a day when picking up old work.

## 9. Browser panes

- Covers: Chromium panes with tabs/splits/toolbar/address bar, browser profiles, DevTools, annotations (Agentation), browser-use (agent-driven tabs), favicon-on-hover.
- gpui status: ✅ core (tabs/splits/toolbar/profiles/DevTools implemented) · annotations + browser-use ❓.
- Rationale: heavily used, but the core already works in gpui — remaining work is the long tail.

## 10. Editor & docs panes

- Covers: code-server (embedded VS Code) with sleep-when-idle, t3code GUI panes with hibernation, docs/meo editor (markdown / HTML / Excalidraw + annotations).
- gpui status: 🟡 — code-server workarea working (shared runtime, healthz-gated mount); t3 partially there (recent "T3 sessions" work); docs/meo editor ❓ likely ❌.
- Rationale: important but episodic compared to terminals/prompts.

## 11. Kanban board & automations

- Covers: beads kanban board, manage surface, bead↔conversation links, orchestrator workflow, scheduled messages / cron automations.
- gpui status: 🟡 — kanban + manage CEF surfaces exist with Rust project/file bridges; automations + bead-link depth ❓.
- Rationale: valuable planning surface, used in bursts rather than continuously.

## 12. Notifications, sounds & ambient

- Covers: completion sounds, terminal-bell + macOS attention notifications, menu-bar working/done status indicator with click-to-jump, phone notifications, desktop pets.
- gpui status: 🟡 — attention-notification, menu-bar status item, and settings-notification shims exist; pet spritesheets already load. Sounds + phone notifications ❓.
- Rationale: ambient quality-of-life; matters for daily-driving but nothing blocks without it.

## 13. Remote & portless

- Covers: remote gxserver install over SSH, remote machines in sidebar, portless tunneling + setup modal, remote project picker, remote attach.
- gpui status: ❓ — Rust supports multiple gxserver connections (suggests remote-aware core); the install/setup/tunnel UX unverified.
- Rationale: essential if remote hosts are part of your daily flow — placed here assuming local-first usage; move it up if not.

## 14. OS integration & power

- Covers: keep-awake, lid-sleep privileged helper, open-with targets, accessibility display options.
- gpui status: 🟡 — keep-awake titlebar control, lid-sleep helper client, and accessibility shims already exist; open-with targets ❓.
- Rationale: mostly already ported; verify-and-close rather than build.

---

# Phase B — long-tail / pre-release

## 15. Onboarding & discovery

- First-launch setup wizard, discover sequence, tips & tricks (a CEF tips popover already exists 🟡), watch-video modal.

## 16. Updates & distribution

- Sparkle auto-update (dual-arch appcasts), in-titlebar update download, release script integration for the GPUI app bundle.

## 17. CLI & external entry points

- `ghostex` / `gx` CLI find/resume + automations pointing at the GPUI app, URL/open-with handlers.

## 18. Support & polish

- Support-bundle logging parity (`~/.ghostex/logs/` rules), crash reporting, app shots (🟡 shim exists), icon/menu polish.

---

## How we proceed after your reorder

1. You reorder/edit this file and tell me it's ready.
2. I verify the real gpui status of the top groups (code-level, both codebases — ignoring old trackers).
3. I turn the verified order into the concrete high-level plan: explicit next work items per group, with the "next up" groups fully broken down.

---

# Your order (edit this — it wins over everything above)

1. Core session lifecycle & sidebar
2. Terminal panes & tabs
3. Prompt editor & prompts
4. Command palette, hotkeys & custom commands
5. Git & worktrees
6. Settings
7. Agents
8. Session history & search
9. Browser panes
10. Editor & docs panes
11. Kanban board & automations
12. Notifications, sounds & ambient
13. Remote & portless
14. OS integration & power
15. Onboarding & discovery
16. Updates & distribution
17. CLI & external entry points
18. Support & polish
