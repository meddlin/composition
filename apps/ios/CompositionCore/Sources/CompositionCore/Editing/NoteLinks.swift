import Foundation

/// Links from one note to another, written as `[title](note:id)`: a port of `noteRefs.ts` and `noteLinks.ts`.
public enum NoteLinks {
    /// How many notes the picker lists at once.
    public static let maxPickerNotes = 8

    /// The scheme in a link's target.
    public static let scheme = "note:"

    public struct Trigger: Equatable, Sendable {
        /// Where the `[[` is.
        public var start: Int
        /// What has been typed after it.
        public var query: String
    }

    /// The Markdown target for a note's id.
    public static func ref(_ id: Int64) -> String { "\(scheme)\(id)" }

    private static let target = try! NSRegularExpression(pattern: "^note:([0-9]+)\\z")

    /// The note id a link target refers to, or nil when it isn't a note link.
    public static func id(fromRef href: String) -> Int64? {
        guard let match = target.firstWholeMatch(in: href), let digits = match.string(1, in: href as NSString) else { return nil }
        guard let id = Int64(digits), id <= 9_007_199_254_740_991 else { return nil }  // a JavaScript safe integer
        return id
    }

    private static let lineBreaks = try! NSRegularExpression(pattern: "\\s*[\\r\\n]+\\s*")

    /// Link text is bracketed, so a bracket or backslash in it has to be escaped; a line break would split the link.
    private static func escapeLinkText(_ text: String) -> String {
        let joined = lineBreaks.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: " ")
        var out = ""
        for character in joined.unicodeScalars {
            if character == "\\" || character == "[" || character == "]" { out.append("\\") }
            out.unicodeScalars.append(character)
        }
        return out
    }

    /// `[label](note:id)`, ready to put into a note.
    public static func link(label: String, id: Int64) -> String {
        let trimmed = JavaScriptText.trim(label)
        return "[\(escapeLinkText(trimmed.isEmpty ? "Untitled" : trimmed))](\(ref(id)))"
    }

    // `[[` and what follows it up to the caret, with no bracket or line break in between.
    private static let openLink = try! NSRegularExpression(pattern: "\\[\\[([^\\[\\]\\n]*)\\z")

    /// The `[[` the caret is just after, if the user is starting a note link there. Nothing is offered inside a fenced code block.
    public static func findTrigger(_ text: String, caret: Int) -> Trigger? {
        let source = text as NSString
        let lineStart = JS.lineStart(source, caret: caret)
        let line = JS.slice(source, lineStart, caret)
        guard let match = openLink.firstWholeMatch(in: line), let query = match.string(1, in: line as NSString), !MarkdownImages.insideFence(source, lineStart: lineStart) else { return nil }
        return Trigger(start: caret - (query as NSString).length - 2, query: query)
    }

    /// A note to offer: its id and title (an empty title reads as "Untitled").
    public struct Candidate: Equatable, Sendable {
        public var id: Int64
        public var title: String
        public init(id: Int64, title: String) { (self.id, self.title) = (id, title) }
        var shownTitle: String { let trimmed = JavaScriptText.trim(title); return trimmed.isEmpty ? "Untitled" : trimmed }
    }

    /// The notes the picker offers for what was typed: those whose title contains it (ignoring case), the ones that start with it first. `excluding` is
    /// the note being edited, which there is no point linking to.
    public static func match(_ notes: [Candidate], query: String, excluding: Int64? = nil) -> [Candidate] {
        let typed = JavaScriptText.trim(query).lowercased()
        var starts: [Candidate] = [], contains: [Candidate] = []
        for note in notes where note.id != excluding {
            let title = note.shownTitle.lowercased()
            // `title.indexOf("")` is 0, so with nothing typed every note starts with it.
            let at = typed.isEmpty ? 0 : (title as NSString).range(of: typed).location
            if at == 0 { starts.append(note) } else if at != NSNotFound { contains.append(note) }
        }
        return Array((starts + contains).prefix(maxPickerNotes))
    }

    /// The Markdown to insert for a note; `label` is the words the link should show, the note's title when absent.
    public static func link(to note: Candidate, label: String? = nil) -> String {
        let words = label.map(JavaScriptText.trim) ?? ""
        return link(label: words.isEmpty ? note.shownTitle : words, id: note.id)
    }
}
