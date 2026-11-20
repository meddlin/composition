package com.rushinglabs.composition.core

import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import java.nio.file.Files

// Shared by the tests, as TestSupport.swift is for the iPad core.

/**
 * An argument given to the instrumentation on a device (`-e conformanceDir …`), read by reflection so these tests also compile and
 * run on the JVM, where there is no Android test runner.
 */
private fun instrumentationArgument(name: String): String? = runCatching {
    val arguments = Class.forName("androidx.test.platform.app.InstrumentationRegistry").getMethod("getArguments").invoke(null)
    arguments.javaClass.getMethod("getString", String::class.java).invoke(arguments, name) as String?
}.getOrNull()

/** Where the desktop-made fixtures are (`COMPOSITION_CONFORMANCE_DIR`), or null, when the conformance tests are skipped. */
val conformanceDirectory: File? = (System.getenv("COMPOSITION_CONFORMANCE_DIR") ?: instrumentationArgument("conformanceDir"))?.let(::File)

/** `fixtures/conformance` of this checkout (set by Gradle), or `COMPOSITION_CORPUS_DIR` where the checkout is not. */
val corpusDirectory: File? =
    (System.getenv("COMPOSITION_CORPUS_DIR") ?: System.getProperty("composition.corpus") ?: instrumentationArgument("corpusDir"))
        ?.let(::File)?.takeIf { it.isDirectory }

/** Skips the calling test (reported as skipped, never as passed) unless the desktop's fixtures are there. */
fun requireConformance(): File {
    val directory = conformanceDirectory
    assumeTrue(directory != null, "COMPOSITION_CONFORMANCE_DIR is not set")
    return directory!!
}

fun fixture(name: String): File {
    val file = File(requireConformance(), name)
    check(file.exists()) { "missing fixture $name: run the desktop step first" }
    return file
}

/** A scratch folder removed when the body is done. */
fun <T> withScratch(body: (File) -> T): T {
    val directory = Files.createTempDirectory("composition-core-tests-").toFile()
    try {
        return body(directory)
    } finally {
        directory.deleteRecursively()
    }
}

/** A raw connection, for seeding or inspecting a database without the schema pass. */
fun <T> raw(file: File, body: (Db) -> T): T = SqliteFile.open(file.path).use { it.read(body) }

fun isUuid(value: String?): Boolean = value != null && value.length == 32 && value.all { it in '0'..'9' || it in 'a'..'f' }
