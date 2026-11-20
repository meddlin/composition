package com.rushinglabs.composition.core.ink

import java.io.ByteArrayOutputStream
import java.util.zip.CRC32
import java.util.zip.DataFormatException
import java.util.zip.Deflater
import java.util.zip.Inflater

// The PNG that carries its own source (docs/architecture/ink.md, "The container"), ported from InkPNG.swift: the ink drawn on
// transparent pixels, as any PNG, plus two private chunks before IEND. Everything that shows an image (the CLI, the desktop, a backup's
// viewer) sees the pixels and ignores the chunks; the iPad, Android and the web renderer read the stroke JSON; the iPad alone reads
// the PencilKit blob (Android keeps it, unread, so an edit here does not lose the iPad's).
//
//   inKJ  the stroke JSON:   version byte (1) · length of the text, 4 bytes big endian · the text as a zlib stream
//   inKP  PencilKit's blob:  version byte (1) · the bytes of `PKDrawing.dataRepresentation()`
//
// The chunk names follow the PNG rules for private chunks: ancillary (first letter lower case), private (second lower case), the reserved
// bit upper case, and **unsafe to copy** (last letter upper case), so an editor that changes the pixels drops them instead of carrying
// strokes that no longer match what is drawn. zlib is java.util.zip's, so the packed bytes may differ from Apple's zlib; what they unpack
// to does not.

object InkPng {
    const val JSON_CHUNK = "inKJ"
    const val PENCIL_KIT_CHUNK = "inKP"
    internal const val CHUNK_VERSION: Byte = 1
    internal val SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

    /** What a drawing's PNG carries besides pixels. A chunk that is absent, damaged, or of a newer version is null, and `problems` says why. */
    class Contents(
        val strokeJson: ByteArray? = null,
        val pencilKit: ByteArray? = null,
        val problems: List<String> = emptyList(),
    ) {
        /**
         * The stroke JSON read as a drawing; null when the PNG carries none, and an error when it carries some that cannot be read (the
         * caller then shows the PNG's pixels and offers no editing).
         */
        fun drawing(): InkDocument? = strokeJson?.let { InkDocument.fromData(it) }

        override fun equals(other: Any?): Boolean = other is Contents && problems == other.problems &&
            sameBytes(strokeJson, other.strokeJson) && sameBytes(pencilKit, other.pencilKit)

        override fun hashCode(): Int = 31 * (31 * problems.hashCode() + (strokeJson?.contentHashCode() ?: 0)) + (pencilKit?.contentHashCode() ?: 0)

        override fun toString(): String = "Contents(strokeJson=${strokeJson?.size} bytes, pencilKit=${pencilKit?.size} bytes, problems=$problems)"

        private fun sameBytes(a: ByteArray?, b: ByteArray?) = if (a == null || b == null) a == b else a.contentEquals(b)
    }

    // Writing

    /** `png` with its ink chunks replaced by these (an absent one is left out). `png` must be a PNG; any ink chunks it already has go. */
    fun embedding(drawing: InkDocument?, pencilKit: ByteArray?, png: ByteArray): ByteArray {
        val json = drawing?.let {
            val text = it.jsonData()
            if (text.size > InkLimits.MAX_JSON_BYTES) throw InkError("This drawing is too large to save.")
            ByteArrayOutputStream().apply {
                write(CHUNK_VERSION.toInt())
                writeBigEndian(text.size.toLong())
                write(deflate(text))
            }.toByteArray()
        }
        val blob = pencilKit?.let { byteArrayOf(CHUNK_VERSION) + it }

        val chunks = walk(png)
        val end = chunks.last()
        if (end.type != "IEND") throw InkError("This PNG has no end.")
        val out = ByteArrayOutputStream(png.size + (json?.size ?: 0) + (blob?.size ?: 0) + 32)
        out.write(SIGNATURE)
        for (chunk in chunks.dropLast(1)) {
            if (chunk.type != JSON_CHUNK && chunk.type != PENCIL_KIT_CHUNK) out.write(png, chunk.start, chunk.end - chunk.start)
        }
        if (json != null) out.writeChunk(JSON_CHUNK, json)
        if (blob != null) out.writeChunk(PENCIL_KIT_CHUNK, blob)
        out.write(png, end.start, end.end - end.start)
        return out.toByteArray()
    }

    /**
     * `png` with its pixel density set: a `pHYs` chunk right after the header, in pixels to a metre (72 dots to an inch being a pixel to a
     * point), replacing any it had. The Swift renderer has ImageIO write it (`kCGImagePropertyDPIWidth`); Android's `Bitmap.compress`
     * writes none, so the app adds it with this. The number is rounded to the nearest whole pixel, as the corpus's PNGs have it.
     */
    fun settingDensity(png: ByteArray, dotsPerInch: Double): ByteArray {
        val chunks = walk(png)
        val perMetre = roundHalfAway(dotsPerInch / 0.0254).toLong().coerceIn(1L, 0x7FFF_FFFFL)
        val body = ByteArrayOutputStream(9).apply {
            writeBigEndian(perMetre)
            writeBigEndian(perMetre)
            write(1)
        }.toByteArray()
        val out = ByteArrayOutputStream(png.size + 21)
        out.write(SIGNATURE)
        chunks.forEachIndexed { index, chunk ->
            if (chunk.type != "pHYs") out.write(png, chunk.start, chunk.end - chunk.start)
            if (index == 0) out.writeChunk("pHYs", body)
        }
        return out.toByteArray()
    }

    /** The width and height a PNG's header gives, in pixels. */
    fun pixelSize(png: ByteArray): InkImageSize {
        val header = walk(png).first()
        if (header.end - header.start < 12 + 8) throw InkError("This PNG's header is cut short.")
        return InkImageSize(readBigEndian(png, header.start + 8).toInt(), readBigEndian(png, header.start + 12).toInt())
    }

    // Reading

    /** The ink chunks of a PNG. A PNG without them is not an error: its `Contents` is empty. A PNG whose structure is broken is. */
    fun contents(png: ByteArray): Contents {
        var strokeJson: ByteArray? = null
        var pencilKit: ByteArray? = null
        val problems = ArrayList<String>()
        for (chunk in walk(png)) {
            if (chunk.type != JSON_CHUNK && chunk.type != PENCIL_KIT_CHUNK) continue
            val bodyStart = chunk.start + 8
            val bodyEnd = chunk.end - 4
            if (crc(png, chunk.start + 4, bodyEnd) != readBigEndian(png, bodyEnd)) {
                problems.add("The ${chunk.type} chunk is damaged.")
                continue
            }
            if (bodyStart >= bodyEnd || png[bodyStart] != CHUNK_VERSION) {
                problems.add("The ${chunk.type} chunk is from a newer version.")
                continue
            }
            val payload = bodyStart + 1
            if (chunk.type == JSON_CHUNK) {
                if (bodyEnd - payload < 4) {
                    problems.add("The $JSON_CHUNK chunk is short.")
                    continue
                }
                val size = readBigEndian(png, payload)
                val text = if (size <= InkLimits.MAX_JSON_BYTES) inflate(png, payload + 4, bodyEnd, size.toInt()) else null
                if (text == null) {
                    problems.add("The $JSON_CHUNK chunk does not unpack.")
                    continue
                }
                strokeJson = text
            } else {
                pencilKit = png.copyOfRange(payload, bodyEnd)
            }
        }
        return Contents(strokeJson, pencilKit, problems)
    }

    /**
     * How many pixels the PNG has to a point of its drawing's canvas: its `pHYs` chunk (pixels to a metre, 72 dots to an inch being a
     * pixel to a point), to a hundredth; 2 when it has none, or one that is not in metres, or not square, as every drawing before the
     * chunk was written is 2x. A PNG whose structure is broken is 2 as well: the caller is showing it as a picture, and 2 is what the iPad
     * draws at.
     */
    fun pixelsPerPoint(png: ByteArray): Double {
        val fallback = 2.0
        val chunks = try {
            walk(png)
        } catch (_: InkError) {
            return fallback
        }
        val phys = chunks.firstOrNull { it.type == "pHYs" } ?: return fallback
        if (phys.end - phys.start != 12 + 9) return fallback
        val x = readBigEndian(png, phys.start + 8)
        val y = readBigEndian(png, phys.start + 12)
        if (png[phys.start + 16] != 1.toByte() || x != y || x <= 0) return fallback
        val density = roundHalfAway(x.toDouble() * 0.0254 / 72 * 100) / 100
        return if (density > 0) density else fallback
    }

    // Chunks

    /** A chunk: its type, and the offsets in the file of its length field and of the end of its CRC. */
    internal class Chunk(val type: String, val start: Int, val end: Int)

    /** The chunks of a PNG in order, checked for structure (signature, lengths, IHDR first, IEND last) but not for CRCs. */
    internal fun walk(png: ByteArray): List<Chunk> {
        if (png.size < SIGNATURE.size + 12 || !SIGNATURE.indices.all { png[it] == SIGNATURE[it] }) throw InkError("This is not a PNG.")
        val chunks = ArrayList<Chunk>()
        var offset = SIGNATURE.size
        while (offset + 12 <= png.size) {
            val length = readBigEndian(png, offset)
            val end = offset + 12 + length
            if (length > 0x7FFF_FFFFL || end > png.size) throw InkError("This PNG is cut short.")
            val type = png.decodeToString(offset + 4, offset + 8)
            if (chunks.isEmpty() && type != "IHDR") throw InkError("This PNG does not start with its header.")
            chunks.add(Chunk(type, offset, end.toInt()))
            offset = end.toInt()
            if (type == "IEND") break
        }
        if (chunks.lastOrNull()?.type != "IEND") throw InkError("This PNG has no end.")
        return chunks
    }

    /** Four bytes big endian, as an unsigned number. */
    internal fun readBigEndian(data: ByteArray, at: Int): Long =
        ((data[at].toLong() and 0xFF) shl 24) or ((data[at + 1].toLong() and 0xFF) shl 16) or
            ((data[at + 2].toLong() and 0xFF) shl 8) or (data[at + 3].toLong() and 0xFF)

    internal fun crc(data: ByteArray, from: Int = 0, to: Int = data.size): Long = CRC32().apply { update(data, from, to - from) }.value

    // zlib

    internal fun deflate(data: ByteArray): ByteArray {
        val deflater = Deflater(6)
        try {
            deflater.setInput(data)
            deflater.finish()
            val out = ByteArrayOutputStream(data.size / 2 + 64)
            val buffer = ByteArray(64 * 1024)
            while (!deflater.finished()) {
                val count = deflater.deflate(buffer)
                out.write(buffer, 0, count)
            }
            return out.toByteArray()
        } finally {
            deflater.end()
        }
    }

    /**
     * The `size` bytes the zlib stream in `data[from until to]` holds, or null when it holds anything else (more, fewer, or not a whole
     * zlib stream). Unlike the Swift, which hands zlib a buffer of `size` bytes at once, this grows its buffer as the stream unpacks, so
     * a chunk that claims 256 MB and holds a few bytes costs a few bytes: Android gives an app far less memory than an iPad does.
     */
    internal fun inflate(data: ByteArray, from: Int, to: Int, size: Int): ByteArray? {
        val inflater = Inflater()
        try {
            inflater.setInput(data, from, to - from)
            val out = ByteArrayOutputStream(minOf(size, 1 shl 20))
            val buffer = ByteArray(64 * 1024)
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                // Nothing came out and the stream is not over: it is cut short, or wants a dictionary.
                if (count == 0 && !inflater.finished()) return null
                out.write(buffer, 0, count)
                if (out.size() > size) return null
            }
            return out.toByteArray().takeIf { it.size == size }
        } catch (_: DataFormatException) {
            return null
        } finally {
            inflater.end()
        }
    }

    private fun ByteArrayOutputStream.writeBigEndian(value: Long) {
        write((value shr 24).toInt() and 0xFF)
        write((value shr 16).toInt() and 0xFF)
        write((value shr 8).toInt() and 0xFF)
        write(value.toInt() and 0xFF)
    }

    private fun ByteArrayOutputStream.writeChunk(type: String, payload: ByteArray) {
        writeBigEndian(payload.size.toLong())
        val body = type.encodeToByteArray() + payload
        write(body)
        writeBigEndian(crc(body))
    }
}

/** A picture's size in pixels. */
data class InkImageSize(val width: Int, val height: Int)
