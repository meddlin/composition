import Foundation
import Testing

@testable import CompositionCore

// The Live tab shows a code block's two fences together while the caret is anywhere in the block (found on the iPad, 2026-11-08).

@Suite("The Live tab reveals a whole code block")
struct LiveRevealTests {
    private let text = "Before the block.\n\n```swift\nlet a = 1\n\nlet b = 2\n```\n\nAfter the block, with `code` inline.\n"

    private func line(at offset: Int) -> NSRange { (text as NSString).paragraphRange(for: NSRange(location: offset, length: 0)) }
    private func offset(of needle: String) -> Int { (text as NSString).range(of: needle).location }
    private var block: NSRange {
        let spans = MarkdownHighlighter.spans(in: text)
        return spans.first { $0.kind == .codeBlock }!.range
    }

    @Test("the caret on a line inside the block shows the whole block, both fences")
    func insideTheBlock() {
        let spans = MarkdownHighlighter.spans(in: text)
        for needle in ["let a", "let b"] {
            let revealed = LiveReveal.range(forLine: line(at: offset(of: needle)), spans: spans)
            #expect(NSEqualRanges(NSIntersectionRange(revealed, block), block), "\(needle): the block is inside what shows")
            #expect(revealed.location <= offset(of: "```swift") && revealed.upperBound >= offset(of: "```\n\nAfter") + 3, "\(needle): the opening and the closing fence are inside it")
        }
    }

    @Test("an empty line inside the block counts, and so does either fence's own line")
    func emptyLineAndFences() {
        let spans = MarkdownHighlighter.spans(in: text)
        let empty = offset(of: "let a = 1\n") + "let a = 1\n".count
        for place in [empty, offset(of: "```swift"), offset(of: "```\n\nAfter")] {
            let revealed = LiveReveal.range(forLine: line(at: place), spans: spans)
            #expect(revealed.location <= offset(of: "```swift") && revealed.upperBound >= offset(of: "```\n\nAfter") + 3, "from \(place)")
        }
    }

    @Test("outside the block, and for inline code, only the caret's own line shows")
    func outsideTheBlock() {
        let spans = MarkdownHighlighter.spans(in: text)
        for needle in ["Before", "After", "`code`"] {
            let own = line(at: offset(of: needle))
            #expect(LiveReveal.range(forLine: own, spans: spans) == own, "\(needle)")
        }
    }

    @Test("with no code block in the note, nothing is widened")
    func noBlock() {
        let plain = "# Title\n\nSome **bold** text.\n"
        let spans = MarkdownHighlighter.spans(in: plain)
        let own = (plain as NSString).paragraphRange(for: NSRange(location: 12, length: 0))
        #expect(LiveReveal.range(forLine: own, spans: spans) == own)
    }
}
