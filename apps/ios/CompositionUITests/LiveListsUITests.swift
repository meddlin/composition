import XCTest

/// Lists, task lists and quotes in the Live tab (docs/ipad-live-default-plan.md, Step 4). What is hidden and drawn is checked against the desktop's own
/// `listDecorations` in CompositionCore's `LiveConformanceTests`; this checks that the app draws it, from the editor's `live-report` element (`-liveReport 1`):
/// `hidden` (the marks), `list-bullet`, `list-number`, `list-box`, `list-ticked` and `list-line` (the paragraphs that draw a marker, a box or neither),
/// `quote1` and `quote2` (how many bars), `indentH-F` (the paragraph's head indent and first-line indent, in points) and `dimNN` (muted text). The boxes are
/// tapped where `live-boxes` says they are drawn. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class LiveListsUITests: XCTestCase {
    private let app = XCUIApplication()

    private func launch() throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        // Note 25 is "CI/CD pipelines cheat sheet" in the organization backup: some plain text and its frontmatter, no lists.
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Live", "-liveReport", "1"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }
    private var selection: XCUIElement { app.descendants(matching: .any)["live-selection"] }
    private var boxes: XCUIElement { app.descendants(matching: .any)["live-boxes"] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func drawn() -> [String: String] {
        let label = report.exists ? report.label : ""
        var out: [String: String] = [:]
        for part in label.split(separator: ";") {
            let pair = part.split(separator: ":", maxSplits: 1)
            if pair.count == 2 { out[String(pair[0])] = String(pair[1]) }
        }
        return out
    }

    /// The classes whose ranges include `range` (written in offsets of what `write` typed).
    private func classes(covering from: Int, _ to: Int) -> Set<String> {
        var found: Set<String> = []
        for (name, ranges) in drawn() {
            for range in ranges.split(separator: ",") {
                let ends = range.split(separator: "-").compactMap { Int($0) }
                if ends.count == 2, ends[0] <= from + origin, ends[1] >= to + origin { found.insert(name) }
            }
        }
        return found
    }

    private func text() -> String { (editor.value as? String) ?? "" }
    private var origin = 0

    /// Types `content` at the end of the note as a paragraph of its own and leaves the caret at its end. Return continues a list or a quote, so after each
    /// line break whatever Return wrote on the new line (`- `, `> `) is selected and typed over, and the text is as written.
    private func write(_ content: String) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        let before = (text() as NSString).length
        app.typeText("\n\n")
        for (index, line) in content.components(separatedBy: "\n").enumerated() {
            if index > 0 {
                app.typeText("\n")
                app.typeKey(.leftArrow, modifierFlags: [.shift, .command])
                app.typeText("x" + XCUIKeyboardKey.delete.rawValue)
            }
            if !line.isEmpty { app.typeText(line) }
        }
        origin = before + 2
        XCTAssertTrue(eventually { text().hasSuffix("\n\n" + content) }, "the text is what was typed: \(text().suffix(80))")
    }

    private func at(_ pairs: (Int, Int)...) -> String { pairs.map { "\($0.0 + origin)-\($0.1 + origin)" }.joined(separator: ",") }

    /// Where the caret is, in offsets of what `write` typed.
    private func caret() -> Int? {
        guard let first = selection.label.split(separator: "+").first, let at = Int(first) else { return nil }
        return at - origin
    }

    private func press(_ key: XCUIKeyboardKey, _ times: Int = 1, modifiers: XCUIElement.KeyModifierFlags = []) {
        for _ in 0..<times {
            app.typeKey(key, modifierFlags: modifiers)
            RunLoop.current.run(until: Date().addingTimeInterval(0.04))
        }
    }

    /// The screen centres of the drawn task boxes, in the order of the text.
    private func boxCentres() -> [CGPoint] {
        boxes.label.split(separator: ";").compactMap { pair in
            let xy = pair.split(separator: ",").compactMap { Double($0) }
            return xy.count == 2 ? CGPoint(x: xy[0], y: xy[1]) : nil
        }
    }

    private func tapScreen(_ point: CGPoint) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
    }

    private func screenshot(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    // MARK: Bullets and numbers

    func testBulletsAreDrawnInPlaceOfTheirMarksAndTheMarksShowOnTheCaretsLine() throws {
        try launch()
        // 0-5 "- one", 6-11 "- two", 13-16 "end".
        write("- one\n- two\n\nend")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (6, 8)) }, "both marks are hidden with the caret on the last line: \(drawn())")
        XCTAssertEqual(drawn()["list-bullet"], at((0, 12)), "and both lines draw a bullet")
        XCTAssertEqual(drawn()["indent32-32"], at((0, 12)), "the text one level in, its wrapped lines hanging under it")
        screenshot("bullets away from the caret")
        press(.upArrow, 2)
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2)) }, "on the caret's line the `- ` shows: \(drawn())")
        XCTAssertEqual(drawn()["indent32-0"], at((6, 12)), "starting a level further out, where the bullet was")
        XCTAssertEqual(drawn()["list-bullet"], at((0, 6)), "and no bullet is drawn on that line")
        screenshot("the caret on the second item")
    }

    func testOrderedItemsKeepTheirNumbersAndNestedItemsAreALevelIn() throws {
        try launch()
        // 0-6 "1. one", 7-13 "2. two", 14-20 "   - a", 22-25 "end".
        write("1. one\n2. two\n   - a\n\nend")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 3), (7, 10), (14, 19)) }, "the numbers and the nested item's indentation and mark are hidden: \(drawn())")
        XCTAssertEqual(drawn()["list-number"], at((0, 14)), "the numbers are drawn")
        XCTAssertEqual(drawn()["list-bullet"], at((14, 21)), "and the nested item's bullet")
        XCTAssertEqual(drawn()["indent64-64"], at((14, 21)), "two levels in")
        screenshot("numbers and a nested bullet")
    }

    // MARK: Task lists

    func testTaskBoxesAreDrawnAndATapTicksOneAsAnUndoStepOfItsOwn() throws {
        try launch()
        // 0-10 "- [ ] open", 11-21 "- [x] done", 23-26 "end".
        write("- [ ] open\n- [x] done\n\nend")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 6), (11, 17)) }, "the marks and the boxes' source are hidden: \(drawn())")
        XCTAssertEqual(drawn()["list-box"], at((0, 11)))
        XCTAssertEqual(drawn()["list-ticked"], at((11, 22)))
        XCTAssertTrue(eventually { boxCentres().count == 2 }, "two boxes are drawn: \(boxes.label)")
        screenshot("two boxes")
        app.typeText(" more")
        XCTAssertTrue(eventually { text().hasSuffix("- [x] done\n\nend more") })

        let caretBefore = caret()
        tapScreen(boxCentres()[0])
        XCTAssertTrue(eventually { text().hasSuffix("- [x] open\n- [x] done\n\nend more") }, "the tap ticks the first box: \(text().suffix(40).debugDescription)")
        XCTAssertTrue(eventually { drawn()["list-ticked"] == at((0, 22)) }, "and it is drawn ticked: \(drawn())")
        XCTAssertEqual(caret(), caretBefore, "the caret stays where it was")

        tapScreen(boxCentres()[1])
        XCTAssertTrue(eventually { text().hasSuffix("- [x] open\n- [ ] done\n\nend more") }, "a tap on a ticked box unticks it")

        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("- [x] open\n- [x] done\n\nend more") }, "⌘Z takes the last tap back: \(text().suffix(40).debugDescription)")
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("- [ ] open\n- [x] done\n\nend more") }, "and the one before it, on its own: \(text().suffix(40).debugDescription)")
        // Then the typing, which UIKit keeps as one step from the list to ` more` (nothing moved the selection in between).
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(eventually { !text().hasSuffix("end more") }, "and then the typing: \(text().suffix(40).debugDescription)")
        app.typeKey("z", modifierFlags: [.command, .shift])
        XCTAssertTrue(eventually { text().hasSuffix("- [ ] open\n- [x] done\n\nend more") }, "⇧⌘Z redoes the typing: \(text().suffix(40).debugDescription)")
        app.typeKey("z", modifierFlags: [.command, .shift])
        XCTAssertTrue(eventually { text().hasSuffix("- [x] open\n- [x] done\n\nend more") }, "and the first tap: \(text().suffix(40).debugDescription)")
    }

    func testATapOnAnItemsWordsEditsAndOnTheCaretsLineNoBoxIsDrawn() throws {
        try launch()
        write("- [ ] open\n- [x] done\n\nend")
        XCTAssertTrue(eventually { boxCentres().count == 2 }, "two boxes: \(boxes.label)")
        let box = boxCentres()[0]
        // Well inside the word "open", which starts a marker's gap to the right of the box.
        tapScreen(CGPoint(x: box.x + 45, y: box.y))
        XCTAssertTrue(eventually { (caret() ?? -1) >= 6 && (caret() ?? 99) <= 10 }, "the caret goes into the words: \(selection.label)")
        XCTAssertTrue(text().hasSuffix("- [ ] open\n- [x] done\n\nend"), "and nothing is ticked")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((11, 17)) && boxCentres().count == 1 }, "the line shows `- [ ] ` as written and draws no box: \(drawn()) \(boxes.label)")
    }

    // MARK: Quotes

    func testAQuoteHasABarForEachLevelItsMarksHiddenAndItsWordsMuted() throws {
        try launch()
        // 0-5 "> one", 6-13 "> > two", 14-18 "lazy", 20-23 "end".
        write("> one\n> > two\nlazy\n\nend")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (6, 10)) }, "the `> ` marks are hidden: \(drawn())")
        XCTAssertEqual(drawn()["quote1"], at((0, 6)))
        XCTAssertEqual(drawn()["quote2"], at((6, 19)), "two bars on the inner quote and on the line it takes in lazily")
        XCTAssertEqual(drawn()["list-line"], at((0, 19)), "no marker on a quote's lines")
        XCTAssertEqual(drawn()["indent13-13"], at((0, 6)))
        XCTAssertEqual(drawn()["indent26-26"], at((6, 19)))
        XCTAssertTrue(classes(covering: 2, 5).contains { $0.hasPrefix("dim") }, "the quote's words are muted: \(drawn())")
        XCTAssertFalse(classes(covering: 20, 23).contains { $0.hasPrefix("dim") }, "and the text after it is not")
        screenshot("a quote in a quote")
        press(.upArrow, 3)  // the blank line, `lazy`, then `> > two`
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2)) }, "on the caret's line the marks show: \(drawn())")
    }

    // MARK: Typing in a list

    func testReturnContinuesTheListAndOnAnEmptyItemEndsItAndBackspaceTakesAMarkerAway() throws {
        try launch()
        write("- one")
        XCTAssertTrue(eventually { drawn()["list-bullet"] == nil && drawn()["indent32-0"] == at((0, 5)) }, "the caret's line shows its mark: \(drawn())")
        app.typeText("\n")
        XCTAssertTrue(eventually { text().hasSuffix("- one\n- ") }, "Return writes the next item's mark, as the desktop does: \(text().suffix(20).debugDescription)")
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2)) && drawn()["list-bullet"] == at((0, 6)) }, "the item the caret left is drawn: \(drawn())")
        app.typeText("two\n")
        XCTAssertTrue(eventually { text().hasSuffix("- one\n- two\n- ") }, "\(text().suffix(20).debugDescription)")
        app.typeText("\n")
        XCTAssertTrue(eventually { text().hasSuffix("- one\n- two\n") }, "Return on the empty third item takes its mark off, and the list ends: \(text().suffix(20).debugDescription)")
        app.typeText("\nend")
        XCTAssertTrue(eventually { text().hasSuffix("- one\n- two\n\nend") })
        XCTAssertTrue(eventually { drawn()["hidden"] == at((0, 2), (6, 8)) && drawn()["list-bullet"] == at((0, 12)) }, "both items are drawn: \(drawn())")
        // Backspace just after the second item's `- `, with its mark showing, turns the mark into spaces, as the desktop does: `two` goes on the first item.
        press(.upArrow, 2)
        press(.leftArrow, modifiers: .command)
        press(.rightArrow, 2)
        XCTAssertTrue(eventually { caret() == 8 }, "the caret after `- `: \(selection.label)")
        app.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertTrue(eventually { text().hasSuffix("- one\n  two\n\nend") }, "\(text().suffix(20).debugDescription)")
        XCTAssertTrue(eventually { caret() == 8 }, "the caret stays after the spaces: \(selection.label)")
        app.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertTrue(eventually { text().hasSuffix("- one\ntwo\n\nend") }, "a second Backspace takes the spaces: \(text().suffix(20).debugDescription)")
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("- one\n  two\n\nend") }, "⌘Z puts the spaces back: \(text().suffix(20).debugDescription)")
        app.typeKey("z", modifierFlags: .command)
        XCTAssertTrue(eventually { text().hasSuffix("- one\n- two\n\nend") }, "and then the mark, in a step of its own: \(text().suffix(20).debugDescription)")
    }

    func testReturnInAQuoteWritesItsMarkAndOnASecondEmptyLineEndsIt() throws {
        try launch()
        write("> one")
        app.typeText("\n")
        XCTAssertTrue(eventually { text().hasSuffix("> one\n> ") }, "Return writes `> `: \(text().suffix(20).debugDescription)")
        app.typeText("\n")
        XCTAssertTrue(eventually { text().hasSuffix("> one\n>\n> ") }, "on an empty quote line it writes another: \(text().suffix(20).debugDescription)")
        app.typeText("\n")
        XCTAssertTrue(eventually { text().hasSuffix("> one\n\n") }, "and on the second the quote ends: \(text().suffix(20).debugDescription)")
        app.typeText("end")
        XCTAssertTrue(eventually { drawn()["quote1"] == at((0, 6)) }, "the quote is the one line: \(drawn())")
    }

    func testTabAndShiftTabOverListLinesNestAndUnnestThem() throws {
        try launch()
        // 0-3 "- a", 4-7 "- b", 8-11 "- c".
        write("- a\n- b\n- c")
        press(.upArrow, 1, modifiers: .shift)
        app.typeKey(.tab, modifierFlags: [])
        XCTAssertTrue(eventually { text().hasSuffix("- a\n\t- b\n\t- c") }, "Tab indents both lines: \(text().suffix(20).debugDescription)")
        press(.downArrow, 1, modifiers: .command)
        app.typeText("\n\nend")
        XCTAssertTrue(eventually { drawn()["indent64-64"] == at((4, 14)) }, "they are nested, two levels in: \(drawn())")
        XCTAssertEqual(drawn()["hidden"], at((0, 2), (4, 7), (9, 12)), "and the tab is hidden with the mark")
        screenshot("nested by Tab")
        press(.upArrow, 2)
        press(.rightArrow, modifiers: .command)  // the end of `- c`: a selection that ends at a line's start leaves that line out
        press(.upArrow, 1, modifiers: .shift)
        app.typeKey(.tab, modifierFlags: .shift)
        XCTAssertTrue(eventually { text().hasSuffix("- a\n- b\n- c\n\nend") }, "Shift+Tab takes it back: \(text().suffix(30).debugDescription)")
        press(.downArrow, 2)
        XCTAssertTrue(eventually { drawn()["indent32-32"] == at((0, 12)) }, "one level again: \(drawn())")
    }
}
