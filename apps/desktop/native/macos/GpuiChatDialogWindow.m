#import <AppKit/AppKit.h>

extern void *CGSMainConnectionID(void);
extern int32_t CGSSetWindowBackgroundBlurRadius(void *, NSInteger, int64_t);

// CDXC:SessionChat 2026-09-18 WHY:
// The system blur material is much stronger than the chat dialog's eight-point CSS backdrop blur.
// Use the same WindowServer blur API as GPUI, with the chat radius and without a material tint.
void GhostexGpuiPrepareChatDialogWindow(void *nativeView) {
  NSView *view = (__bridge NSView *)nativeView;
  NSWindow *window = view.window;
  if (!window) return;
  window.styleMask = NSWindowStyleMaskBorderless;
  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.hasShadow = NO;
  [window invalidateShadow];
  CGSSetWindowBackgroundBlurRadius(CGSMainConnectionID(), window.windowNumber, 24);
}

// CDXC:SessionChat 2026-09-21 WHY:
// A chat right-click menu is a child window, and a titled window brings the system's large rounded
// frame and heavy drop shadow, which the sidebar's in-window context menu does not have. Borderless
// and shadowless leaves only the panel GPUI draws, so the two menus look the same.
void GhostexGpuiPrepareChatContextMenuWindow(void *nativeView) {
  NSView *view = (__bridge NSView *)nativeView;
  NSWindow *window = view.window;
  if (!window) return;
  window.styleMask = NSWindowStyleMaskBorderless;
  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.hasShadow = NO;
  [window invalidateShadow];
}
