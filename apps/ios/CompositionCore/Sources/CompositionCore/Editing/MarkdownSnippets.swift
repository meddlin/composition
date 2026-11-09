import Foundation

/// Pre-formatted Markdown offered after a `/`: a port of `snippets.ts`. `$0` marks where the caret lands.
public enum MarkdownSnippets {
    private struct Snippet { let name: String, description: String, template: String }

    private static let all = [
        Snippet(name: "table", description: "A 3-column table with a header and two rows", template: "| $0Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n"),
        Snippet(name: "codeblock", description: "A fenced code block", template: "```\n$0\n```\n"),
        Snippet(name: "tasks", description: "A task list", template: "- [ ] $0\n- [ ] \n- [ ] \n"),
        Snippet(name: "divider", description: "A horizontal rule", template: "---\n\n$0"),
    ]

    // A `/` at the start of a line or after white space, with letters typed after it.
    private static let slash = try! NSRegularExpression(pattern: "(?:^|\\s)/([A-Za-z]*)\\z")

    /// What to offer when the caret is just after a `/` that starts a word: the snippets whose name starts with what was typed. Nil anywhere else:
    /// inside a word like `and/or`, or in a fenced code block.
    public static func findTarget(_ text: String, caret: Int) -> CompletionTarget? {
        let source = text as NSString
        let lineStart = JS.lineStart(source, caret: caret)
        let line = JS.slice(source, lineStart, caret)
        guard let match = slash.firstWholeMatch(in: line), let query = match.string(1, in: line as NSString), !MarkdownImages.insideFence(source, lineStart: lineStart) else { return nil }
        let typed = query.lowercased()
        let items = all.filter { $0.name.hasPrefix(typed) }.map { EditorCompletion(name: $0.name, label: "/\($0.name)", description: $0.description, template: $0.template) }
        return CompletionTarget(start: caret - (query as NSString).length - 1, end: caret, query: query, items: items, label: "Markdown snippets")
    }
}
