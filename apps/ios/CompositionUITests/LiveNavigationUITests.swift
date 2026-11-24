import XCTest

/// Gate LD7's fixes (docs/manual-tests/ipad.md items 364, 365 and 387), in the Live tab: `<Toc />` and a footnote list drawn from the whole note are drawn again when
/// the note's headings or footnotes change, and they and the citations can be followed, as the owner chose: a plain tap still edits; ⌘-tap on a `<Toc />` entry goes
/// to its heading, on a citation to its definition, on a footnote's ↩ back to its citation; while the caret is in the tag (or the definitions) each entry and ↩ has
/// a ↗ (`live-follow-entry`), and while it is on a citation the citation has the link's ↗ (`live-follow-link`).
///
/// What a test reads (`-liveReport 1`): `live-report` (`footnote1` over a citation drawn as ¹, `block-toc`, `block-revealed`, …), `live-selection` (where the caret
/// is), `live-rows` (each row the drawn pictures can follow, `heading1 x,y,w,h;citation2 x,y,w,h`, from the picture drawn now, so a stale picture shows as old
/// rows) and `live-citations` (where each citation's number is drawn). `-liveCommandHeld 1` stands in for ⌘ held during a tap, as in `LiveLinksUITests`.
@MainActor
final class LiveNavigationUITests: XCTestCase {
    private let app = XCUIApplication()

    private static let tocNote = """
        # Alpha

        Words.

        <Toc />

        ## Beta

        More words.

        ## Gamma

        The end.
        """

    private static let footnoteNote = """
        Text one[^a] and two[^b].

        A paragraph between.

        [^a]: First note.
        [^b]: Second note.
        """

    private var body = ""

    private func launch(_ body: String, commandHeld: Bool = false) throws {
        continueAfterFailure = false
        self.body = body
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("Gate LD7.md")
        try body.write(to: file, atomically: true, encoding: .utf8)
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importText", file.path, "-openMode", "Live", "-liveReport", "1"] + (commandHeld ? ["-liveCommandHeld", "1"] : [])
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        for _ in 0..<5 where done.exists {
            done.tap()
            _ = eventually(3) { !done.exists }
        }
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        XCTAssertTrue(eventually { self.text().hasSuffix(body) }, "the imported note is open: \(text().suffix(80))")
    }

    /// The next test's note may get this one's id, and the app restores the caret per note: the caret is left at the top (`LiveScribbleUITests` found this).
    override func tearDown() {
        if app.state == .runningForeground { app.typeKey(.upArrow, modifierFlags: .command) }
        super.tearDown()
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private func probe(_ name: String) -> String {
        let element = app.descendants(matching: .any)[name]
        return element.exists ? element.label : ""
    }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func drawn() -> [String: String] { LiveReportReading.parse(probe("live-report")) }
    private func text() -> String { (editor.value as? String) ?? "" }
    private func place(_ piece: String) -> NSRange { (text() as NSString).range(of: piece) }
    private func span(_ range: NSRange) -> String { "\(range.location)-\(NSMaxRange(range))" }

    private func selection() -> Int {
        (probe("live-selection").split(separator: " ").first.map(String.init) ?? "").split(separator: "+").compactMap { Int($0) }.first ?? -1
    }

    /// `name x,y,w,h;…` as name → frame (the first of each name).
    private func frames(_ probeName: String) -> [(name: String, frame: CGRect)] {
        probe(probeName).split(separator: ";").compactMap { part in
            let pieces = part.split(separator: " ")
            guard pieces.count == 2 else { return nil }
            let numbers = pieces[1].split(separator: ",").compactMap { Double($0) }
            guard numbers.count == 4 else { return nil }
            return (String(pieces[0]), CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3]))
        }
    }

    /// The names of the rows the drawn pictures can follow, in order (`heading0`, `citation2`, …).
    private func rows() -> [String] { frames("live-rows").map(\.name) }

    private func tap(at point: CGPoint) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
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
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        for _ in 0..<3 where selection() != (text() as NSString).length {
            app.typeKey(.downArrow, modifierFlags: .command)
            _ = eventually(3) { self.selection() == (self.text() as NSString).length }
        }
        XCTAssertTrue(eventually { self.selection() == (self.text() as NSString).length }, "the caret is at the end: \(selection())")
    }

    /// Moves the caret with ↑ until it is in `range` (ends included).
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

    // MARK: The bug: drawn from the whole note, drawn again when it changes (items 364 and 365)

    func testAHeadingAddedToTheNoteIsAddedToTheDrawnToc() throws {
        try launch(Self.tocNote)
        XCTAssertTrue(eventually { self.rows() == ["heading0", "heading1", "heading2"] }, "the Toc is drawn with its three entries: \(probe("live-rows"))")
        focusAtTheEnd()
        app.typeText("\n\n## Delta")
        // Away from the caret, `<Toc />` is drawn again, after the pause, with the new entry; it was drawn with its first picture for good before the fix.
        XCTAssertTrue(eventually { self.rows() == ["heading0", "heading1", "heading2", "heading3"] }, "the Toc gains the heading: \(probe("live-rows"))")
        XCTAssertTrue(eventually { (self.drawn()["block-stale"] ?? "").isEmpty && self.drawn()["block-toc"] == self.span(self.place("<Toc />")) }, "\(drawn())")
        // A heading taken away goes from it too.
        // Backspace as text (`typeKey(.delete)` does not reach a text view in the Simulator, `LiveUITests` found).
        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "## Delta".count))
        XCTAssertTrue(eventually { self.rows() == ["heading0", "heading1", "heading2"] }, "and loses it again: \(probe("live-rows")) «\(text().suffix(30))» \(drawn())")
        shot("the Toc drawn again")
    }

    func testANewCitationIsNumberedAndTheListIsDrawnAgain() throws {
        try launch(Self.footnoteNote)
        let a = NSRange(location: place("[^a] and").location, length: 4), b = NSRange(location: place("[^b].").location, length: 4)
        XCTAssertTrue(eventually { self.drawn()["footnote1"] == self.span(a) && self.drawn()["footnote2"] == self.span(b) }, "¹ and ²: \(drawn())")
        XCTAssertTrue(eventually { self.rows() == ["citation1", "citation2"] }, "the list, with a ↩ for each: \(probe("live-rows"))")
        focusAtTheEnd()

        // A new citation of `b` before the first: `b` is now 1 and `a` 2, as the Preview numbers them, and the list (written a, then b) is drawn again with them.
        caretUp(into: place("Text one[^a] and two[^b]."), "the first line")
        app.typeKey(.leftArrow, modifierFlags: .command)
        app.typeText("New[^b] ")
        press(.downArrow, 2)  // off the line, so that every citation on it is drawn as its number
        let newB = NSRange(location: place("New[^b]").location + 3, length: 4)
        let a2 = NSRange(location: place("[^a] and").location, length: 4), b2 = NSRange(location: place("[^b].").location, length: 4)
        XCTAssertTrue(eventually { self.drawn()["footnote1"] == "\(self.span(newB)),\(self.span(b2))" && self.drawn()["footnote2"] == self.span(a2) },
                      "the citations are numbered again, the new one too: \(drawn())")
        XCTAssertTrue(eventually { self.rows() == ["citation2", "citation1"] }, "the list is drawn with the new numbers: \(probe("live-rows"))")

        // A footnote of its own: cited in the text, defined at the end. It is numbered 3 and joins the list.
        app.typeKey(.downArrow, modifierFlags: .command)
        app.typeText("\n[^c]: Third note.")
        caretUp(into: place("A paragraph between."), "the paragraph")
        app.typeKey(.rightArrow, modifierFlags: .command)
        app.typeText(" Cited[^c].")
        press(.downArrow, 1)
        let c = NSRange(location: place("Cited[^c]").location + 5, length: 4)
        XCTAssertTrue(eventually { self.drawn()["footnote3"] == self.span(c) }, "the new citation is drawn as ³: \(drawn())")
        XCTAssertTrue(eventually { self.rows() == ["citation2", "citation1", "citation3"] }, "and its footnote joins the list: \(probe("live-rows"))")
        shot("the footnotes drawn again")
    }

    // MARK: `<Toc />` (item 365)

    func testCommandTapOnATocEntryGoesToItsHeading() throws {
        try launch(Self.tocNote, commandHeld: true)
        var entry = CGRect.zero
        XCTAssertTrue(eventually {
            entry = self.frames("live-rows").first { $0.name == "heading2" }?.frame ?? .zero
            return entry.height > 0
        }, "the Toc's entries: \(probe("live-rows"))")
        tap(at: CGPoint(x: entry.midX, y: entry.midY))
        let gamma = place("## Gamma").location
        XCTAssertTrue(eventually { self.selection() == gamma }, "⌘-tap on `Gamma` puts the caret on its heading: \(selection()), wanted \(gamma)")
        XCTAssertNil(drawn()["block-revealed"], "and the Toc is still drawn: \(drawn())")
        XCTAssertTrue(text().hasSuffix(body), "nothing was typed into the note")
    }

    func testAPlainTapOnATocEntryStillEdits() throws {
        try launch(Self.tocNote)
        var entry = CGRect.zero
        XCTAssertTrue(eventually {
            entry = self.frames("live-rows").first { $0.name == "heading2" }?.frame ?? .zero
            return entry.height > 0
        }, "the Toc's entries: \(probe("live-rows"))")
        tap(at: CGPoint(x: entry.midX, y: entry.midY))
        let toc = place("<Toc />")
        XCTAssertTrue(eventually { self.selection() == toc.location }, "a plain tap puts the caret at the tag's start (I6): \(selection())")
        XCTAssertTrue(eventually { self.drawn()["block-revealed"] == self.span(toc) }, "and shows the tag: \(drawn())")
    }

    func testWithTheCaretInTheTagEachEntryHasAnArrowToItsHeading() throws {
        try launch(Self.tocNote)
        XCTAssertTrue(eventually { self.rows().count == 3 }, "\(probe("live-rows"))")
        focusAtTheEnd()
        let toc = place("<Toc />")
        caretUp(into: toc, "<Toc />")
        let arrows = app.buttons.matching(identifier: "live-follow-entry")
        XCTAssertTrue(eventually { arrows.count == 3 }, "an ↗ for each entry while the caret is in the tag: \(arrows.count)")
        // VoiceOver reaches them as buttons, as it does a link's "Follow link": each says where it goes.
        let beta = arrows.matching(NSPredicate(format: "value == %@", "Beta")).firstMatch
        XCTAssertTrue(beta.exists, "the ↗s: \(arrows.allElementsBoundByIndex.map { "\($0.label) \(String(describing: $0.value))" })")
        XCTAssertEqual(beta.label, "Go to heading")
        shot("the Toc's ↗s")
        beta.tap()
        XCTAssertTrue(eventually { self.selection() == self.place("## Beta").location }, "the ↗ puts the caret on `## Beta`: \(selection())")
        XCTAssertTrue(eventually { arrows.count == 0 }, "and the ↗s go once the caret has left the tag")
    }

    // MARK: Footnotes (item 364)

    func testCommandTapOnACitationGoesToItsDefinition() throws {
        try launch(Self.footnoteNote, commandHeld: true)
        var number = CGRect.zero
        XCTAssertTrue(eventually {
            number = self.frames("live-citations").first { $0.name == "2" }?.frame ?? .zero
            return number.height > 0 && self.rows().count == 2
        }, "the citations: \(probe("live-citations"))")
        tap(at: CGPoint(x: number.midX, y: number.midY))
        let definition = place("[^b]: Second note.").location
        XCTAssertTrue(eventually { self.selection() == definition }, "⌘-tap on ² puts the caret at `[^b]:`: \(selection()), wanted \(definition)")
        XCTAssertTrue(text().hasSuffix(body), "nothing was typed into the note")
    }

    func testCommandTapOnAReturnMarkGoesBackToTheCitation() throws {
        try launch(Self.footnoteNote, commandHeld: true)
        var mark = CGRect.zero
        XCTAssertTrue(eventually {
            mark = self.frames("live-rows").first { $0.name == "citation2" }?.frame ?? .zero
            return mark.height > 0
        }, "the list's ↩s: \(probe("live-rows"))")
        tap(at: CGPoint(x: mark.midX, y: mark.midY))
        let citation = place("[^b].").location
        XCTAssertTrue(eventually { self.selection() == citation }, "⌘-tap on footnote 2's ↩ puts the caret on `[^b]`: \(selection()), wanted \(citation)")
    }

    func testAPlainTapOnACitationStillEdits() throws {
        try launch(Self.footnoteNote)
        XCTAssertTrue(eventually { self.drawn()["footnote1"] != nil }, "\(drawn())")
        // Focused first: the first tap into the note turns the frontmatter's header into its YAML (D5), which moves the text under a tap.
        focusAtTheEnd()
        var number = CGRect.zero
        XCTAssertTrue(eventually {
            number = self.frames("live-citations").first { $0.name == "1" }?.frame ?? .zero
            return number.height > 0
        }, "the citations: \(probe("live-citations"))")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        number = frames("live-citations").first { $0.name == "1" }?.frame ?? number
        tap(at: CGPoint(x: number.midX, y: number.midY))
        let a = place("[^a] and")
        // It edits: the caret goes into the line, by the citation, and not to the definition.
        XCTAssertTrue(eventually { abs(self.selection() - a.location) <= 5 }, "a plain tap puts the caret by the citation: \(selection()), the citation at \(a.location)")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertTrue(abs(selection() - a.location) <= 5, "and it stays there, nothing followed: \(selection())")
        XCTAssertTrue(text().hasSuffix(body), "nothing was typed into the note")
    }

    func testTheArrowOnACitationGoesToItsDefinition() throws {
        try launch(Self.footnoteNote)
        XCTAssertTrue(eventually { self.drawn()["footnote1"] != nil }, "\(drawn())")
        focusAtTheEnd()
        caretUp(into: place("Text one[^a] and two[^b]."), "the first line")
        app.typeKey(.leftArrow, modifierFlags: .command)
        press(.rightArrow, 9)  // into `[^a]`, 8 characters into the line
        let follow = app.buttons["live-follow-link"]
        XCTAssertTrue(eventually { follow.exists && (follow.value as? String) == "#fn-a" }, "the citation's ↗, to `#fn-a`: \(follow.exists) \(String(describing: follow.value))")
        follow.tap()
        XCTAssertTrue(eventually { self.selection() == self.place("[^a]: First note.").location }, "the ↗ puts the caret at `[^a]:`: \(selection())")
    }

    func testWithTheCaretInTheDefinitionsEachReturnMarkHasAnArrowBack() throws {
        try launch(Self.footnoteNote)
        XCTAssertTrue(eventually { self.rows() == ["citation1", "citation2"] }, "\(probe("live-rows"))")
        focusAtTheEnd()  // in the definitions: their source shows, with the list under it
        let arrows = app.buttons.matching(identifier: "live-follow-entry")
        XCTAssertTrue(eventually { arrows.count == 2 }, "an ↗ for each ↩: \(arrows.count)")
        let second = arrows.matching(NSPredicate(format: "value == %@", "2")).firstMatch
        XCTAssertTrue(second.exists)
        XCTAssertEqual(second.label, "Back to citation")
        shot("the list's ↗s")
        second.tap()
        XCTAssertTrue(eventually { self.selection() == self.place("[^b].").location }, "the ↗ puts the caret on the citation of `b`: \(selection())")
    }
}
