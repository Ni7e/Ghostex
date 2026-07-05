import AppKit
import Foundation
import WebKit

struct EditorConfiguration {
  let fileURL: URL
  let language: String?
  let title: String
  let statusFileURL: URL?
}

private let usageText = """
Usage: GhostexEditor <file> [--language <monacoLanguageId>] [--title <windowTitle>] [--status-file <path>]
"""

private func writeStderr(_ text: String) {
  if let data = text.data(using: .utf8) {
    FileHandle.standardError.write(data)
  }
}

private func usageExit(_ message: String? = nil) -> Never {
  if let message {
    writeStderr("\(message)\n")
  }
  writeStderr(usageText)
  exit(2)
}

private func standardizedFileURL(_ path: String) -> URL {
  let expanded = (path as NSString).expandingTildeInPath
  return URL(fileURLWithPath: expanded).standardizedFileURL
}

private func parseArguments(_ arguments: [String]) -> EditorConfiguration {
  var filePath: String?
  var language: String?
  var title = "Ghostex Editor"
  var statusFilePath: String?
  var index = 1

  while index < arguments.count {
    let argument = arguments[index]
    switch argument {
    case "--help", "-h":
      usageExit()
    case "--language":
      index += 1
      guard index < arguments.count else {
        usageExit("Missing value for --language.")
      }
      language = arguments[index]
    case "--title":
      index += 1
      guard index < arguments.count else {
        usageExit("Missing value for --title.")
      }
      title = arguments[index]
    case "--status-file":
      index += 1
      guard index < arguments.count else {
        usageExit("Missing value for --status-file.")
      }
      statusFilePath = arguments[index]
    default:
      if argument.hasPrefix("--") {
        usageExit("Unknown option: \(argument)")
      }
      guard filePath == nil else {
        usageExit("Only one file argument is supported.")
      }
      filePath = argument
    }
    index += 1
  }

  guard let filePath else {
    usageExit("Missing file argument.")
  }

  return EditorConfiguration(
    fileURL: standardizedFileURL(filePath),
    language: language,
    title: title,
    statusFileURL: statusFilePath.map(standardizedFileURL)
  )
}

private struct BootstrapPayload: Encodable {
  let initialText: String
  let language: String?
  let filePath: String
  let title: String
}

final class EditorAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler {
  private let configuration: EditorConfiguration
  private let initialText: String
  private var latestDraft: String
  private var window: NSWindow?
  private var webView: WKWebView?
  private var signalSources: [DispatchSourceSignal] = []
  private var isFinishing = false

  init(configuration: EditorConfiguration, initialText: String) {
    self.configuration = configuration
    self.initialText = initialText
    self.latestDraft = initialText
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)

    guard let webRoot = resolveWebRoot() else {
      finishWithStartupError("Unable to resolve Ghostex Editor web root.")
      return
    }

    let indexURL = webRoot.appendingPathComponent("index.html", isDirectory: false)
    guard FileManager.default.fileExists(atPath: indexURL.path) else {
      finishWithStartupError("Missing editor web entry at \(indexURL.path).")
      return
    }

    do {
      let webView = try makeWebView()
      let window = makeWindow(webView: webView)
      self.webView = webView
      self.window = window

      installSignalHandlers()
      window.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      webView.loadFileURL(indexURL, allowingReadAccessTo: webRoot)
    } catch {
      finishWithStartupError(error.localizedDescription)
    }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    forceSaveAndExit()
    return .terminateCancel
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    forceSaveAndExit()
    return false
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "ghostexEditorHost",
      let body = message.body as? [String: Any],
      let type = body["type"] as? String
    else {
      return
    }

    switch type {
    case "ready":
      writeStatus("started")
    case "draftUpdate":
      if let text = body["text"] as? String {
        latestDraft = text
      }
    case "saveAndClose":
      if let text = body["text"] as? String {
        latestDraft = text
      }
      saveAndExit()
    case "save":
      if let text = body["text"] as? String {
        latestDraft = text
      }
      do {
        try writeDraft(latestDraft)
      } catch {
        writeStderr("GhostexEditor: save failed: \(error.localizedDescription)\n")
      }
    case "cancel":
      cancelAndExit()
    case "pasteImage":
      handlePasteImage(body)
    default:
      break
    }
  }

  private func resolveWebRoot() -> URL? {
    if let override = ProcessInfo.processInfo.environment["GHOSTEX_EDITOR_WEB_ROOT"],
      !override.isEmpty
    {
      return standardizedFileURL(override)
    }
    return Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true)
  }

  private func makeWebView() throws -> WKWebView {
    let contentController = WKUserContentController()
    contentController.add(self, name: "ghostexEditorHost")

    let bootstrap = BootstrapPayload(
      initialText: initialText,
      language: configuration.language,
      filePath: configuration.fileURL.path,
      title: configuration.title
    )
    let data = try JSONEncoder().encode(bootstrap)
    guard let json = String(data: data, encoding: .utf8) else {
      throw NSError(
        domain: "GhostexEditor",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Unable to encode editor bootstrap."]
      )
    }
    let scriptSource = """
    Object.defineProperty(window, "__require", {
      configurable: true,
      get: function() { return window.require; }
    });
    window.__GHOSTEX_EDITOR_BOOTSTRAP__ = \(json);
    """
    let script = WKUserScript(
      source: scriptSource,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    )
    contentController.addUserScript(script)

    let configuration = WKWebViewConfiguration()
    configuration.userContentController = contentController
    configuration.suppressesIncrementalRendering = false

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.autoresizingMask = [.width, .height]
    return webView
  }

  private func makeWindow(webView: WKWebView) -> NSWindow {
    let contentRect = NSRect(x: 0, y: 0, width: 900, height: 620)
    let window = NSWindow(
      contentRect: contentRect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = configuration.title
    window.minSize = NSSize(width: 480, height: 320)
    window.delegate = self
    window.setFrameAutosaveName("GhostexEditorWindow")
    window.center()
    window.contentView = webView
    return window
  }

  private func installSignalHandlers() {
    for signalNumber in [SIGTERM, SIGINT, SIGHUP] {
      signal(signalNumber, SIG_IGN)
      let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
      source.setEventHandler { [weak self] in
        self?.forceSaveAndExit()
      }
      source.resume()
      signalSources.append(source)
    }
  }

  private func writeDraft(_ draft: String) throws {
    guard let data = draft.data(using: .utf8) else {
      throw NSError(
        domain: "GhostexEditor",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Draft is not valid UTF-8."]
      )
    }
    try data.write(to: configuration.fileURL, options: .atomic)
  }

  private func writeStatus(_ status: String) {
    guard let statusFileURL = configuration.statusFileURL else {
      return
    }
    do {
      try status.data(using: .utf8)?.write(to: statusFileURL, options: .atomic)
    } catch {
      writeStderr("GhostexEditor: status write failed: \(error.localizedDescription)\n")
    }
  }

  private func saveAndExit() {
    guard !isFinishing else {
      return
    }
    isFinishing = true
    do {
      try writeDraft(latestDraft)
      writeStatus("saved")
      exit(0)
    } catch {
      writeStderr("GhostexEditor: save failed: \(error.localizedDescription)\n")
      exit(2)
    }
  }

  private func forceSaveAndExit() {
    saveAndExit()
  }

  private func cancelAndExit() {
    guard !isFinishing else {
      return
    }
    isFinishing = true
    writeStatus("cancelled")
    exit(1)
  }

  private func finishWithStartupError(_ message: String) {
    guard !isFinishing else {
      return
    }
    isFinishing = true
    writeStderr("GhostexEditor: \(message)\n")
    exit(2)
  }

  private func handlePasteImage(_ body: [String: Any]) {
    guard let requestId = body["requestId"] as? String else {
      return
    }

    do {
      guard let base64Data = body["base64Data"] as? String else {
        throw NSError(
          domain: "GhostexEditor",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "Image paste did not include base64Data."]
        )
      }
      let imageDataString: String
      if let commaIndex = base64Data.firstIndex(of: ",") {
        imageDataString = String(base64Data[base64Data.index(after: commaIndex)...])
      } else {
        imageDataString = base64Data
      }
      guard let data = Data(base64Encoded: imageDataString) else {
        throw NSError(
          domain: "GhostexEditor",
          code: 4,
          userInfo: [NSLocalizedDescriptionKey: "Image paste data was not valid base64."]
        )
      }

      let imageDirectory = try ensureImageDirectory()
      let suggestedName = (body["suggestedName"] as? String) ?? "image.png"
      let fileName = uniqueImageFileName(suggestedName)
      let fileURL = imageDirectory.appendingPathComponent(fileName, isDirectory: false)
      try data.write(to: fileURL, options: .atomic)
      dispatchHostMessage(["type": "imagePasteResult", "requestId": requestId, "path": fileURL.path])
    } catch {
      dispatchHostMessage([
        "type": "imagePasteResult",
        "requestId": requestId,
        "error": error.localizedDescription,
      ])
    }
  }

  private func ensureImageDirectory() throws -> URL {
    let draftDirectory = configuration.fileURL.deletingLastPathComponent()
    let baseDirectory: URL
    if FileManager.default.fileExists(atPath: draftDirectory.path) {
      baseDirectory = draftDirectory
    } else {
      baseDirectory = FileManager.default.temporaryDirectory
    }
    let imageDirectory = baseDirectory.appendingPathComponent("ghostex-editor-images", isDirectory: true)
    try FileManager.default.createDirectory(at: imageDirectory, withIntermediateDirectories: true)
    return imageDirectory
  }

  private func uniqueImageFileName(_ suggestedName: String) -> String {
    let sanitized = suggestedName
      .split(separator: "/")
      .last
      .map(String.init) ?? "image.png"
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_"))
    let filteredScalars = sanitized.unicodeScalars.map { scalar in
      allowed.contains(scalar) ? Character(scalar) : "-"
    }
    var filtered = String(filteredScalars)
      .trimmingCharacters(in: CharacterSet(charactersIn: ".- "))
    if filtered.isEmpty {
      filtered = "image.png"
    }
    if (filtered as NSString).pathExtension.isEmpty {
      filtered += ".png"
    }
    return "\(UUID().uuidString)-\(filtered)"
  }

  private func dispatchHostMessage(_ detail: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(detail),
      let data = try? JSONSerialization.data(withJSONObject: detail),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }
    let javascript = """
    window.dispatchEvent(new CustomEvent("ghostex-editor-host-message", { detail: \(json) }));
    """
    webView?.evaluateJavaScript(javascript)
  }
}

let configuration = parseArguments(CommandLine.arguments)
let initialText: String
do {
  if FileManager.default.fileExists(atPath: configuration.fileURL.path) {
    initialText = try String(contentsOf: configuration.fileURL, encoding: .utf8)
  } else {
    initialText = ""
  }
} catch {
  writeStderr("GhostexEditor: unable to read \(configuration.fileURL.path): \(error.localizedDescription)\n")
  exit(2)
}

let app = NSApplication.shared
let delegate = EditorAppDelegate(configuration: configuration, initialText: initialText)
app.delegate = delegate
app.run()
