import Foundation
import Markdown
import Testing

@testable import CompositionCore

/// Where each top-level block of a note is written (docs/ipad-live-default-plan.md, Step 5): what the Live tab draws a block's picture in place of. Checked over every note of
/// `fixtures/conformance/mdx-notes.json` and the preview showcase, as the note itself and with a frontmatter and `\r\n` line ends: the ranges cover the body (all but the
/// footnotes' own text, which the Preview lists elsewhere), never overlap, and the text in each is the block it says.
@Suite("Where a note's blocks are written")
struct BlockRangeTests {
    private struct NotesFile: Decodable {
        struct Note: Decodable {
            var name: String
            var body: String
        }
        var notes: [Note]
    }

    private static func corpus() throws -> [(name: String, text: String)] {
        let directory = try #require(corpusDirectory)
        let notes = try JSONDecoder().decode(NotesFile.self, from: Data(contentsOf: directory.appendingPathComponent("mdx-notes.json"))).notes
        let showcase = try String(contentsOf: directory.appendingPathComponent("preview-showcase/note.md"), encoding: .utf8)
        return notes.map { ($0.name, $0.body) } + [("preview-showcase", showcase)]
    }

    /// The lines of `text` no range covers that have something on them, other than a footnote's definition (and the lines that continue one).
    private func uncovered(_ text: NSString, by ranges: [NSRange], from start: Int) -> [String] {
        var covered = [Bool](repeating: false, count: text.length)
        for range in ranges { for i in range.location..<NSMaxRange(range) { covered[i] = true } }
        var lines: [String] = []
        var inDefinition = false
        text.enumerateSubstrings(in: NSRange(location: start, length: text.length - start), options: [.byLines, .substringNotRequired]) { _, line, _, _ in
            let words = text.substring(with: line)
            let trimmed = words.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { return }
            if trimmed.hasPrefix("[^") && trimmed.contains("]:") { inDefinition = true }
            else if inDefinition && (words.hasPrefix("    ") || words.hasPrefix("\t")) {}
            else if !(line.location..<NSMaxRange(line)).allSatisfy({ covered[$0] || text.character(at: $0) == 0x20 || text.character(at: $0) == 0x09 || text.character(at: $0) == 0x0D }) {
                inDefinition = false
                lines.append(words)
            } else { inDefinition = false }
        }
        return lines
    }

    private func check(_ name: String, _ text: String, bodyStart: Int) throws {
        let scanned = NoteScanner.scan(NoteFrontmatter.split(text).body, at: bodyStart)
        let whole = text as NSString
        #expect(scanned.blockRanges.count == scanned.blocks.count, "\(name): a range for each block")
        // In order, never overlapping, inside the body.
        var end = bodyStart
        for range in scanned.blockRanges {
            #expect(range.location >= end, "\(name): \(range) overlaps the block before it, or starts before the body")
            #expect(NSMaxRange(range) <= whole.length, "\(name): \(range) runs past the note")
            end = NSMaxRange(range)
        }
        #expect(uncovered(whole, by: scanned.blockRanges, from: bodyStart).isEmpty, "\(name): lines no block holds: \(uncovered(whole, by: scanned.blockRanges, from: bodyStart))")
        // Each range holds its block: a component's tags from `<Name` to its end, and the same element when the range alone is scanned; a run of Markdown its own
        // text, with only blank lines and the footnotes' text left out.
        for (block, range) in zip(scanned.blocks, scanned.blockRanges) {
            let written = whole.substring(with: range).replacingOccurrences(of: "\r\n", with: "\n")
            switch block {
            case .element(let elementName, _, _):
                #expect(written.hasPrefix("<\(elementName)"), "\(name): \(String(reflecting: written.prefix(40))) is <\(elementName)>")
                let atLineStart = range.location == bodyStart || whole.character(at: range.location - 1) == 0x0A
                if scanned.isValid, atLineStart { #expect(NoteScanner.scan(written).blocks == [block], "\(name): <\(elementName)> scanned alone is the same element") }
            case .markdown(let source):
                if scanned.footnotes.isEmpty, !written.contains("[^") {
                    #expect(written == source.trimmingCharacters(in: .newlines) || source.contains(written), "\(name): the run's text is what is written there")
                    #expect(Document(parsing: written).format() == Document(parsing: source).format(), "\(name): and parses the same")
                }
            }
        }
    }

    @Test("every corpus note: ranges cover the body, in order, never overlapping, each holding its block")
    func corpusNotes() throws {
        for (name, text) in try Self.corpus() {
            let body = NoteFrontmatter.split(text).body
            try check(name, text, bodyStart: (text as NSString).length - (body as NSString).length)
        }
    }

    @Test("the same with a frontmatter put in front and every line ended by \\r\\n")
    func shifted() throws {
        for (name, body) in try Self.corpus().prefix(60) {
            let withFront = body.hasPrefix("---\n") ? body : "---\ntitle: T é😀\n---\n" + body
            let front = (withFront as NSString).length - (NoteFrontmatter.split(withFront).body as NSString).length
            try check(name + " (frontmatter)", withFront, bodyStart: front)
            let crlf = withFront.replacingOccurrences(of: "\n", with: "\r\n")
            let crlfFront = (crlf as NSString).length - (NoteFrontmatter.split(crlf).body as NSString).length
            try check(name + " (crlf)", crlf, bodyStart: crlfFront)
        }
    }

    // MARK: Located blocks (what the Live tab draws)

    private static func isTable(_ block: PreviewBlock) -> Bool {
        if case .markdown(let blocks) = block, blocks.count == 1, case .table = blocks[0] { return true }
        return false
    }

    private static func isParagraph(_ block: PreviewBlock) -> Bool {
        if case .markdown(let blocks) = block, blocks.count == 1, case .paragraph = blocks[0] { return true }
        return false
    }

    @Test("the located blocks are the preview's own blocks, a run of Markdown split into its blocks, each written where it says")
    func located() throws {
        let corpus = try Self.corpus()
        let crlf = corpus[corpus.count - 1].text.replacingOccurrences(of: "\n", with: "\r\n")
        for (name, text) in corpus + [(name: "crlf showcase", text: crlf)] {
            let preview = NotePreview.make(content: text)
            let whole = text as NSString
            // The same blocks: the markdown runs' blocks in order, and the components as they are.
            var flattened: [PreviewBlock] = []
            for block in preview.blocks {
                if case .markdown(let blocks) = block { flattened += blocks.map { .markdown([$0]) } } else if case .footnotes = block {} else { flattened.append(block) }
            }
            let ours = preview.located.map(\.block).filter { if case .footnotes = $0 { false } else { true } }
            let theirs = flattened.filter { if case .markdown(let blocks) = $0 { !blocks.isEmpty } else { true } }
            // A `<Footnotes />` that is written is located; one only listed at the end is not.
            #expect(ours == theirs || preview.located.map(\.block) == flattened, "\(name): located blocks are the preview's")
            var end = 0
            for located in preview.located {
                #expect(located.range.location >= end && NSMaxRange(located.range) <= whole.length, "\(name): \(located.range) in order, inside the note")
                end = NSMaxRange(located.range)
                let written = whole.substring(with: located.range).replacingOccurrences(of: "\r\n", with: "\n")
                if Self.isTable(located.block), case .markdown(let own) = located.block {
                    #expect(written.hasPrefix("|") && written.hasSuffix("|"), "\(name): a table from its first pipe to its last: \(String(reflecting: written))")
                    #expect(written.split(separator: "\n").count >= 2)
                    // The table's text alone is the same table.
                    var converter = MarkdownConverter()
                    #expect(converter.blocks(Document(parsing: written)) == own, "\(name): the table's text parses to the same table")
                }
            }
        }
    }

    @Test("a table between paragraphs, after a frontmatter, with a footnote's text before it, is located on its lines")
    func tableAfterFootnote() throws {
        let note = "---\ntitle: T\n---\nIntro[^a] é😀\n\n[^a]: the note's footnote.\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nafter\n"
        let preview = NotePreview.make(content: note)
        let whole = note as NSString
        let table = try #require(preview.located.first { Self.isTable($0.block) })
        #expect(whole.substring(with: table.range) == "| x | y |\n|---|---|\n| 1 | 2 |")
        let paragraphs = preview.located.filter { Self.isParagraph($0.block) }.map { whole.substring(with: $0.range) }
        #expect(paragraphs == ["Intro[^a] é😀", "after"])
    }

    @Test("a component is located from its opening tag to the end of its closing one, and what is inside is not located again")
    func components() throws {
        let note = "a\n\n<Info>\n\n| x |\n|---|\n| 1 |\n\n</Info>\n\n<Image src=\"app_data/a.png\" />\n"
        let preview = NotePreview.make(content: note)
        let whole = note as NSString
        #expect(preview.located.map { whole.substring(with: $0.range) } == ["a", "<Info>\n\n| x |\n|---|\n| 1 |\n\n</Info>", "<Image src=\"app_data/a.png\" />"])
        guard case .panel(.info, _) = preview.located[1].block else { Issue.record("the panel is the second block"); return }
    }

    @Test("each component the Live tab draws (Step 6) is located whole, one block each: panels, a block Mark, charts, cards and a notice")
    func everyComponentDrawnInLive() throws {
        let parts = [
            "<Info>\n\nSome **words**.\n\n</Info>",
            "<Warning>\n\n- one\n- two\n\n</Warning>",
            "<Mark color=\"green\">\n\nA tinted block.\n\n</Mark>",
            "<Chart type=\"bar\" x=\"k\" y=\"v\">\n\n```csv\nk,v\na,1\nb,2\n```\n\n</Chart>",
            "<YouTube url=\"https://youtu.be/dQw4w9WgXcQ\" title=\"A video\" />",
            "<Repo url=\"https://github.com/meddlin/composition\" />",
            "<Repo url=\"not a repository\" />",
        ]
        let note = "a\n\n" + parts.joined(separator: "\n\n") + "\n\nb\n"
        let preview = NotePreview.make(content: note)
        #expect(preview.error == nil)
        let whole = note as NSString
        #expect(preview.located.map { whole.substring(with: $0.range) } == ["a"] + parts + ["b"])
        let kinds = preview.located.dropFirst().dropLast().map { located -> String in
            switch located.block {
            case .panel(let tone, _): tone == .info ? "info" : "warning"
            case .highlight: "mark"
            case .chart: "chart"
            case .youtube: "youtube"
            case .repo: "repo"
            case .notice: "notice"
            default: "other"
            }
        }
        #expect(kinds == ["info", "warning", "mark", "chart", "youtube", "repo", "notice"])
    }

    @Test("a note that stops being valid MDX loses its located components (why the Live tab keeps its last good pictures then, Step 6)")
    func invalidNoteLosesComponents() throws {
        let valid = "<Info>\n\nx\n\n</Info>\n\nan open"
        #expect(NotePreview.make(content: valid).error == nil)
        let broken = NotePreview.make(content: valid.replacingOccurrences(of: "an open", with: "an <Mark>open"))
        #expect(broken.error != nil)
        #expect(!broken.located.contains { if case .panel = $0.block { true } else { false } }, "the panel is plain Markdown while the note is not valid")
    }

    @Test("a long note's blocks are located in time that grows with its length, not its square (Step 6: a run of 8,000 blocks took 96 s)")
    func longNoteIsLocatedQuickly() throws {
        var lines: [String] = []
        for section in 0..<4000 { lines += ["## Section \(section)", "", "Some <Mark color=\"yellow\">highlighted</Mark> and **bold** words, é😀, in a paragraph.", ""] }
        let note = lines.joined(separator: "\n")
        let started = ContinuousClock.now
        let preview = NotePreview.make(content: note)
        let spent = ContinuousClock.now - started
        #expect(preview.located.count == 8000)
        let whole = note as NSString
        #expect(whole.substring(with: preview.located[7999].range).hasSuffix("in a paragraph."))
        #expect(whole.substring(with: preview.located[7998].range) == "## Section 3999")
        // Debug build, on a loaded Mac: about 0.5 s; quadratic, it was 96 s.
        #expect(spent < .seconds(15), "\(spent)")
    }
}

