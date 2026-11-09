import Foundation

/// The props each component takes, for the editor to offer inside an open tag: a port of `props.ts`.
public enum MdxProps {
    public struct Value: Equatable, Sendable {
        public var value: String
        public var description: String
    }

    public struct Spec: Equatable, Sendable {
        public var name: String
        public var description: String
        /// Values worth suggesting; the prop may still take others (a width of `320`).
        public var values: [Value] = []
    }

    public static let highlightColors = ["yellow", "green", "blue", "pink", "orange"]
    public static let chartTypes = ["bar", "line", "area", "pie"]

    private static let imageProps: [Spec] = [
        Spec(name: "src", description: "Where the picture is: app_data/… or a web address"),
        Spec(name: "alt", description: "Text for when it can't be seen, and for screen readers"),
        Spec(name: "title", description: "Tooltip shown when hovering over it"),
        Spec(name: "width", description: "How wide to draw it: pixels (400) or a share of the note (50%)", values: [
            Value(value: "25%", description: "A quarter of the note's width"),
            Value(value: "50%", description: "Half the note's width"),
            Value(value: "75%", description: "Three quarters of the note's width"),
            Value(value: "100%", description: "The note's full width"),
            Value(value: "200", description: "200 pixels wide"),
            Value(value: "400", description: "400 pixels wide"),
            Value(value: "600", description: "600 pixels wide"),
            Value(value: "800", description: "800 pixels wide"),
        ]),
    ]

    /// In the desktop's order: the order the components are listed in (`Info`, `Warning`, ...).
    public static let catalog: [(component: String, props: [Spec])] = [
        ("Info", []),
        ("Warning", []),
        ("Image", imageProps),
        ("Drawio", [Spec(name: "src", description: "The stored diagram: app_data/…")] + imageProps.filter { $0.name != "src" }),
        ("Toc", [Spec(name: "maxDepth", description: "Deepest heading level to list (1 to 6)", values: (1...6).map { Value(value: String($0), description: "Stop at level \($0) headings") })]),
        ("Mark", [Spec(name: "color", description: "Highlighter colour", values: highlightColors.map { Value(value: $0, description: "Highlight in \($0)") })]),
        ("Footnotes", []),
        ("YouTube", [
            Spec(name: "url", description: "The video's link (youtube.com/watch…, youtu.be/…) or its 11-character id"),
            Spec(name: "start", description: "Where to begin playing: seconds (90), or 1:30, 1m30s", values: [
                Value(value: "30", description: "30 seconds in"),
                Value(value: "1:00", description: "One minute in"),
                Value(value: "5:00", description: "Five minutes in"),
            ]),
            Spec(name: "title", description: "Names the player for screen readers"),
        ]),
        ("Repo", [
            Spec(name: "url", description: "The repository's page or clone address (github.com/owner/repo, git@host:owner/repo.git)"),
            Spec(name: "description", description: "What the repository is for, shown under its name"),
        ]),
        ("Chart", [
            Spec(name: "type", description: "Kind of chart (bar when left out)", values: chartTypes.map { Value(value: $0, description: "A \($0) chart") }),
            Spec(name: "x", description: "The column for the labels along the bottom (the first when left out)"),
            Spec(name: "y", description: "The column(s) to draw, comma-separated (every column of numbers when left out)"),
            Spec(name: "title", description: "Caption shown above the chart"),
            Spec(name: "height", description: "How tall to draw it, in pixels (280 when left out)", values: ["200", "280", "400", "600"].map { Value(value: $0, description: "\($0) pixels tall") }),
        ]),
    ]

    private static func props(of component: String) -> [Spec] { catalog.first { $0.component == component }?.props ?? [] }

    // MARK: Reading the tag at the caret

    /// How far back from the caret to look for the `<` that opened the tag.
    private static let lookback = 1500

    private struct Attribute {
        var name: String
        var nameStart: Int
        var nameEnd: Int
        var hasEquals = false
        /// The quoted value, between the quotes; `closed` says whether the closing quote is there yet.
        var value: (start: Int, end: Int, closed: Bool)?
    }

    private struct OpenTag {
        var name: String
        var nameEnd: Int
        var attributes: [Attribute] = []
        /// The last place the caret can be and still be in this tag: before the `/` or `>` that ends it, or, while that hasn't been typed, where
        /// reading stopped (the end of an unclosed value's line, a blank line, the end of the note).
        var reach: Int
    }

    private static let tagStart = try! NSRegularExpression(pattern: "^<(\(catalog.map(\.component).joined(separator: "|")))(?=\\s)")
    private static let attributeName = try! NSRegularExpression(pattern: "[A-Za-z_][A-Za-z0-9_.:-]*")
    private static let equals = try! NSRegularExpression(pattern: "^\\s*=\\s*")
    private static let whitespace = try! NSRegularExpression(pattern: "^\\s*")
    private static let blankLine = try! NSRegularExpression(pattern: "\\n[ \\t]*\\n")

    private static func match(_ regex: NSRegularExpression, in text: NSString, at location: Int, anchored: Bool = true) -> NSRange? {
        guard location <= text.length else { return nil }
        let range = NSRange(location: location, length: text.length - location)
        guard let found = regex.firstMatch(in: text as String, options: anchored ? [.anchored] : [], range: range) else { return nil }
        return found.range
    }

    /// The tag starting at `start` (a `<`), read as far as it goes. Values are taken to end on their own line.
    private static func readTag(_ text: NSString, at start: Int) -> OpenTag? {
        let head = JS.slice(text, start, start + 32)
        guard let found = tagStart.firstWholeMatch(in: head), let name = found.string(1, in: head as NSString) else { return nil }
        var tag = OpenTag(name: name, nameEnd: start + found.range.length, reach: text.length)
        var i = tag.nameEnd
        while i < text.length {
            let skippedRange = match(whitespace, in: text, at: i) ?? NSRange(location: i, length: 0)
            let skipped = text.substring(with: skippedRange)
            // MDX can't carry a tag across a blank line, so what follows one isn't this tag's.
            if blankLine.firstWholeMatch(in: skipped) != nil {
                tag.reach = i
                return tag
            }
            i += skippedRange.length
            if i >= text.length { break }

            let here = text.character(at: i)
            if here == 0x3E || (here == 0x2F && i + 1 < text.length && text.character(at: i + 1) == 0x3E) {
                tag.reach = i
                return tag
            }
            guard let nameRange = match(attributeName, in: text, at: i) else {
                i += 1
                continue
            }
            var attribute = Attribute(name: text.substring(with: nameRange), nameStart: i, nameEnd: i + nameRange.length)
            i = attribute.nameEnd

            guard let equalsRange = match(equals, in: text, at: i) else {
                tag.attributes.append(attribute)
                continue
            }
            attribute.hasEquals = true
            i += equalsRange.length

            guard i < text.length, text.character(at: i) == 0x22 || text.character(at: i) == 0x27 else {
                tag.attributes.append(attribute)
                continue  // an {expression}, or a value not yet started
            }
            let quote = text.character(at: i)
            let lineEnd = JS.index(of: 0x0A, in: text, from: i)
            let limit = lineEnd == -1 ? text.length : lineEnd
            let closing = JS.index(of: quote, in: text, from: i + 1)
            let closed = closing != -1 && closing < limit
            attribute.value = (i + 1, closed ? closing : limit, closed)
            tag.attributes.append(attribute)
            if !closed {
                tag.reach = limit
                return tag
            }
            i = closing + 1
        }
        return tag
    }

    /// The `<Component ` the caret is inside of, if any.
    private static func enclosingTag(_ text: NSString, caret: Int) -> (start: Int, tag: OpenTag)? {
        let floor = max(0, caret - lookback)
        var i = caret
        while i > 0 {
            i = JS.lastIndex(of: 0x3C, in: text, from: i - 1)
            if i < floor || i < 0 || i >= caret { return nil }
            // Like a tag the user starts typing: not glued to a word, and not part of `<<`.
            if i > 0, JS.isWordUnit(text.character(at: i - 1)) || text.character(at: i - 1) == 0x3C { continue }
            if let tag = readTag(text, at: i) { return (i, tag) }
        }
        return nil
    }

    private static func startsWith(_ candidate: String, _ typed: String) -> Bool { candidate.lowercased().hasPrefix(typed.lowercased()) }

    /// What to offer at the caret inside a component's open tag: the names of the props the tag doesn't have yet (after a space, or part-way through
    /// typing one), or, inside the quotes of a prop with values worth suggesting, those values. Nil anywhere else, and in a fenced code block.
    public static func findTarget(_ text: String, caret: Int) -> CompletionTarget? {
        let source = text as NSString
        guard let found = enclosingTag(source, caret: caret) else { return nil }
        let (tagStart, tag) = found
        if MarkdownImages.insideFence(source, lineStart: JS.lastIndex(of: 0x0A, in: source, from: tagStart - 1) + 1) { return nil }
        if caret <= tag.nameEnd || caret > tag.reach { return nil }
        let specs = props(of: tag.name)

        if let inValue = tag.attributes.first(where: { $0.value.map { $0.start <= caret && caret <= $0.end } ?? false }), let value = inValue.value {
            let spec = specs.first { $0.name == inValue.name }
            let query = JS.slice(source, value.start, caret)
            let items = (spec?.values ?? []).filter { startsWith($0.value, query) }
                .map { EditorCompletion(name: $0.value, label: $0.value, description: $0.description, template: "\($0.value)\"$0") }
            // Through the closing quote, which the value brings along, so the caret ends up past it.
            return CompletionTarget(start: value.start, end: value.closed ? value.end + 1 : value.end, query: query, items: items, label: "\(spec?.name ?? inValue.name) values")
        }

        let typing = tag.attributes.first { $0.nameStart < caret && caret <= $0.nameEnd }
        if let typing, typing.hasEquals { return nil }
        if typing == nil {
            // Only in the space between things: not hard against the tag's name, a value, or a `=`.
            let before = caret >= 1 && caret - 1 < source.length ? source.character(at: caret - 1) : nil
            let afterEquals = whitespaceThenEquals.firstWholeMatch(in: JS.slice(source, caret)) != nil
            guard let before, isWhitespace(before), !afterEquals else { return nil }
        }

        let start = typing?.nameStart ?? caret
        let end = typing?.nameEnd ?? caret
        let query = JS.slice(source, start, caret)
        let present = Set(tag.attributes.filter { $0.nameStart != typing?.nameStart || $0.nameEnd != typing?.nameEnd }.map(\.name))
        // A prop typed right up against the next one needs a space of its own.
        let gap: String
        if end < source.length, !isWhitespace(source.character(at: end)), source.character(at: end) != 0x2F, source.character(at: end) != 0x3E { gap = " " } else { gap = "" }
        let items = specs.filter { !present.contains($0.name) && startsWith($0.name, query) }
            .map { EditorCompletion(name: $0.name, label: $0.name, description: $0.description, template: "\($0.name)=\"$0\"\(gap)") }
        return CompletionTarget(start: start, end: end, query: query, items: items, label: "\(tag.name) props")
    }

    private static let whitespaceThenEquals = try! NSRegularExpression(pattern: "^\\s*=")

    private static func isWhitespace(_ unit: unichar) -> Bool {
        switch unit {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }
}
