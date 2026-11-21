import Foundation
import Testing

@testable import CompositionCore

@Suite("Split's halves kept at the same place in the note")
struct ScrollSyncTests {
    private func block(_ location: Int, _ length: Int, _ top: Double, _ bottom: Double) -> ScrollSync.Block {
        ScrollSync.Block(range: NSRange(location: location, length: length), top: top, bottom: bottom)
    }

    @Test("the marks run from the top of the note through each block to its end, in order both ways")
    func marks() {
        // A header of 120 points above two blocks, the second a tall picture written as a short tag.
        let marks = ScrollSync.marks(blocks: [block(40, 20, 120, 160), block(62, 30, 180, 780)], textLength: 100, height: 800)
        #expect(marks.map(\.offset) == [0, 40, 60, 62, 92, 100])
        #expect(marks.map(\.y) == [0, 120, 160, 180, 780, 800])
    }

    @Test("blocks given out of order are put in order, and one that would go back up the page is left out")
    func outOfOrder() {
        let marks = ScrollSync.marks(blocks: [block(62, 30, 180, 780), block(40, 20, 120, 160), block(95, 2, 100, 110)], textLength: 100, height: 800)
        #expect(marks.map(\.offset) == [0, 40, 60, 62, 92, 100])
    }

    @Test("a place inside a block is drawn the same fraction of the way down it: a tall picture is passed through as its tag is")
    func insideABlock() {
        let marks = ScrollSync.marks(blocks: [block(40, 20, 120, 160), block(62, 30, 180, 780)], textLength: 100, height: 800)
        #expect(ScrollSync.y(atOffset: 50, in: marks) == 140)
        // A third of the way through the picture's tag is a third of the way down the picture.
        #expect(ScrollSync.y(atOffset: 72, in: marks) == 380)
        #expect(ScrollSync.offset(atY: 380, in: marks) == 72)
    }

    @Test("the gap between two blocks, and the frontmatter above the first, move evenly")
    func gaps() {
        let marks = ScrollSync.marks(blocks: [block(40, 20, 120, 160), block(62, 30, 180, 780)], textLength: 100, height: 800)
        #expect(ScrollSync.y(atOffset: 61, in: marks) == 170)
        // The frontmatter (0-40) and the Preview's header (0-120).
        #expect(ScrollSync.y(atOffset: 20, in: marks) == 60)
        #expect(ScrollSync.offset(atY: 60, in: marks) == 20)
    }

    @Test("past either end, the end")
    func ends() {
        let marks = ScrollSync.marks(blocks: [block(40, 20, 120, 160)], textLength: 100, height: 300)
        #expect(ScrollSync.y(atOffset: -5, in: marks) == 0)
        #expect(ScrollSync.y(atOffset: 500, in: marks) == 300)
        #expect(ScrollSync.offset(atY: 1000, in: marks) == 100)
        #expect(ScrollSync.offset(atY: -10, in: marks) == 0)
        #expect(ScrollSync.y(atOffset: 10, in: []) == 0)
    }

    @Test("text drawn with no height gives the first place it could be, so the editor shows the start of it")
    func flat() {
        // 40-60 is drawn at 120 with no height (say, a footnote's definition listed elsewhere).
        let marks = ScrollSync.marks(blocks: [block(40, 20, 120, 120), block(62, 30, 180, 300)], textLength: 100, height: 320)
        #expect(ScrollSync.offset(atY: 120, in: marks) == 40)
        #expect(ScrollSync.y(atOffset: 50, in: marks) == 120)
    }

    @Test("mapping one way and back comes home")
    func roundTrip() {
        let marks = ScrollSync.marks(blocks: [block(10, 50, 90, 400), block(70, 5, 410, 900), block(80, 15, 920, 960)], textLength: 120, height: 1000)
        for offset in stride(from: 0.0, through: 120, by: 7.5) {
            let back = ScrollSync.offset(atY: ScrollSync.y(atOffset: offset, in: marks), in: marks)
            #expect(abs(back - offset) < 0.0001, "offset \(offset) came back as \(back)")
        }
    }

    @Test("at the very top the other side goes to its top, at the very bottom to its bottom, and otherwise to the matching place within its reach")
    func follow() {
        #expect(ScrollSync.follow(matched: 300, targetMax: 900, sourceTop: 0.5, sourceMax: 2000) == 0)
        #expect(ScrollSync.follow(matched: 300, targetMax: 900, sourceTop: 1999.5, sourceMax: 2000) == 900)
        #expect(ScrollSync.follow(matched: 300, targetMax: 900, sourceTop: 700, sourceMax: 2000) == 300)
        #expect(ScrollSync.follow(matched: 1300, targetMax: 900, sourceTop: 700, sourceMax: 2000) == 900)
        #expect(ScrollSync.follow(matched: -20, targetMax: 900, sourceTop: 700, sourceMax: 2000) == 0)
        // A side too short to scroll has no bottom to go to.
        #expect(ScrollSync.follow(matched: 300, targetMax: -40, sourceTop: 700, sourceMax: 2000) == 0)
    }

    @Test("every block of the preview names its parts among the located blocks, in order, and the footnotes listed at the end name none")
    func locatedIndex() {
        let note = """
            ---
            title: Places
            ---
            # One

            A paragraph.[^a]

            <Info>

            Inside.

            </Info>

            | a | b |
            |---|---|
            | 1 | 2 |

            <Image src="app_data/a-3f9c2a71b0de.png" alt="A" />

            [^a]: The note.
            """
        let preview = NotePreview.make(content: note)
        #expect(preview.locatedIndex.count == preview.blocks.count)
        for (block, parts) in zip(preview.blocks, preview.locatedIndex) {
            if case .markdown(let inner) = block { #expect(parts.count == inner.count) } else { #expect(parts.count == 1) }
        }
        let named = preview.locatedIndex.flatMap { $0 }.compactMap { $0 }
        #expect(named == Array(preview.located.indices))
        if case .footnotes = preview.blocks.last { #expect(preview.locatedIndex.last == [nil]) } else { Issue.record("the footnotes are listed at the end") }
        // The located blocks are where they are written: the heading's starts at its `#`.
        let text = note as NSString
        #expect(text.substring(with: preview.located[0].range).hasPrefix("# One"))
    }
}
