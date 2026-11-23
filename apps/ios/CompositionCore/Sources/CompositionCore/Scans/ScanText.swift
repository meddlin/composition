import Foundation

// The rules for text read from scanned pages: a port of the desktop's `scanText.ts`, replaying fixtures/conformance/scan/text.json
// (ScanConformanceTests). Which lines are kept, which are held back from everything until a person has looked, which reach search, and what a
// page's text is (docs/architecture/scans.md).
//
// **Confidence is not the safety.** On the owner's iPad, Vision read a cursive signature as a swear word and was sure of it (1.00, Gate C item
// 263), because language correction had snapped the marks to a common word. So a line is held when its confidence is under the floor *or* it holds
// a word from a short list a program never writes on a guess. `InkTranscript` applies the same guard to a drawing's `alt`.

/// Whether a person has looked at a line. Only `checked` and `corrected` were seen by a person.
public enum ScanLineStatus: String, Sendable, CaseIterable {
    case unchecked, held, checked, corrected
}

/// Why a recognised line or a correction was refused. The message is safe to show.
public struct InvalidScanError: Error, Equatable, LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// A line as an engine read it, before it is checked and stored: its box in raw PDF user space (`[x0, y0, x1, y1]`), its text and the engine's
/// confidence (0 to 1).
public struct RecognizedLineInput: Equatable, Sendable {
    public var rect: [Double]
    public var text: String
    public var confidence: Double

    public init(rect: [Double], text: String, confidence: Double) { (self.rect, self.text, self.confidence) = (rect, text, confidence) }
}

/// A line as it is stored: its box rounded as marks' are, its text on one line, its confidence rounded to a thousandth.
public struct ValidRecognizedLine: Equatable, Sendable {
    public var rect: PdfRect
    public var text: String
    public var confidence: Double
    public var status: ScanLineStatus
}

/// What a line holds that matters to search and to its page's text.
public struct ScanLineText: Equatable, Sendable {
    public var line: Int
    public var text: String
    public var status: ScanLineStatus
    public var corrected: String?

    public init(line: Int, text: String, status: ScanLineStatus, corrected: String? = nil) {
        (self.line, self.text, self.status, self.corrected) = (line, text, status, corrected)
    }
}

public enum ScanText {
    /// The least confidence (0 to 1) a line needs to be used before a person has checked it.
    public static let floor = 0.5

    // MARK: The guard

    /// A recognised line's status when it is stored: held when the engine was unsure or the line holds a never-guessed word.
    public static func recognizedStatus(text: String, confidence: Double) -> ScanLineStatus {
        confidence < floor || neverGuessed(text) ? .held : .unchecked
    }

    /// Whether `line` holds a word that is never written from a guess. The words are compared whole, with case, accents and punctuation ignored;
    /// only the roots below also match as part of a longer word.
    public static func neverGuessed(_ line: String) -> Bool {
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

    // MARK: Storing a line

    /// `text.replace(/\s+/gu, " ").trim()`: runs of white space (line breaks included) as one space, and none at the ends.
    public static func oneLine(_ text: String) -> String {
        text.unicodeScalars.split(whereSeparator: JavaScriptText.isWhitespace).map { String(String.UnicodeScalarView($0)) }.joined(separator: " ")
    }

    /// Checks a recognised line and returns it as it is stored, or nil when it has no text (such a line is not kept). Throws `InvalidScanError` for
    /// a box that is not four finite numbers with an area; a confidence outside 0 to 1 is brought inside.
    public static func validate(_ input: RecognizedLineInput) throws -> ValidRecognizedLine? {
        guard input.confidence.isFinite else { throw InvalidScanError("A line's confidence is a number.") }
        guard input.rect.count == 4 else { throw InvalidScanError("A line's box is four finite numbers: x0, y0, x1, y1.") }
        let rect: PdfRect
        do {
            rect = try PdfRect(x0: input.rect[0], y0: input.rect[1], x1: input.rect[2], y1: input.rect[3]).normalized("line's box")
        } catch let error as InvalidMarkError {
            throw InvalidScanError(error.errorDescription ?? "A line's box is four numbers.")
        }
        let text = oneLine(input.text)
        guard !text.isEmpty else { return nil }
        let confidence = PdfMarkup.round3(min(1, max(0, input.confidence)))
        return ValidRecognizedLine(rect: rect, text: text, confidence: confidence, status: recognizedStatus(text: text, confidence: confidence))
    }

    // MARK: Search

    /// The text of a line that search may use, or nil for none: a correction as the person wrote it, a checked or unchecked line as it was read,
    /// never a held line.
    public static func searchText(text: String, status: ScanLineStatus, corrected: String?) -> String? {
        switch status {
        case .corrected: corrected ?? ""
        case .checked, .unchecked: text
        case .held: nil
        }
    }

    /// A scanned page's text for search: its lines in reading order (`line`, then the order given), each line's search text, the empty ones left
    /// out, one per line. The indexer then treats it as it treats a PDF page's own text (`PdfSearchText.pageSearchText`).
    public static func pageText(_ lines: [ScanLineText]) -> String {
        lines.enumerated()
            .sorted { ($0.element.line, $0.offset) < ($1.element.line, $1.offset) }
            .compactMap { searchText(text: $0.element.text, status: $0.element.status, corrected: $0.element.corrected) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    // MARK: Reading a page again

    /// How much of `rect`'s area `other` covers, 0 to 1.
    public static func coveredShare(_ rect: PdfRect, by other: PdfRect) -> Double {
        let width = min(rect.x1, other.x1) - max(rect.x0, other.x0)
        let height = min(rect.y1, other.y1) - max(rect.y0, other.y0)
        guard width > 0, height > 0 else { return 0 }
        return width * height / ((rect.x1 - rect.x0) * (rect.y1 - rect.y0))
    }

    /// Whether a newly read line is left out because a line a person has looked at is already there: more than half of the new line's box is under
    /// a checked or corrected line's. Reading a page again never touches what a person has seen.
    public static func coveredByKept(_ rect: PdfRect, _ kept: [PdfRect]) -> Bool {
        kept.contains { coveredShare(rect, by: $0) > 0.5 }
    }
}
