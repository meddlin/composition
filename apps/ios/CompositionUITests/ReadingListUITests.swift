import Network
import XCTest

/// The Reading List plugin on the iPad (docs/reading-list-plan.md; docs/ipad-app-design.md, C6): switched on in More ▸ Plugins, links added,
/// refused and opened, the page naming its link, read and unread, delete asking first, and the switch lasting. Run by apps/ios/scripts/ui-test.sh,
/// which makes the backup it starts from (`COMPOSITION_UI_BACKUP`). The pages come from a small web server inside the test (`LocalPages`), on
/// 127.0.0.1, so nothing here needs the internet, and the plain `http:` is the case the app's web-content exception exists for.
@MainActor
final class ReadingListUITests: XCTestCase {
    private let app = XCUIApplication()
    private var pages: LocalPages!

    override func setUp() async throws {
        continueAfterFailure = false
        pages = try await LocalPages.start()
    }

    override func tearDown() async throws {
        pages?.stop()
    }

    // MARK: Helpers

    private func launch(importing: Bool = true, _ arguments: [String] = []) throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        if importing {
            let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it passes COMPOSITION_UI_BACKUP.")
            app.launchArguments = ["-importBackup", backup] + arguments
        } else {
            app.launchArguments = arguments
        }
        app.launch()
        if importing {
            let done = app.alerts["Done"].buttons["OK"]
            XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
            done.tap()
        }
    }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func element(_ identifier: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: identifier).firstMatch }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["COMPOSITION_UI_SHOTS"] else { return }
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    private func setPlugin(on: Bool) {
        app.buttons["More"].tap()
        app.buttons["Plugins…"].tap()
        let toggle = app.switches["plugin-reading-list"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "the Plugins sheet opens")
        if (toggle.value as? String == "1") != on {
            // The switch itself, not the row's label: a tap in the middle of the row does nothing on iPadOS.
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        }
        XCTAssertTrue(eventually { (toggle.value as? String == "1") == on }, "the switch is \(on ? "on" : "off")")
        app.buttons["Done"].tap()
    }

    private func add(_ text: String) {
        let field = app.textFields["reading-add-field"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        if let current = field.value as? String, !current.isEmpty, current != "Paste a link and press Return" {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        field.typeText(text + "\n")
    }

    private var problem: String { element("reading-problem").exists ? element("reading-problem").label : "" }

    // MARK: Tests

    func testTheReadingListIsOffUntilTurnedOnThenAddsReadsAndDeletes() throws {
        try launch()
        XCTAssertTrue(element("sidebar-all").waitForExistence(timeout: 20))
        XCTAssertFalse(element("sidebar-reading-list").exists, "off until someone turns it on")

        setPlugin(on: true)
        let row = element("sidebar-reading-list")
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the sidebar has it once it is on")
        row.tap()
        XCTAssertTrue(app.staticTexts["No links yet"].waitForExistence(timeout: 10), "an empty list says how to start")
        shot("reading-1-empty")

        // Refused, with the desktop's words, and the text kept to be fixed.
        add("javascript:alert(1)")
        XCTAssertTrue(eventually { self.problem == "Only web links (http or https) can be added." }, "refused: \(problem)")
        add("https://user:secret@example.com/")
        XCTAssertTrue(eventually { self.problem == "Remove the user name and password from the link." }, "refused: \(problem)")

        // Added: the fragment goes, the page opens beside the list, and its title names the link.
        add("\(pages.base)/article#top")
        let link = element("reading-row-1")
        XCTAssertTrue(link.waitForExistence(timeout: 10), "the link is in the list")
        XCTAssertTrue(eventually { (self.element("page-address").value as? String ?? "").hasSuffix("/article") }, "the page opens: \(String(describing: element("page-address").value))")
        XCTAssertTrue(app.webViews.staticTexts["Hello from the test"].waitForExistence(timeout: 20), "the page is shown")
        XCTAssertTrue(eventually { link.label.contains("A local article") }, "the page's title names the link: \(link.label)")
        XCTAssertEqual(link.value as? String, "Unread")
        shot("reading-2-page")

        // A link inside the page is followed in place, and the page's own Back returns.
        app.webViews.links["Second page"].tap()
        XCTAssertTrue(app.webViews.staticTexts["The second page"].waitForExistence(timeout: 20), "the link inside the page is followed")
        XCTAssertTrue(app.buttons["page-back"].isEnabled)
        app.buttons["page-back"].tap()
        XCTAssertTrue(app.webViews.staticTexts["Hello from the test"].waitForExistence(timeout: 20), "back to the article")
        XCTAssertTrue(link.label.contains("A local article"), "the second page did not rename the link")

        // The same link however it is typed is the one already there.
        add("HTTP://127.0.0.1:\(pages.port)/article")
        XCTAssertTrue(eventually { self.problem == "That link is already in your list: A local article." }, "refused: \(problem)")

        // Read, from the bar over the page.
        app.buttons["page-mark-read"].tap()
        XCTAssertTrue(eventually { link.value as? String == "Read" }, "marked read")

        // Delete asks first; backing out keeps it. On the iPad the question is a popover with no Cancel button: a tap outside it is the way out.
        link.swipeLeft()
        app.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(eventually { self.app.staticTexts["Delete this link?"].exists }, "asks first")
        shot("reading-3-delete")
        if app.buttons["Cancel"].exists {
            app.buttons["Cancel"].tap()
        } else {
            app.otherElements["PopoverDismissRegion"].firstMatch.tap()
        }
        XCTAssertTrue(eventually { !self.app.staticTexts["Delete this link?"].exists }, "the question went away")
        XCTAssertTrue(link.waitForExistence(timeout: 5), "backing out kept it")
        link.swipeLeft()
        app.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(eventually { self.app.staticTexts["Delete this link?"].exists })
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Delete'")).allElementsBoundByIndex.last
        try XCTUnwrap(confirm).tap()
        XCTAssertTrue(eventually { !link.exists }, "deleted")
        XCTAssertTrue(app.staticTexts["No links yet"].waitForExistence(timeout: 10))
    }

    func testTheSwitchLastsAndTurningItOffKeepsTheLinks() throws {
        try launch()
        setPlugin(on: true)
        element("sidebar-reading-list").tap()
        add("\(pages.base)/article")
        XCTAssertTrue(element("reading-row-1").waitForExistence(timeout: 10))

        // Kept across a launch with no backup to restore.
        app.terminate()
        try launch(importing: false)
        XCTAssertTrue(element("sidebar-reading-list").waitForExistence(timeout: 20), "still on after a relaunch")

        // Off: the row goes, and the list shows notes again.
        setPlugin(on: false)
        XCTAssertTrue(eventually { !self.element("sidebar-reading-list").exists }, "gone from the sidebar")
        XCTAssertFalse(element("reading-add-field").exists, "the Reading List's column went with it")

        // On again: the link is still there.
        setPlugin(on: true)
        element("sidebar-reading-list").tap()
        XCTAssertTrue(element("reading-row-1").waitForExistence(timeout: 10), "the link was kept while it was off")
    }
}

/// A web server for the test's two pages, on 127.0.0.1 at a port the system picks. The Simulator shares the Mac's network, so the app reaches
/// it there. Each answer closes its connection.
final class LocalPages: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "local-pages")
    let port: UInt16

    var base: String { "http://127.0.0.1:\(port)" }

    private init(listener: NWListener, port: UInt16) {
        self.listener = listener
        self.port = port
    }

    static func start() async throws -> LocalPages {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        let queue = DispatchQueue(label: "local-pages-start")
        let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
            let once = Once()
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready: once.run { continuation.resume(returning: listener.port?.rawValue ?? 0) }
                case .failed(let error): once.run { continuation.resume(throwing: error) }
                default: break
                }
            }
            listener.newConnectionHandler = { LocalPages.serve($0) }
            listener.start(queue: queue)
        }
        return LocalPages(listener: listener, port: port)
    }

    func stop() { listener.cancel() }

    private static func serve(_ connection: NWConnection) {
        connection.start(queue: DispatchQueue(label: "local-pages-connection"))
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, _, _ in
            let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let path = request.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
            let (status, body) = page(path)
            let head = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
            connection.send(content: Data((head + body).utf8), completion: .contentProcessed { _ in connection.cancel() })
        }
    }

    private static func page(_ path: String) -> (String, String) {
        switch path {
        case "/article":
            ("200 OK", #"<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>A local article</title></head><body><h1>Hello from the test</h1><p><a href="/second">Second page</a></p></body></html>"#)
        case "/second":
            ("200 OK", #"<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Second page</title></head><body><h1>The second page</h1></body></html>"#)
        default:
            ("404 Not Found", "<!doctype html><title>Not found</title><p>Not found</p>")
        }
    }
}

/// Runs a block the first time only (a listener can report ready and then fail).
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func run(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard !done else { return }
        done = true
        body()
    }
}
