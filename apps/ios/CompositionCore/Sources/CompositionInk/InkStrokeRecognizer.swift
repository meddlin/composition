#if canImport(PencilKit)
import CompositionCore
import Foundation
import PencilKit

// PencilKit's handwriting recognition (iPadOS and macOS 27; WWDC26 session 203, "Read between the strokes with PencilKit"), as the second reader behind
// `InkTextRecognizing` (docs/architecture/ink.md, "Search"). **A spike, not wired into the app:** the canvas still uses Vision.
//
// It reads the strokes, not a picture of them, on the device (the model ships with the system). What it gives back, per Apple's reference:
// - `recognizedText()`: "the single most likely result" (the session), or nil. **No confidence**, so `InkTranscript.minimumConfidence` cannot apply to it; the
//   never-guessed words still do.
// - `indexableContent`: "multiple concatenated candidate matches" for an index such as Spotlight. **Never** a transcript: it holds readings that are wrong on
//   purpose ("Is that '101' or 'lol'?"), and Apple says it runs at low priority and returns nil when an interactive query cancels it.
// - `search(_:)`: the strokes and bounds where a word likely is, over every candidate.
// - `recognitionVersion`: to be stored with any result kept, which is re-read when the version goes up.
//
// **It reads only for the app in front.** The work is done by handwritingd, which refuses any other process (com.apple.corehandwriting -1003, measured on macOS
// 27.0.1: a test host always, an app once another window has the front), and `recognizedText()` is then nil, with no error to the caller.

/// Reads the lines of handwriting in a drawing with PencilKit's `PKStrokeRecognizer`. It gives no confidence (`InkRecognizedLine.confidence` is nil).
@available(iOS 27.0, macOS 27.0, *)
public struct PencilKitTextRecognizer: InkTextRecognizing {
    /// The languages to read, most likely first; nil reads the system's (Apple's default). Apple honours them "on a best-effort basis".
    public var preferredLanguages: [Locale.Language]?

    public init(preferredLanguages: [Locale.Language]? = nil) { self.preferredLanguages = preferredLanguages }

    /// PencilKit's own drawing of `writing`, in black, for the recognizer. The writing is already in points of the page it was drawn on, which is the scale Apple asks
    /// for ("as if written on standard paper sizes in points, such as US-letter or A4"); an iPad's page is a little bigger than Letter, and is not scaled.
    static func pkDrawing(of writing: InkDocument) -> PKDrawing {
        let black = ThemeColor(red: 0, green: 0, blue: 0)
        return writing.pkDrawing(palette: InkPalette(ink: black, accent: black, marks: [:]))
    }

    /// A recognizer over `writing`, for the comparison and for a caller that wants the other two answers (search, the indexable string).
    func recognizer(for writing: InkDocument) async -> PKStrokeRecognizer {
        let recognizer = PKStrokeRecognizer(preferredLanguages: preferredLanguages)
        await recognizer.updateDrawing(Self.pkDrawing(of: writing))
        return recognizer
    }

    /// The whole drawing is read first, and that reading decides **whether** there is writing and **what** it says; the lines only decide where it breaks.
    ///
    /// - `recognizedText()` over the whole drawing is nil for marks that are not writing (a wave, loops, arcs: measured on macOS 27.0.1). It sometimes breaks its
    ///   reading into lines (your sketched pages) and sometimes joins them with a space ("meeting notes / call sam" came back as "meeting notes call som"), and
    ///   then one never-guessed word would drop every line.
    /// - `recognizedText(strokeIDs:)` over one line's strokes (`InkTranscript.lineGroups`) gives the lines, but it reads marks the whole-drawing call rejects (the
    ///   same wave comes back as "mmm"), and it is one more call a line.
    ///
    /// So the whole reading is split at its own line breaks; only when it is one line and the strokes make several are the lines read, and they are used only when
    /// their words are exactly the whole reading's (else the whole reading stands as one line).
    public func lines(in writing: InkDocument) async throws -> [InkRecognizedLine] {
        let recognizer = await recognizer(for: writing)
        guard let whole = await recognizer.recognizedText() else { return [] }
        // Blank lines go; a line of symbols stays ("←←←" for three arrows), as Vision's do.
        let one = whole.split(whereSeparator: \.isNewline).filter { !$0.allSatisfy(\.isWhitespace) }.map { InkRecognizedLine(String($0), confidence: nil) }
        // `pkDrawing` makes one PencilKit stroke for each stroke of the writing (which has no empty ones), in order, so the indices agree.
        let ids = await recognizer.drawing.strokes.map(\.id)
        let groups = InkTranscript.lineGroups(of: writing)
        guard one.count == 1, ids.count == writing.strokes.count, groups.count > 1 else { return one }
        var lines: [InkRecognizedLine] = []
        for group in groups {
            guard let text = await recognizer.recognizedText(strokeIDs: Set(group.map { ids[$0] })) else { continue }
            if !Self.words(text).isEmpty { lines.append(InkRecognizedLine(text, confidence: nil)) }
        }
        let wholeWords = Self.words(whole), lineWords = lines.flatMap { Self.words($0.text) }
        return lineWords.sorted() == wholeWords.sorted() ? lines : one
    }

    /// The words of a reading, folded for comparing.
    static func words(_ text: String) -> [String] {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    }

    /// The engine's version, to keep beside a transcript so that a newer engine can read the drawing again (Apple: "regenerate them when the version advances").
    public static var engineVersion: Int { PKStrokeRecognizer.recognitionVersion }
}
#endif
