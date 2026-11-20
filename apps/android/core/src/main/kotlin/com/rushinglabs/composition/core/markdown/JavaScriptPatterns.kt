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
private val fence = Regex("""(?<![^\n\r  ]) {0,3}(?:`{3,}|~{3,})""")

/**
 * Whether the line starting at `lineStart` (a UTF-16 offset) sits inside a fenced code block: the desktop's `insideFence` (fences.ts),
 * which counts the fence lines before it. The typing aids ask it too.
 */
internal fun insideFence(text: String, lineStart: Int): Boolean = fence.findAll(text.substring(0, lineStart)).count() % 2 == 1
