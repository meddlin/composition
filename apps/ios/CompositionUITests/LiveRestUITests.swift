import XCTest

/// "The rest" of what the Preview draws, in the Live tab (docs/ipad-live-default-plan.md, Step 7): setext headings, footnote citations drawn as their numbers, footnote
/// definitions and `<Toc />` drawn as blocks of the Preview's own views, and the frontmatter drawn as the Preview's header (D5). The editor's `live-report` (`-liveReport 1`,
/// `LiveReport`) says what the text storage holds: `size32` / `size24` over a heading's line, `flat` on a line drawn with no height, `footnote1` over a citation drawn as ¹,
/// and `block-<kind>` / `draw-block` / `block-revealed` for the blocks (Step 5). The note is imported from a file the test writes (`-importText`), which gives it a frontmatter.
@MainActor
final class LiveRestUITests: XCTestCase {
    private let app = XCUIApplication()

    /// The note's body, after the frontmatter the import puts in front of it.
    private static let body = """
        Setext title
        ============

        A citation[^n] in a line.

        Second
        ------

        <Toc />

        Last paragraph.

        [^n]: The note's text.
        """

    private func launch() throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("Step seven.md")
        try Self.body.write(to: file, atomically: true, encoding: .utf8)
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importText", file.path, "-openMode", "Live", "-liveReport", "1"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        for _ in 0..<5 where done.exists {
            done.tap()
            _ = eventually(3) { !done.exists }
        }
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        XCTAssertTrue(eventually { text().hasSuffix(Self.body) }, "the imported note is open: \(text().suffix(80))")
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }
    private var selectionReport: XCUIElement { app.descendants(matching: .any)["live-selection"] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// The report with the frontmatter's block left out (`LiveReportReading`), or as it is.
    private func drawn(keepingFrontmatter: Bool = false) -> [String: String] {
        LiveReportReading.parse(report.exists ? report.label : "", keepingFrontmatter: keepingFrontmatter)
    }

    private func text() -> String { (editor.value as? String) ?? "" }

    /// Where `piece` is in the note (its first time), as `from-to`.
    private func place(_ piece: String) -> NSRange { (text() as NSString).range(of: piece) }
    private func span(_ range: NSRange) -> String { "\(range.location)-\(NSMaxRange(range))" }
    private func span(_ piece: String) -> String { span(place(piece)) }
    /// The ranges of `key` in the report.
    private func has(_ key: String, _ range: String, keepingFrontmatter: Bool = false) -> Bool {
        (drawn(keepingFrontmatter: keepingFrontmatter)[key] ?? "").split(separator: ",").contains { String($0) == range }
    }

    private func selection() -> Int {
        let label = selectionReport.exists ? selectionReport.label : ""
        return (label.split(separator: " ").first.map(String.init) ?? "").split(separator: "+").compactMap { Int($0) }.first ?? -1
    }

    private func press(_ key: XCUIKeyboardKey, _ times: Int = 1, modifiers: XCUIElement.KeyModifierFlags = []) {
        for _ in 0..<times {
            app.typeKey(key, modifierFlags: modifiers)
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        }
    }

    /// Gives the editor the keyboard, with the caret at the end of the note.
    private func focusAtTheEnd() {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        // The tap may land on a drawn block, which puts the caret at its start for a moment after a touch (0.8 s): ⌘↓ after that.
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        for _ in 0..<3 where selection() != (text() as NSString).length {
            app.typeKey(.downArrow, modifierFlags: .command)
            _ = eventually(3) { self.selection() == (self.text() as NSString).length }
        }
        XCTAssertTrue(eventually { selection() == (text() as NSString).length }, "the caret is at the end: \(selection())")
    }

    /// Moves the caret with ↑ until it is in `range` (ends included), as a person walking up the note would.
    private func caretUp(into range: NSRange, _ name: String) {
        for _ in 0..<40 {
            let at = selection()
            if at >= range.location && at <= NSMaxRange(range) { return }
            press(.upArrow)
        }
        XCTFail("\(name): the caret never reached \(span(range)), it is at \(selection())")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: Away from the caret

    func testTheRestIsDrawnAsThePreviewDrawsItAwayFromTheCaret() throws {
        try launch()
        let title = place("Setext title"), underline1 = place("============"), second = place("Second"), underline2 = place("------")
        let toc = place("<Toc />"), definition = place("[^n]: The note's text."), citation = place("[^n] in")
        let citationOnly = NSRange(location: citation.location, length: 4)
        // Setext headings: each drawn at its level's size, its underline's line hidden and flat (its line break too).
        XCTAssertTrue(eventually { self.has("size32", self.span(title)) && self.has("size24", self.span(second)) }, "the setext headings are drawn as headings: \(drawn())")
        XCTAssertTrue(eventually {
            self.has("flat", "\(underline1.location)-\(NSMaxRange(underline1) + 1)") && self.has("flat", "\(underline2.location)-\(NSMaxRange(underline2) + 1)")
        }, "their underlines are lines with no height: \(drawn())")
        // A citation drawn as its number: `[^n]` hidden, `footnote1` over it.
        XCTAssertTrue(eventually { self.drawn()["footnote1"] == self.span(citationOnly) }, "the citation is drawn as ¹: \(drawn())")
        // `<Toc />` and the definition: blocks of the Preview's own views, pictured.
        XCTAssertTrue(eventually {
            let now = self.drawn()
            return now["block-toc"] == self.span(toc) && now["block-footnotes"] == self.span(definition) && self.has("block-pictured", self.span(toc))
                && self.has("block-pictured", self.span(definition)) && now["block-revealed"] == nil
        }, "<Toc /> and the footnote's definition are drawn as the Preview's blocks: \(drawn())")
        // The frontmatter: the Preview's header, in place of the YAML, from the first character (the note opens with the caret at 0 but not being edited).
        XCTAssertTrue(eventually { self.drawn(keepingFrontmatter: true)["block-frontmatter"]?.hasPrefix("0-") == true && self.has("draw-block", "0-4", keepingFrontmatter: true) },
                      "the frontmatter is drawn as the header: \(drawn(keepingFrontmatter: true))")
        // VoiceOver (candidate B): the value is the source, and what is hidden is what is silenced.
        XCTAssertTrue(text().hasSuffix(Self.body))
        let whole = drawn(keepingFrontmatter: true)
        XCTAssertEqual(whole["ax-silent"], whole["hidden"], "every hidden character is silenced, and only they: \(whole)")
        shot("Step 7 drawn in Live")
    }

    // MARK: With the caret in them

    func testTheCaretRevealsEachOneAndLeavingDrawsItAgain() throws {
        try launch()
        let toc = place("<Toc />"), second = place("Second\n------"), citationLine = place("A citation[^n] in a line."), title = place("Setext title\n============")
        let underline2 = place("------")
        XCTAssertTrue(eventually { self.drawn()["block-toc"] != nil && self.drawn()["footnote1"] != nil }, "\(drawn())")
        focusAtTheEnd()

        // Up through the last paragraph to `<Toc />`: its source shows, with its picture after it.
        caretUp(into: toc, "<Toc />")
        XCTAssertTrue(eventually { self.drawn()["block-revealed"] == self.span(toc) && self.drawn()["draw-blockAfter"] != nil }, "<Toc /> shows its source: \(drawn())")
        shot("<Toc /> revealed")

        // Into the level 2 heading: its underline shows (no longer hidden or flat), the heading still large.
        caretUp(into: second, "Second")
        XCTAssertTrue(eventually { self.drawn()["block-revealed"] == nil }, "<Toc /> is drawn again once the caret has left it: \(drawn())")
        XCTAssertTrue(eventually { !self.has("flat", "\(underline2.location)-\(NSMaxRange(underline2) + 1)") && !(self.drawn()["hidden"] ?? "").contains(self.span(underline2)) },
                      "the underline shows while the caret is in the heading: \(drawn())")
        XCTAssertTrue(has("size24", span("Second")), "\(drawn())")

        // The citation's line: the caret on `[^n]` shows it, and the number goes.
        caretUp(into: citationLine, "the citation's line")
        app.typeKey(.leftArrow, modifierFlags: .command)
        press(.rightArrow, 12)  // into `[^n]`, which starts 10 characters into the line
        XCTAssertTrue(eventually { self.drawn()["footnote1"] == nil }, "with the caret on the citation its source shows: \(drawn())")
        press(.rightArrow, 6)
        XCTAssertTrue(eventually { self.drawn()["footnote1"] != nil }, "and it is drawn as its number again once the caret has left it: \(drawn())")

        // The level 1 heading, then the top: the frontmatter shows its YAML alone while the caret is in it (D5), set apart as before (`small`), with no picture under it.
        caretUp(into: title, "Setext title")
        XCTAssertTrue(eventually { !self.has("flat", self.span("============") ) }, "the `===` shows with the caret in the heading: \(drawn())")
        app.typeKey(.upArrow, modifierFlags: .command)
        XCTAssertTrue(eventually {
            let now = self.drawn(keepingFrontmatter: true)
            return now["block-revealed"]?.hasPrefix("0-") == true && now["small"]?.hasPrefix("0-") == true && now["draw-blockAfter"] == nil && !(now["hidden"] ?? "").hasPrefix("0-")
        }, "the frontmatter's YAML shows, alone, while the caret is in it: \(drawn(keepingFrontmatter: true))")
        shot("the frontmatter's YAML while it is edited")
        app.typeKey(.downArrow, modifierFlags: .command)
        XCTAssertTrue(eventually { !(self.drawn(keepingFrontmatter: true)["block-revealed"] ?? "").hasPrefix("0-") && self.has("draw-block", "0-4", keepingFrontmatter: true) },
                      "and the header is drawn again once the caret has left: \(drawn(keepingFrontmatter: true))")
    }

    // MARK: A tap, and the text kept

    func testATapOnTheTocPutsTheCaretAtItsStartAndTheTextIsUnchanged() throws {
        try launch()
        XCTAssertTrue(eventually { self.has("block-pictured", self.span("<Toc />")) }, "\(drawn())")
        focusAtTheEnd()
        // The drawn block's frame in the window (`live-geometry`, `x,y,w,h` of the first block drawn in the body: the Toc). A tap a third of the way across its picture.
        let geometry = app.descendants(matching: .any)["live-geometry"]
        var frame: [Double] = []
        XCTAssertTrue(eventually {
            frame = (geometry.exists ? geometry.label : "").split(separator: ",").compactMap { Double($0) }
            return frame.count == 4 && frame[3] > 30
        }, "the Toc's frame: \(geometry.label)")
        let start = place("<Toc />").location
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame[0] + frame[2] / 3, dy: frame[1] + frame[3] / 2)).tap()
        let landed = eventually { self.selection() == start }
        XCTAssertTrue(landed, "a tap on the drawn <Toc /> puts the caret at its start: \(selection()), \(drawn())")
        XCTAssertTrue(eventually { self.drawn()["block-revealed"] == self.span("<Toc />") }, "and its source shows: \(drawn())")
        XCTAssertTrue(text().hasSuffix(Self.body), "nothing was typed into the note")
    }
}
