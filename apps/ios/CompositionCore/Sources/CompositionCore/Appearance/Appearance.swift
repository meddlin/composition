import Foundation

/// Which scheme the iPad wears: one of the desktop's five, or **System**, which follows the iPad's light and dark (build plan Step 10).
public enum SchemeChoice: Equatable, Sendable {
    case system
    case theme(String)
}

/// The type families the iPad offers for the editor and the preview. They are the system's own (SF, New York and SF Mono), so nothing is
/// bundled; the desktop's open-source families (Geist, Lora …) are not here.
public enum FontFamily: String, CaseIterable, Sendable {
    case sans
    case serif
    case mono

    public var label: String {
        switch self {
        case .sans: "Sans serif"
        case .serif: "Serif"
        case .mono: "Monospaced"
        }
    }

    /// The editor opens in a monospaced face (as the desktop's does), the preview in a sans serif one.
    public static let editorDefault = FontFamily.mono
    public static let previewDefault = FontFamily.sans
}

/// How the app looks, as `settings.json` holds it.
public struct Appearance: Equatable, Sendable {
    public var scheme: SchemeChoice
    public var editorFont: FontFamily
    public var previewFont: FontFamily

    public init(scheme: SchemeChoice = .system, editorFont: FontFamily = .editorDefault, previewFont: FontFamily = .previewDefault) {
        (self.scheme, self.editorFont, self.previewFont) = (scheme, editorFont, previewFont)
    }

    /// The five schemes the iPad can wear by name (the desktop's, without "Follow the sun").
    public static let themeNames = ["dark", "light", "forest", "wine", "cream"]
}

extension SettingsStore {
    // The desktop's `theme` is the scheme it knows; these three are the iPad's own, which the desktop keeps and ignores.
    static let followSystemKey = "followSystem"
    static let editorFontKey = "iosEditorFont"
    static let previewFontKey = "iosPreviewFont"

    public func appearance() -> Appearance { locked { Self.parseAppearance($0) } }

    /// The scheme is the desktop's `theme` (so a backup restored there looks the same) unless the iPad was told to follow the system, which the
    /// desktop has no name for: `followSystem` says so and leaves `theme` alone. With neither in the file (a fresh install) it is System; a
    /// desktop `auto` ("Follow the sun") is not built, and also reads as System.
    static func parseAppearance(_ object: [String: Any]) -> Appearance {
        var scheme = SchemeChoice.system
        let follows = (object[followSystemKey] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? $0.boolValue : nil }
        if follows != true, let name = object["theme"] as? String, Appearance.themeNames.contains(name) { scheme = .theme(name) }
        let editor = (object[editorFontKey] as? String).flatMap(FontFamily.init(rawValue:)) ?? .editorDefault
        let preview = (object[previewFontKey] as? String).flatMap(FontFamily.init(rawValue:)) ?? .previewDefault
        return Appearance(scheme: scheme, editorFont: editor, previewFont: preview)
    }

    /// A named scheme sets the desktop's `theme`; System sets only `followSystem`, so a desktop that reads the file keeps the scheme it had.
    public func setScheme(_ choice: SchemeChoice) throws {
        switch choice {
        case .system:
            try edit { $0[Self.followSystemKey] = true }
        case .theme(let name):
            guard Appearance.themeNames.contains(name) else { throw SettingsError.unknownTheme(name) }
            try edit {
                $0["theme"] = name
                $0[Self.followSystemKey] = false
            }
        }
    }

    public func setEditorFont(_ family: FontFamily) throws { try edit { $0[Self.editorFontKey] = family.rawValue } }

    public func setPreviewFont(_ family: FontFamily) throws { try edit { $0[Self.previewFontKey] = family.rawValue } }
}
