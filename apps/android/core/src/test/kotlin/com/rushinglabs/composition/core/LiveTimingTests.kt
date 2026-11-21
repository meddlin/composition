package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.live.LiveModel
import com.rushinglabs.composition.core.live.LiveScan
import com.rushinglabs.composition.core.markdown.TextRange
import com.rushinglabs.composition.core.preview.HighlightModel
import org.junit.jupiter.api.DisplayName
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertTrue

// How long the Live model takes on a long note. The iPad measures its Live tab in the app (`LiveSpeedUITests` and `LiveBench`,
// docs/ipad-live-view-plan.md, step L7) on the Editor lab's note of 5,000 and 20,000 lines; this times the model alone on the same notes, so a run
// on the Mac's JVM and one on the emulator can be compared with each other and, roughly, with the iPad's. Printed; the bounds only catch something
// badly wrong.

@DisplayName("Live timings")
class LiveTimingTests {
    /** The Editor lab's text for `lines` lines (`LiveSpeedUITests.bigNote`): 5,000 lines are about 100,000 characters, the desktop's limit. */
    private fun bigNote(lines: Int, highlights: Boolean = false): String {
        val out = arrayListOf("---", "title: Big note", "---", "# Big note", "")
        var section = 0
        while (out.size < lines) {
            if (highlights) out += listOf("Some <Mark color=\"yellow\">highlighted</Mark> and <Mark color=\"green\">tinted</Mark> words.", "")
            if (highlights && section % 50 == 0) out += listOf("![the picture](app_data/demo-photo-0123456789ab.png)", "")
            out += listOf(
                "## Section $section", "",
                "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/$section) with é and 😀. " +
                    "The rest of this line is plain text to make it long enough to wrap onto a second line on an iPad.",
                "", "- item one", "- item two", "", "> a quote", "", "```", "let x = $section", "```", "",
            )
            section++
        }
        return out.joinToString("\n")
    }

    private fun milliseconds(start: Long) = (System.nanoTime() - start) / 1_000_000.0

    private fun median(values: List<Double>) = values.sorted()[values.size / 2]

    private fun format(value: Double) = String.format(Locale.ROOT, "%.2f", value)

    private fun measure(lines: Int, highlights: Boolean): String {
        val text = bigNote(lines, highlights)
        LiveModel(text) // warm
        val reads = (0 until 3).map {
            val start = System.nanoTime()
            LiveModel(text)
            milliseconds(start)
        }
        val model = LiveModel(text)
        // The read's two parts: the Markdown (a model told to read no highlights or pictures), and the highlights and pictures (`LiveScan`).
        val markdown = median((0 until 3).map { System.nanoTime().let { start -> LiveModel(text, extrasLimit = 0); milliseconds(start) } })
        val extras = median((0 until 3).map { System.nanoTime().let { start -> LiveScan.read(text); milliseconds(start) } })

        // What the editor asks for after a keystroke or a caret move: the part of the note on screen, about 3,000 characters.
        val middle = text.length / 2
        val window = TextRange(middle, 3_000)
        val windowTimes = (0 until 50).map {
            val start = System.nanoTime()
            model.decorations(window, TextRange(middle + it * 10, 0))
            milliseconds(start)
        }

        // A keystroke: a letter typed in the middle of a paragraph, the editor's colours re-reading its blocks and the Live model following.
        val paragraph = text.indexOf("Some **bold**", middle)
        var typed = text
        val colours = HighlightModel(typed)
        val live = LiveModel(typed)
        val keystrokes = (0 until 50).map {
            val at = paragraph + 5 + it
            typed = typed.substring(0, at) + "x" + typed.substring(at)
            val reread = colours.edited(TextRange(at, 0), 1, typed)
            val start = System.nanoTime()
            live.edited(TextRange(at, 0), 1, reread, typed)
            live.decorations(window, TextRange(at + 1, 0))
            milliseconds(start)
        }
        val whole = System.nanoTime().let { start ->
            model.decorations(TextRange(middle, 0))
            milliseconds(start)
        }
        assertTrue(median(reads) < 20_000, "reading a ${text.length}-character note took ${median(reads)} ms")
        return "${String.format(Locale.ROOT, "%,d", text.length)} characters${if (highlights) " with highlights and pictures" else ""}: " +
            "read ${format(median(reads))} ms (Markdown ${format(markdown)}, highlights and pictures ${format(extras)}), a window ${format(median(windowTimes))} ms, a keystroke ${format(median(keystrokes))} ms " +
            "(p95 ${format(keystrokes.sorted()[keystrokes.size * 95 / 100])}), the whole note's decorations ${format(whole)} ms"
    }

    @Test
    @DisplayName("reads a long note, and follows a keystroke in it")
    fun longNote() {
        println("Timings, Live model, 5,000 lines: ${measure(5_000, highlights = false)}")
        println("Timings, Live model, 20,000 lines: ${measure(20_000, highlights = true)}")
    }
}
