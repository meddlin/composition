import Foundation
import Testing

@testable import CompositionCore

// Build plan Step 10: the colour schemes against the desktop's own files. appearance-expected.json is what `globals.css` (read the way
// `markContrast.test.ts` reads it), `themes.ts`, `highlightColors.ts`, `Chart.tsx`, `editorFonts.ts` and `previewFonts.ts` hold: the five palettes'
// tokens, the `<Mark>` hues and tint strengths, the contrast of the text on each tint (worked out by the desktop's own formula), the derived
// shares, the chart's series recipes and the font choices (see ConformanceTests.swift for how to run this).

private struct Expected: Decodable {
    struct Choice: Decodable { let name: String; let label: String }
    struct Palette: Decodable {
        let colorScheme: String
        let background, foreground, surface, panel, brand, highlight, warning, error, success, link: String
        let brandDim: String
        let markAlpha: Double
        let syntax: [String: String]

        enum CodingKeys: String, CodingKey {
            case colorScheme, background, foreground, surface, panel, brand, highlight, warning, error, success, link, markAlpha, syntax
            case brandDim = "brand-dim"
        }
    }
    struct Derived: Decodable { let muted, mutedForeground, accent, border, input: Double }
    struct Aliases: Decodable { let primary, destructive, card: String }
    struct EditorFont: Decodable { let name: String; let kind: String; let label: String }
    let themes: [Choice]
    let defaultTheme: String
    let palettes: [String: Palette]
    let derived: Derived
    let aliases: Aliases
    let highlightColors: [String]
    let defaultHighlightColor: String
    let markHues: [String: String]
    let markContrast: [String: [String: Double]]
    let series: [String]
    let editorFonts: [EditorFont]
    let defaultEditorFont: String
    let previewFonts: [Choice]
    let defaultPreviewFont: String
}

@Suite("The colour schemes against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct AppearanceConformanceTests {
    private func load() throws -> Expected {
        let directory = try #require(conformanceDirectory)
        return try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("appearance-expected.json")))
    }

    @Test("the schemes and their names are the desktop's, and Follow the sun is the one it has that the iPad does not")
    func names() throws {
        let expected = try load()
        #expect(SettingsStore.themeNames == expected.themes.map(\.name), "the settings file may hold these names")
        #expect(Appearance.themeNames == expected.themes.map(\.name).filter { $0 != "auto" })
        #expect(Theme.all.map(\.name) == Appearance.themeNames)
        for choice in expected.themes where choice.name != "auto" {
            #expect(Theme.named(choice.name)?.label == choice.label, "the label of \(choice.name)")
        }
        #expect(Theme.default.name == expected.defaultTheme)
        #expect(SettingsStore.defaultTheme == expected.defaultTheme)
    }

    @Test("every token of every scheme is the stylesheet's, to the digit")
    func palettes() throws {
        let expected = try load()
        for theme in Theme.all {
            let palette = try #require(expected.palettes[theme.name], "\(theme.name)")
            #expect(theme.isDark == (palette.colorScheme == "dark"), "\(theme.name) color-scheme")
            let tokens: [(String, ThemeColor, String)] = [
                ("background", theme.background, palette.background), ("foreground", theme.foreground, palette.foreground), ("surface", theme.surface, palette.surface),
                ("panel", theme.panel, palette.panel), ("brand", theme.brand, palette.brand), ("brand-dim", theme.brandDim, palette.brandDim),
                ("highlight", theme.highlight, palette.highlight), ("warning", theme.warning, palette.warning), ("error", theme.error, palette.error),
                ("success", theme.success, palette.success), ("link", theme.link, palette.link),
            ]
            for (name, ours, theirs) in tokens { #expect(ours.hex == theirs, "\(theme.name) --\(name)") }
            #expect(theme.markAlpha == palette.markAlpha, "\(theme.name) --mark-alpha")
            let syntax: [(String, ThemeColor)] = [
                ("comment", theme.syntax.comment), ("keyword", theme.syntax.keyword), ("string", theme.syntax.string), ("number", theme.syntax.number),
                ("function", theme.syntax.function), ("type", theme.syntax.type), ("attr", theme.syntax.attr),
            ]
            #expect(Set(palette.syntax.keys) == Set(syntax.map(\.0)))
            for (name, ours) in syntax { #expect(ours.hex == palette.syntax[name], "\(theme.name) --syntax-\(name)") }
        }
    }

    @Test("the translucent tokens are the foreground at the desktop's shares, and the aliases are the ones assumed")
    func derived() throws {
        let expected = try load()
        #expect(Theme.Share.muted * 100 == expected.derived.muted)
        #expect(Theme.Share.mutedForeground * 100 == expected.derived.mutedForeground)
        #expect(Theme.Share.accent * 100 == expected.derived.accent)
        #expect(Theme.Share.border * 100 == expected.derived.border)
        #expect(Theme.Share.input * 100 == expected.derived.input)
        // `Theme.token` reads these as the foreground, the error colour and the surface.
        #expect(expected.aliases.primary == "foreground" && expected.aliases.destructive == "error" && expected.aliases.card == "surface")
    }

    @Test("the five highlight colours, their hues and what text on each tint comes to in every scheme")
    func marks() throws {
        let expected = try load()
        #expect(MarkHighlight.colors == expected.highlightColors)
        #expect(MarkHighlight.defaultColor == expected.defaultHighlightColor)
        #expect(Set(Theme.markHues.keys) == Set(expected.highlightColors))
        for (name, hex) in expected.markHues { #expect(Theme.markHues[name]?.hex == hex, "hue \(name)") }
        for theme in Theme.all {
            let ratios = try #require(expected.markContrast[theme.name])
            for color in expected.highlightColors {
                let ours = ThemeColor.contrast(theme.foreground, theme.markTint(color))
                #expect(abs(ours - (ratios[color] ?? -1)) < 1e-9, "\(theme.name) \(color): \(ours) against the desktop's \(ratios[color] ?? -1)")
                #expect(ours >= 4.5, "\(theme.name) \(color) stays legible")
            }
        }
    }

    @Test("the chart's series colours are the recipes Chart.tsx writes")
    func series() throws {
        #expect(Theme.seriesRecipes == (try load()).series)
    }

    @Test("the font defaults are the kinds the desktop's are")
    func fonts() throws {
        let expected = try load()
        #expect(expected.editorFonts.first { $0.name == expected.defaultEditorFont }?.kind == "monospace")
        #expect(FontFamily.editorDefault == .mono)
        #expect(expected.previewFonts.first { $0.name == expected.defaultPreviewFont }?.label.hasPrefix("Geist (") == true, "the desktop's preview default is a sans serif, not Geist Mono")
        #expect(FontFamily.previewDefault == .sans)
        #expect(expected.previewFonts.contains { $0.name == "mono" } && expected.previewFonts.contains { $0.name == "source-serif" }, "it also offers a monospaced and a serif preview")
    }
}
