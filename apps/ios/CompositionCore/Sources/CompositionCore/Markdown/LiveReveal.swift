import Foundation

// The Live tab hides a note's syntax marks (`#`, `**`, backticks, `>`) except where the caret is (docs/ipad-app-design.md, C12). Where "where the
// caret is" ends is this rule: for most syntax it is the caret's own line; for a fenced code block it is the whole block.

public enum LiveReveal {
    /// The range whose marks stay showing for a caret on `line` (the line's range, as `NSString.paragraphRange` gives it, with a caret anywhere in
    /// it): that line, or, when the line is part of a code block, the whole block. Both of its fences then show while the caret is anywhere in
    /// it, so it is plain that the caret is inside a block; with only the fence on the caret's own line shown (the first prototype), moving into
    /// a block showed one fence and hid the other, and nothing said you had entered a block (found on the iPad, 2026-11-08).
    ///
    /// `spans` are the note's highlight spans (`MarkdownHighlighter.spans`), or at least those of the blocks around `line`.
    public static func range(forLine line: NSRange, spans: [HighlightSpan]) -> NSRange {
        var reveal = line
        for span in spans where span.kind == .codeBlock && NSIntersectionRange(span.range, line).length > 0 {
            reveal = NSUnionRange(reveal, span.range)
        }
        return reveal
    }
}
