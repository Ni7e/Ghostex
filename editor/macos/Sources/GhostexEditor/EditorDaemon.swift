import AppKit
import Darwin
import Foundation

final class EditorDaemon: NSObject, NSApplicationDelegate {
  private let socketPath: String
  private var listenerFileDescriptor: Int32
  private let acceptQueue = DispatchQueue(label: "com.madda.ghostex.editor.accept")
  private var acceptSource: DispatchSourceRead?
  private var signalSources: [DispatchSourceSignal] = []
  private var connections: [UUID: ClientConnection] = [:]
  private var sessions: [String: EditorSession] = [:]
  private var warmWindow: EditorWindowController?
  private var retiredWindows: [EditorWindowController] = []
  private var warmWaiters: [() -> Void] = []
  private var pendingShutdown = false
  private var isExiting = false
  private var nextCascadeTopLeft: NSPoint?
  private var webRoot: URL?
  private var indexURL: URL?
  private var lastExternalFrontmostApplication: NSRunningApplication?

  init(socketPath: String, listenerFileDescriptor: Int32) {
    self.socketPath = socketPath
    self.listenerFileDescriptor = listenerFileDescriptor
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)

    guard let webRoot = resolveWebRoot() else {
      writeStderr("GhostexEditor: Unable to resolve Ghostex Editor web root.\n")
      cleanupAndExit(2)
      return
    }
    let indexURL = webRoot.appendingPathComponent("index.html", isDirectory: false)
    guard FileManager.default.fileExists(atPath: indexURL.path) else {
      writeStderr("GhostexEditor: Missing editor web entry at \(indexURL.path).\n")
      cleanupAndExit(2)
      return
    }

    self.webRoot = webRoot
    self.indexURL = indexURL
    installSignalHandlers()
    startAcceptingConnections()
    ensureWarmWindow()
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    saveAllSessionsAndExit()
    return .terminateCancel
  }

  func handleRequest(_ request: [String: Any], from connection: ClientConnection) {
    guard intValue(request["v"]) == ghostexEditorProtocolVersion else {
      connection.sendError("unsupported protocol version")
      return
    }
    guard let type = request["type"] as? String else {
      connection.sendError("missing request type")
      return
    }

    switch type {
    case "ping":
      connection.send([
        "type": "pong",
        "v": ghostexEditorProtocolVersion,
        "openCount": sessions.count,
        "warm": warmWindowIsReady,
      ])
    case "warm":
      handleWarm(connection)
    case "open":
      handleOpen(request, from: connection)
    case "close":
      handleClose(request, from: connection)
    case "status":
      let sessionList = sessions.values.map { session in
        ["requestId": session.requestId, "title": session.title]
      }
      connection.send([
        "type": "status",
        "v": ghostexEditorProtocolVersion,
        "sessions": sessionList,
        "warm": warmWindowIsReady,
      ])
    case "shutdown":
      pendingShutdown = true
      connection.send(["type": "ok", "v": ghostexEditorProtocolVersion]) { [weak self] in
        DispatchQueue.main.async {
          guard let self else {
            return
          }
          if self.sessions.isEmpty {
            self.cleanupAndExit(0)
          }
        }
      }
    default:
      connection.sendError("unknown request type")
    }
  }

  func connectionClosed(_ connection: ClientConnection) {
    connections.removeValue(forKey: connection.id)
  }

  func warmWindowDidBecomeReady(_ controller: EditorWindowController) {
    guard controller === warmWindow, controller.session == nil else {
      return
    }
    let waiters = warmWaiters
    warmWaiters.removeAll()
    waiters.forEach { $0() }
  }

  func cascade(_ window: NSWindow) {
    if nextCascadeTopLeft == nil {
      let frame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
      nextCascadeTopLeft = NSPoint(x: frame.minX + 80, y: frame.maxY - 60)
    }
    if let topLeft = nextCascadeTopLeft {
      nextCascadeTopLeft = window.cascadeTopLeft(from: topLeft)
    }
  }

  func captureReturnFocusApplication() -> NSRunningApplication? {
    /*
     * The daemon steals app-level focus when it presents an editor window, so
     * the app that was frontmost at present time is the terminal app the user
     * pressed Ctrl+G in. When a second editor opens while an editor window is
     * already key, the frontmost app is this daemon itself; keep the last
     * external app so that session can still return focus to the terminal.
     */
    if let frontmost = NSWorkspace.shared.frontmostApplication,
      frontmost.processIdentifier != ProcessInfo.processInfo.processIdentifier
    {
      lastExternalFrontmostApplication = frontmost
    }
    return lastExternalFrontmostApplication
  }

  func sessionDidFinish(_ session: EditorSession) {
    sessions.removeValue(forKey: session.requestId)
    let editorWindow = session.editorWindow
    session.editorWindow = nil
    let shouldExitAfterCleanup = pendingShutdown && sessions.isEmpty

    DispatchQueue.main.async { [weak self, editorWindow] in
      guard let self else {
        return
      }
      if let editorWindow {
        editorWindow.cleanup()
        self.retiredWindows.append(editorWindow)
      }
      if shouldExitAfterCleanup {
        self.cleanupAndExit(0)
      } else if !self.pendingShutdown {
        self.ensureWarmWindow()
      }
    }
  }

  private var warmWindowIsReady: Bool {
    guard let warmWindow else {
      return false
    }
    return warmWindow.isReady && warmWindow.session == nil
  }

  private func resolveWebRoot() -> URL? {
    if let override = ProcessInfo.processInfo.environment["GHOSTEX_EDITOR_WEB_ROOT"],
      !override.isEmpty
    {
      return standardizedFileURL(override)
    }
    return Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true)
  }

  private func startAcceptingConnections() {
    let source = DispatchSource.makeReadSource(fileDescriptor: listenerFileDescriptor, queue: acceptQueue)
    acceptSource = source
    source.setEventHandler { [weak self] in
      self?.acceptAvailableConnections()
    }
    source.resume()
  }

  private func acceptAvailableConnections() {
    while true {
      let acceptedFileDescriptor = accept(listenerFileDescriptor, nil, nil)
      if acceptedFileDescriptor >= 0 {
        DispatchQueue.main.async { [weak self] in
          guard let self else {
            Darwin.close(acceptedFileDescriptor)
            return
          }
          let connection = ClientConnection(
            fileDescriptor: acceptedFileDescriptor,
            daemon: self,
            readQueue: self.acceptQueue
          )
          self.connections[connection.id] = connection
          connection.start()
        }
        continue
      }

      if errno == EINTR {
        continue
      }
      if errno == EAGAIN || errno == EWOULDBLOCK {
        return
      }
      return
    }
  }

  private func handleWarm(_ connection: ClientConnection) {
    if warmWindowIsReady {
      connection.send(["type": "warmed", "v": ghostexEditorProtocolVersion])
      return
    }

    warmWaiters.append { [weak connection] in
      connection?.send(["type": "warmed", "v": ghostexEditorProtocolVersion])
    }
    ensureWarmWindow()
  }

  private func handleOpen(_ request: [String: Any], from connection: ClientConnection) {
    guard let requestId = request["requestId"] as? String, !requestId.isEmpty else {
      connection.sendError("open request requires requestId")
      return
    }
    guard sessions[requestId] == nil else {
      connection.sendError("requestId already open")
      return
    }
    guard let filePath = request["filePath"] as? String, filePath.hasPrefix("/") else {
      connection.sendError("open request requires absolute filePath")
      return
    }
    guard let statusFilePath = request["statusFile"] as? String, statusFilePath.hasPrefix("/") else {
      connection.sendError("open request requires absolute statusFile")
      return
    }

    let fileURL = standardizedFileURL(filePath)
    let statusFileURL = standardizedFileURL(statusFilePath)
    let language = (request["language"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "markdown"
    let title = (request["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Prompt Editor"

    let initialText: String
    do {
      if FileManager.default.fileExists(atPath: fileURL.path) {
        initialText = try String(contentsOf: fileURL, encoding: .utf8)
      } else {
        initialText = ""
      }
    } catch {
      connection.sendError("unable to read file: \(error.localizedDescription)")
      return
    }

    do {
      let session = EditorSession(
        daemon: self,
        requestId: requestId,
        fileURL: fileURL,
        statusFileURL: statusFileURL,
        language: language,
        title: title,
        initialText: initialText,
        openerConnection: connection
      )
      sessions[requestId] = session

      let controller = try takeReadyWarmWindow() ?? makeEditorWindow()
      controller.configure(with: session)
      ensureWarmWindow()
    } catch {
      sessions.removeValue(forKey: requestId)
      connection.sendError("unable to open editor window: \(error.localizedDescription)")
    }
  }

  private func handleClose(_ request: [String: Any], from connection: ClientConnection) {
    guard let requestId = request["requestId"] as? String, !requestId.isEmpty else {
      connection.sendError("close request requires requestId")
      return
    }
    guard let action = request["action"] as? String else {
      connection.sendError("close request requires action")
      return
    }
    guard let session = sessions[requestId] else {
      connection.sendError("unknown requestId")
      return
    }

    switch action {
    case "save":
      connection.send(["type": "ok", "v": ghostexEditorProtocolVersion])
      session.requestSaveAndClose()
    case "cancel":
      connection.send(["type": "ok", "v": ghostexEditorProtocolVersion])
      session.finish(action: .cancel)
    default:
      connection.sendError("close action must be save or cancel")
    }
  }

  private func ensureWarmWindow() {
    guard !pendingShutdown else {
      return
    }
    guard warmWindow == nil else {
      return
    }
    do {
      warmWindow = try makeEditorWindow()
    } catch {
      writeStderr("GhostexEditor: unable to warm editor window: \(error.localizedDescription)\n")
    }
  }

  private func takeReadyWarmWindow() throws -> EditorWindowController? {
    guard warmWindowIsReady else {
      return nil
    }
    let controller = warmWindow
    warmWindow = nil
    return controller
  }

  private func makeEditorWindow() throws -> EditorWindowController {
    guard let webRoot, let indexURL else {
      throw ghostexError("Editor web root is not ready.")
    }
    return try EditorWindowController(daemon: self, webRoot: webRoot, indexURL: indexURL)
  }

  private func installSignalHandlers() {
    for signalNumber in [SIGTERM, SIGINT] {
      signal(signalNumber, SIG_IGN)
      let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
      source.setEventHandler { [weak self] in
        self?.saveAllSessionsAndExit()
      }
      source.resume()
      signalSources.append(source)
    }
  }

  private func saveAllSessionsAndExit() {
    guard !isExiting else {
      return
    }
    pendingShutdown = true
    for session in Array(sessions.values) {
      session.finish(action: .save)
    }
    cleanupAndExit(0)
  }

  private func cleanupAndExit(_ code: Int32) {
    guard !isExiting else {
      return
    }
    isExiting = true

    acceptSource?.cancel()
    acceptSource = nil
    if listenerFileDescriptor >= 0 {
      Darwin.close(listenerFileDescriptor)
      listenerFileDescriptor = -1
    }
    for source in signalSources {
      source.cancel()
    }
    signalSources.removeAll()
    for connection in Array(connections.values) {
      connection.close()
    }
    connections.removeAll()
    warmWindow?.cleanup()
    warmWindow = nil
    removeSocketOnExit()
    exit(code)
  }

  private func removeSocketOnExit() {
    var status = stat()
    guard lstat(socketPath, &status) == 0 else {
      return
    }
    guard (status.st_mode & S_IFMT) == S_IFSOCK else {
      return
    }
    _ = unlink(socketPath)
  }
}
