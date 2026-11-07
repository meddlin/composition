import Foundation

/// An opaque sRGB colour, as the desktop's palettes write it (`#rrggbb`), with the arithmetic its `<Mark>` tints and chart colours need.
public struct ThemeColor: Equatable, Hashable, Sendable {
    public var red: Int
    public var green: Int
    public var blue: Int

    public init(red: Int, green: Int, blue: Int) {
        (self.red, self.green, self.blue) = (red, green, blue)
    }

    /// `#rrggbb` (any case); nil for anything else.
    public init?(hex: String) {
        let digits = Array(hex.utf8)
        // `Int(_:radix:)` would take a sign, so the digits are checked first.
        guard digits.count == 7, digits[0] == UInt8(ascii: "#"), digits.dropFirst().allSatisfy({ Character(UnicodeScalar($0)).isHexDigit }),
            let value = Int(String(hex.dropFirst()), radix: 16)
        else { return nil }
        self.init(red: (value >> 16) & 0xFF, green: (value >> 8) & 0xFF, blue: value & 0xFF)
    }

    /// Lower case, as the desktop's stylesheet has them.
    public var hex: String { String(format: "#%02x%02x%02x", red, green, blue) }

    /// WCAG relative luminance (the formula `markContrast.test.ts` uses).
    public var luminance: Double {
        func channel(_ value: Int) -> Double {
            let c = Double(value) / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    /// The contrast ratio of two colours, 1 to 21 (`(lighter + 0.05) / (darker + 0.05)`).
    public static func contrast(_ a: ThemeColor, _ b: ThemeColor) -> Double {
        let (high, low) = (max(a.luminance, b.luminance), min(a.luminance, b.luminance))
        return (high + 0.05) / (low + 0.05)
    }

    /// This colour at `alpha` (0 to 1) over `bottom`, each channel rounded half up, as the desktop's `blend` does it for a `<Mark>` tint.
    public func over(_ bottom: ThemeColor, alpha: Double) -> ThemeColor {
        func channel(_ top: Int, _ under: Int) -> Int { Int((Double(top) * alpha + Double(under) * (1 - alpha)).rounded(.toNearestOrAwayFromZero)) }
        return ThemeColor(red: channel(red, bottom.red), green: channel(green, bottom.green), blue: channel(blue, bottom.blue))
    }

    /// CSS `color-mix(in srgb, self share, other)`: this colour for `share` (0 to 1) and `other` for the rest.
    public func mixed(with other: ThemeColor, share: Double) -> ThemeColor { over(other, alpha: share) }
}
