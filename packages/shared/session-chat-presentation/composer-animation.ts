import animation from './composer-animation.json';

/**
 * CDXC:SessionChat 2026-09-19 SEE-ALSO:
 * The chat box's transition timing and its collapsed and expanded metrics, read by both renderers so
 * they move the same way: packages/core-ui/chat/use-session-chat-composer-transition.ts takes the
 * duration and easing from here, and apps/desktop/src/app/native_chat/composer_animation.rs reads the
 * same JSON through include_str!. The metrics mirror values that only exist in CSS:
 * packages/core-ui/chat/session-chat-composer-collapse.css (collapsed height, line height and padding),
 * packages/core-ui/chat/session-chat-lexical/input.css (expanded line height and max height) and the
 * `rounded-3xl px-4 py-2.5` box in packages/core-ui/chat/session-chat-composer.tsx. Change them together.
 */
export const SESSION_CHAT_COMPOSER_ANIMATION = animation;

/** The CSS `cubic-bezier(...)` form of the shared easing, for Web Animations and stylesheets. */
export const SESSION_CHAT_COMPOSER_EASING = `cubic-bezier(${animation.easing.join(', ')})`;
