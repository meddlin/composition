import Foundation

/// The five colour schemes of the desktop, with the tokens of `app/globals.css` (build plan Step 10). The values are the stylesheet's own: `AppearanceConformanceTests`
/// reads them back from the real file (through the desktop's code) and compares every one. "Follow the sun" (`auto`) is not here: it is release polish (M3†).
extension Theme {
    /// In the desktop's order.
    public static let all: [Theme] = [
        Theme(
            name: "dark", label: "Dark", isDark: true,
            background: ThemeColor(hex: "#121212")!,
            foreground: ThemeColor(hex: "#e0e0e0")!,
            surface: ThemeColor(hex: "#1e1e1e")!,
            panel: ThemeColor(hex: "#1b2730")!,
            brand: ThemeColor(hex: "#0178d4")!,
            brandDim: ThemeColor(hex: "#004578")!,
            highlight: ThemeColor(hex: "#ffa62b")!,
            warning: ThemeColor(hex: "#ffa62b")!,
            error: ThemeColor(hex: "#ba3c5b")!,
            success: ThemeColor(hex: "#4ebf71")!,
            link: ThemeColor(hex: "#4aa3e8")!,
            markAlpha: 38,
            syntax: Syntax(
                comment: ThemeColor(hex: "#8b949e")!,
                keyword: ThemeColor(hex: "#ff7b72")!,
                string: ThemeColor(hex: "#a5d6ff")!,
                number: ThemeColor(hex: "#79c0ff")!,
                function: ThemeColor(hex: "#d2a8ff")!,
                type: ThemeColor(hex: "#ffa657")!,
                attr: ThemeColor(hex: "#7ee787")!
            )
        ),
        Theme(
            name: "light", label: "Light", isDark: false,
            background: ThemeColor(hex: "#f7f7f4")!,
            foreground: ThemeColor(hex: "#24292f")!,
            surface: ThemeColor(hex: "#edede8")!,
            panel: ThemeColor(hex: "#e2e2db")!,
            brand: ThemeColor(hex: "#0b62d6")!,
            brandDim: ThemeColor(hex: "#5b6b7f")!,
            highlight: ThemeColor(hex: "#c2570c")!,
            warning: ThemeColor(hex: "#b7791f")!,
            error: ThemeColor(hex: "#c4314b")!,
            success: ThemeColor(hex: "#1a7f4b")!,
            link: ThemeColor(hex: "#0b62d6")!,
            markAlpha: 55,
            syntax: Syntax(
                comment: ThemeColor(hex: "#5c6670")!,
                keyword: ThemeColor(hex: "#cf222e")!,
                string: ThemeColor(hex: "#0a3069")!,
                number: ThemeColor(hex: "#0550ae")!,
                function: ThemeColor(hex: "#7442d1")!,
                type: ThemeColor(hex: "#953800")!,
                attr: ThemeColor(hex: "#116329")!
            )
        ),
        Theme(
            name: "forest", label: "Forest (dark green)", isDark: true,
            background: ThemeColor(hex: "#0c1510")!,
            foreground: ThemeColor(hex: "#d5e5da")!,
            surface: ThemeColor(hex: "#132019")!,
            panel: ThemeColor(hex: "#1a2c22")!,
            brand: ThemeColor(hex: "#3fb876")!,
            brandDim: ThemeColor(hex: "#2e7d57")!,
            highlight: ThemeColor(hex: "#e3b341")!,
            warning: ThemeColor(hex: "#e0a030")!,
            error: ThemeColor(hex: "#d9596b")!,
            success: ThemeColor(hex: "#7bd88f")!,
            link: ThemeColor(hex: "#3fb876")!,
            markAlpha: 38,
            syntax: Syntax(
                comment: ThemeColor(hex: "#84a08d")!,
                keyword: ThemeColor(hex: "#f08fa0")!,
                string: ThemeColor(hex: "#a8d98a")!,
                number: ThemeColor(hex: "#e3b341")!,
                function: ThemeColor(hex: "#7cc7e8")!,
                type: ThemeColor(hex: "#e0a066")!,
                attr: ThemeColor(hex: "#7bd88f")!
            )
        ),
        Theme(
            name: "wine", label: "Wine (dark red)", isDark: true,
            background: ThemeColor(hex: "#160a0e")!,
            foreground: ThemeColor(hex: "#ecdde0")!,
            surface: ThemeColor(hex: "#22111a")!,
            panel: ThemeColor(hex: "#2d1620")!,
            brand: ThemeColor(hex: "#c8405f")!,
            brandDim: ThemeColor(hex: "#8a2b43")!,
            highlight: ThemeColor(hex: "#e0b878")!,
            warning: ThemeColor(hex: "#e3a044")!,
            error: ThemeColor(hex: "#e8604f")!,
            success: ThemeColor(hex: "#86c98a")!,
            link: ThemeColor(hex: "#e8798f")!,
            markAlpha: 38,
            syntax: Syntax(
                comment: ThemeColor(hex: "#a08a90")!,
                keyword: ThemeColor(hex: "#f08090")!,
                string: ThemeColor(hex: "#e8c48a")!,
                number: ThemeColor(hex: "#e8a07a")!,
                function: ThemeColor(hex: "#d9a6e8")!,
                type: ThemeColor(hex: "#f0b27a")!,
                attr: ThemeColor(hex: "#8fd49b")!
            )
        ),
        Theme(
            name: "cream", label: "Cream (warm light)", isDark: false,
            background: ThemeColor(hex: "#f6f0e1")!,
            foreground: ThemeColor(hex: "#3b3226")!,
            surface: ThemeColor(hex: "#eee5d0")!,
            panel: ThemeColor(hex: "#e4d9be")!,
            brand: ThemeColor(hex: "#9a4a1f")!,
            brandDim: ThemeColor(hex: "#7a6a55")!,
            highlight: ThemeColor(hex: "#c2762b")!,
            warning: ThemeColor(hex: "#96600c")!,
            error: ThemeColor(hex: "#b23a48")!,
            success: ThemeColor(hex: "#4f7a3a")!,
            link: ThemeColor(hex: "#8a4b1e")!,
            markAlpha: 55,
            syntax: Syntax(
                comment: ThemeColor(hex: "#6b5c46")!,
                keyword: ThemeColor(hex: "#a8341f")!,
                string: ThemeColor(hex: "#3f6b2c")!,
                number: ThemeColor(hex: "#8a5608")!,
                function: ThemeColor(hex: "#7a3e9d")!,
                type: ThemeColor(hex: "#9a4a1f")!,
                attr: ThemeColor(hex: "#22627a")!
            )
        ),
    ]
}
