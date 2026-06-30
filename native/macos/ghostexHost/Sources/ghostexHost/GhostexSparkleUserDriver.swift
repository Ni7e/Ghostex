import Sparkle

final class GhostexSparkleUserDriver: SPUStandardUserDriver {
  var onDownloadActiveChanged: ((Bool) -> Void)?
  var onDownloadProgressChanged: ((Double?) -> Void)?

  private var downloadExpectedContentLength: UInt64?
  private var downloadReceivedContentLength: UInt64 = 0

  /**
   CDXC:AutoUpdate 2026-06-08-19:16:
   Ghostex should keep Sparkle's supported release-notes, signature validation,
   install, relaunch, permission, and error handling UI, but it must not show
   the download or extraction status windows because the standard progress text
   exposes the app archive size. Suppress only the middle status callbacks so
   users see the changelog choice first and the install/relaunch choice next.

   CDXC:AutoUpdate 2026-06-13-17:52:
   While Sparkle is downloading the accepted update, the titlebar download
   button should show active download state instead of opening a separate
   progress window. Emit download-active changes from Sparkle's real download
   callbacks so React indicates activity only during the supported updater
   download phase.

   CDXC:AutoUpdate 2026-06-30-22:18:
   The titlebar update button should show a real circular fill progress and a
   percent in the hover label. Track Sparkle's byte callbacks inside this user
   driver but publish only a normalized 0...1 ratio so the UI never receives
   archive sizes or raw byte counts.
   */
  override func showDownloadInitiated(cancellation: @escaping () -> Void) {
    resetDownloadProgress()
    onDownloadActiveChanged?(true)
    onDownloadProgressChanged?(nil)
  }

  override func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    downloadExpectedContentLength = expectedContentLength > 0 ? expectedContentLength : nil
    emitDownloadProgress()
  }

  override func showDownloadDidReceiveData(ofLength length: UInt64) {
    let (sum, overflow) = downloadReceivedContentLength.addingReportingOverflow(length)
    downloadReceivedContentLength = overflow ? UInt64.max : sum
    emitDownloadProgress()
  }

  override func showDownloadDidStartExtractingUpdate() {
    onDownloadActiveChanged?(false)
    resetDownloadProgress()
    onDownloadProgressChanged?(nil)
  }

  override func showExtractionReceivedProgress(_ progress: Double) {
    onDownloadActiveChanged?(false)
    resetDownloadProgress()
    onDownloadProgressChanged?(nil)
  }

  private func resetDownloadProgress() {
    downloadExpectedContentLength = nil
    downloadReceivedContentLength = 0
  }

  private func emitDownloadProgress() {
    guard let expected = downloadExpectedContentLength, expected > 0 else {
      onDownloadProgressChanged?(nil)
      return
    }
    let received = min(downloadReceivedContentLength, expected)
    let progress = min(max(Double(received) / Double(expected), 0), 1)
    onDownloadProgressChanged?(progress)
  }
}
