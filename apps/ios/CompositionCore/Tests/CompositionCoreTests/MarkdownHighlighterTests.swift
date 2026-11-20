import Foundation
import Markdown
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

/// cmark places what is on a paragraph's second and later lines at "where it is in the line's text + the paragraph's own start column", as if every
/// line of the paragraph started where its first line does. A line indented more or less than the first, or one without its container's marks (a lazy
/// line), had its colours that many columns out. The desktop (lezer, remark) has them where they are written.
@Suite("The highlighter on a paragraph's later lines")
struct HighlighterContinuationLineTests {
    private func found(_ text: String) -> [String] {
        let ns = text as NSString
        return MarkdownHighlighter.spans(in: text).map { "\($0.kind): \(String(reflecting: ns.substring(with: $0.range)))" }
    }

    @Test("a later line indented more than the first, or less (a hanging indent), is coloured where it is written")
    func indented() {
        for text in [
            "a\n   *b*\n",
            "a\n\t*b*\n",
            "  Some text\n*b* and more\n",
            "Some text that runs\n    on with a *b* hanging indent\n",
            "Title\n   *b*\n===\n",
            "- a\n     *b*\n",
            "- [x] a\n  *b*\n",
        ] {
            #expect(found(text).contains("emphasis: \"*b*\""), "\(String(reflecting: text)): \(found(text))")
        }
    }

    @Test("a lazy line, without its quote's or list item's marks, is coloured where it is written")
    func lazy() {
        for text in [
            "> a\n*b*\n",
            "- a\n*b*\n",
            "> > a\n> *b*\n",
            "- > a\n  *b*\n",
            // A lazy line keeps the spaces before its text in what cmark reads, so they are not where a line of the item would start.
            "1. a\n  *b*\n",
            "- a\n *b*\n",
            "> a\n  *b*\n",
            "10. a\n   *b*\n",
        ] {
            #expect(found(text).contains("emphasis: \"*b*\""), "\(String(reflecting: text)): \(found(text))")
        }
    }

    @Test("each line of a paragraph in a list in a quote is placed by the marks it has")
    func nested() {
        let spans = found("> - a\n>   *b*\n> **c**\n`d`\n")
        #expect(spans.contains("emphasis: \"*b*\"") && spans.contains("strong: \"**c**\"") && spans.contains("inlineCode: \"`d`\""), "\(spans)")
    }

    @Test("a `>` that is the text of an indented later line stays text")
    func quoteMarkAsText() {
        #expect(found("a\n    >*b*\n").contains("emphasis: \"*b*\""))
    }

    @Test("what runs over lines ends where it is written: emphasis, a link, code and HTML")
    func overLines() {
        let emphasis = found("*a\n   b*\n")
        #expect(emphasis.contains("emphasis: \"*a\\n   b*\""), "\(emphasis)")
        let link = found("- see [a\n  b](https://x.test) *c*\n")
        #expect(link.contains("mark: \"](https://x.test)\"") && link.contains("emphasis: \"*c*\""), "\(link)")
        // cmark ends code and HTML that run onto a later line by where they are in that line's text alone, without the paragraph's start column.
        let code = found("> a `b\n>    c` *d*\n")
        #expect(code.contains("inlineCode: \"`b\\n>    c`\"") && code.filter { $0 == "mark: \"`\"" }.count == 2 && code.contains("emphasis: \"*d*\""), "\(code)")
        let html = found("- a <span\n   x> *d*\n")
        #expect(html.contains("tag: \"<span\\n   x>\"") && html.contains("emphasis: \"*d*\""), "\(html)")
        let unindented = found("a <span\nx> *d*\n")
        #expect(unindented.contains("tag: \"<span\\nx>\"") && unindented.contains("emphasis: \"*d*\""), "\(unindented)")
    }

    @Test("after a link reference definition, every line of what follows is placed by its own indent")
    func afterDefinition() {
        let spans = found("[a]: https://x.test\nSome *em*\n   more `c` and **b**\n")
        #expect(spans.contains("emphasis: \"*em*\"") && spans.contains("inlineCode: \"`c`\"") && spans.contains("strong: \"**b**\""), "\(spans)")
    }

    @Test("the incremental model colours such lines as a full read does")
    func model() {
        let text = "> a\n*b*\n\n1. a\n  `c`\n\nx\n    **d**\n"
        #expect(HighlightModel(text: text).spans(in: NSRange(location: 0, length: (text as NSString).length)) == MarkdownHighlighter.spans(in: text))
        #expect(found(text).contains("emphasis: \"*b*\"") && found(text).contains("inlineCode: \"`c`\"") && found(text).contains("strong: \"**d**\""))
    }
}

/// cmark does not count the new line after a backslash hard break (`a\` at a line's end), nor one inside a link's address, title or reference label
/// (`[x](` then `u)` on the next line): what follows in the paragraph is reported a line early, its columns counted on from the earlier line's text.
/// The desktop (lezer, remark) has it where it is written.
@Suite("The highlighter after a line cmark does not count")
struct HighlighterUncountedLineTests {
    private func found(_ text: String) -> [String] {
        let ns = text as NSString
        return MarkdownHighlighter.spans(in: text).map { "\($0.kind): \(String(reflecting: ns.substring(with: $0.range)))" }
    }

    @Test("after a backslash hard break, the rest of the paragraph is coloured where it is written")
    func backslash() {
        for text in [
            "a\\\nb\n*c*\n",
            "a\\\n   b *c*\n",
            "a\\\nb\\\nc\n*c*\n",
            "a\\\nb\n`x` and *c*\n",
            "a\\\r\nb\r\n*c*\r\n",
            "> a\\\n> b\n> *c*\n",
            "> a\\\nb\n*c*\n",
            "- a\\\n  b\n  *c*\n",
            "é\\\nb\n*c*\n",
            "a\\\nb\n*c*\n===\n",
            "[d]: https://x.test\na\\\nb\n*c*\n",
            "a \\\\\\\nb\n*c*\n",
        ] {
            #expect(found(text).contains("emphasis: \"*c*\""), "\(String(reflecting: text)): \(found(text))")
        }
        let across = found("*a\\\n  b* *c*\n")
        #expect(across.contains("emphasis: \"*a\\\\\\n  b*\"") && across.contains("emphasis: \"*c*\""), "\(across)")
    }

    @Test("a backslash that is not a hard break leaves the lines as they are")
    func notABreak() {
        for text in ["a\\\\\nb\n*c*\n", "`a\\\nb` x\n*c*\n", "a\\  \nb\n*c*\n", "a\\\n"] {
            let spans = found(text)
            #expect(!text.contains("*c*") || spans.contains("emphasis: \"*c*\""), "\(String(reflecting: text)): \(spans)")
        }
    }

    @Test("after a link whose address, title or label runs onto the next line, the rest is coloured where it is written")
    func link() {
        let address = found("a [x](\n   https://x.test) *d*\n")
        #expect(address.contains("mark: \"](\\n   https://x.test)\"") && address.contains("emphasis: \"*d*\""), "\(address)")
        let title = found("> [x](https://x.test\n> \"t\") *d*\n> *e*\n")
        #expect(title.contains("mark: \"](https://x.test\\n> \\\"t\\\")\""), "\(title)")
        #expect(title.contains("emphasis: \"*d*\"") && title.contains("emphasis: \"*e*\""), "\(title)")
        let label = found("[x][a\n  b] *d*\n\n[a b]: https://x.test\n")
        #expect(label.contains("mark: \"][a\\n  b]\"") && label.contains("emphasis: \"*d*\""), "\(label)")
        let text = found("[x\ny](\n  u) *d*\n")
        #expect(text.contains("linkText: \"x\\ny\"") && text.contains("emphasis: \"*d*\""), "\(text)")
        let image = found("[![a](\n  i.png)](\n  u) *d*\n")
        #expect(image.contains("emphasis: \"*d*\""), "\(image)")
    }

    @Test("in generated paragraphs, every inline is placed on its own marks: lines over containers, breaks, links, code and HTML")
    func generated() {
        // What a line can hold, and what can run from a line's end onto the next: one cmark counts and one it does not, of each kind.
        let items = ["a", "*em*", "**st**", "`co`", "[l](u)", "![i](p)", "<b>", "é", "_u_", "~~s~~"]
        let over: [(String, String)] = [
            ("x\\", "y"), ("x  ", "y"), ("x", "y"), ("[l](", "u)"), ("[l](u", "\"t\")"), ("[l](u \"t", "t\")"), ("[l][r", "s]"), ("![i](", "p)"),
            ("[![i](", "p)](u)"), ("[l", "m](u)"), ("`co", "de`"), ("<span", "x>"), ("*em", "ph*"),
        ]
        // The first line's container, and what each later line may start with: its marks, fewer (a lazy line), or more space.
        let containers: [(String, [String])] = [
            ("", ["", "  ", "\t"]), ("   ", ["", " ", "      "]), ("> ", ["> ", "", ">", ">  "]), ("- ", ["  ", "", " ", "    "]),
            ("1. ", ["   ", "", "  "]), ("> - ", [">   ", "", "> "]), ("- > ", ["  > ", "", "  "]),
        ]
        var seed: UInt64 = 7
        func random(_ count: Int) -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int((seed >> 33) % UInt64(count))
        }
        var wrong: [String] = []
        for _ in 0..<3_000 {
            let (first, later) = containers[random(containers.count)]
            let count = 2 + random(4)
            var text = first.isEmpty && random(5) == 0 ? "[d]: https://x.test\n" : "", carry = ""
            for index in 0..<count {
                var line = carry
                for _ in 0..<random(3) { line += (line.isEmpty ? "" : " ") + items[random(items.count)] }
                if index < count - 1 {
                    let (end, start) = over[random(over.count)]
                    line += (line.isEmpty ? "" : " ") + end
                    carry = start + " "
                }
                text += (index == 0 ? first : later[random(later.count)]) + (line.isEmpty ? "z" : line) + (random(5) == 0 ? "\r\n" : "\n")
            }
            text += "\n[r s]: https://x.test\n"
            if let problem = misplaced(in: text) { wrong.append("\(String(reflecting: text)): \(problem)") }
        }
        #expect(wrong.isEmpty, "\(wrong.count) misplaced, first: \(wrong.prefix(5).joined(separator: "\n"))")
    }

    /// The first inline of `text` whose place does not start and end with its own marks (or, for text, hold its words), if any.
    private func misplaced(in text: String) -> String? {
        let map = SourceMap(text: text), ns = text as NSString
        var queue: [any Markup] = [Document(note: text)]
        while let markup = queue.popLast() {
            queue += markup.children
            guard !(markup is BlockMarkup || markup is SoftBreak || markup is LineBreak) else { continue }
            guard let range = map.range(of: markup) else { return "\(type(of: markup)) has no place" }
            let written = ns.substring(with: NSRange(location: range.lowerBound, length: range.count))
            let ends: (starts: [String], ends: [String])? = switch markup {
            case is Strong: (["**"], ["**"])
            case is Emphasis: (["*", "_"], ["*", "_"])
            case is Strikethrough: (["~"], ["~"])
            case is InlineCode: (["`"], ["`"])
            case is InlineHTML: (["<"], [">"])
            case is Image: (["!["], [")", "]"])
            case is Link: (["["], [")", "]"])
            default: nil
            }
            if let ends, !ends.starts.contains(where: written.hasPrefix) || !ends.ends.contains(where: written.hasSuffix) {
                return "\(type(of: markup)) is at \(String(reflecting: written))"
            }
            if let text = markup as? Text, !written.contains("\\"), !written.contains("&"),
                written.trimmingCharacters(in: .whitespaces) != text.string.trimmingCharacters(in: .whitespaces) {
                return "text \(String(reflecting: text.string)) is at \(String(reflecting: written))"
            }
        }
        return nil
    }

    @Test("the incremental model colours such lines as a full read does")
    func model() {
        let text = "a\\\nb\n*c*\n\n- [x](\n  u) **d**\n"
        #expect(HighlightModel(text: text).spans(in: NSRange(location: 0, length: (text as NSString).length)) == MarkdownHighlighter.spans(in: text))
        #expect(found(text).contains("emphasis: \"*c*\"") && found(text).contains("strong: \"**d**\""))
    }
}
