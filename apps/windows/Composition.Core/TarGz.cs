using System.IO.Compression;
using System.Text;

namespace Composition.Core;

public sealed class ArchiveError(string message) : Exception(message);

/// <summary>A file to add: where it is on disk, and the path it gets inside the archive.</summary>
public sealed record ArchiveSource(string Name, string File);

/// <summary>
/// A minimal tar.gz writer and strict reader, ported from tarArchive.ts so a backup stays readable by plain
/// <c>tar -xzf</c> and by the desktop. Written: ustar headers, GNU long names over 100 bytes. Read: regular files
/// only; a link, device or FIFO is refused, not skipped. POSIX (<c>x</c>) and GNU (<c>L</c>) path extensions understood.
/// gzip comes from the framework (<see cref="GZipStream"/>): there is no hand-written gzip header here, unlike on iOS.
/// </summary>
public static class TarGz
{
    private const int Block = 512;
    private const int MaxExtensionBytes = 64 * 1024;

    // --- writing ---------------------------------------------------------------

    private static void Octal(long value, int width, byte[] block, int at)
    {
        var text = Convert.ToString(value, 8).PadLeft(width - 1, '0') + "\0";
        Encoding.Latin1.GetBytes(text).CopyTo(block, at);
    }

    private static byte[] Header(string name, long size, long mtime, char type)
    {
        var block = new byte[Block];
        var nameBytes = Encoding.UTF8.GetBytes(name);
        Array.Copy(nameBytes, block, Math.Min(nameBytes.Length, 100));
        Octal(0x1A4 /* 0644 */, 8, block, 100);
        Octal(0, 8, block, 108);
        Octal(0, 8, block, 116);
        Octal(size, 12, block, 124);
        Octal(mtime, 12, block, 136);
        Array.Fill(block, (byte)0x20, 148, 8); // the checksum is computed with this field as spaces
        block[156] = (byte)type;
        Encoding.Latin1.GetBytes("ustar\0").CopyTo(block, 257);
        Encoding.Latin1.GetBytes("00").CopyTo(block, 263);
        var sum = 0;
        foreach (var b in block) sum += b;
        Encoding.Latin1.GetBytes(Convert.ToString(sum, 8).PadLeft(6, '0') + "\0 ").CopyTo(block, 148);
        return block;
    }

    private static void Pad(Stream output, long size)
    {
        var pad = (int)((Block - size % Block) % Block);
        if (pad > 0) output.Write(new byte[pad]);
    }

    private static void AddHeader(Stream output, string name, long size, long mtime)
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        if (nameBytes.Length > 100)
        {
            var body = nameBytes.Append((byte)0).ToArray();
            output.Write(Header("././@LongLink", body.Length, 0, 'L'));
            output.Write(body);
            Pad(output, body.Length);
        }
        output.Write(Header(name, size, mtime, '0'));
    }

    /// <summary>
    /// Writes a .tar.gz at <paramref name="target"/>: first <paramref name="contents"/> (small files held in memory, such as
    /// the manifest), then each source streamed from disk. Written to a temporary name and renamed, so the target is never
    /// a half-written archive.
    /// </summary>
    public static void Write(string target, IReadOnlyList<(string Name, byte[] Bytes)> contents, IReadOnlyList<ArchiveSource> sources)
    {
        var temporary = target + ".partial";
        try
        {
            using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
            using (var gzip = new GZipStream(file, CompressionLevel.Optimal))
            {
                var mtime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                foreach (var (name, bytes) in contents)
                {
                    AddHeader(gzip, name, bytes.Length, mtime);
                    gzip.Write(bytes);
                    Pad(gzip, bytes.Length);
                }
                foreach (var source in sources)
                {
                    FileStream input;
                    try { input = new FileStream(source.File, FileMode.Open, FileAccess.Read, FileShare.Read); }
                    catch (FileNotFoundException) { continue; } // gone since the folder was listed
                    using (input)
                    {
                        var size = input.Length; // read from the open file, so header and bytes cannot disagree
                        AddHeader(gzip, source.Name, size, mtime);
                        var remaining = size;
                        var chunk = new byte[64 * 1024];
                        while (remaining > 0)
                        {
                            var read = input.Read(chunk, 0, (int)Math.Min(chunk.Length, remaining));
                            if (read == 0) throw new ArchiveError($"{source.File} shrank while it was being backed up.");
                            gzip.Write(chunk, 0, read);
                            remaining -= read;
                        }
                        Pad(gzip, size);
                    }
                }
                gzip.Write(new byte[Block * 2]); // end of archive
            }
            File.Move(temporary, target, overwrite: true);
        }
        catch
        {
            try { File.Delete(temporary); } catch (IOException) { }
            throw;
        }
    }

    // --- reading ---------------------------------------------------------------

    private static int Take(Stream stream, byte[] buffer, int count)
    {
        var got = 0;
        while (got < count)
        {
            var n = stream.Read(buffer, got, count - got);
            if (n == 0) break;
            got += n;
        }
        return got;
    }

    private static void Skip(Stream stream, long count)
    {
        var scratch = new byte[64 * 1024];
        while (count > 0)
        {
            var n = stream.Read(scratch, 0, (int)Math.Min(scratch.Length, count));
            if (n == 0) throw new ArchiveError("The backup ends unexpectedly.");
            count -= n;
        }
    }

    private static string CString(ReadOnlySpan<byte> field)
    {
        var end = field.IndexOf((byte)0);
        return Encoding.UTF8.GetString(end == -1 ? field : field[..end]);
    }

    private static long ParseOctal(ReadOnlySpan<byte> field)
    {
        var text = CString(field).Trim();
        if (text.Length == 0 || !text.All(c => c is >= '0' and <= '7')) throw new ArchiveError("The backup has a damaged header.");
        return Convert.ToInt64(text, 8);
    }

    private static bool ChecksumMatches(byte[] block)
    {
        var stored = ParseOctal(block.AsSpan(148, 8));
        long sum = 0;
        for (var i = 0; i < Block; i++) sum += i is >= 148 and < 156 ? 0x20 : block[i];
        return sum == stored;
    }

    private static string? PaxPath(byte[] records)
    {
        var at = 0;
        while (at < records.Length)
        {
            var space = Array.IndexOf(records, (byte)0x20, at);
            if (space == -1 || !int.TryParse(Encoding.Latin1.GetString(records, at, space - at), out var length) || length <= 0)
                throw new ArchiveError("The backup has a damaged header.");
            var record = Encoding.UTF8.GetString(records, space + 1, at + length - 1 - (space + 1));
            if (record.StartsWith("path=", StringComparison.Ordinal)) return record["path=".Length..];
            at += length;
        }
        return null;
    }

    /// <summary>
    /// Reads the archive at <paramref name="file"/> one entry at a time. <paramref name="visit"/> gets the name, the size and a
    /// stream that ends at the file's size; what it leaves unread is skipped.
    /// </summary>
    public static void Read(string file, Action<string, long, Stream> visit)
    {
        try
        {
            using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var gzip = new GZipStream(input, CompressionMode.Decompress);
            string? pendingName = null;
            var block = new byte[Block];
            while (true)
            {
                var got = Take(gzip, block, Block);
                if (got < Block) throw new ArchiveError("The backup ends unexpectedly.");
                if (block.All(b => b == 0)) return;
                if (!ChecksumMatches(block)) throw new ArchiveError("This is not a Composition backup (or it is damaged).");

                var type = block[156] == 0 ? '0' : (char)block[156];
                var size = ParseOctal(block.AsSpan(124, 12));
                var prefix = CString(block.AsSpan(345, 155));
                var name = pendingName ?? (prefix.Length > 0 ? $"{prefix}/{CString(block.AsSpan(0, 100))}" : CString(block.AsSpan(0, 100)));
                pendingName = null;
                var padded = (size + Block - 1) / Block * Block;

                if (type is 'L' or 'x')
                {
                    if (size > MaxExtensionBytes) throw new ArchiveError("The backup has a damaged header.");
                    var body = new byte[padded];
                    if (Take(gzip, body, (int)padded) < padded) throw new ArchiveError("The backup ends unexpectedly.");
                    var content = body.AsSpan(0, (int)size).ToArray();
                    pendingName = type == 'L' ? CString(content) : PaxPath(content);
                    continue;
                }
                if (type is 'g' or '5') { Skip(gzip, padded); continue; }
                if (type != '0')
                    throw new ArchiveError($"The backup contains something other than files ({(name.Length > 0 ? name : "an unnamed entry")}), so it was not restored.");

                var window = new BoundedStream(gzip, size);
                visit(name, size, window);
                window.Drain();
                Skip(gzip, padded - size);
            }
        }
        catch (InvalidDataException)
        {
            throw new ArchiveError("This is not a Composition backup (or it is damaged).");
        }
    }

    /// <summary>A read-only view of the next <c>length</c> bytes of a stream.</summary>
    private sealed class BoundedStream : Stream
    {
        private readonly Stream _inner;
        private readonly long _length;
        private long _remaining;

        public BoundedStream(Stream inner, long length)
        {
            _inner = inner;
            _length = length;
            _remaining = length;
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_remaining == 0) return 0;
            var n = _inner.Read(buffer, offset, (int)Math.Min(count, _remaining));
            if (n == 0) throw new ArchiveError("The backup ends unexpectedly.");
            _remaining -= n;
            return n;
        }
        public void Drain() => Skip(_inner, _remaining);
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => _length;
        public override long Position { get => _length - _remaining; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
