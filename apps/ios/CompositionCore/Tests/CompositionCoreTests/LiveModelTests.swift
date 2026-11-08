import Foundation
import Testing

@testable import CompositionCore

// The Live model (docs/ipad-live-view-plan.md, step L2). What it shares with the desktop is checked against the desktop's real code by
// LiveConformanceTests; these are the parts that are the iPad's own, and a few plain examples to read.

private func decorations(_ text: String, at caret: Int, to end: Int? = nil, limit: Int? = LiveModel.desktopExtrasLimit) -> LiveDecorations {
    LiveModel(text: text, extrasLimit: limit).decorations(selection: NSRange(location: caret, length: (end ?? caret) - caret))
}

private func ranges(_ list: [NSRange]) -> [[Int]] { list.map { [$0.location, NSMaxRange($0)] } }

@Suite("The Live model")
struct LiveModelTests {
    @Test("a bold word hides its marks away from the caret, and shows them, dimmed, while the caret is in it or right after it")
    func boldMarks() {
        let text = "**some text** and more"
        #expect(ranges(decorations(text, at: 20).hidden) == [[0, 2], [11, 13]])
        #expect(decorations(text, at: 20).shown.isEmpty)
        #expect(ranges(decorations(text, at: 5).shown) == [[0, 2], [11, 13]])
        #expect(decorations(text, at: 5).hidden.isEmpty)
        #expect(decorations(text, at: 13).hidden.isEmpty)  // right after the closing mark is still the construct
        #expect(decorations(text, at: 14).hidden.count == 2)  // the next word is not
        #expect(decorations(text, at: 15, to: 20).hidden.count == 2)
        #expect(decorations(text, at: 10, to: 20).hidden.isEmpty)  // a selection that reaches it
        #expect(decorations(text, at: 20).styles == [.init(style: .strong, range: NSRange(location: 0, length: 13))])
    }

    @Test("a heading is drawn with its `#` and the space after it hidden, and its marks show while the caret is on its line")
    func heading() {
        let text = "# Title\n\ntext"
        let away = decorations(text, at: 12)
        #expect(away.headings == [.init(line: 0, level: 1)])
        #expect(ranges(away.hidden) == [[0, 2]])
        #expect(ranges(decorations(text, at: 3).shown) == [[0, 1]])
    }

    @Test("a rule is drawn as a line and its dashes hidden, unless the caret is on them")
    func rule() {
        let text = "above\n\n---\n\nbelow"
        #expect(decorations(text, at: 0).rules == [7])
        #expect(ranges(decorations(text, at: 0).hidden) == [[7, 10]])
        #expect(decorations(text, at: 8).rules.isEmpty)
        #expect(decorations(text, at: 8).hidden.isEmpty)
    }

    @Test("a fenced block's fences hide while the selection is outside it, and both show while it is anywhere in it (decision V2)")
    func fences() {
        let text = "text\n\n```swift\nlet x = 1\n```\n\nafter"
        // The opening fence is 6..14 and the closing one 25..28.
        let outside = decorations(text, at: 0)
        #expect(ranges(outside.fencesHidden) == [[6, 14], [25, 28]])
        #expect(outside.fencesShown.isEmpty)
        for caret in [6, 10, 14, 15, 20, 24, 25, 28] {
            let inside = decorations(text, at: caret)
            #expect(ranges(inside.fencesShown) == [[6, 14], [25, 28]], "caret at \(caret)")
            #expect(inside.fencesHidden.isEmpty, "caret at \(caret)")
        }
        #expect(ranges(decorations(text, at: 29).fencesHidden) == [[6, 14], [25, 28]])  // the blank line after the block is outside it
        #expect(ranges(decorations(text, at: 5).fencesHidden) == [[6, 14], [25, 28]])
    }

    @Test("a fence that is not closed has only its opening line, and indented code has none")
    func otherCode() {
        #expect(ranges(decorations("```\ncode\nmore", at: 0, limit: nil).fencesShown) == [[0, 3]])
        #expect(ranges(decorations("text\n\n~~~\ncode\n~~~\n", at: 0).fencesHidden) == [[6, 9], [15, 18]])
        let indented = decorations("text\n\n    code\n", at: 0)
        #expect(indented.fencesHidden.isEmpty && indented.fencesShown.isEmpty)
    }

    @Test("highlight tags and <Image /> tags are read only up to the desktop's length, and the syntax in any note")
    func length() {
        let text = "**bold** <Mark color=\"green\">tint</Mark> <Image src=\"a.png\" />"
        let all = decorations(text, at: 0)
        #expect(all.tints.count == 1 && all.pictures.count == 1)
        let limited = decorations(text, at: 0, limit: 10)
        #expect(limited.tints.isEmpty && limited.pictures.isEmpty)
        #expect(limited.styles.count == 1)
        #expect(decorations(text, at: 0, limit: nil).tints.count == 1)
    }

    @Test("a picture is drawn in place of its text, and beside it while the caret is on it")
    func picture() throws {
        let text = "![alt text](app_data/img-0123456789ab.png \"A title\") after"
        let away = try #require(decorations(text, at: 56).pictures.first)
        #expect(!away.active)
        #expect(away.range == NSRange(location: 0, length: 52))
        #expect([away.src, away.alt, away.title] == ["app_data/img-0123456789ab.png", "alt text", "A title"])
        #expect(try #require(decorations(text, at: 20).pictures.first).active)
    }

    @Test("offsets count UTF-16 units, so an emoji is two, and a line break of two characters is one line")
    func offsets() {
        let text = "😀 **bold**\r\n\r\n# Head"
        let away = decorations(text, at: 0, to: 0)
        #expect(ranges(away.hidden).sorted { $0[0] < $1[0] } == [[3, 5], [9, 11], [15, 17]])
        #expect(away.headings == [.init(line: 15, level: 1)])
    }
}
