import XCTest

/// Code blocks in the Live tab (docs/ipad-live-default-plan.md, Step 3): each line in the Preview's code font on one rounded fill in the scheme's `surface`
/// colour, a fenced block's fences collapsed while the caret is outside it (V2) and a top-level indented block's indent hidden. What is drawn is checked against
/// the desktop's own `liveCode` (CompositionCore's `LiveConformanceTests`); this checks that the app draws it, through the editor's `live-report` element
/// (`-liveReport 1`: `code`, `code-first`, `code-last`, `collapsed`, `hidden`), and the fill's pixels in each of the five schemes. apps/ios/scripts/ui-test.sh
/// passes the backup in.
@MainActor
final class LiveCodeUITests: XCTestCase {
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

    /// What the Live tab has made of the text, as `class → ranges`.
    private func drawn() -> [String: String] {
        // The frontmatter's header block (Step 7) left out: see `LiveReportReading`.
        LiveReportReading.parse(report.exists ? report.label : "")
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

    /// The ranges the report gives, written as offsets in what `write` typed.
    private func at(_ pairs: (Int, Int)...) -> String { pairs.map { "\($0.0 + origin)-\($0.1 + origin)" }.joined(separator: ",") }

    private func press(_ key: XCUIKeyboardKey, _ times: Int = 1) {
        for _ in 0..<times {
            app.typeKey(key, modifierFlags: [])
            RunLoop.current.run(until: Date().addingTimeInterval(0.04))
        }
    }

    // MARK: Lines, fences and indents

    func testAFencedBlocksLinesAreOnOneFillAndItsFencesCollapseAwayFromIt() throws {
        try launch()
        // Lines: `text` 0, the opening fence 6 to 10, `let a = 1` 10 to 20, `let b = 2` 20 to 30, the closing fence 30 to 34, `end` 35.
        write("text\n\n```\nlet a = 1\nlet b = 2\n```\n\nend")
        func away() -> Bool {
            let look = drawn()
            return look["code"] == at((10, 30)) && look["code-first"] == at((10, 20)) && look["code-last"] == at((20, 30))
                && look["collapsed"] == at((6, 10), (30, 34)) && look["hidden"] == at((6, 9), (30, 33))
        }
        XCTAssertTrue(eventually { away() }, "the code lines are on the fill and the fences are collapsed and hidden with the caret outside the block: \(drawn())")
        press(.upArrow, 3)  // the line `let b = 2`
        XCTAssertTrue(eventually {
            let look = drawn()
            return look["code"] == at((6, 34)) && look["code-first"] == at((6, 10)) && look["code-last"] == at((30, 34)) && look["collapsed"] == nil && look["hidden"] == nil
        }, "with the caret in the block the fences show, on the fill, as its first and last lines: \(drawn())")
        press(.downArrow, 3)
        XCTAssertTrue(eventually { away() }, "and collapse again when it is out of it: \(drawn())")
    }

    func testAnIndentedBlockIsOnTheFillWithItsIndentHidden() throws {
        try launch()
        // `    one` 6 to 14 (its indent 6 to 10), `    two` 14 to 21 (its indent 14 to 18).
        write("text\n\n    one\n    two\n\nend")
        XCTAssertTrue(eventually { drawn()["code"] == at((6, 22)) && drawn()["hidden"] == at((6, 10), (14, 18)) },
            "the block's two lines are on the fill and their indent hidden: \(drawn())")
        press(.upArrow, 2)  // the line `    two`
        XCTAssertTrue(eventually { drawn()["code"] == at((6, 22)) && drawn()["hidden"] == nil }, "the indent shows while the caret is in the block: \(drawn())")
    }

    func testTypingInABlockKeepsItOnTheFillAndANewLineJoinsIt() throws {
        try launch()
        write("text\n\n```\none\n```\n\nend")
        XCTAssertTrue(eventually { drawn()["code"] == at((10, 14)) }, "one line of code: \(drawn())")
        press(.upArrow, 3)  // the line `one`
        app.typeKey(.rightArrow, modifierFlags: .command)
        app.typeText("\ntwo")
        // `one` 10 to 14, `two` 14 to 18; the fences 6 to 10 and 18 to 22 show, on the fill, while the caret is in the block.
        XCTAssertTrue(eventually { drawn()["code"] == at((6, 22)) && drawn()["code-first"] == at((6, 10)) && drawn()["code-last"] == at((18, 22)) },
            "the new line is in the block: \(drawn())")
        press(.downArrow, 3)
        XCTAssertTrue(eventually { drawn()["code"] == at((10, 18)) && drawn()["collapsed"] == at((6, 10), (18, 22)) }, "and both lines stay on it: \(drawn())")
    }

    // MARK: What the screen shows, in each colour scheme (pixels)

    /// A scheme's `surface`, from the real tokens (the desktop's `globals.css` through `Theme`, checked by CompositionCore's `AppearanceConformanceTests`).
    private struct Scheme {
        let name: String
        let surface: (r: Int, g: Int, b: Int)
    }

    private static let schemes = [
        Scheme(name: "dark", surface: (0x1e, 0x1e, 0x1e)),
        Scheme(name: "light", surface: (0xed, 0xed, 0xe8)),
        Scheme(name: "forest", surface: (0x13, 0x20, 0x19)),
        Scheme(name: "wine", surface: (0x22, 0x11, 0x1a)),
        Scheme(name: "cream", surface: (0xee, 0xe5, 0xd0)),
    ]

    /// How many pixels of the window are within `tolerance` of `color`, and the longest straight run of them along a row or down a column.
    private func look(for color: (r: Int, g: Int, b: Int), tolerance: Int = 2) throws -> (count: Int, longestRun: Int) {
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
        var count = 0, longest = 0
        for y in 0..<image.height {
            var run = 0
            for x in 0..<image.width { if near(x, y) { count += 1; run += 1; longest = max(longest, run) } else { run = 0 } }
        }
        for x in 0..<image.width {
            var run = 0
            for y in 0..<image.height { if near(x, y) { run += 1; longest = max(longest, run) } else { run = 0 } }
        }
        return (count, longest)
    }

    private func checkTheFillIsPainted(in scheme: Scheme) throws {
        try launch(["-theme", scheme.name])
        // Six lines of code, and the caret after the block (on `end`), so that its fences are collapsed.
        write("above\n\n```\nfirst line of the block\nsecond line\nthird line\nfourth line\nfifth line\nsixth line\n```\n\nend")
        XCTAssertTrue(eventually { drawn()["code"] != nil && drawn()["collapsed"] != nil }, "\(scheme.name): the block is in the text: \(drawn())")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let live = try look(for: scheme.surface)
        // The same note in the Markdown tab: the block is text there, with no fill (other things on the screen in `surface`, if any, are in both).
        app.buttons["Markdown"].tap()
        XCTAssertTrue(eventually { report.label == "markdown" })
        let plain = try look(for: scheme.surface)
        // Six lines of the code font and 24 points of padding, across a line of the note: some 160 by 600 points, minus the letters, at the screen's scale.
        XCTAssertGreaterThan(live.count - plain.count, 60_000, "\(scheme.name): the fill is painted behind the block (\(live.count) pixels of its colour in Live, \(plain.count) in Markdown)")
        XCTAssertGreaterThan(live.longestRun, 800, "\(scheme.name): the fill runs across a line of the note (the longest run of its colour is \(live.longestRun) pixels)")
        app.buttons["Live"].tap()
        XCTAssertTrue(eventually { drawn()["code"] != nil })
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "live code block, \(scheme.name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTheDarkSchemePaintsTheCodeFill() throws { try checkTheFillIsPainted(in: Self.schemes[0]) }
    func testTheLightSchemePaintsTheCodeFill() throws { try checkTheFillIsPainted(in: Self.schemes[1]) }
    func testTheForestSchemePaintsTheCodeFill() throws { try checkTheFillIsPainted(in: Self.schemes[2]) }
    func testTheWineSchemePaintsTheCodeFill() throws { try checkTheFillIsPainted(in: Self.schemes[3]) }
    func testTheCreamSchemePaintsTheCodeFill() throws { try checkTheFillIsPainted(in: Self.schemes[4]) }
}
