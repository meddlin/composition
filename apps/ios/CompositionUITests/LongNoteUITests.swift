import XCTest

/// Long notes (docs/ipad-live-view-plan.md, step L7): the colouring that runs in the background after a pause must come to rest. On a note of about 400,000 characters the
/// Editor lab's passes interrupted each other for ever (a pass still putting colours on was stopped by the next, and the stop started another), with the app at 110% CPU.
/// The first test is the lab's own check (`-labSettle`); the second is the editor proper (`MarkdownStyler`), which has the same passes: it reads the `colour-state` element
/// (`-colourState 1`), which says how many full passes have started and whether the colouring is settled (nothing reading, putting colours on or due, the colours made from a
/// model), and waits for it to be. apps/ios/scripts/ui-test.sh
/// passes the backup in.
@MainActor
final class LongNoteUITests: XCTestCase {
    private let app = XCUIApplication()

    private func backup() throws -> String {
        try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
    }

    private func eventually(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// The lab's text for `lines` lines, as `LabText.big` makes it: 20,000 lines are 404,540 characters.
    private func bigNote(lines: Int) -> String {
        var out = ["---", "title: Big note", "---", "# Big note", ""]
        var section = 0
        while out.count < lines {
            out += ["## Section \(section)", "", "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/\(section)) with é and 😀. The rest of this line is plain text to make it long enough to wrap onto a second line on an iPad.", "", "- item one", "- item two", "", "> a quote", "", "```", "let x = \(section)", "```", ""]
            section += 1
        }
        return out.joined(separator: "\n")
    }

    // MARK: The lab

    func testTheLabsColouringSettlesOnA20000LineNote() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        // The lab is reached from the notes browser, which needs notes: restore them first.
        app.launchArguments = ["-importBackup", try backup()]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        app.terminate()

        app.launchArguments = ["-openLab", "1", "-labSettle", "20000"]
        app.launch()
        let result = app.staticTexts["lab-benchmark"]
        XCTAssertTrue(result.waitForExistence(timeout: 60), "the lab did not report")
        XCTAssertTrue(eventually(90) { result.label.contains("SETTLED") || result.label.contains("DID NOT SETTLE") }, "the check did not finish: \(result.label)")
        add(XCTAttachment(string: result.label))
        print("lab settle check: \(result.label)")
        XCTAssertTrue(result.label.contains("SETTLED") && !result.label.contains("DID NOT"), result.label)
        // A pass asked for while another was putting colours on waited for it: nothing was stopped. After it settled, every letter typed was coloured as an edit, none by
        // reading the whole note again.
        XCTAssertTrue(result.label.contains(" 0 stopped"), result.label)
        XCTAssertTrue(result.label.contains("60 quick edits, 0 not"), result.label)
    }

    // MARK: The editor

    private var state: XCUIElement { app.descendants(matching: .any)["colour-state"] }

    /// "passes=3 settled=yes" as (3, true).
    private func colourState() -> (passes: Int, settled: Bool)? {
        guard state.exists else { return nil }
        let label = state.label
        guard let match = label.range(of: #"passes=(\d+) settled=(yes|no)"#, options: .regularExpression) else { return nil }
        let parts = label[match].split(whereSeparator: { $0 == " " || $0 == "=" })
        guard parts.count == 4, let passes = Int(parts[1]) else { return nil }
        return (passes, parts[3] == "yes")
    }

    /// Waits until the colouring has been settled, with no pass started, for `quiet` seconds; the number of passes started so far, or nil if it did not come to rest in `timeout`.
    private func settled(timeout: TimeInterval, quiet: TimeInterval = 1.5) -> Int? {
        var last = -1
        var since = Date()
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if let now = colourState() {
                if now.passes != last || !now.settled { last = now.passes; since = Date() }
                if now.settled, Date().timeIntervalSince(since) >= quiet { return now.passes }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return nil
    }

    func testTheEditorsColouringSettlesOnA404540CharacterNote() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("long-note-20000.md")
        try bigNote(lines: 20_000).write(to: file, atomically: true, encoding: .utf8)
        // `-importText` makes a note of the file and opens it, in the Markdown tab.
        app.launchArguments = ["-importBackup", try backup(), "-importText", file.path, "-openMode", "Markdown", "-colourState", "1"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        let editor = app.textViews["note-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 60), "the long note did not open")

        let opened = settled(timeout: 30)
        XCTAssertNotNil(opened, "the colouring did not come to rest after the note was opened: \(state.exists ? state.label : "no colour-state element")")

        // Typing, with pauses that are longer than the 0.3 s after which a pass starts.
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        for word in ["first ", "second ", "third "] {
            app.typeText(word)
            RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        }
        let typed = settled(timeout: 30)
        XCTAssertNotNil(typed, "the colouring did not come to rest after typing: \(state.label)")

        // The tabs: each switch colours the whole note again, and the next may come while the last is still going on.
        for _ in 0..<3 {
            app.buttons["Live"].tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
            app.buttons["Markdown"].tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        }
        let switched = settled(timeout: 40)
        XCTAssertNotNil(switched, "the colouring did not come to rest after the tabs were switched: \(state.label)")
        if let typed, let switched { XCTAssertLessThanOrEqual(switched - typed, 20, "a runaway of passes after the tabs were switched") }
    }
}
