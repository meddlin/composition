import XCTest

/// M2: drawing. The Image menu's *Drawing…* opens PencilKit's canvas full screen; what is drawn is stored as a PNG that carries its strokes and written into the note
/// as an `<Ink>` tag, and the preview shows it. A tap on the drawing in the preview opens the canvas again on the same strokes, and what comes back is stored under a
/// new name that the note then uses. The Pencil itself (latency, hover, the tool picker's feel) is tried by hand; here a finger draws, which PencilKit allows when no Pencil
/// is paired. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class InkUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() async throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup; it opens in Split, the editor beside the preview.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Split"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
    }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var text: String { (editor.value as? String) ?? "" }
    private let prefix = "<Ink src=\"app_data/ci-cd-pipelines-cheat-sheet-drawing-"

    private func tags() -> [String] {
        text.components(separatedBy: "\n").filter { $0.hasPrefix("<Ink ") }
    }

    private func openCanvas() -> XCUIElement {
        app.buttons["Image"].firstMatch.tap()
        let item = app.buttons["new-drawing"]
        XCTAssertTrue(item.waitForExistence(timeout: 10), "the Image menu offers a drawing")
        item.tap()
        let canvas = app.descendants(matching: .any)["ink-canvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 20), "the canvas opens")
        return canvas
    }

    private func scribble(on canvas: XCUIElement, from: CGVector, to: CGVector) {
        canvas.coordinate(withNormalizedOffset: from).press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: to))
    }

    func testADrawingIsStoredWrittenIntoTheNoteAndShownInThePreview() {
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        XCTAssertTrue(tags().isEmpty, "the note has no drawing to begin with")
        let canvas = openCanvas()
        scribble(on: canvas, from: CGVector(dx: 0.2, dy: 0.3), to: CGVector(dx: 0.7, dy: 0.6))
        app.buttons["ink-done"].tap()
        XCTAssertTrue(eventually { tags().count == 1 }, "the tag is in the note: \(text)")
        let tag = tags()[0]
        XCTAssertTrue(tag.hasPrefix(prefix), "the PNG is stored under the note's title and a hash of its bytes: \(tag)")
        XCTAssertTrue(tag.hasSuffix(".png\" alt=\"Drawing\" width=\"80%\" />"), tag)
        let shown = app.descendants(matching: .any)["ink-picture"].waitForExistence(timeout: 20)
        if !shown { print("INK UI TEST: no ink-picture in the tree:\n\(app.debugDescription)") }
        XCTAssertTrue(shown, "the preview shows the drawing")
    }

    func testCancelOnABlankPageLeavesTheNoteAlone() {
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        let before = text
        _ = openCanvas()
        app.buttons["ink-cancel"].tap()
        XCTAssertTrue(eventually { !app.descendants(matching: .any)["ink-canvas"].exists }, "the canvas closes")
        XCTAssertEqual(text, before)
    }

    func testDoneOnABlankPageIsACancel() {
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        let before = text
        _ = openCanvas()
        app.buttons["ink-done"].tap()
        XCTAssertTrue(eventually { !app.descendants(matching: .any)["ink-canvas"].exists }, "the canvas closes")
        XCTAssertEqual(text, before, "nothing is inserted for an empty page")
    }

    func testTappingTheDrawingInThePreviewEditsItAndTheNoteTakesTheNewPicture() {
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        var canvas = openCanvas()
        scribble(on: canvas, from: CGVector(dx: 0.2, dy: 0.3), to: CGVector(dx: 0.7, dy: 0.6))
        app.buttons["ink-done"].tap()
        XCTAssertTrue(eventually { tags().count == 1 })
        let first = tags()[0]

        let picture = app.descendants(matching: .any)["ink-picture"]
        XCTAssertTrue(picture.waitForExistence(timeout: 20))
        picture.tap()
        canvas = app.descendants(matching: .any)["ink-canvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 20), "a tap on the drawing opens it again")
        scribble(on: canvas, from: CGVector(dx: 0.3, dy: 0.7), to: CGVector(dx: 0.8, dy: 0.2))
        app.buttons["ink-done"].tap()

        XCTAssertTrue(eventually { tags().first.map { $0 != first } ?? false }, "the note names the edited drawing: \(tags())")
        XCTAssertEqual(tags().count, 1, "in place of the old one, not beside it")
        XCTAssertTrue(app.descendants(matching: .any)["ink-picture"].waitForExistence(timeout: 20))
    }
}
