import CompositionCore
import CoreGraphics
import Foundation

// The words in a drawing, for search (docs/architecture/ink.md, "Search"; compromise C11). Handwriting is opaque to search, so when a drawing is saved the text
// that can be read from it is written into the tag's `alt`, which is note text like any other. **How well Vision reads real handwriting is not known** (R11):
// this is built behind a seam, so that the rest can be tested without it, and the transcript stays editable in the note.

/// Something that reads the lines of text in a picture. `VisionTextRecognizer` is the real one; tests give their own.
public protocol InkTextRecognizing: Sendable {
    /// The lines of text in `image` in reading order; empty when there is none.
    func lines(in image: CGImage) async throws -> [String]
}

public enum InkTranscript {
    /// The most characters of a transcript. It goes into a tag in the note, and into the label VoiceOver reads for the drawing.
    public static let maxLength = 300

    /// The words in `drawing`, on one line (no quotes or angle brackets, which a tag's attribute cannot hold), or an empty text when there are none or the reading
    /// failed: a drawing is saved either way, and its `alt` then stays "Drawing".
    public static func text(of drawing: InkDocument, using recognizer: some InkTextRecognizing) async -> String {
        guard let image = recognitionImage(of: drawing), let lines = try? await recognizer.lines(in: image) else { return "" }
        return normalized(lines)
    }

    /// The picture a recognizer is given: the writing in black on white, at a size handwriting reads at. Every colour is drawn black (a yellow pen would vanish), and
    /// the marker and the watercolour are left out, as a highlighter over writing only makes it harder to read. Nil when nothing would be drawn.
    static func recognitionImage(of drawing: InkDocument) -> CGImage? {
        var writing = drawing
        writing.strokes = drawing.strokes.filter { $0.ink != .marker && $0.ink != .watercolor && !$0.points.isEmpty }.map { stroke in
            var black = stroke
            black.color = .ink
            return black
        }
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
public struct VisionTextRecognizer: InkTextRecognizing {
    public init() {}

    public func lines(in image: CGImage) async throws -> [String] {
        try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        }.value
    }
}
#endif
