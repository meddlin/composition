package com.rushinglabs.composition.core.live

import com.rushinglabs.composition.core.markdown.TextRange

// The Live view hides a note's syntax marks (`#`, `**`, backticks, `>`) except where the caret is, ported from LiveReveal.swift. Where "where the
// caret is" ends is this rule: for most syntax it is the caret's own line; for a fenced code block it is the whole block.

object LiveReveal {
    /**
     * The range whose marks stay showing for a caret on `line` (the line's range, with its line break, with a caret anywhere in it): that line, or,
     * when the line is part of a code block, the whole block. Both of its fences then show while the caret is anywhere in it, so it is plain that
     * the caret is inside a block; with only the fence on the caret's own line shown (the iPad's first prototype), moving into a block showed one
     * fence and hid the other, and nothing said you had entered a block.
     *
     * `codeBlocks` are where the note's code blocks are, or at least those around `line`. The iPad passes its editor colours' spans and keeps the
     * code blocks among them; those colours are another slice of the port (`MarkdownHighlighter`), so this takes the blocks' ranges, which the
     * colours' code-block spans give and so does `LiveDecorations.codeBlocks`.
     */
    fun range(line: TextRange, codeBlocks: List<TextRange>): TextRange {
        var reveal = line
        for (block in codeBlocks) {
            val overlap = minOf(block.end, line.end) - maxOf(block.location, line.location)
            if (overlap > 0) reveal = union(reveal, block)
        }
        return reveal
    }
}
