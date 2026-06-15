import Foundation

func assertFocusPolicy(_ condition: Bool, _ message: String) {
  if !condition {
    fputs("\(message)\n", stderr)
    exit(1)
  }
}

@main
enum NativeTerminalFocusRequestPolicyTests {
  static func main() {
    assertFocusPolicy(
      !NativeTerminalFocusRequestPolicy.shouldPreserveExplicitFocus(
        responderScope: .externalChrome,
        requestedTargetIsVisible: true),
      "sidebar/window chrome must not consume an explicit focus request for a visible terminal")

    assertFocusPolicy(
      !NativeTerminalFocusRequestPolicy.shouldPreserveExplicitFocus(
        responderScope: .workspaceShell,
        requestedTargetIsVisible: true),
      "workspace shell focus must not block the adjacent-tab terminal focus request")

    assertFocusPolicy(
      NativeTerminalFocusRequestPolicy.shouldPreserveExplicitFocus(
        responderScope: .protectedInput,
        requestedTargetIsVisible: true),
      "protected text/modal/editor inputs should keep focus during explicit layout sync")

    assertFocusPolicy(
      !NativeTerminalFocusRequestPolicy.shouldPreserveExplicitFocus(
        responderScope: .protectedInput,
        requestedTargetIsVisible: false),
      "preservation is irrelevant when the requested target is not visible")

    assertFocusPolicy(
      !NativeTerminalFocusRequestPolicy.shouldPreserveExplicitFocus(
        responderScope: .paneSession,
        requestedTargetIsVisible: true),
      "an existing terminal responder must not prevent explicit terminal focus")
  }
}
