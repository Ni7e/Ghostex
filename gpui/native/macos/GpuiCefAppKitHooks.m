#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <stdbool.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>
#import <stdint.h>
#import <string.h>

void GhostexGpuiCEFDoMessageLoopWork(void);
int GhostexGpuiCEFHandleSelectAllForNativeView(void* nativeView);
int GhostexGpuiCEFHandleSelectAllForActiveNativeView(void);
int GhostexGpuiCEFMarkNativeViewFocused(void* nativeView);
void GhostexGpuiCEFClearActiveNativeView(void);

static BOOL g_ghostexGpuiCEFMessagePumpInstalled = NO;
static BOOL g_ghostexGpuiCEFApplicationHooksInstalled = NO;
static BOOL g_ghostexGpuiCEFStandardEditMenuInstalled = NO;
static BOOL g_ghostexGpuiCEFHandlingSendEvent = NO;
static BOOL g_ghostexGpuiCEFMessagePumpWorkPending = NO;
static BOOL g_ghostexGpuiCEFMessagePumpWorkActive = NO;
static BOOL g_ghostexGpuiCEFMessagePumpReentrancyDetected = NO;
static uint64_t g_ghostexGpuiCEFMessagePumpGeneration = 0;

static const int64_t GhostexGpuiCEFMessagePumpPlaceholderDelayMs = INT32_MAX;
static const int64_t GhostexGpuiCEFMessagePumpMaxTimerDelayMs = 1000 / 30;

static void GhostexGpuiCEFRunScheduledMessagePumpWork(void);
static void GhostexGpuiCEFOnScheduleMessagePumpWork(int64_t delayMs);
static void GhostexGpuiCEFInstallStandardEditMenu(void);
static void GhostexGpuiCEFBrowserViewMouseDown(id self, SEL _cmd, NSEvent* event);
static BOOL GhostexGpuiCEFBrowserViewAcceptsFirstResponder(id self, SEL _cmd);
static void GhostexGpuiCEFBrowserViewSelectAll(id self, SEL _cmd, id sender);
static BOOL GhostexGpuiCEFBrowserViewPerformKeyEquivalent(id self, SEL _cmd, NSEvent* event);
static void GhostexGpuiCEFBrowserViewAddSubview(id self, SEL _cmd, NSView* subview);
static void GhostexGpuiCEFInstallBrowserViewFocusSubclass(NSView* view);
static void GhostexGpuiCEFInstallBrowserViewFocusSubclassInTree(NSView* view);
static BOOL GhostexGpuiCEFEventIsCommandA(NSEvent* event);
static BOOL GhostexGpuiCEFHandleSelectAllForResponder(id responder);
static void GhostexGpuiCEFMarkFocusedResponder(id responder);

/*
 CDXC:GPUIPhase1 2026-06-14-16:14:
 CEF's macOS external-run-loop path requires NSApplication to conform to CefAppProtocol before Chromium installs its CFRunLoop observers. Mirror the protocol definitions from cef_application_mac.h locally so this lightweight cef-rs shim can register the Objective-C category at load time without restoring a direct CEF C++ header dependency.
 */
@protocol CrAppProtocol
- (BOOL)isHandlingSendEvent;
@end

@protocol CrAppControlProtocol <CrAppProtocol>
- (void)setHandlingSendEvent:(BOOL)handlingSendEvent;
@end

@protocol CefAppProtocol <CrAppControlProtocol>
@end

@interface NSApplication (GhostexGpuiCEFApplication) <CefAppProtocol>
- (BOOL)isHandlingSendEvent;
- (void)setHandlingSendEvent:(BOOL)handlingSendEvent;
- (void)ghostexGpuiCEFSendEvent:(NSEvent*)event;
@end

@implementation NSApplication (GhostexGpuiCEFApplication)
+ (void)load {
  Method originalSendEvent = class_getInstanceMethod(self, @selector(sendEvent:));
  Method cefSendEvent = class_getInstanceMethod(self, @selector(ghostexGpuiCEFSendEvent:));
  if (originalSendEvent && cefSendEvent) {
    method_exchangeImplementations(originalSendEvent, cefSendEvent);
  }
}

- (BOOL)isHandlingSendEvent {
  return g_ghostexGpuiCEFHandlingSendEvent;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  g_ghostexGpuiCEFHandlingSendEvent = handlingSendEvent;
}

- (void)ghostexGpuiCEFSendEvent:(NSEvent*)event {
  /*
   CDXC:GPUIPhase1 2026-06-14-17:25:
   GPUI can keep its address-input focus handle after Chromium has accepted a page click, so AppKit command-key dispatch may never invoke selectAll: on CEF's responder chain. When the active native target is a registered CEF view, mirror only Cmd+A in the existing CEF NSApplication sendEvent hook and call Chromium's Frame::select_all after normal dispatch; GPUI chrome clicks clear that active target before their own text shortcuts run.
   */
  BOOL shouldSelectAllInActiveCEF = GhostexGpuiCEFEventIsCommandA(event);

  BOOL wasHandlingSendEvent = g_ghostexGpuiCEFHandlingSendEvent;
  g_ghostexGpuiCEFHandlingSendEvent = YES;
  @try {
    [self ghostexGpuiCEFSendEvent:event];
  } @finally {
    g_ghostexGpuiCEFHandlingSendEvent = wasHandlingSendEvent;
  }

  if (shouldSelectAllInActiveCEF) {
    GhostexGpuiCEFHandleSelectAllForActiveNativeView();
  }
}
@end

void GhostexGpuiCEFPrepareApplication(void) {
  @autoreleasepool {
    NSUserDefaults* defaults = [NSUserDefaults standardUserDefaults];
    NSMutableDictionary* argumentDefaults =
      [[defaults volatileDomainForName:NSArgumentDomain] mutableCopy] ?: [NSMutableDictionary dictionary];
    /*
     CDXC:GPUIPhase1 2026-06-14-15:25:
     The GPUI CEF shell is launched repeatedly while Chromium embedding is under construction. Disable AppKit's crash-state restoration prompts in the process argument domain so a saved-state modal cannot block the first GPUI frame or the deferred CEF initialization path.
     */
    argumentDefaults[@"ApplePersistenceIgnoreState"] = @YES;
    argumentDefaults[@"NSQuitAlwaysKeepsWindows"] = @NO;
    [defaults setVolatileDomain:argumentDefaults forName:NSArgumentDomain];
  }
}

void GhostexGpuiCEFInstallMessagePump(void) {
  if (g_ghostexGpuiCEFMessagePumpInstalled) {
    return;
  }

  /*
   CDXC:GPUIPhase1 2026-06-14-15:25:
   GPUI owns the AppKit run loop, while cef-rs exposes a single-step CefDoMessageLoopWork pump. Let CEF's BrowserProcessHandler schedule each required step onto the main queue instead of handing the process to CefRunMessageLoop, matching Ghostex's GPUI-safe external-pump model without replacing GPUI's application loop.

   CDXC:GPUIPhase1 2026-06-14-17:38:
   The cef-rs/Tauri external pump does not fire only once. It cancels stale work, caps placeholder delays to a short timer, and reschedules idle work so CEF renderers continue painting React sidebar content and browser pages after startup.
   */
  g_ghostexGpuiCEFMessagePumpInstalled = YES;
  g_ghostexGpuiCEFMessagePumpWorkPending = NO;
  g_ghostexGpuiCEFMessagePumpWorkActive = NO;
  g_ghostexGpuiCEFMessagePumpReentrancyDetected = NO;
  g_ghostexGpuiCEFMessagePumpGeneration += 1;
}

void GhostexGpuiCEFInvalidateMessagePump(void) {
  g_ghostexGpuiCEFMessagePumpInstalled = NO;
  g_ghostexGpuiCEFMessagePumpWorkPending = NO;
  g_ghostexGpuiCEFMessagePumpGeneration += 1;
}

void GhostexGpuiCEFScheduleMessagePumpWork(int64_t delayMs) {
  dispatch_async(dispatch_get_main_queue(), ^{
    GhostexGpuiCEFOnScheduleMessagePumpWork(delayMs);
  });
}

static BOOL GhostexGpuiCEFPerformMessageLoopWork(void) {
  if (g_ghostexGpuiCEFMessagePumpWorkActive) {
    g_ghostexGpuiCEFMessagePumpReentrancyDetected = YES;
    return NO;
  }

  g_ghostexGpuiCEFMessagePumpReentrancyDetected = NO;
  g_ghostexGpuiCEFMessagePumpWorkActive = YES;
  GhostexGpuiCEFDoMessageLoopWork();
  g_ghostexGpuiCEFMessagePumpWorkActive = NO;

  return g_ghostexGpuiCEFMessagePumpReentrancyDetected;
}

static void GhostexGpuiCEFRunScheduledMessagePumpWork(void) {
  if (!g_ghostexGpuiCEFMessagePumpInstalled) {
    return;
  }

  BOOL wasReentrant = GhostexGpuiCEFPerformMessageLoopWork();
  if (wasReentrant) {
    GhostexGpuiCEFScheduleMessagePumpWork(0);
  } else if (!g_ghostexGpuiCEFMessagePumpWorkPending) {
    GhostexGpuiCEFScheduleMessagePumpWork(GhostexGpuiCEFMessagePumpPlaceholderDelayMs);
  }
}

static void GhostexGpuiCEFOnScheduleMessagePumpWork(int64_t delayMs) {
  if (!g_ghostexGpuiCEFMessagePumpInstalled) {
    return;
  }

  if (delayMs == GhostexGpuiCEFMessagePumpPlaceholderDelayMs &&
      g_ghostexGpuiCEFMessagePumpWorkPending) {
    return;
  }

  g_ghostexGpuiCEFMessagePumpGeneration += 1;
  g_ghostexGpuiCEFMessagePumpWorkPending = NO;

  if (delayMs <= 0) {
    GhostexGpuiCEFRunScheduledMessagePumpWork();
    return;
  }

  int64_t clampedDelayMs = delayMs;
  if (clampedDelayMs > GhostexGpuiCEFMessagePumpMaxTimerDelayMs) {
    clampedDelayMs = GhostexGpuiCEFMessagePumpMaxTimerDelayMs;
  }

  g_ghostexGpuiCEFMessagePumpWorkPending = YES;
  uint64_t generation = g_ghostexGpuiCEFMessagePumpGeneration;
  dispatch_time_t when = dispatch_time(DISPATCH_TIME_NOW, clampedDelayMs * NSEC_PER_MSEC);
  dispatch_after(when, dispatch_get_main_queue(), ^{
    if (!g_ghostexGpuiCEFMessagePumpInstalled ||
        !g_ghostexGpuiCEFMessagePumpWorkPending ||
        generation != g_ghostexGpuiCEFMessagePumpGeneration) {
      return;
    }

    g_ghostexGpuiCEFMessagePumpWorkPending = NO;
    GhostexGpuiCEFRunScheduledMessagePumpWork();
  });
}

void GhostexGpuiCEFInstallApplicationHooks(void) {
  if (g_ghostexGpuiCEFApplicationHooksInstalled || !NSApp) {
    return;
  }

  Class appClass = [NSApp class];
  if (!appClass) {
    return;
  }

  /*
   CDXC:GPUIPhase1 2026-06-14-15:25:
   Tauri's CEF runtime makes its NSApplication subclass conform to CefAppProtocol and toggles isHandlingSendEvent during sendEvent:. GPUI must keep GPUIApplication as the concrete app class, so install the same protocol surface and send-event state on GPUIApplication at runtime without changing window layout or input routing.

   CDXC:GPUIPhase1 2026-06-14-16:14:
   Chromium's message_pump_mac.mm traps if CefAppProtocol is missing when NSApplication's run loop is already active. Register the protocol through the NSApplication category above before main, then add the same protocol chain to GPUIApplication for direct conformance checks while leaving the early swizzled sendEvent implementation in place.
   */
  class_addProtocol(appClass, @protocol(CrAppProtocol));
  class_addProtocol(appClass, @protocol(CrAppControlProtocol));
  class_addProtocol(appClass, @protocol(CefAppProtocol));
  GhostexGpuiCEFInstallStandardEditMenu();
  g_ghostexGpuiCEFApplicationHooksInstalled = YES;
}

static NSMenuItem* GhostexGpuiCEFStandardEditMenuItem(NSString* title, SEL action, NSString* keyEquivalent) {
  NSMenuItem* item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:keyEquivalent];
  item.target = nil;
  item.keyEquivalentModifierMask = NSEventModifierFlagCommand;
  return item;
}

static BOOL GhostexGpuiCEFMenuContainsAction(NSMenu* menu, SEL action) {
  for (NSMenuItem* item in menu.itemArray) {
    if (item.action == action) {
      return YES;
    }
  }
  return NO;
}

static void GhostexGpuiCEFInstallStandardEditMenu(void) {
  if (g_ghostexGpuiCEFStandardEditMenuInstalled || !NSApp) {
    return;
  }

  NSMenu* mainMenu = NSApp.mainMenu;
  if (!mainMenu) {
    mainMenu = [[NSMenu alloc] initWithTitle:@""];
    NSApp.mainMenu = mainMenu;
  }

  NSMenu* editMenu = nil;
  for (NSMenuItem* item in mainMenu.itemArray) {
    if ([item.title isEqualToString:@"Edit"] || [item.submenu.title isEqualToString:@"Edit"]) {
      editMenu = item.submenu;
      break;
    }
  }

  if (!editMenu) {
    NSMenuItem* editItem = [[NSMenuItem alloc] initWithTitle:@"Edit" action:nil keyEquivalent:@""];
    editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    editItem.submenu = editMenu;
    NSInteger insertionIndex = mainMenu.numberOfItems > 0 ? 1 : 0;
    [mainMenu insertItem:editItem atIndex:insertionIndex];
  }

  /*
   CDXC:GPUIPhase1 2026-06-14-16:31:
   Web-page inputs inside the embedded CEF browser need macOS standard Edit commands, including Cmd+A Select All. Install first-responder menu actions instead of synthesizing web-specific fallbacks so CEF, AppKit text views, and future browser surfaces receive the platform's normal text-command dispatch.
   */
  if (!GhostexGpuiCEFMenuContainsAction(editMenu, @selector(undo:))) {
    [editMenu addItem:GhostexGpuiCEFStandardEditMenuItem(@"Undo", @selector(undo:), @"z")];
  }
  if (!GhostexGpuiCEFMenuContainsAction(editMenu, @selector(redo:))) {
    NSMenuItem* redo = GhostexGpuiCEFStandardEditMenuItem(@"Redo", @selector(redo:), @"Z");
    redo.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    [editMenu addItem:redo];
  }
  if (!GhostexGpuiCEFMenuContainsAction(editMenu, @selector(cut:)) ||
      !GhostexGpuiCEFMenuContainsAction(editMenu, @selector(selectAll:))) {
    [editMenu addItem:[NSMenuItem separatorItem]];
  }
  if (!GhostexGpuiCEFMenuContainsAction(editMenu, @selector(cut:))) {
    [editMenu addItem:GhostexGpuiCEFStandardEditMenuItem(@"Cut", @selector(cut:), @"x")];
  }
  if (!GhostexGpuiCEFMenuContainsAction(editMenu, @selector(copy:))) {
    [editMenu addItem:GhostexGpuiCEFStandardEditMenuItem(@"Copy", @selector(copy:), @"c")];
  }
  if (!GhostexGpuiCEFMenuContainsAction(editMenu, @selector(paste:))) {
    [editMenu addItem:GhostexGpuiCEFStandardEditMenuItem(@"Paste", @selector(paste:), @"v")];
  }
  if (!GhostexGpuiCEFMenuContainsAction(editMenu, @selector(selectAll:))) {
    [editMenu addItem:GhostexGpuiCEFStandardEditMenuItem(@"Select All", @selector(selectAll:), @"a")];
  }

  g_ghostexGpuiCEFStandardEditMenuInstalled = YES;
}

void GhostexGpuiCEFSetNativeViewFrame(
  void* nativeView,
  double x,
  double y,
  double width,
  double height) {
  NSView* view = (__bridge NSView*)nativeView;
  if (!view) {
    return;
  }

  NSView* parent = [view superview];
  CGFloat nativeY = y;
  if (parent && ![parent isFlipped]) {
    nativeY = NSHeight(parent.bounds) - y - height;
  }
  view.frame = NSMakeRect(x, nativeY, MAX(0.0, width), MAX(0.0, height));
}

void GhostexGpuiCEFSetNativeViewVisible(void* nativeView, bool visible) {
  NSView* view = (__bridge NSView*)nativeView;
  if (!view) {
    return;
  }
  view.hidden = visible ? NO : YES;
}

void GhostexGpuiCEFPrepareNativeViewForFocus(void* nativeView) {
  NSView* view = (__bridge NSView*)nativeView;
  if (!view) {
    return;
  }

  /*
   CDXC:GPUIPhase1 2026-06-14-16:45:
   Browser clicks land on CEF's native child view, not always on GPUI's hitbox tree. Make the exact CEF NSView accept first responder and claim it on mouseDown before forwarding the event, so macOS command-key text actions route to Chromium after the user leaves the GPUI address bar.
   */
  GhostexGpuiCEFInstallBrowserViewFocusSubclassInTree(view);
}

static void GhostexGpuiCEFInstallBrowserViewFocusSubclassInTree(NSView* view) {
  if (!view) {
    return;
  }

  GhostexGpuiCEFInstallBrowserViewFocusSubclass(view);
  for (NSView* subview in view.subviews) {
    GhostexGpuiCEFInstallBrowserViewFocusSubclassInTree(subview);
  }
}

static void GhostexGpuiCEFInstallBrowserViewFocusSubclass(NSView* view) {
  Class originalClass = object_getClass(view);
  if (!originalClass) {
    return;
  }

  const char* originalName = class_getName(originalClass);
  if (strncmp(originalName, "GhostexGpuiCEFFocus_", 21) == 0) {
    return;
  }

  NSString* subclassName = [NSString stringWithFormat:@"GhostexGpuiCEFFocus_%s", originalName];
  Class subclass = NSClassFromString(subclassName);
  if (!subclass) {
    subclass = objc_allocateClassPair(originalClass, subclassName.UTF8String, 0);
    if (!subclass) {
      return;
    }

    class_addMethod(
      subclass,
      @selector(mouseDown:),
      (IMP)GhostexGpuiCEFBrowserViewMouseDown,
      "v@:@");
    class_addMethod(
      subclass,
      @selector(acceptsFirstResponder),
      (IMP)GhostexGpuiCEFBrowserViewAcceptsFirstResponder,
      "c@:");
    class_addMethod(
      subclass,
      @selector(selectAll:),
      (IMP)GhostexGpuiCEFBrowserViewSelectAll,
      "v@:@");
    class_addMethod(
      subclass,
      @selector(performKeyEquivalent:),
      (IMP)GhostexGpuiCEFBrowserViewPerformKeyEquivalent,
      "c@:@");
    class_addMethod(
      subclass,
      @selector(addSubview:),
      (IMP)GhostexGpuiCEFBrowserViewAddSubview,
      "v@:@");
    objc_registerClassPair(subclass);
  }

  object_setClass(view, subclass);
}

static void GhostexGpuiCEFBrowserViewMouseDown(id self, SEL _cmd, NSEvent* event) {
  NSWindow* window = [self window];
  if (window) {
    [window makeFirstResponder:self];
  }
  GhostexGpuiCEFMarkFocusedResponder(self);

  struct objc_super superInfo = {
    .receiver = self,
    .super_class = class_getSuperclass(object_getClass(self)),
  };
  void (*sendSuper)(struct objc_super*, SEL, NSEvent*) = (void*)objc_msgSendSuper;
  sendSuper(&superInfo, _cmd, event);
}

static BOOL GhostexGpuiCEFBrowserViewAcceptsFirstResponder(id self, SEL _cmd) {
  (void)self;
  (void)_cmd;
  return YES;
}

static void GhostexGpuiCEFBrowserViewSelectAll(id self, SEL _cmd, id sender) {
  /*
   CDXC:GPUIPhase1 2026-06-14-17:25:
   Cmd+A in focused CEF page text fields must stay inside Chromium after the GPUI address bar has previously owned focus. Implement the standard AppKit selectAll: command on the exact CEF NSView and delegate to cef-rs Frame::select_all, so macOS command dispatch uses Chromium selection semantics without a hidden hit-test layer or page-specific fallback.

   CDXC:GPUIPhase1 2026-06-14-17:25:
   CEF can deliver page clicks to descendant NSViews below the browser host returned by cef-rs. Install the focus subclass on the CEF view tree and resolve selectAll: by walking ancestor views back to the registered browser root, so command-key focus follows the actual Chromium child that received the click.
   */
  if (GhostexGpuiCEFHandleSelectAllForResponder(self)) {
    return;
  }

  Class superClass = class_getSuperclass(object_getClass(self));
  if (superClass && class_getInstanceMethod(superClass, _cmd)) {
    struct objc_super superInfo = {
      .receiver = self,
      .super_class = superClass,
    };
    void (*sendSuper)(struct objc_super*, SEL, id) = (void*)objc_msgSendSuper;
    sendSuper(&superInfo, _cmd, sender);
  }
}

static BOOL GhostexGpuiCEFBrowserViewPerformKeyEquivalent(id self, SEL _cmd, NSEvent* event) {
  if (GhostexGpuiCEFEventIsCommandA(event) &&
      GhostexGpuiCEFHandleSelectAllForResponder(self)) {
    return YES;
  }

  struct objc_super superInfo = {
    .receiver = self,
    .super_class = class_getSuperclass(object_getClass(self)),
  };
  BOOL (*sendSuper)(struct objc_super*, SEL, NSEvent*) = (void*)objc_msgSendSuper;
  return sendSuper(&superInfo, _cmd, event);
}

static void GhostexGpuiCEFBrowserViewAddSubview(id self, SEL _cmd, NSView* subview) {
  struct objc_super superInfo = {
    .receiver = self,
    .super_class = class_getSuperclass(object_getClass(self)),
  };
  void (*sendSuper)(struct objc_super*, SEL, NSView*) = (void*)objc_msgSendSuper;
  sendSuper(&superInfo, _cmd, subview);
  GhostexGpuiCEFInstallBrowserViewFocusSubclassInTree(subview);
}

static BOOL GhostexGpuiCEFEventIsCommandA(NSEvent* event) {
  if (!event || event.type != NSEventTypeKeyDown) {
    return NO;
  }

  NSEventModifierFlags modifiers = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if ((modifiers & NSEventModifierFlagCommand) == 0) {
    return NO;
  }

  modifiers &= ~NSEventModifierFlagCommand;
  if (modifiers != 0) {
    return NO;
  }

  return [event.charactersIgnoringModifiers.lowercaseString isEqualToString:@"a"];
}

static BOOL GhostexGpuiCEFHandleSelectAllForResponder(id responder) {
  if (![responder isKindOfClass:NSView.class]) {
    return NO;
  }

  for (NSView* view = (NSView*)responder; view; view = view.superview) {
    if (GhostexGpuiCEFHandleSelectAllForNativeView((__bridge void*)view)) {
      return YES;
    }
  }
  return NO;
}

static void GhostexGpuiCEFMarkFocusedResponder(id responder) {
  if (![responder isKindOfClass:NSView.class]) {
    return;
  }

  for (NSView* view = (NSView*)responder; view; view = view.superview) {
    if (GhostexGpuiCEFMarkNativeViewFocused((__bridge void*)view)) {
      return;
    }
  }
}

void GhostexGpuiCEFFocusNativeView(void* nativeView) {
  NSView* view = (__bridge NSView*)nativeView;
  if (!view) {
    return;
  }

  NSWindow* window = view.window;
  if (!window) {
    return;
  }

  /*
   CDXC:GPUIPhase1 2026-06-14-18:05:
   CEF child views can remain the AppKit first responder after browser interaction. When the GPUI-owned address bar is clicked, return first-responder ownership to the exact GPUI parent view before focusing the GPUI input so typed keys edit the address field instead of continuing into Chromium.
   */
  if (!GhostexGpuiCEFMarkNativeViewFocused(nativeView)) {
    GhostexGpuiCEFClearActiveNativeView();
  }
  [window makeFirstResponder:view];
}
