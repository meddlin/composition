package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.markdown.TextRange

// What the Live model's edit tests share: an edit applied to a text, and the iPad tests' seeded edits.

/** `text` with `range` replaced by `insertion`. */
internal fun replacing(text: String, range: TextRange, insertion: String) = text.substring(0, range.location) + insertion + text.substring(range.end)

/** The iPad tests' seeded generator (a 64-bit LCG), so the same seed makes the same edits as there. */
internal class SeededEdits(private var seed: ULong) {
    fun next(below: Int): Int {
        seed = seed * 6364136223846793005uL + 1442695040888963407uL
        return ((seed shr 33) % below.toULong()).toInt()
    }
}
