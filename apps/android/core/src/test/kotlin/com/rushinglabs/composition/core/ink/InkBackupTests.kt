package com.rushinglabs.composition.core.ink

import com.rushinglabs.composition.core.Backup
import com.rushinglabs.composition.core.CompositionDatabase
import com.rushinglabs.composition.core.DataLocation
import com.rushinglabs.composition.core.appearance.ThemeColor
import com.rushinglabs.composition.core.createNote
import com.rushinglabs.composition.core.images.ImageStoreResult
import com.rushinglabs.composition.core.images.StoredImages
import com.rushinglabs.composition.core.saveNoteContent
import com.rushinglabs.composition.core.skipUnless
import com.rushinglabs.composition.core.withScratch
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// A drawing's trip through a backup (docs/architecture/ink.md, "A backup"), ported from InkBackupTests.swift: the PNG sits in `app_data/`
// beside the other stored images, the note names it with an `<Ink>` tag, and a restore, here, on the iPad or on the desktop, gives both
// back unchanged. `fixtures/conformance/ink/backup.tar.gz` is such a backup, made by the iPad's Swift, which the Kotlin restore reads here
// (and the desktop's in `inkBackup.test.ts`).

@DisplayName("Ink: a drawing in a backup")
class InkBackupTests {
    private val title = "Trip plan"
    private val intro = "A sketch from the iPad:"

    /** A data directory with one note holding the sample drawing, backed up to `file`. Returns the PNG as it was stored and the name it was stored under. */
    private fun makeBackup(folder: File, file: File): Pair<ByteArray, String> {
        val location = DataLocation(File(folder, "source"))
        check(location.directory.mkdirs())
        CompositionDatabase.open(location).use { database ->
            val png = InkRaster.pngData(InkSamples.page(), InkPalette(ThemeColor(0xE0, 0xE0, 0xE0), ThemeColor(0x01, 0x78, 0xD4), darkStyle = true))
            val stored = StoredImages.store(title, "drawing.png", png, location)
            val name = (stored as? ImageStoreResult.Stored)?.name ?: throw InkError("the drawing was not stored: $stored")
            val note = database.createNote(title, tags = "sketch")
            val body = "$intro\n\n${InkTag.markdown(name, alt = "A pen wave, a marker line and a dot")}\n"
            database.saveNoteContent(note.id, note.content + body)
            Backup.create(database, location, file)
            return png to name
        }
    }

    private class Restored(val text: String, val png: ByteArray, val name: String)

    /** Restores the backup at `file` into a new data directory, and returns the note's text and the stored PNG it names. */
    private fun restored(file: File, folder: File): Restored {
        val target = DataLocation(File(folder, "target"))
        val staged = Backup.stage(file, target)
        Backup.apply(staged, target)
        CompositionDatabase.open(target).use { database ->
            val note = assertNotNull(database.listNotes().firstOrNull())
            val text = assertNotNull(database.note(note.id)?.content)
            val name = assertNotNull(text.split("app_data/").drop(1).firstOrNull()?.substringBefore("\""))
            return Restored(text, File(target.imagesDirectory, name).readBytes(), name)
        }
    }

    @Test
    @DisplayName("a drawing survives a backup and a restore byte for byte")
    fun aDrawingSurvivesABackupAndARestoreByteForByte() = withScratch { folder ->
        val file = File(folder, "backup.tar.gz")
        val (png, name) = makeBackup(folder, file)
        val back = restored(file, folder)
        assertTrue(back.name == name && back.png.contentEquals(png), "the stored file is the same bytes")
        assertTrue(back.text.contains("<Ink src=\"app_data/$name\" alt=\"A pen wave, a marker line and a dot\" />"))
        val contents = InkPng.contents(back.png)
        assertEquals(emptyList(), contents.problems)
        assertEquals(InkSamples.page(), contents.drawing())
        assertEquals(2.0, InkPng.pixelsPerPoint(back.png))
    }

    @Test
    @DisplayName("the iPad's committed backup restores with its drawing")
    fun theCommittedBackupRestoresWithItsDrawing() {
        val directory = InkCorpus.directory
        skipUnless(directory != null, "fixtures/conformance/ink is not here")
        withScratch { folder ->
            val back = restored(File(directory, "backup.tar.gz"), folder)
            assertTrue(back.text.contains(intro) && back.text.contains("title: $title"))
            assertTrue(back.text.contains("<Ink src=\"app_data/${back.name}\" alt=\"A pen wave, a marker line and a dot\" />"), "the note's <Ink> tag")
            val contents = InkPng.contents(back.png)
            assertEquals(emptyList(), contents.problems)
            assertEquals(InkSamples.page(), contents.drawing())
            assertEquals(InkImageSize(400, 240), InkPng.pixelSize(back.png), "the picture among the images")
            assertEquals(2.0, InkPng.pixelsPerPoint(back.png))
            // The name carries a hash of the PNG's bytes, so the file is the one the note names.
            assertTrue(back.name.startsWith("trip-plan-drawing-") && back.name.endsWith(".png"))
            println("Ink, backup.tar.gz: 1 of 1 drawings restored, the <Ink> tag, the PNG and ${contents.drawing()?.pointCount} points agree with the desktop")
        }
    }
}
