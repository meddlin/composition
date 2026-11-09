import Foundation

extension SunPairName {
    /// The palette used by day and the one used by night.
    public var day: Theme { Theme.sunPalette(named: dayName)! }
    public var night: Theme { Theme.sunPalette(named: nightName)! }
}

extension Theme {
    /// What "Follow the sun" looks like at a level (0 dark to 1 light) for a pair of colours, as the desktop's stylesheet makes it: the text, accents and code
    /// colours are one palette outright, the day's or the night's, switching at the pair's `inkFlipLevel`; only the three surfaces (the page, the cards and the
    /// sidebar's panel) blend, `color-mix(in srgb, day <auto-light>, night)`, by the percentage the page writes (one decimal).
    public static func sun(pair: SunPairName, level: Double) -> Theme {
        let day = pair.day, night = pair.night
        var theme = Sun.tone(forLevel: level, flipLevel: pair.inkFlipLevel) == .light ? day : night
        let share = Sun.autoLightShare(level)
        theme.background = day.background.mixed(with: night.background, share: share)
        theme.surface = day.surface.mixed(with: night.surface, share: share)
        theme.panel = day.panel.mixed(with: night.panel, share: share)
        theme.name = "auto"
        theme.label = "Follow the sun"
        return theme
    }
}
