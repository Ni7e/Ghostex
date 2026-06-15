import AppKit

enum NativeTooltip {
  static let maxWidth: CGFloat = 225
  private static let font = NSFont.toolTipsFont(ofSize: 13)

  /*
   CDXC:NativeTooltips 2026-06-15-10:25:
   Native AppKit tooltips need the same readable width cap across toolbar buttons, menu rows, and title labels. Wrap tooltip strings at the writer boundary so system tooltip rendering cannot produce extra-wide native hover bubbles.
   */
  static func text(_ value: String?) -> String? {
    guard let value else {
      return nil
    }
    return value
      .components(separatedBy: "\n")
      .map(wrapLine)
      .joined(separator: "\n")
  }

  static func browserHistory(title: String, url: String) -> String {
    text("\(title)\n\n\(url)") ?? "\(title)\n\n\(url)"
  }

  private static func wrapLine(_ line: String) -> String {
    guard measuredWidth(line) > maxWidth else {
      return line
    }
    var output: [String] = []
    var current = ""
    for character in line {
      let candidate = current + String(character)
      if !current.isEmpty, measuredWidth(candidate) > maxWidth {
        output.append(current.trimmingCharacters(in: .whitespaces))
        current = String(character).trimmingCharacters(in: .whitespaces)
      } else {
        current = candidate
      }
    }
    if !current.isEmpty {
      output.append(current.trimmingCharacters(in: .whitespaces))
    }
    return output.joined(separator: "\n")
  }

  private static func measuredWidth(_ value: String) -> CGFloat {
    (value as NSString).size(withAttributes: [.font: font]).width
  }
}
