package com.rushinglabs.composition.core.markdown

// Pieces of regular expressions that mean what they mean in the desktop's JavaScript. A JVM's `\s` and `.` differ from JavaScript's
// (`\s` is ASCII only), and Android's are ICU's, which differ again; so the patterns the core ports spell these out instead.

/** The characters of JavaScript's `\s`, for use inside a character class: `[^${JS_SPACE_CHARS}()]`. */
internal const val JS_SPACE_CHARS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

/** JavaScript's `\s`. */
internal const val JS_SPACE = "[$JS_SPACE_CHARS]"

/** JavaScript's `.` without the `s` flag: anything but a line terminator (a JVM's also stops at U+0085). */
internal const val JS_ANY = "[^\\n\\r\\u2028\\u2029]"

/** `^ {0,3}(?:`{3,}|~{3,})` with the `m` flag. A line starts after JavaScript's line terminators only, so not after U+0085. */
private val fence = Regex("""(?<![^\n\r\u2028\u2029]) {0,3}(?:`{3,}|~{3,})""")

/**
 * Whether the line starting at `lineStart` (a UTF-16 offset) sits inside a fenced code block: the desktop's `insideFence` (fences.ts),
 * which counts the fence lines before it. The typing aids ask it too.
 */
internal fun insideFence(text: String, lineStart: Int): Boolean {
    var fences = 0
    fence.forEachMatch(text, end = lineStart) { fences++ }
    return fences % 2 == 1
}

/**
 * Each match of the pattern in `text` (or in `[0, end)` of it), found with one `Matcher`. Kotlin's `findAll` makes a new `Matcher` for
 * every match, and on Android making one copies the whole text (ICU's matcher keeps its own copy), so a pattern run over a long note
 * with many matches would copy the note that many times; on a JVM it costs nothing either way.
 */
internal inline fun Regex.forEachMatch(text: CharSequence, end: Int = text.length, action: (java.util.regex.Matcher) -> Unit) {
    val matcher = toPattern().matcher(text)
    matcher.region(0, end.coerceIn(0, text.length))
    while (matcher.find()) action(matcher)
}

/** `text` with A to Z lowered and nothing else changed, so every offset stays where it was. */
internal fun asciiLower(text: String): String {
    if (text.none { it in 'A'..'Z' }) return text
    val out = CharArray(text.length) { val c = text[it]; if (c in 'A'..'Z') c + 32 else c }
    return String(out)
}

/**
 * A pattern matched as JavaScript's `i` flag (without `u`) matches: A to Z in either case, and no other letter folded. No platform flag
 * does that everywhere. Kotlin's `IGNORE_CASE` adds Unicode case folding, and on Android even `(?i)` folds Unicode case, so `ſ` matches
 * `s` and the Kelvin sign matches `k`, where the desktop matches neither. So the pattern is written in lower case, with no flag, and is
 * run on the text with only A to Z lowered.
 */
internal class AsciiCaseless(lowerCasePattern: String) {
    private val regex = Regex(lowerCasePattern)

    fun containsMatchIn(text: String): Boolean = regex.containsMatchIn(asciiLower(text))

    /** The first match, in the lowered text (its offsets are the text's own). */
    fun find(text: String): MatchResult? = regex.find(asciiLower(text))
}
