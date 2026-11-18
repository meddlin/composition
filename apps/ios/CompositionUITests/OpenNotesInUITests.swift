import XCTest

/// Step 0 of docs/ipad-live-default-plan.md: the "Open notes in" setting (every note opens in it; the tab chosen lasts until another note opens) and the text
/// view kept alive under the Preview and Split tabs, so that its undo survives a look at another tab (D7), while an edit from outside it leaves nothing to undo.
/// apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class OpenNotesInUITests: XCTestCase {
    private let app = XCUIApplication()

    /// Launches on note 25 ("CI/CD pipelines cheat sheet" in the organization backup), without `-openMode`, so that the setting decides the tab.
    private func launch(_ extra: [String]) throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-liveReport", "1"] + extra
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        hideTheLists()
    }

    /// With the lists showing, the toolbar's picker is too narrow for all four tabs (Split is cut off): hide them, as a writer would.
    private func hideTheLists() {
        let toggle = app.buttons["focus-toggle"]
        if toggle.waitForExistence(timeout: 20), toggle.label.hasPrefix("Hide") { toggle.tap() }
        XCTAssertTrue(eventually { self.app.buttons["Split"].exists && self.app.buttons["Split"].isHittable }, "the four tabs are in reach")
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func text() -> String { (editor.value as? String) ?? "" }

    /// The tab chosen in the toolbar's picker, in one query (each query is a snapshot of the app, which is slow on a busy machine).
    private func tab() -> String? {
        let selected = app.buttons.matching(NSPredicate(format: "selected == true AND label IN %@", ["Markdown", "Live", "Preview", "Split"])).firstMatch
        return selected.exists ? selected.label : nil
    }

    /// Taps a tab, and taps it again if the first tap was lost (it happens when the machine is busy).
    private func choose(_ name: String) {
        for _ in 0..<3 {
            app.buttons[name].tap()
            if eventually(8, { self.tab() == name }) { return }
        }
        XCTFail("\(name) is the tab: \(String(describing: tab()))")
    }

    /// Opens another note of the list than note 25, and waits for its tab to be decided.
    private func openAnotherNote() {
        let toggle = app.buttons["focus-toggle"]
        if toggle.waitForExistence(timeout: 20), toggle.label.hasPrefix("Show") { toggle.tap() }
        let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note-row-' AND identifier != 'note-row-25'"))
        let row = rows.firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the list has another note")
        // A tap can be lost while the lists slide in: tap again until the row is the one chosen.
        for _ in 0..<3 where !row.isSelected {
            row.tap()
            _ = eventually(6) { row.isSelected }
        }
        XCTAssertTrue(row.isSelected, "another note is open")
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        hideTheLists()
    }

    /// Types a word at the end of the note, as a paragraph of its own, and waits for the text to have it.
    private func type(_ word: String) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        app.typeText("\n\n" + word)
        XCTAssertTrue(eventually { self.text().hasSuffix(word) }, "the word was typed: \(text().suffix(40))")
        // Typing ends its undo group a moment after the last key.
        RunLoop.current.run(until: Date().addingTimeInterval(1))
    }

    /// ⌘Z until the word is gone (the system may have grouped the typing into a few steps), at most `presses` times.
    private func undo(until gone: String, presses: Int = 6) -> Bool {
        // Low in the editor: the toolbar floats over its top.
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        for _ in 0..<presses {
            if !text().contains(gone) { return true }
            app.typeKey("z", modifierFlags: .command)
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        return !text().contains(gone)
    }

    // MARK: The setting

    func testEveryNoteOpensInTheSettingsViewAndATabChosenLastsUntilAnotherNoteOpens() throws {
        try launch(["-openNotesIn", "Live"])
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        XCTAssertTrue(eventually { self.tab() == "Live" }, "the note opens in Live: \(String(describing: tab()))")
        choose("Preview")
        openAnotherNote()
        XCTAssertTrue(eventually { self.tab() == "Live" }, "the next note opens in Live again, not in the Preview chosen for the last: \(String(describing: tab()))")
    }

    func testTheSettingIsChosenInTheAppearanceSheetAndKeptOnThisIPad() throws {
        try launch(["-resetOpenNotesIn", "1"])
        addTeardownBlock { @MainActor in
            // Leave the choice unset for the other suites, which expect the Preview.
            let reset = XCUIApplication()
            reset.launchArguments = ["-resetOpenNotesIn", "1"]
            reset.launch()
            reset.terminate()
        }
        XCTAssertTrue(eventually { self.tab() == "Preview" }, "with nothing chosen a note opens in the Preview, as before: \(String(describing: tab()))")
        app.buttons["focus-toggle"].tap()  // the lists, whose foot has the Appearance button
        XCTAssertTrue(app.buttons["sidebar-appearance"].waitForExistence(timeout: 10))
        app.buttons["sidebar-appearance"].tap()
        XCTAssertTrue(app.buttons["scheme-forest"].waitForExistence(timeout: 20), "the sheet is open")
        // The Writing section is below the schemes and the fonts: scroll down to it.
        let picker = app.buttons["open-notes-in"]
        for _ in 0..<6 where !(picker.exists && picker.isHittable) { app.buttons["scheme-forest"].swipeUp() }
        XCTAssertTrue(picker.waitForExistence(timeout: 10), "the Writing section has Open notes in")
        picker.tap()
        app.buttons["Markdown"].firstMatch.tap()
        app.buttons["Done"].tap()
        openAnotherNote()
        XCTAssertTrue(eventually { self.tab() == "Markdown" }, "the next note opens in Markdown: \(String(describing: tab()))")
        // A second launch, with nothing said about it: kept.
        app.terminate()
        app.launchArguments = ["-openNote", "25"]
        app.launch()
        openAnotherNote()
        XCTAssertTrue(eventually { self.tab() == "Markdown" }, "and is kept: \(String(describing: tab()))")
    }

    // MARK: Undo across the tabs (D7)

    func testUndoSurvivesALookAtThePreview() throws {
        try launch(["-openNotesIn", "Live"])
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        type("Zebrafish")
        choose("Preview")
        // The Preview is what shows, with what was typed. (The text view under it is hidden, `isHidden`, which was seen in the app's log; XCUITest still lists a
        // representable's view that is hidden, so it is not asked here.)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Zebrafish'")).firstMatch.waitForExistence(timeout: 10), "the Preview shows the note as typed")
        choose("Live")
        XCTAssertTrue(text().hasSuffix("Zebrafish"), "the text is as it was")
        XCTAssertTrue(undo(until: "Zebrafish"), "⌘Z takes back what was typed before the look at the Preview: \(text().suffix(40))")
    }

    func testUndoSurvivesSplitAndTheMarkdownTab() throws {
        try launch(["-openNotesIn", "Live"])
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        type("Quokka")
        choose("Split")
        XCTAssertTrue(eventually { self.report.label == "markdown" }, "Split's editor is the Markdown look of the same text view: \(report.label)")
        choose("Markdown")
        choose("Live")
        XCTAssertTrue(undo(until: "Quokka"), "⌘Z takes back what was typed before Split: \(text().suffix(40))")
    }

    func testAnEditFromOutsideTheTextViewLeavesItNothingToUndo() throws {
        try launch(["-openNotesIn", "Live", "-externalEditButton", "1"])
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        type("Axolotl")
        choose("Preview")
        let outside = app.buttons["test-external-edit"]
        XCTAssertTrue(outside.waitForExistence(timeout: 10))
        outside.tap()
        choose("Live")
        XCTAssertTrue(eventually { self.text().hasSuffix("Added from outside.\n") }, "the text view shows the edit: \(text().suffix(40))")
        XCTAssertFalse(undo(until: "Axolotl", presses: 3), "nothing typed before an edit from outside can be undone: \(text().suffix(60))")
        XCTAssertTrue(text().contains("Added from outside."), "and the edit itself stays")
    }
}
