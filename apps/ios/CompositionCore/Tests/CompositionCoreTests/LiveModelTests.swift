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

    @Test("a fenced block is one fill over its code lines while the selection is elsewhere, and over its fences too while it is in it (Step 3)")
    func fencedBlockLines() throws {
        let text = "text\n\n```swift\nlet x = 1\nlet y = 2\n```\n\nafter"
        // Lines start at 0, 5, 6 (the opening fence), 15, 25 and 35 (the closing fence); the block runs from 6 to 38.
        let away = try #require(decorations(text, at: 0).codeBlocks.first)
        #expect(away.range == NSRange(location: 6, length: 32))
        #expect(away.lines == [15, 25] && away.fences.isEmpty && !away.active)
        let inside = try #require(decorations(text, at: 20).codeBlocks.first)
        #expect(inside.lines == [6, 15, 25, 35] && inside.fences == [6, 35] && inside.active)
        #expect(decorations(text, at: 0).codeIndentsHidden.isEmpty)
    }

    @Test("an indented block at the top level hides its indent while the selection is outside it; one in a list keeps it")
    func indentedBlockLines() throws {
        let text = "para\n\n    one\n\tsix\n\nend"
        // The block's lines start at 6 and 14; it starts after the first line's indent (10), as lezer's does.
        let away = decorations(text, at: 0)
        let block = try #require(away.codeBlocks.first)
        #expect(block.range == NSRange(location: 6, length: 12) && block.lines == [6, 14] && block.fences.isEmpty)
        #expect(ranges(away.codeIndentsHidden) == [[6, 10], [14, 15]])
        #expect(decorations(text, at: 12).codeIndentsHidden.isEmpty)
        let listed = decorations("- item\n\n      code\n", at: 0)
        #expect(listed.codeBlocks.first?.lines == [8] && listed.codeIndentsHidden.isEmpty)
    }

    @Test("a fence not closed runs to the end of the note, a block with no code keeps its fences, and one in a list hides its fences' whole lines")
    func unusualBlocks() throws {
        let open = try #require(decorations("para\n\n```\ncode\n", at: 0).codeBlocks.first)
        #expect(open.range == NSRange(location: 6, length: 9) && open.lines == [10, 15])  // the empty line after the last break too
        #expect(ranges(decorations("para\n\n```\ncode\n", at: 0).fencesHidden) == [[6, 9]])
        let empty = decorations("para\n\n```\n```\n", at: 0)
        #expect(empty.fencesHidden.isEmpty && ranges(empty.fencesShown) == [[6, 9], [10, 13]])
        #expect(empty.codeBlocks.first?.lines == [6, 10] && empty.codeBlocks.first?.fences == [6, 10])
        let listed = decorations("- item\n\n  ```\n  code\n  ```\n\nend", at: 0)
        #expect(ranges(listed.fencesHidden) == [[8, 13], [21, 26]])
        #expect(listed.codeBlocks.first?.lines == [14])
        let quoted = decorations("> ```\n> code\n> ```\n\nend", at: 22)
        #expect(ranges(quoted.fencesHidden) == [[0, 5], [13, 18]] && quoted.codeBlocks.first?.lines == [6])
        // Four spaces before backticks is indented code, not a fence.
        let notFence = decorations("    ```\nafter", at: 12)
        #expect(notFence.fencesHidden.isEmpty && notFence.codeBlocks.first?.lines == [0] && ranges(notFence.codeIndentsHidden) == [[0, 4]])
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
    out += decorations.codeBlocks.filter { shown($0.range) }.map { "code \($0.range.location)-\(NSMaxRange($0.range)) \($0.lines) \($0.fences) \($0.active)" }
    out += decorations.codeIndentsHidden.filter(shown).map { "indent hidden \($0.location)-\(NSMaxRange($0))" }
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

// MARK: Highlights, pictures and the frontmatter while typing (step L4)

@Suite("The Live model keeps highlights, pictures and the frontmatter right")
struct LiveModelDrawnTests {
    /// Types `insertion` over `range` of `text`, the way the editor tells the models: the highlights re-read their blocks and the Live model follows.
    private func typed(_ insertion: String, over range: NSRange, in text: String, highlights: inout HighlightModel, live: inout LiveModel) -> String {
        let after = (text as NSString).replacingCharacters(in: range, with: insertion)
        let now = after as NSString
        let window = highlights.edited(replacing: range, withLength: (insertion as NSString).length, in: now)
        live.edited(replacing: range, withLength: (insertion as NSString).length, rereading: window, in: now)
        return after
    }

    private func tints(_ model: LiveModel) -> [String] {
        model.decorations(selection: NSRange(location: 0, length: 0)).tints.map { "\($0.range.location)-\(NSMaxRange($0.range)) \($0.color)" }
    }

    @Test("typing in a highlight keeps it tinted, and typing before it moves it")
    func tintsFollowTyping() {
        var text = "first <Mark color=\"green\">tint</Mark> last\n\nsecond paragraph"
        var highlights = HighlightModel(text: text)
        var live = LiveModel(text: text)
        #expect(tints(live) == ["26-30 green"])
        text = typed("ish", over: NSRange(location: 30, length: 0), in: text, highlights: &highlights, live: &live)  // at the end of the tinted words
        #expect(tints(live) == tints(LiveModel(text: text)))
        text = typed("X", over: NSRange(location: 28, length: 0), in: text, highlights: &highlights, live: &live)  // in the middle
        #expect(tints(live) == tints(LiveModel(text: text)))
        text = typed("new ", over: NSRange(location: 0, length: 0), in: text, highlights: &highlights, live: &live)  // before it
        #expect(tints(live) == tints(LiveModel(text: text)))
        text = typed("more", over: NSRange(location: (text as NSString).length, length: 0), in: text, highlights: &highlights, live: &live)  // in the next paragraph
        #expect(tints(live) == tints(LiveModel(text: text)))
    }

    @Test("an edit in a tag drops the highlight until the pause, and the full read says what changed")
    func tagsEditedAndTheFullRead() {
        var text = "a <Mark color=\"green\">tint</Mark> b"
        var highlights = HighlightModel(text: text)
        var live = LiveModel(text: text)
        text = typed("blue", over: NSRange(location: 15, length: 5), in: text, highlights: &highlights, live: &live)  // green becomes blue, inside the tag
        #expect(tints(live) == ["21-25 green"], "the tinted words moved with the edit, in the colour they had")
        let fresh = LiveModel(text: text)
        #expect(tints(fresh) == ["21-25 blue"])
        // The tag that was edited was dropped (it may no longer be one), and the tint's colour changed: the whole highlight, 2 to 32, is what to draw again.
        #expect(fresh.differences(from: live) == [NSRange(location: 2, length: 30)])
        #expect(LiveModel(text: text).differences(from: LiveModel(text: text)).isEmpty)
    }

    @Test("a picture stands on its own line or not, and only those are drawn in place")
    func ownLine() {
        let text = "![a](one.png)\n\ntext ![b](two.png) more\n\n  ![c](three.png)  \n\n<Image src=\"four.png\" />\n\n<Image src=\"five.png\" /> beside"
        let model = LiveModel(text: text)
        let pictures = model.decorations(selection: NSRange(location: 0, length: 0)).pictures.sorted { $0.range.location < $1.range.location }
        #expect(pictures.map(\.src) == ["one.png", "two.png", "three.png", "four.png", "five.png"])
        #expect(pictures.map(\.ownLine) == [true, false, true, true, false])
        #expect(model.drawnPictureRanges.count == 3)
    }

    @Test("the frontmatter is one range, from its first character to the end of its closing line")
    func frontmatter() {
        let text = "---\ntitle: A\ntags:\n- x\n---\n# Body"
        #expect(LiveModel(text: text).decorations(selection: NSRange(location: 0, length: 0)).frontmatterRange == NSRange(location: 0, length: 26))
        #expect(LiveModel(text: "# No frontmatter").decorations(selection: NSRange(location: 0, length: 0)).frontmatterRange == nil)
        #expect(LiveModel(text: "---\r\ntitle: A\r\n---\r\ntext").decorations(selection: NSRange(location: 0, length: 0)).frontmatterRange == NSRange(location: 0, length: 18))
    }

    // Step 1 of docs/ipad-live-default-plan.md: `<Ink />` and `<Drawio />` are pictures too. The `<Ink />` ranges are checked against the desktop by
    // LiveConformanceTests; `<Drawio />` is the iPad's own (the desktop's Live tab leaves it as text), so these say what it does.

    @Test("an <Ink /> and a <Drawio /> are pictures of their own kind, outside code, and only on a line of their own drawn in place")
    func drawingKinds() {
        let text = "<Ink src=\"app_data/a.png\" alt=\"Drawing\" />\n\n<Drawio src=\"app_data/d.png\" alt=\"Flow\" width=\"300\" />\n\n<Image src=\"p.png\" />\n\n```\n<Drawio src=\"code.png\" />\n```\n\nsee <Ink src=\"inline.png\" /> here\n\n<Drawiox src=\"no.png\" />"
        let pictures = decorations(text, at: (text as NSString).length).pictures.sorted { $0.range.location < $1.range.location }
        #expect(pictures.map(\.src) == ["app_data/a.png", "app_data/d.png", "p.png", "inline.png"])
        #expect(pictures.map(\.kind) == [.ink, .drawio, .image, .ink])
        #expect(pictures.map(\.ownLine) == [true, true, true, false])
        #expect(pictures[1].width == "300" && pictures[1].alt == "Flow")
        #expect(LiveModel(text: text).drawnPictureRanges.count == 3)
    }

    @Test("the caret on a drawing's tag shows the tag, with the drawing after it")
    func drawingReveal() {
        let text = "text\n\n<Drawio src=\"d.png\" />\n\nmore"
        let tag = (text as NSString).range(of: "<Drawio src=\"d.png\" />")
        #expect(decorations(text, at: 0).pictures.map(\.active) == [false])
        #expect(decorations(text, at: tag.location + 3).pictures.map(\.active) == [true])
        #expect(decorations(text, at: NSMaxRange(tag)).pictures.map(\.active) == [true])
    }

    @Test("a drawing keeps its kind when an edit before it moves it, and a full read finds a drawing typed")
    func drawingAfterAnEdit() {
        let text = "intro\n\n<Ink src=\"a.png\" />"
        var live = LiveModel(text: text)
        let edited = "intro, longer\n\n<Ink src=\"a.png\" />"
        live.edited(replacing: NSRange(location: 5, length: 0), withLength: 8, rereading: NSRange(location: 0, length: 15), in: edited as NSString)
        let moved = live.decorations(selection: NSRange(location: 0, length: 0)).pictures
        #expect(moved.map(\.kind) == [.ink])
        #expect(moved.map(\.range.location) == [15])
        let typed = edited + "\n\n<Drawio src=\"d.png\" />"
        let fresh = LiveModel(text: typed)
        #expect(fresh.decorations(selection: NSRange(location: 0, length: 0)).pictures.map(\.kind) == [.ink, .drawio])
        #expect(fresh.differences(from: live) == [(typed as NSString).range(of: "<Drawio src=\"d.png\" />")])
    }
}
