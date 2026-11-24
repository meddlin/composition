import Foundation

/// Where an in-note address (`#id`) points in a note's text: the desktop's `fragmentOffset` (apps/web/src/components/notes/noteLinkActions.ts), for the ids
/// remark-gfm gives a footnote, `fn-label` (its definition) and `fnref-label` (its first citation), with or without the `user-content-` it puts in front.
/// The Live tab follows a citation to its definition and a footnote list's ↩ back to the citation through it (Gate LD7, docs/manual-tests/ipad.md item 364).
/// A heading's slug (`#next-steps`) is not ported: the iPad's `<Toc />` goes to a heading by its number among the note's headings (`NoteOutline`).
public enum NoteFragments {
    /// Where `id` (without its `#`) points in `text` (a note's whole stored text, frontmatter and all), in UTF-16 units; nil when nothing in the note has it.
    /// Only text after the frontmatter is searched, as the desktop searches from the body's start.
    public static func offset(of id: String, in text: String) -> Int? {
        let wanted = id.removingPercentEncoding ?? id
        guard let footnote = footnoteID(wanted) else { return nil }
        let whole = text as NSString
        let body = NoteFrontmatter.split(text).body
        let start = text.hasSuffix(body) ? whole.length - (body as NSString).length : 0
        let at = footnote.isReference ? reference(footnote.label, in: whole, from: start) : definition(footnote.label, in: whole, from: start)
        return at
    }

    /// The id of a footnote's definition, as remark-gfm writes it.
    public static func definitionID(_ label: String) -> String { "fn-\(label)" }
    /// The id of a footnote's first citation, as remark-gfm writes it.
    public static func referenceID(_ label: String) -> String { "fnref-\(label)" }

    /// The label of the footnote numbered `number` in `text` (a whole note), as the Preview numbers them (in the order first cited); nil when there is none.
    public static func footnoteLabel(number: Int, in text: String) -> String? {
        let labels = NoteScanner.scan(NoteFrontmatter.split(text).body).footnotes
        return number >= 1 && number <= labels.count ? labels[number - 1] : nil
    }

    /// The label of a citation as written, `[^label]`; nil when `source` is not one.
    public static func citationLabel(_ source: String) -> String? {
        guard source.hasPrefix("[^"), source.hasSuffix("]"), source.count > 3 else { return nil }
        return String(source.dropFirst(2).dropLast())
    }

    /// `fn-1`, `fnref-1` and `user-content-fn-1`, as the desktop's `FOOTNOTE_ID` reads them.
    private static func footnoteID(_ id: String) -> (isReference: Bool, label: String)? {
        var rest = Substring(id)
        if rest.hasPrefix("user-content-") { rest = rest.dropFirst("user-content-".count) }
        guard rest.hasPrefix("fn") else { return nil }
        rest = rest.dropFirst(2)
        let isReference = rest.hasPrefix("ref-")
        if isReference { rest = rest.dropFirst(3) }
        guard rest.hasPrefix("-"), rest.count > 1 else { return nil }
        return (isReference, String(rest.dropFirst()))
    }

    /// Where `[^label]:` starts a line (after up to three spaces), from `from` on.
    private static func definition(_ label: String, in text: NSString, from: Int) -> Int? {
        let mark = "[^\(label)]:"
        var search = NSRange(location: from, length: text.length - from)
        while search.length > 0 {
            let found = text.range(of: mark, options: .literal, range: search)
            guard found.location != NSNotFound else { return nil }
            let lineStart = text.lineRange(for: NSRange(location: found.location, length: 0)).location
            if found.location - lineStart <= 3, text.substring(with: NSRange(location: lineStart, length: found.location - lineStart)).trimmingCharacters(in: .whitespaces).isEmpty {
                return found.location
            }
            search = NSRange(location: found.location + 1, length: text.length - found.location - 1)
        }
        return nil
    }

    /// Where the first `[^label]` that is not a definition is, from `from` on.
    private static func reference(_ label: String, in text: NSString, from: Int) -> Int? {
        let mark = "[^\(label)]"
        let length = (mark as NSString).length
        var search = NSRange(location: from, length: text.length - from)
        while search.length > 0 {
            let found = text.range(of: mark, options: .literal, range: search)
            guard found.location != NSNotFound else { return nil }
            let after = found.location + length
            if after >= text.length || text.character(at: after) != 0x3A { return found.location }  // not followed by `:`
            search = NSRange(location: found.location + 1, length: text.length - found.location - 1)
        }
        return nil
    }
}
