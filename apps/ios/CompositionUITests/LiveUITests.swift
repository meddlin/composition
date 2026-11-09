import XCTest

/// The Live tab (docs/ipad-live-view-plan.md, step L3). What it should draw is checked against the desktop's own code (CompositionCore's
/// `LiveConformanceTests`); this checks that the app draws it, and follows the caret: the editor's `live-report` element (`-liveReport 1`) says what the text
/// storage holds, which is what the screen shows: the runs that are hidden, italic or bold, and the ones drawn at another size. apps/ios/scripts/ui-test.sh
/// passes the backup in.
@MainActor
final class LiveUITests: XCTestCase {
    private let app = XCUIApplication()

    private func launch() throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Live", "-liveReport", "1"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
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

    /// What the Live tab has made of the text, as `class → ranges` (`hidden`, `italic`, `bold`, `size32`, `struck`), for the text now, or `markdown` as a word.
    private func drawn() -> [String: String] {
        let label = report.exists ? report.label : ""
        var out: [String: String] = [:]
        for part in label.split(separator: ";") {
            let pair = part.split(separator: ":", maxSplits: 1)
            if pair.count == 2 { out[String(pair[0])] = String(pair[1]) }
        }
        return out
    }

    private func text() -> String { (editor.value as? String) ?? "" }

    /// Where what `write` typed starts in the note, in UTF-16 units.
    private var origin = 0

    /// Types `content` at the end of the note, as a paragraph of its own, and leaves the caret at its end. (The note has some plain text and its frontmatter
    /// already, with nothing in them the Live tab changes, so what it says is about what was typed.)
    private func write(_ content: String) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        let before = (text() as NSString).length
        app.typeText("\n\n" + content)
        origin = before + 2
        XCTAssertTrue(eventually { text().hasSuffix("\n\n" + content) }, "the text is what was typed: \(text().suffix(80))")
    }

    /// The ranges the report gives, written as offsets in what `write` typed: `at(0...2, 14...16)` is `origin+0 to origin+2, origin+14 to origin+16`.
    private func at(_ pairs: (Int, Int)...) -> String { pairs.map { "\($0.0 + origin)-\($0.1 + origin)" }.joined(separator: ",") }

    private func press(_ key: XCUIKeyboardKey, _ times: Int = 1, modifiers: XCUIElement.KeyModifierFlags = []) {
        for _ in 0..<times { app.typeKey(key, modifierFlags: modifiers) }
    }

    /// 0 to 2 for "# Title" (the `# `), 14 to 16 and 20 to 22 for the `**` round "bold", and 27 and 30 for the `*` round "it": the offsets of this text.
    private static let note = "# Title\n\nSome **bold** and *it* words.\n\nEnd"

    // MARK: The tab

    func testLiveIsTheSecondWordOfTheViewPicker() throws {
        try launch()
        let words = ["Markdown", "Live", "Preview", "Split"].map { app.buttons[$0] }
        for word in words { XCTAssertTrue(word.waitForExistence(timeout: 10), "\(word)") }
        let positions = words.map { $0.frame.minX }
        XCTAssertEqual(positions, positions.sorted(), "Markdown, Live, Preview, Split, in that order")
        XCTAssertTrue(words[1].isSelected, "and Live is the one chosen")
    }

    // MARK: What is drawn

    func testHeadingsBoldAndItalicAreDrawnAsSuchAndTheirMarksAreHiddenAwayFromTheCaret() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (14, 16), (20, 22), (27, 28), (30, 31)) }, "every mark is hidden with the caret at the end: \(drawn())")
        let report = drawn()
        XCTAssertEqual(report["bold"], at((2, 7), (16, 20)), "the heading and the bold word are bold, the marks are not drawn")
        XCTAssertEqual(report["italic"], at((28, 30)), "the italic word is italic")
        XCTAssertEqual(report.first { $0.key.hasPrefix("size") }?.value, at((2, 7)), "and only the heading is drawn at another size: \(report)")
    }

    func testTheCaretComingIntoAConstructShowsItsMarksAndLeavingHidesThemAgain() throws {
        try launch()
        write(Self.note)
        let hidden = at((0, 2), (14, 16), (20, 22), (27, 28), (30, 31))
        XCTAssertTrue(eventually { drawn()["hidden"] == hidden })
        press(.leftArrow, 43)  // the start of what was typed: in the heading
        XCTAssertTrue(eventually { drawn()["hidden"] == at((14, 16), (20, 22), (27, 28), (30, 31)) }, "the heading's mark shows with the caret in it: \(drawn())")
        press(.rightArrow, 13)  // a space before the bold word's `**`: out of the heading, and not at the bold word yet
        XCTAssertTrue(eventually { drawn()["hidden"] == hidden }, "the heading's mark is hidden again, the bold word's not shown yet: \(drawn())")
        press(.rightArrow)  // right at the opening `**`, which touches the word
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (27, 28), (30, 31)) }, "both marks of the bold word show once the caret touches it, and only its: \(drawn())")
        press(.rightArrow, 9)  // past the closing `**` and a space
        XCTAssertTrue(eventually { drawn()["hidden"] == hidden }, "and are hidden again when the caret has left it: \(drawn())")
    }

    func testAFencedBlocksFencesHideAwayFromItAndBothShowWhileTheCaretIsInIt() throws {
        try launch()
        write("text\n\n```\ncode\n```\n\nend")
        // The two fences are 6 to 9 and 15 to 18; the pause after typing corrects what the quick reads, made while the block was half typed, got wrong.
        XCTAssertTrue(eventually { drawn()["hidden"] == at((6, 9), (15, 18)) }, "the fences are hidden with the caret outside the block: \(drawn())")
        press(.upArrow, 3)  // the line `code`
        XCTAssertTrue(eventually { drawn()["hidden"] == nil }, "both fences show while the caret is anywhere in the block: \(drawn())")
        press(.downArrow, 3)
        XCTAssertTrue(eventually { drawn()["hidden"] == at((6, 9), (15, 18)) }, "and hide again when it is out of it: \(drawn())")
    }

    // MARK: The tabs share one text view

    func testSwitchingTabsKeepsTheCaretAndTheTextAndTheLiveLookComesBack() throws {
        try launch()
        write(Self.note)
        press(.leftArrow, 29)  // at the opening `**` of the bold word
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (27, 28), (30, 31)) }, "\(drawn())")
        app.buttons["Markdown"].tap()
        XCTAssertTrue(eventually { report.label == "markdown" }, "the Markdown tab shows everything as it is written: \(report.label)")
        app.buttons["Live"].tap()
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (27, 28), (30, 31)) }, "the Live look comes back, with the same construct revealed: \(drawn())")
        app.typeText("Z")  // typed where the caret was left
        XCTAssertTrue(eventually { text().contains("Some Z**bold**") }, "the caret was kept across the tabs: \(text().suffix(60))")
    }

    func testTypingAMarkedWordHidesItsMarksWhenTheCaretMovesOn() throws {
        try launch()
        write("one **two**")
        XCTAssertTrue(eventually { drawn()["hidden"] == nil }, "the marks show while the caret is right after the closing mark: \(drawn())")
        app.typeText(" three")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 6), (9, 11)) }, "and hide once the next word has begun: \(drawn())")
        XCTAssertEqual(drawn()["bold"], at((6, 9)))
    }
}
