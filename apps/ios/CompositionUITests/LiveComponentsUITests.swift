import XCTest

/// Step 6 of docs/ipad-live-default-plan.md: the components drawn in the Live tab through Step 5's block layer, each a picture of the Preview's own view of it
/// (`PreviewBlockView`). Which blocks a note has, and what each is, is the Preview's decision, checked against the desktop in CompositionCore
/// (`component-cases.json`, `BlockRangeTests`); this checks that the Live tab draws every one of them: the preview showcase's every kind, a note with each
/// component, a panel's tint in two schemes, the ↗ of a `<YouTube>` and a `<Repo>` while the caret is in it (I6), and a note that stops being valid MDX keeping
/// its pictures. The editor's `live-report` (`-liveReport 1`) says what is drawn (`block-<kind>`, `block-pictured`, `draw-block`, …); the Preview's `preview-blocks`
/// says which kinds of block it draws. apps/ios/scripts/ui-test.sh passes the backup and the showcase note in.
@MainActor
final class LiveComponentsUITests: XCTestCase {
    private let app = XCUIApplication()

    /// Launches on `text` (written to a file and imported with `-importText`, which opens it), or on the showcase note, in `mode`, in `scheme`.
    private func launch(text: String? = nil, mode: String = "Live", scheme: String? = nil) throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        let note: String
        if let text {
            let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("Components.md")
            try text.write(to: file, atomically: true, encoding: .utf8)
            note = file.path
        } else {
            note = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_SHOWCASE"], "Run apps/ios/scripts/ui-test.sh: it passes the showcase note.")
        }
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importText", note, "-openMode", mode, "-liveReport", "1"] + (scheme.map { ["-theme", $0] } ?? [])
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        // On a busy Mac the first tap on OK is sometimes lost.
        for _ in 0..<5 where done.exists {
            done.tap()
            _ = eventually(3) { !done.exists }
        }
    }

    private var editor: XCUIElement { app.textViews["note-editor"] }
    private var report: XCUIElement { app.descendants(matching: .any)["live-report"] }
    private var follow: XCUIElement { app.descendants(matching: .any)["live-follow-link"] }
    private var selectionReport: XCUIElement { app.descendants(matching: .any)["live-selection"] }
    /// Where the selection is, for a failure's message.
    private var caret: String { selectionReport.exists ? selectionReport.label : "?" }

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
        var out: [String: String] = [:]
        for part in (report.exists ? report.label : "").split(separator: ";") {
            let pair = part.split(separator: ":", maxSplits: 1)
            if pair.count == 2 { out[String(pair[0])] = String(pair[1]) }
        }
        return out
    }

    /// The ranges of one class of the report, as `(start, end)`.
    private func ranges(_ name: String) -> [(Int, Int)] {
        (drawn()[name] ?? "").split(separator: ",").compactMap { part in
            let ends = part.split(separator: "-").compactMap { Int($0) }
            return ends.count == 2 ? (ends[0], ends[1]) : nil
        }
    }

    private func text() -> String { (editor.value as? String) ?? "" }

    /// The range `"a-b"` of `part` in the note.
    private func range(of part: String) -> String? {
        let found = (text() as NSString).range(of: part)
        return found.location == NSNotFound ? nil : "\(found.location)-\(NSMaxRange(found))"
    }

    private func focusEditor() {
        for _ in 0..<5 {
            editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.97)).tap()
            if eventually(5, { (self.editor.value(forKey: "hasKeyboardFocus") as? Bool) == true }) { return }
        }
        XCTFail("the editor never took the keys")
    }

    private func keepScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: The showcase

    /// Every kind of block the Preview draws in the preview showcase (`preview-blocks`, read in the Preview) has its drawn block in Live: a `block-<kind>` over its
    /// source, with the paragraph that draws it (`draw-block`) at its start. Markdown that is not a table keeps the Live tab's own look (Steps 1 to 4), an `<Image>` or
    /// a `<Drawio>` is drawn by the picture layer (`draw-picture`, Step 1), and `<Toc />` and the footnotes are Step 7's: they are reported, not required, until then.
    func testEveryKindOfBlockThePreviewDrawsInTheShowcaseIsDrawnInLive() throws {
        try launch(mode: "Preview")
        let probe = app.descendants(matching: .any)["preview-blocks"]
        XCTAssertTrue(probe.waitForExistence(timeout: 60), "the Preview says which blocks it draws")
        let kinds = probe.label.split(separator: ",").map(String.init)
        // The showcase has each of these: if one is missing, the probe (or the showcase) is not what this test thinks.
        for kind in ["markdown", "table", "info", "warning", "image", "chart", "repo", "youtube", "notice"] {
            XCTAssertTrue(kinds.contains(kind), "the Preview draws a \(kind) in the showcase: \(kinds)")
        }
        keepScreenshot("the showcase in the Preview")

        for _ in 0..<3 where !report.exists || report.label == "markdown" || drawn()["draw-block"] == nil {
            app.buttons["Live"].tap()
            _ = eventually(20) { self.drawn()["draw-block"] != nil }
        }
        let leftForStep7: Set = ["toc", "footnotes"]
        var notYet: [String] = []
        for kind in kinds {
            switch kind {
            case "markdown":
                continue
            case "image":
                XCTAssertTrue(eventually { self.drawn()["draw-picture"] != nil }, "the showcase's pictures are drawn by the picture layer: \(drawn())")
            default:
                let found = eventually { !self.ranges("block-\(kind)").isEmpty }
                if !found, leftForStep7.contains(kind) {
                    notYet.append(kind)
                    continue
                }
                XCTAssertTrue(found, "the Preview's \(kind) is drawn as a block in Live: \(drawn())")
                let starts = Set(ranges("draw-block").map(\.0))
                let revealed = ranges("block-revealed")
                for block in ranges("block-\(kind)") {
                    XCTAssertTrue(starts.contains(block.0) || revealed.contains { $0.0 == block.0 },
                                  "the \(kind) at \(block.0)-\(block.1) is drawn as one picture from its first line: \(drawn())")
                }
            }
        }
        let note = XCTAttachment(string: "Preview kinds: \(kinds.joined(separator: ", "))\nNot drawn as blocks yet (Step 7): \(notYet.joined(separator: ", "))\nreport: \(report.label)")
        note.name = "showcase kinds"
        note.lifetime = .keepAlways
        add(note)
        print("LIVE_COMPONENTS showcase kinds: \(kinds.joined(separator: ",")); left for Step 7: \(notYet.joined(separator: ","))")
        keepScreenshot("the showcase in Live")
    }

    // MARK: Each component

    private static let parts = [
        "<Info>\n\nAn **info** panel with a [link](https://example.com).\n\n</Info>",
        "<Warning>\n\n- a warning\n- with a list\n\n</Warning>",
        "<Mark color=\"green\">\n\nA tinted block of words.\n\n</Mark>",
        "<Chart type=\"bar\" x=\"k\" y=\"v\" height=\"140\">\n\n```csv\nk,v\na,1\nb,3\nc,2\n```\n\n</Chart>",
        "<YouTube url=\"https://youtu.be/dQw4w9WgXcQ?t=90\" title=\"A video\" />",
        "<Repo url=\"https://github.com/meddlin/composition\" description=\"The notes app\" />",
        "<YouTube url=\"\" />",
    ]
    private static let kindsOfParts = ["info", "warning", "mark", "chart", "youtube", "repo", "notice"]

    /// Each component is drawn as one picture over its source, every character of which is hidden; the text stays the source.
    func testEachComponentIsDrawnAsOnePictureOverItsSource() throws {
        let note = "Components\n\n" + Self.parts.joined(separator: "\n\n") + "\n\nend"
        try launch(text: note)
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        // The caret on `end`, away from every component (where a note opens it is not this test's: it may be in the first block, which then shows its source).
        focusEditor()
        app.typeKey(.downArrow, modifierFlags: .command)
        for (part, kind) in zip(Self.parts, Self.kindsOfParts) {
            let at = try XCTUnwrap(range(of: part), "\(kind) is in the note")
            XCTAssertTrue(eventually(30) { (self.drawn()["block-\(kind)"] ?? "").contains(at) && (self.drawn()["block-pictured"] ?? "").contains(at) },
                          "the \(kind) at \(at) is drawn as its picture: \(drawn())")
            XCTAssertTrue((drawn()["hidden"] ?? "").split(separator: ",").contains { span in
                let ends = span.split(separator: "-").compactMap { Int($0) }, mine = at.split(separator: "-").compactMap { Int($0) }
                return ends.count == 2 && ends[0] <= mine[0] && ends[1] >= mine[1]
            }, "every character of the \(kind) is hidden: \(drawn())")
        }
        XCTAssertNil(drawn()["block-stale"], "no picture is a stand-in once all are rendered: \(drawn())")
        XCTAssertTrue(text().hasSuffix(Self.parts.joined(separator: "\n\n") + "\n\nend"), "the value is the source")
        keepScreenshot("every component in Live")
    }

    // MARK: A panel's tint

    private struct Scheme {
        let name: String
        let background: String
        let brand: String
    }

    /// The scheme's page and its brand colour (Theme+Palettes.swift, from the desktop's `globals.css`): an `<Info>` panel is the brand at 12% over the page, with a bar
    /// of the brand down its left edge (`PanelView`).
    private static let dark = Scheme(name: "dark", background: "121212", brand: "0178d4")
    private static let light = Scheme(name: "light", background: "f7f7f4", brand: "0b62d6")

    private static func rgb(_ hex: String) -> (r: Int, g: Int, b: Int) {
        let value = Int(hex, radix: 16) ?? 0
        return (value >> 16 & 0xff, value >> 8 & 0xff, value & 0xff)
    }

    /// The longest run of pixels within `tolerance` of `color`, along a row (`across`) or down a column; the window's image comes turned a quarter in landscape, so both
    /// are measured and the longer kept.
    private func longestRun(of color: (r: Int, g: Int, b: Int), tolerance: Int = 8) throws -> Int {
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

    private func checkThePanelsTint(in scheme: Scheme) throws {
        let panel = "<Info>\n\nA panel drawn in the Live tab, as the Preview draws it, in the scheme's own tint.\n\n</Info>"
        // A paragraph before the panel: a note may open with the caret in its first block after the title, and the panel must not be showing its source. The editor
        // is not given the keys, so that no keyboard bar is on screen for the pixels to find.
        try launch(text: "Panel\n\nA paragraph first.\n\n" + panel + "\n\nend", scheme: scheme.name)
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        let at = try XCTUnwrap(range(of: panel))
        XCTAssertTrue(eventually(30) { (self.drawn()["block-pictured"] ?? "").contains(at) && self.drawn()["block-revealed"] == nil }, "\(scheme.name): the panel is drawn: \(drawn())")
        let page = Self.rgb(scheme.background), brand = Self.rgb(scheme.brand)
        let fill = (r: Int((Double(page.r) * 0.88 + Double(brand.r) * 0.12).rounded()), g: Int((Double(page.g) * 0.88 + Double(brand.g) * 0.12).rounded()),
                    b: Int((Double(page.b) * 0.88 + Double(brand.b) * 0.12).rounded()))
        // The fill runs across the text's width (more than 500 points of a 13-inch iPad's landscape text, at 2 pixels a point); the bar down the panel's height.
        XCTAssertTrue(eventually(10) { (try? self.longestRun(of: fill)) ?? 0 > 1000 },
                      "\(scheme.name): the panel's fill is the brand at 12% over the page, \(fill) (longest run \((try? longestRun(of: fill)) ?? 0) pixels)")
        XCTAssertGreaterThan(try longestRun(of: brand), 80, "\(scheme.name): a bar of the brand colour runs down the panel's left edge")
        keepScreenshot("an info panel in Live, \(scheme.name)")
        for _ in 0..<3 where report.label != "markdown" {
            app.buttons["Markdown"].tap()
            _ = eventually(10) { self.report.label == "markdown" }
        }
        XCTAssertEqual(report.label, "markdown", "the Markdown tab is showing")
        XCTAssertLessThan(try longestRun(of: fill), 300, "\(scheme.name): no panel in the Markdown tab")
    }

    func testAPanelIsDrawnInTheDarkSchemesTint() throws { try checkThePanelsTint(in: Self.dark) }
    func testAPanelIsDrawnInTheLightSchemesTint() throws { try checkThePanelsTint(in: Self.light) }

    // MARK: Actions (I6)

    /// While the caret is in a `<YouTube>` or a `<Repo>` block (its source showing, its picture under it) the ↗ Step 2 puts beside a link is beside its tag, and opens
    /// the address the Preview's card opens; away from it there is none. The caret goes into the video with ↑ and into the repository with a tap on its picture
    /// (Step 5's tap to a block's start). Escape closes the `<` list, which opens when the caret lands in a tag's name (`<Yo|uTube`) and then takes ↑ and ↓.
    func testTheArrowOpensAVideoOrARepositoryWhileTheCaretIsInItsBlock() throws {
        let repo = "<Repo url=\"https://github.com/meddlin/composition\" description=\"The notes app\" />"
        let video = "<YouTube url=\"https://youtu.be/dQw4w9WgXcQ?t=90\" title=\"A video\" />"
        try launch(text: "Cards\n\n" + repo + "\n\n" + video + "\n\nend")
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        let repoAt = try XCTUnwrap(range(of: repo)), videoAt = try XCTUnwrap(range(of: video))
        XCTAssertTrue(eventually(30) { let pictured = self.drawn()["block-pictured"] ?? ""; return pictured.contains(repoAt) && pictured.contains(videoAt) }, "\(drawn())")
        focusEditor()
        app.typeKey(.downArrow, modifierFlags: .command)
        XCTAssertTrue(eventually(5) { self.drawn()["block-revealed"] == nil })
        XCTAssertFalse(follow.exists && follow.isHittable, "no ↗ with the caret on `end`")
        // Up past the blank line, onto the video's line: it shows its source, and the ↗ opens it on youtube.com.
        for _ in 0..<4 where drawn()["block-revealed"] != videoAt {
            app.typeKey(.upArrow, modifierFlags: [])
            _ = eventually(2) { self.drawn()["block-revealed"] == videoAt }
        }
        XCTAssertEqual(drawn()["block-revealed"], videoAt, "the caret is in the video's block: \(caret) \(drawn())")
        XCTAssertTrue(eventually { self.follow.exists && self.follow.isHittable }, "the ↗ is beside the video's tag")
        XCTAssertEqual(follow.value as? String, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s", "it opens the video where the Preview's card does")
        keepScreenshot("the ↗ beside a YouTube block")
        app.typeKey(.escape, modifierFlags: [])
        // Away from it: no ↗.
        app.typeKey(.downArrow, modifierFlags: .command)
        XCTAssertTrue(eventually { !(self.follow.exists && self.follow.isHittable) }, "the ↗ goes once the caret has left the block: \(caret) \(drawn())")

        // A tap on the repository's picture (the first block drawn as a picture): the caret at its start, its source showing, and the ↗ opening it in Safari.
        let geometry = app.descendants(matching: .any)["live-geometry"]
        func pictureFrame() -> CGRect? {
            let parts = (geometry.exists ? geometry.label : "").split(separator: ",").compactMap { Double($0) }
            return parts.count == 4 ? CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3]) : nil
        }
        XCTAssertTrue(eventually { pictureFrame() != nil }, "the report says where the repository's picture is")
        for _ in 0..<3 where drawn()["block-revealed"] != repoAt {
            guard let frame = pictureFrame() else { break }
            app.windows.firstMatch.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.minX + min(frame.width / 2, 80), dy: frame.midY)).tap()
            _ = eventually(4) { self.drawn()["block-revealed"] == repoAt }
        }
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertEqual(drawn()["block-revealed"], repoAt, "the caret is in the repository's block: \(caret) \(drawn())")
        XCTAssertTrue(eventually { (self.follow.value as? String) == "https://github.com/meddlin/composition" && self.follow.isHittable }, "the ↗ opens the repository")
        keepScreenshot("the ↗ beside a Repo block")
        follow.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 30), "the ↗ opened the address in Safari")
        app.activate()
    }

    // MARK: Not valid MDX

    /// A tag typed half way makes the note not valid MDX: the Preview then draws the whole note as plain Markdown under its notice, but the Live tab keeps the pictures
    /// it last drew, with no notice of its own, until the note is valid again.
    func testANoteThatStopsBeingValidMDXKeepsItsPictures() throws {
        let panel = "<Info>\n\nA panel.\n\n</Info>"
        try launch(text: "Valid\n\n" + panel + "\n\nend")
        XCTAssertTrue(editor.waitForExistence(timeout: 30))
        let at = try XCTUnwrap(range(of: panel))
        XCTAssertTrue(eventually(30) { (self.drawn()["block-pictured"] ?? "").contains(at) }, "\(drawn())")
        focusEditor()
        app.typeKey(.downArrow, modifierFlags: .command)
        app.typeText(" an <Mark>open")
        XCTAssertTrue(eventually { self.text().hasSuffix("end an <Mark>open") }, "the text is what was typed: \(text().suffix(40))")
        // Several pauses' worth: each pass finds the note not valid and leaves the blocks as they were.
        RunLoop.current.run(until: Date().addingTimeInterval(3))
        let now = drawn()
        XCTAssertEqual(now["block-info"], at, "the panel is still a block while the note is not valid MDX: \(now)")
        XCTAssertTrue((now["block-pictured"] ?? "").contains(at) && (now["draw-block"] ?? "").hasPrefix("\(at.split(separator: "-")[0])-"),
                      "and still drawn as its picture: \(now)")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", "Couldn’t render")).firstMatch.exists, "no notice in Live")
        keepScreenshot("a note not valid MDX, in Live")
        // Valid again: drawn as before.
        app.typeText("</Mark>")
        XCTAssertTrue(eventually { self.text().hasSuffix("<Mark>open</Mark>") })
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        XCTAssertEqual(drawn()["block-info"], at, "\(drawn())")
        XCTAssertTrue((drawn()["block-pictured"] ?? "").contains(at))
    }
}
