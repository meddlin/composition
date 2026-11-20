package com.rushinglabs.composition.core

import com.rushinglabs.composition.core.images.ImageLibrary
import com.rushinglabs.composition.core.images.ImageStoreResult
import com.rushinglabs.composition.core.images.MarkdownImages
import com.rushinglabs.composition.core.images.NoteText
import com.rushinglabs.composition.core.images.NotAnImageName
import com.rushinglabs.composition.core.images.StoredImageInfo
import com.rushinglabs.composition.core.images.StoredImageType
import com.rushinglabs.composition.core.images.StoredImages
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.DisplayName
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The desktop's `images.ts`, `imageRefs.ts`, `imageToMdx.ts` and `imagePicker.ts` against the real functions, ported from
// ImagesConformanceTests.swift. The inputs are fixtures/conformance/images-cases.json (byte strings to sniff, names, real stores into a
// folder, alt text, Markdown and tags, notes' image references, cursors and selections for the conversion to `<Image />` tags, folders to
// list, notes to join, picker queries and labels); what the desktop made of each is images-expected.json. Each test gathers every
// difference before failing, so one run shows them all.

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it != JsonNull && it.isString }?.content

private fun hexBytes(hex: String): ByteArray = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

private fun shown(text: String): String = "\"" + (if (text.length > 60) text.take(60) + "…" else text).replace("\n", "\\n") + "\""

@DisplayName("Images against the desktop")
class ImagesConformanceTests {
    private class Fixtures(val cases: JsonObject, val expected: JsonObject) {
        fun cases(key: String) = cases.getValue(key).jsonArray
        fun expected(key: String) = expected.getValue(key).jsonArray
    }

    private fun load(): Fixtures {
        val directory = requireConformance()
        return Fixtures(readJson(File(directory, "images-cases.json")).jsonObject, readJson(File(directory, "images-expected.json")).jsonObject)
    }

    private fun report(what: String, total: Int, different: List<String>) {
        println("Images, $what: ${total - different.size} of $total agree with the desktop")
        different.take(40).forEach { println("  $it") }
        assertTrue(different.isEmpty(), "$what that differ: ${different.size}")
    }

    @Test
    @DisplayName("every byte string is sniffed as sniffImage does")
    fun sniffing() {
        val f = load()
        assertEquals(f.cases("sniff").size, f.expected("sniff").size)
        val different = ArrayList<String>()
        for ((index, item) in f.cases("sniff").withIndex()) {
            val hex = item.jsonObject.getValue("hex").jsonPrimitive.content
            val got = StoredImages.sniff(hexBytes(hex))?.rawValue
            val want = f.expected("sniff")[index].text()
            if (got != want) different.add("bytes $hex: ours $got, desktop $want")
        }
        report("sniffed byte strings", f.cases("sniff").size, different)
    }

    @Test
    @DisplayName("every stored name is the one imageFileName makes")
    fun names() {
        val f = load()
        assertEquals(f.cases("fileName").size, f.expected("fileName").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("fileName").withIndex()) {
            val item = element.jsonObject
            val title = item.getValue("title").jsonPrimitive.content
            val file = item.getValue("file").jsonPrimitive.content
            val type = StoredImageType.of(item.getValue("ext").jsonPrimitive.content)!!
            val got = StoredImages.fileName(title, file, hexBytes(item.getValue("hex").jsonPrimitive.content), type)
            val want = f.expected("fileName")[index].jsonPrimitive.content
            if (got != want) different.add("title ${shown(title)}, file ${shown(file)}: ours $got, desktop $want")
        }
        report("file names", f.cases("fileName").size, different)
    }

    @Test
    @DisplayName("every real store gives the desktop's name or refusal, the same bytes on disk, and reuses the file the second time")
    fun storing() {
        val f = load()
        assertEquals(f.cases("store").size, f.expected("store").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("store").withIndex()) {
            val item = element.jsonObject
            val want = f.expected("store")[index].jsonObject
            withScratch { scratch ->
                val location = DataLocation(scratch)
                val data = hexBytes(item.getValue("hex").jsonPrimitive.content)
                val title = item.getValue("title").jsonPrimitive.content
                val file = item.getValue("file").jsonPrimitive.content
                val maxBytes = (item["maxBytes"] as? JsonPrimitive)?.takeIf { it != JsonNull }?.long
                val result = StoredImages.store(title, file, data, location, maxBytes)
                val error = want["error"].text()
                if (error != null) {
                    if (result != ImageStoreResult.Failed(error)) different.add("case $index: ours $result, desktop refused with \"$error\"")
                } else {
                    val name = want.getValue("name").jsonPrimitive.content
                    if (result != ImageStoreResult.Stored(name)) {
                        different.add("case $index: ours $result, desktop stored $name")
                    } else {
                        val written = File(location.imagesDirectory, name).readBytes()
                        if (!written.contentEquals(data) || written.size != want.getValue("size").jsonPrimitive.int) different.add("case $index: the file's bytes differ")
                        val again = StoredImages.store(title, file, data, location, maxBytes)
                        if (again != result || !want.getValue("reused").jsonPrimitive.boolean) different.add("case $index: stored again as $again")
                        val left = location.imagesDirectory.list()!!.toList()
                        if (left != listOf(name)) different.add("case $index: the folder holds $left")
                    }
                }
            }
        }
        report("stores", f.cases("store").size, different)
    }

    @Test
    @DisplayName("alt text, Markdown, tags and references are what imageRefs.ts makes")
    fun text() {
        val f = load()
        val different = ArrayList<String>()
        for ((index, item) in f.cases("alt").withIndex()) {
            val name = item.jsonObject.getValue("name").jsonPrimitive.content
            val got = StoredImages.alt(name)
            val want = f.expected("alt")[index].jsonPrimitive.content
            if (got != want) different.add("alt of ${shown(name)}: ours ${shown(got)}, desktop ${shown(want)}")
        }
        for ((index, element) in f.cases("markdown").withIndex()) {
            val item = element.jsonObject
            val name = item.getValue("name").jsonPrimitive.content
            val alt = item["alt"].text()
            val got = StoredImages.markdown(name, alt)
            val want = f.expected("markdown")[index].jsonPrimitive.content
            if (got != want) different.add("markdown of ${shown(name)} with ${alt?.let(::shown)}: ours ${shown(got)}, desktop ${shown(want)}")
        }
        for ((index, item) in f.cases("tag").withIndex()) {
            val name = item.jsonObject.getValue("name").jsonPrimitive.content
            val want = f.expected("tag")[index].jsonObject
            val got = try {
                "tag " + StoredImages.tag(name)
            } catch (refused: NotAnImageName) {
                "error " + refused.message
            }
            val theirs = want["tag"].text()?.let { "tag $it" } ?: "error ${want["error"].text()}"
            if (got != theirs) different.add("tag of ${shown(name)}: ours $got, desktop $theirs")
        }
        for ((index, item) in f.cases("refs").withIndex()) {
            val text = item.jsonObject.getValue("text").jsonPrimitive.content
            val got = StoredImages.findRefs(text).sorted()
            val want = f.expected("refs")[index].jsonArray.map { it.jsonPrimitive.content }
            if (got != want) different.add("references in ${shown(text)}: ours $got, desktop $want")
        }
        val total = listOf("alt", "markdown", "tag", "refs").sumOf { f.cases(it).size }
        report("alt texts, Markdown, tags and references", total, different)
    }

    @Test
    @DisplayName("every cursor and selection converts to the edit imagesToMdx makes, or to none")
    fun conversion() {
        val f = load()
        assertEquals(f.cases("toMdx").size, f.expected("toMdx").size)
        val different = ArrayList<String>()
        var edits = 0
        for ((index, element) in f.cases("toMdx").withIndex()) {
            val item = element.jsonObject
            val text = item.getValue("text").jsonPrimitive.content
            val start = item.getValue("start").jsonPrimitive.int
            val end = item.getValue("end").jsonPrimitive.int
            val got = MarkdownImages.toMdx(text, start, end)?.let { "${it.start}-${it.end} caret ${it.caret} ${shown(it.text)}" }
            val want = (f.expected("toMdx")[index] as? JsonObject)?.let {
                "${it.getValue("start").jsonPrimitive.int}-${it.getValue("end").jsonPrimitive.int} caret ${it.getValue("caret").jsonPrimitive.int} ${shown(it.getValue("text").jsonPrimitive.content)}"
            }
            if (want != null) edits++
            if (got != want) different.add("${shown(text)} from $start to $end: ours $got, desktop $want")
        }
        assertTrue(edits > 300, "the cases make $edits edits")
        report("cursors and selections", f.cases("toMdx").size, different)
    }

    @Test
    @DisplayName("every folder lists as the real listImages lists it: newest first, ties by name, only real image files")
    fun listing() {
        val f = load()
        assertEquals(f.cases("list").size, f.expected("list").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("list").withIndex()) {
            val item = element.jsonObject
            withScratch { scratch ->
                val location = DataLocation(scratch)
                if (!item.getValue("noFolder").jsonPrimitive.boolean) {
                    val folder = location.imagesDirectory
                    check(folder.mkdirs())
                    fun touch(name: String, stamp: String) {
                        val milliseconds = Timestamp.milliseconds(stamp.replace("Z", ".000Z"))!!
                        check(File(folder, name).setLastModified(milliseconds)) { "could not set the time of $name" }
                    }
                    for (file in item.getValue("files").jsonArray.map { it.jsonObject }) {
                        val name = file.getValue("name").jsonPrimitive.content
                        File(folder, name).writeBytes(ByteArray(file.getValue("size").jsonPrimitive.int) { 0x61 })
                        touch(name, file.getValue("modified").jsonPrimitive.content)
                    }
                    for (name in item.getValue("dirs").jsonArray.map { it.jsonPrimitive.content }) check(File(folder, name).mkdir())
                    for (name in item.getValue("others").jsonArray.map { it.jsonPrimitive.content }) {
                        File(folder, name).writeText("abcd")
                        touch(name, "2020-01-01T00:00:00Z")
                    }
                }
                val got = ImageLibrary.list(location).map { "${it.name} ${it.size} ${it.modifiedAt}" }
                val want = f.expected("list")[index].jsonArray.map {
                    val file = it.jsonObject
                    "${file.getValue("name").jsonPrimitive.content} ${file.getValue("size").jsonPrimitive.long} ${file.getValue("modifiedAt").jsonPrimitive.content}"
                }
                if (got != want) different.add("folder $index: ours $got, desktop $want")
            }
        }
        report("folders", f.cases("list").size, different)
    }

    @Test
    @DisplayName("the notes that point at each image are what imageUsage finds, in the order the notes are given")
    fun usage() {
        val f = load()
        assertEquals(f.cases("usage").size, f.expected("usage").size)
        val different = ArrayList<String>()
        for ((index, element) in f.cases("usage").withIndex()) {
            val notes = element.jsonObject.getValue("notes").jsonArray.map {
                val note = it.jsonObject
                NoteText(note.getValue("id").jsonPrimitive.long, note.getValue("title").jsonPrimitive.content, note.getValue("content").jsonPrimitive.content)
            }
            val got = ImageLibrary.usage(notes).mapValues { (_, uses) -> uses.map { "${it.id}:${it.title}" } }
            val want = f.expected("usage")[index].jsonObject.mapValues { (_, uses) ->
                uses.jsonArray.map { "${it.jsonObject.getValue("id").jsonPrimitive.long}:${it.jsonObject.getValue("title").jsonPrimitive.content}" }
            }
            if (got != want) different.add("notes $index: ours $got, desktop $want")
        }
        report("note sets", f.cases("usage").size, different)
    }

    @Test
    @DisplayName("what the picker offers for each query is what matchImages offers, with the same limit")
    fun matching() {
        val f = load()
        assertEquals(f.cases("match").size, f.expected("match").size)
        val different = ArrayList<String>()
        var found = 0
        for ((index, element) in f.cases("match").withIndex()) {
            val item = element.jsonObject
            val images = item.getValue("names").jsonArray.map { StoredImageInfo(it.jsonPrimitive.content, 0, "", emptyList()) }
            val query = item.getValue("query").jsonPrimitive.content
            val limit = (item["limit"] as? JsonPrimitive)?.takeIf { it != JsonNull }?.int
            val got = (if (limit != null) ImageLibrary.match(images, query, limit) else ImageLibrary.match(images, query)).map { it.name }
            val want = f.expected("match")[index].jsonArray.map { it.jsonPrimitive.content }
            if (got.isNotEmpty()) found++
            if (got != want) different.add("query ${shown(query)} over ${images.size} names, limit $limit: ours $got, desktop $want")
        }
        assertTrue(found > 30, "$found queries found something")
        report("picker queries", f.cases("match").size, different)
    }

    @Test
    @DisplayName("the labels under an image read as usageLabel and formatSize write them")
    fun labels() {
        val f = load()
        val different = ArrayList<String>()
        for ((index, count) in f.cases("usageLabel").withIndex()) {
            val got = ImageLibrary.usageLabel(count.jsonPrimitive.int)
            val want = f.expected("usageLabel")[index].jsonPrimitive.content
            if (got != want) different.add("$count notes: ours $got, desktop $want")
        }
        for ((index, bytes) in f.cases("sizeLabel").withIndex()) {
            val got = ImageLibrary.sizeLabel(bytes.jsonPrimitive.long)
            val want = f.expected("sizeLabel")[index].jsonPrimitive.content
            if (got != want) different.add("$bytes bytes: ours $got, desktop $want")
        }
        report("labels", f.cases("usageLabel").size + f.cases("sizeLabel").size, different)
    }
}
