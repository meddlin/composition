import Foundation

/// One entry of a completion list: a component, a prop, a value or a snippet (the desktop's `MdxCompletion`).
public struct EditorCompletion: Equatable, Sendable {
    public var name: String
    /// How the list shows it, when that isn't `<name>` (a prop or a value, rather than a component).
    public var label: String?
    /// One line shown under the name in the list.
    public var description: String
    /// What replaces the `<` and whatever was typed after it; `$0` marks where the caret lands.
    public var template: String

    public init(name: String, label: String? = nil, description: String, template: String) {
        (self.name, self.label, self.description, self.template) = (name, label, description, template)
    }
}

/// What the editor offers after a `<`, one entry per allowed component: a port of `completions.ts`.
public enum MdxCompletions {
    /// In the desktop's order, which is the order the list shows them in.
    public static let all: [EditorCompletion] = [
        EditorCompletion(name: "Info", description: "Callout for background a reader should notice", template: "<Info>\n\n$0\n\n</Info>"),
        EditorCompletion(name: "Warning", description: "Callout for something to be careful about", template: "<Warning>\n\n$0\n\n</Warning>"),
        EditorCompletion(name: "Image", description: "An image, same as ![alt](src)", template: "<Image src=\"$0\" alt=\"\" />"),
        EditorCompletion(name: "Drawio", description: "A draw.io diagram you can edit from the preview (Ctrl/Cmd+Shift+D draws a new one)", template: "<Drawio src=\"$0\" alt=\"\" />"),
        EditorCompletion(name: "Toc", description: "Table of contents that follows the note's headings", template: "<Toc />$0"),
        EditorCompletion(name: "Mark", description: "Highlighted text, in a colour", template: "<Mark color=\"yellow\">$0</Mark>"),
        EditorCompletion(name: "Footnotes", description: "Footnotes list, numbered by where they are cited", template: "<Footnotes />$0"),
        EditorCompletion(name: "YouTube", description: "A YouTube video you can watch in the preview", template: "<YouTube url=\"$0\" />"),
        EditorCompletion(name: "Repo", description: "A card linking to a git repository (GitHub, GitLab, …)", template: "<Repo url=\"$0\" />"),
        EditorCompletion(name: "Chart", description: "A bar, line, area or pie chart of a CSV table written inside the tag", template: "<Chart type=\"bar\">\n\n```csv\n$0\n```\n\n</Chart>"),
        EditorCompletion(name: "Sheet", description: "A spreadsheet-style grid of a CSV table written inside the tag", template: "<Sheet>\n\n```csv\n$0\n```\n\n</Sheet>"),
    ]

    public struct Trigger: Equatable, Sendable {
        /// Where the `<` is.
        public var start: Int
        /// What has been typed after it.
        public var query: String
    }

    // A `<` that starts a tag: not glued to a word (`a<b`) and not part of `<<`.
    private static let openTag = try! NSRegularExpression(pattern: "(?:^|[^A-Za-z0-9_<])<([A-Za-z]*)\\z")

    /// The `<` the caret is just after, if the user is starting a tag there. Nothing is offered inside a fenced code block, where `<` is just text.
    public static func findTrigger(_ text: String, caret: Int) -> Trigger? {
        let source = text as NSString
        let lineStart = JS.lineStart(source, caret: caret)
        let line = JS.slice(source, lineStart, caret)
        guard let match = openTag.firstWholeMatch(in: line), let query = match.string(1, in: line as NSString) else { return nil }
        if MarkdownImages.insideFence(source, lineStart: lineStart) { return nil }
        return Trigger(start: caret - (query as NSString).length - 1, query: query)
    }

    /// The components whose name starts with what was typed, ignoring case.
    public static func match(_ query: String) -> [EditorCompletion] {
        let typed = query.lowercased()
        return all.filter { $0.name.lowercased().hasPrefix(typed) }
    }

    /// The text to insert for a completion, and the caret's offset within it (-1 when the template has no `$0`).
    public static func expand(_ completion: EditorCompletion) -> (text: String, caret: Int) {
        let template = completion.template as NSString
        let marker = template.range(of: "$0")
        guard marker.location != NSNotFound else { return (completion.template, -1) }
        return (template.replacingCharacters(in: marker, with: ""), marker.location)
    }
}

/// What a list is offered for at the caret: the text it replaces and the choices (the desktop's `PropTarget`).
public struct CompletionTarget: Equatable, Sendable {
    /// The text the choice replaces, and what has been typed of it.
    public var start: Int
    public var end: Int
    public var query: String
    public var items: [EditorCompletion]
    /// What the list is called for assistive technology.
    public var label: String
}
