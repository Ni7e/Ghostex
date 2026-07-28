> Archived implementation history. The retired VVTerm-fork app now lives at
> `/Users/madda/dev/_active/ghostex-deprecated/iOS/`. Ghostex no longer ships
> an iOS or TestFlight release.

<!--
CDXC:iOSNativeTerminals 2026-05-22-09:29:
The iOS app must stop using the JavaScript hterm terminal and implement the same native Ghostty terminal architecture used by the macOS Ghostex app.
This is a committed product direction, not a feasibility spike: replace the terminal surface, input/output path, rendering, scrollback, and lifecycle with native Ghostty-backed UIKit surfaces.

CDXC:iOSNativeTerminals 2026-05-29-05:18:
The old a-Shell-based iOS app submodule has been removed from this repo.
Keep this document focused on the VVTerm-based `iOS` app and do not reintroduce `iOS/a-Shell` implementation paths.
-->

# iOS Native Ghostty Terminal Implementation

## Decision

Replace the iOS app's current `WKWebView` / `hterm` / `script.js` terminal with native Ghostty terminals, matching the macOS Ghostex terminal architecture as closely as iOS allows.

The terminal surface must not be JavaScript-based. JavaScript may still exist for non-terminal web content if needed, but terminal rendering, input, resize, scrollback, selection, title, bell, and stream handling must be native.

## Current iOS Terminal Path To Remove

The removed a-Shell app used a web-rendered terminal path:

- `a-Shell/ContentView.swift` created `KBWebViewBase`.
- `ContentView.updateUIView` loaded `hterm.html`.
- `hterm.html` loaded `hterm_all.js`, `gestures.js`, and `script.js`.
- `script.js` created `new hterm.Terminal()`.
- `script.js` sent input through `window.webkit.messageHandlers.aShell`.
- `a-Shell/SceneDelegate.swift` received `input:`, `inputInteractive:`, and `inputTTY:`.
- `SceneDelegate.outputToWebView` prints output by evaluating `window.term_.io.print(...)`.

These paths are not part of the active VVTerm-based `iOS` app and should not be reintroduced.

## Target Architecture

```text
iOS Ghostex app
  Swift/UIKit host
    GhostexIOSTerminalWorkspaceView
      GhostexIOSGhosttySurfaceView(session-1)
      GhostexIOSGhosttySurfaceView(session-2)
      GhostexIOSGhosttySurfaceView(session-3)
    Native keyboard accessory / floating controls
    Native sessions drawer / machine picker
```

The iOS host owns terminal views directly. Ghostty owns terminal emulation and rendering. The app's existing SSH/session/machine features should feed bytes into Ghostty instead of hterm.

## macOS Reference To Port

Use the macOS host as the behavioral model:

- `native/macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift`
- `GhostexGhosttyApp`
- `GhostexGhosttySurfaceConfiguration`
- `GhostexGhosttySurfaceModel`
- `GhostexGhosttySurfaceHostView`
- `TerminalWorkspaceView.createTerminal`
- `TerminalWorkspaceView.writeTerminalText`
- `TerminalWorkspaceView.closeTerminal`
- `TerminalWorkspaceView.focusTerminal`
- Native callbacks for title, bell, scrollbar, clipboard, close, and config reload.

Do not port AppKit types directly. Rebuild the same ownership model with UIKit equivalents.

## Ghostty iOS Work Required

Ghostty already has partial iOS hooks:

- `ghostty/include/ghostty.h` defines `GHOSTTY_PLATFORM_IOS`.
- `ghostty/macos/Sources/Ghostty/Surface View/SurfaceView_UIKit.swift` defines a UIKit `Ghostty.SurfaceView`.
- `ghostty/macos/Sources/Ghostty/Surface View/SurfaceView.swift` has an `os(iOS)` branch that passes `ghostty_platform_ios_s`.
- `ghostty/src/renderer/Metal.zig` includes iOS Metal paths.

But the iOS PTY path is currently not production-ready:

- `ghostty/src/pty.zig` maps `.ios` to `NullPty`.
- `NullPty` is explicitly marked as a temporary compile stopgap.

Therefore the implementation must add a real iOS-compatible Ghostty data path. Because iOS cannot behave like desktop POSIX terminal hosting in every situation, the correct Ghostex mobile design is:

1. Keep the existing mobile SSH/session process ownership where appropriate.
2. Feed remote/local terminal byte streams into Ghostty's terminal engine.
3. Send native keyboard/mouse/paste bytes from Ghostty back to the active stream.
4. Use Ghostty's renderer/surface for display.

No fallback to hterm should remain in the main app path.

## Implementation Plan

### 1. Build Ghostty For iOS

Create an iOS-capable Ghostty build artifact:

- Add or extend a Zig build target for iOS device and simulator.
- Emit an iOS-compatible `GhosttyKit.xcframework` or equivalent static library/module bundle.
- Include arm64 iOS device support.
- Include arm64/x86_64 simulator support if local simulator testing is required.
- Ensure headers expose the same embedding APIs needed by the iOS host.

Acceptance criteria:

- The iOS Xcode project links Ghostty without macOS-only symbols.
- A blank UIKit `Ghostty.SurfaceView` can be instantiated inside the app.
- The Ghostty runtime can tick, resize, and render a nonblank terminal surface.

### 2. Add Native iOS Terminal Workspace

Add a new UIKit-owned workspace, separate from `WKWebView`:

- `GhostexIOSTerminalWorkspaceView: UIView`
- `GhostexIOSGhosttyApp`
- `GhostexIOSGhosttySurfaceView`
- `GhostexIOSGhosttySurfaceConfiguration`
- `GhostexIOSTerminalSession`

This should mirror the macOS ownership model:

- one Ghostty app/runtime per process
- one Ghostty surface per visible terminal session
- native session map keyed by Ghostex session id
- native create/close/focus/write APIs
- native lifecycle events back into session state

Acceptance criteria:

- iOS can create, show, focus, resize, and close at least one native Ghostty surface.
- Terminal bytes render without going through `WKWebView.evaluateJavaScript`.

### 3. Replace hterm Output Path

Remove terminal output routing through:

- `SceneDelegate.outputToWebView`
- `window.term_.io.print(...)`
- `window.printedContent`
- hterm restore/resize rewrites

Create a native output sink:

```swift
protocol GhostexTerminalOutputSink {
    func writeOutput(_ data: Data, sessionId: String)
}
```

The sink should write into the active Ghostty session's parser/rendering path.

Acceptance criteria:

- stdout/stderr/SSH output bytes render on native Ghostty.
- Large animated terminal output does not cross the Swift-JavaScript bridge.
- No terminal output path calls `evaluateJavaScript`.

### 4. Replace hterm Input Path

Remove terminal input routing through:

- `window.webkit.messageHandlers.aShell.postMessage("input:...")`
- `inputInteractive:`
- `inputTTY:`
- hterm keyboard mode detection

Create native UIKit input handling:

- hardware keyboard events
- software keyboard text input
- keyboard accessory buttons
- floating controls
- paste
- control/alt/meta handling
- arrow/home/end/page keys
- focus in/out reporting

Input should enter Ghostty first. Ghostty should encode the terminal bytes to send to the active stream.

Acceptance criteria:

- Existing Ghostex toolbar keys work without hterm.
- Vim, less, SSH, agent CLIs, and alternate-screen apps receive correct bytes.
- Text composition and paste do not require a hidden web terminal.

### 5. Implement Stream Backend

Add a stream adapter between Ghostty and the active iOS session:

```swift
final class GhostexIOSTerminalStream {
    let sessionId: String
    func writeFromUser(_ data: Data)
    func writeFromRemote(_ data: Data)
    func resize(cols: Int, rows: Int, pixelWidth: Int, pixelHeight: Int)
    func close()
}
```

This adapter should connect to the current iOS command/session machinery initially, then be cleaned up into a smaller terminal-specific API.

Acceptance criteria:

- Existing machine/session attach still works.
- Password sending, file attach paste, and remote session commands still work.
- Terminal resize is sent to the remote/local process when dimensions change.

### 6. Native Resize And Scrollback

Replace hterm resize and scrollback behavior:

- no `hterm.Terminal.IO.prototype.onTerminalResize`
- no hterm `printedContent` replay on resize
- no JavaScript reflow hacks

Use Ghostty cell metrics and surface resize callbacks.

Acceptance criteria:

- Rotate device, split view, keyboard show/hide, floating keyboard, and Stage Manager resize update Ghostty dimensions.
- Alternate screen apps remain stable during resize.
- Scrollback remains native Ghostty scrollback.

### 7. Native Clipboard, Selection, And Links

Implement iOS equivalents of the macOS callbacks:

- read clipboard
- write clipboard
- confirm clipboard read if needed
- selection copy
- paste
- URL/file-link opening where applicable

Acceptance criteria:

- Copy/paste works from native Ghostty.
- OSC 52 handling is explicit and safe.
- Links can be opened without hterm.

### 8. Native Terminal Settings

Map existing iOS terminal settings to Ghostty config:

- font family
- font size
- foreground/background/cursor colors
- cursor shape
- scrollback limit
- keyboard behavior

Do not preserve hterm-only setting names as terminal internals. Convert them into Ghostty settings or remove them.

Acceptance criteria:

- User-visible terminal settings still apply after the native migration.
- Settings changes update native Ghostty surfaces.

### 9. Remove JavaScript Terminal Assets From Main Path

After native Ghostty terminal is functional, remove or quarantine:

- `iOS/hterm.html`
- `iOS/hterm_all.js`
- terminal portions of `iOS/script.js`
- terminal portions of `iOS/gestures.js`
- `KBWebViewBase` terminal-specific hacks
- hidden web terminal restore behavior

If some files must remain for unrelated browser/wasm features, rename and isolate them so they are not the app terminal.

Acceptance criteria:

- Opening the iOS app no longer loads `hterm.html` for the main terminal.
- No user typing or terminal output passes through hterm.
- `rg "window.term_|hterm|inputTTY|inputInteractive|printedContent"` shows no active main-terminal dependency.

## Suggested File Layout

```text
iOS/VVTerm/Features/Ghostex/Terminal/
  GhostexIOSGhosttyApp.swift
  GhostexIOSGhosttySurfaceConfiguration.swift
  GhostexIOSGhosttySurfaceView.swift
  GhostexIOSTerminalWorkspaceView.swift
  GhostexIOSTerminalSession.swift
  GhostexIOSTerminalStream.swift
  GhostexIOSTerminalKeyboard.swift
  GhostexIOSTerminalClipboard.swift
  GhostexIOSTerminalSettings.swift
```

## Non-Negotiable Acceptance Criteria

- The main iOS terminal is native Ghostty, not hterm, xterm.js, or any other JavaScript terminal.
- Terminal output is never rendered by `WKWebView.evaluateJavaScript`.
- Terminal input is not routed through `window.webkit.messageHandlers` from a terminal web page.
- Animated terminal apps and agent CLIs render through Ghostty's terminal engine.
- The implementation keeps the Ghostex mobile machine/session workflow working.
- Any missing Ghostty iOS capability is implemented directly instead of falling back to hterm.

## Delivery Order

1. Link iOS Ghostty build artifact into the app.
2. Mount one native Ghostty UIKit surface as the root terminal view.
3. Feed existing command/SSH output into Ghostty.
4. Route native keyboard/accessory input through Ghostty to the active stream.
5. Implement resize, scrollback, clipboard, selection, and settings.
6. Restore Ghostex mobile sidebar/session/file attach workflows on top of the native terminal.
7. Remove hterm from the main terminal path.
8. Test on iPhone device, iPad, simulator, hardware keyboard, software keyboard, remote attach, and animated agent CLIs.

Tell the user when you're done so he can test it. No need to test in simulator or similar.
