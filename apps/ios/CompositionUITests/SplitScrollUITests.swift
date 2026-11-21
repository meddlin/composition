import XCTest

/// The Split tab's two halves stay at the same place in the note: scrolling the editor scrolls the Preview to the matching spot, and scrolling the Preview
/// scrolls the editor (`SplitScrollSync`). The note has code, tables and panels, so the Preview's height is far from the editor's, and a match by scroll
/// fraction would fail. `-splitSyncReport 1` makes `split-sync` say where each half's top is in the note's text. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class SplitScrollUITests: XCTestCase {
    private let app = XCUIApplication()

    /// A long note whose halves differ in height: each section has a heading, a paragraph, a code block, a table and a panel.
    private static var note: String {
        var text = "---\ntitle: Scrolling together\n---\n"
        for section in 1...40 {
            text += """

                ## Section \(section)

                Paragraph \(section) of the note, long enough to wrap onto a second line in a half of the Split tab, so that the editor and the Preview wrap differently.

                ```
                let section = \(section)
                print(section)
                ```

                | Column | Value |
                |---|---|
                | section | \(section) |
                | square | \(section * section) |

                <Info>

                A panel in section \(section).

                </Info>

                """
        }
        return text
    }

    override func setUp() async throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("Scrolling together.md")
        try Self.note.write(to: file, atomically: true, encoding: .utf8)
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importText", file.path, "-openMode", "Split", "-splitSyncReport", "1"]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        // On a busy Mac the first tap on OK is sometimes lost.
        for _ in 0..<5 where done.exists {
            done.tap()
            _ = eventually(3) { !done.exists }
        }
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        XCTAssertTrue(divider.waitForExistence(timeout: 10), "Split has a divider")
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var divider: XCUIElement { app.descendants(matching: .any)["split-divider"] }
    private var report: XCUIElement { app.descendants(matching: .any)["split-sync"] }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// Where each half's top is in the note's text, from `split-sync` (`editor=812 preview=809 length=9000`).
    private func tops() -> (editor: Double, preview: Double, length: Double)? {
        guard report.exists else { return nil }
        var values: [String: Double] = [:]
        for pair in report.label.split(separator: " ") {
            let parts = pair.split(separator: "=")
            if parts.count == 2, let value = Double(parts[1]) { values[String(parts[0])] = value }
        }
        guard let editor = values["editor"], let preview = values["preview"], let length = values["length"] else { return nil }
        return (editor, preview, length)
    }

    /// Whether the two tops are at the same place in the note: within a line or two of each other.
    private func together(_ tops: (editor: Double, preview: Double, length: Double)) -> Bool { abs(tops.editor - tops.preview) < 120 }

    /// The middle of the Preview's half: past the divider, beside it (side by side) or under it (one above the other).
    private func previewMiddle() -> XCUICoordinate {
        let line = divider.frame
        let window = app.windows.firstMatch.frame
        let stacked = line.width > line.height
        let point = stacked ? CGPoint(x: line.midX, y: (line.maxY + window.maxY) / 2) : CGPoint(x: (line.maxX + window.maxX) / 2, y: line.midY)
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y))
    }

    private func drag(_ start: XCUICoordinate, by dy: CGFloat) {
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: dy)), withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    func testScrollingEitherHalfScrollsTheOtherToTheSamePlaceInTheNote() {
        // The editor leads: dragged up, the Preview follows to the same place in the note.
        let editorMiddle = editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for _ in 0..<3 { drag(editorMiddle, by: -150) }
        var first: (editor: Double, preview: Double, length: Double)?
        XCTAssertTrue(eventually {
            first = self.tops()
            return first.map { $0.editor > 300 && self.together($0) } ?? false
        }, "scrolling the editor down a long way brings the Preview with it: \(report.exists ? report.label : "no report")")
        guard let first else { return }
        XCTAssertLessThan(first.editor, first.length - 600, "and the editor is not at the end of the note, where both go to their ends: \(report.label)")

        // The Preview leads: dragged down (back up the note), the editor follows.
        for _ in 0..<2 { drag(previewMiddle(), by: 120) }
        XCTAssertTrue(eventually {
            guard let now = self.tops() else { return false }
            return now.preview < first.preview - 50 && self.together(now)
        }, "scrolling the Preview back up brings the editor with it: before \(first), now \(report.label)")

        // Back to the top of either, and both are at the top.
        for _ in 0..<6 { drag(previewMiddle(), by: 300) }
        XCTAssertTrue(eventually { (self.tops().map { $0.editor < 5 && $0.preview < 5 }) ?? false }, "at the top of the Preview, the editor is at its top too: \(report.label)")
    }
}
