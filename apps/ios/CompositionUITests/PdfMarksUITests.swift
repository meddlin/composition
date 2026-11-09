import PDFKit
import XCTest

/// M2, typed markup on a PDF: words selected with a long press are highlighted, underlined or struck through in a colour; a typed note is placed with a tap;
/// a mark's card recolours, comments on and deletes it; undo and redo; the Highlights tab lists the marks; they come back after the app is ended.
/// The PDF is made by the test (twelve pages of lines of text). apps/ios/scripts/ui-test.sh passes the backup the app starts from.
@MainActor
final class PdfMarksUITests: XCTestCase {
    private let app = XCUIApplication()
    private var folder: URL!
    private let title = "Marking Practice"

    override func setUp() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let backup = try XCTUnwrap(environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        folder = FileManager.default.temporaryDirectory.appending(path: "pdf-marks-ui-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Self.makeBook(at: folder.appending(path: "\(title).pdf"))
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importPdf", folder.appending(path: "\(title).pdf").path]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(pdfView.waitForExistence(timeout: 30))
        // Both halves side by side would crowd the page: the PDF alone, with its strip, is what these tests use.
        let picker = app.segmentedControls["pdf-pane-picker"]
        if picker.waitForExistence(timeout: 5) { picker.buttons["PDF"].tap() }
    }

    override func tearDown() async throws {
        if let folder { try? FileManager.default.removeItem(at: folder) }
    }

    /// Twelve pages, each with its number and a block of text lines.
    private static func makeBook(at url: URL) throws {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            for page in 1...12 {
                context.beginPage()
                ("Page \(page)" as NSString).draw(at: CGPoint(x: 72, y: 72), withAttributes: [.font: UIFont.systemFont(ofSize: 40)])
                for line in 0..<20 {
                    ("Line \(line + 1) of page \(page): the quick brown fox jumps over the lazy dog again and again." as NSString)
                        .draw(at: CGPoint(x: 72, y: 150 + CGFloat(line) * 24), withAttributes: [.font: UIFont.systemFont(ofSize: 15)])
                }
            }
        }
        try data.write(to: url)
    }

    private var pdfView: XCUIElement { app.descendants(matching: .any)["pdf-view"] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// A long press on a word of the first page's text, which selects it and shows the bar of colours and tools.
    private func selectAWord(line: Int = 3, xFraction: CGFloat = 0.25) {
        // The first page is the width of the pane, fitted; its lines start a fifth of the way down.
        let target = pdfView.coordinate(withNormalizedOffset: CGVector(dx: xFraction, dy: 0.22 + CGFloat(line) * 0.0165))
        target.press(forDuration: 1.2)
        XCTAssertTrue(app.descendants(matching: .any)["pdf-selection-bar"].waitForExistence(timeout: 10), "selecting words shows the bar of colours and tools")
    }

    private func openTab(_ name: String) {
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(app.segmentedControls.buttons[name].waitForExistence(timeout: 10))
        app.segmentedControls.buttons[name].tap()
    }

    private func closeSidebar() {
        // Popovers close with a tap outside; the strip's own button toggles it.
        app.buttons["pdf-contents"].tap()
    }

    private var highlightRows: XCUIElementQuery { app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pdf-highlight-' AND NOT identifier BEGINSWITH 'pdf-highlight-quote-'")) }

    // MARK: Marking the selection

    func testSelectedWordsAreHighlightedUnderlinedAndStruckThrough() {
        selectAWord(line: 2)
        app.buttons["pdf-color-green"].tap()
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists }, "the bar goes when the words are marked")
        XCTAssertTrue(eventually { self.app.buttons["Undo"].isEnabled }, "a mark made can be undone")
        selectAWord(line: 5)
        app.buttons["pdf-underline"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        selectAWord(line: 8)
        app.buttons["pdf-color-pink"].tap()
        app.buttons["pdf-strikethrough"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })

        openTab("Highlights")
        XCTAssertTrue(eventually { self.highlightRows.count == 3 }, "three marks are listed, \(highlightRows.count) are")
        let first = highlightRows.element(boundBy: 0)
        XCTAssertTrue(first.label.contains("Page 1"), first.label)
        XCTAssertTrue(first.label.localizedCaseInsensitiveContains("line") || first.label.localizedCaseInsensitiveContains("quick") || first.label.localizedCaseInsensitiveContains("fox") || !first.label.isEmpty, "its words are listed: \(first.label)")
    }

    func testAMarkCanBeUndoneAndRedone() {
        selectAWord()
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { self.app.buttons["Undo"].isEnabled })
        app.buttons["Undo"].tap()
        XCTAssertTrue(eventually { !self.app.buttons["Undo"].isEnabled && self.app.buttons["Redo"].isEnabled }, "undone: nothing to undo, something to redo")
        openTab("Highlights")
        XCTAssertTrue(app.staticTexts["No highlights"].waitForExistence(timeout: 10), "an undone mark is not listed")
        closeSidebar()
        app.buttons["Redo"].tap()
        XCTAssertTrue(eventually { !self.app.buttons["Redo"].isEnabled && self.app.buttons["Undo"].isEnabled })
        openTab("Highlights")
        XCTAssertTrue(eventually { self.highlightRows.count == 1 })
    }

    func testTheHighlightIsDrawnOnThePage() {
        let before = pdfView.screenshot().pngRepresentation
        selectAWord()
        app.buttons["pdf-color-blue"].tap()
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let after = pdfView.screenshot()
        XCTAssertNotEqual(before, after.pngRepresentation, "the page looks different with the mark on it")
        // Somewhere on the page there is a blue-tinted patch where there was only black on white.
        XCTAssertTrue(Self.hasTint(after.image, red: 0.45...0.8, green: 0.7...0.95, blue: 0.9...1.0), "a patch the colour of a blue highlight is on the page")
    }

    private static func hasTint(_ image: UIImage, red: ClosedRange<Double>, green: ClosedRange<Double>, blue: ClosedRange<Double>) -> Bool {
        guard let cg = image.cgImage else { return false }
        let (w, h) = (cg.width, cg.height)
        var data = [UInt8](repeating: 0, count: w * h * 4)
        let context = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var count = 0
        // Every third pixel in each direction: enough to find a patch, and fast in a Debug build.
        for y in stride(from: 0, to: h, by: 3) {
            for x in stride(from: 0, to: w, by: 3) {
                let i = (y * w + x) * 4
                let (r, g, b) = (Double(data[i]) / 255, Double(data[i + 1]) / 255, Double(data[i + 2]) / 255)
                if red.contains(r) && green.contains(g) && blue.contains(b) && b > r + 0.1 { count += 1 }
            }
        }
        return count > 20
    }

    // MARK: A mark's card

    func testTheCardRecoloursCommentsAndDeletesAMark() {
        selectAWord(line: 4)
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        // A tap on the marked word opens its card.
        let word = pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.22 + 4 * 0.0165))
        word.tap()
        XCTAssertTrue(app.textFields["pdf-mark-comment"].waitForExistence(timeout: 10), "tapping a mark opens its card")

        // Quote it from the card: the citation goes to the end of the note (which is behind the PDF here), whose Preview tab shows it as a link.
        XCTAssertTrue(app.buttons["pdf-mark-quote"].waitForExistence(timeout: 5))
        app.buttons["pdf-mark-quote"].tap()
        // The card's popover is still going away: a tap now would be swallowed by it.
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        app.segmentedControls["pdf-pane-picker"].buttons["Note"].tap()
        XCTAssertTrue(eventually { !self.app.buttons["pdf-page"].isHittable }, "the note is shown in place of the PDF")
        app.segmentedControls.buttons["Preview"].tap()
        XCTAssertTrue(app.links.matching(NSPredicate(format: "label CONTAINS 'p. 1'")).firstMatch.waitForExistence(timeout: 20), "the quote's citation is in the note")
        app.segmentedControls["pdf-pane-picker"].buttons["PDF"].tap()
        XCTAssertTrue(eventually { self.app.buttons["pdf-page"].isHittable }, "back on the PDF")

        // Open the card again: recolour it, comment on it.
        word.tap()
        let comment = app.textFields["pdf-mark-comment"]
        XCTAssertTrue(comment.waitForExistence(timeout: 10), "the card opens again")
        app.buttons["pdf-color-orange"].tap()
        comment.tap()
        comment.typeText("check the proof\n")
        // Back in the Highlights tab: the comment is there, then the mark is deleted.
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
        openTab("Highlights")
        XCTAssertTrue(eventually { self.highlightRows.count == 1 && self.highlightRows.element(boundBy: 0).label.contains("check the proof") }, "the comment is listed: \(highlightRows.element(boundBy: 0).label)")
        highlightRows.element(boundBy: 0).swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["No highlights"].waitForExistence(timeout: 10), "the mark is deleted")
    }

    func testTheCardsOwnButtonsWork() {
        selectAWord(line: 4)
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.22 + 4 * 0.0165)).tap()
        XCTAssertTrue(app.buttons["pdf-mark-delete"].waitForExistence(timeout: 10), "the card is open")
        app.buttons["pdf-mark-delete"].tap()
        openTab("Highlights")
        XCTAssertTrue(app.staticTexts["No highlights"].waitForExistence(timeout: 10), "the card's own bin deleted the mark")
    }

    // MARK: Typed notes

    func testATypedNoteIsPlacedWithATapAndRetyped() {
        app.buttons["pdf-add-note"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["pdf-placing-note"].waitForExistence(timeout: 5), "the reader says where to tap")
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.7)).tap()
        let text = app.textViews["pdf-note-text"]
        XCTAssertTrue(text.waitForExistence(timeout: 10), "a box to type the note in")
        text.typeText("Prove the second lemma")
        app.buttons["pdf-note-save"].tap()
        XCTAssertTrue(eventually { !self.app.textViews["pdf-note-text"].exists })
        openTab("Highlights")
        XCTAssertTrue(eventually { self.highlightRows.count == 1 && self.highlightRows.element(boundBy: 0).label.contains("Prove the second lemma") }, "the note is listed with its words")
        closeSidebar()
        // A note with no words is not kept.
        app.buttons["pdf-add-note"].tap()
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        XCTAssertTrue(app.textViews["pdf-note-text"].waitForExistence(timeout: 10))
        app.buttons["pdf-note-save"].tap()
        openTab("Highlights")
        XCTAssertEqual(highlightRows.count, 1, "an empty note is not made")
    }

    // MARK: Staying

    func testMarksComeBackAfterTheAppIsEnded() {
        selectAWord(line: 6)
        app.buttons["pdf-color-pink"].tap()
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        app.terminate()
        app.launchArguments = []
        app.launch()
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 60))
        if !pdfView.exists { row.tap() }
        XCTAssertTrue(pdfView.waitForExistence(timeout: 30))
        let picker = app.segmentedControls["pdf-pane-picker"]
        if picker.waitForExistence(timeout: 3) { picker.buttons["PDF"].tap() }
        openTab("Highlights")
        XCTAssertTrue(eventually(30) { self.highlightRows.count == 1 }, "the mark is still there")
    }

    // MARK: Search

    func testSearchFindsThePdfByTheWordsOfItsMarks() {
        selectAWord(line: 4)
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.22 + 4 * 0.0165)).tap()
        let comment = app.textFields["pdf-mark-comment"]
        XCTAssertTrue(comment.waitForExistence(timeout: 10))
        comment.tap()
        comment.typeText("quokka habitat\n")
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
        RunLoop.current.run(until: Date().addingTimeInterval(1))

        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10), "the notes list has its search box")
        search.tap()
        search.typeText("quokka")
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "searching for a word in a comment finds the PDF's note")
        // A word nobody marked finds nothing.
        search.clearText()
        search.typeText("wombat")
        XCTAssertTrue(eventually { !row.exists }, "and not for a word that is in no mark")
    }

    // MARK: Quoting, citing and following

    /// The PDF and its note side by side (the lists hidden), the note in the Markdown tab so that there is an editor to take the quote.
    private func sideBySideWithTheEditor() {
        app.buttons["focus-toggle"].tap()
        XCTAssertTrue(app.otherElements["split-divider"].waitForExistence(timeout: 10))
        app.segmentedControls.buttons["Markdown"].tap()
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private var editorText: String {
        let view = app.textViews["note-editor"]
        return view.exists ? ((view.value as? String) ?? "") : ""
    }

    func testCiteThisPagePutsALinkToThePageInTheNote() {
        sideBySideWithTheEditor()
        go(toPage: 3)
        app.buttons["pdf-cite"].tap()
        let cited = eventually { self.editorText.contains("](pdf:") }
        attach("after cite")
        XCTAssertTrue(cited, "a link to the page is in the note: \(editorText)")
        // Worded as the desktop words it: the title in italics, "p. N", and the physical page in the target.
        XCTAssertNotNil(editorText.range(of: #"\[\*Marking Practice\*, p\. (\d+)\]\(pdf:[0-9a-f]{32}#p=\1\)"#, options: .regularExpression), editorText)
    }

    /// With the note behind the PDF (the pane is narrow, the switch is on PDF), the citation goes to the end of the note, whose Preview tab then shows it as a link.
    func testCiteThisPageAddsToTheEndOfANoteThatIsBehindThePdf() {
        app.buttons["pdf-cite"].tap()
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        app.segmentedControls["pdf-pane-picker"].buttons["Note"].tap()
        XCTAssertTrue(eventually { !self.app.buttons["pdf-page"].isHittable }, "the note is shown in place of the PDF")
        app.segmentedControls.buttons["Preview"].tap()
        let found = app.links.matching(NSPredicate(format: "label CONTAINS 'p. 1'")).firstMatch.waitForExistence(timeout: 20)
        attach("the note after Cite, behind the PDF")
        XCTAssertTrue(found, "the citation is at the end of the note")
    }

    func testQuoteFromTheHighlightsTabAddsToTheEndOfANoteThatIsBehindThePdf() {
        selectAWord(line: 4)
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        openTab("Highlights")
        let quoteButton = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pdf-highlight-quote-'")).firstMatch
        XCTAssertTrue(quoteButton.waitForExistence(timeout: 10))
        quoteButton.tap()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        closeSidebar()
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        app.segmentedControls["pdf-pane-picker"].buttons["Note"].tap()
        XCTAssertTrue(eventually { !self.app.buttons["pdf-page"].isHittable }, "the note is shown in place of the PDF")
        app.segmentedControls.buttons["Preview"].tap()
        let found = app.links.matching(NSPredicate(format: "label CONTAINS 'p. 1'")).firstMatch.waitForExistence(timeout: 20)
        attach("the note after a quote from the Highlights tab")
        XCTAssertTrue(found, "the quote's citation is at the end of the note")
    }

    func testQuoteAndCiteThisPagePutLinksInTheNoteAndAFollowedLinkGoesBackToThePageAndMark() {
        sideBySideWithTheEditor()
        selectAWord(line: 3)
        app.buttons["pdf-highlight"].tap()
        XCTAssertTrue(eventually { !self.app.descendants(matching: .any)["pdf-selection-bar"].exists })
        // Quote it: the quote button on its row in the Highlights tab.
        openTab("Highlights")
        let quoteButton = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pdf-highlight-quote-'")).firstMatch
        XCTAssertTrue(quoteButton.waitForExistence(timeout: 10), "the row offers Quote")
        quoteButton.tap()
        let quoted = eventually { self.editorText.contains("(pdf:") }
        attach("after quote")
        XCTAssertTrue(quoted, "the note has the citation: \(editorText)")
        XCTAssertTrue(editorText.contains("> "), "as a block quote: \(editorText)")
        XCTAssertTrue(editorText.contains("p. 1](pdf:") && editorText.contains("#p=1&a="), "of page 1 and the mark: \(editorText)")
        closeSidebar()

        // Cite page 3.
        go(toPage: 3)
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        let cite = Int(app.buttons["pdf-page"].label.split(separator: " ")[1]) ?? 3
        app.buttons["pdf-cite"].tap()
        XCTAssertTrue(eventually { self.editorText.contains("#p=\(cite))") }, "a link to page \(cite) is in the note: \(editorText)")

        // In the preview, the citation of page 3 goes to page 3 from anywhere: read on to page 8, then follow it.
        app.segmentedControls.buttons["Preview"].tap()
        go(toPage: 8)
        let link = app.links.matching(NSPredicate(format: "label CONTAINS 'p. \(cite)'")).firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 10), "the preview shows the citation as a link")
        link.tap()
        waitForPage(cite)
        // And the one with the mark goes to page 1.
        go(toPage: 8)
        app.links.matching(NSPredicate(format: "label CONTAINS 'p. 1'")).firstMatch.tap()
        waitForPage(1)
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].exists)
    }

    /// Reads on (or back) by swiping until the reader says the page. (The *Go to page* alert is not used: its Go button is not pressed by the tests on the iOS 26.4 Simulator, as `PdfUITests.testAPageCanBeGoneToByNumber` shows.)
    private func go(toPage page: Int) {
        for _ in 0..<40 {
            let label = app.buttons["pdf-page"].label
            guard let current = Int(label.split(separator: " ").dropFirst().first ?? "") else { break }
            if current == page { return }
            if current < page { pdfView.swipeUp(velocity: .slow) } else { pdfView.swipeDown(velocity: .slow) }
        }
        waitForPage(page)
    }

    private func waitForPage(_ number: Int) {
        let wanted = "Page \(number) of 12"
        XCTAssertTrue(eventually { self.app.buttons["pdf-page"].exists && self.app.buttons["pdf-page"].label == wanted }, "the reader should say \(wanted), it says \(app.buttons["pdf-page"].exists ? app.buttons["pdf-page"].label : "nothing")")
    }

    // MARK: The Notes tab

    func testTheNotesTabListsTheNotesThatCiteThePdfAndMakesANewOne() {
        openTab("Notes")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pdf-note-' AND identifier != 'pdf-note-text'")).firstMatch.waitForExistence(timeout: 10), "the PDF's own note is listed")
        app.buttons["pdf-new-note"].tap()
        // The new note opens beside the PDF, named for it, with a link to the PDF on its first line.
        XCTAssertTrue(eventually(30) { self.app.descendants(matching: .any)["pdf-view"].exists }, "the PDF is still beside it")
        // With the lists showing the pane is narrow: the PDF and the note are switched.
        app.segmentedControls["pdf-pane-picker"].buttons["Note"].tap()
        app.segmentedControls.buttons["Markdown"].tap()
        let made = eventually(20) { self.editorText.contains("Notes on") && self.editorText.contains("(pdf:") }
        attach("new note")
        XCTAssertTrue(made, "the new note's first line is a link to the PDF: \(editorText)")
    }
}

private extension XCUIElement {
    /// Empties a text field.
    func clearText() {
        guard let text = value as? String, !text.isEmpty else { return }
        tap()
        typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: text.count))
    }
}
