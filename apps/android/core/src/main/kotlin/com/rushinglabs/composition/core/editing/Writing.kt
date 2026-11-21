package com.rushinglabs.composition.core.editing

import com.rushinglabs.composition.core.SettingsStore
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// How the Markdown editor helps with the shape of the text: the ruler (a vertical guide at a column), reflow (a line that grows past its
// column is broken as it is typed), the word count, the heading rail, and the view notes open in. The desktop keeps them as the `writing`
// object of `settings.json`; this reads and writes the same one (`parseWritingSettings` and `validateWritingSettings` in `writing.ts`,
// through Writing.swift, checked by `ReflowConformanceTests`). Reflow and the ruler are off until switched on.

enum class HeadingRailSide(val rawValue: String) {
    LEFT("left"), RIGHT("right");

    companion object {
        fun of(rawValue: String): HeadingRailSide? = entries.firstOrNull { it.rawValue == rawValue }
    }
}

/** The views a note can be shown in, by the desktop's tabs (`NOTE_VIEWS` in `writing.ts`). */
enum class NoteView(val rawValue: String) {
    LIVE("live"), MARKDOWN("markdown"), PREVIEW("preview"), SPLIT("split");

    companion object {
        fun of(rawValue: String): NoteView? = entries.firstOrNull { it.rawValue == rawValue }
    }
}

data class WritingSettings(
    /** Draw a vertical guide line at `rulerColumn`. */
    val rulerEnabled: Boolean = false,
    val rulerColumn: Int = DEFAULT_COLUMN,
    /** Break lines at `reflowColumn` as they are typed. */
    val reflowEnabled: Boolean = false,
    val reflowColumn: Int = DEFAULT_COLUMN,
    /** Keep Markdown tables intact: a table row has to stay on one line to stay a table, so with this on reflow leaves table rows alone. */
    val reflowKeepsTables: Boolean = true,
    /** Show a live word count for the active note. */
    val wordCountEnabled: Boolean = false,
    /** A rail of ticks beside the text, one per heading. A look rather than a writing aid, so it is on unless switched off. */
    val headingRailEnabled: Boolean = true,
    val headingRailSide: HeadingRailSide = HeadingRailSide.LEFT,
    /**
     * The view a note opens in when it gets a new pane (Settings › Writing › "Open notes in" on the desktop). Kept here so the file
     * round-trips; nothing reads it yet.
     */
    val openNotesIn: NoteView = NoteView.LIVE,
) {
    /** What reflow does with a line, as the options `ReflowText` takes. */
    val reflowOptions: ReflowOptions get() = ReflowOptions(reflowColumn, reflowKeepsTables)

    /** The object `settings.json` holds, for the keys this type owns. */
    internal val jsonObject: Map<String, JsonElement> get() = linkedMapOf(
        "rulerEnabled" to JsonPrimitive(rulerEnabled),
        "rulerColumn" to JsonPrimitive(rulerColumn),
        "reflowEnabled" to JsonPrimitive(reflowEnabled),
        "reflowColumn" to JsonPrimitive(reflowColumn),
        "reflowKeepsTables" to JsonPrimitive(reflowKeepsTables),
        "wordCountEnabled" to JsonPrimitive(wordCountEnabled),
        "headingRailEnabled" to JsonPrimitive(headingRailEnabled),
        "headingRailSide" to JsonPrimitive(headingRailSide.rawValue),
        "openNotesIn" to JsonPrimitive(openNotesIn.rawValue),
    )

    /** What `validate` made of settings from the screen: the settings, or the words to show. */
    sealed interface Validation {
        data class Valid(val settings: WritingSettings) : Validation
        data class Invalid(val message: String) : Validation
    }

    companion object {
        const val MIN_COLUMN = 20
        const val MAX_COLUMN = 200
        const val DEFAULT_COLUMN = 80

        private val BOOLEAN_KEYS = listOf("rulerEnabled", "reflowEnabled", "reflowKeepsTables", "wordCountEnabled", "headingRailEnabled")

        /** A JSON number as JavaScript reads it (the nearest double), or null for anything else, a boolean included. */
        private fun number(value: JsonElement?): Double? = SettingsStore.jsonNumber(value)

        /** A JSON `true` or `false`, or null; kotlinx would also read the text "true" as one. */
        private fun boolean(value: JsonElement?): Boolean? {
            val primitive = value as? JsonPrimitive ?: return null
            if (primitive is JsonNull || primitive.isString) return null
            return when (primitive.content) {
                "true" -> true
                "false" -> false
                else -> null
            }
        }

        private fun string(value: JsonElement?): String? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content

        /** `isWritingColumn`: a whole number of columns the editor can use. */
        fun isColumn(value: JsonElement?): Boolean {
            val double = number(value) ?: return false
            return double.isFinite() && double == kotlin.math.truncate(double) && double >= MIN_COLUMN && double <= MAX_COLUMN
        }

        private fun column(value: JsonElement?): Int = if (isColumn(value)) number(value)!!.toInt() else DEFAULT_COLUMN

        /** `parseWritingSettings`: whatever came off disk, with the default for anything missing or invalid. */
        fun parse(data: JsonElement?): WritingSettings {
            val obj = data as? JsonObject ?: JsonObject(emptyMap())
            val defaults = WritingSettings()
            return WritingSettings(
                rulerEnabled = boolean(obj["rulerEnabled"]) ?: defaults.rulerEnabled,
                rulerColumn = column(obj["rulerColumn"]),
                reflowEnabled = boolean(obj["reflowEnabled"]) ?: defaults.reflowEnabled,
                reflowColumn = column(obj["reflowColumn"]),
                reflowKeepsTables = boolean(obj["reflowKeepsTables"]) ?: defaults.reflowKeepsTables,
                wordCountEnabled = boolean(obj["wordCountEnabled"]) ?: defaults.wordCountEnabled,
                headingRailEnabled = boolean(obj["headingRailEnabled"]) ?: defaults.headingRailEnabled,
                headingRailSide = string(obj["headingRailSide"])?.let(HeadingRailSide::of) ?: defaults.headingRailSide,
                openNotesIn = string(obj["openNotesIn"])?.let(NoteView::of) ?: defaults.openNotesIn,
            )
        }

        /**
         * `validateWritingSettings`: settings that arrive from the screen. Unlike `parse` it refuses rather than repairs: a column of 5
         * is an error to show, not a quiet 80.
         */
        fun validate(data: JsonElement?): Validation {
            val obj = data as? JsonObject ?: JsonObject(emptyMap())
            val unknown = Validation.Invalid("Unknown writing setting.")
            if (BOOLEAN_KEYS.any { boolean(obj[it]) == null }) return unknown
            if (string(obj["headingRailSide"])?.let(HeadingRailSide::of) == null) return unknown
            if (string(obj["openNotesIn"])?.let(NoteView::of) == null) return unknown
            if (!isColumn(obj["rulerColumn"]) || !isColumn(obj["reflowColumn"])) {
                return Validation.Invalid("Use a whole number of characters from $MIN_COLUMN to $MAX_COLUMN.")
            }
            return Validation.Valid(parse(obj))
        }
    }
}

/** The writing aids, as the file has them (the default for a file with none). */
fun SettingsStore.writing(): WritingSettings = locked { WritingSettings.parse(it["writing"]) }

/** Keeps the writing aids in the file's `writing` object, leaving any other key that object holds, and every other key of the file, as it was. */
fun SettingsStore.setWriting(settings: WritingSettings) = edit {
    val kept = it["writing"] as? JsonObject ?: JsonObject(emptyMap())
    it["writing"] = JsonObject(LinkedHashMap(kept).apply { putAll(settings.jsonObject) })
}
