import Foundation
import Testing

@testable import CompositionCore

@Suite("The editor's syntax colours", .serialized)
struct MarkdownHighlighterTests {
    /// `kind: text` for each span, the text being what the span's range covers.
    private func found(_ text: String) -> [String] {
        let ns = text as NSString
        return MarkdownHighlighter.spans(in: text).map { "\($0.kind): \(String(reflecting: ns.substring(with: $0.range)))" }
    }

    @Test("a heading, its emphasis and the marks around them")
    func heading() {
        let spans = found("## Title *em*\n")
        #expect(spans.contains("heading(level: 2): \"## Title *em*\""))
        #expect(spans.contains("emphasis: \"*em*\""))
        #expect(spans.contains("mark: \"## \""))
        #expect(spans.filter { $0 == "mark: \"*\"" }.count == 2)
    }

    @Test("bold, strikethrough and code, with the backticks as marks")
    func inline() {
        let spans = found("a **bold** ~~gone~~ `x` and ``y ` z``\n")
        #expect(spans.contains("strong: \"**bold**\"") && spans.filter { $0 == "mark: \"**\"" }.count == 2)
        #expect(spans.contains("strikethrough: \"~~gone~~\"") && spans.filter { $0 == "mark: \"~~\"" }.count == 2)
        #expect(spans.contains("inlineCode: \"`x`\"") && spans.contains("inlineCode: \"``y ` z``\""))
        #expect(spans.filter { $0 == "mark: \"``\"" }.count == 2)
    }

    @Test("a fenced block, its fences, a link, a quote and the list markers")
    func blocks() {
        let code = found("```swift\nlet x = 1\n```\n")
        #expect(code.contains("codeBlock: \"```swift\\nlet x = 1\\n```\"") || code.contains("codeBlock: \"```swift\\nlet x = 1\\n```\\n\""))
        #expect(code.contains("mark: \"```swift\"") && code.contains("mark: \"```\""))

        let link = found("see [text](https://x.test) now\n")
        #expect(link.contains("linkText: \"text\"") && link.contains("mark: \"[\"") && link.contains("mark: \"](https://x.test)\""))

        let quote = found("> a\n> b\n")
        #expect(quote.filter { $0 == "mark: \">\"" }.count == 2 && quote.contains { $0.hasPrefix("quote:") })

        let list = found("- one\n1. two\n- [x] done\n")
        #expect(list.filter { $0 == "listMarker: \"-\"" }.count == 2 && list.contains("listMarker: \"1.\"") && list.contains("listMarker: \"[x]\""))
    }

    @Test("component tags, in a line of text or on lines of their own")
    func tags() {
        let block = found("<Info>\n\nx\n\n</Info>\n")
        #expect(block.contains("tag: \"<Info>\"") && block.contains("tag: \"</Info>\""))
        let inline = found("a <Mark color=\"green\">b</Mark> c\n")
        #expect(inline.contains("tag: \"<Mark color=\\\"green\\\">\"") && inline.contains("tag: \"</Mark>\""))
    }

    @Test("frontmatter is its own span and is not read as Markdown")
    func frontmatter() {
        let spans = found("---\ntitle: A\ntags:\n- x\n---\n# H\n")
        #expect(spans.first == "frontmatter: \"---\\ntitle: A\\ntags:\\n- x\\n---\\n\"")
        #expect(spans.contains("heading(level: 1): \"# H\""))
        #expect(!spans.contains { $0.hasPrefix("listMarker") }, "the list in the frontmatter is not a list")
    }

    @Test("ranges are UTF-16 offsets, also after text that is two, three and four bytes long")
    func unicode() {
        let spans = found("é 日本 😀 **b** and `c`\n")
        #expect(spans.contains("strong: \"**b**\"") && spans.contains("inlineCode: \"`c`\""))
    }

    @Test("a 5,000-line note is read in a time to report (and never slow enough to be a problem)")
    func large() {
        var lines: [String] = ["---", "title: Big", "---", "# Big note", ""]
        for i in 0..<1_000 {
            lines += ["## Section \(i)", "", "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/\(i)) with é and 😀.", "", "- item one", "- item two", ""]
        }
        let text = lines.joined(separator: "\n")
        #expect(text.split(separator: "\n", omittingEmptySubsequences: false).count > 7_000)
        let clock = ContinuousClock()
        var spans: [HighlightSpan] = []
        let elapsed = clock.measure { spans = MarkdownHighlighter.spans(in: text) }
        print("S3 highlighter: \(text.utf16.count) UTF-16 units, \(text.split(separator: "\n", omittingEmptySubsequences: false).count) lines, \(spans.count) spans in \(elapsed)")
        #expect(spans.count > 10_000)
        #expect(elapsed < .seconds(5))
    }
}

@Suite("The highlighter and a note with Windows line breaks")
struct HighlighterCRLFTests {
    @Test("frontmatter with \\r\\n line breaks does not move the spans that follow it")
    func frontmatterWithCRLF() {
        let body = "# Title\r\n\r\nSome **bold** text.\r\n"
        let unix = "---\ntitle: A\ntags:\n- x\n---\n" + "# Title\n\nSome **bold** text.\n"
        let windows = "---\r\ntitle: A\r\ntags:\r\n- x\r\n---\r\n" + body
        func texts(_ text: String) -> [String] {
            let ns = text as NSString
            return MarkdownHighlighter.spans(in: text).filter { $0.kind != .frontmatter }.map { ns.substring(with: $0.range) }
        }
        // The same spans over the same words, whichever line breaks the note has.
        #expect(texts(windows).map { $0.replacingOccurrences(of: "\r\n", with: "\n") } == texts(unix))
    }
}

@Suite("The highlighter and a note with a lone \\r for a line break")
struct HighlighterLoneCRTests {
    static let note = "# Title\n\nSome **bold** text\nand `code`.\n\n> a *quote*\n> two\n\n- one\n- [x] two\n\n```swift\nlet x = 1\n```\n\nend [link](https://x.test)\n"

    @Test("a lone \\r ends a line as \\n does (cmark reads it so), so every span is where it is with \\n")
    func sameSpans() {
        let unix = Self.note
        #expect(MarkdownHighlighter.spans(in: unix.replacingOccurrences(of: "\n", with: "\r")) == MarkdownHighlighter.spans(in: unix))
        // One lone \r in a paragraph near the top of a note that otherwise has \n: the colours below it are not lost.
        let one = unix.replacingOccurrences(of: "text\nand", with: "text\rand")
        #expect(one != unix && !one.contains("\r\n"))
        #expect(MarkdownHighlighter.spans(in: one) == MarkdownHighlighter.spans(in: unix))
    }

    @Test("the incremental model colours such a note as a full read of the same note with \\n does")
    func model() {
        let unix = Self.note, mac = unix.replacingOccurrences(of: "\n", with: "\r")
        #expect(HighlightModel(text: mac).spans(in: NSRange(location: 0, length: (mac as NSString).length)) == MarkdownHighlighter.spans(in: unix))
    }
}

/// cmark leaves a paragraph's leading link reference definitions out of its text, but counts the lines of what is left from the paragraph's first line,
/// the definition's, and starts the paragraph there. The desktop (lezer, remark) has the definition and the paragraph as two blocks, each where it is written.
@Suite("The highlighter after a link reference definition")
struct HighlighterDefinitionTests {
    private func found(_ text: String) -> [String] {
        let ns = text as NSString
        return MarkdownHighlighter.spans(in: text).map { "\($0.kind): \(String(reflecting: ns.substring(with: $0.range)))" }
    }

    @Test("a paragraph's spans are where they are written, after one definition or several, a footnote's, one over lines, or one in a container")
    func spansAfterDefinitions() {
        for text in [
            "[a]: https://x.test\nSome *em* and **b**\nmore `c`\n",
            "[a]: https://x.test\n[b]: https://y.test 'title'\nSome *em* and **b**\nmore `c`\n",
            "[^1]: A footnote.\nSome *em* and **b**\nmore `c`\n",
            "[a]:\n  https://x.test\n  'a title\n  over lines'\nSome *em* and **b**\nmore `c`\n",
            "[a]: https://x.test\n  Some *em* and **b**\nmore `c`\n",
            "> [a]: https://x.test\n> Some *em* and **b**\n> more `c`\n",
            "- [a]: https://x.test\n  Some *em* and **b**\n  more `c`\n",
            "> [a]: https://x.test\nSome *em* and **b** `c`\n",
        ] {
            let spans = found(text)
            #expect(spans.contains("emphasis: \"*em*\"") && spans.contains("strong: \"**b**\"") && spans.contains("inlineCode: \"`c`\""), "\(String(reflecting: text)): \(spans)")
        }
    }

    @Test("a setext heading after a definition is coloured where it is written")
    func setext() {
        let spans = found("[a]: https://x.test\nTitle *em*\n===\n")
        #expect(spans.contains("heading(level: 1): \"Title *em*\\n===\"") && spans.contains("emphasis: \"*em*\""), "\(spans)")
    }

    @Test("the paragraph after a definition is a block from its own first line")
    func blockRange() {
        let text = "[a]: https://x.test\nSome *em* text\n"
        #expect(MarkdownHighlighter.blocks(in: text).map { (text as NSString).substring(with: $0.range) } == ["Some *em* text"])
    }

    @Test("a paragraph that only starts with a link is left as it is")
    func notADefinition() {
        // cmark ends a link whose title goes onto the next line on its first line, so the lines alone cannot tell this from a definition.
        let text = "[a](https://x.test\n'title')\n"
        #expect(found(text).contains("linkText: \"a\""))
        #expect(MarkdownHighlighter.blocks(in: text).first?.range.location == 0)
    }
}
