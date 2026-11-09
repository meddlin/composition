import Foundation
import Testing

@testable import CompositionCore

/// Compresses `data` into a gzip file at `url`, in as many writes as `pieces` says.
private func gzip(_ data: Data, to url: URL, pieces: Int = 1) throws {
    FileManager.default.createFile(atPath: url.path, contents: nil)
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    let writer = try GzipWriter(file: handle)
    let size = max(1, data.count / pieces)
    var offset = 0
    while offset < data.count {
        try writer.write(data.subdata(in: offset..<min(offset + size, data.count)))
        offset += size
    }
    try writer.finish()
}

/// Everything in the gzip file at `url`, read in pieces of `chunk` bytes.
private func gunzip(_ url: URL, chunk: Int = 64 * 1024) throws -> Data {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    let reader = try GzipReader(file: handle)
    var result = Data()
    while case let part = try reader.read(upTo: chunk), !part.isEmpty { result.append(part) }
    return result
}

/// Bytes that compress and bytes that do not, in sizes either side of the 64 KiB buffers.
private func sample(_ size: Int, random: Bool) -> Data {
    if random {
        var data = Data(count: size)
        data.withUnsafeMutableBytes { if $0.count > 0 { _ = SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) } }
        return data
    }
    return Data((0..<size).map { UInt8(truncatingIfNeeded: $0 / 7) })
}

@Suite("Gzip")
struct GzipTests {
    @Test("round-trips every size around the buffer boundaries, compressible or not")
    func roundTrip() throws {
        try withScratch { scratch in
            let file = scratch.directory.appendingPathComponent("x.gz")
            for size in [0, 1, 511, 512, 65_535, 65_536, 65_537, 1_000_000, 5_000_000] {
                for random in [false, true] {
                    let data = sample(size, random: random)
                    try gzip(data, to: file, pieces: 3)
                    #expect(try gunzip(file) == data, "size \(size), random \(random)")
                    // One byte per read, for the small sizes, exercises every refill and boundary in the reader.
                    if size <= 5000 { #expect(try gunzip(file, chunk: 1) == data, "size \(size), one byte at a time") }
                }
            }
        }
    }

    @Test("reads several gzip members as one stream, and ignores bytes after the last")
    func members() throws {
        try withScratch { scratch in
            let a = scratch.directory.appendingPathComponent("a.gz")
            let b = scratch.directory.appendingPathComponent("b.gz")
            let first = sample(100_000, random: false), second = sample(70_000, random: true)
            try gzip(first, to: a)
            try gzip(second, to: b)

            let joined = scratch.directory.appendingPathComponent("joined.gz")
            try (Data(contentsOf: a) + Data(contentsOf: b)).write(to: joined)
            #expect(try gunzip(joined) == first + second)

            try (Data(contentsOf: a) + Data(count: 1024)).write(to: joined)  // zero padding, as tape-style tools leave
            #expect(try gunzip(joined) == first)
        }
    }

    @Test("refuses bytes that are not gzip, and a stream that stops early")
    func refuses() throws {
        try withScratch { scratch in
            let file = scratch.directory.appendingPathComponent("x.gz")
            try sample(5000, random: true).write(to: file)
            #expect(throws: BackupError.damaged) { try gunzip(file) }

            try gzip(sample(300_000, random: true), to: file)
            let whole = try Data(contentsOf: file)
            try whole.prefix(whole.count / 2).write(to: file)
            #expect(throws: BackupError.endsUnexpectedly) { try gunzip(file) }

            try Data().write(to: file)
            #expect(throws: BackupError.endsUnexpectedly) { try gunzip(file) }
        }
    }

    @Test("refuses a flipped bit in the middle, which the CRC or the deflate stream catches")
    func corrupted() throws {
        try withScratch { scratch in
            let file = scratch.directory.appendingPathComponent("x.gz")
            try gzip(sample(200_000, random: true), to: file)
            var bytes = try Data(contentsOf: file)
            bytes[bytes.count / 2] ^= 0x10
            try bytes.write(to: file)
            #expect(throws: BackupError.self) { try gunzip(file) }
        }
    }

    #if os(macOS)
    @Test("what we write, the system gzip reads and verifies; what it writes, we read")
    func systemGzip() throws {
        try withScratch { scratch in
            let data = sample(3_000_000, random: false) + sample(200_000, random: true)
            let ours = scratch.directory.appendingPathComponent("ours.gz")
            try gzip(data, to: ours, pieces: 7)
            try run("/usr/bin/gzip", ["-t", ours.path])
            #expect(try run("/usr/bin/gzip", ["-dc", ours.path]) == data)

            // `gzip FILE` records the file's name and time in the header; reading must skip those.
            let plain = scratch.directory.appendingPathComponent("plain.bin")
            try data.write(to: plain)
            let theirs = try run("/usr/bin/gzip", ["-c", plain.path])
            let theirsFile = scratch.directory.appendingPathComponent("theirs.gz")
            try theirs.write(to: theirsFile)
            #expect(try gunzip(theirsFile) == data)
        }
    }
    #endif
}

@Suite("Tar")
struct TarTests {
    private func write(_ files: [(String, Data)], to url: URL) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        let tar = TarWriter(gzip: try GzipWriter(file: handle))
        for (name, contents) in files { try tar.addFile(named: name, contents: contents) }
        try tar.finish()
    }

    private func read(_ url: URL) throws -> [(String, Data)] {
        var found: [(String, Data)] = []
        try TarReader.forEachFile(in: url) { entry in
            var body = Data()
            while case let chunk = try entry.data.read(), !chunk.isEmpty { body.append(chunk) }
            #expect(Int64(body.count) == entry.size)
            found.append((entry.name, body))
        }
        return found
    }

    @Test("round-trips files, including names over 100 bytes and non-ASCII names, and empty files")
    func roundTrip() throws {
        try withScratch { scratch in
            let long = "attachments/" + String(repeating: "a", count: 120) + ".txt"
            let files: [(String, Data)] = [
                ("composition-backup.json", Data("{}".utf8)),
                ("empty", Data()),
                ("exact-block", sample(512, random: true)),
                ("just-over", sample(513, random: true)),
                (long, sample(1000, random: false)),
                ("app_data/café-résumé.png", sample(70_000, random: true)),
            ]
            let file = scratch.directory.appendingPathComponent("x.tar.gz")
            try write(files, to: file)
            let back = try read(file)
            #expect(back.map(\.0) == files.map(\.0))
            #expect(back.map(\.1) == files.map(\.1))
        }
    }

    @Test("skips the data a visitor leaves unread")
    func unreadData() throws {
        try withScratch { scratch in
            let file = scratch.directory.appendingPathComponent("x.tar.gz")
            try write([("one", sample(100_000, random: true)), ("two", Data("second".utf8))], to: file)
            var names: [String] = []
            var second = Data()
            try TarReader.forEachFile(in: file) { entry in
                names.append(entry.name)
                if entry.name == "two" { second = try entry.data.read() }
            }
            #expect(names == ["one", "two"])
            #expect(second == Data("second".utf8))
        }
    }

    @Test("refuses a header whose checksum is wrong, and an archive cut short")
    func refuses() throws {
        try withScratch { scratch in
            // Written uncompressed-in-effect by building the tar bytes ourselves, then gzipping them.
            let file = scratch.directory.appendingPathComponent("x.tar.gz")
            try write([("name", Data("data".utf8))], to: file)
            var tar = try gunzip(file)
            tar[10] ^= 0x01  // a byte of the name, inside the checksummed header
            try gzip(tar, to: file)
            #expect(throws: BackupError.damaged) { try read(file) }

            try write([("name", sample(5000, random: true))], to: file)
            var cut = try gunzip(file)
            cut.removeLast(cut.count - 700)  // header, then 188 of 5000 bytes
            try gzip(cut, to: file)
            #expect(throws: BackupError.endsUnexpectedly) { try read(file) }
        }
    }

    @Test("refuses anything but plain files: a link, a device, a FIFO")
    func refusesNonFiles() throws {
        try withScratch { scratch in
            let file = scratch.directory.appendingPathComponent("x.tar.gz")
            for (type, label) in [("2", "symlink"), ("1", "hard link"), ("3", "character device"), ("6", "FIFO")] {
                try write([("composition.db", Data())], to: file)
                var tar = try gunzip(file)
                tar[156] = UInt8(ascii: Character(type).unicodeScalars.first!)
                // Re-sum the header so only the type is what is wrong.
                for i in 148..<156 { tar[i] = 0x20 }
                let sum = (0..<512).reduce(0) { $0 + Int(tar[$1]) }
                tar.replaceSubrange(148..<156, with: Array((String(sum, radix: 8).leftPad(6) + "\0 ").utf8))
                try gzip(tar, to: file)
                #expect(throws: BackupError.containsNonFile("composition.db"), "\(label)") { try read(file) }
            }
        }
    }

    #if os(macOS)
    @Test("reads archives made by the system tar, long names included, and the system tar reads ours")
    func systemTar() throws {
        try withScratch { scratch in
            let source = scratch.directory.appendingPathComponent("src", isDirectory: true)
            let long = String(repeating: "x", count: 130) + ".txt"
            try FileManager.default.createDirectory(at: source.appendingPathComponent("app_data"), withIntermediateDirectories: true)
            try Data("one".utf8).write(to: source.appendingPathComponent("composition.db"))
            try Data("two".utf8).write(to: source.appendingPathComponent("app_data/pic-aaaaaaaaaaaa.png"))
            try Data("three".utf8).write(to: source.appendingPathComponent(long))

            let theirs = scratch.directory.appendingPathComponent("theirs.tar.gz")
            try run("/usr/bin/tar", ["-czf", theirs.path, "-C", source.path, "composition.db", "app_data/pic-aaaaaaaaaaaa.png", long],
                    environment: ["COPYFILE_DISABLE": "1"])
            let back = Dictionary(uniqueKeysWithValues: try read(theirs))
            #expect(back["composition.db"] == Data("one".utf8))
            #expect(back["app_data/pic-aaaaaaaaaaaa.png"] == Data("two".utf8))
            #expect(back[long] == Data("three".utf8))

            let ours = scratch.directory.appendingPathComponent("ours.tar.gz")
            try write([("composition.db", Data("one".utf8)), (long, Data("three".utf8)), ("app_data/p-aaaaaaaaaaaa.png", sample(100_000, random: true))], to: ours)
            let listing = String(decoding: try run("/usr/bin/tar", ["-tzf", ours.path]), as: UTF8.self)
            #expect(listing.split(separator: "\n").map(String.init) == ["composition.db", long, "app_data/p-aaaaaaaaaaaa.png"])
            #expect(try run("/usr/bin/tar", ["-xzOf", ours.path, "composition.db"]) == Data("one".utf8))
        }
    }

    @Test("refuses a symlink made by the system tar")
    func systemSymlink() throws {
        try withScratch { scratch in
            let source = scratch.directory.appendingPathComponent("src", isDirectory: true)
            try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(atPath: source.appendingPathComponent("composition.db").path, withDestinationPath: "/etc/passwd")
            let file = scratch.directory.appendingPathComponent("link.tar.gz")
            try run("/usr/bin/tar", ["-czf", file.path, "-C", source.path, "composition.db"], environment: ["COPYFILE_DISABLE": "1"])
            #expect(throws: BackupError.containsNonFile("composition.db")) { try read(file) }
        }
    }
    #endif
}

private extension String {
    func leftPad(_ width: Int) -> String { count >= width ? self : String(repeating: "0", count: width - count) + self }
}
