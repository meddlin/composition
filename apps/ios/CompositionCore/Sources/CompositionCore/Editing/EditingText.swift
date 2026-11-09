import Foundation

// Build plan Step 9: the typing aids. Their rules are the desktop's (`completions.ts`, `props.ts`, `snippets.ts`, `indentLines.ts`, `emphasis.ts`,
// `noteLinks.ts`), written to give the same answer for every text and caret; ConformanceTests-style checks hold them against the real functions
// (EditingConformanceTests). Offsets are UTF-16 units, as in the desktop's JavaScript and in `NSRange`.

/// The few JavaScript string behaviours the ports lean on, so that an offset means the same on both sides.
enum JS {
    /// `text.slice(start, end)`: both ends clamped, and empty when `start >= end`.
    static func slice(_ text: NSString, _ start: Int, _ end: Int? = nil) -> String {
        let length = text.length
        func clamp(_ value: Int) -> Int { value < 0 ? max(length + value, 0) : min(value, length) }
        let from = clamp(start)
        let to = end.map(clamp) ?? length
        return from >= to ? "" : text.substring(with: NSRange(location: from, length: to - from))
    }

    /// `text.lastIndexOf(search, from)` for a single UTF-16 unit: the last index at or before `from` (a negative `from` is 0), or -1.
    static func lastIndex(of unit: unichar, in text: NSString, from: Int) -> Int {
        var index = min(max(from, 0), text.length - 1)
        while index >= 0 {
            if text.character(at: index) == unit { return index }
            index -= 1
        }
        return -1
    }

    /// `text.indexOf(search, from)` for a single UTF-16 unit.
    static func index(of unit: unichar, in text: NSString, from: Int = 0) -> Int {
        var index = max(from, 0)
        while index < text.length {
            if text.character(at: index) == unit { return index }
            index += 1
        }
        return -1
    }

    /// Where the line a caret is on starts: `text.lastIndexOf("\n", caret - 1) + 1`.
    static func lineStart(_ text: NSString, caret: Int) -> Int { lastIndex(of: 0x0A, in: text, from: caret - 1) + 1 }

    static func isWordUnit(_ unit: unichar) -> Bool {
        (unit >= 0x30 && unit <= 0x39) || (unit >= 0x41 && unit <= 0x5A) || (unit >= 0x61 && unit <= 0x7A) || unit == 0x5F
    }
}

extension NSRegularExpression {
    /// The first match of a pattern in the whole of `text`.
    func firstWholeMatch(in text: String) -> NSTextCheckingResult? {
        firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    }
}

extension NSTextCheckingResult {
    func string(_ group: Int, in text: NSString) -> String? {
        let range = self.range(at: group)
        return range.location == NSNotFound ? nil : text.substring(with: range)
    }
}
