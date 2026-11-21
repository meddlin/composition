import CompositionCore
import CompositionInk
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// What the rest of the screen can ask of the editor's text view: the Find button, and putting pictures in the note.
@MainActor
final class EditorHandle {
    fileprivate weak var textView: NoteTextView?
    /// Where the notes' images are kept, the title the images are named for, and where a problem is shown.
    var location: DataLocation?
    var noteTitle: () -> String = { "" }
    var problem: (String) -> Void = { _ in }
    /// The notes the picker after `[[` offers (the latest first), and this note, which it leaves out.
    var noteCandidates: () -> [NoteLinks.Candidate] = { [] }
    var noteID: Int64?
    /// Opens the list of images already stored (⌘⇧M, and the Image menu's *Stored Image…*): the screen owns the sheet.
    var openStoredImages: () -> Void = {}
    /// Whether the text view is the tab showing. Under the Preview tab it stays alive, hidden (so its undo survives), and takes nothing a caller can put at the
    /// end of the note instead.
    var isShowing: () -> Bool = { true }
    /// Follows a link of the Live tab (its ↗, and ⌘-tap): the screen's `LinkFollower`. False when there was nothing to follow.
    var followLink: (String) -> Bool = { _ in false }
    /// Whether a link's target is on this iPad: a `pdf:` link to a PDF that is not is drawn struck through, as the Preview draws it.
    var isLinkHere: (String) -> Bool = { _ in true }
    /// Opens the canvas on a stored drawing (a Pencil touch on an `<Ink />` the Live tab draws, `LivePencilOpen`): the screen owns the canvas.
    var editInk: (String) -> Void = { _ in }
    /// What keeps the Split tab's halves at the same place in the note: told each time the text view scrolls.
    weak var scrollSync: SplitScrollSync?

    func presentFind() { textView?.findInteraction?.presentFindNavigator(showingReplace: false) }

    /// The outline's tap (Outline.swift): the caret at the line at `offset`, scrolled to the top.
    func reveal(offset: Int) { textView?.reveal(offset: offset) }

    /// The Link button: a link to another note at the caret, or over the selected words.
    func linkToNote() {
        guard let view = textView else { return }
        view.becomeFirstResponder()
        view.assist?.openNoteLink()
    }

    /// Stores each picture and writes the Markdown that shows it at the caret (in place of the selection), as a paste does on the desktop; several go
    /// one to a paragraph. A picture that cannot be stored is reported and left out.
    func insertImages(_ images: [ImageInput]) {
        guard let location, textView != nil, !images.isEmpty else { return }
        let title = noteTitle()
        Task {
            var markdown: [String] = []
            var problems: [String] = []
            for image in images {
                let outcome: Result<String, StoreFailure> = await Task.detached(priority: .userInitiated) {
                    guard let prepared = ImageImport.prepare(image) else { return .failure(StoreFailure(message: "“\(image.fileName)” is not a picture Composition can store.")) }
                    switch StoredImages.store(noteTitle: title, fileName: prepared.fileName, data: prepared.data, in: location) {
                    case .stored(let name): return .success(StoredImages.markdown(forName: name, alt: (prepared.fileName as NSString).deletingPathExtension))
                    case .failed(let message): return .failure(StoreFailure(message: message))
                    }
                }.value
                switch outcome {
                case .success(let line): markdown.append(line)
                case .failure(let failure): problems.append(failure.message)
                }
            }
            write(paragraphs: markdown)
            if !problems.isEmpty { problem(problems.joined(separator: "\n")) }
        }
    }

    /// A block of Markdown (a quote from a PDF) as a paragraph of its own at the caret, never in the frontmatter. False when the note's editor is not
    /// showing (the Preview tab), so that the caller can put it at the end of the note instead.
    func insertBlock(_ markdown: String) -> Bool {
        // A text view that is not on screen (the note is behind the PDF, or in the Preview tab) takes nothing: the caller puts the Markdown at the end of the note.
        guard let view = textView, view.window != nil, isShowing() else { return false }
        write(paragraphs: [markdown])
        return true
    }

    /// A short piece of Markdown (a link to a page of a PDF) in the words around the caret; False when the editor is not showing.
    func insertInline(_ markdown: String) -> Bool {
        guard let view = textView, view.window != nil, isShowing() else { return false }
        view.becomeFirstResponder()
        let whole = view.nativeText as NSString
        let frontmatterEnd = whole.length - (NoteFrontmatter.parse(whole as String).body as NSString).length
        if view.selectedRange.location < frontmatterEnd { view.selectedRange = NSRange(location: frontmatterEnd, length: 0) }
        view.insertText(markdown)
        return true
    }

    /// Stores a drawing's PNG and writes the `<Ink>` tag that shows it at the caret, as a paragraph of its own, with the words read from the drawing as its `alt`
    /// (search finds the note by them; the transcript stays editable, C11).
    func insertInk(png: Data, alt: String) {
        guard let location, textView != nil else { return }
        let title = noteTitle()
        Task {
            let outcome = await Task.detached(priority: .userInitiated) { StoredImages.store(noteTitle: title, fileName: "drawing.png", data: png, in: location) }.value
            switch outcome {
            case .stored(let name): write(paragraphs: [InkTag.markdown(forName: name, alt: alt.isEmpty ? InkTag.defaultAlt : alt)])
            case .failed(let message): problem(message)
            }
        }
    }

    /// Writes each Markdown line at the caret (in place of the selection) as a paragraph of its own.
    private func write(paragraphs markdown: [String]) {
        guard let view = textView, !markdown.isEmpty else { return }
        view.becomeFirstResponder()
        // A picture is never put into the note's frontmatter (a note opens with the caret at the start, which is inside it): it goes just after it.
        let whole = view.nativeText as NSString
        let frontmatterEnd = whole.length - (NoteFrontmatter.parse(whole as String).body as NSString).length
        if view.selectedRange.location < frontmatterEnd { view.selectedRange = NSRange(location: frontmatterEnd, length: 0) }
        let selection = view.selectedRange
        // Each picture is a paragraph of its own: the preview draws a picture that stands alone, and shows only the alt text of one inside a line.
        func newlines(endingAt end: Int) -> Int {
            var count = 0
            while count < 2, end - count > 0, whole.character(at: end - count - 1) == 0x0A { count += 1 }
            return count
        }
        func newlines(startingAt start: Int) -> Int {
            var count = 0
            while count < 2, start + count < whole.length, whole.character(at: start + count) == 0x0A { count += 1 }
            return count
        }
        let atStart = selection.location == 0 || selection.location == frontmatterEnd
        let atEnd = selection.location + selection.length >= whole.length
        let before = atStart ? 2 : newlines(endingAt: selection.location)
        let after = atEnd ? 2 : newlines(startingAt: selection.location + selection.length)
        view.insertText(String(repeating: "\n", count: 2 - before) + markdown.joined(separator: "\n\n") + String(repeating: "\n", count: 2 - after))
    }

    /// The words selected in the note, which describe a picture put in their place (as on the desktop); none when the selection is in the frontmatter.
    var selectedWords: String {
        guard let view = textView else { return "" }
        let whole = view.nativeText as NSString
        let frontmatterEnd = whole.length - (NoteFrontmatter.parse(whole as String).body as NSString).length
        let selection = view.selectedRange
        guard selection.length > 0, selection.location >= frontmatterEnd, NSMaxRange(selection) <= whole.length else { return "" }
        return whole.substring(with: selection)
    }

    /// Writes the Markdown that shows an image that is already stored, at the caret (in place of the selected words, which become its description).
    func insertStoredImage(named name: String, description: String) {
        guard textView != nil, StoredImages.isImageName(name) else { return }
        write(paragraphs: [StoredImages.markdown(forName: name, alt: description)])
    }

    /// Turns the Markdown images at the caret (or every one the selection touches) into `<Image />` tags, which can say how wide to be: the caret is left
    /// inside the last tag, ready for ` width="50%"`. It goes in as typing does, so undo takes it back in one step.
    func convertImagesToTags() {
        guard let view = textView else { return }
        let selection = view.selectedRange
        guard let edit = MarkdownImages.toMdx(view.nativeText, selectionStart: selection.location, selectionEnd: selection.location + selection.length) else {
            problem("Put the caret in a Markdown image, ![alt](src), or select some, to turn them into <Image /> tags.")
            return
        }
        view.becomeFirstResponder()
        view.selectedRange = NSRange(location: edit.start, length: edit.end - edit.start)
        view.insertText(edit.text)
        view.selectedRange = NSRange(location: edit.start + edit.caret, length: 0)
    }
}

private struct StoreFailure: Error, Sendable { let message: String }

/// A text view whose text keeps to a readable width. Across a whole landscape iPad (1,210 points for an 11-inch) a line of Markdown would be well over a
/// hundred characters, which is hard to read and to write; the text stays about 85 characters wide and sits in the middle, and the empty margins
/// are still part of the view, so a tap or a scroll there works as it does anywhere else. In a narrower view (portrait, or half of Split) nothing changes.
final class NoteTextView: UITextView {
    static let readableWidth: CGFloat = 820
    private static let margin: CGFloat = 12

    /// Pictures pasted from the clipboard go here (set by the editor) instead of the text view's own paste, which has no use for them.
    var pastePictures: (([ImageInput]) -> Void)?
    /// ⌘⇧M: the list of images already stored.
    var showStoredImages: (() -> Void)?
    /// The list at the caret (`<`, `[[`, the highlight colours), which takes some keys while it is open.
    weak var assist: EditorAssist?
    /// The colour scheme and font in force, which the list at the caret is drawn in too.
    var look = Look.standard
    /// The width of the view changed (the Live tab lays its pictures out again).
    var onWidthChange: (() -> Void)?
    /// The ruler and reflow settings in force: a ruler is a faint vertical line at a column, drawn in the margin of the text (it scrolls with the text).
    var writing = WritingSettings() {
        didSet { if writing != oldValue { setNeedsLayout() } }
    }
    private var rulerView: UIView?
    /// True while the system's paste runs, so that what it types is not taken for typing (reflow leaves a paste as it is).
    private(set) var isPasting = false
    /// The Live tab is the one showing (set by `MarkdownStyler.setLive`): what the text view tells VoiceOver then leaves out what the look hides (`LiveAccessibility`).
    var isLive = false

    override var accessibilityAttributedValue: NSAttributedString? {
        get { (isLive ? LiveAccessibility.value(of: textStorage, mode: LiveAccessibility.mode) : nil) ?? super.accessibilityAttributedValue }
        set { super.accessibilityAttributedValue = newValue }
    }

    override var accessibilityValue: String? {
        get { isLive && LiveAccessibility.mode != .asItIs ? accessibilityAttributedValue?.string : super.accessibilityValue }
        set { super.accessibilityValue = newValue }
    }
    private var lastWidth: CGFloat = 0

    /// When the last touch on the text began: a tap on a block the Live tab draws as a picture (Step 5) puts the caret at the start of the block's source, which then shows
    /// (D3), as a tap on a drawn picture puts it in the picture's Markdown. UIKit's tap lands at the end of the block's first line (its hidden characters; it does not ask
    /// `closestPosition(to:)`, found in the Simulator), so the selection that follows a touch, when it is a caret in a block still drawn, is moved. The touch is noted in
    /// `hitTest`, which UIKit calls as every touch begins: a gesture recogniser added for it (tried) stopped ⌘A from selecting the note in the UI tests.
    private var lastTouch: TimeInterval?
    #if DEBUG || EDITOR_TEST_HOOKS
    /// Hears where each touch on the text view begins (the `live-scribble` probe, with `-liveReport 1`).
    var touched: ((CGPoint) -> Void)?
    #endif

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let found = super.hitTest(point, with: event)
        // TextKit 2 draws the text in views of its own inside the text view, which are what a touch on the text hits.
        if isLive, event?.type == .touches, let found, found.isDescendant(of: self) { lastTouch = CACurrentMediaTime() }
        #if DEBUG || EDITOR_TEST_HOOKS
        if event?.type == .touches { touched?(point) }
        #endif
        return found
    }

    /// The start of the block drawn as a picture that a touch a moment ago put the caret in; nil otherwise. The touch is used once.
    func blockStartForRecentTouch() -> Int? {
        guard isLive, let touched = lastTouch, CACurrentMediaTime() - touched < 0.8, selectedRange.length == 0 else { return nil }
        let caret = selectedRange.location
        for at in [caret, caret - 1] where at >= 0 && at < textStorage.length {
            guard let mark = textStorage.attribute(.liveBlock, at: at, effectiveRange: nil) as? LiveBlockMark, !mark.revealed else { continue }
            lastTouch = nil
            return caret == mark.source.location ? nil : mark.source.location
        }
        return nil
    }

    /// An edit the typing aids work out, put in as typing puts it, so that undo takes it back in one step.
    func apply(_ edit: LineEdit) {
        selectedRange = NSRange(location: edit.start, length: edit.end - edit.start)
        insertText(edit.text)
        selectedRange = NSRange(location: edit.selection.lowerBound, length: edit.selection.count)
    }

    // MARK: Hardware keyboard

    /// Tab and Shift+Tab, ⌃] and ⌃[ for indenting, ⌘B and ⌘I, ⌘⇧K for a note link and ⌘⇧H for a highlight: the desktop's keys. Each has a title, which
    /// is what holding ⌘ lists. Tab has priority over the system, which would otherwise move focus.
    override var keyCommands: [UIKeyCommand]? {
        #if DEBUG || EDITOR_TEST_HOOKS
        if UserDefaults.standard.bool(forKey: "liveCompose") { return (super.keyCommands ?? []) + Self.shortcuts + [Self.escape] + Self.compositionKeys }
        #endif
        return (super.keyCommands ?? []) + Self.shortcuts + [Self.escape]
    }

    #if DEBUG || EDITOR_TEST_HOOKS
    /// With `-liveCompose 1`, for the UI tests, which cannot start a composition (Scribble, dictation, an input method) any other way: ⌃⌥C puts marked text at the caret (each press
    /// makes it longer), and ⌃⌥E ends the composition as the system does when it takes the text.
    private static let compositionKeys: [UIKeyCommand] = {
        func key(_ input: String, _ action: Selector) -> UIKeyCommand {
            let command = UIKeyCommand(input: input, modifierFlags: [.control, .alternate], action: action)
            command.wantsPriorityOverSystemBehavior = true
            return command
        }
        return [key("c", #selector(composeMore)), key("e", #selector(endComposition))]
    }()

    @objc private func composeMore() {
        let word = (markedTextRange.flatMap { text(in: $0) } ?? "") + "ni"
        setMarkedText(word, selectedRange: NSRange(location: (word as NSString).length, length: 0))
    }

    @objc private func endComposition() { unmarkText() }
    #endif

    /// Escape closes an open list (and does nothing otherwise). It is a key command, the usual way to take Escape, as well as being read in `pressesBegan`;
    /// it has no title, so the ⌘-hold list leaves it out. The UI tests cannot send Escape (it never reaches the app), so it is a manual-test item.
    private static let escape: UIKeyCommand = {
        let command = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(escapePressed))
        command.wantsPriorityOverSystemBehavior = true
        return command
    }()

    @objc private func escapePressed() { assist?.dismiss() }

    private static let shortcuts: [UIKeyCommand] = {
        func key(_ input: String, _ modifiers: UIKeyModifierFlags, _ action: Selector, _ title: String) -> UIKeyCommand {
            let command = UIKeyCommand(input: input, modifierFlags: modifiers, action: action)
            command.discoverabilityTitle = title
            command.wantsPriorityOverSystemBehavior = true
            return command
        }
        return [
            key("\t", [], #selector(tabPressed), "Indent Selected Lines, or Type a Tab"),
            key("\t", .shift, #selector(shiftTabPressed), "Outdent Lines"),
            key("]", .control, #selector(indentLines), "Indent Lines"),
            key("[", .control, #selector(outdentLines), "Outdent Lines"),
            key("b", .command, #selector(makeBold), "Bold"),
            key("i", .command, #selector(makeItalic), "Italic"),
            key("k", [.command, .shift], #selector(linkToNote), "Link to a Note"),
            key("h", [.command, .shift], #selector(highlightSelection), "Highlight"),
            key("m", [.command, .shift], #selector(insertStoredImage), "Insert a Stored Image"),
        ]
    }()

    /// Tab takes the choice in an open list; over several lines it indents them; anywhere else it types a tab, for nested list items.
    @objc private func tabPressed() {
        if assist?.accept() == true { return }
        let range = selectedRange
        if (nativeText as NSString).substring(with: range).contains("\n") { indent(.indent) } else { insertText("\t") }
    }

    @objc private func shiftTabPressed() { indent(.outdent) }
    @objc private func indentLines() { indent(.indent) }
    @objc private func outdentLines() { indent(.outdent) }
    @objc private func makeBold() { emphasize(.bold) }
    @objc private func makeItalic() { emphasize(.italic) }
    @objc private func linkToNote() { assist?.openNoteLink() }
    @objc private func highlightSelection() { assist?.openColors() }
    @objc private func insertStoredImage() { showStoredImages?() }

    private func indent(_ command: IndentLines.Command) {
        let range = selectedRange
        if let edit = IndentLines.edit(nativeText, from: range.location, to: range.location + range.length, command: command) { apply(edit) }
    }

    private func emphasize(_ emphasis: EmphasisToggle) {
        let range = selectedRange
        if let edit = EmphasisToggle.toggle(nativeText, from: range.location, to: range.location + range.length, emphasis) { apply(edit) }
    }

    /// While the list is open it takes the arrows, Return and Escape (Tab is a key command above); the rest of the keys go on to the text.
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        guard let assist, assist.isOpen else { return super.pressesBegan(presses, with: event) }
        let rest = presses.filter { !assist.handle($0) }
        if !rest.isEmpty { super.pressesBegan(rest, with: event) }
    }

    override func paste(_ sender: Any?) {
        isPasting = true
        defer { isPasting = false }
        if let pastePictures, let pictures = ImageImport.fromPasteboard() {
            pastePictures(pictures)
        } else {
            super.paste(sender)
        }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(UIResponderStandardEditActions.paste(_:)), pastePictures != nil, UIPasteboard.general.hasImages, !UIPasteboard.general.hasStrings { return true }
        return super.canPerformAction(action, withSender: sender)
    }

    override func layoutSubviews() {
        let side = max(Self.margin, (bounds.width - Self.readableWidth) / 2)
        if abs(textContainerInset.left - side) > 0.5 {
            textContainerInset = UIEdgeInsets(top: 16, left: side, bottom: 16, right: side)
        }
        super.layoutSubviews()
        if abs(bounds.width - lastWidth) > 0.5 {
            lastWidth = bounds.width
            onWidthChange?()
        }
        updateRuler()
    }

    /// The ruler (the desktop's `rulerColumn` characters from the text's left edge): the width of a "0" in the editor's face, as CSS's `ch` is, times the
    /// column, from where the text starts. Off by default; when it is off there is no view at all.
    private func updateRuler() {
        guard writing.rulerEnabled else {
            rulerView?.removeFromSuperview()
            rulerView = nil
            return
        }
        let line: UIView
        if let existing = rulerView {
            line = existing
        } else {
            line = UIView()
            line.isUserInteractionEnabled = false
            line.isAccessibilityElement = false
            line.accessibilityIdentifier = "editor-ruler"
            insertSubview(line, at: 0)
            rulerView = line
        }
        let advance = ("0" as NSString).size(withAttributes: [.font: look.editorFont.uiFont(size: 16)]).width
        let x = textContainerInset.left + textContainer.lineFragmentPadding + CGFloat(writing.rulerColumn) * advance
        let thickness = 1 / max(traitCollection.displayScale, 1)
        line.frame = CGRect(x: x, y: 0, width: thickness, height: max(contentSize.height, bounds.height))
        line.backgroundColor = look.uiRulerGuide
        #if DEBUG || EDITOR_TEST_HOOKS
        // In a test build the line says where it is, for the UI tests; in a release build it is decoration and VoiceOver never sees it.
        line.isAccessibilityElement = true
        line.accessibilityLabel = String(format: "ruler x=%.1f column=%d", x, writing.rulerColumn)
        #endif
    }
}

/// The Markdown tab (build plan Step 6): a text view on TextKit 2, bound to a note's `NoteSession`. What is typed goes to the session at once and
/// the session saves it (Step 4); the Markdown is coloured as it is typed, a block at a time (Step 5); find is the system's. Two windows on one
/// note share the session, so a change made in the other window shows here. The typing aids (the list after `<`, the `[[` note picker, indenting,
/// bold and italic, highlighting) are `EditorAssist` and the keys of `NoteTextView` (Step 9); the colour schemes are Step 10.
struct NoteEditorView: UIViewRepresentable {
    let session: NoteSession
    let handle: EditorHandle
    /// Where the caret goes when the note opens, in UTF-16 units (the system restores it after the app was ended).
    let initialCaret: Int
    /// A note that was just made: the keyboard comes up at once.
    let focusOnOpen: Bool
    /// The Live tab: the same text view, drawn as the note will read, with the marks hidden away from the selection (`MarkdownStyler.setLive`).
    var live = false
    /// Under the Preview tab: the text view stays alive (its undo history with it) but is hidden, so that it is neither drawn, touched nor read by VoiceOver.
    var hidden = false
    let caretMoved: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(session: session, caretMoved: caretMoved) }

    func makeUIView(context: Context) -> UITextView {
        let view = NoteTextView(usingTextLayoutManager: true)
        view.isFindInteractionEnabled = true
        view.adjustsFontForContentSizeCategory = true
        view.autocapitalizationType = .none
        // Markdown and YAML are damaged by curly quotes and long dashes.
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.smartInsertDeleteType = .no
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        view.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 16, right: 12)
        let look = context.environment.look
        view.look = look
        view.backgroundColor = look.uiBackground
        view.font = look.editorFont.uiFont(size: 16)
        view.textColor = look.uiForeground
        view.tintColor = look.uiBrand
        view.accessibilityIdentifier = "note-editor"
        view.accessibilityLabel = "Note text"
        view.text = session.text
        view.selectedRange = NSRange(location: min(max(0, initialCaret), (view.text as NSString).length), length: 0)
        view.delegate = context.coordinator
        handle.textView = view
        view.pastePictures = { [weak handle] pictures in handle?.insertImages(pictures) }
        view.showStoredImages = { [weak handle] in handle?.openStoredImages() }
        view.addInteraction(UIDropInteraction(delegate: context.coordinator))
        context.coordinator.handle = handle
        let assist = EditorAssist(textView: view)
        assist.handle = handle
        view.assist = assist
        context.coordinator.assist = assist
        context.coordinator.attach(view, look: look, live: live)
        // The size of the text changed (Settings, Control Centre): the fonts in the colours are stale.
        view.registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { [weak coordinator = context.coordinator] (_: UITextView, _: UITraitCollection) in
            coordinator?.styler?.restyleAll()
        }
        if focusOnOpen { DispatchQueue.main.async { view.becomeFirstResponder() } }
        #if DEBUG || EDITOR_TEST_HOOKS
        // Developer shortcut for scripts: `-pasteImage /path/picture.png` puts that picture in the note as the Photos picker and a paste do.
        if let path = UserDefaults.standard.string(forKey: "pasteImage"), let data = FileManager.default.contents(atPath: path) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak handle] in handle?.insertImages([ImageInput(data: data, fileName: URL(fileURLWithPath: path).lastPathComponent)]) }
        }
        // Developer shortcut for scripts (apps/ios/scripts/autosave-kill-test.sh): `-autotype "text"` types it into the editor.
        if let text = UserDefaults.standard.string(forKey: "autotype") {
            context.coordinator.autotype(text, in: view, interval: UserDefaults.standard.double(forKey: "autotypeInterval"))
        }
        #endif
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.caretMoved = caretMoved
        // The Live tab came to the front, or left it: the same text view, drawn the other way (the caret, the keyboard and the text stay).
        context.coordinator.styler?.setLive(live)
        // Hidden under the Preview (out of the touches' and VoiceOver's reach; `accessibilityHidden` and `isAccessibilityElement` do not reach a representable's view),
        // on the next turn of the run loop and never inside SwiftUI's update: giving the keyboard up there (which hiding the view does too) makes the keyboard's
        // tracking ask SwiftUI to render inside that same update, a cycle that held the main thread (found by sampling the app while a UI test stalled).
        if view.isHidden != hidden {
            DispatchQueue.main.async { [weak view] in
                guard let view, view.isHidden != hidden else { return }
                if hidden { _ = view.resignFirstResponder() }
                view.isHidden = hidden
            }
        }
        // The colour scheme or the editor's font was changed in Settings: the view and every colour on the text are made again.
        let look = context.environment.look
        if let editor = view as? NoteTextView { editor.writing = context.environment.writing }
        context.coordinator.writing = context.environment.writing
        if let editor = view as? NoteTextView, editor.look != look {
            editor.look = look
            view.backgroundColor = look.uiBackground
            view.font = look.editorFont.uiFont(size: 16)
            view.textColor = look.uiForeground
            view.tintColor = look.uiBrand
            context.coordinator.styler?.apply(look)
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIDropInteractionDelegate {
        let session: NoteSession
        weak var handle: EditorHandle?
        var assist: EditorAssist?
        var caretMoved: (Int) -> Void
        /// The ruler and reflow settings in force.
        var writing = WritingSettings()
        /// How long the text was after the last change, to tell what the next one added (reflow reads a keystroke from that); and set while the break itself is being
        /// put in, which is not typing. (`UITextView.insertText` called from code does not ask `shouldChangeTextIn`, so what was typed is read after the change.)
        private var lastLength = 0
        private var breaking = false
        private(set) var styler: MarkdownStyler?
        private var taskTap: LiveTaskTap?
        /// The ↗ beside a link in the Live tab, and ⌘-tap on one.
        private var liveLinks: LiveLinks?
        /// Where Scribble may begin in the Live tab (not over what it draws), and the Pencil on a drawing (its canvas).
        private var scribble: LiveScribble?
        private var pencilOpen: LivePencilOpen?
        private weak var textView: UITextView?
        private var observation: NoteSession.Observation?

        init(session: NoteSession, caretMoved: @escaping (Int) -> Void) {
            self.session = session
            self.caretMoved = caretMoved
        }

        func attach(_ view: UITextView, look: Look, live: Bool) {
            textView = view
            lastLength = view.textStorage.length
            let styler = MarkdownStyler(textView: view, look: look)
            self.styler = styler
            styler.imageFolder = { [weak self] in self?.handle?.location?.imagesURL }
            // Links (Step 2 of docs/ipad-live-default-plan.md): a dead `pdf:` link drawn as the Preview draws it, the ↗ beside the link the selection is in, and ⌘-tap.
            styler.isLinkHere = { [weak self] in self?.handle?.isLinkHere($0) ?? true }
            let links = LiveLinks(textView: view)
            links.activeLink = { [weak styler] in styler?.activeLink() }
            links.follow = { [weak self] in self?.handle?.followLink($0) ?? false }
            links.tint = { [weak view] in ((view as? NoteTextView)?.look ?? .standard).uiLink }
            styler.afterApply = { [weak links] in links?.update() }
            liveLinks = links
            (view as? NoteTextView)?.onWidthChange = { [weak styler] in styler?.widthChanged() }
            if live { styler.setLive(true) } else { styler.reload() }
            // A tap on a task box the Live tab draws ticks it (Step 4 of docs/ipad-live-default-plan.md).
            taskTap = LiveTaskTap(textView: view, isLive: { [weak styler] in styler?.isLive ?? false }, drawnTask: { [weak styler] in styler?.drawnTask(at: $0) })
            // Scribble never begins over a picture or a block the Live tab draws (Gate LD1, item 344), and the Pencil on a drawing opens its canvas.
            if let editor = view as? NoteTextView {
                scribble = LiveScribble(textView: editor)
                let pencil = LivePencilOpen(textView: editor)
                pencil.open = { [weak self] name in self?.handle?.editInk(name) }
                pencilOpen = pencil
            }
            #if DEBUG || EDITOR_TEST_HOOKS
            // `-liveReport 1`: an element of the editor that says what the Live tab has made of the text (see `LiveReport`), for the UI tests to read.
            if UserDefaults.standard.bool(forKey: "liveReport") {
                let label = UILabel(frame: CGRect(x: 0, y: 0, width: 2, height: 2))
                label.isAccessibilityElement = true
                label.accessibilityIdentifier = "live-report"
                label.alpha = 0.02
                view.addSubview(label)
                reportLabel = label
                // `live-selection`: where the selection is and what surrounds it, and where the caret is drawn (see `selectionSummary`).
                let selection = UILabel(frame: CGRect(x: 0, y: 4, width: 2, height: 2))
                selection.isAccessibilityElement = true
                selection.accessibilityIdentifier = "live-selection"
                selection.alpha = 0.02
                view.addSubview(selection)
                selectionLabel = selection
                // `live-geometry`: where the first block drawn as a picture is in the window (`x,y,w,h`), for a test to tap on it.
                let geometry = UILabel(frame: CGRect(x: 0, y: 6, width: 2, height: 2))
                geometry.isAccessibilityElement = true
                geometry.accessibilityIdentifier = "live-geometry"
                geometry.alpha = 0.02
                view.addSubview(geometry)
                geometryLabel = geometry
                updateSelectionLabel()
                // `live-boxes`: the screen centres of the task boxes the Live tab draws, `x,y;x,y` (Step 4).
                let boxes = LiveProbe(frame: CGRect(x: 0, y: 6, width: 2, height: 2))
                boxes.isAccessibilityElement = true
                boxes.accessibilityIdentifier = "live-boxes"
                boxes.alpha = 0.02
                boxes.describe = { [weak self] in
                    (self?.taskTap?.boxCenters() ?? []).map { String(format: "%.0f,%.0f", $0.x, $0.y) }.joined(separator: ";")
                }
                view.addSubview(boxes)
                // `live-drawn`: the pictures and blocks the Live tab draws, `kind x,y,w,h top-bottom;…`, each picture's window frame and the band its room takes (`LiveDrawn`).
                let drawnItems = LiveProbe(frame: CGRect(x: 0, y: 8, width: 2, height: 2))
                drawnItems.isAccessibilityElement = true
                drawnItems.accessibilityIdentifier = "live-drawn"
                drawnItems.alpha = 0.02
                drawnItems.describe = { [weak view] in
                    guard let editor = view as? NoteTextView else { return "" }
                    return LiveDrawn.all(in: editor).map { item in
                        let picture = editor.convert(item.picture, to: nil), room = editor.convert(item.room, to: nil)
                        // `picture-ink`, `pictureAfter-drawio`, `block-table`, `blockAfter-frontmatter`, …
                        let block = item.drawing.block.flatMap { editor.textStorage.length > $0.source.location ? editor.textStorage.attribute(.liveBlock, at: $0.source.location, effectiveRange: nil) as? LiveBlockMark : nil }
                        let kind = item.drawing.kind.rawValue + (item.drawing.picture.map { "-\($0.kind)" } ?? block.map { "-\($0.kind)" } ?? "")
                        return String(format: "%@ %.0f,%.0f,%.0f,%.0f %.0f-%.0f", kind, picture.minX, picture.minY, picture.width, picture.height, room.minY, room.maxY)
                    }.joined(separator: ";")
                }
                view.addSubview(drawnItems)
                // `live-scribble`: whether Scribble could have begun where the last touch began, as the real delegate answers (`n=3 x,y yes`): the UI tests cannot write with a Pencil.
                let scribbleProbe = UILabel(frame: CGRect(x: 0, y: 10, width: 2, height: 2))
                scribbleProbe.isAccessibilityElement = true
                scribbleProbe.accessibilityIdentifier = "live-scribble"
                scribbleProbe.alpha = 0.02
                scribbleProbe.accessibilityLabel = "n=0"
                view.addSubview(scribbleProbe)
                var touches = 0
                (view as? NoteTextView)?.touched = { [weak self, weak view, weak scribbleProbe] point in
                    guard let self, let view, let scribble = self.scribble else { return }
                    touches += 1
                    let onScreen = view.convert(point, to: nil)
                    scribbleProbe?.accessibilityLabel = String(format: "n=%d %.0f,%.0f %@", touches, onScreen.x, onScreen.y, scribble.allows(at: point) ? "yes" : "no")
                }
                styler.didApply = { [weak self, weak styler, weak view] in
                    guard let self, let styler, let view else { return }
                    self.reportLabel?.accessibilityLabel = styler.isLive ? LiveReport.make(from: view.textStorage, bodySize: look.editorFont.uiFont(size: 16).pointSize) : "markdown"
                    self.updateGeometryLabel()
                }
            }
            // `-liveBench <file>`: measures the editor on the note that is open and writes the result to that file (see `LiveBench`). A file and not an element, so that nothing
            // asks the text view about itself (the accessibility tree reads the whole note) while it is being timed.
            if let file = UserDefaults.standard.string(forKey: "liveBench") {
                let opened = ContinuousClock.now
                Task { @MainActor [weak styler, weak view] in
                    guard let styler, let view else { return }
                    let result = await LiveBench.run(in: view, styler: styler, openedAt: opened)
                    try? result.write(toFile: file, atomically: true, encoding: .utf8)
                }
            }
            // `-liveBlockSpike <folder>`: renders every block of the note as the Live tab renders a block's picture and writes them there (Step 5's spike, `LiveBlockSpike`).
            if let folder = UserDefaults.standard.string(forKey: "liveBlockSpike") {
                Task { @MainActor [weak view, weak styler] in
                    try? await Task.sleep(for: .seconds(2))
                    guard let view, let styler else { return }
                    LiveBlockSpike.run(in: view, look: look, imageFolder: styler.imageFolder(), to: URL(fileURLWithPath: folder))
                }
            }
            // `-colourState 1`: an element that says how many full passes the colouring has started and whether it is settled, for the UI tests to see that it comes to rest on a long note.
            if UserDefaults.standard.bool(forKey: "colourState") {
                let label = UILabel(frame: CGRect(x: 0, y: 2, width: 2, height: 2))
                label.isAccessibilityElement = true
                label.accessibilityIdentifier = "colour-state"
                label.alpha = 0.02
                view.addSubview(label)
                Task { @MainActor [weak styler, weak label] in
                    while let styler, let label {
                        label.accessibilityLabel = "passes=\(styler.passesStarted) settled=\(styler.isSettled ? "yes" : "no")"
                        try? await Task.sleep(for: .milliseconds(200))
                    }
                }
            }
            #endif
            // Hears every edit of this note, this window's too, which it recognises by the text being the same.
            observation = session.observe { [weak self] text in
                if Thread.isMainThread {
                    MainActor.assumeIsolated { self?.show(text) }
                } else {
                    DispatchQueue.main.async { self?.show(text) }
                }
            }
        }

        /// Another window, or something outside this text view (a drawing edited from the Preview, a quote put at the end of the note while the Preview shows), changed
        /// the note: show its text, keeping the caret near where it was. The text view's undo steps were made against the old text, so they are dropped (D7).
        @MainActor
        private func show(_ text: String) {
            guard let view = textView, view.nativeText != text else { return }
            let selection = view.selectedRange
            view.text = text
            view.undoManager?.removeAllActions()
            lastLength = view.textStorage.length
            view.selectedRange = NSRange(location: min(selection.location, (text as NSString).length), length: 0)
            styler?.reload()
        }

        func textViewDidChange(_ textView: UITextView) {
            defer { lastLength = textView.textStorage.length }
            if writing.reflowEnabled { breakTypedLine(textView) }
            #if DEBUG || EDITOR_TEST_HOOKS
            let started = ContinuousClock.now
            defer { delegateMilliseconds.append(Double((ContinuousClock.now - started).components.attoseconds) / 1e15) }
            #endif
            #if DEBUG || EDITOR_TEST_HOOKS
            let t0 = ContinuousClock.now
            let text = textView.nativeText
            let t1 = ContinuousClock.now
            session.edit(text, from: observation)
            let t2 = ContinuousClock.now
            styler?.textDidChange()
            let t3 = ContinuousClock.now
            func ms(_ d: Duration) -> Double { Double(d.components.attoseconds) / 1e15 }
            partMilliseconds.append((ms(t1 - t0), ms(t2 - t1), ms(t3 - t2)))
            #else
            session.edit(textView.nativeText, from: observation)
            styler?.textDidChange()
            #endif
            assist?.textChanged()
            #if DEBUG || EDITOR_TEST_HOOKS
            updateSelectionLabel()
            #endif
        }

        /// On the software keyboard Return is typed text; with a list open it takes the highlighted choice instead (a hardware Return the list takes first).
        /// Otherwise Return continues a Markdown list or quote, and Backspace just after an item's marker takes the marker away, as the desktop's
        /// Markdown keys do (`ListContinuation`, Step 4 of docs/ipad-live-default-plan.md): in both tabs, since the text is the same Markdown in each.
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            if text == "\n" && assist?.accept() == true { return false }
            guard let view = textView as? NoteTextView, let edit = listEdit(view, range: range, replacement: text) else { return true }
            view.apply(edit)
            return false
        }

        /// What Return or Backspace does to a list or a quote at the caret, or nil when the key should do what it always does: not over a selection, not
        /// while an input method is composing (its text is not settled), and for Backspace only when it takes the one character before the caret (not a
        /// word, a line or a selection).
        private func listEdit(_ view: NoteTextView, range: NSRange, replacement: String) -> LineEdit? {
            let selection = view.selectedRange
            guard selection.length == 0, view.markedTextRange == nil, !view.isPasting else { return nil }
            if let undo = view.undoManager, undo.isUndoing || undo.isRedoing { return nil }
            if replacement == "\n", range.length == 0, range.location == selection.location {
                return ListContinuation.newline(view.nativeText, at: selection.location)
            }
            if replacement.isEmpty, range.length > 0, NSMaxRange(range) == selection.location {
                let text = view.nativeText
                guard range == (text as NSString).rangeOfComposedCharacterSequence(at: range.location) else { return nil }
                return ListContinuation.deleteBackward(text, at: selection.location)
            }
            return nil
        }

        /// A line the keystroke pushed past the column is broken at the last space before it (`LiveReflow`, the desktop's `reflowAtCaret` behind it), and the caret
        /// stays after what was typed. Typing is a change that added a few characters ending at the caret, with no line break among them: not a deletion, a return, a
        /// paste, an undo or a redo, or the text of a drop or of dictation (a paragraph, which is long); and not while an input method is composing (a Japanese keyboard's
        /// marked text), where the text is left alone until it ends. The break goes in as typing goes in, a moment after the character, in the same turn of the run loop,
        /// which should make one undo take the character and the break back together (not verified: manual-test item 180).
        private func breakTypedLine(_ view: UITextView) {
            let added = view.textStorage.length - lastLength
            let caret = view.selectedRange.location
            guard !breaking, added > 0, added <= 64, caret >= added, view.selectedRange.length == 0, view.markedTextRange == nil, assist?.isOpen != true else { return }
            if (view as? NoteTextView)?.isPasting == true { return }
            if let undo = view.undoManager, undo.isUndoing || undo.isRedoing { return }
            let text = view.nativeText
            let typed = (text as NSString).substring(with: NSRange(location: caret - added, length: added))
            guard let edit = LiveReflow.edit(typed: typed, into: text, caret: caret, event: .typing, options: writing.reflowOptions) else { return }
            let span = ReflowText.changedSpan(before: text, after: edit.text)
            breaking = true
            defer { breaking = false }
            view.selectedRange = NSRange(location: span.start, length: span.end - span.start)
            view.insertText(span.insert)
            view.selectedRange = NSRange(location: edit.caret, length: 0)
        }

        /// A Highlight submenu in the edit menu over a selection, or inside a highlight.
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let highlight = assist?.highlightMenu(for: range) else { return nil }
            return UIMenu(children: [highlight] + suggestedActions)
        }

        // MARK: Pictures dropped on the text

        func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
            session.hasItemsConforming(toTypeIdentifiers: [UTType.image.identifier]) && !session.hasItemsConforming(toTypeIdentifiers: [UTType.text.identifier])
        }

        func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal { UIDropProposal(operation: .copy) }

        func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
            guard let view = textView else { return }
            // The picture goes where it was dropped.
            if let position = view.closestPosition(to: session.location(in: view)) { view.selectedTextRange = view.textRange(from: position, to: position) }
            let providers = session.items.map(\.itemProvider)
            Task { @MainActor [weak self] in
                var pictures: [ImageInput] = []
                for provider in providers {
                    let data: Data? = await withCheckedContinuation { continuation in
                        _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in continuation.resume(returning: data) }
                    }
                    if let data { pictures.append(ImageInput(data: data, fileName: provider.suggestedName ?? "image")) }
                }
                self?.handle?.insertImages(pictures)
            }
        }

        #if DEBUG || EDITOR_TEST_HOOKS
        fileprivate var reportLabel: UILabel?
        fileprivate var selectionLabel: UILabel?
        fileprivate var geometryLabel: UILabel?

        /// The window frame of the first paragraph drawing a block's picture (Step 5), or `none`.
        fileprivate func updateGeometryLabel() {
            guard let view = textView, let label = geometryLabel, let layout = view.textLayoutManager, let content = layout.textContentManager else { return }
            var found: Int?
            view.textStorage.enumerateAttribute(.liveDraw, in: NSRange(location: 0, length: view.textStorage.length)) { value, range, stop in
                // The frontmatter's header (Step 7) is left out: the first block drawn in the note's body.
                let block = view.textStorage.attribute(.liveBlock, at: range.location, effectiveRange: nil) as? LiveBlockMark
                if let drawing = value as? LiveDrawing, drawing.kind == .block, block?.kind != LiveBlockKinds.frontmatter { found = range.location; stop.pointee = true }
            }
            guard let offset = found, let location = content.location(content.documentRange.location, offsetBy: offset),
                let fragment = layout.textLayoutFragment(for: location)
            else { return label.accessibilityLabel = "none" }
            let frame = fragment.layoutFragmentFrame.offsetBy(dx: view.textContainerInset.left, dy: view.textContainerInset.top)
            let onScreen = view.convert(frame, to: nil)
            label.accessibilityLabel = "\(Int(onScreen.minX)),\(Int(onScreen.minY)),\(Int(onScreen.width)),\(Int(onScreen.height))"
        }

        /// `12+0 x=104.5 y=68 sx=315.5 sy=190 «text before|text after»`: where the selection is, where the caret (the selection's moving end) is drawn, in the text and on the
        /// screen (`sx`, `sy`), and what surrounds it, line breaks shown as ⏎. A key press that leaves x and y where they were moved the caret across something that cannot be seen.
        fileprivate func updateSelectionLabel() {
            guard let view = textView, let label = selectionLabel else { return }
            let whole = view.nativeText as NSString
            let range = view.selectedRange
            guard range.location >= 0, NSMaxRange(range) <= whole.length else { return label.accessibilityLabel = "\(range.location)+\(range.length)" }
            let before = NSRange(location: max(range.location - 14, 0), length: range.location - max(range.location - 14, 0))
            let after = NSRange(location: NSMaxRange(range), length: min(14, whole.length - NSMaxRange(range)))
            let marker = range.length == 0 ? "|" : "⟦\(whole.substring(with: range))⟧"
            let rect = view.selectedTextRange.map { view.caretRect(for: $0.end) } ?? .zero
            let onScreen = view.convert(rect, to: nil)
            let summary = String(format: "%d+%d x=%.1f y=%.0f sx=%.1f sy=%.0f «%@%@%@»", range.location, range.length, rect.minX, rect.minY, onScreen.minX, onScreen.minY, whole.substring(with: before), marker, whole.substring(with: after))
            label.accessibilityLabel = summary.replacingOccurrences(of: "\n", with: "⏎")
        }

        /// How long the whole `textViewDidChange` took each time (the session's part and the colouring's), for the speed test.
        private var delegateMilliseconds: [Double] = []
        private var partMilliseconds: [(text: Double, session: Double, styler: Double)] = []
        #endif

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            styler?.scrolled()
            if let editor = scrollView as? NoteTextView { handle?.scrollSync?.editorScrolled(editor) }
            #if DEBUG || EDITOR_TEST_HOOKS
            updateGeometryLabel()
            #endif
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            // A tap on a block drawn as a picture: the caret to the start of its source (setting it comes back here, and goes on as usual).
            if let editor = textView as? NoteTextView, let start = editor.blockStartForRecentTouch() {
                textView.selectedRange = NSRange(location: start, length: 0)
                return
            }
            caretMoved(textView.selectedRange.location)
            assist?.selectionChanged()
            styler?.selectionChanged()
            liveLinks?.update()
            #if DEBUG || EDITOR_TEST_HOOKS
            updateSelectionLabel()
            #endif
        }

        /// The frontmatter's header gives way to its YAML when the note is written in (Step 7, D5).
        func textViewDidBeginEditing(_ textView: UITextView) {
            styler?.focusChanged()
        }

        /// Leaving the field is a good moment to write: it is cheap, and the keyboard going away often means the app is too.
        func textViewDidEndEditing(_ textView: UITextView) {
            session.autosaver.flush()
            assist?.focusLost()
            styler?.focusChanged()
        }

        #if DEBUG || EDITOR_TEST_HOOKS
        /// Inserts `text` at the end of the note one character at a time, as the keyboard does (`insertText` calls the delegate), and leaves
        /// marker files in the app's tmp folder for the script that is watching: `autotype.progress` (characters so far), `autotype.done`, and
        /// `autotype.stats`, what the colouring measured.
        @MainActor
        func autotype(_ text: String, in view: UITextView, interval: Double) {
            let characters = Array(text)
            let step = interval > 0 ? interval : 0.02
            Task { @MainActor in
                for name in ["autotype.progress", "autotype.done", "autotype.stats"] { try? FileManager.default.removeItem(atPath: NSTemporaryDirectory() + name) }
                try? await Task.sleep(for: .seconds(1))  // the note is on screen and has the keyboard by now
                view.becomeFirstResponder()
                let whole = view.text as NSString
                // At the end of the note, or (`-autotypeMiddle 1`) at the start of a paragraph in the middle of it.
                let at = UserDefaults.standard.bool(forKey: "autotypeMiddle") ? whole.paragraphRange(for: NSRange(location: whole.length / 2, length: 0)).location : whole.length
                view.selectedRange = NSRange(location: at, length: 0)
                for (index, character) in characters.enumerated() {
                    view.insertText(String(character))
                    Self.marker("autotype.progress", "\(index + 1)")
                    try? await Task.sleep(for: .seconds(step))
                }
                Self.marker("autotype.done", "\(characters.count)")
                if let styler {
                    let m = styler.measurements, sorted = m.editMilliseconds.sorted()
                    let delegate = delegateMilliseconds.sorted()
                    let stats = "quick \(m.quickEdits) fallback \(m.fallbackEdits) corrections \(m.corrections) colouring-median \(sorted.isEmpty ? 0 : sorted[sorted.count / 2]) colouring-worst \(sorted.last ?? 0) delegate-median \(delegate.isEmpty ? 0 : delegate[delegate.count / 2]) delegate-p95 \(delegate.isEmpty ? 0 : delegate[delegate.count * 95 / 100]) delegate-worst \(delegate.last ?? 0) fullRead \(m.fullReadMilliseconds) worstStep \(m.worstStepMilliseconds)"
                    func median(_ values: [Double]) -> Double { values.sorted()[values.count / 2] }
                    let parts = partMilliseconds.isEmpty ? "" : " | text \(median(partMilliseconds.map(\.text))) session.edit \(median(partMilliseconds.map(\.session))) styler \(median(partMilliseconds.map(\.styler)))"
                    Self.marker("autotype.stats", stats + parts)
                }
            }
        }

        private static func marker(_ name: String, _ content: String) {
            try? content.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name), atomically: true, encoding: .utf8)
        }
        #endif
    }
}

