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
        // Vision's reading of a finger's line is nothing, or a stray mark: either way the tag is a `src`, an `alt` and no `width` (the drawing is shown at its own size).
        XCTAssertTrue(tag.range(of: #"\.png" alt="[^"]*" />$"#, options: .regularExpression) != nil, tag)
        XCTAssertFalse(tag.contains("width="), tag)
        let shown = app.descendants(matching: .any)["ink-picture"].waitForExistence(timeout: 20)
        if !shown { print("INK UI TEST: no ink-picture in the tree:\n\(app.debugDescription)") }
        XCTAssertTrue(shown, "the preview shows the drawing")
    }

    func testTheStoredDrawingIsCutToWhatWasDrawn() {
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        let canvas = openCanvas()
        // A wide, flat stroke across a screen-sized page: 50 % of the width, 30 % of the height.
        scribble(on: canvas, from: CGVector(dx: 0.2, dy: 0.3), to: CGVector(dx: 0.7, dy: 0.6))
        let page = canvas.frame.size
        app.buttons["ink-done"].tap()
        let picture = app.descendants(matching: .any)["ink-picture"]
        XCTAssertTrue(picture.waitForExistence(timeout: 20), "the preview shows the drawing")
        let shape = picture.frame.size
        // The picture is the ink and its margin, so its proportions are the stroke's (about 2:1 here), not the screen's (about 1.4:1), whatever size the column shows it at.
        let screen = page.width / page.height
        XCTAssertGreaterThan(shape.width / shape.height, screen * 1.25, "the picture is \(shape) and the page was \(page): it was not cut")
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

    /// Found on the iPad (2026-11-11): after *Done* on an edited drawing the preview kept showing the old picture until the tab was changed and changed back. The note named the new file
    /// at once, but the preview drew the new name with the old strokes (they load a moment later) and never drew again. The second stroke runs the other way and widens the drawing's
    /// box, so the picture's proportions are what tell the old picture from the new one.
    func testThePreviewShowsTheEditedDrawingAtOnceAndNotTheOldPicture() {
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        var canvas = openCanvas()
        scribble(on: canvas, from: CGVector(dx: 0.2, dy: 0.3), to: CGVector(dx: 0.7, dy: 0.6))
        app.buttons["ink-done"].tap()
        XCTAssertTrue(eventually { tags().count == 1 })
        let first = tags()[0]

        let picture = app.descendants(matching: .any)["ink-picture"]
        XCTAssertTrue(picture.waitForExistence(timeout: 20))
        let before = picture.frame.size
        picture.tap()
        canvas = app.descendants(matching: .any)["ink-canvas"]
        XCTAssertTrue(canvas.waitForExistence(timeout: 20), "a tap on the drawing opens it again")
        scribble(on: canvas, from: CGVector(dx: 0.3, dy: 0.7), to: CGVector(dx: 0.8, dy: 0.2))
        app.buttons["ink-done"].tap()
        XCTAssertTrue(eventually { tags().first.map { $0 != first } ?? false }, "the note names the edited drawing: \(tags())")

        // The first drawing is about 5:3 (a stroke 50 % of the width by 30 % of the height of a landscape page); with the second stroke it is about 6:5.
        let wide = before.width / before.height
        XCTAssertTrue(eventually {
            let now = app.descendants(matching: .any)["ink-picture"].frame.size
            return now.height > 0 && now.width / now.height < wide * 0.85
        }, "the preview still shows the old picture (\(before) before, \(app.descendants(matching: .any)["ink-picture"].frame.size) now)")
    }
}
