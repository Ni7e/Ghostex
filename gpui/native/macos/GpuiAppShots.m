#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#import <math.h>
#import <stdint.h>

extern int32_t GhostexGpuiAppShotsSettingsEnabled(void);
extern int32_t GhostexGpuiAppShotsSettingsHotkey(void);
extern void GhostexGpuiAppShotsCaptureSucceeded(
    const char *app_name,
    const char *bundle_identifier,
    const char *image_path,
    const char *window_title,
    int32_t window_width,
    int32_t window_height,
    const char *trigger);
extern void GhostexGpuiAppShotsCaptureFailed(const char *message);

typedef NS_ENUM(int32_t, GhostexGpuiAppShotsHotkey) {
  GhostexGpuiAppShotsHotkeyBothCommand = 0,
  GhostexGpuiAppShotsHotkeyDoubleLeftShift = 1,
  GhostexGpuiAppShotsHotkeyDoubleLeftOption = 2,
};

static const NSTimeInterval GhostexGpuiAppShotsDoubleTapThresholdSeconds = 0.45;
static const NSTimeInterval GhostexGpuiAppShotsCaptureCooldownSeconds = 0.9;
static const unsigned short GhostexGpuiAppShotsLeftShiftKeyCode = 56;
static const unsigned short GhostexGpuiAppShotsLeftOptionKeyCode = 58;
static const unsigned short GhostexGpuiAppShotsRightCommandKeyCode = 54;
static const unsigned short GhostexGpuiAppShotsLeftCommandKeyCode = 55;

static id GhostexGpuiAppShotsLocalMonitor = nil;
static id GhostexGpuiAppShotsGlobalMonitor = nil;
static NSMutableSet<NSNumber *> *GhostexGpuiAppShotsPressedCommandKeyCodes = nil;
static NSTimeInterval GhostexGpuiAppShotsLastLeftShiftTap = 0.0;
static NSTimeInterval GhostexGpuiAppShotsLastLeftOptionTap = 0.0;
static NSTimeInterval GhostexGpuiAppShotsLastCapture = 0.0;

static NSString *GhostexGpuiAppShotsDisplayPath(NSString *path) {
  NSString *home = NSHomeDirectory();
  if ([path isEqualToString:home]) {
    return @"~";
  }
  NSString *homePrefix = [home stringByAppendingString:@"/"];
  if ([path hasPrefix:homePrefix]) {
    return [@"~/" stringByAppendingString:[path substringFromIndex:homePrefix.length]];
  }
  return path;
}

static void GhostexGpuiAppShotsResetState(void) {
  [GhostexGpuiAppShotsPressedCommandKeyCodes removeAllObjects];
  GhostexGpuiAppShotsLastLeftShiftTap = 0.0;
  GhostexGpuiAppShotsLastLeftOptionTap = 0.0;
}

static BOOL GhostexGpuiAppShotsShouldTriggerDoubleTap(
    NSEvent *event,
    unsigned short keyCode,
    NSEventModifierFlags modifierFlag,
    NSTimeInterval *lastTap) {
  if (event.keyCode != keyCode || (event.modifierFlags & modifierFlag) == 0) {
    return NO;
  }

  NSTimeInterval timestamp = event.timestamp;
  BOOL triggered = *lastTap > 0.0 &&
                   timestamp - *lastTap <= GhostexGpuiAppShotsDoubleTapThresholdSeconds;
  *lastTap = timestamp;
  return triggered;
}

static BOOL GhostexGpuiAppShotsShouldTriggerBothCommand(NSEvent *event) {
  if (event.keyCode != GhostexGpuiAppShotsLeftCommandKeyCode &&
      event.keyCode != GhostexGpuiAppShotsRightCommandKeyCode) {
    return NO;
  }

  NSNumber *keyCode = @(event.keyCode);
  if ((event.modifierFlags & NSEventModifierFlagCommand) != 0) {
    [GhostexGpuiAppShotsPressedCommandKeyCodes addObject:keyCode];
  } else {
    [GhostexGpuiAppShotsPressedCommandKeyCodes removeObject:keyCode];
  }

  BOOL triggered =
      [GhostexGpuiAppShotsPressedCommandKeyCodes containsObject:@(GhostexGpuiAppShotsLeftCommandKeyCode)] &&
      [GhostexGpuiAppShotsPressedCommandKeyCodes containsObject:@(GhostexGpuiAppShotsRightCommandKeyCode)];
  if (triggered) {
    [GhostexGpuiAppShotsPressedCommandKeyCodes removeAllObjects];
  }
  return triggered;
}

static BOOL GhostexGpuiAppShotsShouldTrigger(NSEvent *event, GhostexGpuiAppShotsHotkey hotkey) {
  switch (hotkey) {
    case GhostexGpuiAppShotsHotkeyDoubleLeftShift:
      return GhostexGpuiAppShotsShouldTriggerDoubleTap(
          event,
          GhostexGpuiAppShotsLeftShiftKeyCode,
          NSEventModifierFlagShift,
          &GhostexGpuiAppShotsLastLeftShiftTap);
    case GhostexGpuiAppShotsHotkeyDoubleLeftOption:
      return GhostexGpuiAppShotsShouldTriggerDoubleTap(
          event,
          GhostexGpuiAppShotsLeftOptionKeyCode,
          NSEventModifierFlagOption,
          &GhostexGpuiAppShotsLastLeftOptionTap);
    case GhostexGpuiAppShotsHotkeyBothCommand:
    default:
      return GhostexGpuiAppShotsShouldTriggerBothCommand(event);
  }
}

static NSDictionary *GhostexGpuiAppShotsFrontWindowInfo(pid_t pid) {
  NSArray *windowInfoList = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID));
  for (NSDictionary *windowInfo in windowInfoList) {
    NSNumber *ownerPid = windowInfo[(__bridge NSString *)kCGWindowOwnerPID];
    NSNumber *layer = windowInfo[(__bridge NSString *)kCGWindowLayer];
    NSNumber *alpha = windowInfo[(__bridge NSString *)kCGWindowAlpha];
    NSDictionary *boundsDictionary = windowInfo[(__bridge NSString *)kCGWindowBounds];
    if (!ownerPid || ownerPid.intValue != pid || layer.integerValue != 0) {
      continue;
    }
    if (alpha && alpha.doubleValue <= 0.0) {
      continue;
    }
    CGRect bounds = CGRectZero;
    if (!boundsDictionary ||
        !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDictionary, &bounds)) {
      continue;
    }
    if (CGRectGetWidth(bounds) < 20.0 || CGRectGetHeight(bounds) < 20.0) {
      continue;
    }
    return windowInfo;
  }
  return nil;
}

static void GhostexGpuiAppShotsCapture(NSString *trigger) {
  /*
  CDXC:GPUIAppShots 2026-06-25-23:07:
  GPUI App Shots mirrors macOS by taking an instant WindowServer screenshot of the frontmost app window and collecting only cheap CGWindow metadata. Do not add Accessibility tree reads, OCR, DOM scraping, terminal text inspection, stdout/stderr capture, persistent logs, or renderer-supplied screenshot paths to this native boundary.
  */
  NSRunningApplication *frontmostApplication = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!frontmostApplication) {
    GhostexGpuiAppShotsCaptureFailed("Could not identify the frontmost app.");
    return;
  }

  NSDictionary *windowInfo = GhostexGpuiAppShotsFrontWindowInfo(frontmostApplication.processIdentifier);
  NSNumber *windowNumber = windowInfo[(__bridge NSString *)kCGWindowNumber];
  NSDictionary *boundsDictionary = windowInfo[(__bridge NSString *)kCGWindowBounds];
  if (!windowNumber || !boundsDictionary) {
    GhostexGpuiAppShotsCaptureFailed("Could not find a visible frontmost app window.");
    return;
  }

  CGRect bounds = CGRectZero;
  if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDictionary, &bounds)) {
    GhostexGpuiAppShotsCaptureFailed("Could not read the frontmost app window bounds.");
    return;
  }

  CGWindowID windowId = windowNumber.unsignedIntValue;
  CGImageRef image = CGWindowListCreateImage(
      CGRectNull,
      kCGWindowListOptionIncludingWindow,
      windowId,
      kCGWindowImageBoundsIgnoreFraming | kCGWindowImageBestResolution);
  if (!image) {
    GhostexGpuiAppShotsCaptureFailed("Could not capture the frontmost app window.");
    return;
  }

  NSString *shotsDirectory = [NSHomeDirectory() stringByAppendingPathComponent:@".ghostex/i"];
  NSError *directoryError = nil;
  [[NSFileManager defaultManager] createDirectoryAtPath:shotsDirectory
                            withIntermediateDirectories:YES
                                             attributes:@{NSFilePosixPermissions: @(0700)}
                                                  error:&directoryError];
  if (directoryError) {
    CGImageRelease(image);
    GhostexGpuiAppShotsCaptureFailed("Could not prepare the App Shots image folder.");
    return;
  }

  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.dateFormat = @"yyMMddHHmmss";
  NSString *fileName = [NSString stringWithFormat:@"appshot-%@.png", [formatter stringFromDate:[NSDate date]]];
  NSString *imagePath = [shotsDirectory stringByAppendingPathComponent:fileName];

  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
  NSData *pngData = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  CGImageRelease(image);
  if (!pngData || ![pngData writeToFile:imagePath atomically:YES]) {
    GhostexGpuiAppShotsCaptureFailed("Could not save the App Shot image.");
    return;
  }

  NSString *appName =
      frontmostApplication.localizedName ?: frontmostApplication.bundleIdentifier ?: @"frontmost app";
  NSString *bundleIdentifier = frontmostApplication.bundleIdentifier;
  NSString *title = windowInfo[(__bridge NSString *)kCGWindowName];
  NSString *displayPath = GhostexGpuiAppShotsDisplayPath(imagePath);
  GhostexGpuiAppShotsCaptureSucceeded(
      appName.UTF8String,
      bundleIdentifier.length > 0 ? bundleIdentifier.UTF8String : NULL,
      displayPath.UTF8String,
      title.length > 0 ? title.UTF8String : NULL,
      (int32_t)llround(CGRectGetWidth(bounds)),
      (int32_t)llround(CGRectGetHeight(bounds)),
      trigger.UTF8String);
}

static void GhostexGpuiAppShotsHandleModifierEvent(NSEvent *event) {
  if (!NSThread.isMainThread) {
    dispatch_async(dispatch_get_main_queue(), ^{
      GhostexGpuiAppShotsHandleModifierEvent(event);
    });
    return;
  }

  if (GhostexGpuiAppShotsSettingsEnabled() == 0) {
    GhostexGpuiAppShotsResetState();
    return;
  }

  GhostexGpuiAppShotsHotkey hotkey =
      (GhostexGpuiAppShotsHotkey)GhostexGpuiAppShotsSettingsHotkey();
  if (!GhostexGpuiAppShotsShouldTrigger(event, hotkey)) {
    return;
  }

  NSTimeInterval timestamp = event.timestamp;
  if (timestamp - GhostexGpuiAppShotsLastCapture < GhostexGpuiAppShotsCaptureCooldownSeconds) {
    return;
  }
  GhostexGpuiAppShotsLastCapture = timestamp;

  /*
  CDXC:GPUIAppShots 2026-06-25-23:07:
  The App Shots hotkey reads shared Settings for every flagsChanged event so toggles and hotkey changes apply without restarting GPUI. The trigger labels are fixed enum-like values only; never include raw key text, app names, titles, paths, commands, or user content in side-channel metadata.
  */
  NSString *trigger = @"both-command";
  if (hotkey == GhostexGpuiAppShotsHotkeyDoubleLeftShift) {
    trigger = @"double-left-shift";
  } else if (hotkey == GhostexGpuiAppShotsHotkeyDoubleLeftOption) {
    trigger = @"double-left-option";
  }
  GhostexGpuiAppShotsCapture(trigger);
}

void GhostexGpuiInstallAppShotsEventMonitors(void) {
  if (GhostexGpuiAppShotsLocalMonitor || GhostexGpuiAppShotsGlobalMonitor) {
    return;
  }
  GhostexGpuiAppShotsPressedCommandKeyCodes = [NSMutableSet setWithCapacity:2];
  GhostexGpuiAppShotsLocalMonitor =
      [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged
                                            handler:^NSEvent *(NSEvent *event) {
                                              GhostexGpuiAppShotsHandleModifierEvent(event);
                                              return event;
                                            }];
  GhostexGpuiAppShotsGlobalMonitor =
      [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged
                                             handler:^(NSEvent *event) {
                                               GhostexGpuiAppShotsHandleModifierEvent(event);
                                             }];
}

void GhostexGpuiRemoveAppShotsEventMonitors(void) {
  if (GhostexGpuiAppShotsLocalMonitor) {
    [NSEvent removeMonitor:GhostexGpuiAppShotsLocalMonitor];
    GhostexGpuiAppShotsLocalMonitor = nil;
  }
  if (GhostexGpuiAppShotsGlobalMonitor) {
    [NSEvent removeMonitor:GhostexGpuiAppShotsGlobalMonitor];
    GhostexGpuiAppShotsGlobalMonitor = nil;
  }
  GhostexGpuiAppShotsPressedCommandKeyCodes = nil;
  GhostexGpuiAppShotsResetState();
  GhostexGpuiAppShotsLastCapture = 0.0;
}
