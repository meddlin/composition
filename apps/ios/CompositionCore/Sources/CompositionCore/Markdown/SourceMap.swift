import Foundation
import Markdown

/// Where things are in a note's text. swift-markdown reports a line and a UTF-8 column; everything built on it (the highlighter, the Live model) wants
/// UTF-16 units, which is what a text view counts in.
struct SourceMap {
    /// The text as UTF-16 units.
    let chars: [UInt16]
    /// Where each line starts, in UTF-8 bytes.
    private var lineStarts: [Int] = [0]
    private let utf8Count: Int
    /// UTF-8 byte offset to UTF-16 offset, or nil when the text is ASCII (they are then the same).
    private var utf16At: [Int32]?

    init(text: String) {
        let utf8 = Array(text.utf8)
        utf8Count = utf8.count
        chars = Array(text.utf16)
        for (index, byte) in utf8.enumerated() where byte == 0x0A { lineStarts.append(index + 1) }
        if utf8.count != text.utf16.count {
            var map = [Int32](repeating: 0, count: utf8.count + 1)
            var u8 = 0, u16 = 0
            for scalar in text.unicodeScalars {
                let value = scalar.value
                let width8 = value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4, width16 = value > 0xFFFF ? 2 : 1
                for step in 0..<width8 { map[u8 + step] = Int32(u16) }
                u8 += width8
                u16 += width16
            }
            map[utf8.count] = Int32(u16)
            utf16At = map
        }
    }

    func offset(_ location: SourceLocation) -> Int {
        let line = max(location.line - 1, 0)
        let byte = min((line < lineStarts.count ? lineStarts[line] : utf8Count) + max(location.column - 1, 0), utf8Count)
        return utf16At.map { Int($0[byte]) } ?? byte
    }

    func range(of markup: any Markup) -> Range<Int>? {
        guard let source = markup.range else { return nil }
        let start = offset(source.lowerBound), end = offset(source.upperBound)
        return start <= end ? start..<end : nil
    }
}
