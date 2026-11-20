package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.yaml.JavaScriptText

/** Bold and italic from the keyboard: a port of `emphasis.ts`, from EmphasisToggle.swift. */
enum class EmphasisToggle(val rawValue: String) {
    BOLD("bold"), ITALIC("italic");

    /** The `*` characters Markdown reads as bold (two) or italic (one). */
    private val width: Int get() = if (this == BOLD) 2 else 1

    companion object {
        fun of(rawValue: String): EmphasisToggle? = entries.firstOrNull { it.rawValue == rawValue }

        /**
         * Makes the selection bold or italic by putting `**` or `*` around it, or takes the emphasis off when the selection already has it
         * (the markers inside the selection, or hard against its edges). Bold and italic share the same character, so a run of three means
         * both: italic on `**bold**` makes `***bold***`, and italic again gives `**bold**`. Spaces at the ends of the selection stay outside
         * the markers, since Markdown does not read `** bold**` as bold. The selection afterwards is the text itself, so the same command
         * undoes what it did. Null with nothing selected (or only spaces): there is no text to mark.
         */
        fun toggle(text: String, from: Int, to: Int, emphasis: EmphasisToggle): LineEdit? {
            val lower = from.coerceIn(0, text.length)
            val upper = to.coerceIn(0, text.length)
            val selected = if (lower < upper) text.substring(lower, upper) else ""
            val trimmed = JavaScriptText.trim(selected)
            if (trimmed.isEmpty()) return null
            // `selected.indexOf(trimmed)`: where the trimmed text first sits in the selection.
            val start = lower + selected.indexOf(trimmed)
            val end = start + trimmed.length
            val width = emphasis.width

            /** How many `*` run unbroken from `at`, forwards or (with `step` -1) backwards. */
            fun stars(at: Int, step: Int): Int {
                var count = 0
                var i = if (step == 1) at else at - 1
                while (i >= 0 && i < text.length && text[i] == '*') {
                    count++
                    i += step
                }
                return count
            }

            // Markers the selection holds itself win over those around it (a selection of nothing but `*` holds none).
            val onlyStars = trimmed.all { it == '*' }
            val inside = if (onlyStars) 0 else minOf(stars(start, 1), stars(end, -1))
            val around = if (inside > 0) 0 else minOf(stars(start, -1), stars(end, 1))
            val run = if (inside != 0) inside else around
            val has = if (emphasis == BOLD) run >= 2 else run % 2 == 1

            if (!has) {
                val mark = "*".repeat(width)
                return LineEdit(start, end, mark + trimmed + mark, start + width, end + width)
            }
            if (inside > 0) {
                return LineEdit(start, end, trimmed.substring(width, trimmed.length - width), start, end - 2 * width)
            }
            return LineEdit(start - width, end + width, trimmed, start - width, end - width)
        }
    }
}
