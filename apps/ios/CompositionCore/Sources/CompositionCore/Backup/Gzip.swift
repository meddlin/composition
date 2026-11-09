import Foundation
import zlib

// Streaming gzip over the system zlib, which the SDK exposes as the `zlib` module, so there is no C of our own here.
// This is the answer to the design's "zlib or a hand-written gzip header" question (docs/ipad-app-design.md, Languages):
// Apple's Compression framework produces raw DEFLATE, so using it would mean writing and parsing the gzip header (with
// its optional name, comment and extra fields) and the CRC-32 and length trailer by hand. zlib does all of that.
//
// Both ends stream in 64 KiB pieces, so a large attachment is never held in memory.

/// A window of 15 bits plus 16 selects the gzip wrapper (header, CRC-32 and length trailer) rather than raw zlib.
private let gzipWindowBits: Int32 = 15 + 16
private let chunkSize = 64 * 1024

/// Compresses what is written to it into a gzip stream on `file`.
final class GzipWriter {
    // Allocated by hand because zlib keeps a pointer back to its z_stream, so the struct must never move.
    private let stream: UnsafeMutablePointer<z_stream>
    private let file: FileHandle
    private var buffer = [UInt8](repeating: 0, count: chunkSize)

    init(file: FileHandle) throws {
        self.file = file
        stream = .allocate(capacity: 1)
        stream.initialize(to: z_stream())
        let status = deflateInit2_(
            stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, gzipWindowBits, 8, Z_DEFAULT_STRATEGY,
            ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard status == Z_OK else { throw BackupError.damaged }
    }

    deinit {
        deflateEnd(stream)
        stream.deinitialize(count: 1)
        stream.deallocate()
    }

    func write(_ data: Data) throws {
        guard !data.isEmpty else { return }
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            stream.pointee.next_in = UnsafeMutablePointer(mutating: raw.bindMemory(to: Bytef.self).baseAddress)
            stream.pointee.avail_in = uInt(raw.count)
            while stream.pointee.avail_in > 0 {
                _ = try deflateOnce(Z_NO_FLUSH)
            }
        }
    }

    /// Writes the end of the stream (the last block and the trailer).
    func finish() throws {
        stream.pointee.next_in = nil
        stream.pointee.avail_in = 0
        while try deflateOnce(Z_FINISH) != Z_STREAM_END {}
    }

    /// One call to `deflate` into the output buffer, whose result is written to the file.
    private func deflateOnce(_ flush: Int32) throws -> Int32 {
        var status: Int32 = Z_OK
        let produced = buffer.withUnsafeMutableBufferPointer { out -> Int in
            stream.pointee.next_out = out.baseAddress
            stream.pointee.avail_out = uInt(out.count)
            status = deflate(stream, flush)
            return out.count - Int(stream.pointee.avail_out)
        }
        guard status == Z_OK || status == Z_STREAM_END || status == Z_BUF_ERROR else { throw BackupError.damaged }
        if produced > 0 { try file.write(contentsOf: Data(buffer[0..<produced])) }
        return status
    }
}

/// Decompresses a gzip stream from `file`. A stream made of several gzip members one after the other (which `gzip` and
/// Node both accept) reads as one; bytes after the last member that do not start another are ignored, as Node ignores them.
final class GzipReader {
    private let stream: UnsafeMutablePointer<z_stream>
    private let file: FileHandle
    private var input = Data()
    private var inputOffset = 0
    private var fileAtEnd = false
    private var finished = false

    init(file: FileHandle) throws {
        self.file = file
        stream = .allocate(capacity: 1)
        stream.initialize(to: z_stream())
        let status = inflateInit2_(stream, gzipWindowBits, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard status == Z_OK else { throw BackupError.damaged }
    }

    deinit {
        inflateEnd(stream)
        stream.deinitialize(count: 1)
        stream.deallocate()
    }

    private var inputRemaining: Int { input.count - inputOffset }

    /// Reads more compressed bytes after any left over. Sets `fileAtEnd` when there are none.
    private func refill() throws {
        let chunk = try file.read(upToCount: chunkSize) ?? Data()
        if chunk.isEmpty {
            fileAtEnd = true
        } else if inputRemaining == 0 {
            input = chunk
            inputOffset = 0
        } else {
            input = input.subdata(in: inputOffset..<input.count) + chunk
            inputOffset = 0
        }
    }

    /// Up to `count` decompressed bytes; fewer only at the end of the stream, and none after it.
    func read(upTo count: Int) throws -> Data {
        guard count > 0, !finished else { return Data() }
        var result = Data(count: count)
        var produced = 0

        while produced < count && !finished {
            if inputRemaining == 0 {
                try refill()
                if inputRemaining == 0 { throw BackupError.endsUnexpectedly }
            }

            var status: Int32 = Z_OK
            let outCapacity = count - produced
            let consumed: Int = result.withUnsafeMutableBytes { out in
                input.withUnsafeBytes { inp in
                    stream.pointee.next_in = UnsafeMutablePointer(
                        mutating: inp.bindMemory(to: Bytef.self).baseAddress.map { $0 + inputOffset })
                    stream.pointee.avail_in = uInt(inputRemaining)
                    stream.pointee.next_out = out.bindMemory(to: Bytef.self).baseAddress.map { $0 + produced }
                    stream.pointee.avail_out = uInt(outCapacity)
                    let before = inputRemaining
                    status = inflate(stream, Z_NO_FLUSH)
                    produced += outCapacity - Int(stream.pointee.avail_out)
                    return before - Int(stream.pointee.avail_in)
                }
            }
            inputOffset += consumed

            switch status {
            case Z_OK, Z_BUF_ERROR:
                continue
            case Z_STREAM_END:
                // Another member only if the next two bytes are the gzip magic number.
                while inputRemaining < 2 && !fileAtEnd { try refill() }
                if inputRemaining >= 2, input[input.startIndex + inputOffset] == 0x1f,
                    input[input.startIndex + inputOffset + 1] == 0x8b
                {
                    guard inflateReset(stream) == Z_OK else { throw BackupError.damaged }
                } else {
                    finished = true
                }
            default:  // Z_DATA_ERROR (not gzip, or damaged), Z_MEM_ERROR, Z_STREAM_ERROR, Z_NEED_DICT
                throw BackupError.damaged
            }
        }
        result.removeSubrange(produced..<count)
        return result
    }
}
