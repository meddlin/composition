import CompositionCore
import CoreGraphics
import Foundation
import Testing

@testable import CompositionInk

// Pixel helpers shared by the ink tests (the drawings are in InkSamples.swift).

/// The red, green, blue and alpha of a pixel (0 to 255, not premultiplied) in a rendered image.
func pixel(_ image: CGImage, x: Int, y: Int) -> (r: Int, g: Int, b: Int, a: Int) {
    var bytes = [UInt8](repeating: 0, count: 4)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(data: &bytes, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setBlendMode(.copy)
    context.draw(image, in: CGRect(x: -x, y: -(image.height - 1 - y), width: image.width, height: image.height))
    let alpha = Int(bytes[3])
    guard alpha > 0 else { return (0, 0, 0, 0) }
    func straight(_ value: UInt8) -> Int { min(255, (Int(value) * 255 + alpha / 2) / alpha) }
    return (straight(bytes[0]), straight(bytes[1]), straight(bytes[2]), alpha)
}

/// How many pixels are not fully transparent.
func inkedPixelCount(_ image: CGImage) -> Int {
    let width = image.width, height = image.height
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return stride(from: 3, to: bytes.count, by: 4).reduce(0) { $0 + (bytes[$1] > 0 ? 1 : 0) }
}

/// `fixtures/conformance/ink` of this checkout, or nil when the tests run somewhere the source tree is not.
enum InkCorpus {
    static let directory: URL? = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        url.appendPathComponent("fixtures/conformance/ink", isDirectory: true)
        return FileManager.default.fileExists(atPath: url.appendingPathComponent("validation.json").path) ? url : nil
    }()
}

extension InkCorpus {
    /// With `UPDATE_FIXTURES` set, rewrites drawing.json, sample.png and the container fixtures from `InkSamples.page()` before any test reads them (tests run in
    /// parallel, so the first one to ask does it, once). `containers.json` says what a reader must find in each; it is only ever edited by hand.
    static let regenerated: Void = {
        guard ProcessInfo.processInfo.environment["UPDATE_FIXTURES"] != nil, let directory else { return }
        let page = InkSamples.page()
        try? page.jsonData().write(to: directory.appendingPathComponent("drawing.json"))
        guard let sample = try? InkRenderer.pngData(of: page, palette: InkPalette(theme: .default), scale: 2) else { return }
        try? sample.write(to: directory.appendingPathComponent("sample.png"))

        // The page again, a hundredth of a point wider, as the chunk a second writer appended after the first.
        var wider = page
        wider.width = 201
        if let second = try? chunkPayload(of: wider) {
            try? appending(chunk: InkPNG.jsonChunk, payload: second, to: sample).write(to: directory.appendingPathComponent("two-chunks.png"))
            try? appending(chunk: InkPNG.jsonChunk, payload: second, badCRC: true, to: sample).write(to: directory.appendingPathComponent("second-chunk-damaged.png"))
        }

        // A drawing too wide for 2 pixels to a point (4,096 points would be 8,192 pixels): its PNG says what it has.
        let wide = InkDocument(width: 5000, height: 40, strokes: [InkStroke(points: [InkPoint(x: 10, y: 20), InkPoint(x: 2500, y: 10, t: 400), InkPoint(x: 4990, y: 20, t: 800)])])
        if let png = try? InkRenderer.pngData(of: wide, palette: InkPalette(theme: .default), scale: 2) { try? png.write(to: directory.appendingPathComponent("wide.png")) }
    }()

    /// The payload of an `inKJ` chunk for `drawing`: the version byte, the length of the text, the text as a zlib stream.
    static func chunkPayload(of drawing: InkDocument) throws -> Data {
        let text = drawing.jsonData()
        var payload = Data([1])
        payload.append(contentsOf: bigEndian(UInt32(text.count)))
        payload.append(try InkPNG.deflate(text))
        return payload
    }

    /// `png` with one more chunk just before IEND, with the CRC that goes with it (or a wrong one).
    static func appending(chunk type: String, payload: Data, badCRC: Bool = false, to png: Data) throws -> Data {
        let chunks = try InkPNG.walk(png)
        let end = try #require(chunks.last)
        var body = Data(type.utf8)
        body.append(payload)
        var out = Data(png[png.startIndex..<end.start])
        out.append(contentsOf: bigEndian(UInt32(payload.count)))
        out.append(body)
        out.append(contentsOf: bigEndian(InkPNG.crc(of: body) ^ (badCRC ? 0xFFFF_FFFF : 0)))
        out.append(png[end.start..<end.end])
        return out
    }

    static func bigEndian(_ value: UInt32) -> [UInt8] { [UInt8(value >> 24), UInt8((value >> 16) & 0xFF), UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF)] }
}
