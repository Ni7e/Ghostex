import animation from './worked-fold-animation.json';

/**
 * CDXC:SessionChat 2026-09-24 DECISION:
 * User: when part of the transcript moves under "Worked for Xs", fade into it smoothly, not too fast, and play the same animation in reverse when the reader expands it so the switch is never abrupt. Every expand and collapse in the chat animates, and one the reader clicks runs at double the speed of the automatic fold (`toggleMs` is half the fold's collapse).
 * How a finished turn moves into its "Worked for Xs" fold, and how the fold opens and closes when the reader toggles it. Both renderers read these numbers: packages/core-ui/chat/session-chat-worked-fold.tsx through this module, and apps/desktop/src/app/native_chat/worked_fold_motion.rs through include_str! of the same JSON. Change them together.
 * Folding: the turn's work rows dim to `dimOpacity` over `dimMs`, their height eases shut from `collapseDelayMs` for `collapseMs`, and the heading, its divider and the "N files changed" line fade and grow in from `headingDelayMs` for `headingMs`. Opening or closing anything by hand (the log, a tool's detail, a tool group, a reasoning row, a card body, a capped block's "Show more") eases its height and opacity over `toggleMs`, the fold's motion played forwards or back; React does it in session-chat-disclosure-body.tsx, GPUI in disclosure_motion.rs.
 */
export const SESSION_CHAT_WORKED_FOLD_ANIMATION = animation;

/** The CSS `cubic-bezier(...)` form of the shared easing. */
export const SESSION_CHAT_WORKED_FOLD_EASING = `cubic-bezier(${animation.easing.join(', ')})`;
