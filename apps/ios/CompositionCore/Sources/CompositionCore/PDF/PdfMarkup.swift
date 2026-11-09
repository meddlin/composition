import Foundation

// What a mark on a PDF is, and what makes one valid: the Swift twin of `pdfMarkup.ts` (docs/pdf-markup-plan.md). The rules are
// the desktop's, and the conformance corpus in `fixtures/conformance/pdf` pins them: the TypeScript writes what each input must
// become (or that it is refused) and PdfConformanceTests.swift replays it.
//
// Every rectangle is in raw PDF user space: the numbers a PDF's own annotation `/Rect` and `/QuadPoints` use, in points,
// unrotated, whatever the page's crop box, media box or rotation. They are stored rounded to a thousandth of a point so that
// the two implementations write the same digits.
//
// The desktop checks JSON from outside, so a page of 1.5, a quote that is a number or a rectangle of three numbers are refusals
// there. Here the types rule those out; what is left to check is what a type cannot say.

public enum PdfMarkKind: String, Sendable, CaseIterable {
    case highlight, underline, strikethrough, text, ink

    /// The kinds that mark lines of text: they carry rectangles, one per line, and a quote.
    public var marksText: Bool { self == .highlight || self == .underline || self == .strikethrough }
}

/// A mark or bookmark that breaks the rules; the message is the desktop's and is safe to show.
public struct InvalidMarkError: Error, Equatable, LocalizedError {
    public let message: String

    public init(_ message: String) { self.message = message }

    public var errorDescription: String? { message }
}

/// x0, y0, x1, y1. A rectangle read from a caller may name any two opposite corners; `normalized` puts them in order.
public struct PdfRect: Equatable, Sendable {
    public var x0: Double
    public var y0: Double
    public var x1: Double
    public var y1: Double

    public init(x0: Double, y0: Double, x1: Double, y1: Double) {
        (self.x0, self.y0, self.x1, self.y1) = (x0, y0, x1, y1)
    }

    /// `[x0, y0, x1, y1]`, or nil for anything else.
    public init?(_ json: JSONValue) {
        guard case .array(let items) = json, items.count == 4 else { return nil }
        let numbers = items.compactMap(\.doubleValue)
        guard numbers.count == 4 else { return nil }
        self.init(x0: numbers[0], y0: numbers[1], x1: numbers[2], y1: numbers[3])
    }

    public var json: JSONValue { .array([.number(x0), .number(y0), .number(x1), .number(y1)]) }

    /// The rectangle from its two corners, in order and rounded to a thousandth; throws when it is not a real, non-empty one.
    public func normalized(_ what: String = "rectangle") throws -> PdfRect {
        guard [x0, y0, x1, y1].allSatisfy({ $0.isFinite && abs($0) <= PdfMarkup.coordinateLimit }) else {
            throw InvalidMarkError("A \(what) is four finite numbers: x0, y0, x1, y1.")
        }
        let rect = PdfRect(
            x0: PdfMarkup.round3(min(x0, x1)), y0: PdfMarkup.round3(min(y0, y1)),
            x1: PdfMarkup.round3(max(x0, x1)), y1: PdfMarkup.round3(max(y0, y1)))
        guard rect.x1 > rect.x0, rect.y1 > rect.y0 else { throw InvalidMarkError("A \(what) must have an area.") }
        return rect
    }
}

/// A typed text note: its box and its text.
public struct PdfTextNoteBody: Equatable, Sendable {
    public var rect: PdfRect
    public var text: String
    public var fontSize: Double?

    public init(rect: PdfRect, text: String, fontSize: Double? = nil) {
        (self.rect, self.text, self.fontSize) = (rect, text, fontSize)
    }

    /// A stored body: an object with its `rect` and `text`, and a `fontSize` when it has one.
    public init?(_ json: JSONValue) {
        guard case .object(let object) = json, let text = object["text"]?.stringValue, let rect = object["rect"].flatMap(PdfRect.init) else { return nil }
        self.init(rect: rect, text: text, fontSize: object["fontSize"]?.doubleValue)
    }

    /// The members in the order the desktop writes them.
    public var json: JSONValue {
        var members = [JSONObject.Member("rect", rect.json), JSONObject.Member("text", .string(text))]
        if let fontSize { members.append(JSONObject.Member("fontSize", .number(fontSize))) }
        return .object(JSONObject(members))
    }
}

/// What a caller says about a new mark.
public struct PdfMarkInput: Equatable, Sendable {
    /// 0-based page index.
    public var page: Int
    public var kind: PdfMarkKind
    public var color: String
    /// Text marks: the marked lines. Not allowed on a text note or ink.
    public var rects: [PdfRect]?
    public var quote: String
    /// One line.
    public var comment: String
    /// A text note: `PdfTextNoteBody.json`. Ink: the page's strokes (the stroke format is not frozen yet). Not allowed on text marks.
    /// `.null` is no body.
    public var body: JSONValue?
    /// Ties the per-page records of one selection that crossed pages together.
    public var groupUuid: String?

    public init(page: Int, kind: PdfMarkKind, color: String, rects: [PdfRect]? = nil, quote: String = "", comment: String = "", body: JSONValue? = nil, groupUuid: String? = nil) {
        (self.page, self.kind, self.color, self.rects, self.quote, self.comment, self.body, self.groupUuid) = (page, kind, color, rects, quote, comment, body, groupUuid)
    }
}

/// What a caller may change of a mark already made; its page, kind and group never change. Anything left nil stays as it was.
public struct PdfMarkChanges: Equatable, Sendable {
    public var color: String?
    public var comment: String?
    public var quote: String?
    /// nil keeps the rectangles; `.some(nil)` takes them away (which only a text note or ink can do, as only they have none).
    public var rects: [PdfRect]??
    /// nil keeps the body; `.null` takes it away (which only a text mark can do).
    public var body: JSONValue?

    public init(color: String? = nil, comment: String? = nil, quote: String? = nil, rects: [PdfRect]?? = nil, body: JSONValue? = nil) {
        (self.color, self.comment, self.quote, self.rects, self.body) = (color, comment, quote, rects, body)
    }
}

/// A mark as it is stored: every field present and normalised.
public struct ValidPdfMark: Equatable, Sendable {
    public var page: Int
    public var kind: PdfMarkKind
    public var color: String
    public var rects: [PdfRect]?
    public var quote: String
    public var comment: String
    public var body: JSONValue?
    public var groupUuid: String?
}

/// Where the reader was in a PDF, remembered per device (not a bookmark).
public struct PdfViewState: Equatable, Sendable {
    public var page: Int?
    public var zoom: Double?
    public var darkPages: Bool?

    public init(page: Int? = nil, zoom: Double? = nil, darkPages: Bool? = nil) {
        (self.page, self.zoom, self.darkPages) = (page, zoom, darkPages)
    }

    /// Keeps the three known keys, when they are sane, and drops the rest.
    public init(normalizing value: JSONValue) {
        self.init()
        guard case .object(let object) = value else { return }
        if let page = object["page"]?.integerValue, page >= 0 { self.page = page }
        if let zoom = object["zoom"]?.doubleValue, zoom.isFinite, zoom >= 0.1, zoom <= 10 { self.zoom = PdfMarkup.round3(zoom) }
        if case .bool(let dark)? = object["darkPages"] { darkPages = dark }
    }

    /// The stored `view_state` column; a missing or damaged one is an empty state.
    public init(storedJSON text: String?) {
        guard let text, !text.isEmpty, let value = try? JSONValue(parsing: text) else {
            self.init()
            return
        }
        self.init(normalizing: value)
    }

    /// The same state with what is not sane dropped, as it is stored.
    public func normalized() -> PdfViewState { PdfViewState(normalizing: json) }

    /// Only the keys it has, in the order the desktop writes them.
    public var json: JSONValue {
        var members: [JSONObject.Member] = []
        if let page { members.append(JSONObject.Member("page", .number(Double(page)))) }
        if let zoom { members.append(JSONObject.Member("zoom", .number(zoom))) }
        if let darkPages { members.append(JSONObject.Member("darkPages", .bool(darkPages))) }
        return .object(JSONObject(members))
    }
}

public enum PdfMarkup {
    /// The five `<Mark>` colors a text mark can have (docs/ui/text-highlighting.md): names, never hex values.
    public static let markColors = ["yellow", "green", "blue", "pink", "orange"]

    public static let maxCommentLength = 500
    public static let maxBookmarkLabelLength = 200

    /// Far past any real page (a PDF's own limit is 14,400 units), near enough to catch garbage.
    static let coordinateLimit = 1e7

    /// `Math.round`: a half goes toward +infinity (-0.5 is -0), which `rounded()` does not do.
    static func javaScriptRound(_ value: Double) -> Double {
        let floor = value.rounded(.down)
        return value - floor >= 0.5 ? floor + 1 : floor
    }

    /// `Math.round(value * 1000) / 1000`
    static func round3(_ value: Double) -> Double { javaScriptRound(value * 1000) / 1000 }

    /// Checks a mark and returns it as it is stored. Throws `InvalidMarkError`.
    public static func validate(_ input: PdfMarkInput) throws -> ValidPdfMark {
        guard input.page >= 0 else { throw InvalidMarkError("A page is a whole number from 0.") }
        let kind = input.kind

        if kind.marksText ? !markColors.contains(input.color) : !isColorName(input.color) {
            throw InvalidMarkError(kind.marksText ? "A \(kind.rawValue) is \(markColors.joined(separator: ", "))." : "A color is a lowercase name.")
        }

        let comment = oneLine(input.comment)
        guard comment.utf16.count <= maxCommentLength else { throw InvalidMarkError("A comment can be at most \(maxCommentLength) characters.") }

        if let groupUuid = input.groupUuid, !isHexUuid(groupUuid) { throw InvalidMarkError("A group is a 32-character lowercase hex uuid.") }

        let body = input.body == .null ? nil : input.body

        if kind.marksText {
            if body != nil { throw InvalidMarkError("A \(kind.rawValue) has rectangles, not a body.") }
            guard let rects = input.rects, !rects.isEmpty else { throw InvalidMarkError("A \(kind.rawValue) needs at least one rectangle.") }
            return ValidPdfMark(
                page: input.page, kind: kind, color: input.color, rects: try rects.map { try $0.normalized() }, quote: input.quote,
                comment: comment, body: nil, groupUuid: input.groupUuid)
        }

        if input.rects != nil { throw InvalidMarkError("A \(kind.rawValue) has a body, not rectangles.") }
        if !input.quote.isEmpty { throw InvalidMarkError("A \(kind.rawValue) has no quote.") }
        if input.groupUuid != nil { throw InvalidMarkError("A \(kind.rawValue) is not part of a selection that crossed pages.") }

        if kind == .text {
            guard case .object(let object)? = body, let text = object["text"]?.stringValue else {
                throw InvalidMarkError("A text note's body is its rect and its text.")
            }
            var fontSize: Double?
            if let given = object["fontSize"] {
                guard let size = given.doubleValue, size.isFinite, size >= 1, size <= 200 else { throw InvalidMarkError("A text note's font size is from 1 to 200.") }
                fontSize = round3(size)
            }
            guard let box = object["rect"].flatMap(PdfRect.init) else { throw InvalidMarkError("A text note box is four finite numbers: x0, y0, x1, y1.") }
            let note = PdfTextNoteBody(rect: try box.normalized("text note box"), text: text, fontSize: fontSize)
            return ValidPdfMark(page: input.page, kind: .text, color: input.color, rects: nil, quote: input.quote, comment: comment, body: note.json, groupUuid: nil)
        }

        // ink: the stroke format is not frozen yet (the iPad design's D9), so any JSON object or array will do
        switch body {
        case .object?, .array?: break
        default: throw InvalidMarkError("Ink needs its strokes as the body.")
        }
        return ValidPdfMark(page: input.page, kind: .ink, color: input.color, rects: nil, quote: input.quote, comment: comment, body: body, groupUuid: nil)
    }

    /// A bookmark's label: one line, at most `maxBookmarkLabelLength` characters, possibly empty (the page number is shown then).
    public static func validateBookmarkLabel(_ label: String) throws -> String {
        let text = oneLine(label)
        guard text.utf16.count <= maxBookmarkLabelLength else { throw InvalidMarkError("A bookmark's label can be at most \(maxBookmarkLabelLength) characters.") }
        return text
    }

    // MARK: The small rules

    /// `^[a-z][a-z0-9-]{0,31}$`
    static func isColorName(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        guard (1...32).contains(bytes.count), (0x61...0x7a).contains(bytes[0]) else { return false }
        return bytes.dropFirst().allSatisfy { (0x61...0x7a).contains($0) || (0x30...0x39).contains($0) || $0 == 0x2d }
    }

    /// `^[0-9a-f]{32}$`
    static func isHexUuid(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        return bytes.count == 32 && bytes.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }
    }

    /// `text.replace(/\s*[\r\n]+\s*/g, " ").trim()`: a run of white space with a line break in it becomes one space, then both ends are trimmed (`JavaScriptText`'s white space, which is not Foundation's).
    static func oneLine(_ text: String) -> String {
        var joined: [Unicode.Scalar] = []
        var run: [Unicode.Scalar] = []
        var runHasBreak = false
        func endRun() {
            joined.append(contentsOf: runHasBreak ? [" "] : run)
            run = []
            runHasBreak = false
        }
        for scalar in text.unicodeScalars {
            if JavaScriptText.isWhitespace(scalar) {
                run.append(scalar)
                if scalar == "\n" || scalar == "\r" { runHasBreak = true }
            } else {
                endRun()
                joined.append(scalar)
            }
        }
        endRun()
        var result = String.UnicodeScalarView()
        result.append(contentsOf: joined)
        return JavaScriptText.trim(String(result))
    }
}
