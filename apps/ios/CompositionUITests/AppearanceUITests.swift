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
}
