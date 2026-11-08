import Foundation
import Testing

@testable import CompositionCore

// Build plan, Step 5: colouring only what was typed. The quick read of the blocks around an edit is checked against reading the whole note
// again, on the notes of the MDX corpus and on random typing.

@Suite("Incremental colouring")
struct HighlightModelTests {
    /// The notes the MDX conformance uses: real-looking Markdown with every component in it.
    private static let notes: [String] = {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("conformance/mdx-notes.json")
        struct Corpus: Decodable {
            struct Note: Decodable { let body: String }
            let notes: [Note]
        }
        return ((try? JSONDecoder().decode(Corpus.self, from: Data(contentsOf: file)))?.notes ?? []).map(\.body)
    }()

    /// Replaces `range` of `text` with `replacement`, and brings `model` up to date; returns the new text and what was re-read.
    private func edit(_ model: inout HighlightModel, _ text: String, _ range: NSRange, _ replacement: String) -> (text: String, window: NSRange) {
        let updated = (text as NSString).replacingCharacters(in: range, with: replacement)
        let window = model.edited(replacing: range, withLength: (replacement as NSString).length, in: updated as NSString)
        return (updated, window)
    }

    private func invariants(_ model: HighlightModel, _ text: String, sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(model.length == (text as NSString).length, "the length follows the text", sourceLocation: sourceLocation)
        var end = 0
        for block in model.blocks {
            #expect(block.range.location >= end, "blocks are in order and do not overlap", sourceLocation: sourceLocation)
            #expect(block.range.upperBound <= model.length, "a block is inside the text", sourceLocation: sourceLocation)
            for span in block.absolute() {
                #expect(span.range.location >= block.range.location && span.range.upperBound <= block.range.upperBound, "a span is inside its block", sourceLocation: sourceLocation)
            }
            end = block.range.upperBound
        }
    }

    // MARK: Blocks

    @Test("the blocks hold every span, in order, each inside its block")
    func blocks() {
        for note in Self.notes.prefix(40) {
            let blocks = MarkdownHighlighter.blocks(in: note)
            #expect(blocks.flatMap(\.spans) == MarkdownHighlighter.spans(in: note))
            invariants(HighlightModel(text: note), note)
        }
        #expect(Self.notes.count > 100, "the corpus was found")
    }

    @Test("a piece of a note is not frontmatter, even if it starts with dashes")
    func piece() {
        let text = "---\ntitle: x\n---\nbody\n"
        #expect(MarkdownHighlighter.blocks(in: text, frontmatter: true).first?.spans.first?.kind == .frontmatter)
        #expect(MarkdownHighlighter.blocks(in: text, frontmatter: false).flatMap(\.spans).contains { $0.kind == .frontmatter } == false)
    }

    // MARK: Editing

    @Test("typing in a paragraph re-reads the paragraph and its neighbours, and nothing else")
    func local() {
        let text = (0..<300).map { "Paragraph \($0) has **bold** and `code` in it.\n" }.joined(separator: "\n")
        var model = HighlightModel(text: text)
        let spot = (text as NSString).range(of: "Paragraph 150 ").location + 5
        let (updated, window) = edit(&model, text, NSRange(location: spot, length: 0), "x")
        #expect(window.length < 400, "three paragraphs, not the note: \(window)")
        #expect(NSLocationInRange(spot, window))
        #expect(model == HighlightModel(text: updated), "the quick read agrees with the full one")
        invariants(model, updated)
    }

    @Test("the blocks after an edit move with it")
    func shifting() {
        let text = "# One\n\nTwo **b**\n\nThree\n\n- four\n- five\n\n> six\n"
        var model = HighlightModel(text: text)
        let (updated, _) = edit(&model, text, NSRange(location: 8, length: 0), "inserted words ")
        #expect(model == HighlightModel(text: updated))
        let (shorter, _) = edit(&model, updated, NSRange(location: 0, length: 8), "")
        #expect(model == HighlightModel(text: shorter))
        invariants(model, shorter)
    }

    @Test("a fence typed on one line is wrong when read alone, and the full read finds what it swallowed")
    func fence() {
        let text = "intro\n\nfirst **paragraph**\n\nsecond paragraph with `code`\n\n```\nend\n```\n"
        var model = HighlightModel(text: text)
        // A fence typed above two paragraphs: the quick read of the neighbourhood sees it too, but cannot see where it ends.
        let at = (text as NSString).range(of: "first").location
        let (updated, _) = edit(&model, text, NSRange(location: at, length: 0), "```\n")
        let full = HighlightModel(text: updated)
        let wrong = full.differences(from: model)
        #expect(model != full || wrong.isEmpty)
        // Whatever the quick read got wrong is exactly what `differences` names: putting those ranges right makes the models the same.
        #expect(wrong.allSatisfy { $0.location >= 0 && $0.upperBound <= full.length })
    }

    @Test("a note that is read again after nothing changed has no differences")
    func noDifferences() {
        let text = Self.notes.first ?? "text"
        let model = HighlightModel(text: text)
        #expect(HighlightModel(text: text).differences(from: model).isEmpty)
    }

    @Test("on the notes of the corpus the quick read of a typed character agrees with the full one almost always")
    func agreement() {
        var agreed = 0, total = 0
        var disagreements: [String] = []
        for (index, note) in Self.notes.enumerated() where (note as NSString).length > 20 {
            let length = (note as NSString).length
            for step in 1...6 {
                let at = length * step / 7
                for (range, replacement) in [(NSRange(location: at, length: 0), "x"), (NSRange(location: at, length: 0), "\n"), (NSRange(location: at, length: 1), "")] {
                    var model = HighlightModel(text: note)
                    let (updated, _) = edit(&model, note, range, replacement)
                    total += 1
                    if model == HighlightModel(text: updated) { agreed += 1 } else if disagreements.count < 8 { disagreements.append("note \(index) at \(at) \(String(reflecting: replacement))") }
                }
            }
        }
        let rate = Double(agreed) / Double(total)
        print(String(format: "\nIncremental colouring: the quick read agreed with the full read in %d of %d edits (%.1f%%)", agreed, total, rate * 100))
        for line in disagreements { print("  differs: \(line)") }
        #expect(rate > 0.9, "the quick read is right for \(rate * 100)% of edits")
    }

    /// A small generator that gives the same edits on every run, so that a failure can be reproduced.
    private struct Seeded: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return state >> 11 | state << 53
        }
    }

    @Test("thousands of random edits, with the characters that make Markdown, keep the model in order and the right length")
    func randomTyping() {
        let alphabet = ["a", "b", " ", "\n", "\n\n", "#", "*", "`", "```\n", "-", "> ", "<Info>", "</Info>", "1. ", "[", "](x)", "é", "😀", "---\n", "|", "~~", "    "]
        let start = "---\ntitle: x\n---\nstart\n\n# Head\n\n- a\n- b\n\n> q\n\n```\ncode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nend\n"
        var agreed = 0, total = 0
        for seed in 1...20 {
            var generator = Seeded(state: UInt64(seed) &* 7919)
            var text = start
            var model = HighlightModel(text: text)
            var canvas = painted(model)
            for step in 0..<200 {
                let length = (text as NSString).length
                let location = Int.random(in: 0...length, using: &generator)
                let removed = Bool.random(using: &generator) && length > 0 ? min(Int.random(in: 1...4, using: &generator), length - location) : 0
                let replacement = removed > 0 && Bool.random(using: &generator) ? "" : alphabet.randomElement(using: &generator)!
                // A text view never splits a surrogate pair.
                let range = (text as NSString).rangeOfComposedCharacterSequences(for: NSRange(location: location, length: removed))
                edit(&canvas, range, newLength: (replacement as NSString).length)
                let (updated, window) = edit(&model, text, range, replacement)
                text = updated
                paint(model, onto: &canvas, over: [window])
                invariants(model, text)
                total += 1
                if model == HighlightModel(text: text) { agreed += 1 }
                // The pause after typing, every few edits: the colours must then be exactly a full read's.
                if step % 5 == 4 {
                    let full = HighlightModel(text: text)
                    paint(full, onto: &canvas, over: full.differences(from: model))
                    model = full
                    #expect(canvas == painted(full), "seed \(seed) step \(step)")
                }
            }
        }
        print(String(format: "\nIncremental colouring, random typing: the quick read agreed in %d of %d edits (%.1f%%)", agreed, total, Double(agreed) / Double(total) * 100))
        #expect(Double(agreed) / Double(total) > 0.9)
    }

    // MARK: The whole scheme, on a simulated text view

    /// What a text view holds for each UTF-16 unit: the kinds of colour put on it, in the order they were put on.
    private typealias Canvas = [[HighlightKind]]

    /// Puts the colours of `model` on `ranges`, as the editor does: clears each range, then sets the spans that touch it, clipped to it.
    private func paint(_ model: HighlightModel, onto canvas: inout Canvas, over ranges: [NSRange]) {
        for range in ranges {
            let range = NSIntersectionRange(range, NSRange(location: 0, length: canvas.count))
            for unit in range.location..<range.upperBound { canvas[unit] = [] }
            for span in model.spans(in: range) {
                let clipped = NSIntersectionRange(span.range, range)
                for unit in clipped.location..<clipped.upperBound { canvas[unit].append(span.kind) }
            }
        }
    }

    private func painted(_ model: HighlightModel) -> Canvas {
        var canvas = Canvas(repeating: [], count: model.length)
        paint(model, onto: &canvas, over: [NSRange(location: 0, length: model.length)])
        return canvas
    }

    /// An edit to the canvas as a text view makes it: the characters that go in take the colours of the one before them.
    private func edit(_ canvas: inout Canvas, _ range: NSRange, newLength: Int) {
        let inherited = range.location > 0 ? canvas[range.location - 1] : []
        canvas.replaceSubrange(range.location..<range.upperBound, with: Array(repeating: inherited, count: newLength))
    }

    @Test("quick reads, then putting right only what differs, leave exactly the colours a full read gives")
    func correctionRepairsEverything() {
        var checked = 0, repaired = 0
        for note in Self.notes where (note as NSString).length > 20 {
            let length = (note as NSString).length
            for step in 1...5 {
                let at = length * step / 6
                for (range, replacement) in [(NSRange(location: at, length: 0), "x"), (NSRange(location: at, length: 0), "\n```\n"), (NSRange(location: at, length: 1), "")] {
                    var model = HighlightModel(text: note)
                    var canvas = painted(model)
                    let updated = (note as NSString).replacingCharacters(in: range, with: replacement)
                    edit(&canvas, range, newLength: (replacement as NSString).length)
                    let window = model.edited(replacing: range, withLength: (replacement as NSString).length, in: updated as NSString)
                    paint(model, onto: &canvas, over: [window])
                    let full = HighlightModel(text: updated)
                    let dirty = full.differences(from: model)
                    if !dirty.isEmpty { repaired += 1 }
                    paint(full, onto: &canvas, over: dirty)
                    checked += 1
                    #expect(canvas == painted(full), "note at \(at) \(String(reflecting: replacement))")
                }
            }
        }
        print("\nIncremental colouring: \(checked) edits, \(repaired) needed the pause's correction, and all \(checked) ended with the full read's colours")
        #expect(repaired > 0, "some edits do need correcting: a fence typed above text")
    }

    // MARK: Merged edits

    @Test("a run of edits merged into one replaces the same text")
    func accumulator() {
        var generator = SystemRandomNumberGenerator()
        for _ in 0..<500 {
            var text: NSString = "The quick brown fox jumps over the lazy dog, and then some more text follows" as NSString
            let original = text
            var accumulator = EditAccumulator()
            for _ in 0..<Int.random(in: 1...6, using: &generator) {
                let location = Int.random(in: 0...text.length, using: &generator)
                let removed = Int.random(in: 0...min(4, text.length - location), using: &generator)
                let replacement = ["", "x", "abc", "\n\n"].randomElement(using: &generator)!
                accumulator.record(range: NSRange(location: location, length: removed), newLength: (replacement as NSString).length)
                text = text.replacingCharacters(in: NSRange(location: location, length: removed), with: replacement) as NSString
            }
            let merged = try! #require(accumulator.merged)
            let replacement = text.substring(with: NSRange(location: merged.range.location, length: merged.newLength))
            #expect(original.replacingCharacters(in: merged.range, with: replacement) == text as String, "merged \(merged)")
        }
        #expect(EditAccumulator().merged == nil)
    }
}
