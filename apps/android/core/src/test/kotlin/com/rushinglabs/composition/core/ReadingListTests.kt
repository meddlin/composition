package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.readinglist.ReadingLinks
import com.rushinglabs.composition.core.readinglist.ReadingListException
import com.rushinglabs.composition.core.readinglist.addReadingItem
import com.rushinglabs.composition.core.readinglist.deleteReadingItem
import com.rushinglabs.composition.core.readinglist.readingItem
import com.rushinglabs.composition.core.readinglist.readingItems
import com.rushinglabs.composition.core.readinglist.readingListEnabled
import com.rushinglabs.composition.core.readinglist.setReadingItemRead
import com.rushinglabs.composition.core.readinglist.setReadingItemTitle
import com.rushinglabs.composition.core.readinglist.setReadingListEnabled
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// What the conformance corpus does not reach, ported from ReadingListTests.swift: the plugin switch written back into the desktop's
// settings file, the link a refusal names, and links surviving a backup. The rules themselves are pinned against the desktop in
// ReadingListConformanceTests. The last tests are the hosts UTS #46 decides, where a platform's own IDNA would answer differently.

@DisplayName("The Reading List: the plugin switch and the store")
class ReadingListTests {
    private fun location(scratch: File) = DataLocation(File(scratch, "data"))

    private fun settingsObject(file: File): JsonObject = Json.parseToJsonElement(file.readText()).jsonObject

    private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

    private fun stored(input: String): String? = (ReadingLinks.normalize(input) as? ReadingLinks.Normalized.Link)?.url

    @Test
    @DisplayName("the switch is off with no file, and on and off again by the app's own hand")
    fun switchWithNoFile(): Unit = withScratch { scratch ->
        val store = SettingsStore(location(scratch))
        assertFalse(store.readingListEnabled())
        store.setReadingListEnabled(true)
        assertTrue(store.readingListEnabled())
        assertEquals(json("""{"reading-list":true}"""), settingsObject(location(scratch).settingsFile)["plugins"])
        store.setReadingListEnabled(false)
        assertFalse(store.readingListEnabled())
    }

    @Test
    @DisplayName("turning it on keeps the desktop's other plugins and every other key as they were")
    fun keepsTheOtherPlugins(): Unit = withScratch { scratch ->
        val place = location(scratch)
        check(place.directory.mkdirs())
        place.settingsFile.writeText("""{"theme":"forest","plugins":{"todo":false,"rss":true,"contacts":true},"todos":{"weekStart":1}}""")
        val store = SettingsStore(place)
        assertFalse(store.readingListEnabled())

        store.setReadingListEnabled(true)
        val after = settingsObject(place.settingsFile)
        assertEquals(json("""{"todo":false,"rss":true,"contacts":true,"reading-list":true}"""), after["plugins"])
        assertEquals(json("\"forest\""), after["theme"])
        assertEquals(json("""{"weekStart":1}"""), after["todos"])
    }

    @Test
    @DisplayName("a plugins value that is not an object is replaced, as the desktop would have ignored it")
    fun replacesAPluginsValueThatIsNotAnObject(): Unit = withScratch { scratch ->
        val place = location(scratch)
        check(place.directory.mkdirs())
        place.settingsFile.writeText("""{"plugins":[true]}""")
        val store = SettingsStore(place)
        store.setReadingListEnabled(true)
        assertTrue(store.readingListEnabled())
    }

    @Test
    @DisplayName("a link already in the list is refused with that link, so the screen can show it")
    fun duplicateNamesTheLink(): Unit = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val first = database.addReadingItem("example.com/a")
            assertEquals(first, assertFailsWith<ReadingListException.AlreadyListed> { database.addReadingItem("HTTPS://EXAMPLE.COM/a#later") }.item)
            assertEquals(ReadingLinks.Problem.NOT_WEB, assertFailsWith<ReadingListException.BadLink> { database.addReadingItem("javascript:alert(1)") }.problem)
            assertFailsWith<ReadingListException.Gone> { database.setReadingItemRead(99, true) }
            assertEquals(listOf(first), database.readingItems())
        }
    }

    /**
     * The one case the corpus leaves out, because the JavaScript runtimes disagree on it: Node 22 leaves a `^` in a path as it is, while
     * Node 24 and 26 (and so, almost certainly, the desktop app's Electron) write %5E. The app follows the newer answer.
     */
    @Test
    @DisplayName("a ^ in a link's path is written as %5E, as Node 24 and later write it")
    fun caretInAPath() {
        assertEquals("https://example.com/a%5Eb?c^d", stored("https://example.com/a^b?c^d"))
    }

    /**
     * Also left out of the corpus for the same reason: a title cut through an emoji leaves half of it, which Node 22's SQLite driver
     * stores as three U+FFFD and Node 24's as one. The app stores one, as the newer runtime does.
     */
    @Test
    @DisplayName("a title cut through an emoji keeps one U+FFFD for the half, as Node 24 and later store it")
    fun cutThroughAnEmoji(): Unit = withScratch { scratch ->
        val title = "a".repeat(ReadingLinks.MAX_TITLE_LENGTH - 1) + "\uD83D\uDE00 and the rest"
        assertEquals("a".repeat(ReadingLinks.MAX_TITLE_LENGTH - 1) + "\uFFFD", ReadingLinks.cleanTitle(title))
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val item = database.addReadingItem("https://example.com/long")
            assertEquals('\uFFFD', database.setReadingItemTitle(item.id, title).title.last())
            assertEquals(ReadingLinks.MAX_TITLE_LENGTH, database.readingItem(item.id)?.title?.length)
        }
    }

    @Test
    @DisplayName("a lone surrogate, which a Kotlin string can hold and a Swift one cannot, is stored as U+FFFD")
    fun loneSurrogates() {
        assertEquals("a\uFFFDb", ReadingLinks.cleanTitle("a\uD800b"))
        assertEquals("a\uFFFD", ReadingLinks.cleanTitle("a\uDC00"))
        assertEquals("https://example.com/%EF%BF%BD", stored("https://example.com/\uD800"), "as `new URL` reads it")
    }

    @Test
    @DisplayName("the ids keep counting after a delete, as the desktop's AUTOINCREMENT does")
    fun idsAreNotReused(): Unit = withScratch { scratch ->
        CompositionDatabase.open(File(scratch, "composition.db")).use { database ->
            val first = database.addReadingItem("https://example.com/1")
            database.deleteReadingItem(first.id)
            val second = database.addReadingItem("https://example.com/1")
            assertEquals(first.id + 1, second.id)
        }
    }

    @Test
    @DisplayName("links travel in a backup and come back out of it")
    fun linksTravelInABackup(): Unit = withScratch { scratch ->
        val from = DataLocation(File(scratch, "from"))
        val to = DataLocation(File(scratch, "to"))
        val archive = File(scratch, "backup.tar.gz")
        CompositionDatabase.open(from).use { database ->
            val item = database.addReadingItem("https://example.com/kept")
            database.setReadingItemTitle(item.id, "Kept")
            database.setReadingItemRead(item.id, true)
            Backup.create(database, from, archive)
        }
        Backup.apply(Backup.stage(archive, to), to)
        CompositionDatabase.open(to).use { restored ->
            assertEquals(listOf(listOf("https://example.com/kept", "Kept", "true")), restored.readingItems().map { listOf(it.url, it.title, it.read.toString()) })
        }
    }

    /**
     * Hosts that UTS #46 decides one way and IDNA 2003 (a JVM's `java.net.IDN`) another, each as Node 24's `new URL` writes it: the corpus
     * has the first three, and the rest are checked here so the port's own UTS #46 is held to them on every runtime.
     */
    @Test
    @DisplayName("a non-ASCII host is made ASCII by UTS #46, as the desktop's Node makes it")
    fun internationalHosts() {
        assertEquals("https://xn--fa-hia.de/", stored("fa\u00DF.de"), "a sharp s is kept, where IDNA 2003 made it ss")
        assertNull(stored("https://a\u200Db.com"), "a zero width joiner with no virama before it is refused, not dropped")
        assertEquals("https://xn--53h.us/", stored("https://\u2615.us"), "an emoji is a valid label")
        assertEquals("https://xn--mxa8ad.gr/", stored("\u03B1\u03C2\u03C3.gr"), "a final sigma is kept too")
        assertEquals(
            "https://xn--4gbrim.xn----ymcbaaajlc6dj7bxne2c.xn--wgbh1c/",
            stored("\u0645\u0648\u0642\u0639.\u0648\u0632\u0627\u0631\u0629-\u0627\u0644\u0627\u062A\u0635\u0627\u0644\u0627\u062A.\u0645\u0635\u0631"),
            "right-to-left labels",
        )
        assertNull(stored("a\u05D0.com"), "a label that mixes directions in a right-to-left domain is refused")
        assertEquals("https://xn--4db40a.com/", stored("\u05D0\u0661.com"), "a right-to-left label may hold Arabic digits")
        assertNull(stored("\u05D0\u06611.com"), "but not those and European digits together")
        assertEquals("https://xn--11b2ezcw70k.com/", stored("\u0915\u094D\u200D\u0937.com"), "a joiner after a virama is kept")
        assertNull(stored("\u0915\u200D\u0937.com"), "and refused anywhere else")
        assertEquals("https://xn--ngba799q.com/", stored("\u0628\u200C\u0628.com"), "a non-joiner between two joining letters is kept")
        assertNull(stored("a\u200Cb.com"), "and refused between letters that do not join")
        assertNull(stored("\u0301a.com"), "a label may not begin with a combining mark")
        assertEquals("https://example.com/", stored("ex\u00ADample.com"), "a soft hyphen is ignored")
        assertEquals("https://xn--caf-dma.com/", stored("cafe\u0301.com"), "normalised to NFC first")
        assertNull(stored("\u00E9.xn--a.com"), "Punycode that stands for a disallowed character is refused")
    }

    /**
     * Node's parser makes an all-ASCII host lowercase and nothing more, even where a label starts with `xn--` and is not Punycode for
     * anything UTS #46 allows: the URL Standard checks such labels, the desktop does not. The app stores what the desktop stores.
     */
    @Test
    @DisplayName("an all-ASCII host is only lowercased, xn-- labels included, as the desktop's Node does")
    fun asciiHostsAreOnlyLowercased() {
        assertEquals("https://xn--abc-.com/", stored("xn--abc-.com"))
        assertEquals("https://xn--a.com/", stored("XN--A.com"))
        assertEquals("https://xn--.com/", stored("xn--.com"))
        assertNull(stored("xn--a -cja.com"), "a space is still forbidden")
    }
}
