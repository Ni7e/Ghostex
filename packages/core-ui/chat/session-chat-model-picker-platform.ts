/** CDXC:Mobile 2026-09-12 DECISION:
 * User: fully disable the quick model picker on mobile and do not load it there. Ordinary model and effort dropdowns still use the shared selection queue.
 * The mobile build defines this flag so the picker import and its assets are removed from the bundle.
 */
declare global {
  const __GHOSTEX_MOBILE_CHAT__: boolean;
}

export const QUICK_MODEL_PICKER_ENABLED = typeof __GHOSTEX_MOBILE_CHAT__ === 'undefined' || !__GHOSTEX_MOBILE_CHAT__;
