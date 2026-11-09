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
    private func write(_ content: String) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        let before = (text() as NSString).length
        app.typeText("\n\n" + content)
        origin = before + 2
        XCTAssertTrue(eventually { text().hasSuffix("\n\n" + content) }, "the text is what was typed: \(text().suffix(80))")
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
        // A tap on the drawn picture puts the caret in the Markdown that writes it. (The picture sits under the frontmatter, which is the same eight small lines
        // in either orientation: its top is a little over 250 points down and it is 300 or more tall, so a point 350 down is in it.)
        editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 250, dy: 350)).tap()
        XCTAssertTrue(eventually { drawn()["draw-pictureAfter"] != nil && drawn()["draw-picture"] == nil && drawn()["hidden"] == nil }, "the Markdown shows and the picture is drawn after it: \(drawn())")
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
