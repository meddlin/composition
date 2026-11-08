import XCTest

/// Build plan Step 8: a picture put in a note. The Photos picker and the camera are the system's and are tried by hand; this checks what they all lead to, through
/// the app's own launch shortcut (`-pasteImage`, which does what choosing or pasting that file does): the picture is stored under the desktop's naming, written
/// into the note as Markdown after its frontmatter, and shown in the preview. apps/ios/scripts/ui-test.sh passes the backup and a picture in.
@MainActor
final class ImagesUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let backup = try XCTUnwrap(environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        let picture = try XCTUnwrap(environment["COMPOSITION_UI_IMAGE"], "Run apps/ios/scripts/ui-test.sh: it passes a picture.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup; it opens in Split, the editor beside the preview.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Split", "-pasteImage", picture]
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

    func testAPictureIsStoredAndWrittenIntoTheNoteAfterItsFrontmatter() {
        let editor = app.textViews["note-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        let wanted = "](app_data/ci-cd-pipelines-cheat-sheet-"  // the note's title, then the picture's name and a hash of its bytes
        XCTAssertTrue(eventually { (editor.value as? String)?.contains(wanted) == true }, "the picture's Markdown is in the note: \(String(describing: editor.value))")
        let text = (editor.value as? String) ?? ""
        let frontmatterEnd = (text as NSString).range(of: "\n---\n", options: [], range: NSRange(location: 3, length: text.count - 3)).upperBound
        XCTAssertGreaterThan((text as NSString).range(of: "![").location, frontmatterEnd - 1, "the picture goes after the frontmatter, never into it")
        XCTAssertTrue(text.hasPrefix("---\ntitle: CI/CD pipelines cheat sheet\n"), "the frontmatter is untouched")
        XCTAssertTrue(app.images.firstMatch.waitForExistence(timeout: 10), "the preview shows it")
    }

    // MARK: Pictures already stored ("Stored Image…")

    private let storedPicture = "](app_data/ci-cd-pipelines-cheat-sheet-demo-photo-"

    private func occurrences(in editor: XCUIElement) -> Int {
        ((editor.value as? String) ?? "").components(separatedBy: storedPicture).count - 1
    }

    /// Through the Image menu. (⌘⇧M, the same list from a hardware keyboard, is a manual-test item: the key presses these tests can send are typed as text when
    /// the on-screen keyboard is up, and then it is the test, not the app, that writes an "m" into the note.)
    private func openStoredImages() {
        app.buttons["Image"].firstMatch.tap()
        let item = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Stored Image'")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10), "the Image menu offers the stored images")
        item.tap()
        XCTAssertTrue(app.navigationBars["Insert an Image"].waitForExistence(timeout: 10), "the list of stored images opens")
    }

    private func storedRow() -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'stored-image-ci-cd-pipelines-cheat-sheet-demo-photo-'")).firstMatch
    }

    func testAStoredPictureIsFoundByItsNameAndPutBackInTheNote() {
        let editor = app.textViews["note-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        XCTAssertTrue(eventually { occurrences(in: editor) == 1 }, "the picture pasted at launch is in the note once")

        openStoredImages()
        XCTAssertTrue(storedRow().waitForExistence(timeout: 10), "the picture stored a moment ago is listed")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Used in 1 note'")).firstMatch.exists, "with how many notes point at it")

        // Typing narrows the list by words of the name; nothing matching says so.
        let filter = app.navigationBars["Insert an Image"].searchFields.firstMatch
        XCTAssertTrue(filter.waitForExistence(timeout: 5), "there is a field to filter by")
        // The tap puts the cursor in the field, and the sheet moves up to make room for the keyboard; the keys go to whatever has the cursor.
        filter.tap()
        _ = eventually(3) { false }
        app.typeText("nothing like it")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'No Results'")).firstMatch.waitForExistence(timeout: 5), "no image matches")
        XCTAssertFalse(storedRow().exists)
        app.typeKey("a", modifierFlags: .command)
        app.typeText("sheet photo")
        XCTAssertTrue(storedRow().waitForExistence(timeout: 5), "every word, anywhere in the name")

        storedRow().tap()
        XCTAssertTrue(app.navigationBars["Insert an Image"].waitForNonExistence(timeout: 10), "choosing a picture closes the list")
        XCTAssertTrue(eventually { occurrences(in: editor) == 2 }, "the picture is in the note again: \(String(describing: editor.value))")
        let text = (editor.value as? String) ?? ""
        XCTAssertTrue(text.hasPrefix("---\ntitle: CI/CD pipelines cheat sheet\n"), "the frontmatter is untouched")
        XCTAssertTrue(text.contains("![ci cd pipelines cheat sheet demo photo 0123456789ab](app_data/"), "described by words from its name, as nothing was selected")
        XCTAssertEqual(text.components(separatedBy: "\n").filter { $0.hasPrefix("![") && $0.hasSuffix(".png)") }.count, 2, "each picture is a paragraph of its own")
    }

    func testCancellingTheListOfStoredPicturesChangesNothing() {
        let editor = app.textViews["note-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        XCTAssertTrue(eventually { occurrences(in: editor) == 1 })
        let before = editor.value as? String
        openStoredImages()
        XCTAssertTrue(storedRow().waitForExistence(timeout: 10))
        app.navigationBars["Insert an Image"].buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Insert an Image"].waitForNonExistence(timeout: 10))
        XCTAssertEqual(editor.value as? String, before, "nothing was written")
    }
}
