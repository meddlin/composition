import Foundation
import Testing

@testable import CompositionCore

@Suite("Appearance: schemes, tints and the settings that choose them")
struct AppearanceTests {
    private func store(_ scratch: Scratch, file: String? = nil) throws -> (SettingsStore, DataLocation) {
        let location = DataLocation(directory: scratch.directory.appendingPathComponent("data", isDirectory: true))
        if let file {
            try FileManager.default.createDirectory(at: location.directory, withIntermediateDirectories: true)
            try file.write(to: location.settingsURL, atomically: true, encoding: .utf8)
        }
        return (SettingsStore(location: location), location)
    }

    private func object(_ location: DataLocation) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: location.settingsURL)) as? [String: Any])
    }

    // MARK: Colours

    @Test("a hex colour reads and writes back, and anything else is refused")
    func hex() {
        #expect(ThemeColor(hex: "#F5C518")?.hex == "#f5c518")
        #expect(ThemeColor(hex: "#000000") == ThemeColor(red: 0, green: 0, blue: 0))
        for bad in ["", "f5c518", "#f5c51", "#f5c5188", "#gggggg", "#+12345"] { #expect(ThemeColor(hex: bad) == nil, "\(bad)") }
    }

    @Test("contrast is 21 between black and white, 1 for a colour with itself, and the same either way round")
    func contrast() {
        let black = ThemeColor(red: 0, green: 0, blue: 0), white = ThemeColor(red: 255, green: 255, blue: 255)
        #expect(abs(ThemeColor.contrast(black, white) - 21) < 1e-9)
        #expect(ThemeColor.contrast(black, black) == 1)
        let grey = ThemeColor(red: 119, green: 119, blue: 119)
        #expect(ThemeColor.contrast(grey, white) == ThemeColor.contrast(white, grey))
    }

    @Test("a tint rounds each channel half up, as the desktop's blend does")
    func blending() {
        // 255 * 0.5 + 0 * 0.5 = 127.5, which rounds up; 1 * 0.5 + 0 = 0.5, which rounds up too.
        #expect(ThemeColor(red: 255, green: 1, blue: 0).over(ThemeColor(red: 0, green: 0, blue: 0), alpha: 0.5) == ThemeColor(red: 128, green: 1, blue: 0))
        #expect(ThemeColor(red: 10, green: 20, blue: 30).over(ThemeColor(red: 200, green: 100, blue: 0), alpha: 1) == ThemeColor(red: 10, green: 20, blue: 30))
        #expect(ThemeColor(red: 10, green: 20, blue: 30).over(ThemeColor(red: 200, green: 100, blue: 0), alpha: 0) == ThemeColor(red: 200, green: 100, blue: 0))
    }

    // MARK: Schemes

    @Test("the text and the links can be read on every surface of every scheme, and the code colours on the surface, as the stylesheet promises")
    func legibility() {
        for theme in Theme.all {
            for (name, page) in [("background", theme.background), ("surface", theme.surface), ("panel", theme.panel)] {
                #expect(ThemeColor.contrast(theme.foreground, page) >= 4.5, "\(theme.name): text on \(name)")
            }
            #expect(ThemeColor.contrast(theme.link, theme.background) >= 4.5, "\(theme.name): a link on the background")
            for (name, colour) in [("comment", theme.syntax.comment), ("keyword", theme.syntax.keyword), ("string", theme.syntax.string), ("number", theme.syntax.number),
                ("function", theme.syntax.function), ("type", theme.syntax.type), ("attr", theme.syntax.attr)] {
                #expect(ThemeColor.contrast(colour, theme.surface) >= 4.5, "\(theme.name): \(name) on the surface")
                #expect(ThemeColor.contrast(colour, theme.background) >= 4.5, "\(theme.name): \(name) on the page, where the editor draws it")
            }
        }
    }

    @Test("a selected row's text reads at 4.5 on its fill in every scheme, and Forest, whose accent is too pale for white, takes its dimmer one")
    func selection() throws {
        for theme in Theme.all {
            let selection = theme.selection
            #expect(ThemeColor.contrast(selection.fill, selection.text) >= Theme.readable, "\(theme.name)")
        }
        let forest = try #require(Theme.named("forest"))
        #expect(ThemeColor.contrast(forest.brand, ThemeColor(red: 255, green: 255, blue: 255)) < Theme.readable, "the accent alone would not do")
        #expect(forest.selection.fill == forest.brandDim)
        let dark = try #require(Theme.named("dark"))
        #expect(dark.selection.fill == dark.brand && dark.selection.text == ThemeColor(red: 255, green: 255, blue: 255))
    }

    @Test("grey text reads at the target (5.5, a margin over 4.5) on the page, a card and the panel in every scheme, and is never lighter than the desktop's 60%")
    func mutedText() throws {
        for theme in Theme.all {
            for (name, page) in [("background", theme.background), ("surface", theme.surface), ("panel", theme.panel)] {
                let grey = theme.foreground.over(page, alpha: theme.mutedShare)
                #expect(ThemeColor.contrast(grey, page) >= Theme.mutedTarget, "\(theme.name): grey on \(name)")
                #expect(ThemeColor.contrast(grey, page) >= Theme.readable)
            }
            #expect(theme.mutedShare >= Theme.Share.mutedForeground && theme.mutedShare <= 1, "\(theme.name)")
        }
        #expect((Theme.named("cream")?.mutedShare ?? 0) > (Theme.named("dark")?.mutedShare ?? 1), "the light schemes need more raising than the dark ones")
        #expect((Theme.named("cream")?.mutedShare ?? 0) > Theme.Share.mutedForeground, "Cream's grey had to be raised")
    }

    @Test("the Live tab's dimmed syntax reads at 4.5 or better in every scheme, on the page, on the fill of code and on every highlight tint, with and without Increase Contrast")
    func dimmedSyntax() {
        for theme in Theme.all {
            let codeFill = theme.foreground.over(theme.background, alpha: Theme.Share.muted)
            for increased in [false, true] {
                let share = theme.mutedShare(increasedContrast: increased)
                let context = "\(theme.name), Increase Contrast \(increased ? "on" : "off")"
                #expect(ThemeColor.contrast(theme.foreground.over(theme.background, alpha: share), theme.background) >= Theme.mutedTarget, "\(context): on the page")
                #expect(ThemeColor.contrast(theme.foreground.over(codeFill, alpha: share), codeFill) >= Theme.readable, "\(context): on the faint fill of code")
                for name in Theme.markHues.keys.sorted() {
                    let tint = theme.markTint(name)
                    let dimmed = theme.dimmedShare(over: tint, increasedContrast: increased)
                    #expect(dimmed >= share && dimmed <= 1, "\(context): \(name) is never dimmer than the grey text")
                    #expect(ThemeColor.contrast(theme.foreground.over(tint, alpha: dimmed), tint) >= Theme.readable, "\(context): on \(name)")
                }
            }
            #expect(theme.mutedShare(increasedContrast: true) >= max(theme.mutedShare, Theme.increasedMutedShare), "\(theme.name): Increase Contrast darkens the grey")
        }
        // Where the grey already reads on a tint it is left as it is, and where it does not (the dark schemes' tints) it is raised: so the rule is not idle.
        let dark = Theme.named("dark")!
        #expect(dark.dimmedShare(over: dark.markTint("yellow"), increasedContrast: false) > dark.mutedShare)
        let light = Theme.named("light")!
        #expect(light.dimmedShare(over: light.markTint("yellow"), increasedContrast: false) == light.mutedShare)
    }

    @Test("a rule (the Live tab's line) is firmer with Increase Contrast and can be told from the page in every scheme")
    func rule() {
        for theme in Theme.all {
            func contrast(_ increased: Bool) -> Double {
                ThemeColor.contrast(theme.foreground.over(theme.background, alpha: Theme.ruleShare(increasedContrast: increased)), theme.background)
            }
            #expect(contrast(false) >= 1.5, "\(theme.name): the desktop's 35% is a line you can see")
            #expect(contrast(true) >= 3, "\(theme.name): and with Increase Contrast it passes the 3 that WCAG asks of a line that carries meaning")
            #expect(contrast(true) > contrast(false))
        }
    }

    @Test("an unknown or missing highlight colour is yellow, and a colour name may be in any case")
    func unknownMarks() {
        let theme = Theme.default
        #expect(theme.markTint(nil) == theme.markTint("yellow"))
        #expect(theme.markTint("purple") == theme.markTint("yellow"))
        #expect(theme.markTint("PINK") == theme.markTint("pink"))
        #expect(theme.markTint("pink") != theme.markTint("blue"))
    }

    @Test("the series colours are the foreground, success, warning and error, and the two mixes between them")
    func series() throws {
        let theme = try #require(Theme.named("dark"))
        let colors = theme.seriesColors
        #expect(colors.count == 6)
        #expect(Array(colors.prefix(4)) == [theme.foreground, theme.success, theme.warning, theme.error])
        #expect(colors[4] == theme.foreground.mixed(with: theme.success, share: 0.55))
        #expect(colors[5] == theme.warning.mixed(with: theme.error, share: 0.60))
        #expect(Set(colors).count == 6, "six different colours")
        for other in Theme.all { #expect(other.seriesColors.count == 6) }
    }

    // MARK: Settings

    @Test("a new install follows the system, with a monospaced editor and a sans serif preview")
    func freshInstall() throws {
        try withScratch { scratch in
            let (store, _) = try store(scratch)
            #expect(store.appearance() == Appearance(scheme: .system, editorFont: .mono, previewFont: .sans))
        }
    }

    @Test("a desktop's scheme is the iPad's, a desktop's Follow the sun reads as System, and nothing else the file holds matters")
    func fromTheDesktop() throws {
        try withScratch { scratch in
            let (store, _) = try store(scratch, file: #"{"theme":"forest","sidebarWidth":300}"#)
            #expect(store.appearance().scheme == .theme("forest"))
        }
        try withScratch { scratch in
            let (store, _) = try store(scratch, file: #"{"theme":"auto"}"#)
            #expect(store.appearance().scheme == .system)
        }
        try withScratch { scratch in
            let (store, _) = try store(scratch, file: #"{"theme":"neon","iosEditorFont":"comic","iosPreviewFont":7,"followSystem":"yes"}"#)
            #expect(store.appearance() == Appearance(scheme: .system, editorFont: .mono, previewFont: .sans), "unknown values are ignored")
        }
    }

    @Test("choosing a scheme writes the desktop's theme and keeps every other key; System leaves the theme as it was")
    func choosing() throws {
        try withScratch { scratch in
            let (store, location) = try store(scratch, file: #"{"theme":"wine","favorites":[{"type":"note","id":4}],"panels":{"version":2}}"#)
            #expect(store.appearance().scheme == .theme("wine"))
            try store.setScheme(.system)
            #expect(store.appearance().scheme == .system)
            var written = try object(location)
            #expect(written["theme"] as? String == "wine", "a desktop that reads the file still has its scheme")
            #expect(written["followSystem"] as? Bool == true)
            try store.setScheme(.theme("cream"))
            #expect(store.appearance().scheme == .theme("cream"))
            written = try object(location)
            #expect(written["theme"] as? String == "cream" && written["followSystem"] as? Bool == false)
            #expect(written["panels"] != nil && store.favorites() == [Favorite(.note, 4)], "the rest of the file is as it was")
        }
    }

    @Test("a scheme the desktop would not know is refused, and nothing is written")
    func refusing() throws {
        try withScratch { scratch in
            let (store, location) = try store(scratch)
            for name in ["auto", "neon", ""] { #expect(throws: SettingsError.unknownTheme(name)) { try store.setScheme(.theme(name)) } }
            #expect(!FileManager.default.fileExists(atPath: location.settingsURL.path))
        }
    }

    @Test("the two fonts are kept separately and read back")
    func fonts() throws {
        try withScratch { scratch in
            let (store, location) = try store(scratch)
            try store.setEditorFont(.serif)
            try store.setPreviewFont(.mono)
            #expect(store.appearance() == Appearance(scheme: .system, editorFont: .serif, previewFont: .mono))
            let written = try object(location)
            #expect(written["iosEditorFont"] as? String == "serif" && written["iosPreviewFont"] as? String == "mono")
            #expect(written["theme"] == nil, "no desktop key was made up")
        }
    }
}
