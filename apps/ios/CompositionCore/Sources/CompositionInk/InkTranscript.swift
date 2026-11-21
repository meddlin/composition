import CompositionCore
import CoreGraphics
import Foundation

// The words in a drawing, for search (docs/architecture/ink.md, "Search"; compromise C11). Handwriting is opaque to search, so when a drawing is saved the text
// that can be read from it is written into the tag's `alt`, which is note text like any other. **How well Vision reads real handwriting is not known** (R11):
// this is built behind a seam, so that the rest can be tested without it, and the transcript stays editable in the note. There are two readers behind it: Vision,
// which reads a picture of the strokes, and PencilKit's `PKStrokeRecognizer` (iPadOS 27), which reads the strokes themselves (InkStrokeRecognizer.swift).

/// A line of text a reader found in a drawing, and how sure it was of it (0 to 1), or nil when the reader does not say (PencilKit's never does).
public struct InkRecognizedLine: Equatable, Sendable {
    public var text: String
    public var confidence: Float?

    public init(_ text: String, confidence: Float?) { (self.text, self.confidence) = (text, confidence) }
}

/// Something that reads the lines of text in a drawing. It is given only the writing: every stroke black, the marker and the watercolour left out, and never an
/// empty drawing (`InkTranscript.writing(of:)`).
public protocol InkTextRecognizing: Sendable {
    /// The lines of text in `writing` in reading order, each with the reader's confidence if it gives one; empty when there is none.
    func lines(in writing: InkDocument) async throws -> [InkRecognizedLine]
}

/// A reader of pictures (`VisionTextRecognizer`; tests give their own): it is handed the writing drawn black on white, at a size handwriting reads at.
public protocol InkPictureRecognizing: InkTextRecognizing {
    /// The lines of text in `image` in reading order, each with the reader's confidence; empty when there is none.
    func lines(in image: CGImage) async throws -> [InkRecognizedLine]
}

extension InkPictureRecognizing {
    public func lines(in writing: InkDocument) async throws -> [InkRecognizedLine] {
        guard let image = InkTranscript.recognitionImage(of: writing) else { return [] }
        return try await lines(in: image)
    }
}

public enum InkTranscript {
    /// The most characters of a transcript. It goes into a tag in the note, and into the label VoiceOver reads for the drawing.
    public static let maxLength = 300

    /// The least confidence (0 to 1) a line needs to be written down. Vision gives 0.3 to a reading it is guessing at ("Sugarfrom", from some scribbles) and 1.0 to one it
    /// trusts; this is anywhere between, and a reading under it is left out.
    public static let minimumConfidence: Float = 0.5

    /// The words in `drawing`, on one line (no quotes or angle brackets, which a tag's attribute cannot hold), or an empty text when there are none or the reading
    /// failed: a drawing is saved either way, and its `alt` then stays "Drawing".
    public static func text(of drawing: InkDocument, using recognizer: some InkTextRecognizing) async -> String {
        let writing = writing(of: drawing)
        guard !writing.isEmpty, let lines = try? await recognizer.lines(in: writing) else { return "" }
        return normalized(trusted(lines))
    }

    /// The lines worth writing into a note. **Confidence is not enough:** with language correction on, Vision read a cursive signature as "Drien fucking" and was *sure*
    /// of it (1.0), because it had snapped the marks to a common word (Gate C item 263). So a line is also left out whole when a word in it is one a program should never
    /// put into a person's note on a guess. A person who really wrote one can type it into `alt` themselves, and what they type stays. A reader that gives no confidence
    /// (PencilKit's) has only the second test applied: there is no floor to hold it to.
    static func trusted(_ lines: [InkRecognizedLine]) -> [String] {
        lines.filter { ($0.confidence.map { $0 >= minimumConfidence } ?? true) && !neverGuessed($0.text) }.map(\.text)
    }

    /// Whether `line` holds a word from the short list that is never written from a guess. The words are compared whole, with case, accents and punctuation ignored;
    /// only the roots below also match as part of a longer word.
    static func neverGuessed(_ line: String) -> Bool {
        let folded = line.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        return folded.split(whereSeparator: { !$0.isLetter }).contains { word in
            neverGuessedWords.contains(String(word)) || neverGuessedAnywhere.contains { word.contains($0) }
                || neverGuessedAtEitherEnd.contains { word.hasPrefix($0) || word.hasSuffix($0) }
        }
    }

    /// Roots that are blocked anywhere in a word ("motherfucker"): no word or name holds them innocently.
    private static let neverGuessedAnywhere = ["fuck"]
    /// Roots that are blocked at the start or the end of a word ("shitty", "bullshit") but not in the middle, where names hold them ("Matsushita", "Yoshitaka").
    private static let neverGuessedAtEitherEnd = ["shit"]
    /// Words that are blocked only as a whole word ("Scunthorpe" holds the first, and is fine). Short on purpose, and meant to be added to.
    private static let neverGuessedWords: Set<String> = [
        "cunt", "cunts", "bitch", "bitches", "asshole", "assholes", "nigger", "niggers", "nigga", "niggas", "faggot", "faggots",
    ]

    /// What a recognizer is given: the drawing with every stroke in ink (a yellow pen would vanish from a picture), and the marker and the watercolour left out, as a
    /// highlighter over writing only makes it harder to read. Empty when there is nothing to read.
    static func writing(of drawing: InkDocument) -> InkDocument {
        var writing = drawing
        writing.strokes = drawing.strokes.filter { $0.ink != .marker && $0.ink != .watercolor && !$0.points.isEmpty }.map { stroke in
            var black = stroke
            black.color = .ink
            return black
        }
        return writing
    }

    /// The strokes of `writing` (their indices) grouped into lines of writing, top line first, each in the order it was drawn: for a reader of strokes that reads one
    /// group at a time. Tallest first, a stroke joins the line it overlaps most, top to bottom, if that is at least half the shorter of the two (a descender does not
    /// reach the next line); a small mark joins the nearest line within half that line's height (the dot over "jig"); anything else starts a line. **Simple on
    /// purpose:** written for straight lines of writing, as in a spike.
    static func lineGroups(of writing: InkDocument) -> [[Int]] {
        func extent(_ stroke: InkStroke) -> ClosedRange<Double> {
            let tops = stroke.points.map { $0.y - $0.height / 2 }, bottoms = stroke.points.map { $0.y + $0.height / 2 }
            return (tops.min() ?? 0)...(bottoms.max() ?? 0)
        }
        let extents = writing.strokes.map(extent)
        var lines: [(extent: ClosedRange<Double>, members: [Int])] = []
        // Tall strokes first, so that a line's extent is set by its letters before its dots and commas are placed.
        let order = extents.indices.sorted { (extents[$0].upperBound - extents[$0].lowerBound) > (extents[$1].upperBound - extents[$1].lowerBound) }
        for index in order {
            let mine = extents[index]
            let height = max(mine.upperBound - mine.lowerBound, 0.001)
            var best: (line: Int, share: Double)?
            var nearest: (line: Int, gap: Double)?
            for (number, line) in lines.enumerated() {
                let lineHeight = max(line.extent.upperBound - line.extent.lowerBound, 0.001)
                let overlap = min(mine.upperBound, line.extent.upperBound) - max(mine.lowerBound, line.extent.lowerBound)
                let share = overlap / min(height, lineHeight)
                if share >= 0.5, share > (best?.share ?? 0) { best = (number, share) }
                // A mark under half the line's height and less than half of it away (the dot over "jig", a comma) belongs to it.
                if height < lineHeight / 2, -overlap < lineHeight / 2, -overlap < (nearest?.gap ?? .infinity) { nearest = (number, -overlap) }
            }
            if best == nil, let nearest { best = (nearest.line, 0) }
            if let best {
                let extent = lines[best.line].extent
                lines[best.line].extent = min(extent.lowerBound, mine.lowerBound)...max(extent.upperBound, mine.upperBound)
                lines[best.line].members.append(index)
            } else {
                lines.append((mine, [index]))
            }
        }
        return lines.sorted { $0.extent.lowerBound < $1.extent.lowerBound }.map { $0.members.sorted() }
    }

    /// The picture a picture reader is given: the writing (`writing(of:)`) in black on white, at a size handwriting reads at. Nil when nothing would be drawn.
    static func recognitionImage(of drawing: InkDocument) -> CGImage? {
        let writing = writing(of: drawing)
        guard !writing.isEmpty else { return nil }
        let black = ThemeColor(red: 0, green: 0, blue: 0)
        // 2 pixels to a point reads well; a long page is brought down to 4,096 pixels, where Vision still finds a pen's writing.
        let scale = min(2, 4096 / CGFloat(max(writing.width, writing.height)))
        return InkRenderer.image(of: writing, palette: InkPalette(ink: black, accent: black, marks: [:]), scale: scale, background: ThemeColor(red: 255, green: 255, blue: 255))
    }

    /// Lines of recognised text as a single line for `alt`: trimmed, runs of white space as one space, quotes and angle brackets dropped, at most `maxLength`
    /// characters (cut at a word).
    static func normalized(_ lines: [String]) -> String {
        let joined = lines.joined(separator: " ").filter { $0 != "\"" && $0 != "<" && $0 != ">" }
        let words = joined.split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        var out = ""
        for word in words {
            let next = out.isEmpty ? String(word) : out + " " + word
            if next.count > maxLength {
                // One word longer than the limit is cut; otherwise the words so far stand.
                if out.isEmpty { out = String(word.prefix(maxLength)) }
                break
            }
            out = next
        }
        return out
    }
}

extension InkDocument {
    /// The text read from this drawing when it was saved (a member of the drawing that every reader keeps: `"transcript"`), nil when none was.
    public var transcript: String? {
        get { extra.first { $0.key == "transcript" }?.value.stringValue }
        set {
            extra.removeAll { $0.key == "transcript" }
            if let newValue { extra.append(.init("transcript", .string(newValue))) }
        }
    }
}

#if canImport(Vision)
import Vision

/// Apple's Vision framework reading text, at its accurate level with language correction (handwriting is read at that level only).
public struct VisionTextRecognizer: InkPictureRecognizing {
    public init() {}

    public func lines(in image: CGImage) async throws -> [InkRecognizedLine] {
        try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
            return (request.results ?? []).compactMap { observation in
                observation.topCandidates(1).first.map { InkRecognizedLine($0.string, confidence: $0.confidence) }
            }
        }.value
    }
}
#endif
