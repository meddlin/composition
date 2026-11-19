import XCTest

/// Gate LD1, item 344 of docs/manual-tests/ipad.md: in the Live tab, writing with the Pencil over a drawing started Scribble, which wrote the strokes into the drawing's
/// hidden tag (" X" after `<Ink … />`), and the drawing was gone. Scribble may now not begin over anything Live draws in place of its source (`LiveScribble`), and a
/// Pencil touch on a drawing opens its canvas (`LivePencilOpen`). The UI tests have neither a Pencil nor Scribble, so:
/// - `live-scribble` says, for where each touch began, what the real Scribble delegate answers there (`n=3 x,y yes`), and `live-drawn` where the drawn items are;
/// - `-fingerIsPencil 1` lets a finger stand in for the Pencil on a drawing.
/// What the real Pencil does is manual-test item 372. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class LiveScribbleUITests: XCTestCase {
    private let app = XCUIApplication()

    /// Launches on note 25 of the organization backup, or with `note` nil on what `extra` opens (`-importText`), in the Live tab.
    private func launch(note: String? = "25", _ extra: [String] = []) throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup] + (note.map { ["-openNote", $0] } ?? []) + ["-openMode", "Live", "-liveReport", "1"] + extra
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

    /// A drawn item from `live-drawn`: its kind (`picture-drawio`, `pictureAfter-ink`, `block`, …), the picture's window frame, and the band its room takes.
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

    /// Touches the text at `point` (window coordinates) and returns what the Scribble delegate answered there: true when Scribble could have begun.
    private func scribbleAllowed(at point: CGPoint, _ what: String) throws -> Bool {
        let before = probe.label
        tapWindow(point)
        XCTAssertTrue(eventually(5) { probe.label != before }, "\(what): the touch at \(point) reached the text view (\(probe.label))")
        let parts = probe.label.split(separator: " ")
        let answer = try XCTUnwrap(parts.last.map(String.init), "\(what): \(probe.label)")
        let at = parts.count == 3 ? parts[1].split(separator: ",").compactMap { Double($0) } : []
        XCTAssertEqual(at.count, 2, "\(what): \(probe.label)")
        if at.count == 2 {
            XCTAssertEqual(at[0], Double(point.x), accuracy: 3, "\(what): the probe heard this touch: \(probe.label)")
            XCTAssertEqual(at[1], Double(point.y), accuracy: 3, "\(what): the probe heard this touch: \(probe.label)")
        }
        return answer == "yes"
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
        XCTAssertTrue(eventually(30) { item("picture-drawio") != nil && item("block") != nil && drawn()["block-pictured"] != nil },
                      "the diagram and the table are drawn: \(drawnProbe.label) \(drawn())")
        keepScreenshot("diagram and table drawn")
        var diagram = try XCTUnwrap(item("picture-drawio"))
        let table = try XCTUnwrap(item("block"))
        XCTAssertLessThan(diagram.picture.width, 300, "the diagram is drawn at its tag's width, narrower than the line: \(diagram)")

        // The lines above and below each: text, where Scribble writes as always.
        XCTAssertTrue(try scribbleAllowed(at: CGPoint(x: diagram.picture.midX, y: diagram.top - 8), "the line above the diagram"))
        XCTAssertTrue(try scribbleAllowed(at: CGPoint(x: diagram.picture.midX, y: diagram.bottom + 8), "the line below the diagram"))
        XCTAssertTrue(try scribbleAllowed(at: CGPoint(x: table.picture.midX, y: table.top - 8), "the line above the table"))
        XCTAssertTrue(try scribbleAllowed(at: CGPoint(x: table.picture.midX, y: table.bottom + 8), "the line below the table"))
        // The table's picture.
        XCTAssertFalse(try scribbleAllowed(at: CGPoint(x: table.picture.minX + min(table.picture.width / 2, 80), y: table.picture.midY), "the table"))
        // Beside the narrow diagram, on its band: this touch puts the caret in its tag, which then shows, with the diagram after it.
        diagram = try XCTUnwrap(item("picture-drawio"))
        XCTAssertFalse(try scribbleAllowed(at: CGPoint(x: diagram.picture.maxX + 60, y: diagram.picture.midY), "beside the diagram"))
        XCTAssertTrue(eventually { item("pictureAfter-drawio") != nil }, "the diagram's tag shows, with the diagram after it: \(drawnProbe.label)")
        let after = try XCTUnwrap(item("pictureAfter-drawio"))
        keepScreenshot("the diagram's tag revealed")
        // The diagram drawn after its tag is still not written on; the tag's own line is text.
        XCTAssertFalse(try scribbleAllowed(at: CGPoint(x: after.picture.midX, y: after.picture.midY), "the diagram after its tag"))
        XCTAssertTrue(try scribbleAllowed(at: CGPoint(x: after.picture.minX + 40, y: after.top - 8), "the diagram's revealed tag"))

        // The Markdown tab draws nothing: Scribble writes everywhere, where the diagram was too.
        for _ in 0..<3 where report.label != "markdown" {
            app.buttons["Markdown"].tap()
            _ = eventually(10) { report.label == "markdown" }
        }
        XCTAssertEqual(report.label, "markdown", "the Markdown tab is showing")
        XCTAssertTrue(eventually { items().isEmpty }, "nothing drawn in the Markdown tab: \(drawnProbe.label)")
        XCTAssertTrue(try scribbleAllowed(at: CGPoint(x: diagram.picture.midX, y: diagram.picture.midY), "the Markdown tab"))
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
        try launch(["-fingerIsPencil", "1"])
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
    }
}
