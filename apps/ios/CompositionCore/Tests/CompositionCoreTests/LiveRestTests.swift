import Foundation
import Testing

@testable import CompositionCore

// Step 7 of docs/ipad-live-default-plan.md, "the rest": setext headings, footnote citations drawn as their numbers, footnote definitions drawn as the
// Preview's list, in the core. What the desktop also draws (setext headings, the citations) is checked against it in LiveConformanceTests; these are
// examples to read, and the iPad's own parts (the definitions, the numbering being the Preview's).

private func decorations(_ text: String, at caret: Int, to end: Int? = nil) -> LiveDecorations {
    LiveModel(text: text).decorations(selection: NSRange(location: caret, length: (end ?? caret) - caret))
}

private func ranges(_ list: [NSRange]) -> [[Int]] { list.map { [$0.location, NSMaxRange($0)] } }

@Suite("The Live model: setext headings and footnotes (Step 7)")
struct LiveRestTests {
    // MARK: Setext headings

    @Test("a paragraph underlined with `===` is a level 1 heading, `---` a level 2; the underline's line is hidden and collapsed away from the caret")
    func setextLevels() {
        let text = "Title\n=====\n\nSub\n---\n\nbody"
        let away = decorations(text, at: text.utf16.count)
        #expect(away.headings.map { [$0.line, $0.level] } == [[0, 1], [13, 2]])
        #expect(away.headings.map { ranges([$0.range])[0] } == [[0, 5], [13, 16]])
        #expect(ranges(away.hidden) == [[6, 11], [17, 20]])
        #expect(away.collapsedLines == [6, 17])
        #expect(away.rules.isEmpty)  // `---` under a paragraph is an underline, not a rule
    }

    @Test("the underline shows, dimmed, while the caret is anywhere in the heading, its text or its underline, and nowhere else")
    func setextReveal() {
        let text = "Title\n=====\n\nbody"
        for caret in [0, 3, 5, 6, 9, 11] {
            let inside = decorations(text, at: caret)
            #expect(ranges(inside.shown) == [[6, 11]], "caret at \(caret)")
            #expect(inside.hidden.isEmpty && inside.collapsedLines.isEmpty, "caret at \(caret)")
        }
        #expect(ranges(decorations(text, at: 12).hidden) == [[6, 11]])  // the blank line after it
    }

    @Test("a heading over two lines draws both; the mark is from the first `=` to the last, trailing spaces left out of it but not out of the hidden line")
    func setextTwoLines() {
        let text = "One\ntwo\n  ===  \n\nx"
        let away = decorations(text, at: 18)
        #expect(away.headings.map { [$0.line, $0.level] } == [[0, 1], [4, 1]])
        #expect(ranges(away.hidden) == [[8, 15]])
        #expect(ranges(decorations(text, at: 1).shown) == [[10, 13]])
    }

    @Test("`---` after a blank line is a rule, and the frontmatter's closing `---` is not an underline")
    func setextAmbiguity() {
        let rule = "above\n\n---\n\nbelow"
        #expect(decorations(rule, at: 0).headings.isEmpty)
        #expect(decorations(rule, at: 0).rules == [7])

        let frontmatter = "---\ntitle: A\n---\nText\n---\n"
        let away = decorations(frontmatter, at: 0)
        #expect(away.frontmatterLines == [0, 4, 13])
        #expect(away.headings.map { [$0.line, $0.level] } == [[17, 2]])
        #expect(away.collapsedLines == [22])
    }

    @Test("a setext heading typed in place is redrawn by the quick read: the underline's window takes in the paragraph above it")
    func setextTyped() {
        var model = LiveModel(text: "Title\n\nbody")
        let text = "Title\n===\n\nbody" as NSString
        model.edited(replacing: NSRange(location: 6, length: 0), withLength: 4, rereading: NSRange(location: 0, length: text.length), in: text)
        let made = model.decorations(selection: NSRange(location: 15, length: 0))
        #expect(made.headings.map { [$0.line, $0.level] } == [[0, 1]])
        #expect(made.collapsedLines == [6])
    }

    // MARK: Footnotes

    @Test("a citation away from the caret is hidden and drawn as its number, the Preview's; the caret on it shows it, dimmed")
    func citation() {
        let text = "Words[^a] and more[^b].\n\n[^b]: Second.\n[^a]: First."
        let away = decorations(text, at: 12)
        #expect(away.footnoteRefs.map { [$0.range.location, NSMaxRange($0.range), $0.number] } == [[5, 9, 1], [18, 22, 2]])
        #expect(!away.shown.contains(NSRange(location: 5, length: 4)))
        let on = decorations(text, at: 7)
        #expect(on.footnoteRefs.map(\.number) == [2])
        #expect(ranges(on.shown).contains([5, 9]))
    }

    @Test("a citation with no definition, one in code and an escaped one are left as written")
    func notCitations() {
        let text = "One[^x] `[^a]` \\[^a] and[^a].\n\n[^a]: Note."
        let refs = decorations(text, at: 0).footnoteRefs
        #expect(refs.map { [$0.range.location, $0.number] } == [[24, 1]])
    }

    @Test("numbers follow the order of first citation, as the Preview's do, and a citation typed before renumbers the rest after the full read")
    func numbering() {
        let text = "A[^two] B[^one] C[^two].\n\n[^one]: 1\n[^two]: 2"
        #expect(decorations(text, at: 0).footnoteRefs.map(\.number) == [1, 2, 1])
        let preview = NotePreview.make(content: text)
        guard case .footnotes(let entries)? = preview.blocks.last else { Issue.record("no list"); return }
        #expect(entries.map(\.number) == [1, 2])

        let before = LiveModel(text: "x[^b]\n\n[^a]: A\n[^b]: B")
        let after = LiveModel(text: "[^a]x[^b]\n\n[^a]: A\n[^b]: B")
        #expect(!after.differences(from: before).isEmpty)
    }

    @Test("an edit moves the citations after it and drops one it touches, until the full read")
    func citationsFollowEdits() {
        var model = LiveModel(text: "a[^1] b[^1]\n\n[^1]: N")
        let text = "XXa[^1] b[^1]\n\n[^1]: N" as NSString
        model.edited(replacing: NSRange(location: 0, length: 0), withLength: 2, rereading: NSRange(location: 0, length: 14), in: text)
        #expect(model.decorations(selection: NSRange(location: 0, length: 0)).footnoteRefs.map(\.range.location) == [3, 9])
    }

    @Test("the frontmatter is counted in a citation's place")
    func citationAfterFrontmatter() {
        let text = "---\ntitle: T\n---\nA[^n]\n\n[^n]: N"
        #expect(decorations(text, at: 0).footnoteRefs.map(\.range.location) == [18])
    }

    @Test("definitions are located in runs, each run the Preview's list of their entries, in the order written")
    func definitionRuns() {
        let text = "A[^a] B[^b] C[^c].\n\n[^b]: Bee.\n\n[^a]: Ay\n    more.\n\nBetween.\n\n[^c]: Cee.\n[^z]: Nobody cites this."
        let preview = NotePreview.make(content: text)
        let ns = text as NSString
        #expect(preview.footnoteDefinitions.map { ns.substring(with: $0.range) } == ["[^b]: Bee.\n\n[^a]: Ay\n    more.", "[^c]: Cee."])
        guard case .footnotes(let first) = preview.footnoteDefinitions[0].block else { Issue.record("not a list"); return }
        #expect(first.map(\.number) == [2, 1])
    }

    @Test("definitions' places are in the note's text, frontmatter and `\\r\\n` counted")
    func definitionPlacesCRLF() {
        let text = "---\r\ntitle: T\r\n---\r\nA[^n]\r\n\r\n[^n]: N\r\n"
        let preview = NotePreview.make(content: text)
        #expect(preview.footnoteDefinitions.map { (text as NSString).substring(with: $0.range) } == ["[^n]: N"])
        #expect(LiveModel(text: text).decorations(selection: NSRange(location: 0, length: 0)).footnoteRefs.map(\.range.location) == [21])
    }
}
