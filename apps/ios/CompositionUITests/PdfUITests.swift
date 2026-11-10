import PDFKit
import XCTest

/// M2, the PDF reader: a PDF imported (through the app's own launch shortcut, `-importPdf`, which does what choosing that file in the Import PDF picker does:
/// the picker and a drag from Files are the system's and are tried by hand) opens beside the note that owns it, shows its pages, lists its own contents and the
/// bookmarks made, jumps to a page, and comes back to the page it was left at. The PDF is made by the test: twelve pages and a table of contents of three
/// lines. apps/ios/scripts/ui-test.sh passes the backup the app starts from.
@MainActor
final class PdfUITests: XCTestCase {
    private let app = XCUIApplication()
    private var folder: URL!
    private let title = "Quarterly Reading"

    override func setUp() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let backup = try XCTUnwrap(environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        folder = FileManager.default.temporaryDirectory.appending(path: "pdf-ui-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let book = folder.appending(path: "\(title).pdf")
        try Self.makeBook(at: book)
        XCUIDevice.shared.orientation = .landscapeLeft
        app.launchArguments = ["-importBackup", backup, "-importPdf", book.path]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
    }

    override func tearDown() async throws {
        if let folder { try? FileManager.default.removeItem(at: folder) }
    }

    /// Twelve pages, each with its number large at the top, and a table of contents: Chapter One on page 1, Two on page 5, Three on page 9.
    private static func makeBook(at url: URL) throws {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            for page in 1...12 {
                context.beginPage()
                ("Page \(page)" as NSString).draw(at: CGPoint(x: 72, y: 72), withAttributes: [.font: UIFont.systemFont(ofSize: 48)])
                (String(repeating: "Reading text. ", count: 60) as NSString).draw(in: CGRect(x: 72, y: 150, width: 468, height: 500), withAttributes: [.font: UIFont.systemFont(ofSize: 16)])
            }
        }
        let document = try XCTUnwrap(PDFDocument(data: data))
        let root = PDFOutline()
        for (index, chapter) in [("Chapter One", 0), ("Chapter Two", 4), ("Chapter Three", 8)].enumerated() {
            let item = PDFOutline()
            item.label = chapter.0
            item.destination = PDFDestination(page: try XCTUnwrap(document.page(at: chapter.1)), at: CGPoint(x: 0, y: 792))
            root.insertChild(item, at: index)
        }
        document.outlineRoot = root
        XCTAssertTrue(document.write(to: url), "the test's PDF could not be written")
    }

    private func eventually(_ timeout: TimeInterval = 20, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private var pageButton: XCUIElement { app.buttons["pdf-page"] }

    private func waitForPage(_ number: Int, of count: Int = 12, timeout: TimeInterval = 20, _ message: String = "") {
        let wanted = "Page \(number) of \(count)"
        XCTAssertTrue(eventually(timeout) { pageButton.exists && pageButton.label == wanted }, "\(message) the reader should say \(wanted), it says \(pageButton.exists ? pageButton.label : "nothing")")
    }

    private func openContents() {
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["Contents"].waitForExistence(timeout: 10), "the contents and bookmarks open")
    }

    // MARK: Opening

    func testAnImportedPdfOpensWithItsFirstPage() {
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30), "the PDF is shown")
        waitForPage(1)
        XCTAssertTrue(app.buttons["Find in the PDF"].exists)
        XCTAssertTrue(app.buttons["Contents, bookmarks, highlights and notes"].exists)
    }

    func testTheNoteListMarksANoteThatOwnsAPdf() {
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30))
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the note made for the PDF is in the list, named after the file")
        XCTAssertTrue(row.images["PDF"].exists || row.staticTexts["PDF"].exists, "its row says it is a PDF")
    }

    // MARK: The layout

    func testANarrowPaneSwitchesBetweenThePdfAndTheNoteAndAWideOneShowsBoth() {
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30))
        // With the lists beside it, the pane is too narrow for two halves: a switch.
        let picker = app.segmentedControls["pdf-pane-picker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10), "a narrow pane has a switch between the PDF and the note")
        picker.buttons["Note"].tap()
        XCTAssertTrue(eventually { !self.app.buttons["pdf-page"].isHittable }, "the note is shown in place of the PDF")
        picker.buttons["PDF"].tap()
        waitForPage(1, "Back on the PDF:")
        // With the lists hidden, both halves are side by side and have a divider.
        app.buttons["focus-toggle"].tap()
        XCTAssertTrue(app.otherElements["split-divider"].waitForExistence(timeout: 10), "the PDF and the note have a divider between them")
        XCTAssertEqual(app.otherElements["split-divider"].label, "Divider between the PDF and the note")
        XCTAssertFalse(app.segmentedControls["pdf-pane-picker"].exists, "no switch where both are shown")
        waitForPage(1, "Side by side:")
    }

    // MARK: Contents, bookmarks, going to a page

    func testTheContentsListsThePdfsOwnChaptersAndJumpsToOne() {
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30))
        openContents()
        XCTAssertTrue(app.buttons["pdf-outline-0"].waitForExistence(timeout: 10), "the first chapter is listed")
        XCTAssertTrue(app.buttons["pdf-outline-1"].exists && app.buttons["pdf-outline-2"].exists, "so are the others")
        XCTAssertTrue(app.buttons["pdf-outline-1"].label.contains("Chapter Two"), "in the PDF's own words: \(app.buttons["pdf-outline-1"].label)")
        app.buttons["pdf-outline-1"].tap()
        waitForPage(5, "Chapter Two is on page 5:")
        XCTAssertFalse(app.buttons["pdf-outline-1"].exists, "choosing a chapter closes the list")
    }

    func testAPageCanBeGoneToByNumber() {
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30))
        pageButton.tap()
        let alert = app.alerts["Go to page"]
        XCTAssertTrue(alert.waitForExistence(timeout: 10))
        alert.textFields.firstMatch.typeText("7")
        alert.buttons["Go"].tap()
        waitForPage(7, "Page 7:")
    }

    func testABookmarkIsMadeListedAndTakenOff() {
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30))
        openContents()
        app.buttons["pdf-outline-2"].tap()
        waitForPage(9, "Chapter Three:")
        XCTAssertTrue(app.buttons["Bookmark this page"].exists)
        app.buttons["Bookmark this page"].tap()
        XCTAssertTrue(app.buttons["Remove this page's bookmark"].waitForExistence(timeout: 10), "the page is bookmarked")
        openContents()
        app.segmentedControls.buttons["Bookmarks"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pdf-bookmark-'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the bookmark is listed")
        XCTAssertTrue(row.label.contains("Page 9"), "by its page: \(row.label)")
        // Another page, then back by the bookmark.
        app.segmentedControls.buttons["Contents"].tap()
        app.buttons["pdf-outline-0"].tap()
        waitForPage(1, "Chapter One:")
        openContents()
        app.segmentedControls.buttons["Bookmarks"].tap()
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'pdf-bookmark-'")).firstMatch.tap()
        waitForPage(9, "By the bookmark:")
        XCTAssertTrue(app.buttons["Remove this page's bookmark"].exists)
        app.buttons["Remove this page's bookmark"].tap()
        XCTAssertTrue(app.buttons["Bookmark this page"].waitForExistence(timeout: 10), "the bookmark is gone")
    }

    // MARK: Where it was left

    func testTheReaderComesBackToThePageItWasLeftAt() {
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30))
        openContents()
        app.buttons["pdf-outline-2"].tap()
        waitForPage(9, "Chapter Three:")
        // The place is written a moment after the reader settles.
        RunLoop.current.run(until: Date().addingTimeInterval(2.5))
        app.terminate()
        app.launchArguments = []
        app.launch()
        let row = app.cells.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 60), "the note is still there after the app was ended")
        if !app.descendants(matching: .any)["pdf-view"].exists { row.tap() }
        XCTAssertTrue(app.descendants(matching: .any)["pdf-view"].waitForExistence(timeout: 30))
        waitForPage(9, "After a restart:")
    }
}
