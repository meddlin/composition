import Foundation

/// The edit that turns Markdown images into `<Image />` tags: a port of `imageToMdx.ts` (build plan Step 8). Offsets are UTF-16 units,
/// as in the desktop's JavaScript and in `NSRange`.
public struct ImageConversion: Equatable, Sendable {
    /// The stretch of the note to replace, and what to put there.
    public var start: Int
    public var end: Int
    public var text: String
    /// Where the caret goes within `text`: at the end of the last tag's attributes, ready for another one.
    public var caret: Int
}

public enum MarkdownImages {
    // `![alt](src)` and `![alt](src "title")`. An address with spaces or parentheses (or in `<...>`) is left alone.
    private static let image = try! NSRegularExpression(pattern: #"!\[((?:[^\]\[\\\n]|\\.)*)\]\(\s*([^\s()<>]*)(?:\s+"((?:[^"\\\n]|\\.)*)")?\s*\)"#)
    private static let escape = try! NSRegularExpression(pattern: #"\\([!-/:-@\[-`{-~])"#)
    // An `&` that already starts a character reference means that reference; any other one is just an ampersand.
    private static let bareAmpersand = try! NSRegularExpression(pattern: "&(?!(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)")
    private static let fence = try! NSRegularExpression(pattern: "^ {0,3}(?:`{3,}|~{3,})", options: [.anchorsMatchLines])
    private static let closingTag = " />"

    private static func replacing(_ regex: NSRegularExpression, in text: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: template)
    }

    /// A Markdown string as the inside of a double-quoted JSX attribute: escapes undone, `"` and bare `&` written as references.
    private static func attribute(_ markdown: String) -> String {
        let unescaped = replacing(escape, in: markdown, with: "$1")
        let ampersands = replacing(bareAmpersand, in: unescaped, with: "&amp;")
        return ampersands.replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// Whether the line starting at `lineStart` sits inside a fenced code block.
    static func insideFence(_ text: NSString, lineStart: Int) -> Bool {
        let before = text.substring(to: lineStart)
        return fence.numberOfMatches(in: before, range: NSRange(location: 0, length: (before as NSString).length)) % 2 == 1
    }

    /// Whether `index` sits in a fenced code block or an inline code span, where `![](...)` is just text.
    private static func insideCode(_ text: NSString, at index: Int) -> Bool {
        var lineStart = 0
        if index > 0 {
            let before = text.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: index))
            lineStart = before.location == NSNotFound ? 0 : before.location + 1
        }
        if insideFence(text, lineStart: lineStart) { return true }
        let line = text.substring(with: NSRange(location: lineStart, length: index - lineStart))
        return line.filter { $0 == "`" }.count % 2 == 1
    }

    /// The edit that turns the Markdown images at the caret, or touched by the selection, into `<Image src alt />` tags, which can say how
    /// wide to be. Nil when there is no such image. The caret counts as on an image anywhere from its `!` to just after its `)`; a selection
    /// takes every image it overlaps, so it can convert a whole note's worth at once (select all).
    public static func toMdx(_ text: String, selectionStart: Int, selectionEnd: Int) -> ImageConversion? {
        let source = text as NSString
        var found: [(start: Int, end: Int, tag: String)] = []
        for match in image.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            let start = match.range.location
            let end = start + match.range.length
            let touched = selectionStart == selectionEnd ? (start <= selectionStart && selectionStart <= end) : (start < selectionEnd && selectionStart < end)
            guard touched, !insideCode(source, at: start) else { continue }
            func group(_ index: Int) -> String? { match.range(at: index).location == NSNotFound ? nil : source.substring(with: match.range(at: index)) }
            let alt = group(1) ?? ""
            let src = group(2) ?? ""
            var tag = "<Image src=\"\(attribute(src))\" alt=\"\(attribute(alt))\""
            if let title = group(3) { tag += " title=\"\(attribute(title))\"" }
            found.append((start, end, tag + closingTag))
        }
        guard let first = found.first else { return nil }

        // Everything between the first and the last stays as it was.
        var converted = ""
        var from = first.start
        for item in found {
            converted += source.substring(with: NSRange(location: from, length: item.start - from)) + item.tag
            from = item.end
        }
        return ImageConversion(start: first.start, end: from, text: converted, caret: (converted as NSString).length - closingTag.count)
    }
}
