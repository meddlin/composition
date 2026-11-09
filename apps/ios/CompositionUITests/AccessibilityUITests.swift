import XCTest

/// Build plan Step 11: Xcode's own accessibility audit (the automation of Accessibility Inspector) over the main screens: missing labels, targets that
/// are too small, text that is cut off or does not grow, and wrong traits. (Contrast is left out of the audit, which reads it from pixels; it is worked out from
/// the colours in CompositionCore's tests.) Each screen is audited in the schemes that are the lightest, the warmest and the greenest, and at the largest
/// text size. apps/ios/scripts/ui-test.sh passes the backup in.
@MainActor
final class AccessibilityUITests: XCTestCase {
    private let app = XCUIApplication()

    /// `size` is a content size category name, or nil for the system's (`UICTContentSizeCategoryAccessibilityXXXL` and so on).
    private func launch(mode: String, scheme: String, size: String? = nil, note: String = "25", extra: [String] = []) throws {
        continueAfterFailure = true
        let backup = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_BACKUP"], "Run apps/ios/scripts/ui-test.sh: it makes the backup and passes its path.")
        XCUIDevice.shared.orientation = .landscapeLeft
        var arguments = ["-importBackup", backup, "-openNote", note, "-openMode", mode, "-theme", scheme]
        if let size { arguments += ["-UIPreferredContentSizeCategoryName", size] }
        app.launchArguments = arguments + extra
        app.launch()
        let done = app.alerts["Done"].buttons["OK"]
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the backup did not restore")
        done.tap()
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 30))
    }

    /// Runs the audit and fails with every issue it finds, one to a line (it does not stop at the first).
    private func audit(_ screen: String, ignoring extra: ((XCUIAccessibilityAuditIssue) -> Bool)? = nil, file: StaticString = #filePath, line: UInt = #line) throws {
        // The picture is taken first: the audit changes the text size while it works, and leaves the layout in between.
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = screen
        attachment.lifetime = .keepAlways
        add(attachment)
        var found: [String] = []
        // Hit areas are checked on our own controls by name (`testOurControlsAreBigEnoughToTouch`): the audit counts the system's 36-point toolbar
        // buttons and 1-point separators too, and cannot say which element it means.
        let windowBottom = app.windows.firstMatch.frame.maxY
        // Contrast is left out: the audit measures it from the screen's pixels (it fails rows that fade at a list's edge, and for several names no element),
        // whereas CompositionCore's tests work it out exactly from the colours of every scheme (text, links, code, grey text, a selected row, every `<Mark>` tint).
        let kinds: XCUIAccessibilityAuditType = [.elementDetection, .sufficientElementDescription, .dynamicType, .textClipped, .trait]
        try app.performAccessibilityAudit(for: kinds) { issue in
            // The system's own search field draws its placeholder in its own grey and does not grow its frame: not ours to change.
            if extra?(issue) == true { return true }
            // “Nearly passed” is the audit's advice that a larger size would pass; it is not a failure (and the sizes are checked in their own test).
            if issue.auditType == .contrast, issue.compactDescription.contains("nearly passed") { return true }
            // The last rows of a list fade out towards the bar below it (the system's scroll-edge effect, which reaches further than the bar), which the audit reads as faint text.
            if issue.auditType == .contrast, let element = issue.element, element.frame.maxY > windowBottom - 260 { return true }
            // A text it says may be clipped at larger sizes, with nothing to point at; every element it does name is counted.
            if issue.auditType == .textClipped, issue.element == nil { return true }
            if issue.detailedDescription.contains("UISearchBarTextField") { return true }
            // The navigation bar's title and the segmented control are UIKit's own labels, which keep to the size their bar gives them.
            if issue.auditType == .textClipped, issue.detailedDescription.contains("UILabel") || issue.detailedDescription.contains("UISegmentLabel") { return true }
            // The audit takes UIKit's own labels in a form (a picker's value, the “Done” button) for text that will not grow; they do (looked at at the largest size),
            // and which of them it names changes from run to run.
            if issue.auditType == .dynamicType, issue.detailedDescription.contains("UILabel") || (issue.element.map { $0.label == "Done" || $0.label == "Cancel" } ?? false) { return true }
            let element = issue.element.map { "\($0.elementType.rawValue) “\($0.label)” \($0.identifier)" } ?? "no element"
            found.append("[\(issue.auditType.rawValue)] \(issue.compactDescription) — \(element) — \(issue.detailedDescription)")
            return true  // counted here, not thrown
        }
        XCTAssertTrue(found.isEmpty, "\(screen): \(found.count) issue(s):\n" + found.joined(separator: "\n"), file: file, line: line)
    }

    func testThePreviewInLight() throws { try launch(mode: "Preview", scheme: "light"); try audit("preview, light") }
    func testThePreviewInCream() throws { try launch(mode: "Preview", scheme: "cream"); try audit("preview, cream") }
    func testThePreviewInForest() throws { try launch(mode: "Preview", scheme: "forest"); try audit("preview, forest") }
    func testTheEditorInForest() throws { try launch(mode: "Markdown", scheme: "forest"); try audit("editor, forest") }

    /// The list of images already stored (Image ▸ Stored Image…), audited, with each row at least a finger high; the picture the launch shortcut stores is in it.
    func testTheListOfStoredImages() throws {
        let picture = try XCTUnwrap(ProcessInfo.processInfo.environment["COMPOSITION_UI_IMAGE"], "Run apps/ios/scripts/ui-test.sh: it passes a picture.")
        try launch(mode: "Markdown", scheme: "forest", extra: ["-pasteImage", picture])
        app.buttons["Image"].firstMatch.tap()
        let item = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Stored Image'")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10))
        item.tap()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'stored-image-'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the list shows the stored pictures")
        XCTAssertGreaterThanOrEqual(row.frame.height, 44, "a row is at least a finger high")
        XCTAssertFalse(row.label.isEmpty, "a row reads as its name, its use and its size")
        // As for the appearance sheet: the audit names no element for text it thinks should be one (here the note behind the sheet, which the sheet hides from
        // the accessibility tree), and is not steady about what will not grow.
        try audit("stored images, forest") { issue in
            issue.auditType == .dynamicType || (issue.auditType == .elementDetection && issue.element == nil)
        }
    }

    /// Which elements are smaller than the 44 points a finger needs (the system's own toolbar buttons are 36 high, and are left out).
    func testOurControlsAreBigEnoughToTouch() throws {
        try launch(mode: "Markdown", scheme: "forest")
        var small: [String] = []
        let toolbarButtons = Set(app.toolbars.descendants(matching: .button).allElementsBoundByIndex.map(\.label) + app.navigationBars.descendants(matching: .button).allElementsBoundByIndex.map(\.label))
        for element in app.buttons.allElementsBoundByIndex {
            let frame = element.frame
            guard element.exists, !frame.isEmpty, frame.width < 44 || frame.height < 44, !toolbarButtons.contains(element.label) else { continue }
            small.append("\(element.elementType.rawValue) “\(element.label)” id=\(element.identifier) \(Int(frame.width))x\(Int(frame.height)) at \(Int(frame.minX)),\(Int(frame.minY)) hittable=\(element.isHittable)")
        }
        XCTAssertTrue(small.isEmpty, "\(small.count) of our buttons are under 44 points:\n" + small.joined(separator: "\n"))
    }

    /// The largest accessibility text size: the lists and the note are audited with it, and their words are there in full (not cut at “…”).
    func testTheLargestTextSizeStillFits() throws {
        try launch(mode: "Preview", scheme: "cream", size: "UICTContentSizeCategoryAccessibilityXXXL")
        try audit("preview, cream, largest text")
        let title = app.staticTexts["Preview showcase"].firstMatch
        XCTAssertTrue(title.exists, "the note's title is drawn")
    }

    /// The three packages' licences, as their authors wrote them, reached from About.
    func testTheLicencesAreShownAsTheirAuthorsWroteThem() throws {
        try launch(mode: "Preview", scheme: "light")
        app.buttons["More"].tap()
        XCTAssertTrue(app.buttons["About this build"].waitForExistence(timeout: 10))
        let link = app.descendants(matching: .any)["licences"]
        // A menu item that is tapped while the menu is still opening is sometimes not taken: tap again if the sheet has not come.
        for _ in 0..<3 {
            if app.buttons["About this build"].exists { app.buttons["About this build"].tap() }
            if link.waitForExistence(timeout: 4) { break }
        }
        XCTAssertTrue(link.exists, "About has the licences")
        link.tap()
        for (package, words) in [("GRDB.swift", "Permission is hereby granted"), ("swift-markdown", "Runtime Library Exception"), ("swift-cmark", "cmark")] {
            let row = app.descendants(matching: .any)["licence-\(package)"]
            XCTAssertTrue(row.waitForExistence(timeout: 10), "\(package) is listed")
            row.tap()
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", words)).firstMatch.waitForExistence(timeout: 10), "\(package)'s own text is shown")
            app.navigationBars.buttons["Open-source licences"].tap()
        }
    }

    func testTheAppearanceSheet() throws {
        try launch(mode: "Preview", scheme: "cream")
        app.buttons["More"].tap()
        app.buttons["Appearance…"].tap()
        XCTAssertTrue(app.buttons["scheme-forest"].waitForExistence(timeout: 10))
        // The audit is not steady on this sheet: which of its rows it says “will not grow” changes from run to run (a different scheme's name each time, or a picker's
        // label), although they are text in the system's text styles, and it names no element for some text it thinks should be one. Both are left out here, with
        // the screenshot kept; the largest text size is looked at in its own test and by hand.
        try audit("appearance sheet, cream") { issue in
            issue.auditType == .dynamicType || (issue.auditType == .elementDetection && issue.element == nil)
        }
    }
}
