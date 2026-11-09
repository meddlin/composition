import CompositionCore
import Foundation

// What a drawing is: the Swift side of the ink stroke format (docs/architecture/ink.md, design decision D9). A drawing is a canvas
// size and a list of strokes; a stroke is an ink (its type and colour) and the points PencilKit sampled. The model keeps
// what it does not understand (members of the drawing or a stroke, columns of the points) so that a newer or other-platform
// writer's additions survive an edit here.
//
// Nothing in this file imports PencilKit or UIKit: the format has to be readable by the CLI's and the desktop's renderers too,
// and `swift test` on a Mac must be able to check it.

/// A kind of ink. PencilKit's own names, as text; a name this code does not know is kept and drawn like a pen.
public struct InkType: RawRepresentable, Hashable, Sendable {
    public let rawValue: String

    public init(rawValue: String) { self.rawValue = rawValue }

    public static let pen = InkType(rawValue: "pen")
    public static let pencil = InkType(rawValue: "pencil")
    public static let marker = InkType(rawValue: "marker")
    public static let monoline = InkType(rawValue: "monoline")
    public static let fountainPen = InkType(rawValue: "fountainPen")
    public static let watercolor = InkType(rawValue: "watercolor")
    public static let crayon = InkType(rawValue: "crayon")

    public static let known: [InkType] = [.pen, .pencil, .marker, .monoline, .fountainPen, .watercolor, .crayon]

    public var isKnown: Bool { Self.known.contains(self) }
}

/// A stroke's colour: a name the theme resolves (`ink`, `accent`, or a `<Mark>` colour such as `yellow`) or a fixed `#rrggbb`.
/// Black ink is `ink` because it has to turn white on a dark scheme; a colour somebody chose stays as chosen.
public enum InkColor: Hashable, Sendable {
    case semantic(String)
    case fixed(ThemeColor)

    public static let ink = InkColor.semantic("ink")
    public static let accent = InkColor.semantic("accent")

    /// `ink`, `accent`, `yellow`… (lower case letters, digits and dashes, up to 32) or `#rrggbb`; nil for anything else.
    public init?(_ text: String) {
        if let color = ThemeColor(hex: text) {
            self = .fixed(color)
        } else if !text.isEmpty, text.utf8.count <= 32, text.utf8.allSatisfy({ (0x61...0x7A).contains($0) || (0x30...0x39).contains($0) || $0 == 0x2D }) {
            self = .semantic(text)
        } else {
            return nil
        }
    }

    public var text: String {
        switch self {
        case .semantic(let name): name
        case .fixed(let color): color.hex
        }
    }
}

/// One sampled point of a stroke, in the units PencilKit uses: points of the canvas, seconds turned to milliseconds, radians.
public struct InkPoint: Equatable, Sendable {
    public var x: Double
    public var y: Double
    /// Milliseconds since the stroke began.
    public var t: Double
    /// 0 to 1 and more (PencilKit's `force`, 1 being an average touch); a finger or a mouse reports 1.
    public var force: Double
    /// Radians: π/2 is the Pencil upright, 0 flat on the glass. A point with no tilt is upright, as π/2 comes at the format's step.
    public var altitude: Double
    /// Radians around the screen's vertical.
    public var azimuth: Double
    /// The nib's size at this point, in canvas points (PencilKit's `size`).
    public var width: Double
    public var height: Double
    public var opacity: Double

    public init(x: Double, y: Double, t: Double = 0, force: Double = 1, altitude: Double = 1.571, azimuth: Double = 0, width: Double = 3, height: Double = 3, opacity: Double = 1) {
        (self.x, self.y, self.t, self.force, self.altitude, self.azimuth, self.width, self.height, self.opacity) = (x, y, t, force, altitude, azimuth, width, height, opacity)
    }

    /// The columns of a point as the format names them, in the order this code writes them.
    public static let fieldNames = ["x", "y", "t", "force", "altitude", "azimuth", "width", "height", "opacity"]

    /// How finely each column is stored: a hundredth of a point, a millisecond, a thousandth of a radian or of a share.
    static let steps: [Double] = [0.01, 0.01, 1, 0.001, 0.001, 0.001, 0.01, 0.01, 0.001]

    var values: [Double] { [x, y, t, force, altitude, azimuth, width, height, opacity] }

    /// What a missing column means.
    static let defaults = InkPoint(x: 0, y: 0).values
}

/// A column of points the format has and this code does not: its name, and one value per point.
public struct InkExtraColumn: Equatable, Sendable {
    public var name: String
    public var values: [JSONValue]
}

public struct InkStroke: Equatable, Sendable {
    public var ink: InkType
    public var color: InkColor
    public var points: [InkPoint]
    /// Point columns written by someone else's newer version, kept so an edit here does not lose them.
    public var extraColumns: [InkExtraColumn]
    /// Members of the stroke this code does not know, in their order.
    public var extra: [JSONObject.Member]

    public init(ink: InkType = .pen, color: InkColor = .ink, points: [InkPoint], extraColumns: [InkExtraColumn] = [], extra: [JSONObject.Member] = []) {
        (self.ink, self.color, self.points, self.extraColumns, self.extra) = (ink, color, points, extraColumns, extra)
    }
}

public struct InkDocument: Equatable, Sendable {
    /// The format's name and the version this code writes and reads. A change that older readers would misdraw bumps `version`; an addition
    /// they can skip does not, and is kept by `extra`.
    public static let formatName = "composition-ink"
    public static let currentVersion = 1

    /// The drawing's own coordinate space, in points: a stroke's x and y lie in `0...width` and `0...height` unless the page was drawn past its edge.
    public var width: Double
    public var height: Double
    public var strokes: [InkStroke]
    /// Members of the drawing this code does not know, in their order.
    public var extra: [JSONObject.Member]

    public init(width: Double, height: Double, strokes: [InkStroke] = [], extra: [JSONObject.Member] = []) {
        (self.width, self.height, self.strokes, self.extra) = (width, height, strokes, extra)
    }

    public var pointCount: Int { strokes.reduce(0) { $0 + $1.points.count } }

    public var isEmpty: Bool { strokes.isEmpty }
}

/// A drawing that cannot be read, or one that is too big to be a real page; the message is safe to show.
public struct InkError: Error, Equatable, LocalizedError {
    public let message: String

    public init(_ message: String) { self.message = message }

    public var errorDescription: String? { message }
}

/// What a drawing may hold. A real page has some thousands of strokes; these stop a damaged or hostile file from using all the memory.
public enum InkLimits {
    public static let maxStrokes = 100_000
    public static let maxPoints = 5_000_000
    /// A drawing's canvas, and how far a point may lie from the origin.
    public static let maxCanvas = 100_000.0
    public static let maxCoordinate = 1_000_000.0
    /// The JSON text, before it is parsed.
    public static let maxJSONBytes = 256 * 1024 * 1024
}
