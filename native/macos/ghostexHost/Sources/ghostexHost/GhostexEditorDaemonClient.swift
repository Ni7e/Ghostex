import Darwin
import Foundation

/// Minimal JSON-line client for the standalone GhostexEditor daemon socket
/// (protocol v1; server side in editor/macos DaemonSupport.swift). Requests
/// block with short deadlines, so callers must stay off the main thread.
enum GhostexEditorDaemonClient {
  private static let protocolVersion = 1
  private static let responseTimeoutMilliseconds: Int32 = 750

  static func openEditorCount() -> Int {
    guard let response = sendRequest(["v": protocolVersion, "type": "ping"]),
      response["type"] as? String == "pong",
      let openCount = response["openCount"] as? NSNumber
    else {
      return 0
    }
    return openCount.intValue
  }

  static func bringEditorWindowsToFront() {
    _ = sendRequest(["v": protocolVersion, "type": "front"])
  }

  /// Blocking watch subscription: connects, sends a "watch" request, and
  /// invokes onChange for the initial "watching" reply and every
  /// "openCountChanged" push from the daemon. Returns when the daemon is
  /// unreachable or drops the connection; callers own the reconnect cadence
  /// and must stay off the main thread.
  static func watchOpenCount(onChange: (Int) -> Void) {
    guard let fileDescriptor = connectSocket() else {
      return
    }
    defer {
      Darwin.close(fileDescriptor)
    }

    guard var line = try? JSONSerialization.data(withJSONObject: [
      "v": protocolVersion,
      "type": "watch",
    ]) else {
      return
    }
    line.append(0x0A)
    guard writeAll(line, to: fileDescriptor) else {
      return
    }

    readLinesUntilClosed(from: fileDescriptor) { lineData in
      guard let object = (try? JSONSerialization.jsonObject(with: lineData)) as? [String: Any],
        let type = object["type"] as? String,
        type == "watching" || type == "openCountChanged",
        let openCount = object["openCount"] as? NSNumber
      else {
        return
      }
      onChange(openCount.intValue)
    }
  }

  /// Mirror of the daemon's `resolveSocketPath`: env override, then XDG
  /// runtime dir, then ~/.ghostex.
  private static func socketPath() -> String {
    let environment = ProcessInfo.processInfo.environment
    if let value = environment["GHOSTEX_EDITOR_SOCKET"], !value.isEmpty {
      return value
    }
    if let runtimeDirectory = environment["XDG_RUNTIME_DIR"], !runtimeDirectory.isEmpty {
      return URL(fileURLWithPath: runtimeDirectory)
        .appendingPathComponent("ghostex-editor.sock").path
    }
    return FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".ghostex", isDirectory: true)
      .appendingPathComponent("ghostex-editor.sock").path
  }

  private static func sendRequest(_ request: [String: Any]) -> [String: Any]? {
    guard JSONSerialization.isValidJSONObject(request),
      var line = try? JSONSerialization.data(withJSONObject: request)
    else {
      return nil
    }
    line.append(0x0A)

    guard let fileDescriptor = connectSocket() else {
      return nil
    }
    defer {
      Darwin.close(fileDescriptor)
    }

    guard writeAll(line, to: fileDescriptor) else {
      return nil
    }
    guard let responseLine = readLine(from: fileDescriptor) else {
      return nil
    }
    return (try? JSONSerialization.jsonObject(with: responseLine)) as? [String: Any]
  }

  private static func connectSocket() -> Int32? {
    let fileDescriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fileDescriptor >= 0 else {
      return nil
    }
    var noSigPipe: Int32 = 1
    setsockopt(
      fileDescriptor,
      SOL_SOCKET,
      SO_NOSIGPIPE,
      &noSigPipe,
      socklen_t(MemoryLayout<Int32>.size)
    )

    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = Array(socketPath().utf8CString)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard pathBytes.count <= capacity else {
      Darwin.close(fileDescriptor)
      return nil
    }
    withUnsafeMutablePointer(to: &address.sun_path) { pointer in
      pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { rawPath in
        for (offset, byte) in pathBytes.enumerated() {
          rawPath[offset] = byte
        }
      }
    }
    let addressLength = socklen_t(
      (MemoryLayout<sockaddr_un>.offset(of: \.sun_path) ?? 0) + pathBytes.count)
    let connectResult = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
        Darwin.connect(fileDescriptor, socketAddress, addressLength)
      }
    }
    guard connectResult == 0 else {
      Darwin.close(fileDescriptor)
      return nil
    }
    return fileDescriptor
  }

  /// Reads newline-delimited frames with no deadline until the peer closes
  /// the connection or a read error occurs. Used by the watch subscription,
  /// which is push-driven and can stay silent indefinitely.
  private static func readLinesUntilClosed(from fileDescriptor: Int32, onLine: (Data) -> Void) {
    var buffer = Data()
    while true {
      var pollDescriptor = pollfd(fd: fileDescriptor, events: Int16(POLLIN), revents: 0)
      let pollResult = poll(&pollDescriptor, 1, -1)
      if pollResult < 0 {
        if errno == EINTR {
          continue
        }
        return
      }
      guard (pollDescriptor.revents & Int16(POLLIN)) != 0 else {
        return
      }

      var bytes = [UInt8](repeating: 0, count: 4096)
      let byteCapacity = bytes.count
      let count = bytes.withUnsafeMutableBytes { rawBuffer in
        Darwin.read(fileDescriptor, rawBuffer.baseAddress, byteCapacity)
      }
      if count <= 0 {
        return
      }
      buffer.append(contentsOf: bytes.prefix(count))
      while let newlineIndex = buffer.firstIndex(of: 0x0A) {
        onLine(buffer.prefix(upTo: newlineIndex))
        buffer.removeSubrange(buffer.startIndex...newlineIndex)
      }
    }
  }

  private static func writeAll(_ data: Data, to fileDescriptor: Int32) -> Bool {
    var bytesWritten = 0
    return data.withUnsafeBytes { rawBuffer in
      guard let baseAddress = rawBuffer.baseAddress else {
        return false
      }
      while bytesWritten < data.count {
        let result = Darwin.write(
          fileDescriptor,
          baseAddress.advanced(by: bytesWritten),
          data.count - bytesWritten
        )
        if result > 0 {
          bytesWritten += result
          continue
        }
        if result < 0 && errno == EINTR {
          continue
        }
        return false
      }
      return true
    }
  }

  private static func readLine(from fileDescriptor: Int32) -> Data? {
    var buffer = Data()
    let deadline = Date().addingTimeInterval(TimeInterval(responseTimeoutMilliseconds) / 1_000)

    while Date() < deadline {
      var pollDescriptor = pollfd(fd: fileDescriptor, events: Int16(POLLIN), revents: 0)
      let remainingMilliseconds = max(1, Int32(deadline.timeIntervalSinceNow * 1_000))
      let pollResult = poll(&pollDescriptor, 1, remainingMilliseconds)
      if pollResult == 0 {
        return nil
      }
      if pollResult < 0 {
        if errno == EINTR {
          continue
        }
        return nil
      }
      guard (pollDescriptor.revents & Int16(POLLIN)) != 0 else {
        return nil
      }

      var bytes = [UInt8](repeating: 0, count: 4096)
      let byteCapacity = bytes.count
      let count = bytes.withUnsafeMutableBytes { rawBuffer in
        Darwin.read(fileDescriptor, rawBuffer.baseAddress, byteCapacity)
      }
      if count <= 0 {
        return nil
      }
      buffer.append(contentsOf: bytes.prefix(count))
      if let newlineIndex = buffer.firstIndex(of: 0x0A) {
        return buffer.prefix(upTo: newlineIndex)
      }
    }

    return nil
  }
}
