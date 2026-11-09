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
        #expect(away.headings.map { [$0.line, $0.level] } == [[0, 1]])
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
        #expect(away.headings.map { [$0.line, $0.level] } == [[15, 1]])
    }
}

// MARK: Following edits and the selection (step L3)

/// Every fact the model gives for a window, one line each, so that two answers compare.
private func facts(_ decorations: LiveDecorations, within window: NSRange? = nil) -> [String] {
    func shown(_ range: NSRange) -> Bool { window.map { range.location < NSMaxRange($0) && NSMaxRange(range) > $0.location } ?? true }
    var out: [String] = []
    out += decorations.headings.filter { shown($0.range) }.map { "heading \($0.line) \($0.level) \($0.range.location)-\(NSMaxRange($0.range))" }
    out += decorations.rules.map { "rule \($0)" }.filter { _ in window == nil }
    out += decorations.styles.filter { shown($0.range) }.map { "\($0.style.rawValue) \($0.range.location)-\(NSMaxRange($0.range))" }
    out += decorations.hidden.filter(shown).map { "hidden \($0.location)-\(NSMaxRange($0))" }
    out += decorations.shown.filter(shown).map { "shown \($0.location)-\(NSMaxRange($0))" }
    out += decorations.pictures.filter { shown($0.range) }.map { "picture \($0.range.location)-\(NSMaxRange($0.range)) \($0.active) \($0.src)" }
    out += decorations.fencesHidden.filter(shown).map { "fence hidden \($0.location)-\(NSMaxRange($0))" }
    out += decorations.fencesShown.filter(shown).map { "fence shown \($0.location)-\(NSMaxRange($0))" }
    return out.sorted()
}

@Suite("The Live model follows edits and the selection")
struct LiveModelFollowingTests {
    private static let sample = """
        # Notes on the Live view

        Some **bold** words, some *italic* ones and `code` too, with a [link](https://x.test).

        - one **two**
        - three *four*

        ## Second heading ##

        > a quote with ~~strike~~ and **bold**

        ```swift
        let x = **not bold**
        ```

        ---

        The end ![alt](pic.png "t") of it.
        """

    /// Edits as typing makes them (a character, a mark, a line break, a deletion), at places in the middle of the note.
    @Test("after edits, what the model says is what a fresh read says, wherever the selection is")
    func editsMatchAFreshRead() throws {
        var seed: UInt64 = 0x2545F4914F6CDD1D
        func next(_ below: Int) -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int((seed >> 33) % UInt64(below))
        }
        let pieces = ["a", " ", "b", "**", "*", "~~", "# ", "- ", "\n", "\n\n", "x y", "_", "`", "> "]
        var text = Self.sample
        var highlights = HighlightModel(text: text)
        var live = LiveModel(text: text)
        var compared = 0
        for step in 0..<300 {
            let ns = text as NSString
            let location = next(ns.length + 1)
            let deleting = next(4) == 0 && ns.length > 0
            let range = deleting ? NSRange(location: min(location, ns.length - 1), length: min(1 + next(3), ns.length - min(location, ns.length - 1))) : NSRange(location: location, length: 0)
            let insertion = deleting ? "" : pieces[next(pieces.count)]
            text = ns.replacingCharacters(in: range, with: insertion)
            let now = text as NSString
            let window = highlights.edited(replacing: range, withLength: (insertion as NSString).length, in: now)
            live.edited(replacing: range, withLength: (insertion as NSString).length, rereading: window, in: now)
            // The quick read of a piece can differ from the whole's (a fence typed on a line swallows what is below it): the colours put that right a pause
            // later, and so do these. Only where the colours agree with a fresh read is the model held to it.
            guard HighlightModel(text: text).differences(from: highlights).isEmpty else {
                highlights = HighlightModel(text: text)
                live = LiveModel(text: text)
                continue
            }
            let fresh = LiveModel(text: text)
            #expect(live.length == fresh.length)
            for selection in [NSRange(location: 0, length: 0), NSRange(location: next(now.length + 1), length: 0), NSRange(location: next(now.length + 1), length: next(8))]
            where NSMaxRange(selection) <= now.length {
                let want = facts(fresh.decorations(selection: selection)), got = facts(live.decorations(selection: selection))
                #expect(want == got, "after edit \(step) (\(String(reflecting: insertion)) over \(range)), selection \(selection)")
                compared += 1
                // And the part of the note a window shows, which is what the editor asks for after an edit and when the selection moves.
                let start = next(now.length + 1)
                let window = NSRange(location: start, length: min(next(120), now.length - start))
                #expect(facts(live.decorations(in: window, selection: selection), within: window) == facts(fresh.decorations(in: window, selection: selection), within: window),
                    "after edit \(step), window \(window), selection \(selection)")
            }
        }
        #expect(compared > 300)
    }

    @Test("a window is given everything that touches it, and nothing else")
    func windows() {
        let live = LiveModel(text: Self.sample)
        let length = (Self.sample as NSString).length
        for selection in [NSRange(location: 0, length: 0), NSRange(location: 60, length: 0), NSRange(location: 150, length: 4)] {
            let whole = live.decorations(selection: selection)
            for start in stride(from: 0, to: length, by: 37) {
                let window = NSRange(location: start, length: min(50, length - start))
                #expect(facts(live.decorations(in: window, selection: selection), within: window) == facts(whole, within: window), "window \(window), selection \(selection)")
            }
        }
    }

    @Test("the constructs a selection touches are the ones whose look changes when it moves")
    func touching() {
        let text = "**bold** and *it* and `code` and # not heading"
        let live = LiveModel(text: text)
        #expect(live.constructRanges(touching: NSRange(location: 3, length: 0)) == [NSRange(location: 0, length: 8)])
        #expect(live.constructRanges(touching: NSRange(location: 8, length: 0)) == [NSRange(location: 0, length: 8)])
        #expect(live.constructRanges(touching: NSRange(location: 9, length: 0)).isEmpty)
        #expect(live.constructRanges(touching: NSRange(location: 0, length: 20)).count == 2)
        let nested = LiveModel(text: "**bold *both* bold**")
        #expect(nested.constructRanges(touching: NSRange(location: 9, length: 0)).count == 2)
    }
}
