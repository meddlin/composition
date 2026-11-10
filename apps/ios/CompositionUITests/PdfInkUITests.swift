import XCTest

/// M2, Pencil ink on a PDF: the pencil button, a stroke on a page (drawn here with a finger, which the Simulator has instead of a Pencil: "Finger draws"), the ink kept
/// beside the PDF and back after the app is ended, listed and cleared in the Highlights tab, and written into an exported copy. Nothing here uses a Pencil.
/// The PDF is made by the test. apps/ios/scripts/ui-test.sh passes the backup the app starts from. `-pdfInkNoPicker 1` leaves the system's tool picker out of the
/// way (it is the iPad's to judge); `-pdfInkFinger 1` is the "Finger draws" switch already on.
@MainActor
final class PdfInkUITests: XCTestCase {
    private let app = XCUIApplication()
    private var folder: URL!
    private var backup = ""
    private let title = "Sketching Practice"

    override func setUp() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        backup = try XCTUnwrap(environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        folder = FileManager.default.temporaryDirectory.appending(path: "pdf-ink-ui-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Self.makeBook(at: folder.appending(path: "\(title).pdf"))
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    override func tearDown() async throws {
        if let folder { try? FileManager.default.removeItem(at: folder) }
    }

    private func launch(finger: Bool = true) {
        app.launchArguments = ["-importBackup", backup, "-importPdf", folder.appending(path: "\(title).pdf").path, "-pdfInkNoPicker", "1", "-pdfInkFinger", finger ? "1" : "0"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(pdfView.waitForExistence(timeout: 30))
        let picker = app.segmentedControls["pdf-pane-picker"]
        if picker.waitForExistence(timeout: 5) { picker.buttons["PDF"].tap() }
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
    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// One stroke across the first page, in the blank space below its text.
    private func scribble(from: CGVector = CGVector(dx: 0.25, dy: 0.80), to: CGVector = CGVector(dx: 0.70, dy: 0.88)) {
        let start = pdfView.coordinate(withNormalizedOffset: from)
        start.press(forDuration: 0.1, thenDragTo: pdfView.coordinate(withNormalizedOffset: to))
    }

    private func startDrawing() {
        app.buttons["pdf-ink"].tap()
        XCTAssertTrue(element("pdf-ink-banner").waitForExistence(timeout: 10), "the pencil button shows that the pages take ink")
    }

    private func stopDrawing() {
        app.buttons["pdf-ink-done"].tap()
        XCTAssertTrue(eventually { !self.element("pdf-ink-banner").exists })
    }

    private var inkCount: String { element("pdf-ink-count").label }

    private func openTab(_ name: String) {
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(app.segmentedControls.buttons[name].waitForExistence(timeout: 10))
        app.segmentedControls.buttons[name].tap()
    }

    // MARK: Drawing

    func testAStrokeWithAFingerIsInkOnThePage() {
        launch()
        let before = pdfView.screenshot().pngRepresentation
        startDrawing()
        XCTAssertEqual(inkCount, "No ink yet")
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" }, "a stroke makes the page a page of ink: \(inkCount)")
        let canvas = element("pdf-ink-canvas-0")
        XCTAssertTrue(canvas.waitForExistence(timeout: 10), "the page's canvas says it has handwriting")
        XCTAssertEqual(canvas.value as? String, "1 strokes")
        XCTAssertNotEqual(before, pdfView.screenshot().pngRepresentation, "the page looks different with the ink on it")

        scribble(from: CGVector(dx: 0.30, dy: 0.84), to: CGVector(dx: 0.60, dy: 0.84))
        XCTAssertTrue(eventually { (self.element("pdf-ink-canvas-0").value as? String) == "2 strokes" }, "a second stroke is a second stroke")
        XCTAssertEqual(inkCount, "Ink on 1 page")
        stopDrawing()
        XCTAssertTrue(element("pdf-ink-canvas-0").exists, "ink still shows when the Pencil is put down")
    }

    func testWhenNotDrawingATouchIsNotInk() {
        launch()
        startDrawing()
        stopDrawing()
        scribble()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertFalse(element("pdf-ink-canvas-0").exists, "a drag when the Pencil is not drawing leaves nothing")
        startDrawing()
        XCTAssertEqual(inkCount, "No ink yet")
    }

    func testTheFingerSwitchDecidesWhetherAFingerDraws() {
        launch(finger: false)
        startDrawing()
        XCTAssertTrue(element("pdf-ink-banner").staticTexts["Drawing with the Pencil"].exists)
        scribble()
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        XCTAssertEqual(inkCount, "No ink yet", "with the Pencil only, a finger draws nothing")
        element("pdf-ink-finger").switches.firstMatch.tap()
        XCTAssertTrue(eventually { self.element("pdf-ink-banner").staticTexts["Drawing with a finger or the Pencil"].exists })
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" }, "with the switch on, a finger draws")
    }

    // MARK: Kept

    func testInkComesBackAfterTheAppIsEnded() {
        launch()
        startDrawing()
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" })
        stopDrawing()
        // The page is kept a moment after the last stroke; Done keeps it at once. Give the write time to finish.
        RunLoop.current.run(until: Date().addingTimeInterval(2.5))
        app.terminate()
        app.launchArguments = ["-pdfInkNoPicker", "1"]
        app.launch()
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 60))
        if !pdfView.exists { row.tap() }
        XCTAssertTrue(pdfView.waitForExistence(timeout: 30))
        let picker = app.segmentedControls["pdf-pane-picker"]
        if picker.waitForExistence(timeout: 3) { picker.buttons["PDF"].tap() }
        XCTAssertTrue(element("pdf-ink-canvas-0").waitForExistence(timeout: 30), "the stroke is on the page again")
        XCTAssertEqual(element("pdf-ink-canvas-0").value as? String, "1 strokes")
        startDrawing()
        XCTAssertEqual(inkCount, "Ink on 1 page")
    }

    func testInkOnAnotherPageIsKeptWhenThePageIsScrolledAway() {
        launch()
        startDrawing()
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" })
        // Away to page 6 and back: the page's canvas is emptied and filled again from what was kept.
        app.buttons["pdf-page"].tap()
        let go = app.alerts["Go to page"]
        XCTAssertTrue(go.waitForExistence(timeout: 10))
        go.textFields.firstMatch.typeText("6")
        go.buttons["Go"].tap()
        XCTAssertTrue(eventually { !self.element("pdf-ink-canvas-0").exists }, "page 1 is far off the screen")
        app.buttons["pdf-page"].tap()
        XCTAssertTrue(go.waitForExistence(timeout: 10))
        go.textFields.firstMatch.typeText("1")
        go.buttons["Go"].tap()
        XCTAssertTrue(element("pdf-ink-canvas-0").waitForExistence(timeout: 20), "the ink is back when its page is")
        XCTAssertEqual(element("pdf-ink-canvas-0").value as? String, "1 strokes")
    }

    // MARK: Listed, cleared, exported

    func testTheHighlightsTabListsPagesOfInkAndClearsOne() {
        launch()
        startDrawing()
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" })
        stopDrawing()
        openTab("Highlights")
        let row = element("pdf-ink-page-0")
        XCTAssertTrue(row.waitForExistence(timeout: 10), "page 1 is listed as handwriting")
        row.swipeLeft()
        app.buttons["Clear ink"].tap()
        XCTAssertTrue(eventually { !self.element("pdf-ink-page-0").exists }, "the page's ink is gone from the list")
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(eventually { !self.element("pdf-ink-canvas-0").exists }, "and from the page")
    }

    func testExportWritesThePagesOfInk() {
        launch()
        startDrawing()
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" })
        stopDrawing()
        app.buttons["pdf-export"].tap()
        XCTAssertTrue(app.staticTexts["Pages of ink"].waitForExistence(timeout: 10), "the sheet counts the pages of ink")
        app.buttons["pdf-export-go"].tap()
        let done = element("pdf-export-done")
        XCTAssertTrue(done.waitForExistence(timeout: 60))
        XCTAssertTrue(done.label.contains("1 page of ink"), done.label)
    }
}
