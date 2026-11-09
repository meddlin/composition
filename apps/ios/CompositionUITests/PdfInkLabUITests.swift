import XCTest

/// Spike B's lab, in the Simulator (which has no Pencil): the machinery that does not need one. A canvas is made for each page that comes on screen and
/// dropped as it goes; a finger still scrolls and selects text with Pencil-only canvases over the pages; with *Any input* a finger can draw; and a
/// 500-page book can be gone through without the canvases or the memory piling up. How the Pencil feels, and the latency, are the iPad's to say.
/// apps/ios/scripts/ui-test.sh passes the backup the app starts from.
@MainActor
final class PdfInkLabUITests: XCTestCase {
    private let app = XCUIApplication()

    private func launch(book: Int? = nil) throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup] + (book.map { ["-pdfInkLabBook", "\($0)"] } ?? [])
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        // The lab is in the More menu, with the editor lab.
        app.buttons["More"].firstMatch.tap()
        app.buttons["PDF ink lab (spike B)"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["ink-lab-pdf"].waitForExistence(timeout: 120), "the lab shows its PDF")
    }

    /// A switch is its label and its knob; a tap in the middle is on the label, so tap near the knob at the right.
    private func flip(_ identifier: String) {
        app.switches[identifier].coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
    }

    private var pdf: XCUIElement { app.descendants(matching: .any)["ink-lab-pdf"] }
    private var report: String { app.staticTexts["ink-lab-report"].exists ? app.staticTexts["ink-lab-report"].label : "" }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// The number after `label` in the report, e.g. `number(after: "strokes ")`.
    private func number(after label: String, in text: String) -> Int? {
        guard let range = text.range(of: label) else { return nil }
        return Int(text[range.upperBound...].prefix { $0.isNumber })
    }

    func testACanvasIsMadeForEachPageOnScreenAndAFingerStillScrollsAndSelects() throws {
        try launch()
        XCTAssertTrue(eventually { (self.number(after: "canvases on screen ", in: self.report) ?? 0) >= 1 }, "a canvas is over the page in view: \(report)")
        XCTAssertTrue(report.contains("page 1 "))

        // A finger drag over the canvases scrolls the pages (the canvases take the Pencil only).
        for _ in 0..<4 { pdf.swipeUp(velocity: .fast) }
        XCTAssertTrue(eventually { (self.number(after: "page ", in: self.report) ?? 1) > 1 }, "the finger scrolled: \(report)")
        XCTAssertEqual(number(after: "strokes ", in: report), 0, "without drawing: \(report)")
        // (Whether a finger's touches reach the canvas at all, or PencilKit lets them through, is in the report's "finger" count; it is not asserted.)

        // A long press selects words under the canvas.
        pdf.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)).press(forDuration: 1.2)
        XCTAssertTrue(eventually { (self.number(after: "selected ", in: self.report) ?? 0) > 0 }, "a long press selects words with canvases over the page: \(report)")
    }

    /// Asks the lab where a touch in the middle of the PDF lands, with the canvases Pencil-only and with any input, and says so. The Simulator's finger is not a Pencil, so
    /// this is the closest it gets to "can ink reach a canvas that PDFKit has put over a page": the answer is written down in the plan.
    func testWhereATouchLandsWithCanvasesOverThePages() throws {
        try launch()
        XCTAssertTrue(eventually { (self.number(after: "canvases on screen ", in: self.report) ?? 0) >= 1 })
        app.buttons["ink-lab-probe"].tap()
        XCTAssertTrue(eventually { self.report.contains("a probe touch landed on") }, report)
        print("SPIKE B (Simulator, Pencil only): \(report.components(separatedBy: "\n").last ?? "")")
        flip("ink-lab-pencil-only")
        app.buttons["ink-lab-probe"].tap()
        XCTAssertTrue(eventually { self.report.contains("policy: any input") }, report)
        print("SPIKE B (Simulator, any input): \(report.components(separatedBy: "\n").last ?? "")")
    }

    /// Takes a while: it makes a 500-page PDF, then goes through all of it. The numbers are printed so that they can be written down.
    func testABookOfFiveHundredPagesIsGoneThroughWithFewCanvasesAndSteadyMemory() throws {
        try launch(book: 500)
        XCTAssertTrue(eventually(120) { (self.number(after: "canvases on screen ", in: self.report) ?? 0) >= 1 }, "the big book opened with a canvas: \(report)")
        app.buttons["ink-lab-scroll"].tap()
        let summary = app.staticTexts["ink-lab-scroll-report"]
        XCTAssertTrue(summary.waitForExistence(timeout: 300), "going through the book finished")
        let text = summary.label
        print("SPIKE B (Simulator, 500 pages, canvases on): \(text)")
        XCTAssertTrue(text.contains("Went through all 500 pages"), text)
        let most = number(after: "taken off, at most ", in: text) ?? 99
        XCTAssertLessThanOrEqual(most, 8, "only the pages on screen have a canvas: \(text)")
        let made = number(after: "Canvases: ", in: text) ?? 0
        XCTAssertGreaterThan(number(after: "made, ", in: text) ?? 0, 4, "canvases were put on pages as they came on screen: \(text)")
        XCTAssertGreaterThan(made, 0)
        let end = number(after: "before, ", in: text) ?? 9999
        XCTAssertLessThan(end, 900, "memory at the end stays well under the size of the book's canvases: \(text)")

        // And the same with a stroke on every page, which is what a book marked on every page costs.
        flip("ink-lab-stroke-every")
        app.buttons["ink-lab-scroll"].tap()
        XCTAssertTrue(eventually(300) { self.app.staticTexts["ink-lab-scroll-report"].exists && self.app.staticTexts["ink-lab-scroll-report"].label != text }, "the second pass finished")
        let withStrokes = app.staticTexts["ink-lab-scroll-report"].label
        XCTAssertTrue(withStrokes.contains("strokes kept"), withStrokes)
        XCTAssertTrue(withStrokes.contains("500 strokes kept"), "a stroke on every page of the book is kept: \(withStrokes)")
        print("SPIKE B (Simulator, 500 pages, a stroke on every page): \(withStrokes)")
    }
}
