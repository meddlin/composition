import Foundation
import Testing

@testable import CompositionCore

// The preview's text against the desktop's own. fixtures/conformance/preview-text.json holds what remark-gfm (the desktop's preview of a note with no
// component) makes of the text of short notes: bare web and e-mail addresses become links (GFM's autolink literals), and quotes, dashes and dots stay
// as written. apps/web/src/components/notes/previewTextConformance.test.ts writes it, and `conformance.sh` checks the desktop still makes the same file.
// The file is committed, so a plain `swift test` replays it. See fixtures/conformance/README.md.

private let corpus: JSONValue? = corpusDirectory
    .flatMap { try? String(contentsOf: $0.appendingPathComponent("preview-text.json"), encoding: .utf8) }
    .flatMap { try? JSONValue(parsing: $0) }

/// A block's text as the fixture writes it: neighbouring text as one, a soft line break as the `\n` in it.
private func json(_ inlines: [MdInline]) -> JSONValue {
    var out: [JSONValue] = []
    func add(_ item: JSONValue) {
        if case .object(let new) = item, let text = new["text"]?.stringValue,
            case .object(let last)? = out.last, let before = last["text"]?.stringValue {
            out[out.count - 1] = .object(JSONObject([.init("text", .string(before + text))]))
        } else {
            out.append(item)
        }
    }
    func object(_ key: String, _ value: JSONValue) -> JSONValue { .object(JSONObject([.init(key, value)])) }
    for inline in inlines {
        switch inline {
        case .text(let text): add(object("text", .string(text)))
        case .softBreak: add(object("text", .string("\n")))
        case .lineBreak: add(object("break", .bool(true)))
        case .code(let code): add(object("code", .string(code)))
        case .emphasis(let children): add(object("emphasis", json(children)))
        case .strong(let children): add(object("strong", json(children)))
        case .strikethrough(let children): add(object("strikethrough", json(children)))
        case .link(let destination, let children):
            add(.object(JSONObject([.init("link", .string(destination ?? "")), .init("children", json(children))])))
        case .image: add(object("other", .string("image")))
        case .mark: add(object("other", .string("mark")))
        }
    }
    return .array(out)
}

/// Every block that holds text, in the order written, as the fixture lists them.
private func textBlocks(_ blocks: [MdBlock]) -> [JSONValue] {
    func block(_ kind: String, _ inlines: [MdInline]) -> JSONValue {
        .object(JSONObject([.init("block", .string(kind)), .init("inlines", json(inlines))]))
    }
    return blocks.flatMap { item -> [JSONValue] in
        switch item {
        case .paragraph(let inlines): [block("paragraph", inlines)]
        case .heading(_, _, let inlines): [block("heading", inlines)]
        case .quote(let children): textBlocks(children)
        case .list(_, _, let items): items.flatMap { textBlocks($0.blocks) }
        case .table(_, let header, let rows): (header + rows.flatMap { $0 }).map { block("cell", $0) }
        case .code, .rule, .html: []
        }
    }
}

@Suite("The preview's text against the desktop", .enabled(if: corpus != nil, "fixtures/conformance/preview-text.json is not there"))
struct PreviewTextConformanceTests {
    /// Notes the iPad's preview reads differently from the desktop's, each looked at: the reason is the difference. Everything else must agree, and an
    /// entry that has started to agree must be taken off. Keep this list short, and fix a difference rather than add to it.
    static let known: [String: String] = [
        // micromark reads an address before it looks for strikethrough, so its path takes `~user/a` and leaves the last `~`; cmark-gfm has already made
        // `~user/a~` a strikethrough when the iPad looks for addresses in the text it left, so the link stops at the first `~`.
        "https://example.com/~user/a~": "the desktop reads an address before strikethrough, cmark after",
    ]

    @Test("every note's text, its bare addresses and its punctuation, is what the desktop's preview makes of it")
    func agreement() throws {
        let cases = try #require(corpus?.objectValue?["cases"]?.arrayValue).compactMap(\.objectValue)
        #expect(cases.count > 70)
        var differ: [String] = [], agreeing: [String] = []
        for item in cases {
            let markdown = try #require(item["markdown"]?.stringValue)
            let want = try #require(item["blocks"])
            let got = JSONValue.array(NotePreview.make(content: markdown).blocks.flatMap { block -> [JSONValue] in
                if case .markdown(let blocks) = block { return textBlocks(blocks) }
                return []
            })
            if got == want {
                if Self.known[markdown] != nil { agreeing.append(String(reflecting: markdown)) }
            } else if Self.known[markdown] == nil {
                differ.append("\(String(reflecting: markdown))\n    desktop \(want.serialized())\n    iPad    \(got.serialized())")
            }
        }
        #expect(differ.isEmpty, "\(differ.count) of \(cases.count) differ:\n\(differ.joined(separator: "\n"))")
        #expect(agreeing.isEmpty, "known differences that now agree, to take off the list: \(agreeing)")
    }
}
