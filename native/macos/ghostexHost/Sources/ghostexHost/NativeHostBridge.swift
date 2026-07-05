import Darwin
import Foundation

@MainActor
final class NativeHostBridge {
  private let authToken: String
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()
  private let listenSocket: Int32
  private var clients: [BridgeClient] = []
  private var listenSource: DispatchSourceRead?
  private let onCommand: (HostCommand) -> Void

  init(port: UInt16 = 58743, authToken: String, onCommand: @escaping (HostCommand) -> Void) throws {
    self.authToken = authToken
    self.onCommand = onCommand
    self.listenSocket = try Self.createLoopbackListenSocket(port: port)
  }

  deinit {
    listenSource?.cancel()
    Darwin.close(listenSocket)
  }

  func start() {
    /**
     CDXC:CliBridgeTransport 2026-05-15-20:03:
     Ctrl+G rich prompt editing reaches native through the local CLI bridge.
     Network.framework's WebSocket listener can fail before binding on this
     macOS setup, leaving no listener on the selected bridge port and making Ctrl+G fall back
     to inline vi. Use a loopback-only newline JSON TCP listener instead; browser
     pages cannot open raw TCP sockets, and the per-launch auth token still gates
     every native command from local processes.
     */
    let source = DispatchSource.makeReadSource(fileDescriptor: listenSocket, queue: .main)
    source.setEventHandler { [weak self] in
      self?.acceptAvailableClients()
    }
    listenSource = source
    source.resume()
  }

  func send(_ event: HostEvent) {
    guard let data = try? encoder.encode(event),
      let text = String(data: data, encoding: .utf8)
    else {
      return
    }
    clients.filter(\.isAuthenticated).forEach { $0.send(text) }
  }

  private static func createLoopbackListenSocket(port: UInt16) throws -> Int32 {
    let socketDescriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard socketDescriptor >= 0 else {
      throw currentPOSIXError("socket")
    }

    var yes: Int32 = 1
    setsockopt(socketDescriptor, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
    do {
      try setNonBlocking(socketDescriptor)
      var address = sockaddr_in()
      address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
      address.sin_family = sa_family_t(AF_INET)
      address.sin_port = in_port_t(port).bigEndian
      address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

      let bindResult = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          Darwin.bind(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
      guard bindResult == 0 else {
        throw currentPOSIXError("bind")
      }
      guard Darwin.listen(socketDescriptor, SOMAXCONN) == 0 else {
        throw currentPOSIXError("listen")
      }
      return socketDescriptor
    } catch {
      Darwin.close(socketDescriptor)
      throw error
    }
  }

  private static func setNonBlocking(_ socketDescriptor: Int32) throws {
    let flags = fcntl(socketDescriptor, F_GETFL, 0)
    guard flags >= 0 else {
      throw currentPOSIXError("fcntl(F_GETFL)")
    }
    guard fcntl(socketDescriptor, F_SETFL, flags | O_NONBLOCK) >= 0 else {
      throw currentPOSIXError("fcntl(F_SETFL)")
    }
  }

  private static func currentPOSIXError(_ operation: String) -> NSError {
    NSError(
      domain: NSPOSIXErrorDomain,
      code: Int(errno),
      userInfo: [NSLocalizedDescriptionKey: "\(operation) failed: \(String(cString: strerror(errno)))"]
    )
  }

  private func acceptAvailableClients() {
    while true {
      let clientSocket = Darwin.accept(listenSocket, nil, nil)
      if clientSocket < 0 {
        if errno == EWOULDBLOCK || errno == EAGAIN {
          return
        }
        return
      }
      do {
        try Self.setNonBlocking(clientSocket)
        accept(clientSocket)
      } catch {
        Darwin.close(clientSocket)
      }
    }
  }

  private func accept(_ clientSocket: Int32) {
    let client = BridgeClient(socketDescriptor: clientSocket) { [weak self] client, text in
      self?.handle(text, from: client)
    } onClose: { [weak self] closedClient in
      self?.clients.removeAll { $0 === closedClient }
    }
    client.start()
    clients.append(client)
  }

  private func handle(_ text: String, from client: BridgeClient) {
    guard let data = text.data(using: .utf8) else {
      client.close()
      return
    }
    /**
     CDXC:CliBridgeSecurity 2026-05-15-18:25:
     The localhost bridge accepts privileged native HostCommand payloads.
     Require a per-launch bearer token on every command and close malformed or
     unauthenticated clients before decoding command details.
     */
    guard let envelope = try? decoder.decode(AuthenticatedBridgeCommand.self, from: data),
      constantTimeEquals(envelope.authToken, authToken)
    else {
      client.close()
      return
    }
    client.authenticate()
    do {
      let command = try decoder.decode(HostCommand.self, from: data)
      if case .openFloatingEditor(let editorCommand) = command {
        if editorCommand.editorKind == "monaco" {
          send(
            .terminalError(
              sessionId: "bridge",
              message:
                "Monaco floating editor hosting has moved to the standalone Ghostex Editor app; update the Ghostex CLI."
            ))
          return
        }
        /*
         CDXC:PromptEditor 2026-06-19-16:45:
         Ctrl+G latency repros need to know when the authenticated localhost bridge
         has handed the prompt-editor command to AppKit. Log only request ids,
         booleans, counts, and payload size so bridge timing can be correlated
         with CLI and native-window stages without persisting paths or command text.
         */
        PromptEditorDebugLog.append(
          event: "nativeBridge.command.decoded",
          details: [
            "commandType": "openFloatingEditor",
            "editorKind": editorCommand.editorKind ?? "",
            "envCount": editorCommand.env?.count ?? 0,
            "hasCwd": editorCommand.cwd?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
            "hasFilePath": editorCommand.filePath?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
            "hasOriginatingSessionId": editorCommand.originatingSessionId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
            "hasStatusFile": editorCommand.statusFile?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
            "payloadByteCount": data.count,
            "requestId": editorCommand.requestId ?? "",
          ])
      }
      onCommand(command)
    } catch {
      PromptEditorDebugLog.append(
        event: "nativeBridge.command.decodeFailed",
        details: [
          "errorDomain": (error as NSError).domain,
          "errorCode": (error as NSError).code,
          "payloadByteCount": data.count,
        ])
      send(.terminalError(sessionId: "bridge", message: error.localizedDescription))
    }
  }

  private struct AuthenticatedBridgeCommand: Decodable {
    let authToken: String?
  }

  private func constantTimeEquals(_ left: String?, _ right: String) -> Bool {
    guard let leftData = left?.data(using: .utf8),
      let rightData = right.data(using: .utf8),
      leftData.count == rightData.count
    else {
      return false
    }
    var difference: UInt8 = 0
    for index in 0..<leftData.count {
      difference |= leftData[index] ^ rightData[index]
    }
    return difference == 0
  }
}

private final class BridgeClient {
  private var buffer = Data()
  private var isClosed = false
  private let onClose: (BridgeClient) -> Void
  private let onMessage: (BridgeClient, String) -> Void
  private var pendingWriteBuffer = Data()
  private let socketDescriptor: Int32
  private var source: DispatchSourceRead?
  private var writeSource: DispatchSourceWrite?
  private(set) var isAuthenticated = false

  init(
    socketDescriptor: Int32,
    onMessage: @escaping (BridgeClient, String) -> Void,
    onClose: @escaping (BridgeClient) -> Void
  ) {
    self.socketDescriptor = socketDescriptor
    self.onMessage = onMessage
    self.onClose = onClose
  }

  deinit {
    source?.cancel()
    writeSource?.cancel()
    if !isClosed {
      Darwin.close(socketDescriptor)
    }
  }

  func start() {
    let source = DispatchSource.makeReadSource(fileDescriptor: socketDescriptor, queue: .main)
    source.setEventHandler { [weak self] in
      self?.readAvailableData()
    }
    self.source = source
    source.resume()
  }

  func send(_ text: String) {
    guard let data = "\(text)\n".data(using: .utf8) else {
      return
    }
    /**
     CDXC:AndroidRemoteSessions 2026-05-18-03:01:
     Android plus-button creation and debug state requests can return a large
     sidebar payload. The bridge socket is nonblocking, so a short write must
     keep the unwritten bytes queued until the socket is writable again instead
     of dropping the JSON newline that lets the CLI resolve.
     */
    pendingWriteBuffer.append(data)
    flushPendingWrites()
  }

  func authenticate() {
    isAuthenticated = true
  }

  func close() {
    guard !isClosed else {
      return
    }
    isClosed = true
    source?.cancel()
    source = nil
    writeSource?.cancel()
    writeSource = nil
    pendingWriteBuffer.removeAll()
    Darwin.close(socketDescriptor)
    onClose(self)
  }

  private func flushPendingWrites() {
    guard !isClosed else {
      return
    }
    while !pendingWriteBuffer.isEmpty {
      let written = pendingWriteBuffer.withUnsafeBytes { rawBuffer -> Int in
        guard let baseAddress = rawBuffer.baseAddress else {
          return 0
        }
        return Darwin.write(socketDescriptor, baseAddress, rawBuffer.count)
      }
      if written > 0 {
        pendingWriteBuffer.removeSubrange(..<written)
        continue
      }
      if errno == EINTR {
        continue
      }
      if errno == EWOULDBLOCK || errno == EAGAIN {
        ensureWriteSource()
        return
      }
      close()
      return
    }
    writeSource?.cancel()
    writeSource = nil
  }

  private func ensureWriteSource() {
    guard writeSource == nil, !isClosed else {
      return
    }
    let source = DispatchSource.makeWriteSource(fileDescriptor: socketDescriptor, queue: .main)
    source.setEventHandler { [weak self] in
      self?.flushPendingWrites()
    }
    writeSource = source
    source.resume()
  }

  private func readAvailableData() {
    var chunk = [UInt8](repeating: 0, count: 16 * 1024)
    while true {
      let count = read(socketDescriptor, &chunk, chunk.count)
      if count > 0 {
        buffer.append(chunk, count: count)
        emitCompleteLines()
        continue
      }
      if count == 0 {
        close()
        return
      }
      if errno == EINTR {
        continue
      }
      if errno == EWOULDBLOCK || errno == EAGAIN {
        return
      }
      close()
      return
    }
  }

  private func emitCompleteLines() {
    while let newlineIndex = buffer.firstIndex(of: 10) {
      let lineData = Data(buffer[..<newlineIndex])
      buffer.removeSubrange(...newlineIndex)
      guard !lineData.isEmpty, let line = String(data: lineData, encoding: .utf8) else {
        continue
      }
      onMessage(self, line)
    }
  }
}
