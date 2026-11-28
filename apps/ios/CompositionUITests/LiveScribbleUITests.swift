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

    /// Makes a drawing with Image › Drawing… after a line of text, and a line of text after it; comes back with the drawing's stored name.
    private func makeADrawing(_ canvas: XCUIElement) throws -> String {
        write("Above the drawing.")
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
        let name = try XCTUnwrap(inkSources.first, "the drawing's tag is in the note: \(text().suffix(160))")
        write("Below the drawing.")
        XCTAssertTrue(eventually(30) { item("picture-ink") != nil }, "the drawing is drawn in place of its tag: \(drawnProbe.label)")
        return name
    }

    /// Item 372, steps 4 and 5 (decision I6): a finger's tap on a drawing puts the caret in its tag, which then shows, with the drawing under it, as on a picture.
    /// No `-fingerIsPencil` here: the finger is a finger.
    func testAFingerTapOnADrawingShowsItsTag() throws { try checkAFingerTapShowsTheTag(whileThePencilHovers: false) }

    /// The same while the Pencil hovers over the text, as it does in the hand that holds it (⌃⌥H with `-liveCompose 1` stands in for it: Scribble's questions, ten a
    /// second, and the hover). On the owner's iPad (main at 1add2d7) the tap did nothing: each of PencilKit's hover questions held the Live look still for Scribble.
    func testAFingerTapOnADrawingShowsItsTagWhileThePencilHovers() throws { try checkAFingerTapShowsTheTag(whileThePencilHovers: true) }

    private func checkAFingerTapShowsTheTag(whileThePencilHovers hovers: Bool) throws {
        try launch(hovers ? ["-liveCompose", "1"] : [])
        let canvas = app.descendants(matching: .any)["ink-canvas"]
        _ = try makeADrawing(canvas)
        // The caret off the drawing first, at the top, so that the tap is what moves it there.
        leaveTheCaretAtTheTop()
        if hovers { app.typeKey("h", modifierFlags: [.control, .option]) }
        XCTAssertTrue(eventually(30) { item("picture-ink") != nil }, "the drawing is drawn in place of its tag: \(drawnProbe.label)")
        let textBefore = text()
        let picture = try XCTUnwrap(item("picture-ink")).picture
        keepScreenshot("the drawing, before the tap")

        tapWindow(CGPoint(x: picture.midX, y: picture.midY))
        XCTAssertTrue(eventually(hovers ? 5 : 10) { item("pictureAfter-ink") != nil },
                      "one tap showed the drawing's tag, with the drawing after it: \(drawnProbe.label); selection: \(app.descendants(matching: .any)["live-selection"].label)")
        XCTAssertFalse(canvas.exists, "a finger's tap does not open the canvas")
        XCTAssertEqual(text(), textBefore, "nothing was written in the note")
        keepScreenshot("the drawing's tag, shown by a finger's tap")
        leaveTheCaretAtTheTop()
    }

    /// A drawing made with Image › Drawing…, drawn in the Live tab: the Pencil (a finger, with `-fingerIsPencil 1`) on it opens its canvas, as a tap does in the
    /// Preview, rather than putting the caret in its tag; what is drawn there is stored under a new name, which the tag then names, and nothing is written in the text.
    func testThePencilOnADrawingOpensItsCanvas() throws {
        try launch(["-fingerIsPencil", "1"])
        let canvas = app.descendants(matching: .any)["ink-canvas"]
        let first = try makeADrawing(canvas)
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

    // MARK: What says the Pencil opens a drawing (the owner's ask after item 372)

    /// A scheme and its rule colour (the text colour at 35% over the page, as `LiveUITests` has them): the colour of the border round a drawing.
    private struct Scheme {
        let name: String
        let rule: (r: Int, g: Int, b: Int)
    }

    private static let schemes = [
        Scheme(name: "dark", rule: (0x5a, 0x5a, 0x5a)),
        Scheme(name: "light", rule: (0xad, 0xaf, 0xaf)),
        Scheme(name: "forest", rule: (0x52, 0x5e, 0x57)),
        Scheme(name: "wine", rule: (0x61, 0x54, 0x57)),
        Scheme(name: "cream", rule: (0xb5, 0xae, 0xa0)),
    ]

    /// The longest straight run of pixels within `tolerance` of `color`, along a row or down a column (the window's image comes turned a quarter in landscape), and
    /// how many pixels the image has to a point.
    private func longestRun(of color: (r: Int, g: Int, b: Int), tolerance: Int = 4) throws -> (run: Int, scale: CGFloat) {
        let image = try XCTUnwrap(app.windows.firstMatch.screenshot().image.cgImage)
        var data = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        let context = try XCTUnwrap(CGContext(data: &data, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: space,
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        func near(_ x: Int, _ y: Int) -> Bool {
            let i = (y * image.width + x) * 4
            return abs(Int(data[i]) - color.r) <= tolerance && abs(Int(data[i + 1]) - color.g) <= tolerance && abs(Int(data[i + 2]) - color.b) <= tolerance
        }
        var longest = 0
        for y in 0..<image.height {
            var run = 0
            for x in 0..<image.width { if near(x, y) { run += 1; longest = max(longest, run) } else { run = 0 } }
        }
        for x in 0..<image.width {
            var run = 0
            for y in 0..<image.height { if near(x, y) { run += 1; longest = max(longest, run) } else { run = 0 } }
        }
        let window = app.windows.firstMatch.frame
        return (longest, CGFloat(max(image.width, image.height)) / max(window.width, window.height))
    }

    /// In `scheme`: a drawing is drawn with a border round it in the scheme's rule colour, a line of it as long as the drawing is wide, while a diagram in the same note
    /// (which has no canvas) has none; and the border takes no room: the drawing's band is the picture and its margins, as without it (item 344's size rule).
    private func checkTheBorder(in scheme: Scheme) throws {
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("live-border-note.md")
        try "# Border\n\n<Drawio src=\"app_data/demo-diagram-0123456789ab.png\" alt=\"Request flow\" width=\"240\" />\n".write(to: file, atomically: true, encoding: .utf8)
        try launch(note: nil, ["-importText", file.path, "-theme", scheme.name])
        XCTAssertTrue(eventually { text().contains("<Drawio") }, "the imported note is open: \(text().prefix(80))")
        XCTAssertTrue(eventually(30) { item("picture-drawio") != nil }, "the diagram is drawn: \(drawnProbe.label)")
        let diagram = try XCTUnwrap(item("picture-drawio")).picture
        let bare = try longestRun(of: scheme.rule)
        XCTAssertLessThan(CGFloat(bare.run), diagram.width * bare.scale * 0.8, "\(scheme.name): no border round the diagram (a run of \(bare.run) pixels of the rule colour)")

        let canvas = app.descendants(matching: .any)["ink-canvas"]
        _ = try makeADrawing(canvas)
        let drawing = try XCTUnwrap(item("picture-ink"))
        XCTAssertEqual(drawing.bottom - drawing.top, drawing.picture.height + 8, accuracy: 1.5,
                       "\(scheme.name): the drawing's band is the picture and its two 4-point margins, as before the border: \(drawnProbe.label)")
        // Its top and bottom edges are straight between the rounded corners (6 points each): as long as the drawing is wide, less those.
        let straight = (drawing.picture.width - 12) * bare.scale
        _ = eventually(3) { ((try? longestRun(of: scheme.rule).run).map { CGFloat($0) } ?? 0) >= straight }
        keepScreenshot("the border round a drawing, \(scheme.name)")
        XCTAssertTrue(eventually(10) { ((try? longestRun(of: scheme.rule).run).map { CGFloat($0) } ?? 0) >= straight },
                      "\(scheme.name): a border round the drawing, as wide as it, in the rule colour (the longest run is \((try? longestRun(of: scheme.rule).run) ?? 0) pixels; the drawing is \(drawing.picture.width) points wide)")
        leaveTheCaretAtTheTop()
    }

    func testADrawingHasABorderInTheDarkScheme() throws { try checkTheBorder(in: Self.schemes[0]) }
    func testADrawingHasABorderInTheLightScheme() throws { try checkTheBorder(in: Self.schemes[1]) }
    func testADrawingHasABorderInTheForestScheme() throws { try checkTheBorder(in: Self.schemes[2]) }
    func testADrawingHasABorderInTheWineScheme() throws { try checkTheBorder(in: Self.schemes[3]) }
    func testADrawingHasABorderInTheCreamScheme() throws { try checkTheBorder(in: Self.schemes[4]) }

    /// The moment the Pencil (a finger, with `-fingerIsPencil 1`) lands on a drawing it looks pressed, over the drawing and its border, before the canvas opens; the
    /// look goes once it has. `-livePressBeat 3` holds the pressed look for three seconds, so that it can be seen (in the app it is 0.12).
    func testThePencilOnADrawingLooksPressedBeforeItsCanvasOpens() throws {
        try launch(["-fingerIsPencil", "1", "-livePressBeat", "3"])
        let canvas = app.descendants(matching: .any)["ink-canvas"]
        _ = try makeADrawing(canvas)
        let picture = try XCTUnwrap(item("picture-ink")).picture
        let pressed = app.descendants(matching: .any)["live-drawing-pressed"]
        XCTAssertFalse(pressed.exists, "nothing looks pressed before the Pencil lands")

        tapWindow(CGPoint(x: picture.midX, y: picture.midY))
        XCTAssertTrue(pressed.waitForExistence(timeout: 2), "the drawing looks pressed as the Pencil lands")
        XCTAssertFalse(canvas.exists, "and the canvas is not open yet")
        let outset = picture.insetBy(dx: -3, dy: -3)
        XCTAssertEqual(pressed.frame.minX, outset.minX, accuracy: 1.5, "the pressed look is over the drawing and its border: \(pressed.frame), drawing \(picture)")
        XCTAssertEqual(pressed.frame.minY, outset.minY, accuracy: 1.5, "the pressed look is over the drawing and its border: \(pressed.frame), drawing \(picture)")
        XCTAssertEqual(pressed.frame.width, outset.width, accuracy: 1.5, "the pressed look is over the drawing and its border: \(pressed.frame), drawing \(picture)")
        XCTAssertEqual(pressed.frame.height, outset.height, accuracy: 1.5, "the pressed look is over the drawing and its border: \(pressed.frame), drawing \(picture)")
        keepScreenshot("the drawing pressed by the Pencil")
        XCTAssertTrue(canvas.waitForExistence(timeout: 20), "then the canvas opens")
        app.buttons["ink-cancel"].tap()
        XCTAssertTrue(eventually(10) { !canvas.exists }, "the canvas is closed")
        XCTAssertTrue(eventually(5) { !pressed.exists }, "nothing looks pressed once the canvas has opened")
        leaveTheCaretAtTheTop()
    }
}
