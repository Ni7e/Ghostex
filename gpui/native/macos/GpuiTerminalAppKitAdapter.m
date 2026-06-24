#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <stdbool.h>

/*
 CDXC:GPUTerminalAppKitAdapter 2026-06-22-20:58:
 Future real terminal adapters must supply the existing AppKit terminal NSView. This GPUI-local boundary may only position, show, hide, or focus that non-null view using exact terminal body bounds and the parent view's flipped-coordinate convention; it must not create terminal views, transparent overlays, hit-test routing, synthetic input routing, terminal processes, GhosttyKit calls, or persistent logs.

 CDXC:GPUTerminalAppKitAdapter 2026-06-22-21:42:
 Slice 108 creates only the terminal host NSView ownership boundary: an explicit parent NSView receives one normal hidden black child inside GPUI's measured terminal body bounds. The child view must remain ordinary AppKit layout, with no overlays, broad hitTest overrides, synthetic event routing, transparent hidden hit regions, Ghostty/libghostty calls, process lifecycle, logging, or app wiring.

 CDXC:GPUTerminalAppKitAdapter 2026-06-22-23:11:
 Slice 115 first-responder handoff may call `makeFirstResponder` only for the exact App-owned terminal host NSView supplied by Rust after a real focused Agents Ghostty surface is mounted. Do not expand this shim into hit-test overrides, pre-dispatch routing, synthetic input, transparent overlays, terminal lifecycle, logging, or fallback view creation.
 */
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

  NSView* hostView = [[NSView alloc] initWithFrame:GhostexGpuiTerminalFrameInParent(
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
