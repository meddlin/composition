import CompositionCore
import Foundation
import zlib

// The PNG that carries its own source (docs/architecture/ink.md, "The container"): the ink drawn on transparent pixels, as any PNG, plus
// two private chunks before IEND. Everything that shows an image (the CLI, the desktop, a backup's viewer) sees the pixels and ignores the
// chunks; the iPad and the web renderer read the stroke JSON; the iPad alone reads the PencilKit blob.
//
//   inKJ  the stroke JSON:   version byte (1) · length of the text, 4 bytes big endian · the text as a zlib stream
//   inKP  PencilKit's blob:  version byte (1) · the bytes of `PKDrawing.dataRepresentation()`
//
// The chunk names follow the PNG rules for private chunks: ancillary (first letter lower case), private (second lower case), the reserved
// bit upper case, and **unsafe to copy** (last letter upper case), so an editor that changes the pixels drops them instead of carrying
// strokes that no longer match what is drawn. (`iTXt`, which draw.io-style files use, is safe to copy, and so would go stale.)

public enum InkPNG {
    public static let jsonChunk = "inKJ"
    public static let pencilKitChunk = "inKP"
    static let chunkVersion: UInt8 = 1
    static let signature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

    /// What a drawing's PNG carries besides pixels. A chunk that is absent, damaged, or of a newer version is nil, and `problems` says why.
    public struct Contents: Equatable, Sendable {
        public var strokeJSON: Data?
        public var pencilKit: Data?
        public var problems: [String] = []

        /// The stroke JSON read as a drawing; nil when the PNG carries none, and an error when it carries some that cannot be read (the caller
        /// then shows the PNG's pixels and offers no editing).
        public func drawing() throws -> InkDocument? {
            try strokeJSON.map { try InkDocument(data: $0) }
        }
    }

    // MARK: Writing

    /// `png` with its ink chunks replaced by these (an absent one is left out). `png` must be a PNG; any ink chunks it already has go.
    public static func embedding(drawing: InkDocument?, pencilKit: Data?, in png: Data) throws -> Data {
        var json: Data?
        if let drawing {
            let text = drawing.jsonData()
            guard text.count <= InkLimits.maxJSONBytes else { throw InkError("This drawing is too large to save.") }
            var payload = Data([chunkVersion])
            payload.append(bigEndian: UInt32(text.count))
            payload.append(try deflate(text))
            json = payload
        }
        var blob: Data?
        if let pencilKit {
            var payload = Data([chunkVersion])
            payload.append(pencilKit)
            blob = payload
        }

        let chunks = try walk(png)
        guard let end = chunks.last, end.type == "IEND" else { throw InkError("This PNG has no end.") }
        var out = Data(capacity: png.count + (json?.count ?? 0) + (blob?.count ?? 0) + 32)
        out.append(contentsOf: signature)
        for chunk in chunks.dropLast() where chunk.type != jsonChunk && chunk.type != pencilKitChunk {
            out.append(png[chunk.start..<chunk.end])
        }
        if let json { out.append(chunk: jsonChunk, payload: json) }
        if let blob { out.append(chunk: pencilKitChunk, payload: blob) }
        out.append(png[end.start..<end.end])
        return out
    }

    // MARK: Reading

    /// The ink chunks of a PNG. A PNG without them is not an error: its `Contents` is empty. A PNG whose structure is broken is.
    public static func contents(of png: Data) throws -> Contents {
        var contents = Contents()
        for chunk in try walk(png) where chunk.type == jsonChunk || chunk.type == pencilKitChunk {
            let body = png[(chunk.start + 8)..<(chunk.end - 4)]
            let stored = readBigEndian(png, at: chunk.end - 4)
            guard crc(of: png[(chunk.start + 4)..<(chunk.end - 4)]) == stored else {
                contents.problems.append("The \(chunk.type) chunk is damaged.")
                continue
            }
            guard body.first == chunkVersion else {
                contents.problems.append("The \(chunk.type) chunk is from a newer version.")
                continue
            }
            let payload = body.dropFirst()
            if chunk.type == jsonChunk {
                guard payload.count >= 4 else { contents.problems.append("The \(jsonChunk) chunk is short."); continue }
                let size = Int(readBigEndian(payload, at: payload.startIndex))
                guard size <= InkLimits.maxJSONBytes, let text = inflate(payload.dropFirst(4), size: size) else {
                    contents.problems.append("The \(jsonChunk) chunk does not unpack.")
                    continue
                }
                contents.strokeJSON = text
            } else {
                contents.pencilKit = Data(payload)
            }
        }
        return contents
    }

    /// How many pixels the PNG has to a point of its drawing's canvas: its `pHYs` chunk (pixels to a metre, 72 dots to an inch being a pixel to a point),
    /// to a hundredth; 2 when it has none, or one that is not in metres, or not square, as every drawing before the chunk was written is 2x. A PNG whose
    /// structure is broken is 2 as well: the caller is showing it as a picture, and 2 is what the iPad draws at.
    public static func pixelsPerPoint(of png: Data) -> Double {
        let fallback = 2.0
        guard let chunks = try? walk(png), let phys = chunks.first(where: { $0.type == "pHYs" }), phys.end - phys.start == 12 + 9 else { return fallback }
        let x = readBigEndian(png, at: phys.start + 8), y = readBigEndian(png, at: phys.start + 12)
        guard png[phys.start + 16] == 1, x == y, x > 0 else { return fallback }
        let density = (Double(x) * 0.0254 / 72 * 100).rounded() / 100
        return density > 0 ? density : fallback
    }

    // MARK: Chunks

    struct Chunk {
        let type: String
        /// Offsets in the file of the length field and the end of the CRC.
        let start: Int
        let end: Int
    }

    /// The chunks of a PNG in order, checked for structure (signature, lengths, IHDR first, IEND last) but not for CRCs.
    static func walk(_ png: Data) throws -> [Chunk] {
        let base = png.startIndex
        guard png.count >= signature.count + 12, Array(png.prefix(signature.count)) == signature else { throw InkError("This is not a PNG.") }
        var chunks: [Chunk] = []
        var offset = signature.count
        while offset + 12 <= png.count {
            let length = Int(readBigEndian(png, at: base + offset))
            let end = offset + 12 + length
            guard length <= 0x7FFF_FFFF, end <= png.count else { throw InkError("This PNG is cut short.") }
            let type = String(decoding: png[(base + offset + 4)..<(base + offset + 8)], as: UTF8.self)
            if chunks.isEmpty, type != "IHDR" { throw InkError("This PNG does not start with its header.") }
            chunks.append(Chunk(type: type, start: base + offset, end: base + end))
            offset = end
            if type == "IEND" { break }
        }
        guard chunks.last?.type == "IEND" else { throw InkError("This PNG has no end.") }
        return chunks
    }

    static func readBigEndian(_ data: Data, at index: Int) -> UInt32 {
        (UInt32(data[index]) << 24) | (UInt32(data[index + 1]) << 16) | (UInt32(data[index + 2]) << 8) | UInt32(data[index + 3])
    }

    static func crc(of bytes: Data) -> UInt32 {
        bytes.withUnsafeBytes { raw in
            UInt32(truncatingIfNeeded: zlib.crc32(0, raw.bindMemory(to: Bytef.self).baseAddress, uInt(bytes.count)))
        }
    }

    // MARK: zlib

    static func deflate(_ data: Data) throws -> Data {
        var size = compressBound(uLong(data.count))
        var out = Data(count: Int(size))
        let status = out.withUnsafeMutableBytes { dest in
            data.withUnsafeBytes { source in
                compress2(dest.bindMemory(to: Bytef.self).baseAddress, &size, source.bindMemory(to: Bytef.self).baseAddress, uLong(data.count), 6)
            }
        }
        guard status == Z_OK else { throw InkError("The strokes could not be compressed.") }
        out.removeSubrange(Int(size)...)
        return out
    }

    /// The `size` bytes a zlib stream holds, or nil when it holds anything else.
    static func inflate(_ data: Data, size: Int) -> Data? {
        var out = Data(count: size)
        var written = uLong(size)
        let status = out.withUnsafeMutableBytes { dest in
            data.withUnsafeBytes { source in
                uncompress(dest.bindMemory(to: Bytef.self).baseAddress, &written, source.bindMemory(to: Bytef.self).baseAddress, uLong(data.count))
            }
        }
        return status == Z_OK && Int(written) == size ? out : nil
    }
}

extension Data {
    fileprivate mutating func append(bigEndian value: UInt32) {
        append(contentsOf: [UInt8(value >> 24), UInt8((value >> 16) & 0xFF), UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF)])
    }

    fileprivate mutating func append(chunk type: String, payload: Data) {
        append(bigEndian: UInt32(payload.count))
        var body = Data(type.utf8)
        body.append(payload)
        append(body)
        append(bigEndian: InkPNG.crc(of: body))
    }
}
