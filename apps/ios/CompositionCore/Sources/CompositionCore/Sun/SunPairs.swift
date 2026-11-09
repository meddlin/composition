import Foundation

/// The light and dark colours the "Follow the sun" scheme moves between (the desktop's `sunPairs.ts`): each is a day palette and a night palette
/// from `globals.css`. The page fades from one to the other around sunrise and sunset, and its text switches between the two palettes' own ink at
/// `inkFlipLevel`, the point along the blend where the two inks are equally readable against it.
public enum SunPairName: String, CaseIterable, Sendable {
    case classic
    case creamAmber = "cream-amber"
    case mintForest = "mint-forest"
    case blushWine = "blush-wine"
    case skyMidnight = "sky-midnight"

    public static let `default` = SunPairName.classic

    /// What Settings calls it on the desktop.
    public var label: String {
        switch self {
        case .classic: "Light and dark"
        case .creamAmber: "Cream to dark amber"
        case .mintForest: "Light green to dark forest"
        case .blushWine: "Blush to wine"
        case .skyMidnight: "Sky to midnight"
        }
    }

    /// The names of the day and the night palette (see `Theme.sunPalette(named:)`).
    public var dayName: String {
        switch self {
        case .classic: "light"
        case .creamAmber: "cream"
        case .mintForest: "mint"
        case .blushWine: "blush"
        case .skyMidnight: "sky"
        }
    }

    public var nightName: String {
        switch self {
        case .classic: "dark"
        case .creamAmber: "amber"
        case .mintForest: "forest"
        case .blushWine: "wine"
        case .skyMidnight: "midnight"
        }
    }

    /// Where, along the blend, the text switches from its night ink to its day ink. `themes.test.ts` recomputes it from the palettes on the desktop.
    public var inkFlipLevel: Double {
        switch self {
        case .classic: Sun.inkFlipLevel
        case .creamAmber: 0.5
        case .mintForest: 0.46
        case .blushWine: 0.47
        case .skyMidnight: 0.47
        }
    }

    /// `isSunPairName` and `inkFlipLevelOf` for a value that came off disk: any string that is not one of the five names is the default's.
    public init(settingsValue value: Any?) {
        self = (value as? String).flatMap(SunPairName.init(rawValue:)) ?? .default
    }

    public static func isName(_ value: Any?) -> Bool { (value as? String).flatMap(SunPairName.init(rawValue:)) != nil }
}
