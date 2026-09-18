/**
 * How long a session must stay continuously non-working before a transcript
 * settles (folds its newest turn into "Worked for Xs"). The live status flaps
 * around turn boundaries and each false blip would flash the fold in and out,
 * so the rule lives here and both transcripts read it: React through
 * `use-session-chat-working-hold.ts`, GPUI chat through
 * `session-chat-controller/native-subagent.ts`.
 */
export const SESSION_CHAT_SETTLE_HOLD_MS = 8_000;
