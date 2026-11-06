import Foundation

/// The YAML block at the top of a note (`---`, then `key: value` lines, then `---`), split from the body the preview draws.
///
/// The desktop's `parse` (frontmatter.ts) also reads the block with a YAML parser, and treats the note as having no frontmatter when
/// the block is not a YAML mapping. There is no YAML parser here, so this accepts a block whose every unindented line is a `key:`
/// line, a list item or a comment. A block of some other shape that YAML would still read as a mapping is the one case that
/// differs; it is not covered by the conformance notes.
public enum NoteFrontmatter {
    private static let block = try! NSRegularExpression(pattern: "^---\\r?\\n([\\s\\S]*?)\\r?\\n---[ \\t]*\\r?\\n?")
    private static let keyLine = try! NSRegularExpression(pattern: "^[A-Za-z0-9_\"'][^:]*:(\\s.*)?$")

    /// The frontmatter's text (without the dashes) and the body after it; nil and the whole text when there is none.
    public static func split(_ content: String) -> (frontmatter: String?, body: String) {
        let whole = NSRange(content.startIndex..., in: content)
        guard let match = block.firstMatch(in: content, range: whole), let inner = Range(match.range(at: 1), in: content),
            let all = Range(match.range, in: content), looksLikeMapping(String(content[inner]))
        else { return (nil, content) }
        return (String(content[inner]), String(content[all.upperBound...]))
    }

    private static func looksLikeMapping(_ yaml: String) -> Bool {
        var sawKey = false
        for line in yaml.split(separator: "\n", omittingEmptySubsequences: true) {
            let text = line.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
            if text.isEmpty || text.first == " " || text.first == "\t" || text.first == "#" || text.hasPrefix("- ") { continue }
            guard keyLine.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil else { return false }
            sawKey = true
        }
        return sawKey
    }
}
