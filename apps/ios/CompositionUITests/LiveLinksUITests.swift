import XCTest

/// Links in the Live tab (Step 2 of docs/ipad-live-default-plan.md): `[` and `](url)` hidden away from the caret and shown dimmed under it, the words drawn as
/// a link, the ↗ that follows the link the caret is in, ⌘-tap, a plain tap that edits, and editing a link from the keyboard. What the model hides is checked
/// against the desktop's `drawLink` by CompositionCore's `LiveConformanceTests`; this checks the app draws it and follows it. The report is `live-report`
/// (`-liveReport 1`, see `LiveReport`); apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class LiveLinksUITests: XCTestCase {
    private let app = XCUIApplication()

    private func launch() throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup (no links in it); note 24 is "Thoughts on Rust", which the links here open.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Live", "-liveReport", "1"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }
    private var selectionLabel: XCUIElement { app.descendants(matching: .any)["live-selection"] }
    private var follow: XCUIElement { app.descendants(matching: .any)["live-follow-link"] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// What the Live tab has made of the text, as `class → ranges`.
    private func drawn() -> [String: String] {
        var out: [String: String] = [:]
        for part in (report.exists ? report.label : "").split(separator: ";") {
            let pair = part.split(separator: ":", maxSplits: 1)
            if pair.count == 2 { out[String(pair[0])] = String(pair[1]) }
        }
        return out
    }

    private func text() -> String { (editor.value as? String) ?? "" }

    /// Where what `write` typed starts in the note, in UTF-16 units.
    private var origin = 0

    /// Types `content` at the end of the note, as a paragraph of its own, and leaves the caret at its end.
    private func write(_ content: String) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        let before = (text() as NSString).length
        app.typeText("\n\n" + content)
        origin = before + 2
        XCTAssertTrue(eventually { text().hasSuffix("\n\n" + content) }, "the text is what was typed: \(text().suffix(80))")
    }

    /// Makes `lines` the whole note, so that they are at the top of the screen, above the on-screen keyboard; the caret is left at the end.
    private func replaceNote(with content: String) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        // ⌘A until all is selected: sent before the text view has the keys (a busy machine), it is lost.
        var all = false
        for _ in 0..<5 where !all {
            app.typeKey("a", modifierFlags: .command)
            all = eventually(3) { self.selection().map { $0.location == 0 && $0.length == (self.text() as NSString).length } ?? false }
        }
        XCTAssertTrue(all, "the whole note is selected: \(selectionLabel.label)")
        app.typeText(content)
        origin = 0
        XCTAssertTrue(eventually { text() == content }, "the note is what was typed: \(text().suffix(60))")
    }

    private func at(_ pairs: (Int, Int)...) -> String { pairs.map { "\($0.0 + origin)-\($0.1 + origin)" }.joined(separator: ",") }

    /// The selection, from `live-selection`.
    private func selection() -> (location: Int, length: Int)? {
        let label = selectionLabel.exists ? selectionLabel.label : ""
        guard let found = label.range(of: #"^(\d+)\+(\d+) "#, options: .regularExpression) else { return nil }
        let fields = label[found].split(whereSeparator: { $0 == "+" || $0 == " " }).compactMap { Int($0) }
        return fields.count == 2 ? (fields[0], fields[1]) : nil
    }

    /// Moves the caret to `target` (an offset in what was typed) with the arrow keys, one press at a time, reading where it is after each: a press sent while the
    /// machine is busy is sometimes lost, so the keys are counted by where the caret went, not by how many were sent.
    private func go(to target: Int) {
        let goal = origin + target
        for _ in 0..<80 {
            guard let now = caret()?.location else { RunLoop.current.run(until: Date().addingTimeInterval(0.25)); continue }
            if now == goal { break }
            app.typeKey(now > goal ? .leftArrow : .rightArrow, modifierFlags: [])
            _ = eventually(2) { self.caret()?.location != now }
        }
        XCTAssertTrue(eventually(5) { self.caret()?.location == goal }, "the caret is at \(target): \(selectionLabel.label)")
    }

    /// Where the caret is, in the text and on the screen (`live-selection`: `12+0 x=104.5 y=68 sx=315.5 sy=190 «…»`).
    private func caret() -> (location: Int, screenX: Double, screenY: Double)? {
        let label = selectionLabel.exists ? selectionLabel.label : ""
        guard let found = label.range(of: #"^(\d+)\+(\d+) x=(-?[\d.]+) y=(-?[\d.]+) sx=(-?[\d.]+) sy=(-?[\d.]+)"#, options: .regularExpression) else { return nil }
        let fields = label[found].split(whereSeparator: { $0 == "+" || $0 == " " })
        guard fields.count == 6, let location = Int(fields[0]), let screenX = Double(fields[4].dropFirst(3)), let screenY = Double(fields[5].dropFirst(3)) else { return nil }
        return (location, screenX, screenY)
    }

    /// The note "Thoughts on Rust" (24) is the one open.
    private func theOtherNoteIsOpen() -> Bool {
        eventually { (app.textViews["note-editor"].value as? String ?? "").hasPrefix("---\ntitle: Thoughts on Rust\n") || app.navigationBars["Thoughts on Rust"].exists }
    }

    /// `see ` 0-4, `[` 4, `the other note` 5-19, `](note:24)` 19-29, ` here` 29-34.
    private static let line = "see [the other note](note:24) here"

    // MARK: Drawing

    func testALinksMarksHideAwayFromTheCaretAndShowDimmedUnderIt() throws {
        try launch()
        write(Self.line)
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 5), (19, 29)) }, "`[` and `](note:24)` are hidden with the caret at the end: \(drawn())")
        XCTAssertEqual(drawn()["link"], at((5, 19)), "and the words are drawn as the link")
        go(to: 29)  // right after the `)`: the selection touches the link
        XCTAssertTrue(eventually { drawn()["hidden"] == nil }, "its marks show with the caret at its end: \(drawn())")
        let dimmed = drawn()["dim64"] ?? ""
        for mark in [at((4, 5)), at((19, 21)), at((28, 29))] {
            XCTAssertTrue(dimmed.contains(mark), "the mark \(mark) is dimmed: \(dimmed)")
        }
        XCTAssertEqual(drawn()["link"], at((5, 19)), "the words stay the link's colour while it is edited")
        go(to: 4)  // to the `[`
        XCTAssertTrue(eventually { drawn()["hidden"] == nil }, "still shown at its start: \(drawn())")
        go(to: 3)  // `see|` and a space before the link: out of it
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 5), (19, 29)) }, "and hidden again once the caret has left it: \(drawn())")
    }

    func testAPdfLinkToAPdfNotHereIsStruckThroughAndSaysSo() throws {
        try launch()
        write("[gone](pdf:0123456789abcdef0123456789abcdef#page=2) after")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 1), (5, 51)) }, "its marks hide as any link's: \(drawn())")
        let report = drawn()
        XCTAssertEqual(report["struck"], at((0 + 1, 5)), "its words are struck through: \(report)")
        XCTAssertNil(report["link"], "and it is not a link to follow: \(report)")
        XCTAssertEqual(report["suffix"], at((5, 6)), "room is made after its words for \"(PDF not on this device)\": \(report)")
        add(XCTAttachment(screenshot: app.screenshot()))
        go(to: 50)  // into the link: no ↗ for a PDF that is not here
        XCTAssertTrue(eventually { drawn()["hidden"] == nil })
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertFalse(follow.exists && follow.isHittable, "no ↗ beside a link that goes nowhere")
    }

    // MARK: Following

    func testTheArrowAppearsWhileTheCaretIsInALinkAndOpensTheOtherNote() throws {
        try launch()
        write(Self.line)
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 5), (19, 29)) })
        XCTAssertFalse(follow.exists && follow.isHittable, "no ↗ with the caret away from the link")
        go(to: 26)  // in the address
        XCTAssertTrue(eventually { self.follow.exists && self.follow.isHittable }, "the ↗ is shown beside the link the caret is in")
        XCTAssertGreaterThanOrEqual(follow.frame.width, 44, "its target is 44 points")
        let caretAt = try XCTUnwrap(caret())
        XCTAssertGreaterThan(follow.frame.midX, caretAt.screenX, "it sits after the link: \(follow.frame) caret \(caretAt)")
        XCTAssertLessThan(abs(follow.frame.midY - (caretAt.screenY + 10)), 22, "on the link's line: \(follow.frame) caret \(caretAt)")
        add(XCTAttachment(screenshot: app.screenshot()))
        go(to: 34)  // back out, at the end of ` here`
        XCTAssertTrue(eventually { !(self.follow.exists && self.follow.isHittable) }, "and goes when the caret leaves the link")
        go(to: 26)
        XCTAssertTrue(eventually { self.follow.exists && self.follow.isHittable })
        follow.tap()
        XCTAssertTrue(theOtherNoteIsOpen(), "the ↗ opened the linked note: \(text().prefix(60))")
    }

    /// The note made only of a heading line, a blank one and `line`, with the caret at the start of `line` and its place on the screen.
    private func noteWithTheLinkAtTheTop() throws -> (location: Int, screenX: Double, screenY: Double) {
        replaceNote(with: "Links\n\n" + Self.line + "\n\nend")
        origin = 7
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 5), (19, 29)) }, "\(drawn())")
        go(to: 0)
        XCTAssertTrue(eventually { caret()?.location == origin }, "at the start of the link's line: \(selectionLabel.label)")
        let start = try XCTUnwrap(caret())
        go(to: 36)  // away from the link again: the end of the note
        XCTAssertTrue(eventually { drawn()["hidden"] == at((4, 5), (19, 29)) }, "\(drawn())")
        return start
    }

    func testCommandTapOnALinkOpensItAtOnce() throws {
        try launch()
        let start = try noteWithTheLinkAtTheTop()
        // About the middle of "the other note", which starts some 30 points along the line (after `see `).
        let point = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: start.screenX + 70, dy: start.screenY + 10))
        XCUIElement.perform(withKeyModifiers: .command) { point.tap() }
        XCTAssertTrue(theOtherNoteIsOpen(), "⌘-tap opened the linked note: \(text().prefix(60))")
    }

    func testAPlainTapOnALinkPutsTheCaretInItAndShowsTheArrow() throws {
        try launch()
        let start = try noteWithTheLinkAtTheTop()
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: start.screenX + 70, dy: start.screenY + 10)).tap()
        XCTAssertTrue(eventually { caret().map { (self.origin + 5...self.origin + 19).contains($0.location) } ?? false }, "the caret is in the link's words: \(selectionLabel.label)")
        XCTAssertTrue(eventually { drawn()["hidden"] == nil }, "its marks show: \(drawn())")
        XCTAssertTrue(text().hasPrefix("Links\n"), "the note did not change: \(text().prefix(30))")
        XCTAssertTrue(eventually { self.follow.exists && self.follow.isHittable }, "and the ↗ is there to follow it")
    }

    // MARK: Editing

    func testALinksWordsAndAddressAreEditedFromTheKeyboard() throws {
        try launch()
        write("[old words](note:25) tail")
        // `[` 0, `old words` 1-10, `](` 10-12, `note:25` 12-19, `)` 19, ` tail` 20-25.
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 1), (10, 20)) }, "\(drawn())")
        go(to: 19)  // before the `)`
        app.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertTrue(eventually { self.text().hasSuffix("[old words](note:2) tail") }, "Backspace took the 5: \(text().suffix(40))")
        app.typeText("4")
        XCTAssertTrue(eventually { text().hasSuffix("[old words](note:24) tail") }, "the address was edited: \(text().suffix(40))")
        go(to: 10)  // before the `]`
        app.typeText(" and new")
        XCTAssertTrue(eventually { text().hasSuffix("[old words and new](note:24) tail") }, "the words were edited: \(text().suffix(40))")
        go(to: 33)  // the end of the line: out of the link
        // `[` 0, `old words and new` 1-18, `](note:24)` 18-28.
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 1), (18, 28)) }, "drawn as the edited link: \(drawn())")
        XCTAssertEqual(drawn()["link"], at((1, 18)))
        go(to: 24)  // into the address again
        XCTAssertTrue(eventually { self.follow.exists && self.follow.isHittable })
        follow.tap()
        XCTAssertTrue(theOtherNoteIsOpen(), "the edited address is the one followed: \(text().prefix(60))")
    }
}
