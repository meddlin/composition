package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.editing.LineEdit
import com.rushinglabs.composition.core.editing.ListContinuation
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// Return and Backspace in lists and quotes by hand, ported from ListContinuationTests.swift: each answer here is what the desktop's
// CodeMirror does, read from list-continuation-expected.json. ListContinuationConformanceTests compares every caret place of every case
// with the desktop.

/** The text after the edit, with `|` where the caret lands; null where the key is left to do what it always does. */
private fun after(text: String, edit: LineEdit?): String? {
    edit ?: return null
    val changed = edit.applied(text)
    return changed.substring(0, edit.selectionStart) + "|" + changed.substring(edit.selectionStart)
}

/** `marked` has a `|` where the caret is. */
private fun press(key: String, marked: String): String? {
    val caret = marked.indexOf('|')
    val text = marked.replace("|", "")
    return after(text, if (key == "return") ListContinuation.newline(text, caret) else ListContinuation.deleteBackward(text, caret))
}

@DisplayName("Return and Backspace in lists and quotes")
class ListContinuationTests {
    @Test
    @DisplayName("Return at the end of an item writes the next item's marker")
    fun continues() {
        val cases = listOf(
            "- one|" to "- one\n- |",
            "* star|" to "* star\n* |",
            "1. one|" to "1. one\n2. |",
            "9) nine|" to "9) nine\n10) |",
            "- [x] done|" to "- [x] done\n- [ ] |",
            "> quote|" to "> quote\n> |",
            "> - in quote|" to "> - in quote\n> - |",
            "- outer\n  - inner|" to "- outer\n  - inner\n  - |",
            "- a\n\t- tab|" to "- a\n\t- tab\n    - |", // the desktop writes the tab's columns as spaces
            "- trailing   |" to "- trailing\n- |",
        )
        for ((marked, expected) in cases) assertEquals(expected, press("return", marked), marked)
    }

    @Test
    @DisplayName("Return in the middle of an item splits it, and the numbers after it go up")
    fun splits() {
        assertEquals("- fo\n- |o", press("return", "- fo|o"))
        assertEquals("1. a\n2. |\n3. b\n4. c", press("return", "1. a|\n2. b\n3. c"))
    }

    @Test
    @DisplayName("Return on an empty item takes its marker off: the list ends, or the item moves out a level")
    fun ends() {
        assertEquals("- one\n- two\n|", press("return", "- one\n- two\n- |"))
        assertEquals("|", press("return", "- |"))
        assertEquals("1. outer\n   1. a\n   2. b\n2. |\n3. after", press("return", "1. outer\n   1. a\n   2. b\n   3. |\n2. after"))
        assertEquals("> - a\n> - b\n> |", press("return", "> - a\n> - b\n> - |"))
    }

    @Test
    @DisplayName("on the second item of a tight list, Return first makes the list loose, as the desktop does")
    fun loosens() {
        assertEquals("- one\n\n- |", press("return", "- one\n- |"))
        assertEquals("- one\n\n|", press("return", "- one\n\n- |"))
    }

    @Test
    @DisplayName("Return on an empty quote line writes another, and on the second ends the quote")
    fun quotes() {
        assertEquals("> one\n>\n> |", press("return", "> one\n> |"))
        assertEquals("> one\n\n|", press("return", "> one\n>\n> |"))
    }

    @Test
    @DisplayName("Return is left alone outside lists and quotes, in code, inside an HTML tag and inside the marker")
    fun declines() {
        for (marked in listOf("text|", "|", "```\n- not a list|\n```", "- item\n  ```\n  code|\n  ```", "- <Ma|rk>x</Mark>", "1|. one", "- - -|", "<DIV>\n- item|")) {
            assertNull(press("return", marked), marked)
        }
    }

    @Test
    @DisplayName("Backspace just after an empty marker turns it into spaces, and then takes the spaces")
    fun backspace() {
        assertEquals("- one\n  |", press("backspace", "- one\n- |"))
        assertEquals("- one\n|", press("backspace", "- one\n  |"))
        assertEquals("1. one\n   |", press("backspace", "1. one\n2. |"))
        assertEquals("- [x] done\n      |", press("backspace", "- [x] done\n- [ ] |"))
        assertEquals("> one\n|", press("backspace", "> one\n> |"))
        assertEquals("> > deep\n> |", press("backspace", "> > deep\n> > |"))
        assertEquals("|", press("backspace", "- |"))
    }

    @Test
    @DisplayName("Backspace is left alone in an item's text and outside lists")
    fun backspaceDeclines() {
        for (marked in listOf("- one|", "- one |x", "text |", "|", "- [ ] task|")) assertNull(press("backspace", marked), marked)
    }
}
