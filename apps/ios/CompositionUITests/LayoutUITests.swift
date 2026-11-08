import XCTest

/// The room for writing: the divider between the editor and the preview in Split can be dragged (and put back in the middle with a double tap), and
/// the note's toolbar can hide the notebooks and the notes list together, and bring them back. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class LayoutUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() async throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup; Split shows the editor and the preview.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Split"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(app.textViews["note-editor"].waitForExistence(timeout: 30))
    }

    private func eventually(_ timeout: TimeInterval = 15, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private var divider: XCUIElement { app.descendants(matching: .any)["split-divider"] }
    private var editor: XCUIElement { app.textViews["note-editor"] }

    func testTheDividerBetweenTheEditorAndThePreviewCanBeDraggedAndPutBack() {
        XCTAssertTrue(divider.waitForExistence(timeout: 10), "Split has a divider")
        // With the lists showing, the note's pane is narrower than 800 points, so the halves are one above the other and the divider is a bar across.
        let stacked = divider.frame.width > divider.frame.height
        // Where the divider was left is kept (and a copy of the Simulator carries it over): start from the middle.
        divider.doubleTap()
        _ = eventually(3) { false }
        let before = stacked ? editor.frame.height : editor.frame.width
        XCTAssertGreaterThan(before, 100, "the editor has room to start with")

        let start = divider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let towardsTheEditor = stacked ? CGVector(dx: 0, dy: -120) : CGVector(dx: -120, dy: 0)
        start.press(forDuration: 0.2, thenDragTo: start.withOffset(towardsTheEditor))
        XCTAssertTrue(eventually { (stacked ? self.editor.frame.height : self.editor.frame.width) < before - 60 }, "dragging the divider towards the editor gives the preview more room: stacked=\(stacked) before=\(before) divider=\(divider.frame) editor=\(editor.frame)")

        let smaller = stacked ? editor.frame.height : editor.frame.width
        let handle = divider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let awayFromTheEditor = stacked ? CGVector(dx: 0, dy: 300) : CGVector(dx: 300, dy: 0)
        handle.press(forDuration: 0.2, thenDragTo: handle.withOffset(awayFromTheEditor))
        XCTAssertTrue(eventually { (stacked ? self.editor.frame.height : self.editor.frame.width) > smaller + 100 }, "and the other way gives the editor more")

        divider.doubleTap()
        XCTAssertTrue(eventually { abs((stacked ? self.editor.frame.height : self.editor.frame.width) - before) < 12 }, "a double tap puts it back in the middle")
    }

    func testTheNotesToolbarHidesBothListsAndBringsThemBack() {
        let button = app.buttons["focus-toggle"]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "the note's toolbar has a button for hiding the lists")
        // (Elements that are always on screen: the notes list's search field, and the first row of the notebooks.)
        let notes = app.searchFields.firstMatch
        let notebooks = app.descendants(matching: .any)["sidebar-all"]
        XCTAssertTrue(eventually { notes.isHittable && notebooks.isHittable }, "to start with, both the notebooks and the notes list show")
        XCTAssertTrue(divider.frame.width > divider.frame.height, "with them showing, the note's pane is narrow: Split puts the halves one above the other")

        button.tap()
        XCTAssertTrue(eventually { !notes.isHittable && !notebooks.isHittable }, "the button hides both lists")
        XCTAssertTrue(eventually { self.divider.frame.height > self.divider.frame.width }, "and the note has their room: Split puts the halves side by side")
        XCTAssertTrue(eventually { app.buttons["focus-toggle"].label == "Show the lists" }, "the button now offers to bring them back: \(app.buttons["focus-toggle"].label)")

        app.buttons["focus-toggle"].tap()
        XCTAssertTrue(eventually { app.buttons["focus-toggle"].label == "Hide the lists" }, "the button took the tap: \(app.buttons["focus-toggle"].label)")
        XCTAssertTrue(eventually { notes.isHittable && notebooks.isHittable }, "the same button brings both back: notes \(notes.exists)/\(notes.isHittable) \(notes.frame), notebooks \(notebooks.exists)/\(notebooks.isHittable) \(notebooks.frame)")
        XCTAssertTrue(eventually { self.divider.frame.width > self.divider.frame.height }, "and the halves are one above the other again")
    }
}
