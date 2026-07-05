import AppKit
import Foundation

enum EditorCloseAction {
  case save
  case cancel
}

final class EditorSession {
  weak var daemon: EditorDaemon?
  weak var openerConnection: ClientConnection?
  var editorWindow: EditorWindowController?

  let requestId: String
  let fileURL: URL
  let statusFileURL: URL
  let language: String?
  let title: String
  let initialText: String
  var latestDraft: String

  private var hasOpened = false
  private var isFinishing = false
  private var returnFocusApplication: NSRunningApplication?

  init(
    daemon: EditorDaemon,
    requestId: String,
    fileURL: URL,
    statusFileURL: URL,
    language: String?,
    title: String,
    initialText: String,
    openerConnection: ClientConnection
  ) {
    self.daemon = daemon
    self.requestId = requestId
    self.fileURL = fileURL
    self.statusFileURL = statusFileURL
    self.language = language
    self.title = title
    self.initialText = initialText
    self.latestDraft = initialText
    self.openerConnection = openerConnection
  }

  func editorConfigured() {
    guard !hasOpened else {
      return
    }
    hasOpened = true
    returnFocusApplication = daemon?.captureReturnFocusApplication()
    editorWindow?.present()
    writeStatus("started")
    openerConnection?.send(["type": "opened", "requestId": requestId])
  }

  func requestSaveAndClose() {
    guard !isFinishing else {
      return
    }
    if let editorWindow {
      editorWindow.requestWebSaveAndClose()
    } else {
      finish(action: .save)
    }
  }

  func saveDraftWithoutClosing() {
    do {
      try writeDraft(latestDraft)
    } catch {
      writeStderr("GhostexEditor: save failed: \(error.localizedDescription)\n")
    }
  }

  func finish(action: EditorCloseAction) {
    guard !isFinishing else {
      return
    }
    isFinishing = true

    switch action {
    case .save:
      do {
        try writeDraft(latestDraft)
      } catch {
        writeStderr("GhostexEditor: save failed for \(fileURL.path): \(error.localizedDescription)\n")
      }
      writeStatus("saved")
      openerConnection?.send([
        "type": "closed",
        "requestId": requestId,
        "status": "saved",
      ])
    case .cancel:
      writeStatus("cancelled")
      openerConnection?.send([
        "type": "closed",
        "requestId": requestId,
        "status": "cancelled",
      ])
    }

    restoreReturnFocus()
    daemon?.sessionDidFinish(self)
  }

  private func restoreReturnFocus() {
    /*
     * Only hand focus back when this daemon is still the active app: a close
     * driven remotely (CLI signal, shutdown) while the user works in another
     * app must not yank them to the terminal.
     */
    guard NSApp.isActive else {
      return
    }
    guard let application = returnFocusApplication, !application.isTerminated else {
      return
    }
    if #available(macOS 14.0, *) {
      application.activate()
    } else {
      application.activate(options: [])
    }
  }

  func handlePasteImage(_ body: [String: Any]) {
    guard let pasteRequestId = body["requestId"] as? String else {
      return
    }

    do {
      guard let base64Data = body["base64Data"] as? String else {
        throw ghostexError("Image paste did not include base64Data.")
      }
      let imageDataString: String
      if let commaIndex = base64Data.firstIndex(of: ",") {
        imageDataString = String(base64Data[base64Data.index(after: commaIndex)...])
      } else {
        imageDataString = base64Data
      }
      guard let data = Data(base64Encoded: imageDataString) else {
        throw ghostexError("Image paste data was not valid base64.")
      }

      let imageDirectory = try ensureImageDirectory()
      let suggestedName = (body["suggestedName"] as? String) ?? "image.png"
      let fileName = uniqueImageFileName(suggestedName)
      let fileURL = imageDirectory.appendingPathComponent(fileName, isDirectory: false)
      try data.write(to: fileURL, options: .atomic)
      editorWindow?.dispatchHostMessage([
        "type": "imagePasteResult",
        "requestId": pasteRequestId,
        "path": fileURL.path,
      ])
    } catch {
      editorWindow?.dispatchHostMessage([
        "type": "imagePasteResult",
        "requestId": pasteRequestId,
        "error": error.localizedDescription,
      ])
    }
  }

  private func writeDraft(_ draft: String) throws {
    guard let data = draft.data(using: .utf8) else {
      throw ghostexError("Draft is not valid UTF-8.")
    }
    try data.write(to: fileURL, options: .atomic)
  }

  private func writeStatus(_ status: String) {
    do {
      try status.data(using: .utf8)?.write(to: statusFileURL, options: .atomic)
    } catch {
      writeStderr("GhostexEditor: status write failed: \(error.localizedDescription)\n")
    }
  }

  private func ensureImageDirectory() throws -> URL {
    let draftDirectory = fileURL.deletingLastPathComponent()
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
}
