import XCTest

/// Gate LD1, item 344 of docs/manual-tests/ipad.md: in the Live tab, writing with the Pencil over a drawing started Scribble, which wrote the strokes into the drawing's
/// hidden tag (" X" after `<Ink … />`), and the drawing was gone. Scribble may now not begin over anything Live draws in place of its source (`LiveScribble`), and a
/// Pencil touch on a drawing opens its canvas (`LivePencilOpen`). The UI tests have neither a Pencil nor Scribble, so:
/// - `live-scribble` says, for where each touch began, what the real Scribble delegate answers there (`n=3 x,y yes`), and `live-drawn` where the drawn items are;
/// - `-fingerIsPencil 1` lets a finger stand in for the Pencil on a drawing.
/// What the real Pencil does is manual-test item 372. Appearance ▸ Writing ▸ "Write with the Pencil (Scribble)" (`PencilScribble`) is off until switched on, and off
/// Scribble begins nowhere: these tests launch with it on (`-pencilScribble 1`) unless they say otherwise, and `testScribbleFollowsTheSetting` checks the switch.
/// apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class LiveScribbleUITests: XCTestCase {
    private let app = XCUIApplication()

    /// Launches on note 25 of the organization backup, or with `note` nil on what `extra` opens (`-importText`), in the Live tab, with Scribble switched on unless
    /// `extra` says otherwise (`-pencilScribble` or `-resetPencilScribble`).
    private func launch(note: String? = "25", _ extra: [String] = []) throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup] + (note.map { ["-openNote", $0] } ?? []) + ["-openMode", "Live", "-liveReport", "1"]
            + (extra.contains { $0.hasSuffix("encilScribble") } ? [] : ["-pencilScribble", "1"]) + extra
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }
    private var probe: XCUIElement { app.descendants(matching: .any)["live-scribble"] }
    private var drawnProbe: XCUIElement { app.descendants(matching: .any)["live-drawn"] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func text() -> String { (editor.value as? String) ?? "" }

    private func drawn() -> [String: String] { LiveReportReading.parse(report.exists ? report.label : "") }

    /// A drawn item from `live-drawn`: its kind (`picture-drawio`, `pictureAfter-ink`, `block-table`, …), the picture's window frame, and the band its room takes.
    private struct Item {
        let kind: String
        let picture: CGRect
        let top: CGFloat
        let bottom: CGFloat
    }

    private func items() -> [Item] {
        let label = drawnProbe.exists ? drawnProbe.label : ""
        return label.split(separator: ";").compactMap { entry in
            let parts = entry.split(separator: " ")
            guard parts.count == 3 else { return nil }
            let frame = parts[1].split(separator: ",").compactMap { Double($0) }
            let band = parts[2].split(separator: "-").compactMap { Double($0) }
            guard frame.count == 4, band.count == 2 else { return nil }
            return Item(kind: String(parts[0]), picture: CGRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]), top: band[0], bottom: band[1])
        }
    }

    private func item(_ kind: String) -> Item? { items().first { $0.kind == kind } }

    private func tapWindow(_ point: CGPoint) {
        app.windows.firstMatch.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
    }

    /// Touches the text at `point` (window coordinates) and checks what the Scribble delegate answered there: `allowed` when Scribble could have begun.
    private func checkScribble(at place: @autoclosure () throws -> CGPoint, allowed: Bool, _ what: String) throws {
        // The on-screen keyboard (the Simulator has no hardware one here) covers the lower part of the screen once the text has the caret: the note is scrolled
        // until the place is clear of it, and the place read again, since scrolling moves it.
        var point = try place()
        for _ in 0..<6 {
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists && keyboard.frame.height > 50 ? keyboard.frame.minY - 30 : app.windows.firstMatch.frame.maxY - 30
            let top = editor.frame.minY + 30
            guard point.y > bottom || point.y < top else { break }
            let from = editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: point.y > bottom ? -120 : 120)))
            RunLoop.current.run(until: Date().addingTimeInterval(1))
            point = try place()
        }
        let before = probe.label
        tapWindow(point)
        XCTAssertTrue(eventually(5) { probe.label != before }, "\(what): the touch at \(point) reached the text view (\(probe.label))")
        let parts = probe.label.split(separator: " ")
        let at = parts.count == 3 ? parts[1].split(separator: ",").compactMap { Double($0) } : []
        XCTAssertEqual(at.count, 2, "\(what): \(probe.label)")
        if at.count == 2 {
            XCTAssertEqual(at[0], Double(point.x), accuracy: 3, "\(what): the probe heard this touch: \(probe.label)")
            XCTAssertEqual(at[1], Double(point.y), accuracy: 3, "\(what): the probe heard this touch: \(probe.label)")
        }
        XCTAssertEqual(parts.last.map(String.init), allowed ? "yes" : "no",
                       "\(what): Scribble \(allowed ? "may" : "may not") begin at \(point): \(probe.label); drawn: \(drawnProbe.label); selection: \(app.descendants(matching: .any)["live-selection"].label)")
    }

    private func keepScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: Scribble

    /// A diagram (`<Drawio />`, from the backup) and a table, each with a line of text above and below. Scribble may not begin on either's picture, nor beside it on
    /// its band (which would write into its hidden source), but may on the lines just above and below them (item 356), on a revealed tag's own line, and anywhere in
    /// the Markdown tab.
    func testScribbleCannotBeginOverWhatLiveDraws() throws {
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("live-scribble-note.md")
        try "# Scribble\n\nAbove the diagram.\n\n<Drawio src=\"app_data/demo-diagram-0123456789ab.png\" alt=\"Request flow\" width=\"240\" />\n\nBelow the diagram.\n\n| Tool | Use |\n| --- | --- |\n| Pencil | Write |\n\nBelow the table.\n"
            .write(to: file, atomically: true, encoding: .utf8)
        try launch(note: nil, ["-importText", file.path])
        XCTAssertTrue(eventually { text().contains("<Drawio") }, "the imported note is open: \(text().prefix(80))")
        XCTAssertTrue(eventually(30) { item("picture-drawio") != nil && item("block-table") != nil && drawn()["block-pictured"] != nil },
                      "the diagram and the table are drawn: \(drawnProbe.label) \(drawn())")
        keepScreenshot("diagram and table drawn")
        // Where each is is read again before every touch: a touch near a picture can put the caret in its source, which then shows and moves what is below.
        func diagram() throws -> Item { try XCTUnwrap(items().first { $0.kind.hasSuffix("-drawio") }, "the diagram: \(drawnProbe.label)") }
        func table() throws -> Item { try XCTUnwrap(items().first { $0.kind.hasSuffix("-table") }, "the table: \(drawnProbe.label)") }
        XCTAssertLessThan(try diagram().picture.width, 300, "the diagram is drawn at its tag's width, narrower than the line: \(drawnProbe.label)")

        // The lines above and below each: text, where Scribble writes as always.
        try checkScribble(at: CGPoint(x: try diagram().picture.midX, y: try diagram().bottom + 8), allowed: true, "the line below the diagram")
        try checkScribble(at: CGPoint(x: try table().picture.midX, y: try table().bottom + 8), allowed: true, "the line below the table")
        try checkScribble(at: CGPoint(x: try table().picture.midX, y: try table().top - 8), allowed: true, "the line above the table")
        try checkScribble(at: CGPoint(x: try diagram().picture.midX, y: try diagram().top - 8), allowed: true, "the line above the diagram")
        // The table's picture, with the caret away from it, so that it is drawn in place of its source.
        try checkScribble(at: CGPoint(x: try diagram().picture.midX, y: try diagram().bottom + 8), allowed: true, "the line below the diagram, again")
        XCTAssertTrue(eventually { items().contains { $0.kind == "block-table" } }, "the table is drawn in place of its source: \(drawnProbe.label)")
        try checkScribble(at: CGPoint(x: try table().picture.minX + min(try table().picture.width / 2, 80), y: try table().picture.midY), allowed: false, "the table")
        // Beside the narrow diagram, on its band (the caret moved off it first): this touch puts the caret in its tag, which then shows, with the diagram after it.
        try checkScribble(at: CGPoint(x: try table().picture.midX, y: try table().bottom + 8), allowed: true, "the line below the table, again")
        XCTAssertTrue(eventually { items().contains { $0.kind == "picture-drawio" } }, "the diagram is drawn in place of its tag: \(drawnProbe.label)")
        try checkScribble(at: CGPoint(x: try diagram().picture.maxX + 60, y: try diagram().picture.midY), allowed: false, "beside the diagram")
        XCTAssertTrue(eventually { items().contains { $0.kind == "pictureAfter-drawio" } }, "the diagram's tag shows, with the diagram after it: \(drawnProbe.label)")
        func after() throws -> Item { try XCTUnwrap(item("pictureAfter-drawio"), "the diagram after its tag: \(drawnProbe.label)") }
        keepScreenshot("the diagram's tag revealed")
        // The diagram drawn after its tag is still not written on; the tag's own line is text.
        try checkScribble(at: CGPoint(x: try after().picture.midX, y: try after().picture.midY), allowed: false, "the diagram after its tag")
        try checkScribble(at: CGPoint(x: try after().picture.minX + 40, y: try after().top - 8), allowed: true, "the diagram's revealed tag")

        // The Markdown tab draws nothing: Scribble writes everywhere, the tags' lines too.
        for _ in 0..<3 where report.label != "markdown" {
            app.buttons["Markdown"].tap()
            _ = eventually(10) { report.label == "markdown" }
        }
        XCTAssertEqual(report.label, "markdown", "the Markdown tab is showing")
        XCTAssertTrue(eventually { items().isEmpty }, "nothing drawn in the Markdown tab: \(drawnProbe.label)")
        let tagLine = try XCTUnwrap(app.descendants(matching: .any)["live-selection"].label.split(separator: " ").first { $0.hasPrefix("sy=") }.flatMap { Double($0.dropFirst(3)) }, "where the caret is")
        try checkScribble(at: CGPoint(x: editor.frame.midX, y: tagLine + 10), allowed: true, "the Markdown tab, on the diagram's tag")
        leaveTheCaretAtTheTop()
    }

    // MARK: The setting

    /// Opens the Appearance sheet and scrolls to Writing's "Write with the Pencil (Scribble)".
    private func scribbleToggle() -> XCUIElement {
        let appearance = app.buttons["sidebar-appearance"]
        if !(appearance.exists && appearance.isHittable) { app.buttons["focus-toggle"].tap() }  // the lists, whose foot has the Appearance button
        XCTAssertTrue(appearance.waitForExistence(timeout: 10))
        appearance.tap()
        XCTAssertTrue(app.buttons["scheme-forest"].waitForExistence(timeout: 20), "the sheet is open")
        let toggle = app.switches["scribble-toggle"]
        for _ in 0..<6 where !(toggle.exists && toggle.isHittable) { app.buttons["scheme-forest"].swipeUp() }
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "the Writing section has the Scribble switch")
        return toggle
    }

    /// Goes to the Markdown tab, or back to Live.
    private func choose(_ tab: String) {
        for _ in 0..<3 where (report.label == "markdown") != (tab == "Markdown") {
            app.buttons[tab].tap()
            _ = eventually(10) { (report.label == "markdown") == (tab == "Markdown") }
        }
        XCTAssertEqual(report.label == "markdown", tab == "Markdown", "the \(tab) tab is showing: \(report.label.prefix(40))")
    }

    /// Appearance ▸ Writing ▸ "Write with the Pencil (Scribble)": off when never chosen, and then Scribble may begin nowhere in the note's text, in the Live tab or the
    /// Markdown tab; switched on in the sheet, it may again, in both.
    func testScribbleFollowsTheSetting() throws {
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("scribble-setting-note.md")
        try "Words to write beside.\n\nMore words to write beside.\n\nAnd a last line of words.\n".write(to: file, atomically: true, encoding: .utf8)
        try launch(note: nil, ["-importText", file.path, "-resetPencilScribble", "1"])
        addTeardownBlock { @MainActor in
            let reset = XCUIApplication()
            reset.launchArguments = ["-resetPencilScribble", "1"]
            reset.launch()
            reset.terminate()
        }
        XCTAssertTrue(eventually { text().contains("Words to write beside.") }, "the imported note is open: \(text().prefix(80))")
        func onTheText() -> CGPoint { CGPoint(x: editor.frame.midX, y: editor.frame.minY + editor.frame.height * 0.3) }

        try checkScribble(at: onTheText(), allowed: false, "the Live tab, with nothing chosen")
        choose("Markdown")
        try checkScribble(at: onTheText(), allowed: false, "the Markdown tab, with nothing chosen")

        let toggle = scribbleToggle()
        XCTAssertEqual(toggle.value as? String, "0", "the switch is off until switched on")
        keepScreenshot("Write with the Pencil (Scribble), off")
        for _ in 0..<3 where (toggle.value as? String) != "1" {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
            _ = eventually(5) { (toggle.value as? String) == "1" }
        }
        XCTAssertEqual(toggle.value as? String, "1", "the switch is on")
        app.buttons["Done"].tap()
        XCTAssertTrue(eventually { !app.buttons["scheme-forest"].exists }, "the sheet is closed")

        try checkScribble(at: onTheText(), allowed: true, "the Markdown tab, switched on")
        choose("Live")
        try checkScribble(at: onTheText(), allowed: true, "the Live tab, switched on")
        leaveTheCaretAtTheTop()
    }

    /// The app restores the caret of the note that was open (per scene), and a later test's imported note can take this one's id: the caret goes to the top of the note,
    /// where a note that was never open has it, so that it does not reopen in a tag and show it (found running `LiveDrawingsUITests` after this class).
    private func leaveTheCaretAtTheTop() {
        let selection = app.descendants(matching: .any)["live-selection"]
        for _ in 0..<3 where !selection.label.hasPrefix("0+0 ") {
            if !editorHasFocus { editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap() }
            app.typeKey(.upArrow, modifierFlags: .command)
            _ = eventually(3) { selection.label.hasPrefix("0+0 ") }
        }
        XCTAssertTrue(selection.label.hasPrefix("0+0 "), "the caret is at the top: \(selection.label)")
    }

    // MARK: The Pencil on a drawing

    /// Draws a straight line across the canvas with a finger (PencilKit allows one when no Pencil is paired) and comes back with Done. As in `LiveDrawingsUITests`,
    /// each step is tried again on a busy machine.
    private func drawALine(onto canvas: XCUIElement) {
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
            .press(forDuration: 0.2, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.5)), withVelocity: .slow, thenHoldForDuration: 0.1)
        app.buttons["ink-done"].tap()
    }

    private var inkSources: [String] {
        let whole = text() as NSString
        let pattern = try! NSRegularExpression(pattern: "<Ink src=\"app_data/([^\"]+)\"")
        return pattern.matches(in: whole as String, range: NSRange(location: 0, length: whole.length)).map { whole.substring(with: $0.range(at: 1)) }
    }

    private var editorHasFocus: Bool { (editor.value(forKey: "hasKeyboardFocus") as? Bool) == true }

    private func write(_ content: String) {
        for _ in 0..<3 where !editorHasFocus {
            editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
            _ = eventually(5) { editorHasFocus }
        }
        XCTAssertTrue(editorHasFocus, "the editor has the keyboard")
        app.typeKey(.downArrow, modifierFlags: .command)
        app.typeText("\n\n" + content)
        XCTAssertTrue(eventually { text().hasSuffix(content) }, "the text is what was typed: \(text().suffix(80))")
    }

    /// A drawing made with Image › Drawing…, drawn in the Live tab: the Pencil (a finger, with `-fingerIsPencil 1`) on it opens its canvas, as a tap does in the
    /// Preview, rather than putting the caret in its tag; what is drawn there is stored under a new name, which the tag then names, and nothing is written in the text.
    func testThePencilOnADrawingOpensItsCanvas() throws {
        // With Scribble off: the Pencil on a drawing opens its canvas either way.
        try launch(["-fingerIsPencil", "1", "-pencilScribble", "0"])
        write("Above the drawing.")
        let canvas = app.descendants(matching: .any)["ink-canvas"]
        for _ in 0..<3 where inkSources.isEmpty {
            let item = app.buttons["new-drawing"]
            for _ in 0..<3 where !item.exists {
                app.buttons["Image"].firstMatch.tap()
                _ = item.waitForExistence(timeout: 5)
            }
            item.tap()
            XCTAssertTrue(canvas.waitForExistence(timeout: 20), "the canvas opens")
            drawALine(onto: canvas)
            _ = eventually(30) { !inkSources.isEmpty }
        }
        let first = try XCTUnwrap(inkSources.first, "the drawing's tag is in the note: \(text().suffix(160))")
        write("Below the drawing.")
        XCTAssertTrue(eventually(30) { item("picture-ink") != nil }, "the drawing is drawn in place of its tag: \(drawnProbe.label)")
        let textBefore = text()
        let picture = try XCTUnwrap(item("picture-ink")).picture

        tapWindow(CGPoint(x: picture.midX, y: picture.midY))
        XCTAssertTrue(canvas.waitForExistence(timeout: 20), "the Pencil on the drawing opened its canvas")
        XCTAssertEqual(text(), textBefore, "nothing was written in the note")
        keepScreenshot("the drawing's canvas, opened from the Live tab")
        // A second line, under the first, and Done: the drawing is stored again under its own new name.
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.6))
            .press(forDuration: 0.2, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.6)), withVelocity: .slow, thenHoldForDuration: 0.1)
        app.buttons["ink-done"].tap()
        XCTAssertTrue(eventually(30) { inkSources.count == 1 && inkSources.first != first }, "the tag names the edited drawing: \(inkSources), was \(first)")
        XCTAssertTrue(text().hasSuffix("Below the drawing."), "the rest of the note is as it was: \(text().suffix(120))")
        XCTAssertTrue(eventually(30) { item("picture-ink") != nil }, "the edited drawing is drawn: \(drawnProbe.label)")
        leaveTheCaretAtTheTop()
    }
}
