#import <AppKit/AppKit.h>

void GhostexGpuiRemoveToastPopupWindowChrome(void* nativeView) {
  @autoreleasepool {
    if (nativeView == NULL) {
      return;
    }

    NSView* view = (__bridge NSView*)nativeView;
    NSWindow* window = view.window;
    if (window == nil) {
      return;
    }

    /*
     CDXC:GPUIAppToastWindowChrome 2026-07-04:
     App toasts render inside a transparent GPUI popup because native CEF and
     Ghostty child views draw above in-window GPUI layers. Strip all AppKit
     frame chrome from the popup host so macOS cannot draw a titlebar edge,
     border, or window shadow behind the actual toast card. Keep only the
     card border/background in GPUI.
     */
    window.styleMask = NSWindowStyleMaskNonactivatingPanel;
    window.titleVisibility = NSWindowTitleHidden;
    window.titlebarAppearsTransparent = YES;
    window.opaque = NO;
    window.backgroundColor = NSColor.clearColor;
    window.hasShadow = NO;
    [window invalidateShadow];

    NSView* contentView = window.contentView;
    contentView.wantsLayer = YES;
    contentView.layer.backgroundColor = NSColor.clearColor.CGColor;
    view.wantsLayer = YES;
    view.layer.backgroundColor = NSColor.clearColor.CGColor;
  }
}

void GhostexGpuiPrepareTitlebarPopupWindow(void* nativeView) {
  @autoreleasepool {
    if (nativeView == NULL) {
      return;
    }

    NSView* view = (__bridge NSView*)nativeView;
    NSWindow* window = view.window;
    if (window == nil) {
      return;
    }

    GhostexGpuiRemoveToastPopupWindowChrome(nativeView);
    if ([window isKindOfClass:[NSPanel class]]) {
      /*
       Titlebar dropdown panels must never take key status from the main
       window: the menu is mouse-driven, Escape is handled by the main
       window, and a key-stealing panel makes the whole app look
       deactivated the moment the menu opens.
       */
      ((NSPanel*)window).becomesKeyOnlyIfNeeded = YES;
      window.hidesOnDeactivate = NO;
    }
    [window orderFrontRegardless];
  }
}
