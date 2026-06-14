#import "GhostexCEFBridge.h"

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <objc/runtime.h>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/wrapper/cef_library_loader.h"

#include <memory>

static NSTimer* g_ghostexGpuiCEFMessagePumpTimer = nil;
static bool g_ghostexGpuiCEFApplicationHooksInstalled = false;
static std::unique_ptr<CefScopedLibraryLoader> g_ghostexGpuiCEFLibraryLoader;
static IMP g_ghostexGpuiCEFOriginalSendEvent = nil;
static BOOL g_ghostexGpuiCEFHandlingSendEvent = NO;

static NSString* GhostexGpuiNSStringFromCString(const char* value) {
  if (!value) {
    return @"";
  }
  return [NSString stringWithUTF8String:value] ?: @"";
}

extern "C" void GhostexGpuiCEFPrepareApplication(void) {
  @autoreleasepool {
    NSUserDefaults* defaults = [NSUserDefaults standardUserDefaults];
    NSMutableDictionary* argumentDefaults =
      [[defaults volatileDomainForName:NSArgumentDomain] mutableCopy] ?: [NSMutableDictionary dictionary];
    /*
     CDXC:GPUIPhase1 2026-06-14-13:11:
     The phase-1 bundle is repeatedly launched after expected crash/debug cycles while CEF integration is under construction. Disable AppKit persistent UI restoration in the process argument domain so a crash-history "ignore saved state" modal cannot block GPUI's launch callback before CEF initializes, without writing a persistent user default.
     */
    argumentDefaults[@"ApplePersistenceIgnoreState"] = @YES;
    argumentDefaults[@"NSQuitAlwaysKeepsWindows"] = @NO;
    [defaults setVolatileDomain:argumentDefaults forName:NSArgumentDomain];
  }
}

extern "C" void GhostexGpuiCEFInstallMessagePump(void) {
  if (g_ghostexGpuiCEFMessagePumpTimer) {
    return;
  }

  /*
   CDXC:GPUIPhase1 2026-06-14-12:06:
   GPUI owns the AppKit run loop for the phase-1 shell, while the reused CEF bridge was written for Ghostex's CefRunMessageLoop entrypoint. Drive CefDoMessageLoopWork from the main run loop so CEF remains the browser engine without replacing GPUI's application loop.
   */
  g_ghostexGpuiCEFMessagePumpTimer = [NSTimer timerWithTimeInterval:0.01
                                                            repeats:YES
                                                              block:^(__unused NSTimer* timer) {
                                                                CefDoMessageLoopWork();
                                                              }];
  [[NSRunLoop mainRunLoop] addTimer:g_ghostexGpuiCEFMessagePumpTimer forMode:NSRunLoopCommonModes];
}

extern "C" bool GhostexGpuiCEFLoadFramework(void) {
  if (g_ghostexGpuiCEFLibraryLoader) {
    return true;
  }

  auto loader = std::make_unique<CefScopedLibraryLoader>();
  /*
   CDXC:GPUIPhase1 2026-06-14-12:43:
   The GPUI shell links the CEF wrapper directly from Rust's build script, so the generated C API function pointers are unset until the Chromium Embedded Framework is explicitly loaded from the app bundle. Load the framework before calling GhostexCEFInitialize so the phase-1 shell starts Chromium correctly instead of reaching a null CEF entrypoint.
   */
  if (!loader->LoadInMain()) {
    return false;
  }
  g_ghostexGpuiCEFLibraryLoader = std::move(loader);
  return true;
}

static void GhostexGpuiCEFSendEvent(id self, SEL command, NSEvent* event) {
  CefScopedSendingEvent sendingEventScoper;
  if (g_ghostexGpuiCEFOriginalSendEvent) {
    ((void (*)(id, SEL, NSEvent*))g_ghostexGpuiCEFOriginalSendEvent)(self, command, event);
  }
}

static BOOL GhostexGpuiCEFIsHandlingSendEvent(id self, SEL _command) {
  return g_ghostexGpuiCEFHandlingSendEvent;
}

static void GhostexGpuiCEFSetHandlingSendEvent(id self, SEL _command, BOOL handling) {
  g_ghostexGpuiCEFHandlingSendEvent = handling;
}

extern "C" void GhostexGpuiCEFInstallApplicationHooks(void) {
  if (g_ghostexGpuiCEFApplicationHooksInstalled || !NSApp) {
    return;
  }
  Class appClass = [NSApp class];
  if (!appClass || ![NSStringFromClass(appClass) isEqualToString:@"GPUIApplication"]) {
    return;
  }

  /*
   CDXC:GPUIPhase1 2026-06-14-12:06:
   CEF's normal macOS integration subclasses NSApplication, but GPUI must keep its own GPUIApplication class. Add only CEF's sendEvent scope hook to GPUIApplication so mouse and keyboard events enter CEF correctly without replacing GPUI's application object or touching native layout/hit-testing.

   CDXC:GPUIPhase1 2026-06-14-12:58:
   CefScopedSendingEvent also requires the CefAppProtocol send-event state accessors that production Ghostex stores on GhostexCEFApplication. Install those methods on GPUIApplication with process-local state so CEF receives the protocol it expects while GPUI retains ownership of the application subclass and platform ivars.

   CDXC:GPUIPhase1 2026-06-14-13:01:
   GPUIApplication inherits NSApplication's sendEvent implementation. Capture that inherited IMP before installing the CEF hook and call it directly so the hook cannot recurse through Objective-C super dispatch while Chromium is processing nested AppKit events.
   */
  class_addProtocol(appClass, @protocol(CefAppProtocol));
  class_addMethod(appClass, @selector(isHandlingSendEvent), (IMP)GhostexGpuiCEFIsHandlingSendEvent, "c@:");
  class_addMethod(appClass, @selector(setHandlingSendEvent:), (IMP)GhostexGpuiCEFSetHandlingSendEvent, "v@:c");
  Method sendEventMethod = class_getInstanceMethod(appClass, @selector(sendEvent:));
  g_ghostexGpuiCEFOriginalSendEvent = sendEventMethod ? method_getImplementation(sendEventMethod) : nil;
  class_addMethod(appClass, @selector(sendEvent:), (IMP)GhostexGpuiCEFSendEvent, "v@:@");
  g_ghostexGpuiCEFApplicationHooksInstalled = true;
}

extern "C" void* GhostexGpuiCEFCreateBrowserView(
  void* parent,
  const char* url,
  const char* profileIdentifier) {
  NSView* parentView = (__bridge NSView*)parent;
  if (!parentView) {
    return nil;
  }

  NSString* initialURL = GhostexGpuiNSStringFromCString(url);
  NSString* profile = GhostexGpuiNSStringFromCString(profileIdentifier);
  GhostexCEFBrowserView* browserView = [[GhostexCEFBrowserView alloc] initWithFrame:NSZeroRect
                                                                         initialURL:initialURL
                                                                  profileIdentifier:profile];
  browserView.translatesAutoresizingMaskIntoConstraints = YES;
  browserView.autoresizingMask = NSViewNotSizable;
  browserView.hidden = NO;
  [parentView addSubview:browserView];
  [browserView setNeedsLayout:YES];
  return (__bridge_retained void*)browserView;
}

extern "C" void GhostexGpuiCEFSetBrowserFrame(
  void* browser,
  double x,
  double y,
  double width,
  double height) {
  GhostexCEFBrowserView* browserView = (__bridge GhostexCEFBrowserView*)browser;
  if (!browserView) {
    return;
  }
  browserView.frame = NSMakeRect(x, y, MAX(0.0, width), MAX(0.0, height));
  [browserView pinHostedViewToBounds];
}

extern "C" void GhostexGpuiCEFSetBrowserVisible(void* browser, bool visible) {
  GhostexCEFBrowserView* browserView = (__bridge GhostexCEFBrowserView*)browser;
  if (!browserView) {
    return;
  }
  browserView.hidden = visible ? NO : YES;
}

extern "C" void GhostexGpuiCEFLoadURL(void* browser, const char* url) {
  GhostexCEFBrowserView* browserView = (__bridge GhostexCEFBrowserView*)browser;
  if (!browserView) {
    return;
  }
  [browserView loadURLString:GhostexGpuiNSStringFromCString(url)];
}

extern "C" void GhostexGpuiCEFReleaseBrowserView(void* browser) {
  if (!browser) {
    return;
  }
  GhostexCEFBrowserView* browserView = (__bridge_transfer GhostexCEFBrowserView*)browser;
  [browserView closeBrowser];
  [browserView removeFromSuperview];
}
