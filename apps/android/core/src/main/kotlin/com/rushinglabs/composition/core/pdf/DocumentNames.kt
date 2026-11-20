package com.rushinglabs.composition.core.pdf

import com.rushinglabs.composition.core.yaml.JavaScriptText
import java.text.Normalizer

// The names and checks around a PDF's file, ported from DocumentNames.swift: the twins of `documentNames.ts` and of the parts of
// `attachmentNames.ts` that a PDF uses (the name it is stored under, the name shown for it, a size in words). The desktop's own functions
// were run over the inputs in fixtures/conformance/document-names.json, and DocumentNamesConformanceTests replays them.

object DocumentNames {
    /** Largest PDF the app imports: the same limit as an attachment. The bytes sit on disk, so this is a sanity limit. */
    const val MAX_BYTES: Long = 1_000_000_000

    /** How far into a file `%PDF-` is looked for: some PDFs have a few bytes of junk before the header. */
    const val HEADER_WINDOW = 1024

    private val header = byteArrayOf(0x25, 0x50, 0x44, 0x46, 0x2d)

    /** Whether the start of a file (at least its first `HEADER_WINDOW` bytes) has a PDF header. */
    fun looksLikePdf(head: ByteArray, count: Int = head.size): Boolean {
        val limit = minOf(count, head.size, HEADER_WINDOW) - 4
        var index = 0
        while (index < limit) {
            if ((0 until 5).all { head[index + it] == header[it] }) return true
            index += 1
        }
        return false
    }

    /**
     * The name a file is stored under: `<unique prefix>-<original name, made safe>`. The extension survives; anything outside
     * `A-Za-z0-9_-` (path separators included) becomes `_`, and the stem cannot start with a dot or an underscore, so the stored file is
     * never hidden.
     */
    fun storedName(prefix: String, fileName: String): String {
        val base = lastComponent(fileName)
        // A leading dot (".env") is part of the stem, not an extension.
        val dot = base.lastIndexOf('.').takeIf { it > 0 }
        val rawStem = if (dot == null) base else base.substring(0, dot)
        val rawExt = if (dot == null) "" else base.substring(dot + 1)

        val extensionName = clean(rawExt).trim('_').take(20)
        val stem = clean(rawStem).dropWhile { it == '.' || it == '_' }.take(100).ifEmpty { "file" }
        return "$prefix-$stem${if (extensionName.isEmpty()) "" else ".$extensionName"}"
    }

    /** The file name to show for a path the user picked. */
    fun displayName(path: String): String = lastComponent(path).ifEmpty { "file" }

    /**
     * The title a note made for an imported PDF starts with: the file's name without `.pdf`, underscores read as spaces
     * ("Designing_Data.pdf" is "Designing Data").
     */
    fun titleFromFileName(path: String): String {
        var name = lastComponent(path)
        // `/\.pdf$/i`: JavaScript's `i` folds only A to Z here.
        if (name.length >= 4 && name.substring(name.length - 4).all { it.code < 0x80 } && name.substring(name.length - 4).lowercase() == ".pdf") {
            name = name.substring(0, name.length - 4)
        }
        // `_+` to one space, then `\s+` to one space, then trim
        val spaced = StringBuilder()
        var inSpace = false
        for (c in name) {
            if (c == '_' || JavaScriptText.isWhitespace(c.code)) {
                if (!inSpace) spaced.append(' ')
                inSpace = true
            } else {
                inSpace = false
                spaced.append(c)
            }
        }
        return JavaScriptText.trim(spaced.toString()).ifEmpty { "PDF" }
    }

    /** `1.4 MB`, `812 B`: decimal units, which is what Finder shows. */
    fun formatBytes(bytes: Long): String {
        if (bytes < 1000) return "$bytes B"
        val units = listOf("KB", "MB", "GB", "TB")
        var value = bytes.toDouble() / 1000
        var unit = 0
        while (value >= 1000 && unit < units.size - 1) {
            value /= 1000
            unit += 1
        }
        val shown = if (value >= 100) PdfMarkup.javaScriptRound(value) else PdfMarkup.javaScriptRound(value * 10) / 10
        return "${JavaScriptText.numberString(shown)} ${units[unit]}"
    }

    // Pieces ----------------------------------------------------------------------------------------------------------------------

    /** `path.split(/[\\/]/).pop()`: what follows the last slash or backslash. */
    private fun lastComponent(path: String): String {
        val separator = path.indexOfLast { it == '/' || it == '\\' }
        return if (separator < 0) path else path.substring(separator + 1)
    }

    /** `text.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_")`: each run of anything else is one underscore. */
    private fun clean(text: String): String {
        val result = StringBuilder()
        var inRun = false
        for (c in Normalizer.normalize(text, Normalizer.Form.NFKD)) {
            if (isSafe(c)) {
                result.append(c)
                inRun = false
            } else if (!inRun) {
                result.append('_')
                inRun = true
            }
        }
        return result.toString()
    }

    private fun isSafe(c: Char) = c in '0'..'9' || c in 'A'..'Z' || c in 'a'..'z' || c == '_' || c == '-'
}
