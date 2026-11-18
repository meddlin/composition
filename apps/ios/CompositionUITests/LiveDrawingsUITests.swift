import XCTest

/// Step 1 of docs/ipad-live-default-plan.md: `<Ink />` and `<Drawio />` drawn as pictures in the Live tab, as the Preview draws them. Which ranges are pictures is
/// checked against the desktop in CompositionCore (`LiveConformanceTests`, `LiveModelTests`); this checks that the app draws them: a drawing made with Image ›
/// Drawing… is drawn from its strokes in each colour scheme's own ink colour (pixels, as `LiveUITests`' tint and rule check), its tag shows with the drawing after it
/// while the caret is on it, and a diagram is drawn at half its pixels. A sibling of `LiveUITests` with the same launch and helpers, kept in a file of its own.
/// apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class LiveDrawingsUITests: XCTestCase {
    private let app = XCUIApplication()

    /// Launches on note 25 ("CI/CD pipelines cheat sheet" in the organization backup), or with `note` nil on what `extra` opens (`-importText`), in the Live tab.
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

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// What the Live tab has made of the text, as `class → ranges`, from `live-report`.
    private func drawn() -> [String: String] {
        // The frontmatter's header block (Step 7) left out: see `LiveReportReading`.
        LiveReportReading.parse(report.exists ? report.label : "")
    }

    private func text() -> String { (editor.value as? String) ?? "" }

    private var editorHasFocus: Bool { (editor.value(forKey: "hasKeyboardFocus") as? Bool) == true }

    /// Goes to the end of the note and types `content` there as a paragraph of its own. The tap that gives the editor the keyboard is tried again while it has not
    /// (on a busy machine, with several Simulators running, a tap is sometimes lost).
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

    /// The range `"a-b"` of the tag that starts with `prefix` in the text now.
    private func tagRange(_ prefix: String) -> String? {
        let whole = text() as NSString
        let start = whole.range(of: prefix)
        guard start.location != NSNotFound else { return nil }
        let end = whole.range(of: "/>", range: NSRange(location: start.location, length: whole.length - start.location))
        guard end.location != NSNotFound else { return nil }
        return "\(start.location)-\(NSMaxRange(end))"
    }

    // MARK: Pixels

    /// A scheme and the colour its ink is drawn in: the scheme's text colour (`InkPalette(theme:)`; Theme+Palettes.swift, from the desktop's `globals.css`).
    private struct Scheme {
        let name: String
        let ink: (r: Int, g: Int, b: Int)
    }

    private static let schemes = [
        Scheme(name: "dark", ink: (0xe0, 0xe0, 0xe0)),
        Scheme(name: "light", ink: (0x24, 0x29, 0x2f)),
        Scheme(name: "forest", ink: (0xd5, 0xe5, 0xda)),
        Scheme(name: "wine", ink: (0xec, 0xdd, 0xe0)),
        Scheme(name: "cream", ink: (0x3b, 0x32, 0x26)),
    ]

    /// The longest straight run of pixels within `tolerance` of `color`, along a row or down a column (the window's image comes turned a quarter in landscape).
    private func longestRun(of color: (r: Int, g: Int, b: Int), tolerance: Int = 6) throws -> Int {
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
        return longest
    }

    private func keepScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: A drawing

    /// Draws a straight line across the canvas with a finger (PencilKit allows one when no Pencil is paired), and comes back with Done; the note then has its tag. On a
    /// busy machine a menu tap can be lost, or a quick drag read as a tap (Done on a blank page is a Cancel), so each is tried again.
    private func drawALine() {
        let tagged = { [self] in tagRange("<Ink src=\"app_data/") != nil }
        for _ in 0..<3 where !tagged() {
            let item = app.buttons["new-drawing"]
            for _ in 0..<3 where !item.exists {
                app.buttons["Image"].firstMatch.tap()
                _ = item.waitForExistence(timeout: 5)
            }
            XCTAssertTrue(item.exists, "the Image menu offers a drawing")
            item.tap()
            let canvas = app.descendants(matching: .any)["ink-canvas"]
            XCTAssertTrue(canvas.waitForExistence(timeout: 20), "the canvas opens")
            // A third of the canvas's width, so that the stored drawing (cut to what was drawn) is narrower than the note's text and drawn at its own size.
            canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
                .press(forDuration: 0.2, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.5)), withVelocity: .slow, thenHoldForDuration: 0.1)
            app.buttons["ink-done"].tap()
            _ = eventually(30) { tagged() || !canvas.exists }
            _ = eventually(10) { tagged() }
        }
    }

    /// In `scheme`: a drawing made with Image › Drawing… in the Live tab is drawn in place of its tag, from its strokes, in the scheme's ink colour (a line of it, long
    /// as the stroke); with the caret on its line the tag shows, with the drawing after it; and the Markdown tab draws no such line.
    private func checkADrawingIsDrawn(in scheme: Scheme) throws {
        try launch(["-theme", scheme.name])
        write("Above the drawing.")
        drawALine()
        XCTAssertTrue(eventually(30) { tagRange("<Ink src=\"app_data/") != nil }, "\(scheme.name): the tag is in the note: \(text().suffix(160))")
        // Text after it, and the caret there: away from the tag, which is then hidden and the drawing drawn in its place.
        write("Below the drawing.")
        let tag = try XCTUnwrap(tagRange("<Ink src=\"app_data/"))
        XCTAssertTrue(eventually(30) { let now = drawn(); return now["draw-picture"] != nil && now["picture-ink"] != nil && now["ink-strokes"] != nil && now["hidden"]?.contains(tag) == true },
                      "\(scheme.name): the drawing is drawn from its strokes in place of its tag \(tag): \(drawn())")
        XCTAssertTrue(eventually(10) { (try? longestRun(of: scheme.ink)) ?? 0 > 400 },
                      "\(scheme.name): the line is drawn in the scheme's ink colour (the longest run of it is \((try? longestRun(of: scheme.ink)) ?? 0) pixels)")
        keepScreenshot("live drawing, \(scheme.name)")

        // The caret on the tag's line (up past the blank line between): the tag shows, and the drawing is drawn after it.
        let shows = { [self] in let now = drawn(); return now["draw-pictureAfter"] != nil && now["draw-picture"] == nil && now["hidden"]?.contains(tag) != true }
        for _ in 0..<4 where !shows() {
            app.typeKey(.upArrow, modifierFlags: [])
            _ = eventually(2) { shows() }
        }
        XCTAssertTrue(shows(), "\(scheme.name): with the caret on it the tag shows and the drawing is drawn after it: \(drawn())")
        XCTAssertGreaterThan(try longestRun(of: scheme.ink), 400, "\(scheme.name): the drawing is still drawn, after its tag")
        keepScreenshot("live drawing, caret on its tag, \(scheme.name)")

        // The Markdown tab has the tag's text only.
        for _ in 0..<3 where report.label != "markdown" {
            app.buttons["Markdown"].tap()
            _ = eventually(10) { report.label == "markdown" }
        }
        XCTAssertEqual(report.label, "markdown", "the Markdown tab is showing")
        XCTAssertLessThan(try longestRun(of: scheme.ink), 150, "\(scheme.name): no drawing in the Markdown tab")
    }

    func testADrawingIsDrawnInTheDarkScheme() throws { try checkADrawingIsDrawn(in: Self.schemes[0]) }
    func testADrawingIsDrawnInTheLightScheme() throws { try checkADrawingIsDrawn(in: Self.schemes[1]) }
    func testADrawingIsDrawnInTheForestScheme() throws { try checkADrawingIsDrawn(in: Self.schemes[2]) }
    func testADrawingIsDrawnInTheWineScheme() throws { try checkADrawingIsDrawn(in: Self.schemes[3]) }
    func testADrawingIsDrawnInTheCreamScheme() throws { try checkADrawingIsDrawn(in: Self.schemes[4]) }

    // MARK: A diagram

    /// A `<Drawio />` (the backup holds the showcase's diagram, 880 pixels wide) is drawn in place of its tag at half its pixels, 440 points, as the Preview draws it;
    /// with a width in its tag, at that width.
    func testADiagramIsDrawnAtHalfItsPixels() throws {
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("live-diagram-note.md")
        try "# Diagram\n\n<Drawio src=\"app_data/demo-diagram-0123456789ab.png\" alt=\"Request flow\" />\n\nBetween.\n\n<Drawio src=\"app_data/demo-diagram-0123456789ab.png\" alt=\"Narrow\" width=\"200\" />\n\nEnd."
            .write(to: file, atomically: true, encoding: .utf8)
        try launch(note: nil, ["-importText", file.path])
        XCTAssertTrue(eventually { text().contains("<Drawio") }, "the imported note is open: \(text().prefix(80))")
        XCTAssertTrue(eventually { drawn()["picture-drawio"] != nil }, "the diagrams are drawn: \(drawn())")
        let first = try XCTUnwrap(tagRange("<Drawio src=\"app_data/demo-diagram-0123456789ab.png\" alt=\"Request flow\""))
        // Two pictures in place of their tags, each 440 points wide when its tag gives no width.
        XCTAssertTrue(eventually { drawn()["natural440"] != nil && drawn()["draw-picture"]?.split(separator: ",").count == 2 }, "both are drawn in place, at 440 points: \(drawn())")
        XCTAssertTrue(drawn()["hidden"]?.contains(first) == true, "the first tag is hidden: \(drawn())")
        keepScreenshot("live diagrams")
    }
}
