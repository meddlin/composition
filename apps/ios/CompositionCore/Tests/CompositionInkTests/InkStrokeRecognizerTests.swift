import CoreGraphics
import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

/// A reader of strokes that hands back what it is told, with no confidence (as PencilKit's), and keeps the drawings it was given.
final class FakeStrokeRecognizer: InkTextRecognizing, @unchecked Sendable {
    let reply: [String]
    private(set) var drawings: [InkDocument] = []
    private let lock = NSLock()

    init(_ reply: [String]) { self.reply = reply }

    func lines(in writing: InkDocument) async throws -> [InkRecognizedLine] {
        lock.withLock { drawings.append(writing) }
        return reply.map { InkRecognizedLine($0, confidence: nil) }
    }
}

@Suite("Ink: a reader of strokes behind the same seam")
struct InkStrokeReaderSeamTests {
    @Test func aStrokeReaderIsGivenTheWritingOnly() async throws {
        let pen = InkStroke(ink: .pen, color: .semantic("yellow"), points: [InkPoint(x: 10, y: 10), InkPoint(x: 90, y: 20, t: 100)])
        let marker = InkStroke(ink: .marker, color: .semantic("pink"), points: [InkPoint(x: 10, y: 30), InkPoint(x: 90, y: 30, t: 100)])
        let fake = FakeStrokeRecognizer(["hello"])
        #expect(await InkTranscript.text(of: InkDocument(width: 100, height: 50, strokes: [pen, marker]), using: fake) == "hello")
        let given = try #require(fake.drawings.first)
        #expect(given.strokes.count == 1 && given.strokes[0].ink == .pen && given.strokes[0].color == .ink, "the marker is left out and the pen is ink")
        // Nothing to read is never asked, as for a picture reader.
        #expect(await InkTranscript.text(of: InkDocument(width: 100, height: 50, strokes: [marker]), using: fake) == "")
        #expect(fake.drawings.count == 1)
    }

    @Test func aReadingWithNoConfidenceIsNotHeldToTheFloorButTheNeverGuessedWordsStillApply() async {
        let drawing = InkDocument(width: 100, height: 50, strokes: [InkStroke(points: [InkPoint(x: 10, y: 10), InkPoint(x: 90, y: 20, t: 100)])])
        let fake = FakeStrokeRecognizer(["Shopping list", "Drien fucking", "call Sam"])
        #expect(await InkTranscript.text(of: drawing, using: fake) == "Shopping list call Sam")
        // A reading of one line with such a word in it loses the whole reading, which is why the PencilKit reader reads a line at a time (`PencilKitTextRecognizer.lines`).
        #expect(await InkTranscript.text(of: drawing, using: FakeStrokeRecognizer(["Shopping list Drien fucking call Sam"])) == "")
    }

    @Test func strokesAreGroupedIntoLinesOfWriting() {
        let two = InkHandwriting.write("meeting notes\ncall sam")
        let groups = InkTranscript.lineGroups(of: two)
        // meeting notes: m3 e1 e1 t2 i2 n2 g2 + n2 o1 t2 e1 s1 = 13 + 7; call sam: c1 a2 l1 l1 + s1 a2 m3.
        #expect(groups.map(\.count) == [20, 11])
        #expect(groups[0] == Array(0..<20) && groups[1] == Array(20..<31), "each line in the order it was drawn")
        #expect(InkTranscript.lineGroups(of: InkHandwriting.write("jig")).count == 1, "the dots of i and j and a descender stay on their line")
        #expect(InkTranscript.lineGroups(of: InkDocument(width: 10, height: 10)).isEmpty)
    }

    @Test func theSyntheticHandwritingIsInPointsAndInTime() throws {
        let page = InkHandwriting.write("hello world")
        #expect(page.strokes.count == 13, "h e l l o w o r l d: 2+1+1+1+1 + 1+1+2+1+2")
        #expect(page.width > 100 && page.width < 260 && page.height < 120)
        let times = page.strokes.flatMap(\.points).map(\.t)
        #expect(zip(times, times.dropFirst()).allSatisfy { $0 <= $1 }, "the pen's clock only goes forward")
        let two = InkHandwriting.write("ab\ncd")
        #expect(two.height > page.height, "a second line is lower")
    }
}

#if canImport(PencilKit)
import PencilKit

/// PencilKit's reader on synthetic handwriting. **Run with xcodebuild only** (apps/ios/scripts/conformance.sh): PencilKit traps when a `PKDrawing` is built in
/// `swift test`'s helper, which has no bundle identifier. Needs macOS or iPadOS 27; on an older system it says so and checks nothing.
///
/// **The reading itself cannot be checked here:** the recognizer runs in `handwritingd`, which refuses xcodebuild's macOS test host ("The application does not have
/// permission to run remote recognition or synthesis at this time", com.apple.corehandwriting -1003, macOS 27.0.1), and `recognizedText()` is then nil. The reading is
/// checked from a foreground app instead: spikes/ink-readers.
@Suite("Ink: PencilKit's handwriting reader")
struct InkPencilKitRecognizerTests {
    @Test func itReadsPrintedWordsFromTheStrokesWhereItIsAllowedTo() async throws {
        guard #available(iOS 27.0, macOS 27.0, *) else { return print("PKStrokeRecognizer needs iOS or macOS 27; nothing checked") }
        let reader = PencilKitTextRecognizer(preferredLanguages: [Locale.Language(identifier: "en")])
        let lines = try await reader.lines(in: InkTranscript.writing(of: InkHandwriting.write("hello world")))
        guard !lines.isEmpty else { return print("handwritingd gave this process no reading (it refuses a test host); nothing checked, see spikes/ink-readers") }
        let text = InkTranscript.normalized(lines.map(\.text)).lowercased()
        #expect(text.contains("hello") && text.contains("world") && lines.allSatisfy { $0.confidence == nil }, "PencilKit read: \(lines)")
    }

    @Test func theDrawingItIsGivenIsTheSameStrokesInBlack() throws {
        guard #available(iOS 27.0, macOS 27.0, *) else { return }
        let writing = InkTranscript.writing(of: InkHandwriting.write("ab"))
        let drawing = PencilKitTextRecognizer.pkDrawing(of: writing)
        #expect(drawing.strokes.count == writing.strokes.count)
        #expect(drawing.strokes.map(\.path.count) == writing.strokes.map(\.points.count))
    }

    @Test func versionAndLanguagesAreThere() throws {
        guard #available(iOS 27.0, macOS 27.0, *) else { return }
        #expect(PencilKitTextRecognizer.engineVersion > 0)
        print("PencilKit reader: recognitionVersion \(PKStrokeRecognizer.recognitionVersion), \(PKStrokeRecognizer.supportedLanguages.count) languages: \(PKStrokeRecognizer.supportedLanguages.map(\.minimalIdentifier).sorted().joined(separator: " "))")
    }
}
#endif
