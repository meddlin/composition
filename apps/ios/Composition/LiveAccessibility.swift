import UIKit

/// What the Live tab's text view tells VoiceOver (docs/ipad-live-view-plan.md, step L6). The marks the Live look hides are only invisible: the text view's accessibility value
/// is its text, so unless something is done VoiceOver has `**` and `# ` to read. Two fixes were tried in the Editor lab (the Simulator has no VoiceOver, so what VoiceOver
/// does with them is for the iPad to say, manual-test items 100 to 103); the default is the one that keeps the text view's own offsets, and the other stays behind the lab's
/// switch (*Hide syntax ▸ VoiceOver*) for the Live tab as well, in case the first does not silence the marks.
enum LiveAccessibility {
    enum Mode: String, CaseIterable, Identifiable {
        /// The value is the text as it is, hidden marks included.
        case asItIs
        /// Candidate A: the value is the text without the hidden marks. VoiceOver's character and word navigation and its announcements of a selection are in the text input's
        /// offsets, which this makes 25 characters short in a note of the lab's size, so they may disagree with what is drawn.
        case withoutMarks
        /// Candidate B, the default: the value is the whole text, so offsets are the text view's, and the hidden marks are marked "speak no punctuation"
        /// (`UIAccessibilitySpeechAttributePunctuation = false`); a heading's line carries its level (`UIAccessibilityTextAttributeHeadingLevel`), for the rotor's Headings.
        case silentMarks

        var id: String { rawValue }

        var title: String {
            switch self {
            case .asItIs: "VoiceOver: as it is"
            case .withoutMarks: "VoiceOver: value without the marks"
            case .silentMarks: "VoiceOver: marks silent, headings marked"
            }
        }
    }

    private static let key = "liveAccessibility"

    /// The way in force, for the Live tab and the Editor lab alike. The lab's switch sets it and it is kept; `-liveAccessibility asItIs|withoutMarks|silentMarks` sets it at launch.
    static var mode: Mode {
        get { UserDefaults.standard.string(forKey: key).flatMap(Mode.init(rawValue:)) ?? .silentMarks }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: key) }
    }

    /// The runs the Live look has hidden: characters in the tiny font, which nothing else uses.
    static func hiddenRuns(in text: NSAttributedString) -> [NSRange] {
        var runs: [NSRange] = []
        text.enumerateAttribute(.font, in: NSRange(location: 0, length: text.length)) { value, range, _ in
            if let font = value as? UIFont, LiveOverlay.isHidden(font) { runs.append(range) }
        }
        return runs
    }

    /// The accessibility value `mode` makes of `text`, or nil for `asItIs` (the text view's own). `headingLevel` says which level, if any, a run of the text carries: the Live tab marks
    /// a heading's line with `.liveHeading`.
    static func value(of text: NSAttributedString, mode: Mode, headingLevel: (NSRange, [NSAttributedString.Key: Any]) -> Int? = { _, attributes in attributes[.liveHeading] as? Int }) -> NSAttributedString? {
        switch mode {
        case .asItIs:
            return nil
        case .withoutMarks:
            let result = NSMutableAttributedString(attributedString: text)
            for run in hiddenRuns(in: text).reversed() { result.deleteCharacters(in: run) }
            return result
        case .silentMarks:
            // The text with its own attributes, as the text view's own value has them (the fonts among them, which the accessibility audit reads to see that the text grows with
            // Dynamic Type), and the two more.
            let result = NSMutableAttributedString(attributedString: text)
            for run in hiddenRuns(in: text) { result.addAttribute(.accessibilitySpeechPunctuation, value: false, range: run) }
            text.enumerateAttributes(in: NSRange(location: 0, length: text.length)) { attributes, range, _ in
                if let level = headingLevel(range, attributes) { result.addAttribute(.accessibilityTextHeadingLevel, value: level, range: range) }
            }
            return result
        }
    }
}

extension NSAttributedString.Key {
    /// The level (1 to 6) of the heading whose line this is, put on the text by the Live look so that the accessibility value can say it (`LiveAccessibility`).
    static let liveHeading = NSAttributedString.Key("liveHeading")
}
