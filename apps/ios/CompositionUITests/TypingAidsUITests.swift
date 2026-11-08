import XCTest

/// Build plan Step 9: the typing aids as they are used. What each offers and writes is checked against the desktop's own code (CompositionCore's
/// `EditingConformanceTests`); this checks the part that is the app's: the list under the caret and the keys that drive it, the hardware shortcuts, and a
/// link to another note opened from the preview. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class TypingAidsUITests: XCTestCase {
    private let app = XCUIApplication()

    private func launch(mode: String) throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", mode]
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

    /// The editor, with the caret at the end of the note and the keyboard up.
    private func editorAtTheEnd() -> XCUIElement {
        let editor = app.textViews["note-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        return editor
    }

    private func text(_ editor: XCUIElement) -> String { (editor.value as? String) ?? "" }

    private func row(_ index: Int) -> XCUIElement { app.descendants(matching: .any)["assist-row-\(index)"] }

    func testTheListAfterALessThanSignOffersTheComponentAndReturnWritesIt() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\n<Ma")
        XCTAssertTrue(row(0).waitForExistence(timeout: 10), "the list opens after <Ma")
        XCTAssertTrue(row(0).label.hasPrefix("<Mark>"), "it offers Mark: \(row(0).label)")
        XCTAssertFalse(row(1).exists, "and nothing else")
        app.typeText("\n")
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\n<Mark color=\"yellow\"></Mark>") }, "Return writes the component: \(text(editor).suffix(60))")
        XCTAssertFalse(row(0).exists, "the list is gone")
    }

    func testTheListNarrowsAsYouTypeAndClosesWhenTheTagIsNotBeingStarted() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\n<")
        XCTAssertTrue(row(1).waitForExistence(timeout: 10), "every component is listed after a bare <")
        app.typeText("I")
        XCTAssertTrue(eventually { row(0).exists && row(1).exists && !row(2).exists }, "<I narrows it to Info and Image")
        XCTAssertTrue(row(0).label.hasPrefix("<Info>") && row(1).label.hasPrefix("<Image>"), "\(row(0).label) / \(row(1).label)")
        app.typeText(" ")
        XCTAssertTrue(eventually { !row(0).exists }, "a space ends the tag, and the list with it")
        XCTAssertTrue(text(editor).hasSuffix("\n\n<I "), "nothing was written: \(text(editor).suffix(20))")
    }

    func testAcceptingAPropOffersItsValuesAndTheirLinesAreDrawn() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\n<Chart ")
        XCTAssertTrue(row(1).waitForExistence(timeout: 10), "the props of a chart are listed")
        XCTAssertTrue(row(0).label.hasPrefix("type"), row(0).label)
        app.typeText("\n")
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\n<Chart type=\"\"") }, "the prop is written with its quotes: \(text(editor).suffix(30))")
        // The list for the values replaces the list for the props. An early version drew it with empty lines (each as tall as its padding).
        XCTAssertTrue(eventually { row(3).exists && row(0).label.hasPrefix("bar") }, "bar, line, area and pie: \(row(0).label)")
        XCTAssertGreaterThan(row(0).frame.height, 30, "a line has room for its words")
        app.typeText("\n")
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\n<Chart type=\"bar\"") }, "the value is written, and the caret goes past the closing quote: \(text(editor).suffix(30))")
    }

    func testAnOpenListTakesTheArrowKeysAndTab() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\n<")
        XCTAssertTrue(row(1).waitForExistence(timeout: 10))
        app.typeKey(.downArrow, modifierFlags: [])  // Info, Warning
        app.typeKey(.tab, modifierFlags: [])
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\n<Warning>\n\n\n\n</Warning>") }, "the arrow chose Warning and Tab took it: \(text(editor).suffix(40))")
    }

    func testTabIndentsTheLinesOfASelectionAndShiftTabTakesItBack() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\n- one\n- two")
        app.typeKey(.upArrow, modifierFlags: .shift)  // the selection now runs from the first item into the second
        app.typeKey(.tab, modifierFlags: [])
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\n\t- one\n\t- two") }, "Tab indents both lines: \(text(editor).suffix(30))")
        app.typeKey(.tab, modifierFlags: .shift)
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\n- one\n- two") }, "Shift+Tab takes it back: \(text(editor).suffix(30))")
        app.typeKey("]", modifierFlags: .control)
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\n\t- one\n\t- two") }, "Control+] indents too: \(text(editor).suffix(30))")
    }

    func testTabWithoutASelectionTypesATab() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\nword")
        app.typeKey(.tab, modifierFlags: [])
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\nword\t") }, "a tab is typed: \(text(editor).suffix(12))")
    }

    func testCommandBAndCommandIMakeTheSelectedWordsBoldAndItalic() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\nsome word")
        app.typeKey(.leftArrow, modifierFlags: [.shift, .option])  // selects "word"
        app.typeKey("b", modifierFlags: .command)
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\nsome **word**") }, "bold: \(text(editor).suffix(20))")
        app.typeKey("b", modifierFlags: .command)
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\nsome word") }, "bold again takes it off: \(text(editor).suffix(20))")
        app.typeKey("i", modifierFlags: .command)
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\nsome *word*") }, "italic: \(text(editor).suffix(20))")
    }

    func testCommandShiftHPicksAHighlightColourWithANumberKey() throws {
        try launch(mode: "Markdown")
        let editor = editorAtTheEnd()
        app.typeText("\n\nsome words")
        app.typeKey(.leftArrow, modifierFlags: [.shift, .option])
        app.typeKey("h", modifierFlags: [.command, .shift])
        XCTAssertTrue(row(0).waitForExistence(timeout: 10), "the colours are listed")
        XCTAssertTrue(row(0).label.hasPrefix("Yellow"), row(0).label)
        app.typeKey("2", modifierFlags: [])  // a key press, as the colour list reads them; typed on the software keyboard it would be text
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\nsome <Mark color=\"green\">words</Mark>") }, "2 is green: \(text(editor).suffix(40))")
        // With the caret inside it the list offers to take it off again.
        app.typeKey("h", modifierFlags: [.command, .shift])
        XCTAssertTrue(row(5).waitForExistence(timeout: 10), "Remove highlight is the sixth line")
        app.typeKey("0", modifierFlags: [])
        XCTAssertTrue(eventually { text(editor).hasSuffix("\n\nsome words") }, "0 takes it off: \(text(editor).suffix(40))")
    }

    func testCommandShiftKOpensTheNotePickerAndALinkOpensItsNoteFromThePreview() throws {
        try launch(mode: "Split")
        let editor = editorAtTheEnd()
        app.typeText("\n\n")
        app.typeKey("k", modifierFlags: [.command, .shift])
        XCTAssertTrue(row(0).waitForExistence(timeout: 10), "the notes are listed")
        let title = row(0).label
        XCTAssertFalse(title.isEmpty)
        app.typeText("\n")
        XCTAssertTrue(eventually { text(editor).contains("[\(title)](note:") }, "the link is written: \(text(editor).suffix(60))")
        XCTAssertFalse(text(editor).contains("[[["), "the shortcut typed [[ and the choice replaced it: \(text(editor).suffix(60))")
        // The preview shows it as a link; tapping it opens that note.
        let link = app.links[title]
        XCTAssertTrue(link.waitForExistence(timeout: 10), "the preview has the link")
        link.tap()
        XCTAssertTrue(eventually { text(app.textViews["note-editor"]).hasPrefix("---\ntitle: \(title)\n") }, "the linked note is open: \(text(app.textViews["note-editor"]).prefix(60))")
    }
}
