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
}
