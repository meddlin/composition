import CoreGraphics
import CoreText
import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

/// Hands back what it is told, and keeps the pictures it was asked about.
final class FakeRecognizer: InkPictureRecognizing, @unchecked Sendable {
    let reply: [InkRecognizedLine]
    let fails: Bool
    private(set) var images: [CGImage] = []
    private let lock = NSLock()

    /// Lines the reader was sure of.
    init(_ reply: [String] = [], fails: Bool = false) { (self.reply, self.fails) = (reply.map { InkRecognizedLine($0, confidence: 1) }, fails) }
    /// Lines with the confidence the reader gave each.
    init(lines: [InkRecognizedLine]) { (reply, fails) = (lines, false) }

    func lines(in image: CGImage) async throws -> [InkRecognizedLine] {
        lock.withLock { images.append(image) }
        if fails { throw InkError("no") }
        return reply
    }
}

@Suite("Ink: the words in a drawing")
struct InkTranscriptTests {
    func stroke(_ ink: InkType = .pen, _ color: InkColor = .ink, from: Double = 20, to: Double = 120) -> InkStroke {
        InkStroke(ink: ink, color: color, points: [InkPoint(x: from, y: 50, width: 6, height: 6), InkPoint(x: to, y: 60, t: 100, width: 6, height: 6)])
    }

    @Test func theRecognizerIsGivenTheWritingInBlackOnWhite() async throws {
        // A yellow pen is drawn black, a marker over it is left out.
        let drawing = InkDocument(width: 200, height: 100, strokes: [stroke(.pen, .semantic("yellow")), stroke(.marker, .semantic("pink"), from: 20, to: 180)])
        let fake = FakeRecognizer(["hello"])
        #expect(await InkTranscript.text(of: drawing, using: fake) == "hello")
        let image = try #require(fake.images.first)
        #expect((image.width, image.height) == (400, 200)) // 2 pixels to a point
        #expect(pixel(image, x: 2, y: 2) == (255, 255, 255, 255), "the page is white")
        #expect(pixel(image, x: 140, y: 110) == (0, 0, 0, 255), "the pen is black, though it was yellow")
        #expect(pixel(image, x: 320, y: 114) == (255, 255, 255, 255), "the marker's stretch beyond the pen is not drawn")
    }

    @Test func aLongPageIsBroughtDownToWhatVisionReadsAt() throws {
        let image = try #require(InkTranscript.recognitionImage(of: InkDocument(width: 834, height: 8000, strokes: [stroke()])))
        #expect(max(image.width, image.height) == 4096)
    }

    @Test func nothingToReadIsNeverAsked() async {
        let fake = FakeRecognizer(["x"])
        #expect(await InkTranscript.text(of: InkDocument(width: 100, height: 100), using: fake) == "")
        #expect(await InkTranscript.text(of: InkDocument(width: 100, height: 100, strokes: [stroke(.marker)]), using: fake) == "")
        #expect(fake.images.isEmpty)
    }

    @Test func aRecognizerThatFailsLeavesNoWords() async {
        let drawing = InkDocument(width: 200, height: 100, strokes: [stroke()])
        #expect(await InkTranscript.text(of: drawing, using: FakeRecognizer(fails: true)) == "")
    }

    // Gate C item 263, 2026-11-12: Vision read a cursive signature as "Drien fucking" (sure of it, at 1.00, because language correction had snapped the marks to a common
    // word), and the words went into `alt`, the search index and what VoiceOver says. The reader's doubt is respected and a few words are never written on a guess.

    /// A drawing with something on it, for the tests below; what the reader "finds" in it comes from the fake.
    func drawing() -> InkDocument { InkDocument(width: 200, height: 100, strokes: [stroke()]) }

    @Test func aLineTheReaderWasUnsureOfIsNotWritten() async {
        let sure = InkRecognizedLine("Shopping list", confidence: 1)
        let guess = InkRecognizedLine("Sugarfrom", confidence: 0.3)
        #expect(await InkTranscript.text(of: drawing(), using: FakeRecognizer(lines: [sure, guess])) == "Shopping list")
        #expect(await InkTranscript.text(of: drawing(), using: FakeRecognizer(lines: [guess])) == "", "nothing left: the alt stays Drawing")
        // Exactly at the floor is kept; just under it is not.
        let atFloor = InkRecognizedLine("kept", confidence: InkTranscript.minimumConfidence)
        let under = InkRecognizedLine("dropped", confidence: InkTranscript.minimumConfidence - 0.01)
        #expect(await InkTranscript.text(of: drawing(), using: FakeRecognizer(lines: [atFloor, under])) == "kept")
    }

    @Test func aLineWithAWordThatIsNeverGuessedIsNotWritten() async {
        // The whole line goes, since a line with one such word in it is more likely a misread than a sentence; the person can type it into `alt` themselves.
        let lines = ["Meeting notes", "Drien fucking", "call Sam", "BULLSHIT!", "what the shit?", "   FuCkEr  "].map { InkRecognizedLine($0, confidence: 1) }
        #expect(await InkTranscript.text(of: drawing(), using: FakeRecognizer(lines: lines)) == "Meeting notes call Sam")
        #expect(InkTranscript.neverGuessed("a Cunt"))
        #expect(InkTranscript.neverGuessed("two bitches"))
        #expect(InkTranscript.neverGuessed("a shitty day") && InkTranscript.neverGuessed("horseshit") && InkTranscript.neverGuessed("motherfuckers"))
    }

    @Test func ordinaryWordsThatContainAListedOneAreKept() async {
        let lines = ["Scunthorpe", "shiitake mushrooms", "Rushing", "pushing the class", "assistant", "Dickens", "Matsushita", "Yoshitaka Nishitani"]
            .map { InkRecognizedLine($0, confidence: 1) }
        let text = await InkTranscript.text(of: drawing(), using: FakeRecognizer(lines: lines))
        #expect(text == "Scunthorpe shiitake mushrooms Rushing pushing the class assistant Dickens Matsushita Yoshitaka Nishitani")
        #expect(!InkTranscript.neverGuessed("") && !InkTranscript.neverGuessed("Hello, world"))
    }

    @Test func linesBecomeOneLineThatATagCanHold() {
        #expect(InkTranscript.normalized(["  Meeting  notes ", "", "call \"Sam\" <today>", "\tbuy\nmilk"]) == "Meeting notes call Sam today buy milk")
        #expect(InkTranscript.normalized([]) == "")
        #expect(InkTranscript.normalized(["\"<>\""]) == "")
        let long = Array(repeating: "word", count: 200)
        let cut = InkTranscript.normalized(long)
        #expect(cut.count <= InkTranscript.maxLength && cut.hasSuffix("word") && cut.split(separator: " ").allSatisfy { $0 == "word" })
        #expect(InkTranscript.normalized([String(repeating: "x", count: 500)]).count == InkTranscript.maxLength)
    }

    @Test func theTranscriptIsAMemberOfTheDrawingEveryReaderKeeps() throws {
        var drawing = InkDocument(width: 200, height: 100, strokes: [stroke()])
        #expect(drawing.transcript == nil)
        drawing.transcript = "hello world"
        let json = drawing.json
        #expect(json.objectValue?["transcript"]?.stringValue == "hello world")
        let again = try InkDocument(json: json)
        #expect(again.transcript == "hello world" && again.json == json)
        // Replacing and removing leave one member or none.
        drawing.transcript = "other"
        #expect(drawing.extra.filter { $0.key == "transcript" }.count == 1 && drawing.transcript == "other")
        drawing.transcript = nil
        #expect(drawing.transcript == nil && drawing.extra.isEmpty)
    }

    #if canImport(Vision)
    /// Text drawn with Core Text: not handwriting, but a picture of words that Vision must be able to read, which shows the seam is wired to the real thing.
    func pictureOf(_ text: String, size: CGFloat = 72) -> CGImage {
        let width = 900, height = 200
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, size, nil)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1)]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
        context.textPosition = CGPoint(x: 30, y: 70)
        CTLineDraw(line, context)
        return context.makeImage()!
    }

    /// Vision needs an inference context that a virtual machine (a CI runner) may not have; where it cannot run the test says so and passes, as it has nothing to check.
    func visionLines(in image: CGImage) async -> [InkRecognizedLine]? {
        do { return try await VisionTextRecognizer().lines(in: image) } catch {
            print("Vision cannot read text here, so this test checked nothing: \(error)")
            return nil
        }
    }

    @Test func visionReadsAPictureOfWords() async throws {
        guard let lines = await visionLines(in: pictureOf("Meeting notes")) else { return }
        let text = InkTranscript.normalized(lines.map(\.text)).lowercased()
        #expect(text.contains("meeting") && text.contains("notes"), "Vision read: \(lines)")
    }

    @Test func visionFindsNothingInABlankPage() async throws {
        guard let lines = await visionLines(in: pictureOf("")) else { return }
        #expect(lines.isEmpty)
    }
    #endif
}
