import Foundation

// How the Markdown editor helps with the shape of the text: the ruler (a vertical guide at a column), reflow (a line that grows past its column is broken as it
// is typed), the word count and the heading rail. The desktop keeps them as the `writing` object of `settings.json`; this reads and writes the same one
// (`parseWritingSettings` and `validateWritingSettings` in `writing.ts`, checked by `ReflowConformanceTests`). Reflow and the ruler are off until switched on.

public enum HeadingRailSide: String, CaseIterable, Sendable {
    case left
    case right
}

public struct WritingSettings: Equatable, Sendable {
    public static let minColumn = 20
    public static let maxColumn = 200
    public static let defaultColumn = 80

    /// Draw a vertical guide line at `rulerColumn`.
    public var rulerEnabled = false
    public var rulerColumn = defaultColumn
    /// Break lines at `reflowColumn` as they are typed.
    public var reflowEnabled = false
    public var reflowColumn = defaultColumn
    /// Keep Markdown tables intact: a table row has to stay on one line to stay a table, so with this on reflow leaves table rows alone.
    public var reflowKeepsTables = true
    /// Show a live word count for the active note.
    public var wordCountEnabled = false
    /// A rail of ticks beside the text, one per heading. A look rather than a writing aid, so it is on unless switched off.
    public var headingRailEnabled = true
    public var headingRailSide = HeadingRailSide.left

    public init() {}

    /// What reflow does with a line, as the options `ReflowText` takes.
    public var reflowOptions: ReflowOptions { ReflowOptions(column: reflowColumn, keepTables: reflowKeepsTables) }

    /// `isWritingColumn`: a whole number of columns the editor can use.
    public static func isColumn(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
        let double = number.doubleValue
        return double.isFinite && double == double.rounded(.towardZero) && double >= Double(minColumn) && double <= Double(maxColumn)
    }

    private static func column(_ value: Any?) -> Int { isColumn(value) ? Int((value as! NSNumber).doubleValue) : defaultColumn }

    private static func flag(_ value: Any?, _ fallback: Bool) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return fallback }
        return number.boolValue
    }

    /// `parseWritingSettings`: whatever came off disk, with the default for anything missing or invalid.
    public static func parse(_ data: Any?) -> WritingSettings {
        let object = data as? [String: Any] ?? [:]
        var settings = WritingSettings()
        settings.rulerEnabled = flag(object["rulerEnabled"], settings.rulerEnabled)
        settings.rulerColumn = column(object["rulerColumn"])
        settings.reflowEnabled = flag(object["reflowEnabled"], settings.reflowEnabled)
        settings.reflowColumn = column(object["reflowColumn"])
        settings.reflowKeepsTables = flag(object["reflowKeepsTables"], settings.reflowKeepsTables)
        settings.wordCountEnabled = flag(object["wordCountEnabled"], settings.wordCountEnabled)
        settings.headingRailEnabled = flag(object["headingRailEnabled"], settings.headingRailEnabled)
        settings.headingRailSide = (object["headingRailSide"] as? String).flatMap(HeadingRailSide.init(rawValue:)) ?? settings.headingRailSide
        return settings
    }

    public enum Validation: Equatable, Sendable {
        case valid(WritingSettings)
        case invalid(String)
    }

    /// `validateWritingSettings`: settings that arrive from the screen. Unlike `parse` it refuses rather than repairs: a column of 5 is an error to show,
    /// not a quiet 80.
    public static func validate(_ data: Any?) -> Validation {
        let object = data as? [String: Any] ?? [:]
        for key in ["rulerEnabled", "reflowEnabled", "reflowKeepsTables", "wordCountEnabled", "headingRailEnabled"] {
            guard let number = object[key] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return .invalid("Unknown writing setting.") }
        }
        guard let side = object["headingRailSide"] as? String, HeadingRailSide(rawValue: side) != nil else { return .invalid("Unknown writing setting.") }
        for key in ["rulerColumn", "reflowColumn"] where !isColumn(object[key]) {
            return .invalid("Use a whole number of characters from \(minColumn) to \(maxColumn).")
        }
        return .valid(parse(object))
    }

    /// The object `settings.json` holds, for the keys this type owns.
    var jsonObject: [String: Any] {
        [
            "rulerEnabled": rulerEnabled, "rulerColumn": rulerColumn, "reflowEnabled": reflowEnabled, "reflowColumn": reflowColumn,
            "reflowKeepsTables": reflowKeepsTables, "wordCountEnabled": wordCountEnabled, "headingRailEnabled": headingRailEnabled,
            "headingRailSide": headingRailSide.rawValue,
        ]
    }
}

extension SettingsStore {
    /// The writing aids, as the file has them (the default for a file with none).
    public func writing() -> WritingSettings { locked { WritingSettings.parse($0["writing"]) } }

    /// Keeps the writing aids in the file's `writing` object, leaving any other key that object holds, and every other key of the file, as it was.
    public func setWriting(_ settings: WritingSettings) throws {
        try edit {
            var object = $0["writing"] as? [String: Any] ?? [:]
            object.merge(settings.jsonObject) { _, new in new }
            $0["writing"] = object
        }
    }
}
