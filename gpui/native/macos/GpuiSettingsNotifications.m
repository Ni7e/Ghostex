#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <UserNotifications/UserNotifications.h>
#import <dispatch/dispatch.h>
#import <stdint.h>
#import <stddef.h>

typedef NS_ENUM(int32_t, GhostexGpuiNotificationAuthorizationStatus) {
  GhostexGpuiNotificationAuthorizationUnsupported = -1,
  GhostexGpuiNotificationAuthorizationUnknown = 0,
  GhostexGpuiNotificationAuthorizationNotDetermined = 1,
  GhostexGpuiNotificationAuthorizationDenied = 2,
  GhostexGpuiNotificationAuthorizationAuthorized = 3,
  GhostexGpuiNotificationAuthorizationProvisional = 4,
};

typedef NS_ENUM(int32_t, GhostexGpuiNotificationDeliveryResult) {
  GhostexGpuiNotificationDeliveryUnsupported = -1,
  GhostexGpuiNotificationDeliveryUnknown = 0,
  GhostexGpuiNotificationDeliveryPermissionNotDetermined = 1,
  GhostexGpuiNotificationDeliveryPermissionDenied = 2,
  GhostexGpuiNotificationDeliverySent = 3,
  GhostexGpuiNotificationDeliveryFailed = 4,
};

static NSString* const GhostexGpuiRemoteSshPasswordKeychainService =
  @"com.madda.ghostex.remote-ssh-password";
static NSString* const GhostexGpuiRemoteGxserverTokenKeychainService =
  @"com.madda.ghostex.remote-gxserver-token";

static NSMutableDictionary* GhostexGpuiRemoteSshPasswordKeychainQuery(NSString* remoteMachineId) {
  return [@{
    (__bridge id)kSecAttrAccount: remoteMachineId,
    (__bridge id)kSecAttrService: GhostexGpuiRemoteSshPasswordKeychainService,
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
  } mutableCopy];
}

int32_t GhostexGpuiSaveRemoteSshPassword(
  const char* remoteMachineId,
  const uint8_t* passwordBytes,
  size_t passwordLength
) {
  /*
   CDXC:GPUIRemoteMachinesSettings 2026-06-24-13:36:
   GPUI Remote Machine password parity uses the same macOS Keychain service/account contract as Swift: service `com.madda.ghostex.remote-ssh-password`, account `remoteMachineId`, and generic-password data. The raw password crosses only this native boundary, never through shell arguments, persistent logs, settings JSON, stdout/stderr, URLs, paths, hostnames, usernames, or command text.

   CDXC:GPUIRemoteMachinesSettings 2026-06-24-13:36:
   Non-empty saves must match `RemoteGxserverClient.storeSshPasswordInKeychain`: delete the existing service/account generic-password item first, treat missing items as a clean pre-add state, then add a new item with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and `kSecValueData`. Do not use `SecItemUpdate` because the GPUI path must not diverge from Swift Keychain replacement semantics.
   */
  @autoreleasepool {
    if (remoteMachineId == NULL) {
      return 0;
    }
    NSString* account = [NSString stringWithUTF8String:remoteMachineId];
    if (account.length == 0) {
      return 0;
    }
    NSMutableDictionary* query = GhostexGpuiRemoteSshPasswordKeychainQuery(account);
    if (passwordLength == 0) {
      OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
      return (status == errSecSuccess || status == errSecItemNotFound) ? 1 : 0;
    }
    if (passwordBytes == NULL) {
      return 0;
    }

    NSData* passwordData = [NSData dataWithBytes:passwordBytes length:passwordLength];
    OSStatus deleteStatus = SecItemDelete((__bridge CFDictionaryRef)query);
    if (deleteStatus != errSecSuccess && deleteStatus != errSecItemNotFound) {
      return 0;
    }

    NSMutableDictionary* addQuery = [query mutableCopy];
    addQuery[(__bridge id)kSecAttrAccessible] =
      (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    addQuery[(__bridge id)kSecValueData] = passwordData;

    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
    return status == errSecSuccess ? 1 : 0;
  }
}

static NSMutableDictionary* GhostexGpuiRemoteGxserverTokenKeychainQuery(NSString* remoteMachineId) {
  return [@{
    (__bridge id)kSecAttrAccount: remoteMachineId,
    (__bridge id)kSecAttrService: GhostexGpuiRemoteGxserverTokenKeychainService,
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
  } mutableCopy];
}

int32_t GhostexGpuiSaveRemoteGxserverToken(
  const char* remoteMachineId,
  const uint8_t* tokenBytes,
  size_t tokenLength
) {
  /*
   CDXC:GPUIRemoteMachinesSettings 2026-06-24-14:34:
   GPUI Remote gxserver reconnect stores the daemon token in the same macOS Keychain service/account contract as Swift: service `com.madda.ghostex.remote-gxserver-token`, account `remoteMachineId`, generic-password data. The token may live only in Keychain and transient runtime memory, never Settings JSON, persistent logs, app-modal payloads beyond connect status, stdout/stderr, URLs, paths, hostnames, usernames, or command text.

   CDXC:GPUIRemoteMachinesSettings 2026-06-24-14:34:
   Token replacement follows Swift's delete-then-add semantics with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` so GPUI reconnect does not diverge from the macOS app's saved remote auth behavior.
   */
  @autoreleasepool {
    if (remoteMachineId == NULL) {
      return 0;
    }
    NSString* account = [NSString stringWithUTF8String:remoteMachineId];
    if (account.length == 0) {
      return 0;
    }
    NSMutableDictionary* query = GhostexGpuiRemoteGxserverTokenKeychainQuery(account);
    if (tokenLength == 0) {
      OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
      return (status == errSecSuccess || status == errSecItemNotFound) ? 1 : 0;
    }
    if (tokenBytes == NULL) {
      return 0;
    }

    NSData* tokenData = [NSData dataWithBytes:tokenBytes length:tokenLength];
    OSStatus deleteStatus = SecItemDelete((__bridge CFDictionaryRef)query);
    if (deleteStatus != errSecSuccess && deleteStatus != errSecItemNotFound) {
      return 0;
    }

    NSMutableDictionary* addQuery = [query mutableCopy];
    addQuery[(__bridge id)kSecAttrAccessible] =
      (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    addQuery[(__bridge id)kSecValueData] = tokenData;

    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
    return status == errSecSuccess ? 1 : 0;
  }
}

@interface GhostexGpuiSettingsNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation GhostexGpuiSettingsNotificationDelegate

+ (instancetype)sharedDelegate {
  static GhostexGpuiSettingsNotificationDelegate* delegate = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    delegate = [[GhostexGpuiSettingsNotificationDelegate alloc] init];
  });
  return delegate;
}

- (void)userNotificationCenter:(UNUserNotificationCenter*)center
       willPresentNotification:(UNNotification*)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
  (void)center;
  (void)notification;
  if (@available(macOS 11.0, *)) {
    completionHandler(UNNotificationPresentationOptionBanner);
  } else {
    completionHandler(UNNotificationPresentationOptionAlert);
  }
}

@end

static BOOL GhostexGpuiNotificationsAvailable(void) {
  if (@available(macOS 10.14, *)) {
    return YES;
  }
  return NO;
}

static UNUserNotificationCenter* GhostexGpuiNotificationCenter(void) {
  if (!GhostexGpuiNotificationsAvailable()) {
    return nil;
  }
  UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
  center.delegate = [GhostexGpuiSettingsNotificationDelegate sharedDelegate];
  return center;
}

static GhostexGpuiNotificationAuthorizationStatus
GhostexGpuiNotificationAuthorizationStatusFromSettings(UNNotificationSettings* settings) {
  if (!settings) {
    return GhostexGpuiNotificationAuthorizationUnknown;
  }

  switch (settings.authorizationStatus) {
    case UNAuthorizationStatusNotDetermined:
      return GhostexGpuiNotificationAuthorizationNotDetermined;
    case UNAuthorizationStatusDenied:
      return GhostexGpuiNotificationAuthorizationDenied;
    case UNAuthorizationStatusAuthorized:
      return GhostexGpuiNotificationAuthorizationAuthorized;
    case UNAuthorizationStatusProvisional:
      return GhostexGpuiNotificationAuthorizationProvisional;
    default:
      return GhostexGpuiNotificationAuthorizationUnknown;
  }
}

int32_t GhostexGpuiGetNotificationAuthorizationStatus(void) {
  /*
   CDXC:GPUISettingsNotifications 2026-06-24-12:44:
   GPUI Settings reads macOS notification authorization through UserNotifications instead of reporting a stubbed unavailable state. Keep this shim status-only and privacy-neutral: no persistent logs, no raw errors, and no project/session/path/title content crosses the boundary.
   */
  UNUserNotificationCenter* center = GhostexGpuiNotificationCenter();
  if (!center) {
    return GhostexGpuiNotificationAuthorizationUnsupported;
  }

  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block GhostexGpuiNotificationAuthorizationStatus result =
    GhostexGpuiNotificationAuthorizationUnknown;
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings* settings) {
    result = GhostexGpuiNotificationAuthorizationStatusFromSettings(settings);
    dispatch_semaphore_signal(semaphore);
  }];

  dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC);
  if (dispatch_semaphore_wait(semaphore, timeout) != 0) {
    return GhostexGpuiNotificationAuthorizationUnknown;
  }
  return result;
}

int32_t GhostexGpuiRequestNotificationAuthorization(void) {
  /*
   CDXC:GPUISettingsNotifications 2026-06-24-12:44:
   The Settings permission button may request only alert authorization and only when macOS reports notDetermined. Denied permission remains a system-settings repair flow; GPUI must not fake success or attempt to override Notification Settings.
   */
  UNUserNotificationCenter* center = GhostexGpuiNotificationCenter();
  if (!center) {
    return GhostexGpuiNotificationAuthorizationUnsupported;
  }

  int32_t currentStatus = GhostexGpuiGetNotificationAuthorizationStatus();
  if (currentStatus != GhostexGpuiNotificationAuthorizationNotDetermined) {
    return currentStatus;
  }

  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block BOOL callbackReceived = NO;
  [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert
                        completionHandler:^(BOOL granted, NSError* error) {
    (void)granted;
    (void)error;
    callbackReceived = YES;
    dispatch_semaphore_signal(semaphore);
  }];

  dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
  if (!callbackReceived) {
    return GhostexGpuiNotificationAuthorizationUnknown;
  }
  return GhostexGpuiGetNotificationAuthorizationStatus();
}

int32_t GhostexGpuiDeliverSettingsTestNotification(void) {
  /*
   CDXC:GPUISettingsNotifications 2026-06-24-12:44:
   Test agent task completion should emit exactly one generic macOS banner with no notification sound when Settings enables macOS attention notifications. This is not session notification routing: do not attach project icons, session ids, terminal text, command content, URLs, paths, or click-to-focus state.
   */
  UNUserNotificationCenter* center = GhostexGpuiNotificationCenter();
  if (!center) {
    return GhostexGpuiNotificationDeliveryUnsupported;
  }

  int32_t status = GhostexGpuiRequestNotificationAuthorization();
  switch (status) {
    case GhostexGpuiNotificationAuthorizationAuthorized:
    case GhostexGpuiNotificationAuthorizationProvisional:
      break;
    case GhostexGpuiNotificationAuthorizationNotDetermined:
      return GhostexGpuiNotificationDeliveryPermissionNotDetermined;
    case GhostexGpuiNotificationAuthorizationDenied:
      return GhostexGpuiNotificationDeliveryPermissionDenied;
    case GhostexGpuiNotificationAuthorizationUnsupported:
      return GhostexGpuiNotificationDeliveryUnsupported;
    default:
      return GhostexGpuiNotificationDeliveryUnknown;
  }

  UNMutableNotificationContent* content = [[UNMutableNotificationContent alloc] init];
  content.title = @"Agent task complete";
  content.body = @"This is a Ghostex notification test.";
  content.categoryIdentifier = @"ghostex.gpui.settings.test";
  content.threadIdentifier = @"ghostex.gpui.settings.test";
  content.sound = nil;

  NSString* identifier =
    [NSString stringWithFormat:@"ghostex.gpui.settings.test.%@", [NSUUID UUID].UUIDString];
  UNNotificationRequest* request =
    [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:nil];

  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block BOOL delivered = NO;
  [center addNotificationRequest:request
           withCompletionHandler:^(NSError* error) {
    delivered = error == nil;
    dispatch_semaphore_signal(semaphore);
  }];

  dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC);
  if (dispatch_semaphore_wait(semaphore, timeout) != 0) {
    return GhostexGpuiNotificationDeliveryFailed;
  }

  return delivered ? GhostexGpuiNotificationDeliverySent : GhostexGpuiNotificationDeliveryFailed;
}
