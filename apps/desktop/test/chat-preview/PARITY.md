# Chat parity tracker: GPUI vs React

React chat (`packages/core-ui/chat/`) is the reference. GPUI chat is `apps/desktop/src/app/native_chat/`. Rules and presentation data shared by both live in `packages/shared/session-chat-presentation/` and `packages/shared/session-chat-controller/`.

Compare with `bun run chat:lab` (see [README](README.md)). Screenshots from the comparison rounds: `~/.local/share/ghostex/i/chat-parity-20260918/` (`round2/`, `round3/`, `round4/`).

**Status legend**

- `DONE-LIVE`: implemented and compared side by side in the Chat Lab (Tart VM).
- `DONE-CODE`: implemented, gates pass (`typecheck`, `desktop:typecheck`, `cargo check`), not yet seen in a running app.
- `PARTIAL`: works, with a named difference.
- `TODO`: not started.
- `WIP`: an agent is on it.

Update the row and the date when something changes. Keep rows short; details belong in the code or the README.

Last updated: 2026-09-19

## Transcript

| Component / behaviour | Status | Notes |
|---|---|---|
| User bubble, queued label | DONE-LIVE | |
| Assistant prose, paragraph breaks between blocks | DONE-LIVE | shared `prose-blocks.ts` |
| Headings, lists, nested markers, blockquote | DONE-LIVE | |
| Code block header (label, copy, open file, wrap toggle) | PARTIAL | wrap state not persisted across restarts (React uses localStorage) |
| Code block horizontal scroll (no wrap by default) | DONE-LIVE | |
| Syntax highlighting, GitHub palette | PARTIAL | plain variable, python builtin, JSON key hues differ; needs `tree-sitter-languages` feature |
| Tables (borderless, bold header) | DONE-LIVE | |
| Table toolbar (expand, fit, copy md, copy csv) | PARTIAL | 4 flat buttons vs React's 3 with copy dropdown; no horizontal scrollbar under wide tables |
| GitHub alerts | DONE-LIVE | |
| Color swatches (inline code and prose) | DONE-LIVE | |
| Markdown link pills, web link pills | DONE-LIVE | |
| Bare file paths in user text | DONE-LIVE | |
| Inline-code file references in any message (`path:line`, `:line:col`, ranges, abs, `~`, Windows), same `openFile` payload | DONE-LIVE | lab `links` scenario; pill glyph is by kind, React's chip glyph is by extension |
| Bare web URLs get link icon, colour, tooltip | DONE-CODE | |
| References inside tables, alerts, lists, subagent message card | DONE-CODE | list item checked live |
| Right-click menu on transcript reference pills | DONE-LIVE | |
| Inline `[Image #N]` thumbnails, markdown images | PARTIAL | words that do not fit beside the picture start on the next line instead of flowing around it |
| Transcript image thumbnails (user and agent) | PARTIAL | AVIF/HEIC fall back to a name chip; sizes come from shared `image-visual.json` and a screenshot is averaged down to the tile's device pixels |
| Image viewer (zoom, arrows, Escape, backdrop, copy, save) | PARTIAL | backdrop dims but does not blur; two glyphs differ |
| Thinking / reasoning rows and disclosure | DONE-LIVE | "show more" overflow uses a character estimate |
| Tool runs (glyphs, error tone, mono args, plain result) | DONE-LIVE | |
| "+N previous tool calls" fold | DONE-LIVE | shared `tool-rows.ts` |
| Disclosure rails and indent | DONE-LIVE | |
| Terminal tool rows | DONE-LIVE | |
| "Worked for" fold | DONE-LIVE | |
| Deferred work loading / error / retry | DONE-CODE | |
| File change cards (+/- counts, Failed, connector) | PARTIAL | clipped folder has no leading ellipsis |
| "N files changed" fold | DONE-LIVE | |
| Status rows (status / inline / collapsed, tone badge) | PARTIAL | row pitch about 4px looser |
| System cards (goal, fork boundary, rename, command output, marker) | PARTIAL | `/status` marker glyph, goal icon, `1/2` badge differ |
| Agent message card, inter-agent card (2-line clamp) | DONE-LIVE | |
| Answered question exchange cards | DONE-LIVE | |
| Live question / approval / async question cards | DONE-LIVE | |
| Terminal notice cards, update cards | DONE-LIVE | |
| Startup delivery rows (Retry / Remove) | DONE-LIVE | |
| Subagent link and viewer | PARTIAL | painted in-pane, edge to edge (React: inset card); tooltip not refreshed per hover |
| Message actions: copy, save to md, annotate | DONE-LIVE | |
| Rewind dialog | DONE-CODE | gated like React; not run against a real agent |
| Save prompt on user rail | DONE-CODE | gated on host stash support |
| Fork branch switcher | DONE-LIVE | |
| Load earlier (auto, anchored scroll) | DONE-LIVE | |
| Transcript search (Cmd+F) | PARTIAL | highlights the row, not the matched text |
| Minimap | DONE-CODE | never seen live; hides when pane is under about 870px |
| Transcript scrollbar (full pane height, no jump) | DONE-CODE | min thumb 48px vs React 24px; fade timing slower |
| Scroll-to-bottom button | DONE-LIVE | |
| Bottom transcript fade above composer | DONE-CODE | |
| Cross-message text selection | DONE-LIVE | |
| Simple / verbose / summary modes | DONE-LIVE | |
| Working strip, status line | DONE-LIVE | |
| New session welcome, empty, loading | PARTIAL | title about 5% wide (no letter-spacing in GPUI) |

## Composer and chrome

| Component / behaviour | Status | Notes |
|---|---|---|
| Text input, placeholder, auto-grow, history recall | DONE-LIVE | |
| Chat box animation (collapse, expand, auto-grow, strips) | DONE-CODE | 280ms shared curve; React's 4px baseline nudge not reproduced |
| Status line height reserved from first frame | DONE-CODE | first chat after install can still shift once |
| Composer input scrollbar (5px, scroll-reveal) | DONE-CODE | fade timing slower than React |
| Typing / caret keys from chat background | DONE-CODE | |
| Ctrl+U / Ctrl+K / Ctrl+Y | DONE-LIVE | |
| Keyboard zoom (Cmd+= / Cmd+- / Cmd+0) | DONE-CODE | temporary per pane in both; GPUI's Cmd+0 returns to the configured default, Chromium's to 100% |
| Reference pills in draft, click and double click | DONE-LIVE | |
| Right-click menu on composer pills | DONE-CODE | |
| `/` slash command popup | DONE-LIVE | React rows have per-row outlines |
| `@` project file popup (ranking, Up/Down, Enter, Tab, click, Escape, quoted-space path) | DONE-LIVE | shared trigger and ranking rules; the popup is a child window, so it closes when the chat pane loses focus while React's stays |
| `$` skill popup (list, heading, loading row, "No skills available.") | DONE-LIVE | heading is the agent's display name in both since 2026-09-19 |
| `$` skill popup error row with Retry | DONE-CODE | the lab's preview backend never fails a skills read, so the row cannot be reached there |
| Suggestion popup lands over the composer on a second display | DONE-CODE | the child window now opens on the chat window's own display; the single-display lab cannot show the regression |
| Attachment tiles (remove, pending) | DONE-CODE | paste not exercised live |
| Send / Stop / queue / Compact & Send menu | DONE-LIVE | |
| Send-blocked toast | DONE-CODE | |
| Composer-not-ready card, terminal tail | DONE-CODE | |
| Terminal View readiness tint and tail preview | DONE-CODE | |
| Queue strip | DONE-LIVE | |
| Option pills and menus | DONE-LIVE | |
| Second click on a menu trigger closes its menu | DONE-CODE | shared guard in `native_chat/menu_toggle.rs`; submenu parent rows toggle too |
| Agent icon with account mark on model pill | DONE-CODE | sizing and centring unverified |
| Model quick picker | DONE-LIVE | |
| Quick picker dismisses on pane resize | DONE-CODE | both renderers |
| Context meter, context details editor, status line | DONE-LIVE | |
| Note panel, stash badge, note dot | DONE-CODE | |
| Draft conflict preview | DONE-CODE | |
| Maximized composer | DONE-LIVE | |
| Agent fleet strip | PARTIAL | fold state not persisted |
| Agent tasks panel | PARTIAL | label column about 145px narrower |
| Host action buttons gated on host support | DONE-CODE | |
| Chat-bar extension panel | TODO | needs a CEF page hosted inside the GPUI pane |
| Account switching UX | n/a here | owned by a separate effort |

## Cross-cutting, not yet compared

| Area | Status | Notes |
|---|---|---|
| Motion outside the chat box (disclosures, hover fades, menus, streaming follow) | TODO | lab rounds were static screenshots |
| Real sessions (streaming, remote images, rewind, fork switch, subagent polling) | TODO | everything so far used lab fixtures |
| GPUI chat inside the full app window | TODO | |
| Fractional zoom (70% to 200%) for the new components | TODO | |
| Keyboard focus styling and tab order on new controls | TODO | |
| Light theme | PARTIAL | checked on `conversation` and `rich-markdown` only |

## Deliberate differences (user decisions, not parity gaps)

- Mouse cursor: GPUI chat keeps the default arrow over transcript text, pills, links and buttons (React uses I-beam and pointing hand). Text fields keep the I-beam; drag handles keep the grab cursor. See `native_chat/cursor.rs`.

## Housekeeping

- `.dependencies/gpui-component` carries local edits (text layout, code block wrap and header, link secondary click, highlight theme, input scrollbar options). They need a commit in that checkout and a pin bump.
- `transcript.rs` and `native-host.ts` should be checked against the file-size rule in a quiet worktree window.
