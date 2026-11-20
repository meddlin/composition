package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.json.JsonValue
import java.io.File
import kotlin.test.fail

// Shared by the PDF suites: the committed corpus read as order-keeping JSON (the PDF fixtures compare JSON columns as values and spell long
// strings as `{"$repeat": ["a", 501]}`), and a fresh database in a scratch folder.

/** A file of `fixtures/conformance` (committed, so it needs no desktop step), read as JSON. */
fun corpusJson(name: String): JsonValue {
    val directory = corpusDirectory ?: fail("fixtures/conformance is not found")
    val file = File(directory, name)
    if (!file.exists()) fail("fixtures/conformance/$name is missing")
    return JsonValue.parse(file.readText())
}

/** The entries of a list in a corpus file, each an object. */
fun JsonValue.entries(key: String): List<JsonValue.Object> =
    (objectValue?.get(key)?.arrayValue ?: fail("the corpus has no list $key")).mapNotNull { it.objectValue }

/** A fresh `composition.db` in `scratch`. */
fun openDatabase(scratch: File): CompositionDatabase = CompositionDatabase.open(File(scratch, "composition.db"))

/** A string shown in a failure: quoted, with line breaks visible, cut at 60 characters. */
fun shownText(text: String): String = "\"" + (if (text.length > 60) text.take(60) + "…" else text).replace("\n", "\\n") + "\""
