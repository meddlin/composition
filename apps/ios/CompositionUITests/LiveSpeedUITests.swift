import XCTest

/// The speed of the Live tab on the editor proper (docs/ipad-live-view-plan.md, step L7): `-liveBench <file>` has the app time its own `MarkdownStyler`, `LiveModel` and `LiveOverlay` on the
/// note that is open (see `LiveBench`) and write the numbers to that file; this opens a long note in each tab, waits for the file, and keeps what it says. A measurement, not a check,
/// so it is skipped unless `LIVE_SPEED` is set; for numbers that mean something run it in a Release build of the Simulator with the test hooks compiled in:
///
///     TEST_RUNNER_LIVE_SPEED=1 TEST_RUNNER_LIVE_SPEED_LOG=<file> TEST_RUNNER_COMPOSITION_UI_BACKUP=<organization.tar.gz> xcodebuild test -configuration Release \
///         SWIFT_ACTIVE_COMPILATION_CONDITIONS=EDITOR_TEST_HOOKS -only-testing:CompositionUITests/LiveSpeedUITests …
@MainActor
final class LiveSpeedUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["LIVE_SPEED"] != nil, "A measurement: set LIVE_SPEED to run it.")
        continueAfterFailure = false
    }

    /// The Editor lab's text for `lines` lines: 5,000 lines are 100,190 characters, the desktop's limit, and 20,000 are 404,540.
    private func bigNote(lines: Int, highlights: Bool = false) -> String {
        var out = ["---", "title: Big note", "---", "# Big note", ""]
        var section = 0
        while out.count < lines {
            // With `highlights`, a `<Mark>` in every section and a stored picture in every fiftieth: what the Live look reads from the whole note, up to the desktop's limit.
            if highlights { out += ["Some <Mark color=\"yellow\">highlighted</Mark> and <Mark color=\"green\">tinted</Mark> words.", ""] }
            if highlights, section % 50 == 0 { out += ["![the picture](app_data/demo-photo-0123456789ab.png)", ""] }
            out += ["## Section \(section)", "", "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/\(section)) with é and 😀. The rest of this line is plain text to make it long enough to wrap onto a second line on an iPad.", "", "- item one", "- item two", "", "> a quote", "", "```", "let x = \(section)", "```", ""]
            section += 1
        }
        return out.joined(separator: "\n")
    }

    private func measure(lines: Int, mode: String, highlights: Bool = false, at share: Double? = nil) throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let folder = URL(fileURLWithPath: NSTemporaryDirectory())
        let note = folder.appendingPathComponent("speed-note-\(lines).md")
        let output = folder.appendingPathComponent("live-bench-\(lines)-\(mode)\(highlights ? "-marks" : "")\(share.map { "-at\(Int($0 * 100))" } ?? "").json")
        try bigNote(lines: lines, highlights: highlights).write(to: note, atomically: true, encoding: .utf8)
        try? FileManager.default.removeItem(at: output)
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "the backup the app starts from")
        app.launchArguments = ["-importBackup", backup, "-importText", note.path, "-openMode", mode, "-liveBench", output.path] + (share.map { ["-liveBenchAt", "\($0)"] } ?? [])
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 120), "the backup did not restore")
        done.tap()
        // No query of the app while it is being timed: the accessibility tree reads the whole note.
        let end = Date().addingTimeInterval(900)
        while !FileManager.default.fileExists(atPath: output.path), Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(2)) }
        let result = (try? String(contentsOf: output, encoding: .utf8)) ?? ""
        XCTAssertFalse(result.isEmpty, "the app wrote no result")
        add(XCTAttachment(string: result))
        print("LIVE_SPEED \(lines) lines, \(mode)\(highlights ? ", highlights" : "")\(share.map { ", at \(Int($0 * 100))%" } ?? ""): \(result)")
        if let path = ProcessInfo.processInfo.environment["LIVE_SPEED_LOG"] {
            let block = "== \(lines) lines, \(mode)\(highlights ? ", highlights" : "")\(share.map { ", at \(Int($0 * 100))%" } ?? "")\n\(result)\n\n"
            if let handle = FileHandle(forWritingAtPath: path) {
                handle.seekToEndOfFile()
                handle.write(Data(block.utf8))
                try? handle.close()
            } else {
                try? block.write(toFile: path, atomically: false, encoding: .utf8)
            }
        }
    }

    func testLive5000Lines() throws { try measure(lines: 5_000, mode: "Live") }
    func testMarkdown5000Lines() throws { try measure(lines: 5_000, mode: "Markdown") }
    func testLive20000Lines() throws { try measure(lines: 20_000, mode: "Live") }
    func testMarkdown20000Lines() throws { try measure(lines: 20_000, mode: "Markdown") }
    /// Where in the note the typing is done: the cost of a keystroke in a long note should not depend on it.
    func testLive20000LinesAtTenPercent() throws { try measure(lines: 20_000, mode: "Live", at: 0.1) }
    func testLive20000LinesAtNinetyPercent() throws { try measure(lines: 20_000, mode: "Live", at: 0.9) }
    func testMarkdown20000LinesAtTenPercent() throws { try measure(lines: 20_000, mode: "Markdown", at: 0.1) }
    func testMarkdown20000LinesAtNinetyPercent() throws { try measure(lines: 20_000, mode: "Markdown", at: 0.9) }
    func testLive5000LinesAtNinetyPercent() throws { try measure(lines: 5_000, mode: "Live", at: 0.9) }
    func testLive10000LinesAtNinetyPercent() throws { try measure(lines: 10_000, mode: "Live", at: 0.9) }
    func testLive15000LinesAtNinetyPercent() throws { try measure(lines: 15_000, mode: "Live", at: 0.9) }
    func testMarkdown10000LinesAtNinetyPercent() throws { try measure(lines: 10_000, mode: "Markdown", at: 0.9) }
    /// With highlights and pictures in it, which the desktop reads only up to 100,000 characters and the iPad at any length (decision V5).
    func testLive20000LinesWithHighlights() throws { try measure(lines: 20_000, mode: "Live", highlights: true) }
}
