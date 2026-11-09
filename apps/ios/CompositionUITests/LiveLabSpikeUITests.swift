import XCTest

/// Spikes L5, L6 and L7 of the Live view (docs/ipad-live-view-plan.md), driven in the Editor lab: keys as a hardware keyboard sends them, the selection read back from the
/// lab's readout (`-labSelectionHud 1`), and what the text view says about itself to the accessibility tree. These tests RECORD what happens, to a log a person reads
/// (`LIVE_LAB_LOG`); they assert only that the lab could be driven. Skipped unless `LIVE_LAB_SPIKE` is set, so the normal suite does not run them:
///
///     TEST_RUNNER_LIVE_LAB_SPIKE=1 TEST_RUNNER_LIVE_LAB_BACKUP=<organization.tar.gz> TEST_RUNNER_LIVE_LAB_LOG=<file> xcodebuild test -only-testing:CompositionUITests/LiveLabSpikeUITests …
///
/// The lab's text (`LabText.editing`), by line: 0 `Plain line before.` · 1 `# Heading one` · 2 `A **bold** word and *italic* too.` · 3 `**Bold start** and more text`
/// · 4 `text ending in **bold**` · 5 `## Second heading` · 6 ``Use `code` here and ~~struck~~ there.`` · 7 `Last line.`
@MainActor
final class LiveLabSpikeUITests: XCTestCase {
    private let app = XCUIApplication()
    private var editor: XCUIElement { app.textViews["lab-editor"] }
    private static var restored = false
    private var lines: [String] = []
    private var caseName = ""

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["LIVE_LAB_SPIKE"] != nil, "A spike: set LIVE_LAB_SPIKE to run it.")
        continueAfterFailure = false
    }

    override func tearDown() async throws {
        guard !lines.isEmpty, let path = ProcessInfo.processInfo.environment["LIVE_LAB_LOG"] else { return }
        let block = lines.joined(separator: "\n") + "\n\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(Data(block.utf8))
            try? handle.close()
        } else {
            try? block.write(toFile: path, atomically: false, encoding: .utf8)
        }
    }

    // MARK: Driving the lab

    private func launchLab(_ name: String, reveal: String, hide: String = "live", scenario: String = "editing", extra: [String] = []) throws {
        caseName = "\(name) [\(reveal)]"
        lines.append("== \(caseName)")
        XCUIDevice.shared.orientation = .landscapeLeft
        if !Self.restored {
            // The lab is reached from the notes browser, which needs notes: restore them once.
            let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["LIVE_LAB_BACKUP"], "LIVE_LAB_BACKUP: the path of a backup.")
            app.launchArguments = ["-importBackup", backup]
            app.launch()
            let done = app.alerts["Done"].buttons["OK"]
            XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
            done.tap()
            app.terminate()
            Self.restored = true
        }
        app.launchArguments = ["-openLab", "1", "-labHide", hide, "-labReveal", reveal, "-labText", scenario, "-labSelectionHud", "1"] + extra
        app.launch()
        XCTAssertTrue(editor.waitForExistence(timeout: 30), "the lab did not open")
        // The lab loads the text and sets the look a moment after it opens.
        XCTAssertTrue(eventually { self.text().hasPrefix("Plain line before.") }, "the editing text is not loaded: \(self.text())")
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        focusEditor()
        app.typeKey(.upArrow, modifierFlags: .command)
    }

    /// Hardware keys go to the focused text view, and a tap does not always focus it first time: the focus is checked by sending ⌘↓, which must move the caret off 0.
    private func focusEditor() {
        for _ in 0..<5 {
            editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
            app.typeKey(.downArrow, modifierFlags: .command)
            if eventually(2, { !self.selection().hasPrefix("0+0 ") && self.selection() != "" }) { return }
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        XCTFail("the editor never took the focus")
    }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func text() -> String { (editor.value as? String) ?? "" }
    private func selection() -> String { app.staticTexts["lab-selection"].label }

    private func note(_ line: String) { lines.append("   \(line)") }

    /// Presses a key `times` times, writing where the selection was and is after each press. Backspace is sent as text (`typeText` with the key's character): `typeKey(.delete)` does
    /// not reach a text view in the Simulator, which is how the other UI tests delete too. (`typeText` of forward delete types a private-use character.)
    private func press(_ name: String, _ key: XCUIKeyboardKey, _ modifiers: XCUIElement.KeyModifierFlags = [], times: Int = 1) {
        var before = selection()
        for index in 1...times {
            if key == .delete { app.typeText(key.rawValue) } else { app.typeKey(key, modifierFlags: modifiers) }
            let after = selection()
            note("\(name) #\(index): \(before)  →  \(after)\(verdict(before, after))")
            before = after
        }
    }

    /// `(NO CHANGE)` when the selection stayed, and `(STUCK ON SCREEN)` when it moved but the end that moves was drawn where it was (one invisible character crossed).
    private func verdict(_ before: String, _ after: String) -> String {
        func parts(_ summary: String) -> (position: String, x: Double, y: Double)? {
            let match = summary.range(of: #"^(\d+\+\d+) x=(-?[\d.]+) y=(-?[\d.]+)"#, options: .regularExpression)
            guard let match else { return nil }
            let fields = summary[match].split(separator: " ")
            guard fields.count == 3, let x = Double(fields[1].dropFirst(2)), let y = Double(fields[2].dropFirst(2)) else { return nil }
            return (String(fields[0]), x, y)
        }
        guard let was = parts(before), let now = parts(after) else { return "" }
        if was.position == now.position { return "   (NO CHANGE)" }
        return abs(was.x - now.x) < 0.75 && abs(was.y - now.y) < 1 ? "   (STUCK ON SCREEN)" : ""
    }

    private func type(_ string: String) {
        let before = selection()
        app.typeText(string)
        note("type “\(string)”: \(before)  →  \(selection())")
    }

    private func start(ofLine line: Int) {
        app.typeKey(.upArrow, modifierFlags: .command)
        for _ in 0..<line { app.typeKey(.downArrow, modifierFlags: []) }
        app.typeKey(.leftArrow, modifierFlags: .command)
        note("at the start of line \(line): \(selection())")
    }

    private func finish() {
        note("text now: " + text().replacingOccurrences(of: "\n", with: "⏎"))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = caseName
        shot.lifetime = .keepAlways
        add(shot)
        if let path = ProcessInfo.processInfo.environment["LIVE_LAB_LOG"] {
            let folder = URL(fileURLWithPath: path).deletingLastPathComponent()
            let file = caseName.replacingOccurrences(of: "[^A-Za-z0-9]+", with: "-", options: .regularExpression)
            try? app.screenshot().pngRepresentation.write(to: folder.appendingPathComponent("\(file).png"))
        }
    }

    // MARK: Arrow keys and selection

    private func arrows(reveal: String) throws {
        try launchLab("arrows across **bold**", reveal: reveal)
        start(ofLine: 2)
        press("Right", .rightArrow, times: 13)
        press("Left", .leftArrow, times: 13)
        finish()
    }

    func testArrowsLine() throws { try arrows(reveal: "line") }
    func testArrowsConstruct() throws { try arrows(reveal: "construct") }
    func testArrowsNever() throws { try arrows(reveal: "never") }

    private func vertical(reveal: String) throws {
        try launchLab("down and up into lines with marks", reveal: reveal)
        // From column 2 of line 0, two presses down land at column 2 of line 2, right before `**bold**`.
        start(ofLine: 0)
        press("Right", .rightArrow, times: 2)
        press("Down", .downArrow, times: 7)
        press("Up", .upArrow, times: 7)
        // From column 5 (inside the hidden bold's word) the same.
        press("Right", .rightArrow, times: 3)
        press("Down", .downArrow, times: 3)
        finish()
    }

    func testVerticalLine() throws { try vertical(reveal: "line") }
    func testVerticalConstruct() throws { try vertical(reveal: "construct") }
    func testVerticalNever() throws { try vertical(reveal: "never") }

    private func selecting(reveal: String) throws {
        try launchLab("shift+arrow across marks", reveal: reveal)
        start(ofLine: 2)
        press("Right", .rightArrow, times: 2)
        press("Shift+Right", .rightArrow, .shift, times: 10)
        press("Shift+Left", .leftArrow, .shift, times: 10)
        press("Shift+Down", .downArrow, .shift, times: 2)
        press("Shift+Cmd+Right", .rightArrow, [.shift, .command])
        finish()
    }

    func testSelectingLine() throws { try selecting(reveal: "line") }
    func testSelectingConstruct() throws { try selecting(reveal: "construct") }
    func testSelectingNever() throws { try selecting(reveal: "never") }

    private func words(reveal: String) throws {
        try launchLab("option+arrow and line ends", reveal: reveal)
        start(ofLine: 2)
        press("Option+Right", .rightArrow, .option, times: 4)
        press("Option+Left", .leftArrow, .option, times: 4)
        start(ofLine: 1)
        press("Cmd+Right", .rightArrow, .command)
        press("Cmd+Left", .leftArrow, .command)
        finish()
    }

    func testWordsLine() throws { try words(reveal: "line") }
    func testWordsConstruct() throws { try words(reveal: "construct") }
    func testWordsNever() throws { try words(reveal: "never") }

    // MARK: Delete

    private func headingBackspace(reveal: String) throws {
        try launchLab("backspace after the heading's `# `", reveal: reveal)
        start(ofLine: 1)
        press("Right", .rightArrow, times: 2)
        press("Backspace", .delete, times: 3)
        finish()
    }

    func testHeadingBackspaceLine() throws { try headingBackspace(reveal: "line") }
    func testHeadingBackspaceConstruct() throws { try headingBackspace(reveal: "construct") }
    func testHeadingBackspaceNever() throws { try headingBackspace(reveal: "never") }

    private func headingLineStartBackspace(reveal: String) throws {
        try launchLab("backspace at the start of a heading line", reveal: reveal)
        start(ofLine: 1)
        press("Backspace", .delete)
        finish()
    }

    func testHeadingLineStartBackspaceLine() throws { try headingLineStartBackspace(reveal: "line") }
    func testHeadingLineStartBackspaceConstruct() throws { try headingLineStartBackspace(reveal: "construct") }
    func testHeadingLineStartBackspaceNever() throws { try headingLineStartBackspace(reveal: "never") }

    private func backspaceAfterClosing(reveal: String) throws {
        try launchLab("backspace right after a closing `**`", reveal: reveal)
        start(ofLine: 2)
        press("Right", .rightArrow, times: 10)
        press("Backspace", .delete, times: 3)
        finish()
    }

    func testBackspaceAfterClosingLine() throws { try backspaceAfterClosing(reveal: "line") }
    func testBackspaceAfterClosingConstruct() throws { try backspaceAfterClosing(reveal: "construct") }
    func testBackspaceAfterClosingNever() throws { try backspaceAfterClosing(reveal: "never") }

    private func typingAtTheEdges(reveal: String) throws {
        try launchLab("typing at the edges of a bold word", reveal: reveal)
        start(ofLine: 2)
        press("Right", .rightArrow, times: 8)  // after `bold`, before the closing `**`
        type("X")
        press("Right", .rightArrow, times: 2)  // after the closing `**`
        type("Y")
        start(ofLine: 2)
        press("Right", .rightArrow, times: 2)  // before the opening `**`
        type("Z")
        press("Right", .rightArrow, times: 2)  // after the opening `**`
        type("W")
        finish()
    }

    func testTypingAtTheEdgesLine() throws { try typingAtTheEdges(reveal: "line") }
    func testTypingAtTheEdgesConstruct() throws { try typingAtTheEdges(reveal: "construct") }
    func testTypingAtTheEdgesNever() throws { try typingAtTheEdges(reveal: "never") }

    private func joiningLines(reveal: String) throws {
        try launchLab("backspace across a line break", reveal: reveal)
        start(ofLine: 5)  // `## Second heading`, under `text ending in **bold**`
        press("Backspace", .delete)
        finish()
    }

    func testJoiningLinesLine() throws { try joiningLines(reveal: "line") }
    func testJoiningLinesConstruct() throws { try joiningLines(reveal: "construct") }
    func testJoiningLinesNever() throws { try joiningLines(reveal: "never") }

    // MARK: Taps

    /// Taps along the line `A **bold** word and *italic* too.` while its marks are hidden (the caret is at the end of the note between taps), and writes where the caret lands
    /// and what the line looks like after: a tap in the width of a hidden mark can land between its two characters.
    private func taps(reveal: String) throws {
        try launchLab("taps along a line with hidden marks", reveal: reveal)
        // Find the vertical position of line 2 by tapping down the left side until the caret reports its line (y = 68 in the text view).
        let frame = editor.frame
        func tap(x: CGFloat, y: CGFloat) -> String {
            app.typeKey(.downArrow, modifierFlags: .command)  // the caret leaves line 2, whose marks hide again
            RunLoop.current.run(until: Date().addingTimeInterval(0.4))
            editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
            return selection()
        }
        var rowY: CGFloat?
        for y in stride(from: CGFloat(60), to: min(frame.height, 400), by: 6) where rowY == nil {
            let landed = tap(x: 60, y: y)
            // Line 2 holds positions 33...66.
            if let position = Int(landed.prefix(while: { $0.isNumber })), (33...66).contains(position) { rowY = y }
        }
        guard let rowY else { return XCTFail("did not find the line: \(selection())") }
        note("line 2 found at y = \(rowY) (editor frame \(frame))")
        for x in stride(from: CGFloat(20), through: 150, by: 5) {
            let landed = tap(x: x, y: rowY)
            note("tap at x=\(Int(x)): \(landed)")
        }
        finish()
    }

    func testTapsLine() throws { try taps(reveal: "line") }
    func testTapsConstruct() throws { try taps(reveal: "construct") }
    func testTapsNever() throws { try taps(reveal: "never") }

    // MARK: Accessibility (L6)

    /// What the text view says to the accessibility tree in the Live look, with each way of telling VoiceOver about the hidden marks: the element as XCUITest sees it, what
    /// the lab reads from the text view itself (`-labAXProbe`), and Xcode's accessibility audit over the screen (recorded, not asserted).
    private func accessibility(mode: String) throws {
        let folder = URL(fileURLWithPath: ProcessInfo.processInfo.environment["LIVE_LAB_LOG"] ?? NSTemporaryDirectory()).deletingLastPathComponent()
        let probe = folder.appendingPathComponent("ax-probe-\(mode).json")
        try? FileManager.default.removeItem(at: probe)
        try launchLab("accessibility", reveal: "construct", extra: ["-labAX", mode, "-labAXProbe", probe.path])
        caseName = "accessibility [\(mode)]"
        lines[lines.count - 1] = "== \(caseName)"
        XCTAssertTrue(eventually { FileManager.default.fileExists(atPath: probe.path) }, "the lab wrote no probe")
        note("XCUITest sees the text view as: type \(editor.elementType.rawValue), label “\(editor.label)”, identifier “\(editor.identifier)”")
        note("value (\(text().count) characters): " + text().replacingOccurrences(of: "\n", with: "⏎"))
        note("value contains `**`: \(text().contains("**")), contains `# `: \(text().contains("# "))")
        note("probe from inside the app: " + ((try? String(contentsOf: probe, encoding: .utf8)) ?? "none").replacingOccurrences(of: "\n", with: " "))
        // Typing still reaches the text, and the value follows.
        start(ofLine: 0)
        type("Q")
        note("after typing Q at the start: value begins “\(text().prefix(30))”")
        var found: [String] = []
        try? app.performAccessibilityAudit(for: [.contrast, .dynamicType, .elementDetection, .sufficientElementDescription, .textClipped, .trait]) { issue in
            let element = issue.element.map { "\($0.elementType.rawValue) “\($0.label.prefix(40))”" } ?? "no element"
            found.append("[\(issue.auditType.rawValue)] \(issue.compactDescription) — \(element)")
            return true
        }
        note("accessibility audit: \(found.count) issue(s)")
        for issue in found { note("  \(issue)") }
        finish()
    }

    func testAccessibilityAsItIs() throws { try accessibility(mode: "off") }
    func testAccessibilityWithoutMarks() throws { try accessibility(mode: "withoutMarks") }
    func testAccessibilitySilentMarks() throws { try accessibility(mode: "silentMarks") }

    // MARK: Undo

    private func undo(reveal: String) throws {
        try launchLab("undo and redo of typing next to marks", reveal: reveal)
        start(ofLine: 2)
        press("Right", .rightArrow, times: 10)
        type("Y")
        press("Backspace", .delete, times: 2)
        app.typeKey("z", modifierFlags: .command)
        note("undo: \(selection())")
        app.typeKey("z", modifierFlags: .command)
        note("undo: \(selection())")
        app.typeKey("z", modifierFlags: [.command, .shift])
        note("redo: \(selection())")
        finish()
    }

    func testUndoLine() throws { try undo(reveal: "line") }
    func testUndoConstruct() throws { try undo(reveal: "construct") }

    /// The undo stack step by step, with the Markdown look as the control: each ⌘Z, with a pause before it, writes line 2 as it is after.
    private func undoSteps(name: String, hide: String, reveal: String) throws {
        try launchLab("undo, step by step: \(name)", reveal: reveal, hide: hide)
        func line2() -> String { text().components(separatedBy: "\n")[2] }
        func pause() { RunLoop.current.run(until: Date().addingTimeInterval(1.5)) }
        start(ofLine: 2)
        press("Right", .rightArrow, times: 10)
        type("Y")
        pause()
        type("Z")
        pause()
        press("Backspace", .delete, times: 2)
        pause()
        note("line 2 now: \(line2())")
        for index in 1...5 {
            app.typeKey("z", modifierFlags: .command)
            pause()
            note("undo #\(index): line 2: \(line2())   \(selection())")
        }
        for index in 1...5 {
            app.typeKey("z", modifierFlags: [.command, .shift])
            pause()
            note("redo #\(index): line 2: \(line2())   \(selection())")
        }
        finish()
    }

    func testUndoStepsMarkdownLook() throws { try undoSteps(name: "Markdown look", hide: "off", reveal: "line") }
    func testUndoStepsLiveConstruct() throws { try undoSteps(name: "Live look", hide: "live", reveal: "construct") }
}
