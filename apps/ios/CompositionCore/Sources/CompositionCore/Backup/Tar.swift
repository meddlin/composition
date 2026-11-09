import Foundation

// A minimal streaming tar.gz writer and reader, the Swift twin of `tarArchive.ts`. A backup must stay readable by plain
// `tar -xzf`, only ever holds regular files, and is read strictly: it is fed files from anywhere.
//
//   Written: ustar headers, GNU long names for paths over 100 bytes.
//   Read:    regular files only. A link, device, FIFO or anything else is refused rather than skipped, since skipping
//            would hide a hostile archive. POSIX (`x`) and GNU (`L`) path extensions are understood, so an archive
//            re-created with the system `tar` still restores.

private let block = 512
private let ioChunk = 64 * 1024
/// ustar's size field is 11 octal digits.
private let maxEntrySize: Int64 = 0o77777777777
private let maxExtensionBytes = 64 * 1024

// MARK: - Writing

final class TarWriter {
    private let gzip: GzipWriter
    private let modified: Int

    init(gzip: GzipWriter, now: Date = Date()) {
        self.gzip = gzip
        modified = Int(now.timeIntervalSince1970)
    }

    /// A small file held in memory, such as the manifest.
    func addFile(named name: String, contents: Data) throws {
        try writeHeader(name: name, size: Int64(contents.count))
        try gzip.write(contents)
        try gzip.write(Self.padding(Int64(contents.count)))
    }

    /// A file streamed from disk. Its size is read from the open file, so the header and the bytes cannot disagree.
    /// A file that has gone since the folder was listed is not part of the backup.
    func addFile(named name: String, from url: URL) throws {
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: url) } catch CocoaError.fileReadNoSuchFile { return }
        defer { try? handle.close() }

        let size = Int64(try handle.seekToEnd())
        try handle.seek(toOffset: 0)
        try writeHeader(name: name, size: size)
        var remaining = size
        while remaining > 0 {
            // A pool per chunk: `FileHandle.read` returns autoreleased data, which would otherwise pile up for the whole
            // file (measured: peak memory was 2.3 times the attachment) until the calling thread's pool drained.
            try autoreleasepool {
                guard let chunk = try handle.read(upToCount: Int(min(Int64(ioChunk), remaining))), !chunk.isEmpty else {
                    throw BackupError.shrank(url.path)
                }
                remaining -= Int64(chunk.count)
                try gzip.write(chunk)
            }
        }
        try gzip.write(Self.padding(size))
    }

    /// Two empty blocks, then the end of the gzip stream.
    func finish() throws {
        try gzip.write(Data(count: block * 2))
        try gzip.finish()
    }

    private func writeHeader(name: String, size: Int64) throws {
        guard size <= maxEntrySize else { throw BackupError.tooLarge(name) }
        let nameBytes = Data(name.utf8)
        if nameBytes.count > 100 {
            let body = nameBytes + Data([0])
            try gzip.write(Self.header(name: "././@LongLink", size: Int64(body.count), modified: 0, type: "L"))
            try gzip.write(body)
            try gzip.write(Self.padding(Int64(body.count)))
        }
        try gzip.write(Self.header(name: name, size: size, modified: modified, type: "0"))
    }

    private static func octal(_ value: Int, width: Int) -> [UInt8] {
        Array(String(value, radix: 8).leftPadded(to: width - 1, with: "0").utf8) + [0]
    }

    private static func header(name: String, size: Int64, modified: Int, type: Character) -> Data {
        var bytes = [UInt8](repeating: 0, count: block)
        func put(_ field: [UInt8], at offset: Int) { bytes.replaceSubrange(offset..<offset + field.count, with: field) }

        put(Array(Data(name.utf8).prefix(100)), at: 0)
        put(octal(0o644, width: 8), at: 100)
        put(octal(0, width: 8), at: 108)  // uid
        put(octal(0, width: 8), at: 116)  // gid
        put(octal(Int(size), width: 12), at: 124)
        put(octal(modified, width: 12), at: 136)
        put([UInt8](repeating: 0x20, count: 8), at: 148)  // the checksum is computed with this field as spaces
        put(Array(String(type).utf8), at: 156)
        put(Array("ustar\0".utf8), at: 257)
        put(Array("00".utf8), at: 263)
        let sum = bytes.reduce(0) { $0 + Int($1) }
        put(Array(String(sum, radix: 8).leftPadded(to: 6, with: "0").utf8) + [0, 0x20], at: 148)
        return Data(bytes)
    }

    private static func padding(_ size: Int64) -> Data {
        Data(count: Int((Int64(block) - size % Int64(block)) % Int64(block)))
    }
}

extension String {
    fileprivate func leftPadded(to width: Int, with pad: Character) -> String {
        count >= width ? self : String(repeating: pad, count: width - count) + self
    }
}

// MARK: - Reading

/// Pulls exact byte counts out of a gzip stream.
private final class ByteReader {
    private let gzip: GzipReader

    init(gzip: GzipReader) { self.gzip = gzip }

    /// Up to `count` bytes; fewer only at the end of the stream.
    func take(_ count: Int) throws -> Data {
        var taken = Data()
        while taken.count < count {
            let more = try gzip.read(upTo: count - taken.count)
            if more.isEmpty { break }
            taken.append(more)
        }
        return taken
    }

    func skip(_ count: Int64) throws {
        var remaining = count
        while remaining > 0 {
            try autoreleasepool {  // see `TarWriter.addFile(named:from:)`
                let taken = try take(Int(min(remaining, 1024 * 1024)))
                if taken.isEmpty { throw BackupError.endsUnexpectedly }
                remaining -= Int64(taken.count)
            }
        }
    }
}

/// The bytes of the entry being visited; stops at the entry's size.
final class TarEntryData {
    fileprivate var remaining: Int64
    fileprivate let reader: ByteReader

    fileprivate init(size: Int64, reader: ByteReader) {
        remaining = size
        self.reader = reader
    }

    /// Up to `count` bytes; empty at the end of the entry.
    func read(upTo count: Int = ioChunk) throws -> Data {
        guard remaining > 0 else { return Data() }
        let chunk = try reader.take(Int(min(Int64(count), remaining)))
        if chunk.isEmpty { throw BackupError.endsUnexpectedly }
        remaining -= Int64(chunk.count)
        return chunk
    }
}

struct TarEntry {
    let name: String
    let size: Int64
    let data: TarEntryData
}

enum TarReader {
    /// Visits each file in the `.tar.gz` at `url`, in order. `visit` should read `entry.data` to the end; what it leaves is skipped.
    static func forEachFile(in url: URL, _ visit: (TarEntry) throws -> Void) throws {
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: url) } catch { throw BackupError.cannotRead(url.path) }
        defer { try? handle.close() }

        let reader = ByteReader(gzip: try GzipReader(file: handle))
        var pendingName: String?

        while true {
            let header = try reader.take(block)
            if header.count < block { throw BackupError.endsUnexpectedly }
            if header.allSatisfy({ $0 == 0 }) { return }  // end of archive
            guard checksumMatches(header) else { throw BackupError.damaged }

            let type = header[header.startIndex + 156] == 0 ? UInt8(ascii: "0") : header[header.startIndex + 156]
            let size = try parseOctal(header.slice(124, 136))
            let prefix = cString(header.slice(345, 500))
            let own = cString(header.slice(0, 100))
            let name = pendingName ?? (prefix.isEmpty ? own : "\(prefix)/\(own)")
            pendingName = nil
            let padded = (size + Int64(block) - 1) / Int64(block) * Int64(block)

            switch type {
            case UInt8(ascii: "L"), UInt8(ascii: "x"):
                guard size <= maxExtensionBytes else { throw BackupError.damagedHeader }
                let body = try reader.take(Int(padded))
                if body.count < Int(padded) { throw BackupError.endsUnexpectedly }
                let content = body.prefix(Int(size))
                pendingName = type == UInt8(ascii: "L") ? cString(content) : try paxPath(content)
            case UInt8(ascii: "g"), UInt8(ascii: "5"):
                try reader.skip(padded)
            case UInt8(ascii: "0"):
                let data = TarEntryData(size: size, reader: reader)
                try visit(TarEntry(name: name, size: size, data: data))
                // Whatever the visitor left unread, and the padding after the data.
                try reader.skip(data.remaining)
                try reader.skip(padded - size)
            default:
                throw BackupError.containsNonFile(name)
            }
        }
    }

    private static func parseOctal(_ field: Data) throws -> Int64 {
        let text = cString(field).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf8.allSatisfy({ $0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "7") }),
            let value = Int64(text, radix: 8)
        else { throw BackupError.damagedHeader }
        return value
    }

    private static func cString(_ field: Data) -> String {
        let end = field.firstIndex(of: 0) ?? field.endIndex
        return String(decoding: field[field.startIndex..<end], as: UTF8.self)
    }

    private static func checksumMatches(_ header: Data) -> Bool {
        guard let stored = try? parseOctal(header.slice(148, 156)) else { return false }
        var sum: Int64 = 0
        for (offset, byte) in header.enumerated() { sum += (148..<156).contains(offset) ? 0x20 : Int64(byte) }
        return sum == stored
    }

    /// `path=…` from a POSIX extended header's `<length> <key>=<value>\n` records.
    private static func paxPath(_ records: Data) throws -> String? {
        let bytes = Array(records)
        var at = 0
        while at < bytes.count {
            guard let space = bytes[at...].firstIndex(of: 0x20),
                let length = Int(String(decoding: bytes[at..<space], as: UTF8.self)), length > 0,
                at + length <= bytes.count, at + length - 1 >= space + 1
            else { throw BackupError.damagedHeader }
            let record = String(decoding: bytes[(space + 1)..<(at + length - 1)], as: UTF8.self)
            if record.hasPrefix("path=") { return String(record.dropFirst("path=".count)) }
            at += length
        }
        return nil
    }
}

extension Data {
    /// A copy of bytes `from..<to`, indexed from zero.
    fileprivate func slice(_ from: Int, _ to: Int) -> Data { Data(self[(startIndex + from)..<(startIndex + to)]) }
}
