import CompositionCore
import UIKit

/// The editor's typing aids (build plan Step 9): the list under the caret after a `<` (the components, then a tag's props and their values), on an empty
/// line of the frontmatter and after a `/`; the note picker after `[[`; and the colours for highlighting a selection with `<Mark>`. What each offers and
/// what a choice writes is the desktop's, ported in CompositionCore/Editing and checked against the desktop's own code; this is the part that shows
/// the list and takes the keys. The text view keeps the keyboard the whole time, and the list is a view inside it, which scrolls with the text.
@MainActor
final class EditorAssist {
    /// One line of the list.
    struct Row {
        var title: String
        var detail: String? = nil
        var swatch: UIColor? = nil
        var monospaced = false
        /// The number key that picks it (the colours'), shown at the right.
        var key: String? = nil
    }

    private enum Offer {
        /// After a `<`, on an empty line of the frontmatter, or after a `/`: what the desktop's list offers.
        case completion(CompletionTarget)
        /// Notes to link to, replacing `start..<end`. `label` is the words the link shows (the selected ones), the note's title when nil.
        case notes(start: Int, end: Int, label: String?, candidates: [NoteLinks.Candidate])
        /// The colours to highlight `range` with, and taking a highlight off it.
        case colors(range: NSRange, canRemove: Bool)
    }

    weak var handle: EditorHandle?
    private weak var textView: NoteTextView?
    private var offer: Offer?
    private var rows: [Row] = []
    private var selected = 0
    private var first = 0
    /// Where the list the user waved away with Escape began: it stays away until they start another.
    private var dismissed: Int?
    private var shownKey = ""
    /// A list a shortcut opened over a selection lasts only while the selection and the text stay as they were.
    private var pinned: (range: NSRange, changes: Int)?
    private var changes = 0
    private var scheduled = false
    private let list = AssistListView()
    /// The colour the highlight list starts on: shared by every note, kept until the app ends (the desktop's `lastHighlightColor`).
    private static var lastColor = MarkHighlight.defaultColor

    init(textView: NoteTextView) {
        self.textView = textView
        list.onPick = { [weak self] index in self?.accept(index) }
    }

    var isOpen: Bool { offer != nil }

    // MARK: What the text view tells it

    /// The text changed (typed, pasted, a choice made).
    func textChanged() {
        changes += 1
        scheduleUpdate()
    }

    func selectionChanged() { scheduleUpdate() }

    func focusLost() { hide() }

    /// Once for a burst: typing changes the selection and the text together.
    private func scheduleUpdate() {
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.scheduled = false
            self?.recompute()
        }
    }

    private func recompute() {
        guard let view = textView, view.isFirstResponder, view.markedTextRange == nil else { return hide() }
        let range = view.selectedRange
        if let pin = pinned {
            if range == pin.range, changes == pin.changes { present() } else { hide() }
            return
        }
        guard range.length == 0 else { return hide() }
        let text = view.nativeText
        let caret = range.location
        // Notes after a `[[` first: what follows can look like the start of a tag.
        if let link = NoteLinks.findTrigger(text, caret: caret) {
            let found = NoteLinks.match(handle?.noteCandidates() ?? [], query: link.query, excluding: handle?.noteID)
            show(found.isEmpty ? nil : .notes(start: link.start, end: caret, label: nil, candidates: found), start: link.start, query: link.query)
        } else if let target = MdxCompletions.target(text, caret: caret), !target.items.isEmpty {
            show(.completion(target), start: target.start, query: target.query)
        } else {
            dismissed = nil
            hide()
        }
    }

    private func show(_ new: Offer?, start: Int, query: String) {
        guard let new, start != dismissed else { return hide() }
        // Another list, or more typed: back to the top.
        let key = "\(start):\(query)"
        if key != shownKey {
            selected = 0
            first = 0
            shownKey = key
        }
        offer = new
        present()
    }

    // MARK: Showing it

    private func present() {
        guard let view = textView, let offer else { return }
        let label: String
        let anchor: Int
        switch offer {
        case .completion(let target):
            rows = target.items.map { Row(title: $0.label ?? "<\($0.name)>", detail: $0.description, monospaced: true) }
            label = target.label
            anchor = target.start
        case .notes(let start, _, _, let candidates):
            rows = candidates.map { Row(title: Self.shownTitle($0.title)) }
            label = "Notes"
            anchor = start
        case .colors(let range, let canRemove):
            rows = MarkHighlight.colors.enumerated().map { Row(title: $1.capitalized, swatch: Self.uiColor($1), key: String($0 + 1)) }
            if canRemove { rows.append(Row(title: "Remove highlight", key: "0")) }
            label = "Highlight colour"
            anchor = range.location + range.length
        }
        guard !rows.isEmpty, let position = view.position(from: view.beginningOfDocument, offset: anchor) else { return hide() }
        selected = max(0, min(selected, rows.count - 1))
        if selected < first { first = selected } else if selected >= first + AssistListView.maxRows { first = selected - AssistListView.maxRows + 1 }
        first = max(0, min(first, rows.count - AssistListView.maxRows))
        list.show(rows: rows, selected: selected, first: first, label: label, near: view.caretRect(for: position), in: view, look: view.look)
    }

    private func hide() {
        offer = nil
        pinned = nil
        rows = []
        list.removeFromSuperview()
    }

    private static func shownTitle(_ title: String) -> String {
        title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled" : title
    }

    private static func uiColor(_ name: String) -> UIColor {
        switch name {
        case "yellow": .systemYellow
        case "green": .systemGreen
        case "blue": .systemBlue
        case "pink": .systemPink
        case "orange": .systemOrange
        default: .systemGray
        }
    }

    // MARK: Choosing

    func move(_ step: Int) {
        guard !rows.isEmpty else { return }
        selected = (selected + step + rows.count) % rows.count
        present()
    }

    /// Writes the highlighted choice (or the one tapped) into the note. False when no list is open.
    @discardableResult
    func accept(_ index: Int? = nil) -> Bool {
        guard let offer, let view = textView else { return false }
        let at = index ?? selected
        switch offer {
        case .completion(let target):
            guard target.items.indices.contains(at) else { return false }
            let expanded = MdxCompletions.expand(target.items[at])
            hide()
            dismissed = nil
            replace(NSRange(location: target.start, length: target.end - target.start), with: expanded.text,
                    caretAt: target.start + (expanded.caret < 0 ? (expanded.text as NSString).length : expanded.caret), in: view)
        case .notes(let start, let end, let label, let candidates):
            guard candidates.indices.contains(at) else { return false }
            let link = NoteLinks.link(to: candidates[at], label: label)
            hide()
            dismissed = nil
            replace(NSRange(location: start, length: end - start), with: link, caretAt: start + (link as NSString).length, in: view)
        case .colors(let range, _):
            guard rows.indices.contains(at) else { return false }
            hide()
            if at < MarkHighlight.colors.count { highlight(MarkHighlight.colors[at], range: range) } else { removeHighlight(range: range) }
        }
        return true
    }

    /// Escape: the list goes away and stays away until another starts.
    func dismiss() {
        if case .colors = offer {} else if let start = currentStart { dismissed = start }
        hide()
    }

    private var currentStart: Int? {
        switch offer {
        case .completion(let target): target.start
        case .notes(let start, _, _, _): start
        default: nil
        }
    }

    /// One edit, as typing makes it: undo takes it back in one step, and the caret lands where the choice says.
    private func replace(_ range: NSRange, with text: String, caretAt: Int, in view: NoteTextView) {
        view.selectedRange = range
        view.insertText(text)
        view.selectedRange = NSRange(location: caretAt, length: 0)
    }

    // MARK: Keys

    /// The keys the open list takes (and the number keys of the colours); everything else goes on to the text. True when the press was used.
    func handle(_ press: UIPress) -> Bool {
        guard isOpen, let key = press.key, key.modifierFlags.subtracting(.alphaShift).isEmpty else { return false }
        switch key.keyCode {
        case .keyboardDownArrow: move(1)
        case .keyboardUpArrow: move(-1)
        case .keyboardReturnOrEnter, .keypadEnter: accept()
        case .keyboardEscape: dismiss()
        default:
            guard case .colors = offer, let row = rows.firstIndex(where: { $0.key == key.charactersIgnoringModifiers }) else { return false }
            accept(row)
        }
        return true
    }

    // MARK: Opened by a shortcut or a menu

    /// Links to a note from the caret or over the selected words, which then become the link's text. With only a caret it types the `[[` for you, so
    /// the picker is the one a typed `[[` opens and what is typed after it narrows the notes.
    func openNoteLink() {
        guard let view = textView else { return }
        if case .notes = offer, pinned != nil { return hide() }
        let range = view.selectedRange
        if range.length == 0 {
            view.insertText("[[")
            return
        }
        let label = (view.nativeText as NSString).substring(with: range)
        let candidates = handle?.noteCandidates() ?? []
        // The notes named like the words, or all of them when none is.
        var found = NoteLinks.match(candidates, query: label, excluding: handle?.noteID)
        if found.isEmpty { found = NoteLinks.match(candidates, query: "", excluding: handle?.noteID) }
        guard !found.isEmpty else { return }
        offer = .notes(start: range.location, end: range.location + range.length, label: label, candidates: found)
        selected = 0
        first = 0
        pinned = (range, changes)
        present()
    }

    /// The colour list for the selection, starting on the colour used last. With only a caret it opens inside an existing highlight, to recolour or
    /// remove it, and does nothing anywhere else.
    func openColors() {
        guard let view = textView else { return }
        if case .colors = offer { return hide() }
        let range = view.selectedRange
        let canRemove = MarkHighlight.existing(in: view.nativeText, range: range.location..<range.location + range.length) != nil
        guard range.length > 0 || canRemove else { return }
        offer = .colors(range: range, canRemove: canRemove)
        selected = MarkHighlight.colors.firstIndex(of: Self.lastColor) ?? 0
        first = 0
        pinned = (range, changes)
        present()
    }

    // MARK: Highlighting

    func highlight(_ color: String, range: NSRange) {
        guard let view = textView else { return }
        Self.lastColor = color
        switch MarkHighlight.highlight(view.nativeText, range: range.location..<range.location + range.length, color: color) {
        case .success(let edit): view.apply(edit)
        case .failure(let refusal): handle?.problem(refusal.localizedDescription)
        }
    }

    func removeHighlight(range: NSRange) {
        guard let view = textView else { return }
        if let edit = MarkHighlight.remove(view.nativeText, range: range.location..<range.location + range.length) {
            view.apply(edit)
        } else {
            handle?.problem("There is no highlight here to take off.")
        }
    }

    /// The Highlight submenu of the edit menu (over a selection, or in a highlight), nil elsewhere.
    func highlightMenu(for range: NSRange) -> UIMenu? {
        guard let view = textView else { return nil }
        let existing = MarkHighlight.existing(in: view.nativeText, range: range.location..<range.location + range.length) != nil
        guard range.length > 0 || existing else { return nil }
        var actions: [UIMenuElement] = MarkHighlight.colors.map { color in
            UIAction(title: color.capitalized, image: UIImage(systemName: "circle.fill")?.withTintColor(Self.uiColor(color), renderingMode: .alwaysOriginal)) { [weak self] _ in
                self?.highlight(color, range: range)
            }
        }
        if existing {
            actions.append(UIAction(title: "Remove Highlight", image: UIImage(systemName: "xmark.circle"), attributes: .destructive) { [weak self] _ in self?.removeHighlight(range: range) })
        }
        return UIMenu(title: "Highlight", image: UIImage(systemName: "highlighter"), children: actions)
    }
}

// MARK: - The list

/// Up to six lines in a rounded box, under the caret (above it when there is no room), the highlighted one tinted. The text view keeps the keyboard:
/// the lines are plain controls, which do not take it.
final class AssistListView: UIView {
    static let maxRows = 6
    private static let width: CGFloat = 360

    var onPick: ((Int) -> Void)?
    private let stack = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .secondarySystemBackground
        layer.cornerRadius = 10
        layer.borderWidth = 1
        layer.borderColor = UIColor.separator.cgColor
        layer.shadowOpacity = 0.15
        layer.shadowRadius = 8
        stack.axis = .vertical
        addSubview(stack)
        accessibilityIdentifier = "assist-list"
        accessibilityViewIsModal = false
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(rows: [EditorAssist.Row], selected: Int, first: Int, label: String, near caret: CGRect, in textView: UITextView, look: Look) {
        backgroundColor = look.theme.surface.uiColor
        layer.borderColor = look.theme.foreground.uiColor(alpha: Theme.Share.border * 2).cgColor
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let visible = rows.indices.dropFirst(first).prefix(Self.maxRows)
        for index in visible {
            let line = AssistRowView(rows[index], selected: index == selected, look: look)
            line.accessibilityIdentifier = "assist-row-\(index)"
            line.addAction(UIAction { [weak self] _ in self?.onPick?(index) }, for: .touchUpInside)
            stack.addArrangedSubview(line)
        }
        accessibilityLabel = label
        let width = min(Self.width, textView.bounds.width - 16)
        // The stack is sized by hand, so that measuring it depends on nothing but its lines (pinned to this view, it took the height of the list before).
        let inner = stack.systemLayoutSizeFitting(CGSize(width: width - 8, height: UIView.layoutFittingCompressedSize.height), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
        stack.frame = CGRect(x: 4, y: 4, width: width - 8, height: inner.height)
        let height = inner.height + 8
        // Under the caret, or above it when that would run off the bottom of the visible text.
        let visibleBottom = textView.contentOffset.y + textView.bounds.height - textView.adjustedContentInset.bottom
        let below = caret.maxY + 4
        let y = below + height > visibleBottom ? max(caret.minY - height - 4, textView.contentOffset.y) : below
        let x = max(8, min(caret.minX, textView.bounds.width - width - 8))
        frame = CGRect(x: x, y: y, width: width, height: height)
        if superview !== textView { textView.addSubview(self) }
        textView.bringSubviewToFront(self)
        layoutIfNeeded()
    }
}

private final class AssistRowView: UIControl {
    private let resting: UIColor

    private let pressed: UIColor

    init(_ row: EditorAssist.Row, selected: Bool, look: Look) {
        resting = selected ? look.uiBrand.withAlphaComponent(0.25) : .clear
        pressed = look.uiBrand.withAlphaComponent(0.4)
        super.init(frame: .zero)
        layer.cornerRadius = 7
        backgroundColor = resting

        let title = UILabel()
        title.text = row.title
        title.font = row.monospaced ? UIFontMetrics(forTextStyle: .callout).scaledFont(for: .monospacedSystemFont(ofSize: 15, weight: .medium)) : .preferredFont(forTextStyle: .body)
        title.adjustsFontForContentSizeCategory = true
        title.textColor = look.uiForeground
        let text = UIStackView(arrangedSubviews: [title])
        text.axis = .vertical
        text.spacing = 1
        if let detail = row.detail {
            let label = UILabel()
            label.text = detail
            label.font = .preferredFont(forTextStyle: .caption1)
            label.adjustsFontForContentSizeCategory = true
            label.textColor = look.theme.foreground.uiColor(alpha: Theme.Share.mutedForeground)
            label.numberOfLines = 2
            text.addArrangedSubview(label)
        }

        let line = UIStackView()
        line.axis = .horizontal
        line.alignment = .center
        line.spacing = 10
        line.isUserInteractionEnabled = false
        if let swatch = row.swatch {
            let dot = UIView()
            dot.backgroundColor = swatch
            dot.layer.cornerRadius = 7
            dot.widthAnchor.constraint(equalToConstant: 14).isActive = true
            dot.heightAnchor.constraint(equalToConstant: 14).isActive = true
            line.addArrangedSubview(dot)
        }
        line.addArrangedSubview(text)
        if let key = row.key {
            let hint = UILabel()
            hint.text = key
            hint.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
            hint.textColor = look.theme.foreground.uiColor(alpha: Theme.Share.mutedForeground * 0.7)
            hint.setContentHuggingPriority(.required, for: .horizontal)
            line.addArrangedSubview(hint)
        }
        addSubview(line)
        line.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            line.topAnchor.constraint(equalTo: topAnchor, constant: 6), line.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
            line.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10), line.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
        ])
        isAccessibilityElement = true
        accessibilityLabel = [row.title, row.detail].compactMap { $0 }.joined(separator: ", ")
        accessibilityTraits = selected ? [.button, .selected] : .button
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isHighlighted: Bool {
        didSet { backgroundColor = isHighlighted ? pressed : resting }
    }
}
