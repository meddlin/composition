package com.rushinglabs.composition.core.live

import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.markdown.union
import com.rushinglabs.composition.core.preview.HighlightKind
import com.rushinglabs.composition.core.preview.HighlightSpan

// The Live view hides a note's syntax marks (`#`, `**`, backticks, `>`) except where the caret is, ported from LiveReveal.swift. Where "where the
// caret is" ends is this rule: for most syntax it is the caret's own line; for a fenced code block it is the whole block.

object LiveReveal {
    /**
     * The range whose marks stay showing for a caret on `line` (the line's range, with its line break, with a caret anywhere in it): that line, or,
     * when the line is part of a code block, the whole block. Both of its fences then show while the caret is anywhere in it, so it is plain that
     * the caret is inside a block; with only the fence on the caret's own line shown (the iPad's first prototype), moving into a block showed one
     * fence and hid the other, and nothing said you had entered a block.
     *
     * `spans` are the note's editor colours (`MarkdownHighlighter.spans`, or `HighlightModel.spans` for the part of the note around `line`), or at
     * least those of the blocks around `line`: their code-block spans say where the blocks are.
     */
    fun range(line: TextRange, spans: List<HighlightSpan>): TextRange {
        var reveal = line
        for (span in spans) {
            if (span.kind != HighlightKind.CodeBlock) continue
            val overlap = minOf(span.range.end, line.end) - maxOf(span.range.location, line.location)
            if (overlap > 0) reveal = union(reveal, span.range)
        }
        return reveal
    }
}
