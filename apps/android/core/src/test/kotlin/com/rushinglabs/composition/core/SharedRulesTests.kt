package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.yaml.JavaScriptText
import org.junit.jupiter.api.DisplayName
import kotlin.test.Test
import kotlin.test.assertEquals

// Swift's and JavaScript's rules where Kotlin's differ, each written out once (SwiftRules.kt, yaml/JavaScriptText.kt) and shared by the slices
// that used to carry their own copies. The suites of those slices check them against the desktop and the iPad; these are the edges.

@DisplayName("Swift's and JavaScript's rules")
class SharedRulesTests {
    @Test
    @DisplayName("Swift's rounded() takes a half away from zero, and just under a half is not a half")
    fun swiftRounding() {
        assertEquals(0.0, swiftRounded(0.49999999999999994))
        assertEquals(1.0, swiftRounded(0.5))
        assertEquals(-1.0, swiftRounded(-0.5))
        assertEquals(3.0, swiftRounded(2.5))
        assertEquals(-3.0, swiftRounded(-2.5))
        assertEquals(-0.0, swiftRounded(-0.3))
        assertEquals(Double.NaN, swiftRounded(Double.NaN))
    }

    @Test
    @DisplayName("Swift's min and max pass a NaN second argument over")
    fun swiftMinMax() {
        assertEquals(1.0, swiftMin(1.0, Double.NaN))
        assertEquals(1.0, swiftMax(1.0, Double.NaN))
        assertEquals(1.0, swiftMin(2.0, 1.0))
        assertEquals(2.0, swiftMax(2.0, 1.0))
    }

    @Test
    @DisplayName("Math.round takes a half up, toward +infinity")
    fun javaScriptRound() {
        assertEquals(1.0, JavaScriptText.round(0.5))
        assertEquals(0.0, JavaScriptText.round(-0.5))
        assertEquals(3.0, JavaScriptText.round(2.5))
        assertEquals(-2.0, JavaScriptText.round(-2.5))
        assertEquals(0.0, JavaScriptText.round(0.49999999999999994))
    }

    @Test
    @DisplayName("toFixed rounds the double's exact value, a tie away from zero")
    fun javaScriptToFixed() {
        assertEquals("1.3", JavaScriptText.toFixed(1.25, 1))
        assertEquals("-1.3", JavaScriptText.toFixed(-1.25, 1))
        assertEquals("1.00", JavaScriptText.toFixed(1.005, 2)) // 1.005 is 1.00499999999999989...
        assertEquals("0.0", JavaScriptText.toFixed(0.0, 1))
        assertEquals("12", JavaScriptText.toFixed(12.3, 0))
        assertEquals("1e+21", JavaScriptText.toFixed(1e21, 1))
        assertEquals("NaN", JavaScriptText.toFixed(Double.NaN, 1))
    }

    @Test
    @DisplayName("Swift's white space: trim takes line breaks too, trimSpaces only spaces and tabs")
    fun swiftWhiteSpace() {
        val ideographic = Char(0x3000)
        val nextLine = Char(0x85)
        assertEquals("x", SwiftText.trim("$ideographic\t x \n$nextLine"))
        assertEquals("x \n", SwiftText.trimSpaces("$ideographic\t x \n"))
        assertEquals(false, SwiftText.isWhitespace(0xFEFF)) // JavaScript's \s has it; Unicode's White_Space has not
        assertEquals(true, JavaScriptText.isWhitespace(0xFEFF))
    }
}
