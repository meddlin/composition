import XCTest

/// The Live tab (docs/ipad-live-view-plan.md, step L3). What it should draw is checked against the desktop's own code (CompositionCore's
/// `LiveConformanceTests`); this checks that the app draws it, and follows the caret: the editor's `live-report` element (`-liveReport 1`) says what the text
/// storage holds, which is what the screen shows: the runs that are hidden, italic or bold, and the ones drawn at another size. apps/ios/scripts/ui-test.sh
/// passes the backup in.
@MainActor
final class LiveUITests: XCTestCase {
    private let app = XCUIApplication()

    private func launch(_ extra: [String] = []) throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Live", "-liveReport", "1"] + extra
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
    private func write(_ content: String, valueEnds expected: String? = nil) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        let before = (text() as NSString).length
        app.typeText("\n\n" + content)
        origin = before + 2
        // `valueEnds` is what the text view's accessibility value (which `text()` reads) ends with, where that is not the text: with the marks left out of it (step L6).
        XCTAssertTrue(eventually { text().hasSuffix("\n\n" + (expected ?? content)) }, "the text is what was typed: \(text().suffix(80))")
    }

    /// The ranges the report gives, written as offsets in what `write` typed: `at(0...2, 14...16)` is `origin+0 to origin+2, origin+14 to origin+16`.
    private func at(_ pairs: (Int, Int)...) -> String { pairs.map { "\($0.0 + origin)-\($0.1 + origin)" }.joined(separator: ",") }

    /// Presses a key `times` over, a moment apart: sent in a burst while the machine is busy (the suite runs on several Simulators at once) some are lost.
    private func press(_ key: XCUIKeyboardKey, _ times: Int = 1, modifiers: XCUIElement.KeyModifierFlags = []) {
        for _ in 0..<times {
            app.typeKey(key, modifierFlags: modifiers)
            RunLoop.current.run(until: Date().addingTimeInterval(0.04))
        }
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

    // MARK: Rules, pictures, highlights and the frontmatter (step L4)

    func testTheFrontmatterIsSetApartAndNeverHidden() throws {
        try launch()
        XCTAssertTrue(eventually { drawn()["small"]?.hasPrefix("0-") == true }, "the frontmatter, from the first character, is drawn smaller: \(drawn())")
        XCTAssertNil(drawn()["hidden"], "and none of it is hidden")
    }

    func testARuleIsALineAndItsDashesShowWhileTheCaretIsOnThem() throws {
        try launch()
        write("above\n\n---\n\nbelow")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((7, 10)) && drawn()["draw-rule"] == at((7, 11)) }, "the dashes are hidden and the paragraph is drawn as a rule: \(drawn())")
        press(.upArrow, 2)  // the line of the dashes
        XCTAssertTrue(eventually { drawn()["hidden"] == nil && drawn()["draw-rule"] == nil }, "with the caret on it the dashes show and no line is drawn: \(drawn())")
        press(.downArrow, 2)
        XCTAssertTrue(eventually { drawn()["draw-rule"] == at((7, 11)) }, "and it is drawn again when the caret has left: \(drawn())")
    }

    func testAHighlightIsTintedItsTagsAreHiddenAndTypingInItKeepsItTinted() throws {
        try launch()
        write("a <Mark color=\"green\">tint</Mark> b")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((2, 22), (26, 33)) && drawn()["fill"] == at((22, 26)) }, "the tags are hidden and the words tinted: \(drawn())")
        press(.leftArrow, 11)  // inside the tinted words
        XCTAssertTrue(eventually { drawn()["hidden"] == nil }, "both tags show while the caret is in the highlight: \(drawn())")
        app.typeText("X")
        XCTAssertTrue(eventually { drawn()["fill"] == at((22, 27)) }, "what is typed in the highlight is tinted at once, before the pause: \(drawn())")
        XCTAssertTrue(eventually { drawn()["fill"] == at((22, 27)) }, "and stays so after the pause reads the note again: \(drawn())")
    }

    func testAStoredPictureIsDrawnInPlaceOfItsMarkdownAndTheMarkdownShowsWhileTheCaretIsOnIt() throws {
        let picture = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_IMAGE"], "Run apps/ios/scripts/ui-test.sh: it passes the picture.")
        try launch(["-pasteImage", picture])
        XCTAssertTrue(eventually(60) { text().contains("](app_data/") }, "the picture was stored and its Markdown written: \(text().suffix(80))")
        XCTAssertTrue(eventually { drawn()["draw-picture"] != nil }, "the picture is drawn in place of its Markdown: \(drawn())")
        let whole = text() as NSString
        let start = whole.range(of: "![").location
        let end = NSMaxRange(whole.range(of: ")", range: NSRange(location: start, length: whole.length - start)))
        XCTAssertEqual(drawn()["hidden"], "\(start)-\(end)", "the Markdown that writes it is hidden")
        // A tap on the drawn picture puts the caret in the Markdown that writes it. Where the picture is in the editor is not known to the test: it depends on how far the
        // paste scrolled the note to put the caret in view, and that depends on how tall the editor is (the on-screen keyboard, which a Simulator without a hardware keyboard
        // shows, leaves it about 320 points; a point picked from an editor that has all the screen missed the picture and landed on the keyboard). So the test taps down the
        // middle of the editor, in steps smaller than the picture is tall, until one tap is on it.
        let shows = { [self] in let now = drawn(); return now["draw-pictureAfter"] != nil && now["draw-picture"] == nil && now["hidden"] == nil }
        let frame = editor.frame
        var down: CGFloat = 40
        while !shows(), down < frame.height - 10 {
            editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.width / 2, dy: down)).tap()
            _ = eventually(2) { shows() }
            down += 60
        }
        XCTAssertTrue(shows(), "the Markdown shows and the picture is drawn after it: \(drawn())")
    }

    // MARK: Editing across hidden marks (step L5)

    // The marks the Live look hides are still characters, so the fear is a key press that crosses one and moves nothing you can see, or a Backspace that removes one with
    // nothing leaving the screen. The Live tab reveals a construct's marks while the selection touches it (its ends included), before the next key arrives, so a hidden mark
    // is never beside the caret; these tests drive the real tab with the keys a hardware keyboard sends and check that at every press: the selection moved by what the key
    // moves it, the caret was drawn somewhere else (`live-selection` says where), and no character beside either end of the selection is hidden (`live-report`). They are the
    // spike's cases (`LiveLabSpikeUITests`, in the Editor lab) against the editor proper.

    private var selectionLabel: XCUIElement { app.descendants(matching: .any)["live-selection"] }

    private struct Caret {
        let location: Int, length: Int
        /// Where the moving end is drawn, in the text and on the screen.
        let x: Double, y: Double, screenX: Double, screenY: Double
        var end: Int { location + length }
    }

    /// Where the selection is and where its moving end is drawn, from `live-selection` (`12+0 x=104.5 y=68 sx=315.5 sy=190 «…»`).
    private func caret() -> Caret? {
        let label = selectionLabel.exists ? selectionLabel.label : ""
        guard let found = label.range(of: #"^(\d+)\+(\d+) x=(-?[\d.]+) y=(-?[\d.]+) sx=(-?[\d.]+) sy=(-?[\d.]+)"#, options: .regularExpression) else { return nil }
        let fields = label[found].split(whereSeparator: { $0 == "+" || $0 == " " })
        guard fields.count == 6, let location = Int(fields[0]), let length = Int(fields[1]), let x = Double(fields[2].dropFirst(2)), let y = Double(fields[3].dropFirst(2)),
              let screenX = Double(fields[4].dropFirst(3)), let screenY = Double(fields[5].dropFirst(3)) else { return nil }
        return Caret(location: location, length: length, x: x, y: y, screenX: screenX, screenY: screenY)
    }

    /// The hidden runs of the text now, from `live-report`.
    private func hiddenRuns() -> [Range<Int>] {
        (drawn()["hidden"] ?? "").split(separator: ",").compactMap { part in
            let ends = part.split(separator: "-").compactMap { Int($0) }
            return ends.count == 2 ? ends[0]..<ends[1] : nil
        }
    }

    /// A description of a hidden character beside either end of the selection, or nil when there is none.
    private func hiddenBesideTheSelection() -> String? {
        guard let now = caret() else { return "no selection to read" }
        let hidden = hiddenRuns()
        for position in [now.location, now.end] {
            if let run = hidden.first(where: { $0.contains(position - 1) || $0.contains(position) }) { return "the hidden run \(run) is beside the selection's end at \(position)" }
        }
        return nil
    }

    private func expectNothingHiddenBesideTheSelection(_ name: String) {
        XCTAssertTrue(eventually(5) { hiddenBesideTheSelection() == nil }, "\(name): \(hiddenBesideTheSelection() ?? "") (\(selectionLabel.label)) \(drawn()["hidden"] ?? "")")
    }

    /// The lab's editing text (`LabText.editing`): eight short lines to move through, with the marks next to each other, at the ends of lines, and two headings.
    private static let editingLines = [
        "Plain line before.", "# Heading one", "A **bold** word and *italic* too.", "**Bold start** and more text", "text ending in **bold**", "## Second heading",
        "Use `code` here and ~~struck~~ there.", "Last line.",
    ]
    private static let lineStarts: [Int] = {
        var starts: [Int] = [], at = 0
        for line in editingLines { starts.append(at); at += line.utf16.count + 1 }
        return starts
    }()

    /// Types the editing text at the end of the note and waits for the Live look to be on it (the first heading's `# ` hidden).
    private func writeEditingText() {
        write(Self.editingLines.joined(separator: "\n"))
        XCTAssertTrue(eventually { hiddenRuns().contains(origin + Self.lineStarts[1]..<origin + Self.lineStarts[1] + 2) }, "the Live look is on the typed lines: \(drawn())")
    }

    /// Puts the caret at the start of line `line` of what was typed, as it is now (the lines are counted in the text, so an edit that joins two moves the ones below).
    private func start(ofLine line: Int) throws {
        app.typeKey(.downArrow, modifierFlags: .command)
        XCTAssertTrue(eventually { caret()?.location == (text() as NSString).length }, "at the end of the note: \(selectionLabel.label)")
        let lines = (text() as NSString).substring(from: origin).components(separatedBy: "\n")
        for _ in 0..<(lines.count - 1 - line) { try step("up to line \(line)", .upArrow) }
        app.typeKey(.leftArrow, modifierFlags: .command)
        let expected = origin + lines[..<line].reduce(0) { $0 + $1.utf16.count + 1 }
        XCTAssertTrue(eventually { caret()?.location == expected }, "at the start of line \(line): \(selectionLabel.label), not \(expected)")
    }

    /// One press of `key`, which must move the selection, by `delta` at its moving end when that is given, and draw the caret somewhere else; and no hidden character is
    /// beside the selection afterwards. A key lost while the machine is busy (the suite runs on several Simulators at once) is sent once more.
    @discardableResult
    private func step(_ name: String, _ key: XCUIKeyboardKey, _ modifiers: XCUIElement.KeyModifierFlags = [], delta: Int? = nil) throws -> Caret {
        let before = try XCTUnwrap(caret(), "\(name): no selection to read")
        func moved() -> Bool { caret().map { $0.location != before.location || $0.length != before.length } ?? false }
        for attempt in 0..<2 {
            app.typeKey(key, modifierFlags: modifiers)
            if eventually(attempt == 0 ? 4 : 10, moved) { break }
        }
        let after = try XCTUnwrap(caret())
        XCTAssertTrue(moved(), "\(name): the selection did not move: \(selectionLabel.label)")
        XCTAssertTrue(abs(after.x - before.x) > 0.75 || abs(after.y - before.y) > 0.75, "\(name): the selection moved from \(before.location)+\(before.length) to \(after.location)+\(after.length) and the caret was drawn where it was: a hidden character was crossed (\(drawn()["hidden"] ?? ""))")
        if let delta { XCTAssertEqual(after.end - before.end, delta, "\(name): it moves one character") }
        expectNothingHiddenBesideTheSelection(name)
        return after
    }

    private func presses(_ name: String, _ key: XCUIKeyboardKey, _ modifiers: XCUIElement.KeyModifierFlags = [], times: Int, delta: Int? = nil) throws {
        for index in 1...times { try step("\(name) #\(index)", key, modifiers, delta: delta) }
    }

    func testArrowsMoveOneVisibleCharacterAtATimeAcrossABoldAndAnItalicWord() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 2)  // `A **bold** word and *italic* too.`
        try presses("Right", .rightArrow, times: 13, delta: 1)  // across `A `, `**bold**` and a space
        try presses("Left", .leftArrow, times: 13, delta: -1)
        try presses("Right to the italic word", .rightArrow, times: 25, delta: 1)
        try presses("Left again", .leftArrow, times: 25, delta: -1)
    }

    func testShiftArrowsGrowAndShrinkTheSelectionOneCharacterAtATimeAcrossTheMarks() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 2)
        try presses("Right", .rightArrow, times: 2, delta: 1)  // just before `**bold**`
        try presses("Shift+Right", .rightArrow, .shift, times: 10, delta: 1)
        try presses("Shift+Left", .leftArrow, .shift, times: 10, delta: -1)
        try step("Shift+Down", .downArrow, .shift)
        try step("Shift+Down again", .downArrow, .shift)
        try step("Shift+Cmd+Right", .rightArrow, [.shift, .command])
    }

    func testOptionAndCommandArrowsLandWhereTheMarksAreShown() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 2)
        try presses("Option+Right", .rightArrow, .option, times: 4)
        try presses("Option+Left", .leftArrow, .option, times: 4)
        try start(ofLine: 1)  // `# Heading one`
        try step("Cmd+Right", .rightArrow, .command)
        try step("Cmd+Left", .leftArrow, .command)
    }

    func testUpAndDownMoveOneLineAtATimeIntoAndOutOfLinesWithMarks() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 0)
        try presses("Right", .rightArrow, times: 2, delta: 1)
        try presses("Down", .downArrow, times: 7)
        try presses("Up", .upArrow, times: 7)
        try presses("Right into the bold word", .rightArrow, times: 3, delta: 1)
        try presses("Down again", .downArrow, times: 3)
    }

    /// Backspace as a hardware keyboard sends it, as text (`typeKey(.delete)` does not reach a text view in the Simulator, which is how the other UI tests delete too). It must
    /// remove the one character before the caret, which must not have been hidden.
    @discardableResult
    private func backspace(_ name: String) throws -> String {
        let before = text() as NSString
        let at = try XCTUnwrap(caret()).location
        XCTAssertNil(hiddenBesideTheSelection(), "\(name): the character a Backspace removes is hidden")
        app.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertTrue(eventually { (text() as NSString).length != before.length }, "\(name): nothing was removed")
        let removed = before.substring(with: NSRange(location: at - 1, length: 1))
        XCTAssertEqual(text(), before.replacingCharacters(in: NSRange(location: at - 1, length: 1), with: ""), "\(name): one character, the one before the caret (\(removed.debugDescription)), went")
        XCTAssertTrue(eventually { caret()?.location == at - 1 }, "\(name): the caret is where the character was")
        expectNothingHiddenBesideTheSelection(name)
        return removed
    }

    /// Forward delete as ⌃D, which UIKit's text system reads as ⌦ (`deleteForward`): a `.forwardDelete` key sent through the Simulator does not reach the text view, so the keyboard's own
    /// ⌦ (fn+Delete) is not tried by a UI test, only by the manual test.
    @discardableResult
    private func forwardDelete(_ name: String) throws -> String {
        let before = text() as NSString
        let at = try XCTUnwrap(caret()).location
        XCTAssertNil(hiddenBesideTheSelection(), "\(name): the character a forward delete removes is hidden")
        app.typeKey("d", modifierFlags: .control)
        XCTAssertTrue(eventually { (text() as NSString).length != before.length }, "\(name): nothing was removed")
        let removed = before.substring(with: NSRange(location: at, length: 1))
        XCTAssertEqual(text(), before.replacingCharacters(in: NSRange(location: at, length: 1), with: ""), "\(name): one character, the one after the caret (\(removed.debugDescription)), went")
        expectNothingHiddenBesideTheSelection(name)
        return removed
    }

    func testBackspaceRemovesOneVisibleCharacterAfterAHeadingsMarkAndAtItsStart() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 1)  // `# Heading one`
        try presses("Right", .rightArrow, times: 2, delta: 1)  // after `# `, before the H
        XCTAssertEqual(try backspace("Backspace #1"), " ", "the space after the `#`")
        XCTAssertEqual(try backspace("Backspace #2"), "#", "the `#`: the line stops being a heading")
        XCTAssertTrue(eventually { drawn()["size32"] == nil }, "and is drawn as plain text (the second heading, at 24 points, is still a heading): \(drawn())")
        XCTAssertEqual(try backspace("Backspace #3"), "\n", "the line break, which joins the line to the one above")
        // At the start of the second heading, with its marks showing (the caret is on its line); the join moved it up a line.
        try start(ofLine: 4)
        XCTAssertEqual(try backspace("Backspace at the start of `## Second heading`"), "\n")
    }

    func testBackspaceAfterAClosingMarkRemovesOneStarAndForwardDeleteBeforeAnOpeningOne() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 2)
        try presses("Right", .rightArrow, times: 10, delta: 1)  // right after the closing `**`
        XCTAssertEqual(try backspace("Backspace after `**bold**` #1"), "*")
        XCTAssertEqual(try backspace("Backspace after `**bold**` #2"), "*")
        XCTAssertEqual(try backspace("Backspace after `**bold**` #3"), "d")
        try start(ofLine: 3)  // `**Bold start** and more text`
        XCTAssertEqual(try forwardDelete("forward delete before `**Bold` #1"), "*")
        XCTAssertEqual(try forwardDelete("forward delete before `**Bold` #2"), "*")
        XCTAssertEqual(try forwardDelete("forward delete before `**Bold` #3"), "B")
        try start(ofLine: 5)  // `## Second heading`
        for index in 1...4 { _ = try forwardDelete("forward delete at the start of the heading #\(index)") }
    }

    func testTypingAtTheFourEdgesOfABoldWordGoesWhereTheCaretIsDrawn() throws {
        try launch()
        writeEditingText()
        func line() -> String { ((text() as NSString).substring(from: origin).components(separatedBy: "\n"))[2] }
        func type(_ letter: String, expecting expected: String) throws {
            app.typeText(letter)
            XCTAssertTrue(eventually { line() == expected }, "\(letter) goes where the caret was: \(line())")
            expectNothingHiddenBesideTheSelection("after typing \(letter)")
        }
        try start(ofLine: 2)
        try presses("Right", .rightArrow, times: 8, delta: 1)  // after `bold`, before the closing `**`
        try type("X", expecting: "A **boldX** word and *italic* too.")
        try presses("Right", .rightArrow, times: 2, delta: 1)  // after the closing `**`
        try type("Y", expecting: "A **boldX**Y word and *italic* too.")
        try start(ofLine: 2)
        try presses("Right", .rightArrow, times: 2, delta: 1)  // before the opening `**`
        try type("Z", expecting: "A Z**boldX**Y word and *italic* too.")
        try presses("Right", .rightArrow, times: 2, delta: 1)  // after the opening `**`
        try type("W", expecting: "A Z**WboldX**Y word and *italic* too.")
        // X and W are inside the bold, Y and Z outside: the look says the same.
        let word = origin + Self.lineStarts[2] + 5
        XCTAssertTrue(eventually { drawn()["bold"]?.contains("\(word)-\(word + 6)") == true }, "bold covers WboldX: \(drawn())")
    }

    func testBackspaceAtTheStartOfALineJoinsItToTheOneAbove() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 5)
        XCTAssertEqual(try backspace("Backspace across the line break"), "\n")
        XCTAssertTrue(eventually { drawn()["size24"] == nil }, "`##` is no longer at the start of a line, so that heading goes (the first one, at 32 points, stays): \(drawn())")
        XCTAssertNotNil(drawn()["size32"])
    }

    func testTapsAlongALineWithHiddenMarksLandNextToAVisibleCharacter() throws {
        try launch()
        // The editing text replaces the whole note, so that its lines are at the top of the screen, above the on-screen keyboard (which a tap would hit instead).
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey("a", modifierFlags: .command)
        app.typeText(Self.editingLines.joined(separator: "\n"))
        origin = 0
        XCTAssertTrue(eventually { text() == Self.editingLines.joined(separator: "\n") }, "the note is the editing text: \(text().suffix(60))")
        XCTAssertTrue(eventually { hiddenRuns().contains(Self.lineStarts[1]..<Self.lineStarts[1] + 2) }, "the Live look is on it: \(drawn())")
        let line = Self.lineStarts[2]..<Self.lineStarts[3]
        try start(ofLine: 2)  // `A **bold** word and *italic* too.`: where it is on the screen is where the caret is
        let anchor = try XCTUnwrap(caret())
        var between = 0
        for x in stride(from: 4.0, through: 150.0, by: 4.0) {
            app.typeKey(.downArrow, modifierFlags: .command)  // the caret leaves the line, whose marks hide again
            XCTAssertTrue(eventually { caret()?.location == (text() as NSString).length }, "at the end of the note: \(selectionLabel.label)")
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: anchor.screenX + x, dy: anchor.screenY + 10)).tap()
            XCTAssertTrue(eventually { caret().map { line.contains($0.location) } ?? false }, "a tap at \(x) points along the line (\(anchor.screenX), \(anchor.screenY)) landed in it: \(selectionLabel.label)")
            let landed = try XCTUnwrap(caret())
            XCTAssertNil(hiddenBesideTheSelection(), "a tap \(x) points along the line landed at \(landed.location) with a hidden character beside it: \(drawn()["hidden"] ?? "")")
            // Between the two `*` of a mark: the caret in the middle of one (never, in the spike's Simulator runs).
            if [3, 8].contains(landed.location - line.lowerBound) { between += 1 }
        }
        add(XCTAttachment(string: "taps that landed between the two stars of a mark: \(between)"))
    }

    // MARK: Undo and redo

    func testUndoAndRedoBringBackTheTextAndTheMarksNextToAClosingMark() throws {
        try launch()
        writeEditingText()
        try start(ofLine: 2)
        try presses("Right", .rightArrow, times: 10, delta: 1)  // after `**bold**`
        func pause() { RunLoop.current.run(until: Date().addingTimeInterval(1.5)) }
        func look() -> [String: String] { drawn().filter { ["hidden", "bold", "italic"].contains($0.key) } }
        let first = text(), caretAtStart = try XCTUnwrap(caret()), lookAtStart = look()
        func line(_ marks: String) -> String { first.replacingOccurrences(of: "**bold** word", with: "**bold**\(marks) word") }
        app.typeText("Y")
        pause()
        XCTAssertEqual(text(), line("Y"))
        app.typeText("Z")
        pause()
        XCTAssertEqual(text(), line("YZ"))
        _ = try backspace("Backspace")
        pause()
        let last = text()
        XCTAssertEqual(last, line("Y"))
        // ⌘Z until the text is what it was: the system may join the typing and the delete into fewer steps than there were edits, so each step must be a text the note was in, and
        // the marks must follow it.
        let states = [first, line("Y"), line("YZ")]
        var steps = 0
        while text() != first, steps < 4 {
            app.typeKey("z", modifierFlags: .command)
            pause()
            steps += 1
            XCTAssertTrue(states.contains(text()), "undo #\(steps) gives a text the note was in: \(text().suffix(80))")
            expectNothingHiddenBesideTheSelection("undo #\(steps)")
        }
        XCTAssertEqual(text(), first, "the text is back as it was before the three edits, in \(steps) undo(s)")
        if caret()?.location == caretAtStart.location { XCTAssertTrue(eventually { look() == lookAtStart }, "the caret is where it was, and so are the marks: \(look()) against \(lookAtStart)") }
        var redone = 0
        while text() != last, redone < 4 {
            app.typeKey("z", modifierFlags: [.command, .shift])
            pause()
            redone += 1
            XCTAssertTrue(states.contains(text()), "redo #\(redone) gives a text the note was in: \(text().suffix(80))")
            expectNothingHiddenBesideTheSelection("redo #\(redone)")
        }
        XCTAssertEqual(text(), last, "and the redos bring the last text back, in \(redone) redo(s)")
        add(XCTAttachment(string: "three edits: \(steps) undo(s), \(redone) redo(s)"))
    }

    /// ⌘Z, sent through the Simulator, undoes typing in the Live tab (the spike's did not, in the lab or in the Markdown tab).
    func testCommandZUndoesTyping() throws {
        try launch()
        write("one")
        app.typeText(" two")
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(eventually(5) { !text().hasSuffix("one two") }, "⌘Z took something back: \(text().suffix(20))")
    }

    // MARK: ⌘B, ⌘I, Tab, paste and the list after `<`, with the caret beside hidden marks

    func testCommandBAndCommandIWorkOnWordsBesideHiddenMarks() throws {
        try launch()
        write("one **two** three")
        app.typeKey(.leftArrow, modifierFlags: [.shift, .option])  // selects `three`, which sits after the closing `**`
        app.typeKey("b", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("one **two** **three**") }, "bold: \(text().suffix(30))")
        XCTAssertTrue(eventually { drawn()["bold"] == at((6, 9), (14, 19)) }, "both words are bold: \(drawn())")
        app.typeKey("b", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("one **two** three") }, "bold again takes it off: \(text().suffix(30))")
        // The selection on `two`, between the marks, which show because it touches them.
        app.typeKey(.leftArrow, modifierFlags: .command)
        try presses("Right", .rightArrow, times: 6, delta: 1)
        app.typeKey(.rightArrow, modifierFlags: [.shift, .option])
        app.typeKey("i", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("one ***two*** three") }, "italic on a bold word: \(text().suffix(30))")
        XCTAssertTrue(eventually { drawn()["italic"] == at((7, 10)) && drawn()["bold"] == at((7, 10)) }, "it is both: \(drawn())")
        app.typeKey("i", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("one **two** three") }, "italic again takes it off: \(text().suffix(30))")
    }

    func testTabTypesATabNextToAClosingMarkAndIndentsSelectedLines() throws {
        try launch()
        write("one **two**")
        app.typeKey(.tab, modifierFlags: [])
        XCTAssertTrue(eventually { text().hasSuffix("one **two**\t") }, "a tab after the closing mark: \(text().suffix(20).debugDescription)")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 6), (9, 11)) }, "the caret has moved past the word, so its marks hide: \(drawn())")
        app.typeText("\n- **a**\n- *b*")
        app.typeKey(.upArrow, modifierFlags: .shift)
        app.typeKey(.tab, modifierFlags: [])
        XCTAssertTrue(eventually { text().hasSuffix("\t- **a**\n\t- *b*") }, "Tab indents both lines: \(text().suffix(30).debugDescription)")
        app.typeKey(.tab, modifierFlags: .shift)
        XCTAssertTrue(eventually { text().hasSuffix("\n- **a**\n- *b*") }, "Shift+Tab takes it back: \(text().suffix(30).debugDescription)")
    }

    func testPasteWorksAtTheEndsOfABoldWordAndOverItsMarks() throws {
        try launch()
        write("one **two** three")
        app.typeKey(.leftArrow, modifierFlags: [.shift, .option])  // `three`
        app.typeKey("c", modifierFlags: .command)
        app.typeKey(.rightArrow, modifierFlags: [])
        try presses("Left", .leftArrow, times: 6, delta: -1)  // right after the closing `**`
        app.typeKey("v", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("one **two**three three") }, "pasted right after the closing mark: \(text().count) characters, ending \(text().suffix(60).debugDescription), the selection \(selectionLabel.label)")
        XCTAssertTrue(eventually { drawn()["bold"] == at((6, 9)) }, "the word is still bold and nothing else is: \(drawn())")
        // Over the word and both its marks.
        app.typeKey(.leftArrow, modifierFlags: .command)
        try presses("Right", .rightArrow, times: 4, delta: 1)
        try presses("Shift+Right", .rightArrow, .shift, times: 7, delta: 1)
        app.typeKey("v", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("one threethree three") }, "the marked word was replaced: \(text().suffix(40))")
        XCTAssertTrue(eventually { drawn()["bold"] == nil && drawn()["hidden"] == nil }, "and nothing is bold or hidden any more: \(drawn())")
        XCTAssertNil(hiddenBesideTheSelection())
    }

    func testTheListAfterALessThanSignOpensAtTheCaretBesideAClosingMark() throws {
        try launch()
        write("**bold** <Ma")
        let row = app.descendants(matching: .any)["assist-row-0"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the list opens after <Ma, with the caret right after hidden marks")
        XCTAssertTrue(row.label.hasPrefix("<Mark>"), row.label)
        app.typeText("\n")
        XCTAssertTrue(eventually { text().hasSuffix("**bold** <Mark color=\"yellow\"></Mark>") }, "Return writes the component: \(text().suffix(60))")
        XCTAssertFalse(row.exists, "the list is gone")
        XCTAssertTrue(eventually { drawn()["bold"] == at((2, 6)) }, "and the word before it is still bold: \(drawn())")
    }

    // MARK: A composition (Scribble, dictation, an input method) leaves the Live look as it is until it ends

    func testTheLiveLookWaitsWhileATextIsBeingComposedAndCatchesUpWhenItEnds() throws {
        try launch(["-liveCompose", "1"])
        write("one **two**")
        XCTAssertTrue(eventually { drawn()["hidden"] == nil }, "the marks show while the caret is right after the closing mark: \(drawn())")
        let before = report.label
        app.typeKey("c", modifierFlags: [.control, .option])  // marked text at the caret: `ni`, which the system has not yet taken
        XCTAssertTrue(eventually { text().hasSuffix("one **two**ni") }, "the composing text is in the note: \(text().suffix(20))")
        // Longer than the pause (0.3 s) and the full read after it: nothing is restyled while the system is composing, so the marks that showed still show, though the caret has moved on.
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertEqual(report.label, before, "the Live look did nothing during the composition")
        app.typeKey("c", modifierFlags: [.control, .option])  // `nini`
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertEqual(report.label, before, "or while it grows")
        app.typeKey("e", modifierFlags: [.control, .option])  // the system takes the text
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 6), (9, 11)) }, "once it ends the marks hide, as the caret is no longer at the word: \(drawn())")
        XCTAssertEqual(drawn()["bold"], at((6, 9)))
        XCTAssertEqual(text().suffix(11), "**two**nini")
    }

    // MARK: Accessibility (step L6)

    func testTheHiddenMarksAreSilentAndTheHeadingIsMarkedInWhatVoiceOverIsGiven() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (14, 16), (20, 22), (27, 28), (30, 31)) }, "\(drawn())")
        let report = drawn()
        // Candidate B (the default): the text view's value is the whole text, so its offsets are the text view's own, with the hidden marks (and only they) marked "speak no punctuation".
        XCTAssertEqual(report["ax-length"], "\((text() as NSString).length)-\((text() as NSString).length)", "the value is the text: \(report)")
        XCTAssertEqual(report["ax-silent"], report["hidden"], "the marks that are hidden are the ones VoiceOver is told not to speak: \(report)")
        XCTAssertEqual(report["ax-heading1"], at((0, 7)), "and the heading's line carries its level: \(report)")
        XCTAssertTrue(text().hasSuffix(Self.note), "the value still holds every mark: \(text().suffix(60))")
        // With the caret in the bold word its marks show, and are spoken as the punctuation they are: they are not silenced.
        press(.leftArrow, 29)
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (27, 28), (30, 31)) }, "\(drawn())")
        XCTAssertEqual(drawn()["ax-silent"], drawn()["hidden"], "the marks that show are not silenced: \(drawn())")
    }

    /// The fallback (candidate A) stays reachable: `-liveAccessibility withoutMarks`, or the Editor lab's *Hide syntax ▸ VoiceOver* switch, which is kept.
    func testTheFallbackValueWithoutTheMarksIsReachable() throws {
        try launch(["-liveAccessibility", "withoutMarks"])
        write(Self.note, valueEnds: "Title\n\nSome bold and it words.\n\nEnd")
        XCTAssertFalse(text().contains("**") || text().contains("# Title"), "the value has no hidden mark: \(text().suffix(60))")
        XCTAssertNil(drawn()["ax-silent"], "nothing is marked when there is nothing to silence: \(drawn())")
        XCTAssertNotNil(drawn()["ax-length"])
    }

    /// Dynamic Type: the headings are the text's size times 2, 1.5 or 1.25, and the text's size grows with the text size setting, so they do.
    func testHeadingsGrowWithTheTextSize() throws {
        try launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        write("# Big\n\n## Less\n\nbody")
        let sizes = { self.drawn().filter { $0.key.hasPrefix("size") } }
        XCTAssertTrue(eventually { sizes().count == 2 }, "two heading sizes: \(drawn())")
        let points = sizes().keys.compactMap { Int($0.dropFirst(4)) }.sorted()
        // At the default size the headings are 32 and 24 points; at the largest accessibility size the text itself is about three times larger.
        XCTAssertGreaterThan(points.first ?? 0, 60, "the second heading at the largest size: \(points)")
        XCTAssertEqual(Double(points.last ?? 0) / Double(points.first ?? 1), 2.0 / 1.5, accuracy: 0.05, "and H1 is still twice the text where H2 is one and a half: \(points)")
    }

    /// Increase Contrast (`-increaseContrast 1` stands in for the setting): the marks that show are dimmed less, and the rule is firmer.
    func testIncreaseContrastDimsTheMarksLessAndFirmsTheRule() throws {
        try launch(["-theme", "light", "-increaseContrast", "1"])
        write("above\n\n---\n\nsome **bold**")
        // The caret is at the end of `**bold**`, so its marks show, dimmed: the foreground at 85%, as the grey text is with Increase Contrast on.
        XCTAssertTrue(eventually { drawn()["dim85"]?.contains("\(origin + 17)-\(origin + 19)") == true }, "the marks that show are at 85%: \(drawn())")
        XCTAssertTrue(eventually { drawn()["draw-rule"] != nil }, "\(drawn())")
        let rule = try look(for: (0x63, 0x67, 0x6a), tolerance: 6)  // the Light scheme's text colour at 70% over its page
        XCTAssertGreaterThan(rule.longestRun, 400, "the rule is firmer: the longest run of its colour is \(rule.longestRun) pixels")
    }

    func testWithoutIncreaseContrastTheMarksAreDimmedAsTheGreyTextIs() throws {
        try launch(["-theme", "light"])
        write("some **bold**")
        XCTAssertTrue(eventually { drawn()["dim75"]?.contains("\(origin + 5)-\(origin + 7)") == true }, "the marks that show are at Light's grey, 75%: \(drawn())")
    }

    // MARK: What the screen shows, in each colour scheme (pixels)

    /// What a scheme paints: its page, the yellow `<Mark>` tint over it and a rule (the text colour at 35%), from the real tokens (the desktop's `globals.css` through
    /// `Theme`, checked by CompositionCore's `AppearanceConformanceTests`).
    private struct Scheme {
        let name: String
        let tint: (r: Int, g: Int, b: Int)
        let rule: (r: Int, g: Int, b: Int)
    }

    private static let schemes = [
        Scheme(name: "dark", tint: (0x68, 0x56, 0x14), rule: (0x5a, 0x5a, 0x5a)),
        Scheme(name: "light", tint: (0xf6, 0xdc, 0x7b), rule: (0xad, 0xaf, 0xaf)),
        Scheme(name: "forest", tint: (0x65, 0x58, 0x13), rule: (0x52, 0x5e, 0x57)),
        Scheme(name: "wine", tint: (0x6b, 0x51, 0x12), rule: (0x61, 0x54, 0x57)),
        Scheme(name: "cream", tint: (0xf5, 0xd8, 0x72), rule: (0xb5, 0xae, 0xa0)),
    ]

    /// The window's pixels as red, green, blue and alpha bytes, and its size in pixels.
    private func pixels() throws -> (data: [UInt8], width: Int, height: Int) {
        let image = try XCTUnwrap(app.windows.firstMatch.screenshot().image.cgImage)
        var data = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        let context = try XCTUnwrap(CGContext(data: &data, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: space,
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return (data, image.width, image.height)
    }

    /// How many pixels are within `tolerance` of `color`, and the longest straight run of such pixels, along a row or down a column (the window's image comes
    /// turned a quarter in landscape, so a line across the page may run either way in it).
    private func look(for color: (r: Int, g: Int, b: Int), tolerance: Int = 4) throws -> (count: Int, longestRun: Int) {
        let picture = try pixels()
        func near(_ x: Int, _ y: Int) -> Bool {
            let i = (y * picture.width + x) * 4
            return abs(Int(picture.data[i]) - color.r) <= tolerance && abs(Int(picture.data[i + 1]) - color.g) <= tolerance && abs(Int(picture.data[i + 2]) - color.b) <= tolerance
        }
        var count = 0, longest = 0
        for y in 0..<picture.height {
            var run = 0
            for x in 0..<picture.width { if near(x, y) { count += 1; run += 1; longest = max(longest, run) } else { run = 0 } }
        }
        for x in 0..<picture.width {
            var run = 0
            for y in 0..<picture.height { if near(x, y) { run += 1; longest = max(longest, run) } else { run = 0 } }
        }
        return (count, longest)
    }

    private func checkTheLiveLookIsPainted(in scheme: Scheme) throws {
        try launch(["-theme", scheme.name])
        write("above\n\n---\n\n<Mark color=\"yellow\">tinted words tinted words tinted words tinted words</Mark>\n\nend")
        XCTAssertTrue(eventually { drawn()["draw-rule"] != nil && drawn()["fill"] != nil }, "\(scheme.name): the rule and the tint are in the text: \(drawn())")
        let tint = try look(for: scheme.tint, tolerance: 2)
        XCTAssertGreaterThan(tint.count, 3_000, "\(scheme.name): the tint is painted behind the words (\(tint.count) pixels of it)")
        let rule = try look(for: scheme.rule, tolerance: 6)
        XCTAssertGreaterThan(rule.longestRun, 400, "\(scheme.name): the rule is a line across the page (the longest run of its colour is \(rule.longestRun) pixels)")
        // The same note in the Markdown tab has neither: a mark's tags and the dashes are text there.
        app.buttons["Markdown"].tap()
        XCTAssertTrue(eventually { report.label == "markdown" })
        let plainTint = try look(for: scheme.tint, tolerance: 2), plainRule = try look(for: scheme.rule, tolerance: 6)
        XCTAssertLessThan(plainTint.count, 300, "\(scheme.name): no tint in the Markdown tab")
        XCTAssertLessThan(plainRule.longestRun, 100, "\(scheme.name): no rule in the Markdown tab")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "live, \(scheme.name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTheDarkSchemePaintsTheTintAndTheRule() throws { try checkTheLiveLookIsPainted(in: Self.schemes[0]) }
    func testTheLightSchemePaintsTheTintAndTheRule() throws { try checkTheLiveLookIsPainted(in: Self.schemes[1]) }
    func testTheForestSchemePaintsTheTintAndTheRule() throws { try checkTheLiveLookIsPainted(in: Self.schemes[2]) }
    func testTheWineSchemePaintsTheTintAndTheRule() throws { try checkTheLiveLookIsPainted(in: Self.schemes[3]) }
    func testTheCreamSchemePaintsTheTintAndTheRule() throws { try checkTheLiveLookIsPainted(in: Self.schemes[4]) }
}
