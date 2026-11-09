import Foundation

/// The five palettes that exist only as halves of a "Follow the sun" pair (the desktop's `globals.css` keys them `[data-theme="auto"][data-sun-pair="…"]`):
/// a dark amber, a mint, a blush, a sky and a midnight. They are not schemes of their own, so they are not in `Theme.all` and cannot be chosen by name.
/// `SunConformanceTests` reads every token back from the real stylesheet.
extension Theme {
    public static let sunOnly: [Theme] = [
        Theme(
            name: "amber", label: "Dark amber", isDark: true,
            background: ThemeColor(hex: "#17110a")!,
            foreground: ThemeColor(hex: "#f0e2cc")!,
            surface: ThemeColor(hex: "#21170d")!,
            panel: ThemeColor(hex: "#2d1f10")!,
            brand: ThemeColor(hex: "#e8a13a")!,
            brandDim: ThemeColor(hex: "#a8701e")!,
            highlight: ThemeColor(hex: "#f2c14e")!,
            warning: ThemeColor(hex: "#e8a13a")!,
            error: ThemeColor(hex: "#e0604f")!,
            success: ThemeColor(hex: "#8fc46a")!,
            link: ThemeColor(hex: "#f0b04a")!,
            markAlpha: 38,
            syntax: Syntax(
                comment: ThemeColor(hex: "#a8977c")!,
                keyword: ThemeColor(hex: "#f0866f")!,
                string: ThemeColor(hex: "#b5d48a")!,
                number: ThemeColor(hex: "#f0c05a")!,
                function: ThemeColor(hex: "#cfa6f0")!,
                type: ThemeColor(hex: "#f0a65a")!,
                attr: ThemeColor(hex: "#8fd49b")!
            )
        ),
        Theme(
            name: "mint", label: "Mint (light green)", isDark: false,
            background: ThemeColor(hex: "#eef5ea")!,
            foreground: ThemeColor(hex: "#1f2d22")!,
            surface: ThemeColor(hex: "#e3edde")!,
            panel: ThemeColor(hex: "#d6e4d0")!,
            brand: ThemeColor(hex: "#2f7a4a")!,
            brandDim: ThemeColor(hex: "#5f7a66")!,
            highlight: ThemeColor(hex: "#b5651d")!,
            warning: ThemeColor(hex: "#9a6a10")!,
            error: ThemeColor(hex: "#b8323f")!,
            success: ThemeColor(hex: "#1f7a45")!,
            link: ThemeColor(hex: "#1f6b3f")!,
            markAlpha: 55,
            syntax: Syntax(
                comment: ThemeColor(hex: "#55695a")!,
                keyword: ThemeColor(hex: "#a82b3a")!,
                string: ThemeColor(hex: "#0f5f4d")!,
                number: ThemeColor(hex: "#8a5a00")!,
                function: ThemeColor(hex: "#6b3fa0")!,
                type: ThemeColor(hex: "#8a4a12")!,
                attr: ThemeColor(hex: "#1b5f7a")!
            )
        ),
        Theme(
            name: "blush", label: "Blush (pale rose)", isDark: false,
            background: ThemeColor(hex: "#faf0f0")!,
            foreground: ThemeColor(hex: "#3a2226")!,
            surface: ThemeColor(hex: "#f3e3e4")!,
            panel: ThemeColor(hex: "#ead3d6")!,
            brand: ThemeColor(hex: "#b02e4f")!,
            brandDim: ThemeColor(hex: "#86616a")!,
            highlight: ThemeColor(hex: "#b4571a")!,
            warning: ThemeColor(hex: "#96600c")!,
            error: ThemeColor(hex: "#b3261e")!,
            success: ThemeColor(hex: "#2f7a45")!,
            link: ThemeColor(hex: "#a3243f")!,
            markAlpha: 55,
            syntax: Syntax(
                comment: ThemeColor(hex: "#7a5b62")!,
                keyword: ThemeColor(hex: "#a3243f")!,
                string: ThemeColor(hex: "#2f6b3a")!,
                number: ThemeColor(hex: "#8a5608")!,
                function: ThemeColor(hex: "#7a3e9d")!,
                type: ThemeColor(hex: "#9a4a1f")!,
                attr: ThemeColor(hex: "#22627a")!
            )
        ),
        Theme(
            name: "sky", label: "Sky (pale blue)", isDark: false,
            background: ThemeColor(hex: "#eef5fb")!,
            foreground: ThemeColor(hex: "#1c2b3a")!,
            surface: ThemeColor(hex: "#e1ecf6")!,
            panel: ThemeColor(hex: "#d1e2f0")!,
            brand: ThemeColor(hex: "#1b64b8")!,
            brandDim: ThemeColor(hex: "#5a6f85")!,
            highlight: ThemeColor(hex: "#b4570c")!,
            warning: ThemeColor(hex: "#9a640c")!,
            error: ThemeColor(hex: "#c4314b")!,
            success: ThemeColor(hex: "#1a7f4b")!,
            link: ThemeColor(hex: "#0b5cb8")!,
            markAlpha: 55,
            syntax: Syntax(
                comment: ThemeColor(hex: "#52657a")!,
                keyword: ThemeColor(hex: "#b5273a")!,
                string: ThemeColor(hex: "#0a3069")!,
                number: ThemeColor(hex: "#0550ae")!,
                function: ThemeColor(hex: "#6b3fb5")!,
                type: ThemeColor(hex: "#953800")!,
                attr: ThemeColor(hex: "#116329")!
            )
        ),
        Theme(
            name: "midnight", label: "Midnight (navy)", isDark: true,
            background: ThemeColor(hex: "#0b1220")!,
            foreground: ThemeColor(hex: "#dde6f3")!,
            surface: ThemeColor(hex: "#111a2c")!,
            panel: ThemeColor(hex: "#182339")!,
            brand: ThemeColor(hex: "#4f8ff0")!,
            brandDim: ThemeColor(hex: "#2c5aa8")!,
            highlight: ThemeColor(hex: "#f0b64a")!,
            warning: ThemeColor(hex: "#f0b64a")!,
            error: ThemeColor(hex: "#e8607a")!,
            success: ThemeColor(hex: "#5bd08a")!,
            link: ThemeColor(hex: "#7db4ff")!,
            markAlpha: 38,
            syntax: Syntax(
                comment: ThemeColor(hex: "#8a9ab4")!,
                keyword: ThemeColor(hex: "#ff8b9a")!,
                string: ThemeColor(hex: "#a5d6ff")!,
                number: ThemeColor(hex: "#79c0ff")!,
                function: ThemeColor(hex: "#d2a8ff")!,
                type: ThemeColor(hex: "#ffb86b")!,
                attr: ThemeColor(hex: "#7ee787")!
            )
        ),
    ]

    /// A palette a sun pair can use: one of the five schemes, or one of the five that exist only for the sun.
    public static func sunPalette(named name: String) -> Theme? { (all + sunOnly).first { $0.name == name } }
}
