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
