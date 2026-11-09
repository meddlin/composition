import CompositionCore
import SwiftUI
import UIKit

/// What every view is drawn with: the colour scheme in force and the two type families chosen (build plan Step 10). Views ask this for a token
/// (`look.surface`, `look.mutedText`), never for a colour of their own, so a scheme restyles them all. The tokens are the desktop's, in `CompositionCore`.
struct Look: Equatable {
    var theme: Theme
    var editorFont: FontFamily
    var previewFont: FontFamily
    /// The system's Increase Contrast: grey text is made darker and the faint lines firmer.
    var increasedContrast = false

    static let standard = Look(theme: .default, editorFont: .editorDefault, previewFont: .previewDefault)

    // MARK: SwiftUI

    var background: Color { theme.background.color }
    var foreground: Color { theme.foreground.color }
    /// Cards, quotes, code blocks and the list column.
    var surface: Color { theme.surface.color }
    /// The sidebar and other chrome that stands apart from the page.
    var panel: Color { theme.panel.color }
    var brand: Color { theme.brand.color }
    var link: Color { theme.link.color }
    var warning: Color { theme.warning.color }
    var success: Color { theme.success.color }
    var error: Color { theme.error.color }
    /// A selected row's fill and its text (`Theme.selection`: the accent, or its dimmer self where white on the accent would not read).
    var selectionFill: Color { theme.selection.fill.color }
    var selectionText: Color { theme.selection.text.color }
    /// The grey text, and the faint fill and line the desktop makes of the foreground (`--muted-foreground`, `--muted`, `--border`).
    /// (Raised above the desktop's 60% where that would read at under 4.5 on the scheme's pages: `Theme.mutedShare`.)
    var mutedText: Color { theme.foreground.color(opacity: theme.mutedShare(increasedContrast: increasedContrast)) }
    var mutedFill: Color { theme.foreground.color(opacity: Theme.Share.muted) }
    var border: Color { theme.foreground.color(opacity: increasedContrast ? 0.4 : Theme.Share.border) }

    /// The scheme the system controls (the keyboard, sheets, alerts, the bars) should be drawn in to suit this one.
    var colorScheme: ColorScheme { theme.isDark ? .dark : .light }

    func markTint(_ name: String?) -> Color { theme.markTint(name).color }

    /// The chart's series colours in this scheme.
    var seriesColors: [Color] { theme.seriesColors.map(\.color) }

    // MARK: UIKit (the editor)

    var uiBackground: UIColor { theme.background.uiColor }
    var uiForeground: UIColor { theme.foreground.uiColor }
    var uiBrand: UIColor { theme.brand.uiColor }
    var uiMutedFill: UIColor { theme.foreground.uiColor(alpha: Theme.Share.muted) }
    /// What a `<Mark color="…">` is tinted in this scheme (the five hues, at the strength the scheme gives them), behind its words.
    func uiMarkTint(_ name: String?) -> UIColor { theme.markTint(name).uiColor }
    /// A horizontal rule: the text colour at 35%, as the desktop's Live tab draws it (a hairline, `--border`, would be too faint to read as a rule); firmer with Increase Contrast.
    var uiRule: UIColor { theme.foreground.uiColor(alpha: Theme.ruleShare(increasedContrast: increasedContrast)) }
    /// The grey text of `mutedText`, for what the Live tab dims (the marks that show while the selection is in their construct).
    var uiMutedText: UIColor { theme.foreground.uiColor(alpha: theme.mutedShare(increasedContrast: increasedContrast)) }
    /// The same, for a mark that shows over a `<Mark>`'s tint (raised where the grey would not read on that colour: `Theme.dimmedShare`).
    func uiDimmedText(overTint name: String?) -> UIColor {
        theme.foreground.uiColor(alpha: theme.dimmedShare(over: theme.markTint(name), increasedContrast: increasedContrast))
    }
}

extension EnvironmentValues {
    @Entry var look = Look.standard
}

extension ThemeColor {
    var color: Color { color(opacity: 1) }

    func color(opacity: Double) -> Color {
        Color(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255, opacity: opacity)
    }

    var uiColor: UIColor { uiColor(alpha: 1) }

    func uiColor(alpha: Double) -> UIColor {
        UIColor(red: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: alpha)
    }
}

extension Appearance {
    /// The scheme in force: the named one, or, for System, the light or dark one that matches what the iPad is showing.
    func theme(system: ColorScheme) -> Theme {
        switch scheme {
        case .theme(let name): Theme.named(name) ?? .default
        case .system: Theme.named(system == .dark ? "dark" : "light") ?? .default
        }
    }

    func look(system: ColorScheme, contrast: ColorSchemeContrast = .standard) -> Look {
        Look(theme: theme(system: system), editorFont: editorFont, previewFont: previewFont, increasedContrast: contrast == .increased)
    }
}

extension FontFamily {
    /// The system's face for this family at a point size, grown with Dynamic Type for the body text style (the editor's fonts).
    func uiFont(size: CGFloat, weight: UIFont.Weight = .regular, scaled: Bool = true) -> UIFont {
        let font: UIFont
        switch self {
        case .mono:
            font = .monospacedSystemFont(ofSize: size, weight: weight)
        case .sans:
            font = .systemFont(ofSize: size, weight: weight)
        case .serif:
            let base = UIFont.systemFont(ofSize: size, weight: weight)
            font = base.fontDescriptor.withDesign(.serif).map { UIFont(descriptor: $0, size: size) } ?? base
        }
        return scaled ? UIFontMetrics(forTextStyle: .body).scaledFont(for: font) : font
    }

    /// How SwiftUI's system fonts are drawn for this family (`fontDesign`).
    var design: Font.Design {
        switch self {
        case .sans: .default
        case .serif: .serif
        case .mono: .monospaced
        }
    }
}
