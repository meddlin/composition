import XCTest

/// The M3† screens: the header image, the heading rail's outline, the Images page and the home page (docs/ipad-app-design.md, the tracker's "Release polish" rows).
/// Run by apps/ios/scripts/ui-test.sh, which makes the backup these start from and hands in a picture (`COMPOSITION_UI_BACKUP`, `COMPOSITION_UI_IMAGE`). The picture is
/// put in note 25 ("CI/CD pipelines cheat sheet") through the app's launch shortcut `-pasteImage`, as the Images tests do. With `COMPOSITION_UI_SHOTS` set to a folder, the
/// tests leave screenshots there.
@MainActor
final class PolishUITests: XCTestCase {
    private let app = XCUIApplication()

    // MARK: Helpers

    private func environment(_ key: String) throws -> String {
        try XCTUnwrap(ProcessInfo.processInfo.environment[key], "Run apps/ios/scripts/ui-test.sh: it passes \(key).")
    }

    /// Starts the app on the backup, in the orientation given (landscape first: the way the iPad is mostly held), and waits for the restore.
    private func launch(_ arguments: [String], orientation: UIDeviceOrientation = .landscapeLeft) throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = orientation
        app.launchArguments = ["-importBackup", try environment("COMPOSITION_UI_BACKUP")] + arguments
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

    private func element(_ identifier: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: identifier).firstMatch }

    private func element(startingWith prefix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["COMPOSITION_UI_SHOTS"] else { return }
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    /// The accessibility tree as text, beside the screenshots, for a test that cannot find what it expects.
    private func dumpTree(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["COMPOSITION_UI_SHOTS"] else { return }
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? app.debugDescription.write(toFile: (folder as NSString).appendingPathComponent("\(name).txt"), atomically: true, encoding: .utf8)
    }

    private var editorText: String { (app.textViews["note-editor"].value as? String) ?? "" }

    private let pastedPicture = "ci-cd-pipelines-cheat-sheet-demo-photo-"

    // MARK: Header image

    /// Note 25 opens in Split with a picture pasted into it; the sheet chooses it as the header image, which the frontmatter then says and the preview shows above the title.
    func testHeaderImageIsChosenChangedAndRemovedFromTheNotesToolbar() throws {
        try launch(["-openNote", "25", "-openMode", "Split", "-pasteImage", try environment("COMPOSITION_UI_IMAGE"), "-exposeDecorative", "1"])
        XCTAssertTrue(app.textViews["note-editor"].waitForExistence(timeout: 20))
        XCTAssertTrue(eventually { editorText.contains("](app_data/\(pastedPicture)") }, "the picture is in the note")
        XCTAssertFalse(element("header-image").exists, "no header image yet")

        app.buttons["header-image-button"].tap()
        XCTAssertTrue(element("header-image-sheet").waitForExistence(timeout: 10), "the sheet opens")
        let choice = element(startingWith: "header-image-\(pastedPicture)")
        XCTAssertTrue(choice.waitForExistence(timeout: 10), "the stored picture is offered")
        XCTAssertFalse(element("header-image-remove").exists, "nothing to remove yet")
        choice.tap()
        XCTAssertTrue(eventually { editorText.contains("headerImage: app_data/\(pastedPicture)") && editorText.contains("headerImageLayout: full") }, "the frontmatter says it: \(editorText.prefix(400))")
        XCTAssertTrue(editorText.hasPrefix("---\ntitle: CI/CD pipelines cheat sheet\n"), "the rest of the frontmatter stays")
        XCTAssertTrue(element("header-image-remove").waitForExistence(timeout: 5), "it can be removed now")
        shot("header-1-sheet")

        app.buttons["header-image-done"].tap()
        XCTAssertTrue(element("header-image-sheet").waitForNonExistence(timeout: 10))
        _ = element("header-image").waitForExistence(timeout: 10)
        shot("header-2-full-landscape")
        dumpTree("header-2-tree")
        XCTAssertTrue(element("header-image").exists, "the preview shows it above the title")

        // Centered at its own size; the choice is written straight away.
        app.buttons["header-image-button"].tap()
        XCTAssertTrue(element("header-image-sheet").waitForExistence(timeout: 10))
        app.segmentedControls["header-image-layout"].buttons["Centered"].tap()
        XCTAssertTrue(eventually { editorText.contains("headerImageLayout: centered") }, "the layout is written: \(editorText.prefix(400))")
        app.buttons["header-image-done"].tap()
        XCTAssertTrue(element("header-image-sheet").waitForNonExistence(timeout: 10))
        XCTAssertTrue(element("header-image").waitForExistence(timeout: 10))
        shot("header-3-centered-landscape")

        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(element("header-image").waitForExistence(timeout: 10), "still shown in portrait")
        shot("header-4-centered-portrait")
        XCUIDevice.shared.orientation = .landscapeLeft

        // Removing it takes both keys out and the banner goes.
        app.buttons["header-image-button"].tap()
        XCTAssertTrue(element("header-image-remove").waitForExistence(timeout: 10))
        element("header-image-remove").tap()
        XCTAssertTrue(eventually { !editorText.contains("headerImage") }, "no trace of either key: \(editorText.prefix(400))")
        XCTAssertTrue(editorText.contains("title: CI/CD pipelines cheat sheet"), "the title is still there")
        XCTAssertFalse(element("header-image-remove").exists, "and nothing left to remove")
        app.buttons["header-image-done"].tap()
        XCTAssertTrue(eventually { !element("header-image").exists }, "the banner is gone")
    }

    // MARK: Outline

    private func longNote() throws -> String {
        var lines = ["# Outline test", ""]
        for section in 1...12 {
            lines.append("## Section \(section)")
            lines.append("")
            for paragraph in 1...3 { lines.append("Paragraph \(paragraph) of section \(section): " + String(repeating: "words go here and fill a line, ", count: 8)); lines.append("") }
            if section == 4 { lines.append("### Detail of four"); lines.append("") }
        }
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("outline-test.md")
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        return file.path
    }

    func testOutlineListsTheHeadingsAndScrollsThePreviewToOne() throws {
        try launch(["-importText", try longNote(), "-openMode", "Preview"])
        XCTAssertTrue(app.buttons["outline-button"].waitForExistence(timeout: 30))
        let last = app.staticTexts["Section 12"].firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 20), "the preview shows the note")
        XCTAssertFalse(last.isHittable, "the last section starts below the screen")

        app.buttons["outline-button"].tap()
        XCTAssertTrue(element("outline").waitForExistence(timeout: 10), "the outline opens")
        XCTAssertTrue(eventually { element("outline-heading-13").exists }, "14 headings: the title, 12 sections and a detail")
        XCTAssertFalse(element("outline-heading-14").exists)
        XCTAssertTrue(element("outline-heading-0").label.contains("Outline test, heading level 1"), element("outline-heading-0").label)
        XCTAssertTrue(element("outline-heading-5").label.contains("Detail of four, heading level 3"), "the detail comes after Section 4: \(element("outline-heading-5").label)")
        shot("outline-1-popover-landscape")
        // The last one: ordinal 13 is "Section 12".
        element("outline-heading-13").tap()
        XCTAssertTrue(element("outline").waitForNonExistence(timeout: 10), "choosing a heading closes the outline")
        XCTAssertTrue(eventually { last.isHittable }, "the preview scrolled to Section 12")
        shot("outline-2-preview-scrolled")

        XCUIDevice.shared.orientation = .portrait
        app.buttons["outline-button"].tap()
        XCTAssertTrue(element("outline").waitForExistence(timeout: 10), "the outline opens in portrait too")
        shot("outline-3-popover-portrait")
        element("outline-heading-2").tap()
        XCTAssertTrue(element("outline").waitForNonExistence(timeout: 10))
        XCTAssertTrue(eventually { app.staticTexts["Section 2"].firstMatch.isHittable }, "and scrolls back up to Section 2")
    }

    func testOutlineMovesTheCaretInTheEditorAndMarksTheHeadingItIsIn() throws {
        try launch(["-importText", try longNote(), "-openMode", "Markdown"])
        XCTAssertTrue(app.textViews["note-editor"].waitForExistence(timeout: 30))
        app.buttons["outline-button"].tap()
        XCTAssertTrue(element("outline-heading-13").waitForExistence(timeout: 10))
        XCTAssertFalse(element("outline-heading-13").isSelected)
        element("outline-heading-13").tap()
        XCTAssertTrue(element("outline").waitForNonExistence(timeout: 10))
        RunLoop.current.run(until: Date().addingTimeInterval(1.0))
        shot("outline-4-editor-scrolled")
        // The caret is now at "## Section 12", and the outline says so.
        app.buttons["outline-button"].tap()
        XCTAssertTrue(element("outline-heading-13").waitForExistence(timeout: 10))
        XCTAssertTrue(eventually { element("outline-heading-13").isSelected }, "the heading the caret is in is marked")
        XCTAssertFalse(element("outline-heading-12").isSelected)
    }

    // MARK: Images page

    private func openImagesPage() {
        app.buttons["More"].firstMatch.tap()
        let item = app.buttons["Images…"].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10), "the More menu offers the Images page")
        item.tap()
        XCTAssertTrue(element("images-page").waitForExistence(timeout: 10), "the page opens")
    }

    private func card() -> XCUIElement { element(startingWith: "image-card-\(pastedPicture)") }

    func testImagesPageBrowsesFiltersAndInsertsAUsedPictureWithoutOfferingToDeleteIt() throws {
        try launch(["-openNote", "25", "-openMode", "Split", "-pasteImage", try environment("COMPOSITION_UI_IMAGE")])
        XCTAssertTrue(eventually { editorText.contains("](app_data/\(pastedPicture)") }, "the picture is in the note")
        openImagesPage()
        XCTAssertTrue(card().waitForExistence(timeout: 10), "the picture stored a moment ago is listed")
        XCTAssertTrue(card().label.contains("Used in 1 note"), card().label)
        XCTAssertTrue(element("images-summary").label.contains("images"), element("images-summary").label)
        shot("images-1-grid-landscape")

        // The filter by name, and "Not used" (the pasted picture is in a note, so it is not among them).
        let filter = app.navigationBars["Images"].searchFields.firstMatch
        filter.tap()
        _ = eventually(2) { false }
        app.typeText("zzz nothing")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'No Results'")).firstMatch.waitForExistence(timeout: 5), "no image matches")
        XCTAssertFalse(card().exists)
        app.typeKey("a", modifierFlags: .command)
        app.typeText("sheet photo")
        XCTAssertTrue(card().waitForExistence(timeout: 5), "every word, anywhere in the name")

        card().tap()
        XCTAssertTrue(element("image-detail").waitForExistence(timeout: 10), "the picture's page opens")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'CI/CD pipelines cheat sheet'")).firstMatch.exists, "it names the note that uses it")
        XCTAssertFalse(element("image-delete").exists, "a picture a note uses cannot be deleted")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'cannot be deleted'")).firstMatch.exists, "and the page says why")
        shot("images-2-detail-used")

        element("image-insert").tap()
        XCTAssertTrue(element("images-page").waitForNonExistence(timeout: 10), "the page closes")
        XCTAssertTrue(eventually(20) { editorText.components(separatedBy: "](app_data/\(pastedPicture)").count - 1 == 2 }, "the picture is in the note again: \(editorText)")
    }

    func testImagesPageDeletesAPictureNothingUsesAfterAsking() throws {
        try launch(["-openNote", "25", "-openMode", "Split", "-pasteImage", try environment("COMPOSITION_UI_IMAGE")])
        let editor = app.textViews["note-editor"]
        XCTAssertTrue(eventually { editorText.contains("](app_data/\(pastedPicture)") })
        // Take the picture out of the note: select everything and type over it.
        editor.tap()
        app.typeKey("a", modifierFlags: .command)
        app.typeText("no picture here")
        XCTAssertTrue(eventually { !editorText.contains("app_data/") }, "the note no longer points at it")

        openImagesPage()
        XCTAssertTrue(card().waitForExistence(timeout: 10), "the file is still stored")
        XCTAssertTrue(card().label.contains("Not used in any note"), card().label)
        app.segmentedControls["images-filter"].buttons.element(boundBy: 1).tap()
        XCTAssertTrue(card().waitForExistence(timeout: 5), "and is among the ones not used")
        shot("images-3-unused-filter")
        card().tap()
        XCTAssertTrue(element("image-delete").waitForExistence(timeout: 10), "a picture nothing uses can be deleted")
        shot("images-4-detail-unused")

        element("image-delete").tap()
        let confirm = app.buttons["Delete Image"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "it asks first")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'cannot be brought back'")).firstMatch.exists, "and says what will happen")
        shot("images-5-confirm")
        confirm.tap()
        XCTAssertTrue(element("image-detail").waitForNonExistence(timeout: 15), "back to the grid")
        XCTAssertTrue(eventually { !card().exists }, "the picture is gone from the list")
    }

    // MARK: Under Follow the sun

    /// The sun scheme with its fade held at the middle (`-theme auto -sunLevel 0.5`, a Debug launch shortcut of the Appearance tests): the new screens are drawn from the scheme's
    /// tokens, so they take whatever blend the page is at. Landscape first, then portrait; the screenshots are for the eye (the colours are the Appearance tests' to check).
    private let sun = ["-theme", "auto", "-sunLevel", "0.5"]

    func testTheHomePageWearsTheSunScheme() throws {
        try launch(sun)
        XCTAssertTrue(element("home-page").waitForExistence(timeout: 30), "the home page")
        XCTAssertTrue(element("home-notebook-1").waitForExistence(timeout: 10))
        XCTAssertTrue(eventually { element(startingWith: "home-recent-").exists })
        shot("sun-home-1-landscape")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(element("home-page").waitForExistence(timeout: 10))
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        shot("sun-home-2-portrait")
    }

    func testTheOutlineAndTheImagesPageWearTheSunScheme() throws {
        try launch(["-importText", try longNote(), "-openMode", "Preview"] + sun)
        XCTAssertTrue(app.buttons["outline-button"].waitForExistence(timeout: 30))
        app.buttons["outline-button"].tap()
        XCTAssertTrue(element("outline-heading-3").waitForExistence(timeout: 10), "the outline lists the headings")
        shot("sun-outline-1-landscape")
        element("outline-heading-3").tap()
        XCTAssertTrue(element("outline").waitForNonExistence(timeout: 10))

        openImagesPage()
        XCTAssertTrue(eventually { element(startingWith: "image-card-").exists }, "the stored pictures are listed")
        shot("sun-images-1-landscape")
        XCUIDevice.shared.orientation = .portrait
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertTrue(element("images-page").exists, "the page is still open after turning")
        shot("sun-images-2-portrait")
        app.buttons["images-done"].tap()
        XCTAssertTrue(element("images-page").waitForNonExistence(timeout: 10))

        app.buttons["outline-button"].tap()
        XCTAssertTrue(element("outline-heading-3").waitForExistence(timeout: 10), "the outline opens in portrait too")
        shot("sun-outline-2-portrait")
    }

    // MARK: Home page

    func testHomePageShowsNotebooksAndRecentNotesAndPinnedOnesAndLeadsToThem() throws {
        try launch([])
        XCTAssertTrue(element("home-page").waitForExistence(timeout: 30), "with no note open the detail column is the home page")
        XCTAssertTrue(element("home-notebook-1").waitForExistence(timeout: 10), "the notebooks")
        XCTAssertTrue(element("home-notebook-2").exists)
        let recent = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'home-recent-'"))
        XCTAssertTrue(eventually { recent.count > 0 }, "recent notes")
        XCTAssertLessThanOrEqual(recent.allElementsBoundByIndex.count, 12)
        XCTAssertFalse(element(startingWith: "home-pinned-").exists, "nothing is pinned yet")
        shot("home-1-landscape")

        // A note card opens the note.
        let first = recent.firstMatch
        first.tap()
        XCTAssertTrue(eventually { !element("home-page").exists }, "a note is open now")
        XCTAssertTrue(app.buttons["outline-button"].waitForExistence(timeout: 10), "its toolbar is there")

        // Pin it from the list, and the home button brings the page back with it under Pinned.
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note-row-'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.press(forDuration: 1.0)
        app.buttons["Add to Favorites"].tap()
        app.buttons["home-button"].tap()
        XCTAssertTrue(element("home-page").waitForExistence(timeout: 10), "the home button shows the page again")
        XCTAssertTrue(eventually { element(startingWith: "home-pinned-note-").exists }, "the favorite is pinned at the top")
        shot("home-2-pinned-landscape")

        // A notebook card shows that notebook's notes in the list.
        element("home-notebook-2").tap()
        XCTAssertTrue(app.navigationBars["Work"].firstMatch.waitForExistence(timeout: 10), "the list is the notebook's")
        XCTAssertTrue(element("home-page").exists, "and the page stays")
    }

    /// In portrait the notes list is out of sight, so a notebook card brings it in beside the page.
    func testHomePageInPortraitBringsTheListInForANotebookCard() throws {
        try launch([], orientation: .portrait)
        XCTAssertTrue(element("home-page").waitForExistence(timeout: 30), "the home page")
        XCTAssertTrue(element("home-notebook-2").waitForExistence(timeout: 10))
        shot("home-3-portrait")
        element("home-notebook-2").tap()
        XCTAssertTrue(app.navigationBars["Work"].firstMatch.waitForExistence(timeout: 10), "the list is the notebook's: it came into view")
        shot("home-4-portrait-list")
    }
}
