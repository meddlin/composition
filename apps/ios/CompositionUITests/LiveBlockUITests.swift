import XCTest

/// The block layer of the Live tab, and tables through it (docs/ipad-live-default-plan.md, Step 5). A table is drawn as a picture of the Preview's own table: away from the
/// caret every character of it is hidden and its first line made as tall as the picture; with the caret in it its source shows with the picture under it (D3). The editor's
/// `live-report` (`-liveReport 1`, see `LiveReport`) says what the text storage holds: `block-table` over the table's source, `block-revealed` while it shows,
/// `block-pictured` once it has a picture and `block-stale` while that is the last good one, `draw-block` / `draw-blockAfter` on the paragraph that draws it.
/// apps/ios/scripts/ui-test.sh passes the backup and the showcase note in.
@MainActor
final class LiveBlockUITests: XCTestCase {
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
        // On a busy Mac the first tap on OK is sometimes lost, and the alert then takes the next tap meant for the editor.
        for _ in 0..<5 where done.exists {
            done.tap()
            _ = eventually(3) { !done.exists }
        }
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }
    private var selectionReport: XCUIElement { app.descendants(matching: .any)["live-selection"] }

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

    private func text() -> String { (editor.value as? String) ?? "" }

    /// Where the selection is: its start and length, from `live-selection` (`12+0 x=… «…|…»`).
    private func selection() -> (location: Int, length: Int) {
        let label = selectionReport.exists ? selectionReport.label : ""
        let head = label.split(separator: " ").first.map(String.init) ?? ""
        let parts = head.split(separator: "+").compactMap { Int($0) }
        return parts.count == 2 ? (parts[0], parts[1]) : (-1, -1)
    }

    private var origin = 0

    private func write(_ content: String) {
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        let before = (text() as NSString).length
        app.typeText("\n\n" + content)
        origin = before + 2
        XCTAssertTrue(eventually { text().hasSuffix("\n\n" + content) }, "the text is what was typed: \(text().suffix(120))")
    }

    private func press(_ key: XCUIKeyboardKey, _ times: Int = 1, modifiers: XCUIElement.KeyModifierFlags = []) {
        for _ in 0..<times {
            app.typeKey(key, modifierFlags: modifiers)
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        }
    }

    /// The note typed: a paragraph, a five-line table and a paragraph.
    private static let lines = ["| Name | Count |", "|---|---|", "| apples | 3 |", "| pears | 12 |", "| plums | 7 |"]
    private static let table = lines.joined(separator: "\n")
    private static let note = "before\n\n" + table + "\n\nafter"
    /// Where the table is in what was typed, and where each of its lines starts.
    private static let tableStart = 8
    private static var tableEnd: Int { tableStart + (table as NSString).length }
    private static var lineStarts: [Int] {
        var starts: [Int] = []
        var at = tableStart
        for line in lines { starts.append(at); at += (line as NSString).length + 1 }
        return starts
    }

    private func at(_ from: Int, _ to: Int) -> String { "\(from + origin)-\(to + origin)" }

    /// The table is drawn as its picture, every character of it hidden (its last line's break too), and not revealed.
    private func tableIsDrawn() -> Bool {
        let now = drawn()
        return now["block-table"] == at(Self.tableStart, Self.tableEnd) && now["block-pictured"] == at(Self.tableStart, Self.tableEnd) && now["block-revealed"] == nil
            && now["draw-block"] == at(Self.tableStart, Self.lineStarts[1]) && now["hidden"] == at(Self.tableStart, Self.tableEnd + 1)
    }

    /// The table shows its source, with its picture after its last line.
    private func tableIsRevealed() -> Bool {
        let now = drawn()
        return now["block-revealed"] == at(Self.tableStart, Self.tableEnd) && now["block-pictured"] == at(Self.tableStart, Self.tableEnd) && now["hidden"] == nil
            && now["draw-blockAfter"] == at(Self.lineStarts[4], Self.tableEnd + 1) && now["draw-block"] == nil
    }

    // MARK: Drawn, revealed, hidden again

    func testATableIsDrawnAsAPictureOfThePreviewsTableAwayFromTheCaret() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { tableIsDrawn() }, "the table is hidden and drawn as one picture: \(drawn())")
        // VoiceOver (candidate B): the value is still the source, with the hidden table marked "speak no punctuation", so its words are read and its pipes are not.
        XCTAssertTrue(text().hasSuffix(Self.note), "the value is the source: \(text().suffix(80))")
        XCTAssertEqual(drawn()["ax-silent"], drawn()["hidden"], "every hidden character is silenced, and only they: \(drawn())")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "a table drawn in Live"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTheCaretComingIntoATableShowsItsSourceWithThePictureUnderItAndLeavingHidesItAgain() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { tableIsDrawn() }, "\(drawn())")
        press(.upArrow)  // the blank line after the table: not in it
        XCTAssertTrue(eventually(3) { tableIsDrawn() }, "the blank line after the table does not reveal it: \(drawn())")
        press(.upArrow)  // its last line
        XCTAssertTrue(eventually { tableIsRevealed() }, "with the caret in the table its source shows and the picture is drawn after it: \(drawn())")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "a table revealed in Live"
        attachment.lifetime = .keepAlways
        add(attachment)
        press(.downArrow, 2)
        XCTAssertTrue(eventually { tableIsDrawn() }, "and it is hidden and drawn again once the caret has left: \(drawn())")
    }

    func testArrowingUpAndDownCrossesATableOneLineAtATime() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { tableIsDrawn() }, "\(drawn())")
        // From `after` up to `before`: the blank line, the five lines of the table (revealed from the first), the blank line, `before`.
        var visited: [Int] = []
        for _ in 0..<12 {
            press(.upArrow)
            _ = eventually(2) { self.selection().location >= 0 }
            let at = selection().location - origin
            visited.append(at)
            if at <= 6 { break }
        }
        XCTAssertLessThanOrEqual(visited.last ?? 99, 6, "the caret got to `before`, one line at a time: \(visited)")
        for (index, start) in Self.lineStarts.enumerated() {
            let end = start + (Self.lines[index] as NSString).length
            XCTAssertTrue(visited.contains { $0 >= start && $0 <= end }, "line \(index) of the table was a stop on the way up: \(visited)")
        }
        XCTAssertEqual(visited.count, 8, "eight presses: a blank line, five lines, a blank line, `before`: \(visited)")
        XCTAssertTrue(eventually { tableIsDrawn() }, "the table is drawn again with the caret above it: \(drawn())")
        // And back down.
        var down: [Int] = []
        for _ in 0..<12 {
            press(.downArrow)
            _ = eventually(2) { self.selection().location >= 0 }
            let at = selection().location - origin
            down.append(at)
            if at >= Self.tableEnd + 2 { break }
        }
        XCTAssertGreaterThanOrEqual(down.last ?? -1, Self.tableEnd + 2, "the caret got back to `after`: \(down)")
        XCTAssertEqual(down.count, 8, "in eight presses: \(down)")
        XCTAssertTrue(eventually { tableIsDrawn() }, "\(drawn())")
    }

    func testUndoAcrossATableBringsTheTextBackAndTheTableIsDrawnAgain() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { tableIsDrawn() }, "\(drawn())")
        // Pauses between the edits (as `LiveUITests`' undo test has them), so that the system does not join the typing of the note and the edits into one undo step.
        func pause() { RunLoop.current.run(until: Date().addingTimeInterval(1.5)) }
        pause()
        // The first edit at the start of `after`, not where the note's typing ended: UIKit joins typing at the same place into one undo step, pauses or not.
        press(.leftArrow, modifiers: .command)
        pause()
        let original = text()
        app.typeText("X")
        pause()
        let afterX = text()
        press(.upArrow, 2)  // into the table's last line
        app.typeText("Y")
        XCTAssertTrue(eventually { drawn()["block-revealed"] != nil }, "typing in the table, its source shows: \(drawn())")
        pause()
        let afterY = text()
        press(.downArrow, 2)
        app.typeText("Z")
        pause()
        XCTAssertTrue(eventually { text().filter { "XYZ".contains($0) }.count == 3 && !text().hasSuffix(Self.note) }, "three edits made: \(text().suffix(90))")
        // ⌘Z until the text is what it was: the system may join edits into fewer steps, so each step must be a text the note was in.
        let states = [original, afterX, afterY, text()]
        var steps = 0
        while text() != original, steps < 6 {
            app.typeKey("z", modifierFlags: .command)
            pause()
            steps += 1
            XCTAssertTrue(states.contains(text()), "undo #\(steps) gives a text the note was in: \(text().suffix(90))")
        }
        XCTAssertEqual(text(), original, "undo brings the text back as it was, in \(steps) step(s)")
        XCTAssertTrue(eventually { drawn()["block-table"] == at(Self.tableStart, Self.tableEnd) }, "and the table is where it was: \(drawn())")
        // The caret may be in the table after undoing the edit in it, or out of it: drawn either way, revealed or not.
        press(.downArrow, 4)
        XCTAssertTrue(eventually { tableIsDrawn() }, "drawn again once the caret is out of it: \(drawn())")
    }

    func testTypingInATableRedrawsItsPictureAfterThePause() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { tableIsDrawn() }, "\(drawn())")
        press(.upArrow, 2)  // the table's last line
        XCTAssertTrue(eventually { tableIsRevealed() }, "\(drawn())")
        app.typeText("Q")
        // The table grew by one character; its picture is the last good one until the pause has read the note again and rendered it anew.
        XCTAssertTrue(eventually { drawn()["block-table"] == at(Self.tableStart, Self.tableEnd + 1) && drawn()["block-stale"] == nil && drawn()["block-pictured"] != nil },
                      "after the pause the table holds what was typed and its picture is its own: \(drawn())")
        XCTAssertNotNil(drawn()["block-revealed"], "and its source still shows: \(drawn())")
    }

    func testATapOnTheDrawnTablePutsTheCaretAtTheStartOfItsSource() throws {
        try launch()
        write(Self.note)
        XCTAssertTrue(eventually { tableIsDrawn() }, "\(drawn())")
        // Where the picture is in the window comes from `live-geometry`. The on-screen keyboard (shown when the Simulator has no hardware keyboard) may cover it, and a tap
        // there would land on the keyboard's suggestions: the note is scrolled until the picture is clear of the keyboard first.
        let geometry = app.descendants(matching: .any)["live-geometry"]
        func pictureFrame() -> CGRect? {
            let parts = (geometry.exists ? geometry.label : "").split(separator: ",").compactMap { Double($0) }
            return parts.count == 4 ? CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3]) : nil
        }
        func keyboardTop() -> CGFloat {
            let keyboard = app.keyboards.firstMatch
            return keyboard.exists && keyboard.frame.height > 50 ? keyboard.frame.minY : app.windows.firstMatch.frame.maxY
        }
        XCTAssertTrue(eventually { pictureFrame() != nil }, "the report says where the picture is: \(geometry.exists ? geometry.label : "none")")
        let top = editor.frame.minY + 40
        for _ in 0..<6 {
            guard let frame = pictureFrame(), frame.minY + 30 > keyboardTop() - 20 || frame.minY + 30 < top else { break }
            // Content moves with the finger: a picture below the clear area is brought up by dragging up, one above it down.
            let from = editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            let by: CGFloat = frame.minY + 30 > keyboardTop() - 20 ? -150 : 150
            from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: by)))
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        let frame = try XCTUnwrap(pictureFrame())
        let y = min(frame.minY + 30, keyboardTop() - 20)
        XCTAssertGreaterThan(y, frame.minY, "the picture is clear of the keyboard: \(frame), keyboard at \(keyboardTop())")
        app.windows.firstMatch.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.minX + min(frame.width / 2, 80), dy: y)).tap()
        let landed = eventually(4) { self.selection().location == self.origin + Self.tableStart && self.selection().length == 0 }
        XCTAssertTrue(landed, "a tap on the picture put the caret at the start of the table's source: \(selection()) \(drawn())")
        XCTAssertTrue(eventually { tableIsRevealed() }, "which then shows: \(drawn())")
    }

    // MARK: Speed

    /// The 16 ms budget for a keystroke, on the preview showcase note (every construct the Preview draws, a table among them), measured by the app itself (`LiveBench`).
    func testTypingInTheShowcaseNoteKeepsTheSixteenMillisecondBudget() throws {
        continueAfterFailure = false
        let showcase = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_SHOWCASE"], "Run apps/ios/scripts/ui-test.sh: it passes the showcase note.")
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"])
        let output = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("live-bench-showcase.json")
        try? FileManager.default.removeItem(at: output)
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importText", showcase, "-openMode", "Live", "-liveBench", output.path]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        let end = Date().addingTimeInterval(240)
        while !FileManager.default.fileExists(atPath: output.path), Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(1)) }
        let data = try Data(contentsOf: output)
        let numbers = XCTAttachment(string: String(decoding: data, as: UTF8.self))
        numbers.name = "live-bench on the showcase note"
        numbers.lifetime = .keepAlways
        add(numbers)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let typing = try XCTUnwrap(result["typing"] as? [String: Any])
        let styler = try XCTUnwrap((typing["styler"] as? [String: Double])?["p95"])
        let whole = try XCTUnwrap((typing["whole"] as? [String: Double])?["p95"])
        print("LIVE_BLOCKS showcase: styler p95 \(styler) ms, whole keystroke p95 \(whole) ms, \(typing["overBudget"] ?? "?") over 16 ms")
        XCTAssertLessThan(styler, 16, "the styler's part of a keystroke")
        XCTAssertLessThan(whole, 16, "a whole keystroke: UIKit's insert, the styler and the layout of what changed")
    }
}

/// Step 5's spike (docs/ipad-live-default-plan.md): what the text view does with a table whose every character is hidden and drawn as one picture, written to a log a person
/// reads (`LIVE_BLOCK_LOG`), with screenshots attached. It asserts only that the app could be driven. Skipped unless `LIVE_BLOCK_SPIKE` is set:
///
///     TEST_RUNNER_LIVE_BLOCK_SPIKE=1 TEST_RUNNER_LIVE_BLOCK_LOG=<file> IOS_UI_ONLY=CompositionUITests/LiveBlockSpikeUITests apps/ios/scripts/ui-test.sh
@MainActor
final class LiveBlockSpikeUITests: XCTestCase {
    private let app = XCUIApplication()
    private var lines: [String] = []

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["LIVE_BLOCK_SPIKE"] != nil, "A spike: set LIVE_BLOCK_SPIKE to run it.")
        continueAfterFailure = true
    }

    override func tearDown() async throws {
        guard !lines.isEmpty, let path = ProcessInfo.processInfo.environment["LIVE_BLOCK_LOG"] else { return }
        let block = lines.joined(separator: "\n") + "\n\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(Data(block.utf8))
            try? handle.close()
        } else {
            try? block.write(toFile: path, atomically: false, encoding: .utf8)
        }
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }
    private var selectionReport: XCUIElement { app.descendants(matching: .any)["live-selection"] }
    private var origin = 0

    private func launch(_ name: String, _ extra: [String] = []) throws {
        lines.append("== \(name)")
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"])
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-openNote", "25", "-openMode", "Live", "-liveReport", "1"] + extra
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90))
        done.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
        app.typeKey(.downArrow, modifierFlags: .command)
        let before = ((editor.value as? String ?? "") as NSString).length
        app.typeText("\n\nbefore\n\n| Name | Count |\n|---|---|\n| apples | 3 |\n| pears | 12 |\n| plums | 7 |\n\nafter")
        origin = before + 2
        let end = Date().addingTimeInterval(20)
        while !report.label.contains("block-pictured"), Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.25)) }
        lines.append("origin \(origin) (the table is origin+8 to origin+78); report: \(report.label)")
    }

    private func note(_ what: String) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        lines.append("\(what): selection \(selectionReport.label) | report \(report.label)")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// With the reveal off (`-liveBlockReveal never`): the caret across the hidden table, down and up, a line at a time; what it lands on and where it is drawn.
    func testArrowsAcrossAHiddenTable() throws {
        try launch("arrows across a hidden table (reveal never)", ["-liveBlockReveal", "never"])
        app.typeKey(.upArrow, modifierFlags: [])
        for index in 0..<9 {
            app.typeKey(.upArrow, modifierFlags: [])
            note("up \(index + 1)")
            if index == 3 { shot("caret inside the hidden table") }
        }
        for index in 0..<9 {
            app.typeKey(.downArrow, modifierFlags: [])
            note("down \(index + 1)")
        }
        app.typeKey(.leftArrow, modifierFlags: .command)
        for index in 0..<4 {
            app.typeKey(.upArrow, modifierFlags: [])
            note("up from the line start \(index + 1)")
        }
    }

    /// A selection grown with Shift-arrows from above the table to below it, with the reveal (D3) and without.
    func testASelectionThroughATable() throws {
        for reveal in ["always", "never"] {
            try launch("selection through a table (reveal \(reveal))", reveal == "never" ? ["-liveBlockReveal", "never"] : [])
            app.typeKey(.upArrow, modifierFlags: [])
            for _ in 0..<8 { app.typeKey(.upArrow, modifierFlags: []) }
            note("start above the table")
            for index in 0..<9 {
                app.typeKey(.downArrow, modifierFlags: .shift)
                note("shift-down \(index + 1)")
            }
            shot("selection through the table, reveal \(reveal)")
            app.terminate()
        }
    }

    /// A finger's drag through the drawn table: press on `before`, drag to `after` (where they are is read from the screen: the test drags from near the top of the
    /// editor's visible text to near its bottom, over the picture).
    func testADragThroughTheDrawnTable() throws {
        try launch("a drag through the drawn table")
        let frame = editor.frame
        let start = editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.width * 0.2, dy: frame.height * 0.25))
        let finish = editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.width * 0.2, dy: frame.height * 0.85))
        start.press(forDuration: 0.8, thenDragTo: finish)
        note("after the drag")
        shot("after a drag through the table")
    }

    /// Find (the toolbar's Find button: ⌘F sent by the test types an `f` into the note instead) for a word that is only in the hidden table.
    func testFindLandsInTheTable() throws {
        try launch("find a word in the hidden table")
        app.buttons["Find"].firstMatch.tap()
        let field = app.searchFields.firstMatch.exists ? app.searchFields.firstMatch : app.textFields.firstMatch
        _ = field.waitForExistence(timeout: 5)
        note("find open: \(field.exists)")
        app.typeText("pears")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        note("after typing the word")
        app.typeKey(.enter, modifierFlags: [])
        note("after Return")
        shot("find landing in the table")
        app.typeKey(.escape, modifierFlags: [])
        note("after closing find")
        shot("after closing find")
    }

    /// Marked text (what Scribble and dictation put in) on the line after the table: the styler waits, and the table stays drawn.
    func testMarkedTextBesideATable() throws {
        try launch("marked text beside a table", ["-liveCompose", "1"])
        app.typeKey(.upArrow, modifierFlags: [])  // the blank line after the table
        note("on the blank line")
        app.typeKey("c", modifierFlags: [.control, .option])
        note("composing")
        app.typeKey("c", modifierFlags: [.control, .option])
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        note("composing more, after a pause")
        app.typeKey("e", modifierFlags: [.control, .option])
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        note("composition ended")
        shot("marked text beside the table, ended")
    }

    /// The pictures `ImageRenderer` makes of the showcase note's blocks (a table, the charts, the panels and the rest), written by the app (`-liveBlockSpike`) and attached.
    func testPicturesOfTheShowcasesBlocks() throws {
        lines.append("== pictures of the showcase's blocks")
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"])
        let showcase = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_SHOWCASE"])
        let folder = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("live-block-spike", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importText", showcase, "-openMode", "Live", "-liveBlockSpike", folder.path]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90))
        done.tap()
        let json = folder.appendingPathComponent("spike.json")
        let end = Date().addingTimeInterval(60)
        while !FileManager.default.fileExists(atPath: json.path), Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(1)) }
        let summary = (try? String(contentsOf: json, encoding: .utf8)) ?? "no spike.json"
        lines.append(summary)
        lines.append("folder: \(folder.path)")
        for file in (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [] where file.hasSuffix(".png") {
            if let image = UIImage(contentsOfFile: folder.appendingPathComponent(file).path) {
                let attachment = XCTAttachment(image: image)
                attachment.name = file
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
        shot("the showcase in Live")
    }
}
