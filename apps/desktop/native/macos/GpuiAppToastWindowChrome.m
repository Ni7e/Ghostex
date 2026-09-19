#import <AppKit/AppKit.h>
#import <objc/runtime.h>

extern void GhostexGpuiCEFFocusGpuiRootView(void *nativeView);
extern void GhostexGpuiCEFFocusNativeView(void *nativeView);

@interface GhostexUsageKeyboardFocus : NSObject
@property(nonatomic, weak) NSResponder *previous;
@property(nonatomic, weak) NSView *root;
@end
@implementation GhostexUsageKeyboardFocus
@end

static char GhostexUsageKeyboardFocusKey;

// CDXC:AgentProviders 2026-09-12 WHY:
// A non-activating usage popup needs keyboard input in GPUI, otherwise Tab and Space still reach Chromium's composer. Preserve its responder until the popup closes.
void GhostexGpuiBeginUsageKeyboardFocus(void *nativeView) {
  NSView *root = (__bridge NSView *)nativeView;
  if (!root.window) return;
  GhostexUsageKeyboardFocus *state = [GhostexUsageKeyboardFocus new];
  state.previous = root.window.firstResponder;
  state.root = root;
  objc_setAssociatedObject(root.window, &GhostexUsageKeyboardFocusKey, state,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  GhostexGpuiCEFFocusGpuiRootView(nativeView);
}

void GhostexGpuiEndUsageKeyboardFocus(void *nativeView) {
  NSView *root = (__bridge NSView *)nativeView;
  NSWindow *window = root.window;
  if (!window) return;
  GhostexUsageKeyboardFocus *state =
      objc_getAssociatedObject(window, &GhostexUsageKeyboardFocusKey);
  NSResponder *previous = state.previous;
  if (window.firstResponder == state.root &&
      [previous isKindOfClass:[NSView class]] &&
      ((NSView *)previous).window == window) {
    GhostexGpuiCEFFocusNativeView((__bridge void *)previous);
  }
  objc_setAssociatedObject(window, &GhostexUsageKeyboardFocusKey, nil,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

void GhostexGpuiRemoveToastPopupWindowChrome(void *nativeView) {
  @autoreleasepool {
    if (nativeView == NULL) {
      return;
    }

    NSView *view = (__bridge NSView *)nativeView;
    NSWindow *window = view.window;
    if (window == nil) {
      return;
    }

    /*
     CDXC:AppModal 2026-07-04:
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

    NSView *contentView = window.contentView;
    contentView.wantsLayer = YES;
    contentView.layer.backgroundColor = NSColor.clearColor.CGColor;
    view.wantsLayer = YES;
    view.layer.backgroundColor = NSColor.clearColor.CGColor;
  }
}

/*
 CDXC:AppModal 2026-08-18:
 gpui gives every WindowKind::PopUp window NSPopUpWindowLevel, which floats the
 toast panel above every other application. Toasts belong to the Ghostex main
 window, so attach the panel as a real AppKit child window at the parent's own
 level: it then stays ordered directly above the main window, follows it when
 the user moves it, disappears with it on miniaturize/hide, and no longer draws
 over whatever app the user switched to.
 */
void GhostexGpuiAttachToastPopupToMainWindow(void *toastNativeView,
                                             void *mainNativeView) {
  @autoreleasepool {
    if (toastNativeView == NULL || mainNativeView == NULL) {
      return;
    }

    NSWindow *toastWindow = ((__bridge NSView *)toastNativeView).window;
    NSWindow *mainWindow = ((__bridge NSView *)mainNativeView).window;
    if (toastWindow == nil || mainWindow == nil || toastWindow == mainWindow) {
      return;
    }

    toastWindow.level = mainWindow.level;
    if (toastWindow.parentWindow != mainWindow) {
      [mainWindow addChildWindow:toastWindow ordered:NSWindowAbove];
    }
  }
}

/*
 CDXC:Onboarding 2026-09-15 DECISION:
 User: "the modal must stay on top of the main ghostex app and centered on top
 of it". gpui opens the onboarding host as an independent NSWindow, so clicking
 the workspace behind it raised the main window over the modal. Attaching it as
 an AppKit child window (ordered above, at the parent's level) keeps it above the
 main window no matter which one is key, and moves it with the main window so it
 stays centered where the launcher placed it. The window-will-close observer
 detaches it first: a child window closed while still attached lingers in the
 parent's childWindows list and can be ordered back in with the parent.
 */
static void GhostexGpuiAttachChildWindow(void *modalNativeView,
                                        void *mainNativeView, BOOL activate) {
  @autoreleasepool {
    if (modalNativeView == NULL || mainNativeView == NULL) {
      return;
    }

    NSWindow *modalWindow = ((__bridge NSView *)modalNativeView).window;
    NSWindow *mainWindow = ((__bridge NSView *)mainNativeView).window;
    if (modalWindow == nil || mainWindow == nil || modalWindow == mainWindow) {
      return;
    }

    modalWindow.level = mainWindow.level;
    if (modalWindow.parentWindow != mainWindow) {
      [mainWindow addChildWindow:modalWindow ordered:NSWindowAbove];
    }
    __block id observer = [[NSNotificationCenter defaultCenter]
        addObserverForName:NSWindowWillCloseNotification
                    object:modalWindow
                     queue:nil
                usingBlock:^(NSNotification *note) {
                  NSWindow *closing = note.object;
                  NSWindow *parent = closing.parentWindow;
                  if (parent != nil) {
                    [parent removeChildWindow:closing];
                  }
                  if (observer != nil) {
                    [[NSNotificationCenter defaultCenter] removeObserver:observer];
                    observer = nil;
                  }
                }];
    if (activate) [modalWindow makeKeyAndOrderFront:nil];
  }
}

void GhostexGpuiAttachAppModalWindowToMainWindow(void *modalNativeView,
                                               void *mainNativeView) {
  GhostexGpuiAttachChildWindow(modalNativeView, mainNativeView, YES);
}

// CDXC:SessionChat 2026-09-17 WHY:
// Autocomplete owns a child window but typing must remain in the composer's window.
void GhostexGpuiAttachComposerSuggestionsWindow(void *nativeView,
                                               void *mainNativeView) {
  NSWindow *window = ((__bridge NSView *)nativeView).window;
  GhostexGpuiRemoveToastPopupWindowChrome(nativeView);
  if ([window isKindOfClass:[NSPanel class]]) {
    ((NSPanel *)window).becomesKeyOnlyIfNeeded = YES;
  }
  window.hasShadow = YES;
  GhostexGpuiAttachChildWindow(nativeView, mainNativeView, NO);
}

// CDXC:SessionChat 2026-09-19 WHY:
// A pane-sized chat overlay (the image preview) has to follow its pane when a divider or the main
// window is resized. GPUI can resize a window but not move it, and a pane resized from its left or
// top edge moves as well, so the frame is set here. The rect is in the main window's content
// coordinates, top-left origin, which is what GPUI reports for the pane.
void GhostexGpuiSetChildWindowContentFrame(void *childNativeView,
                                          void *mainNativeView, double x,
                                          double y, double width,
                                          double height) {
  @autoreleasepool {
    if (childNativeView == NULL || mainNativeView == NULL) {
      return;
    }
    NSWindow *child = ((__bridge NSView *)childNativeView).window;
    NSWindow *mainWindow = ((__bridge NSView *)mainNativeView).window;
    if (child == nil || mainWindow == nil || child == mainWindow) {
      return;
    }
    NSRect content = [mainWindow contentRectForFrameRect:mainWindow.frame];
    NSRect frame = NSMakeRect(content.origin.x + x,
                              content.origin.y + content.size.height - y - height,
                              width, height);
    if (!NSEqualRects(child.frame, frame)) {
      [child setFrame:frame display:YES];
    }
  }
}

void GhostexGpuiPrepareTitlebarPopupWindow(void *nativeView) {
  @autoreleasepool {
    if (nativeView == NULL) {
      return;
    }

    NSView *view = (__bridge NSView *)nativeView;
    NSWindow *window = view.window;
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
      ((NSPanel *)window).becomesKeyOnlyIfNeeded = YES;
      window.hidesOnDeactivate = NO;
    }
    [window orderFrontRegardless];
  }
}
