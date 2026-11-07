import XCTest

/// Build plan Step 7: the main flows of the sidebar, driven through the app as a person would. Run by apps/ios/scripts/ui-test.sh, which
/// makes the backup these start from (make-organization-backup.sh: two notebooks, six groups, 26 notes in them) and hands its path in
/// `COMPOSITION_UI_BACKUP`. Every test restores that backup first, so none depends on another.
///
/// The numbers below are that backup's: notebook 1 is "Notebook" (Projects 11 notes with its sub-groups, Reading 4), notebook 2 is "Work"
/// (Meetings 5, Ideas 3, three notes of its own).
@MainActor
final class OrganizationUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUp() async throws {
        continueAfterFailure = false
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft  // three columns side by side, the way the app is mostly held
        app.launchArguments = ["-importBackup", backup]
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
    }

    // MARK: Finding things

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func sidebar(_ stored: String) -> XCUIElement { element("sidebar-\(stored)") }

    /// The note rows the second column shows, by identifier (a row is more than one element to the accessibility tree, so they are counted by name).
    private func noteRows() -> Set<String> {
        let found = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note-row-'"))
        return Set(found.allElementsBoundByIndex.map(\.identifier))
    }

    private func firstNoteRow() -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'note-row-'")).firstMatch
    }

    /// What the screen shows a moment after an action: the model reads everything again off the main thread, so a check waits for it.
    private func eventually(_ timeout: TimeInterval = 8, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    private func title(_ name: String) -> XCUIElement { app.navigationBars[name].firstMatch }

    private func openWork() {
        let work = sidebar("notebook:2")
        XCTAssertTrue(work.waitForExistence(timeout: 20))
        work.tap()
        XCTAssertTrue(title("Work").waitForExistence(timeout: 5))
    }

    // MARK: The tests

    func testNotebooksAndTheirGroupsAreInTheSidebar() {
        XCTAssertTrue(sidebar("all").waitForExistence(timeout: 20))
        XCTAssertTrue(sidebar("favorites").exists)
        XCTAssertTrue(sidebar("notebook:1").exists)
        XCTAssertTrue(sidebar("notebook:2").exists)
        XCTAssertFalse(sidebar("group:1").exists, "groups stay closed until their notebook is opened")
        app.buttons["Open Notebook"].tap()
        XCTAssertTrue(sidebar("group:1").waitForExistence(timeout: 5))
        XCTAssertTrue(sidebar("group:1").label.contains("Projects"))
        XCTAssertTrue(sidebar("group:1").label.contains("11"), "Projects counts the notes in 2026 and Archive too: \(sidebar("group:1").label)")
        app.buttons["Open Projects"].tap()
        XCTAssertTrue(sidebar("group:3").waitForExistence(timeout: 5), "the sub-group 2026 is under Projects")
    }

    func testPickingAGroupListsItsNotes() {
        openWork()
        XCTAssertTrue(element("group-row-5").exists)
        XCTAssertTrue(element("group-row-6").exists)
        XCTAssertEqual(noteRows().count, 3, "Work's own three notes")
        element("group-row-5").tap()
        XCTAssertTrue(title("Meetings").waitForExistence(timeout: 5))
        XCTAssertEqual(noteRows().count, 5)
        XCTAssertTrue(sidebar("group:5").exists, "the group is shown in the sidebar, with Work opened above it")
    }

    private func makeGroup(named name: String) {
        app.buttons["New Group"].tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText(name)
        app.alerts.buttons["Create"].tap()
    }

    func testANewGroupIsListedUnderItsNotebook() {
        openWork()
        makeGroup(named: "Inbox")
        let group = element("group-row-7")  // the seventh group the backup has seen
        XCTAssertTrue(group.waitForExistence(timeout: 5), "the new group is listed under Work")
        XCTAssertTrue(group.label.contains("Inbox"), group.label)
        XCTAssertTrue(sidebar("group:7").waitForExistence(timeout: 5), "and in the sidebar, with Work opened")
    }

    func testRenamingAGroup() {
        openWork()
        let group = element("group-row-6")  // Ideas
        group.press(forDuration: 1.0)
        let rename = app.buttons["Rename…"]
        XCTAssertTrue(rename.waitForExistence(timeout: 5), "the group's menu has Rename")
        rename.tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 12) + "Concepts")  // the field starts with the old name
        app.alerts.buttons["Rename"].tap()
        XCTAssertTrue(eventually { element("group-row-6").label.contains("Concepts") }, element("group-row-6").label)
        XCTAssertTrue(eventually { sidebar("group:6").exists && sidebar("group:6").label.contains("Concepts") } || !sidebar("group:6").exists)
    }

    func testAnEmptyGroupCanBeDeletedByASwipe() {
        openWork()
        makeGroup(named: "Scratch")
        let row = sidebar("group:7")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.swipeLeft()
        let delete = app.buttons["Delete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "swiping the group's row shows Delete")
        delete.tap()
        XCTAssertTrue(sidebar("group:7").waitForNonExistence(timeout: 8), "an empty group can be deleted")
    }

    func testAGroupWithNotesCannotBeDeleted() {
        openWork()
        element("group-row-5").press(forDuration: 1.0)
        app.buttons["Delete Group"].tap()
        let alert = app.alerts["Something went wrong"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.staticTexts.element(boundBy: 1).label.contains("still has notes"), alert.debugDescription)
        alert.buttons["OK"].tap()
        XCTAssertTrue(element("group-row-5").exists)
    }

    func testFavoritesListWhatIsPinned() {
        openWork()
        XCTAssertTrue(sidebar("favorites").label.contains("0"), "Favorites starts empty: \(sidebar("favorites").label)")
        firstNoteRow().press(forDuration: 1.0)
        app.buttons["Add to Favorites"].tap()
        XCTAssertTrue(eventually { sidebar("favorites").label.contains("1") }, sidebar("favorites").label)
        sidebar("favorites").tap()
        XCTAssertTrue(title("Favorites").waitForExistence(timeout: 5))
        XCTAssertEqual(noteRows().count, 1)
    }

    func testBackAndForwardRetraceTheSidebar() {
        openWork()
        sidebar("favorites").tap()
        XCTAssertTrue(title("Favorites").waitForExistence(timeout: 5))
        app.buttons["Back"].tap()
        XCTAssertTrue(title("Work").waitForExistence(timeout: 5))
        app.buttons["Forward"].tap()
        XCTAssertTrue(title("Favorites").waitForExistence(timeout: 5))
    }

    func testDraggingANoteOntoAGroupMovesIt() {
        openWork()
        app.buttons["Open Work"].tap()
        let ideas = sidebar("group:6")
        XCTAssertTrue(ideas.waitForExistence(timeout: 5))
        XCTAssertTrue(ideas.label.contains("3"))
        firstNoteRow().press(forDuration: 0.8, thenDragTo: ideas)
        XCTAssertTrue(eventually { sidebar("group:6").label.contains("4") }, "Ideas now holds four notes: \(sidebar("group:6").label)")
        XCTAssertTrue(eventually { noteRows().count == 2 }, "Work's own notes went from three to two: \(noteRows())")
    }
}
