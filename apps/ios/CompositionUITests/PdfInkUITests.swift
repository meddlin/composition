import XCTest

/// M2, Pencil ink on a PDF: the pencil button, a stroke on a page (drawn here with a finger, which the Simulator has instead of a Pencil: "Finger draws"), the ink kept
/// beside the PDF and back after the app is ended, listed and cleared in the Highlights tab, and written into an exported copy. Nothing here uses a Pencil.
/// The PDF is made by the test. apps/ios/scripts/ui-test.sh passes the backup the app starts from. `-pdfInkNoPicker 1` leaves the system's tool picker out of the
/// way (it is the iPad's to judge); `-pdfInkFinger 1` is the "Finger draws" switch already on.
///
/// PDFKit does not expose the canvas over a page to the accessibility tree, so what is on the page is judged from its pixels: the lower part of the view (below the bar
/// that shows while drawing) before and after.
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

    private func pause(_ seconds: Double) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }

    // MARK: Looking at the page

    /// The lower part of the PDF view, which the bar at the top while drawing does not cover.
    private func page() -> UIImage? {
        guard let whole = pdfView.screenshot().image.cgImage else { return nil }
        let area = CGRect(x: 0, y: Int(Double(whole.height) * 0.40), width: whole.width, height: Int(Double(whole.height) * 0.55))
        return whole.cropping(to: area).map { UIImage(cgImage: $0) }
    }

    /// The share of sampled pixels that differ clearly between two pictures of the page (1 when they cannot be compared).
    private func difference(_ a: UIImage?, _ b: UIImage?) -> Double {
        guard let a = a?.cgImage, let b = b?.cgImage, a.width == b.width, a.height == b.height else { return 1 }
        func pixels(_ image: CGImage) -> [UInt8] {
            var data = [UInt8](repeating: 0, count: image.width * image.height * 4)
            let context = CGContext(data: &data, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return data
        }
        let (p, q) = (pixels(a), pixels(b))
        var different = 0, sampled = 0
        for i in stride(from: 0, to: p.count, by: 4 * 5) {
            sampled += 1
            if abs(Int(p[i]) - Int(q[i])) + abs(Int(p[i + 1]) - Int(q[i + 1])) + abs(Int(p[i + 2]) - Int(q[i + 2])) > 90 { different += 1 }
        }
        return Double(different) / Double(max(sampled, 1))
    }

    /// Whether the page now looks different from `before`: ink on it, or gone from it.
    private func looksDifferent(from before: UIImage?, _ timeout: TimeInterval = 15) -> Bool {
        eventually(timeout) { self.difference(self.page(), before) > 0.0005 }
    }

    private func looksTheSame(as before: UIImage?, _ timeout: TimeInterval = 15) -> Bool {
        eventually(timeout) { self.difference(self.page(), before) < 0.0005 }
    }

    // MARK: Drawing

    /// One stroke across the lower part of the view.
    private func scribble(from: CGVector = CGVector(dx: 0.25, dy: 0.80), to: CGVector = CGVector(dx: 0.70, dy: 0.88)) {
        pdfView.coordinate(withNormalizedOffset: from).press(forDuration: 0.1, thenDragTo: pdfView.coordinate(withNormalizedOffset: to))
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

    private func reopen() {
        app.terminate()
        app.launchArguments = ["-pdfInkNoPicker", "1"]
        app.launch()
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 60))
        if !pdfView.exists { row.tap() }
        XCTAssertTrue(pdfView.waitForExistence(timeout: 30))
        let picker = app.segmentedControls["pdf-pane-picker"]
        if picker.waitForExistence(timeout: 3) { picker.buttons["PDF"].tap() }
    }

    // MARK: Tests

    func testAStrokeWithAFingerIsInkOnThePage() {
        launch()
        pause(1)
        let blank = page()
        startDrawing()
        XCTAssertEqual(inkCount, "No ink yet")
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" }, "a stroke makes the page a page of ink: \(inkCount)")
        XCTAssertTrue(looksDifferent(from: blank), "the page looks different with the ink on it")
        let one = page()
        scribble(from: CGVector(dx: 0.30, dy: 0.84), to: CGVector(dx: 0.60, dy: 0.84))
        XCTAssertTrue(looksDifferent(from: one), "a second stroke is on the page too")
        XCTAssertEqual(inkCount, "Ink on 1 page", "two strokes on one page are still one page of ink")
        stopDrawing()
        XCTAssertFalse(looksTheSame(as: blank, 3), "ink still shows when the Pencil is put down")
    }

    func testWhenNotDrawingATouchIsNotInk() {
        launch()
        startDrawing()
        stopDrawing()
        scribble()
        pause(1.5)
        startDrawing()
        XCTAssertEqual(inkCount, "No ink yet", "a drag when the Pencil is not drawing leaves nothing")
    }

    func testTheFingerSwitchDecidesWhetherAFingerDraws() {
        launch(finger: false)
        startDrawing()
        XCTAssertTrue(element("pdf-ink-banner").staticTexts["Drawing with the Pencil"].exists)
        scribble()
        pause(1.5)
        XCTAssertEqual(inkCount, "No ink yet", "with the Pencil only, a finger draws nothing")
        element("pdf-ink-finger").switches.firstMatch.tap()
        XCTAssertTrue(eventually { self.element("pdf-ink-banner").staticTexts["Drawing with a finger or the Pencil"].exists })
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" }, "with the switch on, a finger draws")
    }

    func testInkComesBackAfterTheAppIsEnded() {
        launch()
        pause(1)
        let blank = page()
        startDrawing()
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" })
        stopDrawing()
        XCTAssertTrue(looksDifferent(from: blank))
        // The page is kept a moment after the last stroke; Done keeps it at once. Give the write time to finish.
        pause(2.5)
        reopen()
        openTab("Highlights")
        XCTAssertTrue(element("pdf-ink-page-0").waitForExistence(timeout: 30), "the page is a page of ink again: it was kept")
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(looksDifferent(from: blank, 30), "and the stroke is drawn on it")
    }

    func testInkIsKeptWhenThePageIsScrolledAwayAndBack() {
        launch()
        // Both pictures of the page are taken after the same swipes to the top, so that what differs between them is the ink and not where the page sits.
        func scrollToTop() {
            for _ in 0..<4 { pdfView.swipeDown(velocity: .fast) }
            pause(1.5)
        }
        scrollToTop()
        let blank = page()
        startDrawing()
        scribble()
        XCTAssertTrue(eventually { self.inkCount == "Ink on 1 page" })
        XCTAssertTrue(looksDifferent(from: blank))
        // With the Pencil put down a finger scrolls (with it picked up, and a finger drawing, a swipe would be a stroke).
        stopDrawing()
        let drawn = page()
        // Away to a far page: the page's canvas is emptied when it leaves, and filled again from what was kept when it comes back. (Swipes, not the "Go to page"
        // alert: that alert's Go button is not pressed by the UI tests on this Simulator, with or without ink.)
        var swipes = 0
        func faraway() -> Bool { self.element("pdf-page").label.hasPrefix("Page 6 ") || self.element("pdf-page").label.hasPrefix("Page 7 ") }
        while swipes < 40 && !eventually(0.5, { faraway() }) {
            pdfView.swipeUp(velocity: .fast)
            swipes += 1
        }
        XCTAssertTrue(faraway(), "scrolled far from page 1: \(element("pdf-page").label)")
        swipes = 0
        while swipes < 60 && !eventually(0.5, { self.element("pdf-page").label == "Page 1 of 12" }) {
            pdfView.swipeDown(velocity: .fast)
            swipes += 1
        }
        XCTAssertEqual(element("pdf-page").label, "Page 1 of 12")
        scrollToTop()
        XCTAssertFalse(looksTheSame(as: blank, 3), "the page is not blank: its ink came back")
        XCTAssertTrue(looksTheSame(as: drawn, 20), "and it is the ink that was there")
    }

    func testTheHighlightsTabListsPagesOfInkAndClearsOne() {
        launch()
        pause(1)
        let blank = page()
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
        XCTAssertTrue(looksTheSame(as: blank, 20), "and from the page")
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
        // (The result is a label with an icon, which is two elements with the one identifier: it is found by its words.)
        let written = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Written:'")).firstMatch
        XCTAssertTrue(written.waitForExistence(timeout: 60))
        XCTAssertTrue(written.label.contains("1 page of ink"), written.label)
    }
}
