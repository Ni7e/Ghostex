// CDXC:AppIconPicker 2026-06-25-21:50: Self-contained app-icon image utility. It imports only system frameworks so it can compile standalone with swiftc and stay independent of AppDelegate, GhostexAppStorage, or any host bridge type. Callers pass directory URLs in; this file never reaches into shared app storage itself.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/**
 CDXC:AppIconPicker 2026-06-25-21:50:
 AppIconImage validates, normalizes, and squircle-masks user PNGs for the macOS
 runtime app icon. AppDelegate applies the returned NSImage to
 NSApp.applicationIconImage, NSDockTile, and the bundle custom file icon where
 macOS permits. Every operation returns nil on any failure so the caller can fall
 back to the default bundle icon. Privacy: this file logs nothing and never
 surfaces absolute paths or raw image bytes; callers own privacy-safe logging.
 */
enum AppIconImage {
  // CDXC:AppIconPicker 2026-06-25-21:50: Guardrails shared with the validate step and the folder scan.
  static let maxFileBytes: Int = 5 * 1024 * 1024
  static let maxSourceDimension: Int = 2048
  // CDXC:AppIconPicker 2026-06-25-21:50: The masked Dock icon and cache are normalized to a fixed 1024x1024 square.
  static let maskedDimension: Int = 1024
  // CDXC:AppIconPicker 2026-06-25-21:50: Superellipse exponent for the macOS-style squircle. n=5 closely matches the Big Sur app-icon corner curve.
  static let superellipseExponent: CGFloat = 5.0

  /**
   CDXC:AppIconPicker 2026-06-26-23:42:
   App icon source ids are persisted and bridged as filenames only, never paths.
   Validate at the image utility boundary before any URL is constructed so
   launch restore, picker selection, folder scans, and cache generation cannot
   traverse outside the managed icons directory.
   */
  static func normalizedSourceId(_ sourceId: String) -> String? {
    let trimmed = sourceId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 255 else {
      return nil
    }
    guard trimmed != ".", trimmed != ".." else {
      return nil
    }
    guard !trimmed.contains("/"), !trimmed.contains("\\"), !trimmed.contains("\u{0}") else {
      return nil
    }
    return trimmed
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Validate a candidate PNG without decoding the full bitmap: enforce the file
   byte budget, confirm a real PNG via magic bytes plus UTType, and read the
   header dimensions from the CGImageSource so oversized images are rejected
   before any pixel work. Returns true only for a safe square-or-not PNG within
   guardrails.
   */
  static func isValidSourcePNG(at url: URL) -> Bool {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
      let fileSize = (attributes[.size] as? NSNumber)?.intValue,
      fileSize > 0,
      fileSize <= maxFileBytes
    else {
      return false
    }
    guard isPNGMagicBytes(at: url) else {
      return false
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
      return false
    }
    // CDXC:AppIconPicker 2026-06-25-21:50: Reject anything whose decoded type is not PNG even if the extension/magic looked right.
    guard let typeId = CGImageSourceGetType(source) as String?,
      let decodedType = UTType(typeId),
      decodedType.conforms(to: .png)
    else {
      return false
    }
    guard let header = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = header[kCGImagePropertyPixelWidth] as? Int,
      let height = header[kCGImagePropertyPixelHeight] as? Int,
      width > 0,
      height > 0,
      width <= maxSourceDimension,
      height <= maxSourceDimension
    else {
      return false
    }
    return true
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Produce the masked 1024x1024 squircle PNG data for a validated source file:
   downsample with the ImageIO thumbnail path, center-crop to square, then clip
   to the superellipse. Returns nil on any failure so the caller can fall back.
   */
  static func maskedPNGData(forValidatedSource url: URL) -> Data? {
    guard let downsampled = downsampledImage(at: url, maxPixelSize: maskedDimension) else {
      return nil
    }
    guard let squared = centerCroppedSquare(downsampled) else {
      return nil
    }
    guard let masked = squircleMasked(squared, dimension: maskedDimension) else {
      return nil
    }
    return pngData(from: masked)
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Self-validating masked cache. The cache file name binds the source filename
   and its content-modification time, so a stale cache for an edited file is
   simply a cache miss. On a hit the cached masked PNG is validated as a real
   PNG before reuse; on a miss the mask is regenerated and written. Returns the
   masked CGImage, or nil so the caller falls back to the default icon.
   */
  static func cachedMaskedImage(
    sourceId: String,
    iconsDirectory: URL,
    cacheDirectory: URL
  ) -> CGImage? {
    guard let normalizedSourceId = Self.normalizedSourceId(sourceId) else {
      return nil
    }
    let sourceURL = iconsDirectory.appendingPathComponent(normalizedSourceId, isDirectory: false)
    guard isValidSourcePNG(at: sourceURL) else {
      return nil
    }
    let sourceIdentity = contentModificationIdentity(of: sourceURL)
    let cacheURL = cacheDirectory.appendingPathComponent(
      cacheFileName(sourceId: normalizedSourceId, sourceIdentity: sourceIdentity), isDirectory: false)

    if isPNGMagicBytes(at: cacheURL),
      let cachedImage = cgImage(fromPNGFile: cacheURL)
    {
      return cachedImage
    }

    guard let maskedData = maskedPNGData(forValidatedSource: sourceURL) else {
      return nil
    }
    try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    // CDXC:AppIconPicker 2026-06-25-21:50: Best-effort cache write; a failed write only forces regeneration next launch and must never block applying the icon.
    try? maskedData.write(to: cacheURL, options: [.atomic])
    return cgImage(fromPNGData: maskedData)
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Convenience for applying the runtime app icon: returns an NSImage built from
   the cached masked square, or nil to signal a default-icon fallback. Setting
   NSApp.applicationIconImage / NSDockTile / bundle custom file icon back to the
   default bundle icon is the caller's responsibility.
   */
  static func maskedDockImage(
    sourceId: String,
    iconsDirectory: URL,
    cacheDirectory: URL
  ) -> NSImage? {
    guard let cgImage = cachedMaskedImage(
      sourceId: sourceId, iconsDirectory: iconsDirectory, cacheDirectory: cacheDirectory)
    else {
      return nil
    }
    let size = NSSize(width: maskedDimension, height: maskedDimension)
    return NSImage(cgImage: cgImage, size: size)
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Small masked thumbnail data URL for the sidebar picker list. The thumbnail is
   derived from the same validate+square+squircle pipeline at a reduced size so
   the list and the applied Dock icon look identical. Returns nil on failure.
   */
  static func maskedThumbnailDataURL(
    forValidatedSource url: URL,
    dimension: Int = 128
  ) -> String? {
    guard let downsampled = downsampledImage(at: url, maxPixelSize: dimension),
      let squared = centerCroppedSquare(downsampled),
      let masked = squircleMasked(squared, dimension: dimension),
      let data = pngData(from: masked)
    else {
      return nil
    }
    return "data:image/png;base64,\(data.base64EncodedString())"
  }

  // CDXC:AppIconPicker 2026-06-26-23:42: Cache identity uses sub-second mtime plus file size so quick same-name replacements do not reuse a stale masked icon.
  static func contentModificationIdentity(of url: URL) -> String {
    let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
    let modifiedAt = values?.contentModificationDate ?? Date(timeIntervalSince1970: 0)
    let modifiedNanoseconds = Int64((modifiedAt.timeIntervalSince1970 * 1_000_000_000).rounded())
    let fileSize = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    return "\(modifiedNanoseconds)-\(fileSize)"
  }

  // MARK: - Internal pipeline

  // CDXC:AppIconPicker 2026-06-25-21:50: Confirm the first eight bytes are the PNG signature before trusting any extension or decoder.
  private static func isPNGMagicBytes(at url: URL) -> Bool {
    guard let handle = try? FileHandle(forReadingFrom: url) else {
      return false
    }
    defer { try? handle.close() }
    guard let header = try? handle.read(upToCount: 8), header.count == 8 else {
      return false
    }
    let signature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    return Array(header) == signature
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Downsample using CGImageSourceCreateThumbnailAtIndex so large source PNGs are
   decoded directly to the target size instead of holding a full-resolution
   bitmap in memory.
   */
  private static func downsampledImage(at url: URL, maxPixelSize: Int) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
      return nil
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  // CDXC:AppIconPicker 2026-06-25-21:50: Center-crop to the largest centered square so non-square PNGs are masked without distortion.
  private static func centerCroppedSquare(_ image: CGImage) -> CGImage? {
    let side = min(image.width, image.height)
    guard side > 0 else {
      return nil
    }
    if image.width == image.height {
      return image
    }
    let originX = (image.width - side) / 2
    let originY = (image.height - side) / 2
    let cropRect = CGRect(x: originX, y: originY, width: side, height: side)
    return image.cropping(to: cropRect)
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Clip the square image to a superellipse (n=5) squircle and render onto a
   transparent square via an NSBitmapImageRep-backed context, producing the
   masked CGImage. Builds the superellipse path with NSBezierPath.
   */
  private static func squircleMasked(_ image: CGImage, dimension: Int) -> CGImage? {
    guard dimension > 0 else {
      return nil
    }
    guard let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: dimension,
      pixelsHigh: dimension,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    ) else {
      return nil
    }

    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
      return nil
    }
    let previousContext = NSGraphicsContext.current
    NSGraphicsContext.current = context
    context.cgContext.clear(CGRect(x: 0, y: 0, width: dimension, height: dimension))

    let rect = CGRect(x: 0, y: 0, width: dimension, height: dimension)
    let path = superellipsePath(in: rect, exponent: superellipseExponent)
    path.addClip()
    context.cgContext.draw(image, in: rect)

    context.flushGraphics()
    NSGraphicsContext.current = previousContext

    return bitmap.cgImage
  }

  /**
   CDXC:AppIconPicker 2026-06-25-21:50:
   Build a superellipse |x|^n + |y|^n = 1 path inscribed in rect. n=5 gives the
   rounded-square squircle used by macOS app icons. Sampled at fixed resolution
   for a smooth outline.
   */
  private static func superellipsePath(in rect: CGRect, exponent: CGFloat) -> NSBezierPath {
    let path = NSBezierPath()
    let centerX = rect.midX
    let centerY = rect.midY
    let halfWidth = rect.width / 2.0
    let halfHeight = rect.height / 2.0
    let segments = 720
    let inverseExponent = 1.0 / exponent

    func point(forAngle theta: CGFloat) -> CGPoint {
      let cosT = cos(theta)
      let sinT = sin(theta)
      let x = pow(abs(cosT), inverseExponent) * halfWidth * (cosT < 0 ? -1 : 1)
      let y = pow(abs(sinT), inverseExponent) * halfHeight * (sinT < 0 ? -1 : 1)
      return CGPoint(x: centerX + x, y: centerY + y)
    }

    for index in 0...segments {
      let theta = (CGFloat(index) / CGFloat(segments)) * 2.0 * CGFloat.pi
      let pt = point(forAngle: theta)
      if index == 0 {
        path.move(to: pt)
      } else {
        path.line(to: pt)
      }
    }
    path.close()
    return path
  }

  // CDXC:AppIconPicker 2026-06-25-21:50: Encode a masked CGImage to PNG via NSBitmapImageRep.
  private static func pngData(from image: CGImage) -> Data? {
    let rep = NSBitmapImageRep(cgImage: image)
    return rep.representation(using: .png, properties: [:])
  }

  private static func cgImage(fromPNGFile url: URL) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
      return nil
    }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }

  private static func cgImage(fromPNGData data: Data) -> CGImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
      return nil
    }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }

  // CDXC:AppIconPicker 2026-06-26-23:42: Cache file name binds source filename + sub-second source identity so edited sources are clean cache misses. Source filename is sanitized to filesystem-safe characters.
  private static func cacheFileName(sourceId: String, sourceIdentity: String) -> String {
    let safe = sourceId.unicodeScalars.map { scalar -> Character in
      let isSafe =
        (scalar >= "A" && scalar <= "Z") || (scalar >= "a" && scalar <= "z")
        || (scalar >= "0" && scalar <= "9") || scalar == "-" || scalar == "_" || scalar == "."
      return isSafe ? Character(scalar) : "_"
    }
    return "\(String(safe))-\(sourceIdentity).masked.png"
  }
}
