import Foundation

enum NativeTerminalExplicitFocusResponderScope: Equatable {
  case noResponder
  case paneSession
  case workspaceShell
  case externalChrome
  case protectedInput
  case unknownNonTerminal
}

enum NativeTerminalFocusRequestPolicy {
  /*
   CDXC:PaneFocus 2026-06-14-19:21:
   Closing the focused terminal tab can leave AppKit first responder on sidebar or window chrome while the pane layout correctly selects the adjacent tab. Explicit layout focus requests for a visible terminal must override shell/chrome responders; only real text, modal, or editor inputs keep keyboard ownership.
   */
  static func shouldPreserveExplicitFocus(
    responderScope: NativeTerminalExplicitFocusResponderScope,
    requestedTargetIsVisible: Bool
  ) -> Bool {
    guard requestedTargetIsVisible else {
      return false
    }
    switch responderScope {
    case .protectedInput:
      return true
    case .noResponder, .paneSession, .workspaceShell, .externalChrome, .unknownNonTerminal:
      return false
    }
  }
}
