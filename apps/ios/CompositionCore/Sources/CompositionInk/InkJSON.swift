import CompositionCore
import CryptoKit
import Foundation

// The stroke JSON (docs/architecture/ink.md). The shape, with a point's columns named once for the whole drawing instead of once per point
// (a dense page has hundreds of thousands of points, so the names would be most of the text):
//
//     { "format": "composition-ink", "version": 1,
//       "canvas": { "width": 834, "height": 1194 },
//       "fields": ["x", "y", "t", "force", "altitude", "azimuth", "width", "height", "opacity"],
//       "strokes": [ { "ink": "pen", "color": "ink", "points": [[10.5, 20, 0, 1, 1.571, 0, 3, 3, 1], …] }, … ] }
//
// Reading is strict about what it needs (a canvas, strokes with finite points, a colour it can read) and keeps the rest: a member or a
// column it does not know is carried to the next write. Numbers are written the way JavaScript writes them, rounded to the steps in
// `InkPoint.steps`, so the same drawing is the same text wherever it is written.

extension InkDocument {
    // MARK: Reading

    /// UTF-8 JSON, as stored in a drawing's PNG or in a PDF mark's body.
    public init(data: Data) throws {
        guard data.count <= InkLimits.maxJSONBytes else { throw InkError("This drawing is too large to open.") }
        guard let text = String(data: data, encoding: .utf8) else { throw InkError("This drawing's text is not UTF-8.") }
        let json: JSONValue
        do { json = try JSONValue(parsing: text) } catch { throw InkError("This drawing's JSON is damaged.") }
        try self.init(json: json)
    }

    public init(json: JSONValue) throws {
        guard case .object(let object) = json else { throw InkError("A drawing is a JSON object.") }
        guard object["format"]?.stringValue == Self.formatName else { throw InkError("This is not a Composition drawing.") }
        guard let version = object["version"]?.integerValue, version >= 1 else { throw InkError("This drawing has no version.") }
        guard version <= Self.currentVersion else { throw InkError("This drawing was made by a newer version of Composition.") }
        guard let canvas = object["canvas"]?.objectValue,
            let width = canvas["width"]?.doubleValue, let height = canvas["height"]?.doubleValue,
            width > 0, height > 0, width <= InkLimits.maxCanvas, height <= InkLimits.maxCanvas
        else { throw InkError("This drawing's canvas has no usable size.") }

        let fields = try Self.readFields(object["fields"])
        guard let strokeValues = object["strokes"]?.arrayValue else { throw InkError("This drawing has no list of strokes.") }
        guard strokeValues.count <= InkLimits.maxStrokes else { throw InkError("This drawing has too many strokes.") }

        var total = 0
        var strokes: [InkStroke] = []
        strokes.reserveCapacity(strokeValues.count)
        for (index, value) in strokeValues.enumerated() {
            let stroke = try Self.readStroke(value, number: index + 1, fields: fields)
            total += stroke.points.count
            guard total <= InkLimits.maxPoints else { throw InkError("This drawing has too many points.") }
            strokes.append(stroke)
        }

        let known: Set<String> = ["format", "version", "canvas", "fields", "strokes"]
        self.init(width: width, height: height, strokes: strokes, extra: object.members.filter { !known.contains($0.key) })
    }

    /// Which column of a point is which: a position in `InkPoint.fieldNames`, or the name of a column this code keeps without knowing.
    private enum Column {
        case known(Int)
        case extra(String)
    }

    private static func readFields(_ value: JSONValue?) throws -> [Column] {
        guard let value else { return InkPoint.fieldNames.indices.map { .known($0) } }
        guard let names = value.arrayValue?.map(\.stringValue), !names.contains(nil) else { throw InkError("This drawing's point fields are not a list of names.") }
        let list = names.compactMap { $0 }
        guard Set(list).count == list.count, list.contains("x"), list.contains("y") else { throw InkError("This drawing's point fields must be distinct and include x and y.") }
        return list.map { name in InkPoint.fieldNames.firstIndex(of: name).map { Column.known($0) } ?? .extra(name) }
    }

    private static func readStroke(_ value: JSONValue, number: Int, fields: [Column]) throws -> InkStroke {
        guard let object = value.objectValue else { throw InkError("Stroke \(number) is not an object.") }
        let ink = InkType(rawValue: try optionalString(object["ink"], default: "pen", what: "ink", number: number))
        let colorText = try optionalString(object["color"], default: "ink", what: "colour", number: number)
        guard let color = InkColor(colorText) else { throw InkError("Stroke \(number) has a colour that cannot be read.") }
        guard let rows = object["points"]?.arrayValue else { throw InkError("Stroke \(number) has no points.") }

        let extraNames = fields.compactMap { column -> String? in if case .extra(let name) = column { name } else { nil } }
        var extraValues = Array(repeating: [JSONValue](), count: extraNames.count)
        var points: [InkPoint] = []
        points.reserveCapacity(rows.count)
        for row in rows {
            guard let cells = row.arrayValue, cells.count <= fields.count else { throw InkError("Stroke \(number) has a point that does not fit the fields.") }
            var values = InkPoint.defaults
            var extraIndex = 0
            for (position, column) in fields.enumerated() {
                let cell = position < cells.count ? cells[position] : JSONValue.null
                switch column {
                case .known(let slot):
                    switch cell {
                    case .null: break
                    case .number(let number) where number.isFinite: values[slot] = number
                    default: throw InkError("Stroke \(number) has a point with a value that is not a number.")
                    }
                case .extra:
                    extraValues[extraIndex].append(cell)
                    extraIndex += 1
                }
            }
            guard abs(values[0]) <= InkLimits.maxCoordinate, abs(values[1]) <= InkLimits.maxCoordinate else { throw InkError("Stroke \(number) has a point far outside the page.") }
            points.append(InkPoint(x: values[0], y: values[1], t: values[2], force: values[3], altitude: values[4], azimuth: values[5], width: values[6], height: values[7], opacity: values[8]))
        }

        let known: Set<String> = ["ink", "color", "points"]
        return InkStroke(
            ink: ink, color: color, points: points,
            extraColumns: zip(extraNames, extraValues).map { InkExtraColumn(name: $0, values: $1) },
            extra: object.members.filter { !known.contains($0.key) })
    }

    private static func optionalString(_ value: JSONValue?, default fallback: String, what: String, number: Int) throws -> String {
        guard let value else { return fallback }
        guard let text = value.stringValue else { throw InkError("Stroke \(number)'s \(what) is not text.") }
        return text
    }

    // MARK: Writing

    /// Compact JSON text; members and strokes in order, then whatever was kept from a reader's input.
    public func jsonData() -> Data { Data(json.serialized().utf8) }

    public var json: JSONValue {
        var extraNames: [String] = []
        for stroke in strokes {
            for column in stroke.extraColumns where !InkPoint.fieldNames.contains(column.name) && !extraNames.contains(column.name) { extraNames.append(column.name) }
        }
        let fieldNames = InkPoint.fieldNames + extraNames

        var members: [JSONObject.Member] = [
            .init("format", .string(Self.formatName)),
            .init("version", .number(Double(Self.currentVersion))),
            .init("canvas", .object(JSONObject(["width": .number(Self.stored(width, step: 0.01)), "height": .number(Self.stored(height, step: 0.01))]))),
            .init("fields", .array(fieldNames.map { .string($0) })),
            .init("strokes", .array(strokes.map { $0.json(extraNames: extraNames) })),
        ]
        members.append(contentsOf: extra.filter { !["format", "version", "canvas", "fields", "strokes"].contains($0.key) })
        return .object(JSONObject(members))
    }

    /// `value` as a number with the decimals of `step`: the whole number divided by 10, 100 or 1000 is the number the text names, so it prints short.
    static func stored(_ value: Double, step: Double) -> Double {
        let scale = (1 / step).rounded()
        return (value * scale).rounded() / scale
    }
}

extension InkStroke {
    fileprivate func json(extraNames: [String]) -> JSONValue {
        let extraColumnValues = extraNames.map { name in extraColumns.first { $0.name == name }?.values }
        var rows: [JSONValue] = []
        rows.reserveCapacity(points.count)
        for (index, point) in points.enumerated() {
            var cells: [JSONValue] = []
            cells.reserveCapacity(InkPoint.fieldNames.count + extraNames.count)
            for (slot, value) in point.values.enumerated() {
                cells.append(.number(InkDocument.stored(value.isFinite ? value : InkPoint.defaults[slot], step: InkPoint.steps[slot])))
            }
            for column in extraColumnValues { cells.append(column.flatMap { index < $0.count ? $0[index] : nil } ?? .null) }
            rows.append(.array(cells))
        }
        var members: [JSONObject.Member] = [.init("ink", .string(ink.rawValue)), .init("color", .string(color.text)), .init("points", .array(rows))]
        members.append(contentsOf: extra.filter { !["ink", "color", "points"].contains($0.key) })
        return .object(JSONObject(members))
    }
}

// MARK: Telling a PencilKit blob from stale

extension InkDocument {
    /// SHA-256, in hex, of the strokes as they are written (the `strokes` member, not the rest): two drawings with the same strokes have the same digest.
    public var strokesDigest: String {
        let strokes = json.objectValue?["strokes"]?.serialized() ?? "[]"
        return SHA256.hash(data: Data(strokes.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Notes that the PencilKit blob saved beside these strokes was made from exactly these strokes, in a member of the drawing that every reader keeps.
    /// Another program that changes the strokes does not know to change this, so the digest no longer matches, and the iPad prefers the strokes.
    public mutating func markPencilKitCurrent() {
        extra.removeAll { $0.key == "pencilKit" }
        extra.append(.init("pencilKit", .object(JSONObject(["strokes": .string(strokesDigest)]))))
    }

    /// Whether the strokes are still the ones the PencilKit blob was made from (false when it was never marked).
    public var pencilKitBlobIsCurrent: Bool {
        extra.first { $0.key == "pencilKit" }?.value.objectValue?["strokes"]?.stringValue == strokesDigest
    }
}
