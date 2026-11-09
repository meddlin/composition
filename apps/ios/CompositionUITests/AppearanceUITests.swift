import XCTest

/// Build plan Step 10: the colour schemes as the screen shows them. What the tokens are is checked against the desktop's `globals.css`
/// (CompositionCore's `AppearanceConformanceTests`); this checks that the app paints them: for each scheme it reads the actual pixels of the editor's page
/// and of the list beside it, and keeps a screenshot of the screen as an attachment. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class AppearanceUITests: XCTestCase {
    private let app = XCUIApplication()

    /// A scheme's page and card colours, from the desktop's stylesheet.
    private struct Scheme {
        let name: String
        let background: String
        let surface: String
    }

    private static let schemes = [
        Scheme(name: "dark", background: "#121212", surface: "#1e1e1e"),
        Scheme(name: "light", background: "#f7f7f4", surface: "#edede8"),
        Scheme(name: "forest", background: "#0c1510", surface: "#132019"),
        Scheme(name: "wine", background: "#160a0e", surface: "#22111a"),
        Scheme(name: "cream", background: "#f6f0e1", surface: "#eee5d0"),
    ]

    private func backup() throws -> String {
        try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
    }

    /// Note 25 is "CI/CD pipelines cheat sheet" in the organization backup; it opens on the Markdown tab. `importing: false` is a second launch of the same
    /// data (what was chosen in the app stays).
    private func launch(_ extra: [String] = [], importing: Bool = true) throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = (importing ? ["-importBackup", try backup()] : []) + ["-openNote", "25", "-openMode", "Markdown"] + extra
        app.launch()
        if importing {
            let done = app.alerts["Done"].buttons["OK"]
            XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
            done.tap()
        }
        XCTAssertTrue(app.textViews["note-editor"].waitForExistence(timeout: 30))
    }

    // MARK: Reading the screen

    /// The window as an image, and how its pixels sit under the app's points. The image of a window comes in the device's own portrait shape,
    /// turned a quarter from what the app shows in landscape, so the app's point (x, y) is looked for in the turned image.
    private func window() throws -> Screen {
        let frame = app.windows.firstMatch.frame
        let image = try XCTUnwrap(app.windows.firstMatch.screenshot().image.cgImage)
        return Screen(image: image, width: Double(frame.width), height: Double(frame.height))
    }

    private struct Screen {
        let image: CGImage
        /// The window's size in points, as the app lays itself out.
        let width: Double
        let height: Double
    }

    /// The colour at a point of the window (as the app sees it, in landscape left), in sRGB.
    private func pixel(_ screen: Screen, x: Double, y: Double) throws -> (r: Int, g: Int, b: Int) {
        let portraitImage = screen.image.width < screen.image.height
        // The image's point (u, v) for the window's (x, y): the image is turned a quarter, so across the window is down the image.
        let (u, v): (Double, Double) = portraitImage ? (screen.height - y, x) : (x, y)
        let scale = Double(screen.image.width) / (portraitImage ? screen.height : screen.width)
        var data = [UInt8](repeating: 0, count: 4)
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        let context = try XCTUnwrap(CGContext(data: &data, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let px = Double(Int(u * scale)), py = Double(Int(v * scale))
        context.draw(screen.image, in: CGRect(x: -px, y: -(Double(screen.image.height) - py - 1), width: Double(screen.image.width), height: Double(screen.image.height)))
        return (Int(data[0]), Int(data[1]), Int(data[2]))
    }

    private func hex(_ value: String) -> (r: Int, g: Int, b: Int) {
        let n = Int(value.dropFirst(), radix: 16) ?? 0
        return ((n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF)
    }

    private func expect(_ actual: (r: Int, g: Int, b: Int), _ wanted: String, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let target = hex(wanted)
        let off = max(abs(actual.r - target.r), abs(actual.g - target.g), abs(actual.b - target.b))
        XCTAssertLessThanOrEqual(off, 3, "\(what): the screen shows rgb(\(actual.r), \(actual.g), \(actual.b)), the scheme says \(wanted)", file: file, line: line)
    }

    private func keepScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The editor's page (in its blank lower part) and the list column (to the right of the rows, where nothing is drawn) are the scheme's.
    private func checkPaint(of scheme: Scheme) throws {
        let screen = try window()
        expect(try pixel(screen, x: screen.width - 300, y: screen.height - 40), scheme.background, "\(scheme.name): the editor's page")
        // The list's own background at the bottom edge of the window, to the left of the home indicator: no row, divider or text is ever there.
        expect(try pixel(screen, x: 400, y: screen.height - 4), scheme.surface, "\(scheme.name): the list beside the note")
        keepScreenshot("\(scheme.name) scheme")
    }

    func testTheDarkSchemeIsPainted() throws { try launch(["-theme", "dark"]); try checkPaint(of: Self.schemes[0]) }
    func testTheLightSchemeIsPainted() throws { try launch(["-theme", "light"]); try checkPaint(of: Self.schemes[1]) }
    func testTheForestSchemeIsPainted() throws { try launch(["-theme", "forest"]); try checkPaint(of: Self.schemes[2]) }
    func testTheWineSchemeIsPainted() throws { try launch(["-theme", "wine"]); try checkPaint(of: Self.schemes[3]) }
    func testTheCreamSchemeIsPainted() throws { try launch(["-theme", "cream"]); try checkPaint(of: Self.schemes[4]) }

    // MARK: The ten components in every scheme

    /// The "Preview showcase" note (fixtures/conformance/preview-showcase/note.md: every component the preview draws), imported at launch, drawn on the
    /// Preview tab in each scheme. The page is the scheme's; the screenshot of each is kept as an attachment, which is the snapshot to look at. (The
    /// colours of the components themselves are the tokens' and the `<Mark>` tints', checked against the desktop in CompositionCore.)
    func testTheShowcaseIsDrawnInEveryScheme() throws {
        let showcase = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_SHOWCASE"], "Run apps/ios/scripts/ui-test.sh: it passes the showcase note.")
        for scheme in Self.schemes {
            continueAfterFailure = true
            XCUIDevice.shared.orientation = .landscapeLeft
            app.launchArguments = ["-importBackup", try backup(), "-importText", showcase, "-openMode", "Preview", "-theme", scheme.name]
            app.launch()
            let done = app.alerts["Done"].buttons["OK"]
            XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
            done.tap()
            // The imported note is the one on show (it is the newest).
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label ==[c] %@", "contents")).firstMatch.waitForExistence(timeout: 30), "\(scheme.name): the showcase's table of contents is drawn")
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Staging resets")).firstMatch.exists, "\(scheme.name): its panels are drawn")
            let screen = try window()
            expect(try pixel(screen, x: screen.width - 8, y: 400), scheme.background, "\(scheme.name): the preview's page")
            keepScreenshot("showcase, \(scheme.name)")
            app.terminate()
        }
    }

    // MARK: The Appearance sheet

    private func openAppearance() {
        app.buttons["More"].tap()
        app.buttons["Appearance…"].tap()
        XCTAssertTrue(app.buttons["scheme-forest"].waitForExistence(timeout: 10), "the sheet lists the schemes")
    }

    func testAChoiceInTheAppearanceSheetRestylesAtOnceAndIsKept() throws {
        try launch()
        openAppearance()
        app.buttons["scheme-forest"].tap()
        XCTAssertTrue(app.buttons["scheme-forest"].isSelected, "the choice is marked")
        app.buttons["Done"].tap()
        let forest = Self.schemes[2]
        var screen = try window()
        expect(try pixel(screen, x: screen.width - 300, y: screen.height - 40), forest.background, "forest, at once")
        // A second launch of the same data, with nothing said about the scheme: it was written to settings.json.
        app.terminate()
        try launch(importing: false)
        screen = try window()
        expect(try pixel(screen, x: screen.width - 300, y: screen.height - 40), forest.background, "forest, kept")
        keepScreenshot("forest, kept")
        // System follows the iPad again (the Simulator is in light mode, unless it was left in dark).
        openAppearance()
        app.buttons["scheme-system"].tap()
        XCTAssertTrue(app.buttons["scheme-system"].isSelected)
    }

    func testTheFontsCanBeChosen() throws {
        try launch()
        openAppearance()
        let editor = app.buttons["editor-font"]
        XCTAssertTrue(editor.exists)
        XCTAssertTrue(editor.label.contains("Monospaced") || (editor.value as? String)?.contains("Monospaced") == true, "the editor starts in a monospaced face: \(editor.label)")
        editor.tap()
        app.buttons["Serif"].firstMatch.tap()
        XCTAssertTrue(editor.label.contains("Serif") || (editor.value as? String)?.contains("Serif") == true, "and is now serif: \(editor.label)")
    }

    /// The way in is in plain sight at the foot of the first column (not only in the More menu): a finger-sized button that says what it is and which scheme is in force.
    func testTheAppearanceButtonAtTheFootOfTheFirstColumnOpensTheSheet() throws {
        try launch()  // (not with `-theme`, which would override what is chosen)
        let button = app.buttons["sidebar-appearance"]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "the first column has an Appearance button")
        XCTAssertGreaterThanOrEqual(button.frame.height, 44, "a finger high")
        XCTAssertTrue(button.label.hasPrefix("Appearance"), "it says what it is, and then which scheme is in force: \(button.label)")
        button.tap()
        XCTAssertTrue(app.buttons["scheme-forest"].waitForExistence(timeout: 10), "it opens the sheet of schemes")
        app.buttons["scheme-forest"].tap()
        app.buttons["Done"].tap()
        let named = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'Forest'"), object: app.buttons["sidebar-appearance"])
        XCTAssertEqual(XCTWaiter().wait(for: [named], timeout: 10), .completed, "and the button names the scheme just chosen: \(app.buttons["sidebar-appearance"].label)")
    }

    // MARK: Follow the sun

    /// The classic pair's surfaces at the ends of the fade, from the desktop's stylesheet; the blend is `color-mix(in srgb, day <level>, night)`.
    private static let sunDay = (background: "#f7f7f4", surface: "#edede8"), sunNight = (background: "#121212", surface: "#1e1e1e")

    private func blend(_ day: String, _ night: String, _ level: Double) -> String {
        let (d, n) = (hex(day), hex(night))
        func channel(_ top: Int, _ under: Int) -> Int { Int((Double(top) * level + Double(under) * (1 - level) + 0.5).rounded(.down)) }
        return String(format: "#%02x%02x%02x", channel(d.r, n.r), channel(d.g, n.g), channel(d.b, n.b))
    }

    private func scrollSheet(until element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<8 where !(element.exists && element.isHittable) { app.swipeUp(velocity: .slow) }
        XCTAssertTrue(element.exists && element.isHittable, "\(element) is on the sheet", file: file, line: line)
    }

    /// `-theme auto` with `-sunLevel` holds the fade at a point; the page and the list beside it are the pair's colours blended there.
    func testFollowTheSunIsPaintedAtEveryPointOfTheFade() throws {
        var first = true
        for level in [1.0, 0.5, 0.0] {
            try launch(["-theme", "auto", "-sunLevel", String(level)], importing: first)
            first = false
            let screen = try window()
            expect(try pixel(screen, x: screen.width - 300, y: screen.height - 40), blend(Self.sunDay.background, Self.sunNight.background, level), "level \(level): the editor's page")
            expect(try pixel(screen, x: 400, y: screen.height - 4), blend(Self.sunDay.surface, Self.sunNight.surface, level), "level \(level): the list beside the note")
            keepScreenshot("follow the sun, level \(level)")
            app.terminate()
        }
    }

    func testTheAppearanceSheetChoosesFollowTheSunAndItsPair() throws {
        try launch(["-sunLevel", "1"])
        openAppearance()
        let sun = app.buttons["scheme-sun"]
        scrollSheet(until: sun)
        sun.tap()
        XCTAssertTrue(sun.isSelected, "the choice is marked")
        // Its own settings appear: the five pairs and the city.
        let sky = app.buttons["sun-pair-sky-midnight"]
        scrollSheet(until: sky)
        for pair in ["classic", "cream-amber", "mint-forest", "blush-wine", "sky-midnight"] { XCTAssertTrue(app.buttons["sun-pair-\(pair)"].exists, "the pair \(pair) is listed") }
        XCTAssertTrue(app.buttons["sun-pair-classic"].isSelected, "the classic pair is the one chosen at first")
        keepScreenshot("appearance sheet, Follow the sun chosen")
        sky.tap()
        XCTAssertTrue(sky.isSelected)
        scrollSheet(until: app.textFields["sun-city"])
        let status = app.staticTexts["sun-city-status"]
        scrollSheet(until: status)
        XCTAssertTrue(status.label.hasPrefix("No city saved yet"), "no city is saved, and it says what it uses instead: \(status.label)")
        keepScreenshot("appearance sheet, the city")
        app.buttons["Done"].tap()
        var screen = try window()
        expect(try pixel(screen, x: screen.width - 300, y: screen.height - 40), "#eef5fb", "sky and midnight, by day: the page")
        // Kept: a second launch of the same data says nothing about the scheme or the pair.
        app.terminate()
        try launch(["-sunLevel", "1"], importing: false)
        screen = try window()
        expect(try pixel(screen, x: screen.width - 300, y: screen.height - 40), "#eef5fb", "sky and midnight, kept")
        // The button at the foot of the first column names it.
        let named = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'Follow the sun'"), object: app.buttons["sidebar-appearance"])
        XCTAssertEqual(XCTWaiter().wait(for: [named], timeout: 10), .completed, "the Appearance button names the scheme: \(app.buttons["sidebar-appearance"].label)")
    }

    /// An empty city is forgotten without asking the network anything, so this needs none.
    func testSavingAnEmptyCityForgetsIt() throws {
        try launch(["-theme", "auto", "-sunLevel", "1"])
        openAppearance()
        let save = app.buttons["sun-city-save"]
        scrollSheet(until: save)
        save.tap()
        let status = app.staticTexts["sun-city-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 10))
        XCTAssertTrue(status.label.hasPrefix("City forgotten"), status.label)
    }

    func testFollowTheSunSettingsFitPortraitToo() throws {
        try launch(["-theme", "auto", "-sunLevel", "0.5"])
        XCUIDevice.shared.orientation = .portrait
        // In portrait the note has the whole screen: bring the lists back, and the way in is where it always is.
        app.buttons["focus-toggle"].tap()
        openAppearance()
        let city = app.textFields["sun-city"]
        scrollSheet(until: city)
        keepScreenshot("appearance sheet, Follow the sun, portrait")
        scrollSheet(until: app.buttons["sun-city-save"])
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    // MARK: Writing aids: the ruler and reflow

    private var editor: XCUIElement { app.textViews["note-editor"] }

    /// The lines `-autotype` has typed at the end of the note (it types where the note ends, on the line after its last), once the last word has arrived.
    private func typedLines() throws -> [Substring] {
        let arrived = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value ENDSWITH %@", "dog"), object: editor)
        XCTAssertEqual(XCTWaiter().wait(for: [arrived], timeout: 60), .completed, "the typing arrived")
        let lines = try XCTUnwrap(editor.value as? String).split(separator: "\n", omittingEmptySubsequences: false)
        let first = try XCTUnwrap(lines.firstIndex { $0.hasPrefix("the quick") }, "what was typed is in the note")
        return Array(lines[first...])
    }

    func testReflowBreaksALineThatTypingPushesPastTheColumn() throws {
        try launch(["-reflow", "1", "-reflowColumn", "24", "-autotype", "the quick brown fox jumps over the lazy dog", "-autotypeInterval", "0.03"])
        let lines = try typedLines()
        XCTAssertGreaterThanOrEqual(lines.count, 2, "the sentence was broken: \(lines)")
        XCTAssertTrue(lines.allSatisfy { $0.count <= 24 }, "no line is past the column: \(lines)")
        XCTAssertEqual(lines.joined(separator: " "), "the quick brown fox jumps over the lazy dog", "nothing was lost or added but the breaks")
        keepScreenshot("reflow at column 24")
    }

    func testNothingIsBrokenUnlessReflowIsOn() throws {
        try launch(["-autotype", "the quick brown fox jumps over the lazy dog", "-autotypeInterval", "0.03"])
        let lines = try typedLines()
        XCTAssertEqual(lines, ["the quick brown fox jumps over the lazy dog"], "reflow is off until it is switched on")
    }

    func testTheRulerSitsAtTheColumnAndMovesWithIt() throws {
        func rulerX(column: Int, importing: Bool) throws -> Double {
            try launch(["-ruler", "1", "-rulerColumn", "\(column)"], importing: importing)
            let ruler = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'ruler x='")).firstMatch
            XCTAssertTrue(ruler.waitForExistence(timeout: 20), "the ruler is drawn at column \(column)")
            let label = ruler.label
            keepScreenshot("ruler at column \(column)")
            app.terminate()
            return try XCTUnwrap(Double(label.dropFirst("ruler x=".count).split(separator: " ").first ?? ""))
        }
        let forty = try rulerX(column: 40, importing: true)
        let eighty = try rulerX(column: 80, importing: false)
        // A column is the width of a "0" in the editor's face (16 points of monospace is about 9.6).
        let perColumn = (eighty - forty) / 40
        XCTAssertTrue((8.5...11).contains(perColumn), "a column is \(perColumn) points wide")
        // Nothing is drawn when it is off.
        try launch([], importing: false)
        XCTAssertFalse(app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'ruler x='")).firstMatch.exists, "no ruler by default")
    }

    /// A switch in a form row is turned by its own control at the trailing edge; a tap in the middle of the row's label does nothing.
    private func flip(_ toggle: XCUIElement) {
        let before = toggle.value as? String
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != %@", before ?? ""), object: toggle)
        XCTAssertEqual(XCTWaiter().wait(for: [changed], timeout: 5), .completed, "the switch turned")
    }

    func testTheWritingAidsAreSwitchedOnInTheAppearanceSheet() throws {
        try launch()
        openAppearance()
        let ruler = app.switches["ruler-toggle"]
        scrollSheet(until: ruler)
        XCTAssertEqual(ruler.value as? String, "0", "off at first")
        XCTAssertFalse(app.steppers["ruler-column"].exists, "the column waits until the ruler is on")
        flip(ruler)
        XCTAssertEqual(ruler.value as? String, "1")
        XCTAssertTrue(app.steppers["ruler-column"].waitForExistence(timeout: 5), "the ruler's column appears")
        let reflow = app.switches["reflow-toggle"]
        scrollSheet(until: reflow)
        flip(reflow)
        XCTAssertTrue(app.steppers["reflow-column"].waitForExistence(timeout: 5))
        scrollSheet(until: app.switches["reflow-tables"])
        keepScreenshot("appearance sheet, writing aids on")
        app.buttons["Done"].tap()
        // Kept: the ruler is drawn in the editor, and a second launch with nothing said still has it.
        let drawn = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'ruler x='")).firstMatch
        XCTAssertTrue(drawn.waitForExistence(timeout: 10), "the ruler is drawn at once")
        app.terminate()
        try launch([], importing: false)
        XCTAssertTrue(app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'ruler x='")).firstMatch.waitForExistence(timeout: 20), "and kept")
    }
}
