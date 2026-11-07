import Foundation
import Testing

@testable import CompositionCore

@Suite("The preview model")
struct NotePreviewTests {
    private func headings(in blocks: [MdBlock]) -> [(level: Int, ordinal: Int)] {
        blocks.compactMap { if case .heading(let level, let ordinal, _) = $0 { (level, ordinal) } else { nil } }
    }

    @Test("frontmatter is left out, and every component of a note arrives with its props read")
    func everyComponent() throws {
        let note = """
            ---
            title: Everything
            ---
            <Toc maxDepth="2" />

            # One

            <Info>

            ## Inside **panel**

            </Info>

            ### Three

            <Image src="app_data/a-3f9c2a71b0de.png" alt="A" width="50%" />
            <Repo url="github.com/meddlin/composition/tree/main" description="A notes app" />
            <YouTube url="https://youtu.be/dQw4w9WgXcQ?t=90" title="Demo" />
            <YouTube url="nope" />
            <Chart type="line" y="n">

            ```csv
            d,n
            a,1
            b,2
            ```

            </Chart>
            <Chart>

            ```csv
            only,words
            x,y
            ```

            </Chart>
            Cited[^a] here.

            [^a]: The footnote.
            """
        let preview = NotePreview.make(content: note)
        #expect(preview.error == nil)

        // The table of contents lists headings 1 and 2 deep, and each scrolls to the heading with its ordinal.
        guard case .toc(let entries) = preview.blocks[0] else { Issue.record("no toc first"); return }
        #expect(entries == [TocEntry(level: 0, text: "One", ordinal: 0), TocEntry(level: 1, text: "Inside panel", ordinal: 1)])

        guard case .markdown(let one) = preview.blocks[1], case .panel(.info, let inside) = preview.blocks[2], case .markdown(let panelled) = inside[0],
            case .markdown(let three) = preview.blocks[3]
        else { Issue.record("blocks are not as expected: \(preview.blocks.prefix(4))"); return }
        #expect(headings(in: one).map(\.ordinal) == [0] && headings(in: panelled).map(\.ordinal) == [1] && headings(in: three).map(\.ordinal) == [2])

        #expect(preview.blocks[4] == .image(source: .stored("a-3f9c2a71b0de.png"), alt: "A", title: nil, width: ImageWidth(value: 50, unit: .percent), isDiagram: false))
        guard case .repo(let repo, let description) = preview.blocks[5] else { Issue.record("no repo"); return }
        #expect(repo.label == "meddlin/composition" && repo.service == "GitHub" && repo.href == "https://github.com/meddlin/composition" && description == "A notes app")
        guard case .youtube(let video, let title) = preview.blocks[6] else { Issue.record("no video"); return }
        #expect(video == YouTubeRef(id: "dQw4w9WgXcQ", start: 90) && title == "Demo")
        #expect(preview.blocks[7] == .notice("Not a YouTube video: nope"))
        guard case .chart(let spec, _, let height) = preview.blocks[8] else { Issue.record("no chart"); return }
        #expect(spec.type == .line && spec.y == ["n"] && spec.rows.map(\.label) == ["a", "b"] && height == 280)
        #expect(preview.blocks[9] == .notice("Chart: no column of numbers to draw. Name one with y=\"column\"."))

        // No `<Footnotes />` in the note: the list comes last.
        guard case .markdown(let rest) = preview.blocks[10], case .paragraph(let words) = rest[0] else { Issue.record("no text"); return }
        #expect(words == [.text("Cited¹ here.")])
        guard case .footnotes(let notes) = preview.blocks[11] else { Issue.record("no footnotes"); return }
        #expect(notes.map(\.number) == [1] && notes[0].blocks == [.paragraph([.text("The footnote.")])])
    }

    @Test("a highlight in a line of text is a mark around the text it holds")
    func mark() {
        let preview = NotePreview.make(content: "Resets <Mark color=\"green\">every **night**</Mark>, then <Mark>this</Mark>.\n")
        guard case .markdown(let blocks) = preview.blocks[0], case .paragraph(let inlines) = blocks[0] else { Issue.record("no paragraph"); return }
        #expect(inlines == [
            .text("Resets "), .mark(color: "green", [.text("every "), .strong([.text("night")])]), .text(", then "), .mark(color: nil, [.text("this")]), .text("."),
        ])
    }

    @Test("a citation after bold text that holds a highlight still closes the bold, and becomes its number")
    func citationAfterEmphasis() {
        let preview = NotePreview.make(content: "Resets **back up <Mark color=\"yellow\">first</Mark>**[^a] and `[^a]` and [^nope].\n\n[^a]: Note.\n")
        guard case .markdown(let blocks) = preview.blocks[0], case .paragraph(let inlines) = blocks[0] else { Issue.record("no paragraph"); return }
        #expect(inlines == [
            .text("Resets "), .strong([.text("back up "), .mark(color: "yellow", [.text("first")])]), .text("¹ and "), .code("[^a]"), .text(" and [^nope]."),
        ])
    }

    @Test("a note that is not valid MDX is drawn as Markdown, with the reason")
    func invalid() {
        let preview = NotePreview.make(content: "<Info>\n\nnever closed\n")
        #expect(preview.error != nil)
        guard preview.blocks.count == 1, case .markdown = preview.blocks[0] else { Issue.record("not one block of Markdown"); return }
    }

    @Test("lists, tasks, tables, quotes and code come through")
    func markdownBlocks() {
        let preview = NotePreview.make(content: "- [x] done\n- [ ] todo\n\n1. one\n2. two\n\n> quoted\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n```swift\nlet x = 1\n```\n\n---\n")
        guard case .markdown(let blocks) = preview.blocks[0] else { Issue.record("no markdown"); return }
        #expect(blocks.count == 6)
        guard case .list(false, _, let tasks) = blocks[0] else { Issue.record("no task list"); return }
        #expect(tasks.map(\.checked) == [true, false])
        guard case .list(true, 1, let numbered) = blocks[1] else { Issue.record("no numbered list"); return }
        #expect(numbered.count == 2)
        guard case .table(let alignments, let header, let rows) = blocks[3] else { Issue.record("no table"); return }
        #expect(alignments == [.leading, .trailing] && header.count == 2 && rows.count == 1)
        #expect(blocks[4] == .code(language: "swift", text: "let x = 1") && blocks[5] == .rule)
    }
}
