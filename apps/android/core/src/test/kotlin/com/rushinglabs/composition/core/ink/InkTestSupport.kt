package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.corpusDirectory
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.Deflater
import java.util.zip.Inflater
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

// Drawings and pixel helpers shared by the ink tests, ported from InkTestSupport.swift. The Swift draws with CoreGraphics; Android's
// Canvas is not on the JVM, so `InkRaster` stands in for it here: it fills the shapes `InkRenderer.plan` gives at 4 x 4 points per pixel,
// which is all the app's Canvas does with them. With it the tests can look at pixels as the Swift ones do, and compare the Kotlin
// geometry with the Swift renderer's own pictures in the corpus.

object InkSamples {
    /**
     * A small page with one of each thing the format has: a pen wave, a translucent marker in a `<Mark>` colour, a fixed-colour monoline,
     * and a stroke of the accent. Every number is already at the format's steps, so writing and reading gives the same drawing back.
     */
    fun page(): InkDocument {
        val wave = (0 until 14).map { index ->
            InkPoint(
                x = 10.0 + index * 12, y = 40.0 + (if (index % 2 == 0) 12 else -12), t = index * 16.0, force = 0.5 + index / 40.0,
                altitude = 0.8, azimuth = 1.2, width = 3.5, height = 3.5, opacity = 1.0,
            )
        }
        val marker = listOf(
            InkPoint(20.0, 90.0, width = 14.0, height = 14.0, opacity = 0.5),
            InkPoint(100.0, 92.0, t = 400.0, width = 14.0, height = 14.0, opacity = 0.5),
            InkPoint(170.0, 90.0, t = 800.0, width = 14.0, height = 14.0, opacity = 0.5),
        )
        val monoline = listOf(
            InkPoint(20.0, 20.0, width = 2.0, height = 2.0),
            InkPoint(90.0, 24.0, t = 300.0, width = 2.0, height = 2.0),
            InkPoint(160.0, 18.0, t = 600.0, width = 2.0, height = 2.0),
        )
        val dot = listOf(InkPoint(100.0, 60.0, width = 8.0, height = 8.0))
        return InkDocument(
            200.0, 120.0,
            listOf(
                InkStroke(InkType.PEN, InkColor.INK, wave),
                InkStroke(InkType.MARKER, InkColor.Semantic("yellow"), marker),
                InkStroke(InkType.MONOLINE, InkColor.Fixed(ThemeColor(200, 30, 30)), monoline),
                InkStroke(InkType.PEN, InkColor.ACCENT, dot),
            ),
        )
    }

    /**
     * A dense page, made without any randomness: `strokes` strokes of `pointsEach` points, each a small arc somewhere on a tablet-sized
     * page, with the per-point variation a real Pencil gives (force, tilt, time at 240 samples a second).
     */
    fun dense(strokes: Int, pointsEach: Int): InkDocument {
        fun stored(value: Double, step: Double) = InkDocument.stored(value, step)
        val out = ArrayList<InkStroke>(strokes)
        for (stroke in 0 until strokes) {
            val originX = ((stroke * 37) % 780).toDouble() + 20
            val originY = ((stroke * 53) % 1100).toDouble() + 20
            val points = ArrayList<InkPoint>(pointsEach)
            for (index in 0 until pointsEach) {
                val angle = index.toDouble() / pointsEach * Math.PI
                val wobble = sin(index * 0.9 + stroke) * 0.6
                points.add(
                    InkPoint(
                        x = stored(originX + cos(angle) * 18 + wobble, 0.01), y = stored(originY + sin(angle) * 12 - wobble, 0.01),
                        t = index * 4.0, force = stored(0.4 + 0.5 * sin(angle), 0.001), altitude = stored(0.9 + 0.1 * cos(angle), 0.001),
                        azimuth = stored(1.0 + 0.2 * sin(angle * 2), 0.001), width = stored(2.5 + 1.5 * sin(angle), 0.01),
                        height = stored(2.5 + 1.5 * sin(angle), 0.01), opacity = 1.0,
                    ),
                )
            }
            out.add(
                InkStroke(
                    if (stroke % 9 == 0) InkType.MARKER else InkType.PEN,
                    if (stroke % 5 == 0) InkColor.Semantic("blue") else InkColor.INK,
                    points,
                ),
            )
        }
        return InkDocument(834.0, 1194.0, out)
    }
}

/** `fixtures/conformance/ink` of this checkout (or of what the device run pushed), or null when the tests run where it is not. */
object InkCorpus {
    val directory: File? = corpusDirectory?.let { File(it, "ink") }?.takeIf { File(it, "validation.json").isFile }

    fun file(name: String): File = File(directory, name)

    /** The payload of an `inKJ` chunk for `drawing`: the version byte, the length of the text, the text as a zlib stream. */
    fun chunkPayload(drawing: InkDocument): ByteArray {
        val text = drawing.jsonData()
        return byteArrayOf(1) + bigEndian(text.size.toLong()) + InkPng.deflate(text)
    }

    /** `png` with one more chunk just before IEND, with the CRC that goes with it (or a wrong one). */
    fun appending(type: String, payload: ByteArray, png: ByteArray, badCrc: Boolean = false): ByteArray {
        val end = InkPng.walk(png).last()
        val body = type.encodeToByteArray() + payload
        return png.copyOfRange(0, end.start) + bigEndian(payload.size.toLong()) + body +
            bigEndian(InkPng.crc(body) xor (if (badCrc) 0xFFFF_FFFFL else 0L)) + png.copyOfRange(end.start, end.end)
    }

    fun bigEndian(value: Long): ByteArray =
        byteArrayOf((value shr 24).toByte(), (value shr 16).toByte(), (value shr 8).toByte(), value.toByte())
}

/** An image as 8-bit straight (not premultiplied) RGBA, rows top down. */
class RgbaImage(val width: Int, val height: Int, val rgba: ByteArray = ByteArray(width * height * 4)) {
    data class Pixel(val r: Int, val g: Int, val b: Int, val a: Int) {
        val rgb: Triple<Int, Int, Int> get() = Triple(r, g, b)
    }

    /** The pixel at column `x`, row `y` from the top; a transparent one reads as all zeros, as the Swift helper has it. */
    fun pixel(x: Int, y: Int): Pixel {
        val at = (y * width + x) * 4
        val a = rgba[at + 3].toInt() and 0xFF
        if (a == 0) return Pixel(0, 0, 0, 0)
        return Pixel(rgba[at].toInt() and 0xFF, rgba[at + 1].toInt() and 0xFF, rgba[at + 2].toInt() and 0xFF, a)
    }

    fun alpha(x: Int, y: Int): Int = rgba[(y * width + x) * 4 + 3].toInt() and 0xFF

    /** How many pixels are not fully transparent. */
    val inkedPixelCount: Int get() = (0 until width * height).count { rgba[it * 4 + 3] != 0.toByte() }
}

/** The smallest PNG writer and reader the tests need: 8-bit RGBA, not interlaced. The app's PNGs come from `Bitmap.compress`. */
object TestPng {
    fun encode(image: RgbaImage): ByteArray {
        val raw = ByteArrayOutputStream(image.height * (image.width * 4 + 1))
        for (row in 0 until image.height) {
            raw.write(0)
            raw.write(image.rgba, row * image.width * 4, image.width * 4)
        }
        val header = InkCorpus.bigEndian(image.width.toLong()) + InkCorpus.bigEndian(image.height.toLong()) + byteArrayOf(8, 6, 0, 0, 0)
        val deflater = Deflater(6).apply {
            setInput(raw.toByteArray())
            finish()
        }
        val packed = ByteArrayOutputStream()
        val buffer = ByteArray(65536)
        while (!deflater.finished()) packed.write(buffer, 0, deflater.deflate(buffer))
        deflater.end()
        val out = ByteArrayOutputStream()
        out.write(InkPng.SIGNATURE)
        fun chunk(type: String, payload: ByteArray) {
            out.write(InkCorpus.bigEndian(payload.size.toLong()))
            val body = type.encodeToByteArray() + payload
            out.write(body)
            out.write(InkCorpus.bigEndian(InkPng.crc(body)))
        }
        chunk("IHDR", header)
        chunk("IDAT", packed.toByteArray())
        chunk("IEND", ByteArray(0))
        return out.toByteArray()
    }

    fun decode(png: ByteArray): RgbaImage {
        val chunks = InkPng.walk(png)
        val header = chunks.first()
        val width = InkPng.readBigEndian(png, header.start + 8).toInt()
        val height = InkPng.readBigEndian(png, header.start + 12).toInt()
        check(png[header.start + 16] == 8.toByte() && png[header.start + 17] == 6.toByte() && png[header.start + 20] == 0.toByte()) {
            "only 8-bit RGBA, not interlaced"
        }
        val packed = ByteArrayOutputStream()
        for (chunk in chunks) if (chunk.type == "IDAT") packed.write(png, chunk.start + 8, chunk.end - chunk.start - 12)
        val stride = width * 4
        val raw = ByteArray(height * (stride + 1))
        val inflater = Inflater().apply { setInput(packed.toByteArray()) }
        var filled = 0
        while (filled < raw.size && !inflater.finished()) filled += inflater.inflate(raw, filled, raw.size - filled)
        inflater.end()
        check(filled == raw.size) { "the pixels are cut short" }
        val out = ByteArray(height * stride)
        for (row in 0 until height) {
            val filter = raw[row * (stride + 1)].toInt()
            for (i in 0 until stride) {
                val x = raw[row * (stride + 1) + 1 + i].toInt() and 0xFF
                val left = if (i >= 4) out[row * stride + i - 4].toInt() and 0xFF else 0
                val up = if (row > 0) out[(row - 1) * stride + i].toInt() and 0xFF else 0
                val upLeft = if (row > 0 && i >= 4) out[(row - 1) * stride + i - 4].toInt() and 0xFF else 0
                val value = when (filter) {
                    0 -> x
                    1 -> x + left
                    2 -> x + up
                    3 -> x + (left + up) / 2
                    4 -> {
                        val p = left + up - upLeft
                        val pa = abs(p - left)
                        val pb = abs(p - up)
                        val pc = abs(p - upLeft)
                        x + if (pa <= pb && pa <= pc) left else if (pb <= pc) up else upLeft
                    }
                    else -> error("filter $filter")
                }
                out[row * stride + i] = value.toByte()
            }
        }
        return RgbaImage(width, height, out)
    }
}

/**
 * What Canvas does with an `InkRenderer.Plan`, on the JVM: each shape's polygons filled once (the union of convex polygons wound the same
 * way, which is what the non-zero rule makes of them), at 4 x 4 points per pixel, composited in order with its alpha. Point sampling,
 * not CoreGraphics' exact coverage, so an edge pixel can differ from the Swift's by about a sixteenth.
 */
object InkRaster {
    private const val GRID = 4

    fun render(plan: InkRenderer.Plan, drawing: InkDocument): RgbaImage {
        val width = plan.size.width
        val height = plan.size.height
        val red = DoubleArray(width * height)
        val green = DoubleArray(width * height)
        val blue = DoubleArray(width * height)
        val alpha = DoubleArray(width * height)
        plan.background?.let { background ->
            red.fill(background.red / 255.0); green.fill(background.green / 255.0); blue.fill(background.blue / 255.0); alpha.fill(1.0)
        }
        // Pixels to a point across and down, as the Swift's transform has them.
        val sx = width / drawing.width
        val sy = height / drawing.height
        val sub = GRID * GRID
        for (shape in plan.shapes) {
            val covered = java.util.BitSet(width * height * sub)
            var low = Int.MAX_VALUE
            var high = -1
            for (polygon in shape.polygons) {
                if (polygon.size < 3) continue
                val minX = floor(polygon.minOf { it.x } * sx * GRID - 0.5).toInt().coerceAtLeast(0)
                val maxX = ceil(polygon.maxOf { it.x } * sx * GRID - 0.5).toInt().coerceAtMost(width * GRID - 1)
                val minY = floor(polygon.minOf { it.y } * sy * GRID - 0.5).toInt().coerceAtLeast(0)
                val maxY = ceil(polygon.maxOf { it.y } * sy * GRID - 0.5).toInt().coerceAtMost(height * GRID - 1)
                for (gy in minY..maxY) {
                    val y = (gy + 0.5) / GRID / sy
                    for (gx in minX..maxX) {
                        val x = (gx + 0.5) / GRID / sx
                        if (!inside(polygon, x, y)) continue
                        val pixel = (gy / GRID) * width + gx / GRID
                        covered.set(pixel * sub + (gy % GRID) * GRID + gx % GRID)
                        if (pixel < low) low = pixel
                        if (pixel > high) high = pixel
                    }
                }
            }
            if (high < 0) continue
            val r = shape.color.red / 255.0
            val g = shape.color.green / 255.0
            val b = shape.color.blue / 255.0
            for (pixel in low..high) {
                val count = covered.get(pixel * sub, pixel * sub + sub).cardinality()
                if (count == 0) continue
                val a = shape.alpha * count / sub
                val under = alpha[pixel] * (1 - a)
                val out = a + under
                red[pixel] = (r * a + red[pixel] * under) / out
                green[pixel] = (g * a + green[pixel] * under) / out
                blue[pixel] = (b * a + blue[pixel] * under) / out
                alpha[pixel] = out
            }
        }
        val image = RgbaImage(width, height)
        for (pixel in 0 until width * height) {
            fun byte(value: Double) = (value * 255 + 0.5).toInt().coerceIn(0, 255).toByte()
            image.rgba[pixel * 4] = byte(red[pixel])
            image.rgba[pixel * 4 + 1] = byte(green[pixel])
            image.rgba[pixel * 4 + 2] = byte(blue[pixel])
            image.rgba[pixel * 4 + 3] = byte(alpha[pixel])
        }
        return image
    }

    fun render(drawing: InkDocument, palette: InkPalette, scale: Double = 2.0, background: ThemeColor? = null): RgbaImage =
        render(InkRenderer.plan(drawing, palette, scale, background), drawing)

    /** The PNG a note stores, drawn here as the app draws it with Canvas. */
    fun pngData(drawing: InkDocument, palette: InkPalette, scale: Double = 2.0, pencilKit: ByteArray? = null): ByteArray =
        InkRenderer.pngData(drawing, TestPng.encode(render(drawing, palette, scale)), pencilKit)

    /** Inside or on the edge of a convex polygon wound counter-clockwise (every cross product not negative). */
    private fun inside(polygon: List<InkVector>, x: Double, y: Double): Boolean {
        for (index in polygon.indices) {
            val a = polygon[index]
            val b = polygon[(index + 1) % polygon.size]
            if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false
        }
        return true
    }
}
