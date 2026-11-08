import Foundation

/// Bold and italic from the keyboard: a port of `emphasis.ts`.
public enum EmphasisToggle: String, Sendable {
    case bold, italic

    /// The `*` characters Markdown reads as bold (two) or italic (one).
    var width: Int { self == .bold ? 2 : 1 }

    /// Makes the selection bold or italic by putting `**` or `*` around it, or takes the emphasis off when the selection already has it (the markers
    /// inside the selection, or hard against its edges). Bold and italic share the same character, so a run of three means both: italic on `**bold**`
    /// makes `***bold***`, and italic again gives `**bold**`. Spaces at the ends of the selection stay outside the markers, since Markdown does not read
    /// `** bold**` as bold. The selection afterwards is the text itself, so the same command undoes what it did. Nil with nothing selected (or only
    /// spaces): there is no text to mark.
    public static func toggle(_ text: String, from: Int, to: Int, _ emphasis: EmphasisToggle) -> LineEdit? {
        let units = Array(text.utf16)
        let lower = min(max(from, 0), units.count), upper = min(max(to, 0), units.count)
        let selected = lower < upper ? String(decoding: units[lower..<upper], as: UTF16.self) : ""
        let trimmed = JavaScriptText.trim(selected)
        if trimmed.isEmpty { return nil }
        let trimmedUnits = Array(trimmed.utf16)
        // `selected.indexOf(trimmed)`: where the trimmed text first sits in the selection.
        let selectedUnits = Array(selected.utf16)
        var offset = 0
        while offset + trimmedUnits.count <= selectedUnits.count, Array(selectedUnits[offset..<(offset + trimmedUnits.count)]) != trimmedUnits { offset += 1 }
        let start = lower + offset
        let end = start + trimmedUnits.count
        let width = emphasis.width

        /// How many `*` run unbroken from `at`, forwards or (with `step` -1) backwards.
        func stars(_ at: Int, _ step: Int) -> Int {
            var count = 0
            var i = step == 1 ? at : at - 1
            while i >= 0, i < units.count, units[i] == 0x2A { count += 1; i += step }
            return count
        }

        // Markers the selection holds itself win over those around it (a selection of nothing but `*` holds none).
        let onlyStars = trimmedUnits.allSatisfy { $0 == 0x2A }
        let inside = onlyStars ? 0 : min(stars(start, 1), stars(end, -1))
        let around = inside > 0 ? 0 : min(stars(start, -1), stars(end, 1))
        let run = inside != 0 ? inside : around
        let has = emphasis == .bold ? run >= 2 : run % 2 == 1

        if !has {
            let mark = String(repeating: "*", count: width)
            return LineEdit(start: start, end: end, text: mark + trimmed + mark, selection: (start + width)..<(end + width))
        }
        if inside > 0 {
            let inner = String(decoding: trimmedUnits[width..<(trimmedUnits.count - width)], as: UTF16.self)
            return LineEdit(start: start, end: end, text: inner, selection: start..<(end - 2 * width))
        }
        return LineEdit(start: start - width, end: end + width, text: trimmed, selection: (start - width)..<(end - width))
    }
}
