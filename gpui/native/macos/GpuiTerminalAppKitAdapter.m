#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <QuartzCore/QuartzCore.h>
#import <stdint.h>
#import <stdbool.h>

enum {
  GhostexGpuiGhosttyModsNone = 0,
  GhostexGpuiGhosttyModsShift = 1 << 0,
  GhostexGpuiGhosttyModsCtrl = 1 << 1,
  GhostexGpuiGhosttyModsAlt = 1 << 2,
  GhostexGpuiGhosttyModsSuper = 1 << 3,
  GhostexGpuiGhosttyModsCaps = 1 << 4,
  GhostexGpuiGhosttyModsShiftRight = 1 << 6,
  GhostexGpuiGhosttyModsCtrlRight = 1 << 7,
  GhostexGpuiGhosttyModsAltRight = 1 << 8,
  GhostexGpuiGhosttyModsSuperRight = 1 << 9,
};

enum {
  GhostexGpuiGhosttyActionRelease = 0,
  GhostexGpuiGhosttyActionPress = 1,
  GhostexGpuiGhosttyActionRepeat = 2,
};

extern int GhostexGpuiTerminalNativeViewKeyTranslationMods(void* nativeView, int mods);
extern int GhostexGpuiTerminalHandleNativeKeyEvent(
  void* nativeView,
  int action,
  int mods,
  int consumedMods,
  uint32_t keycode,
  const char* text,
  uint32_t unshiftedCodepoint,
  int composing);

/*
 CDXC:GPUTerminalAppKitAdapter 2026-06-22-20:58:
 Future real terminal adapters must supply the existing AppKit terminal NSView. This GPUI-local boundary may only position, show, hide, or focus that non-null view using exact terminal body bounds and the parent view's flipped-coordinate convention; it must not create terminal views, transparent overlays, hit-test routing, synthetic input routing, terminal processes, GhosttyKit calls, or persistent logs.

 CDXC:GPUTerminalAppKitAdapter 2026-06-22-21:42:
 Slice 108 creates only the terminal host NSView ownership boundary: an explicit parent NSView receives one normal hidden black child inside GPUI's measured terminal body bounds. The child view must remain ordinary AppKit layout, with no overlays, broad hitTest overrides, synthetic event routing, transparent hidden hit regions, Ghostty/libghostty calls, process lifecycle, logging, or app wiring.

 CDXC:GPUTerminalAppKitAdapter 2026-06-22-23:11:
 Slice 115 first-responder handoff may call `makeFirstResponder` only for the exact App-owned terminal host NSView supplied by Rust after a real focused Agents Ghostty surface is mounted. Do not expand this shim into hit-test overrides, pre-dispatch routing, synthetic input, transparent overlays, terminal lifecycle, logging, or fallback view creation.

 CDXC:GPUITerminalNativeKeyBridge 2026-06-24-20:58:
 The GPUI host view is the exact AppKit responder for mounted Ghostty terminals because GPUI key events do not expose the native macOS keycode required for Return, Backspace, arrows, modifiers, and bindings. Forward only synchronous key primitives from this child view to Rust; do not add root/window routing, transparent overlays, hit-test overrides, command text logging, terminal-content capture, or persistent state.
 */
static int GhostexGpuiTerminalGhosttyMods(NSEventModifierFlags flags) {
  int mods = GhostexGpuiGhosttyModsNone;

  if ((flags & NSEventModifierFlagShift) != 0) mods |= GhostexGpuiGhosttyModsShift;
  if ((flags & NSEventModifierFlagControl) != 0) mods |= GhostexGpuiGhosttyModsCtrl;
  if ((flags & NSEventModifierFlagOption) != 0) mods |= GhostexGpuiGhosttyModsAlt;
  if ((flags & NSEventModifierFlagCommand) != 0) mods |= GhostexGpuiGhosttyModsSuper;
  if ((flags & NSEventModifierFlagCapsLock) != 0) mods |= GhostexGpuiGhosttyModsCaps;

  if ((flags & NX_DEVICERSHIFTKEYMASK) != 0) mods |= GhostexGpuiGhosttyModsShiftRight;
  if ((flags & NX_DEVICERCTLKEYMASK) != 0) mods |= GhostexGpuiGhosttyModsCtrlRight;
  if ((flags & NX_DEVICERALTKEYMASK) != 0) mods |= GhostexGpuiGhosttyModsAltRight;
  if ((flags & NX_DEVICERCMDKEYMASK) != 0) mods |= GhostexGpuiGhosttyModsSuperRight;

  return mods;
}

static NSEventModifierFlags GhostexGpuiTerminalTranslatedModifierFlags(
  NSEventModifierFlags originalFlags,
  int translatedMods) {
  NSEventModifierFlags flags = originalFlags;

  if ((translatedMods & GhostexGpuiGhosttyModsShift) != 0) {
    flags |= NSEventModifierFlagShift;
  } else {
    flags &= ~NSEventModifierFlagShift;
  }
  if ((translatedMods & GhostexGpuiGhosttyModsCtrl) != 0) {
    flags |= NSEventModifierFlagControl;
  } else {
    flags &= ~NSEventModifierFlagControl;
  }
  if ((translatedMods & GhostexGpuiGhosttyModsAlt) != 0) {
    flags |= NSEventModifierFlagOption;
  } else {
    flags &= ~NSEventModifierFlagOption;
  }
  if ((translatedMods & GhostexGpuiGhosttyModsSuper) != 0) {
    flags |= NSEventModifierFlagCommand;
  } else {
    flags &= ~NSEventModifierFlagCommand;
  }

  return flags;
}

static uint32_t GhostexGpuiTerminalFirstUnicodeScalar(NSString* value) {
  if (value.length == 0) {
    return 0;
  }

  unichar first = [value characterAtIndex:0];
  if (CFStringIsSurrogateHighCharacter(first) && value.length > 1) {
    unichar second = [value characterAtIndex:1];
    if (CFStringIsSurrogateLowCharacter(second)) {
      return (uint32_t)CFStringGetLongCharacterForSurrogatePair(first, second);
    }
  }

  return (uint32_t)first;
}

static uint32_t GhostexGpuiTerminalUnshiftedCodepoint(NSEvent* event) {
  if (event.type != NSEventTypeKeyDown && event.type != NSEventTypeKeyUp) {
    return 0;
  }

  NSString* characters = [event charactersByApplyingModifiers:0];
  return GhostexGpuiTerminalFirstUnicodeScalar(characters);
}

static NSString* GhostexGpuiTerminalCharactersForEvent(
  NSEvent* event,
  NSEventModifierFlags translationFlags) {
  NSString* characters = nil;
  if (translationFlags == event.modifierFlags) {
    characters = event.characters;
  } else {
    characters = [event charactersByApplyingModifiers:translationFlags];
  }
  if (characters.length == 0) {
    return nil;
  }

  uint32_t scalar = GhostexGpuiTerminalFirstUnicodeScalar(characters);
  if (characters.length == 1 && scalar < 0x20) {
    return [event charactersByApplyingModifiers:(translationFlags & ~NSEventModifierFlagControl)];
  }
  if (characters.length == 1 && scalar >= 0xF700 && scalar <= 0xF8FF) {
    return nil;
  }

  return characters;
}

static const char* GhostexGpuiTerminalKeyTextCString(NSString* text) {
  if (text.length == 0) {
    return NULL;
  }

  const char* value = text.UTF8String;
  if (!value || ((unsigned char)value[0]) < 0x20) {
    return NULL;
  }
  return value;
}

@interface GhostexGpuiTerminalHostView : NSView
@end

@implementation GhostexGpuiTerminalHostView

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (BOOL)canBecomeKeyView {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent*)event {
  (void)event;
  return YES;
}

- (void)keyDown:(NSEvent*)event {
  int mods = GhostexGpuiTerminalGhosttyMods(event.modifierFlags);
  int translatedMods = GhostexGpuiTerminalNativeViewKeyTranslationMods((__bridge void*)self, mods);
  NSEventModifierFlags translationFlags =
    GhostexGpuiTerminalTranslatedModifierFlags(event.modifierFlags, translatedMods);
  NSString* text = GhostexGpuiTerminalCharactersForEvent(event, translationFlags);
  int consumedMods = GhostexGpuiTerminalGhosttyMods(
    translationFlags & ~(NSEventModifierFlagControl | NSEventModifierFlagCommand));
  int action = event.isARepeat ? GhostexGpuiGhosttyActionRepeat : GhostexGpuiGhosttyActionPress;
  const char* textValue = GhostexGpuiTerminalKeyTextCString(text);

  if (GhostexGpuiTerminalHandleNativeKeyEvent(
        (__bridge void*)self,
        action,
        mods,
        consumedMods,
        (uint32_t)event.keyCode,
        textValue,
        GhostexGpuiTerminalUnshiftedCodepoint(event),
        0) != 0) {
    return;
  }

  [super keyDown:event];
}

- (void)keyUp:(NSEvent*)event {
  if (GhostexGpuiTerminalHandleNativeKeyEvent(
        (__bridge void*)self,
        GhostexGpuiGhosttyActionRelease,
        GhostexGpuiTerminalGhosttyMods(event.modifierFlags),
        GhostexGpuiTerminalGhosttyMods(
          event.modifierFlags & ~(NSEventModifierFlagControl | NSEventModifierFlagCommand)),
        (uint32_t)event.keyCode,
        NULL,
        GhostexGpuiTerminalUnshiftedCodepoint(event),
        0) != 0) {
    return;
  }

  [super keyUp:event];
}

- (void)flagsChanged:(NSEvent*)event {
  int mod = GhostexGpuiGhosttyModsNone;
  switch (event.keyCode) {
    case 0x39:
      mod = GhostexGpuiGhosttyModsCaps;
      break;
    case 0x38:
    case 0x3C:
      mod = GhostexGpuiGhosttyModsShift;
      break;
    case 0x3B:
    case 0x3E:
      mod = GhostexGpuiGhosttyModsCtrl;
      break;
    case 0x3A:
    case 0x3D:
      mod = GhostexGpuiGhosttyModsAlt;
      break;
    case 0x37:
    case 0x36:
      mod = GhostexGpuiGhosttyModsSuper;
      break;
    default:
      [super flagsChanged:event];
      return;
  }

  int mods = GhostexGpuiTerminalGhosttyMods(event.modifierFlags);
  int action = GhostexGpuiGhosttyActionRelease;
  if ((mods & mod) != 0) {
    bool sidePressed = true;
    switch (event.keyCode) {
      case 0x3C:
        sidePressed = (event.modifierFlags & NX_DEVICERSHIFTKEYMASK) != 0;
        break;
      case 0x3E:
        sidePressed = (event.modifierFlags & NX_DEVICERCTLKEYMASK) != 0;
        break;
      case 0x3D:
        sidePressed = (event.modifierFlags & NX_DEVICERALTKEYMASK) != 0;
        break;
      case 0x36:
        sidePressed = (event.modifierFlags & NX_DEVICERCMDKEYMASK) != 0;
        break;
      default:
        break;
    }
    if (sidePressed) {
      action = GhostexGpuiGhosttyActionPress;
    }
  }

  if (GhostexGpuiTerminalHandleNativeKeyEvent(
        (__bridge void*)self,
        action,
        mods,
        GhostexGpuiTerminalGhosttyMods(
          event.modifierFlags & ~(NSEventModifierFlagControl | NSEventModifierFlagCommand)),
        (uint32_t)event.keyCode,
        NULL,
        0,
        0) != 0) {
    return;
  }

  [super flagsChanged:event];
}

@end

static NSRect GhostexGpuiTerminalFrameInParent(
  NSView* parent,
  double x,
  double y,
  double width,
  double height) {
  CGFloat nativeWidth = MAX((CGFloat)0.0, (CGFloat)width);
  CGFloat nativeHeight = MAX((CGFloat)0.0, (CGFloat)height);
  CGFloat nativeY = (CGFloat)y;
  if (parent && ![parent isFlipped]) {
    nativeY = NSHeight(parent.bounds) - (CGFloat)y - nativeHeight;
  }

  return NSMakeRect((CGFloat)x, nativeY, nativeWidth, nativeHeight);
}

void* GhostexGpuiTerminalCreateHostNativeView(
  void* parentView,
  double x,
  double y,
  double width,
  double height) {
  NSView* parent = (__bridge NSView*)parentView;
  if (!parent) {
    return NULL;
  }

  NSView* hostView = [[GhostexGpuiTerminalHostView alloc] initWithFrame:GhostexGpuiTerminalFrameInParent(
    parent,
    x,
    y,
    width,
    height)];
  hostView.hidden = YES;
  hostView.wantsLayer = YES;
  hostView.layer.backgroundColor = [NSColor blackColor].CGColor;
  [parent addSubview:hostView];

  return (__bridge_retained void*)hostView;
}

void GhostexGpuiTerminalDestroyHostNativeView(void* nativeView) {
  if (!nativeView) {
    return;
  }

  NSView* view = (__bridge_transfer NSView*)nativeView;
  [view removeFromSuperview];
}

void GhostexGpuiTerminalSetNativeViewFrame(
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
  view.frame = GhostexGpuiTerminalFrameInParent(parent, x, y, width, height);
}

void GhostexGpuiTerminalShowNativeView(void* nativeView) {
  NSView* view = (__bridge NSView*)nativeView;
  if (!view) {
    return;
  }

  view.hidden = NO;
}

void GhostexGpuiTerminalHideNativeView(void* nativeView) {
  NSView* view = (__bridge NSView*)nativeView;
  if (!view) {
    return;
  }

  view.hidden = YES;
}

void GhostexGpuiTerminalFocusNativeView(void* nativeView) {
  NSView* view = (__bridge NSView*)nativeView;
  if (!view) {
    return;
  }

  NSWindow* window = [view window];
  if (!window) {
    return;
  }

  [window makeFirstResponder:view];
}
