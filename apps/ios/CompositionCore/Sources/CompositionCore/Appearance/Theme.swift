import Foundation

/// A colour scheme: the semantic tokens of the desktop's `app/globals.css`, one set per scheme (build plan Step 10). The views ask for a token
/// (`background`, `surface`, `brand` …), never for a colour, so a scheme restyles every one of them. The tables are in `Theme+Palettes.swift`.
public struct Theme: Equatable, Sendable {
    /// The colours of the editor's Markdown and the preview's code (`--syntax-*`).
    public struct Syntax: Equatable, Sendable {
        public var comment: ThemeColor
        public var keyword: ThemeColor
        public var string: ThemeColor
        public var number: ThemeColor
        public var function: ThemeColor
        public var type: ThemeColor
        public var attr: ThemeColor
    }

    public var name: String
    public var label: String
    /// `color-scheme: dark`: whether the system controls (the keyboard, the bars, a sheet's background) should be drawn dark.
    public var isDark: Bool
    public var background: ThemeColor
    public var foreground: ThemeColor
    public var surface: ThemeColor
    public var panel: ThemeColor
    public var brand: ThemeColor
    public var brandDim: ThemeColor
    public var highlight: ThemeColor
    public var warning: ThemeColor
    public var error: ThemeColor
    public var success: ThemeColor
    public var link: ThemeColor
    /// How strongly `<Mark>` tints its hue over the page, in percent (stronger on a light scheme, where a tint is paler).
    public var markAlpha: Double
    public var syntax: Syntax

    /// The desktop's default scheme.
    public static var `default`: Theme { all[0] }

    public static func named(_ name: String) -> Theme? { all.first { $0.name == name } }

    // MARK: Derived tokens

    /// The shares of the foreground (the rest transparent) that the desktop's translucent tokens are: `--muted` is the foreground at 8%,
    /// `--muted-foreground` at 60% (the grey text), `--accent` at 10%, `--border` at 10% and `--input` at 15%.
    public enum Share {
        public static let muted = 0.08
        public static let mutedForeground = 0.60
        public static let accent = 0.10
        public static let border = 0.10
        public static let input = 0.15
    }

    // MARK: <Mark>

    /// The hue of each of the five highlight colours (`--mark-hue`), the same in every scheme; the scheme tints it to its own background.
    public static let markHues: [String: ThemeColor] = [
        "yellow": ThemeColor(hex: "#f5c518")!,
        "green": ThemeColor(hex: "#3fb876")!,
        "blue": ThemeColor(hex: "#3b9eff")!,
        "pink": ThemeColor(hex: "#ff6fae")!,
        "orange": ThemeColor(hex: "#ff8a2b")!,
    ]

    /// What a `<Mark color="…">` looks like over this scheme's page: its hue at `markAlpha` over the background. An unknown or missing name is yellow, as on the desktop.
    public func markTint(_ name: String?) -> ThemeColor {
        let hue = Self.markHues[name?.lowercased() ?? ""] ?? Self.markHues["yellow"]!
        return hue.over(background, alpha: markAlpha / 100)
    }

    // MARK: Charts

    /// The desktop's series colours, as `Chart.tsx` writes them: tokens, not hex values, so a chart reads in every scheme.
    public static let seriesRecipes = [
        "var(--primary)",
        "var(--success)",
        "var(--warning)",
        "var(--destructive)",
        "color-mix(in srgb, var(--primary) 55%, var(--success))",
        "color-mix(in srgb, var(--warning) 60%, var(--destructive))",
    ]

    /// `seriesRecipes` worked out in this scheme. A chart with more series than colours starts over, as on the desktop.
    public var seriesColors: [ThemeColor] { Self.seriesRecipes.map(resolve) }

    private func token(_ name: String) -> ThemeColor {
        switch name {
        case "background": background
        case "surface", "card": surface
        case "panel": panel
        case "brand": brand
        case "highlight": highlight
        case "warning": warning
        case "error", "destructive": error
        case "success": success
        case "link": link
        default: foreground  // `--primary` is the foreground, inverted against the background
        }
    }

    private static let variable = try! NSRegularExpression(pattern: "^var\\(--([a-z-]+)\\)$")
    private static let mix = try! NSRegularExpression(pattern: "^color-mix\\(in srgb, var\\(--([a-z-]+)\\) ([0-9]+)%, var\\(--([a-z-]+)\\)\\)$")

    /// A CSS colour of the two shapes the chart uses: `var(--name)` and `color-mix(in srgb, var(--a) N%, var(--b))`.
    private func resolve(_ recipe: String) -> ThemeColor {
        let whole = NSRange(location: 0, length: (recipe as NSString).length)
        func group(_ match: NSTextCheckingResult, _ index: Int) -> String { (recipe as NSString).substring(with: match.range(at: index)) }
        if let match = Self.variable.firstMatch(in: recipe, range: whole) { return token(group(match, 1)) }
        if let match = Self.mix.firstMatch(in: recipe, range: whole), let percent = Double(group(match, 2)) {
            return token(group(match, 1)).mixed(with: token(group(match, 3)), share: percent / 100)
        }
        return foreground
    }
}
