import Foundation

/// The properties a note's frontmatter understands, offered on an empty line of its block: a port of `frontmatterProps.ts`.
public enum FrontmatterCompletions {
    private struct Property { let name: String, description: String, template: String }

    /// None is required; the list only offers what's missing.
    private static let properties = [
        Property(name: "title", description: "The note's title", template: "title: $0"),
        Property(name: "description", description: "A one-line summary of the note", template: "description: $0"),
        Property(name: "tags", description: "Labels for finding the note, e.g. [work, ideas]", template: "tags: [$0]"),
        Property(name: "createdAt", description: "The day the note was made (YYYY-MM-DD)", template: "createdAt: $0"),
        Property(name: "updatedAt", description: "The day the note last changed (YYYY-MM-DD)", template: "updatedAt: $0"),
        Property(name: "headerImage", description: "Picture above the title: app_data/… or a web address", template: "headerImage: $0"),
        Property(name: "headerImageLayout", description: "full, or centered at its own size", template: "headerImageLayout: $0"),
    ]

    private static let opening = try! NSRegularExpression(pattern: "^---\\r?\\n")
    private static let closing = try! NSRegularExpression(pattern: "\\r?\\n---[ \\t]*(?:\\r?\\n|\\z)")
    private static let key = try! NSRegularExpression(pattern: "^([A-Za-z][A-Za-z0-9_-]*)[ \\t]*:")
    private static let letters = try! NSRegularExpression(pattern: "^[A-Za-z]*\\z")

    /// What to offer when the caret is on an otherwise empty line of the note's frontmatter block, or part-way through typing a property name there:
    /// the known properties the block doesn't have yet. Nil anywhere else.
    public static func findTarget(_ text: String, caret: Int) -> CompletionTarget? {
        let source = text as NSString
        guard let open = opening.firstWholeMatch(in: text), caret >= open.range.length else { return nil }
        // The search starts on the opening line's own line break, which the closing line may share.
        let from = open.range.length - 1
        guard let close = closing.firstMatch(in: text, range: NSRange(location: from, length: source.length - from)) else { return nil }
        // An unfinished block isn't frontmatter yet, and the closing line itself isn't inside it.
        if caret > close.range.location { return nil }

        let lineStart = JS.lineStart(source, caret: caret)
        let found = JS.index(of: 0x0A, in: source, from: caret)
        let lineEnd = found == -1 ? source.length : found
        let query = JS.slice(source, lineStart, caret)
        if letters.firstWholeMatch(in: query) == nil || !JavaScriptText.trim(JS.slice(source, caret, lineEnd)).isEmpty { return nil }

        let block = JS.slice(source, open.range.length, close.range.location) as NSString
        var present = Set<String>()
        var offset = open.range.length
        var start = 0
        while start <= block.length {
            let newline = JS.index(of: 0x0A, in: block, from: start)
            let end = newline == -1 ? block.length : newline
            let line = block.substring(with: NSRange(location: start, length: end - start))
            if offset != lineStart, let match = key.firstWholeMatch(in: line), let name = match.string(1, in: line as NSString) { present.insert(name) }
            offset += (line as NSString).length + 1
            if newline == -1 { break }
            start = newline + 1
        }

        let typed = query.lowercased()
        let items = properties.filter { !present.contains($0.name) && $0.name.lowercased().hasPrefix(typed) }
            .map { EditorCompletion(name: $0.name, label: $0.name, description: $0.description, template: $0.template) }
        return CompletionTarget(start: lineStart, end: caret, query: query, items: items, label: "Frontmatter properties")
    }
}

public extension MdxCompletions {
    /// What the list offers at the caret, in the desktop's order: components after a `<`, else the props and values inside a component's tag, else
    /// the frontmatter's properties, else the Markdown snippets after a `/` (`useMdxCompletion.ts`'s `findTarget`).
    static func target(_ text: String, caret: Int) -> CompletionTarget? {
        if let tag = findTrigger(text, caret: caret) {
            return CompletionTarget(start: tag.start, end: caret, query: tag.query, items: match(tag.query), label: "MDX components")
        }
        return MdxProps.findTarget(text, caret: caret) ?? FrontmatterCompletions.findTarget(text, caret: caret) ?? MarkdownSnippets.findTarget(text, caret: caret)
    }
}
