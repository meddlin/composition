import CompositionCore
import PencilKit
import SwiftUI
import UIKit

// Spike S3 (docs/ipad-app-design.md, "The editor"): a `UITextView` on TextKit 2 with Markdown colours as attributes, and the
// experiments the design left open: find, a completion list at the caret, views inside the text (an image, a PencilKit canvas, a
// SwiftUI panel), hiding the syntax away from the caret, and a 5,000-line note. Nothing here is saved: it is a lab, reached from the
// More menu, and not the editor the app will have.

/// How the Live tab's hiding of Markdown syntax is tried.
enum HideMode: String, CaseIterable, Identifiable {
    case off = "Show marks"
    /// The syntax characters get a clear colour and a tiny font, except in the paragraph with the caret.
    case attributes = "Hide: tiny and clear"
    /// The text content storage hands TextKit a paragraph with the syntax left out (the characters then differ from the store's).
    case substitute = "Hide: substitute"

    var id: String { rawValue }
}

struct EditorStats: Equatable {
    var characters = 0
    var lines = 0
    var attachments = 0
    var textKit2 = false
    var parseMilliseconds = 0.0
    var applyMilliseconds = 0.0
    var spans = 0
    var fullLayoutMilliseconds: Double?
    var lastEditMilliseconds = 0.0
    var worstEditMilliseconds = 0.0
}

@MainActor
@Observable
final class EditorLab: NSObject, UITextViewDelegate, @MainActor NSTextContentStorageDelegate {
    let textView: UITextView = {
        let view = UITextView(usingTextLayoutManager: true)  // TextKit 2. Never touch `layoutManager`: that falls back to TextKit 1.
        view.isFindInteractionEnabled = true
        view.alwaysBounceVertical = true
        view.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 16, right: 12)
        view.autocorrectionType = .no
        view.autocapitalizationType = .none
        view.smartDashesType = .no
        view.smartQuotesType = .no
        view.adjustsFontForContentSizeCategory = true
        return view
    }()

    private(set) var stats = EditorStats()
    var hideMode = HideMode.off {
        didSet { if hideMode != oldValue { configureHiding(); restyle(force: true) } }
    }
    var completionItems: [String] = []

    private var restylePending = false
    private var lastCaretParagraph = NSRange(location: 0, length: 0)
    private var completionList: CompletionList?
    private let clock = ContinuousClock()

    override init() {
        super.init()
        textView.delegate = self
        textView.font = Self.baseFont
        textView.textColor = .label
        textView.backgroundColor = .systemBackground
        stats.textKit2 = textView.textLayoutManager != nil
    }

    // MARK: Look

    static var baseFont: UIFont { UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: 15, weight: .regular)) }
    private static var boldFont: UIFont { UIFontMetrics(forTextStyle: .body).scaledFont(for: .monospacedSystemFont(ofSize: 15, weight: .bold)) }
    private static let hiddenFont = UIFont.systemFont(ofSize: 0.5)

    private func attributes(for kind: HighlightKind) -> [NSAttributedString.Key: Any] {
        switch kind {
        case .frontmatter: [.foregroundColor: UIColor.secondaryLabel]
        case .heading: [.foregroundColor: UIColor.systemBlue, .font: Self.boldFont]
        case .strong: [.font: Self.boldFont]
        case .emphasis: [.foregroundColor: UIColor.systemIndigo]
        case .strikethrough: [.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: UIColor.secondaryLabel]
        case .inlineCode: [.foregroundColor: UIColor.systemOrange, .backgroundColor: UIColor.secondarySystemFill]
        case .codeBlock: [.foregroundColor: UIColor.systemOrange]
        case .linkText: [.foregroundColor: UIColor.systemTeal]
        case .quote: [.foregroundColor: UIColor.secondaryLabel]
        case .listMarker: [.foregroundColor: UIColor.systemPink, .font: Self.boldFont]
        case .rule: [.foregroundColor: UIColor.tertiaryLabel]
        case .tag: [.foregroundColor: UIColor.systemPurple]
        case .mark: [.foregroundColor: UIColor.tertiaryLabel]
        }
    }

    private static let managedKeys: [NSAttributedString.Key] = [.font, .foregroundColor, .backgroundColor, .strikethroughStyle, .underlineStyle]

    /// Colours the whole text. Only attributes change (never the characters, and never `attributedText` itself, which would drop the
    /// selection and the undo stack), and not while a composition (Scribble, dictation, an input method) is under way.
    func restyle(force: Bool = false) {
        guard textView.markedTextRange == nil else { restylePending = true; return }
        restylePending = false
        let start = clock.now
        let text = textView.text ?? ""
        let spans = MarkdownHighlighter.spans(in: text)
        let parsed = clock.now

        let storage = textView.textStorage  // fine under TextKit 2; `layoutManager` is the one to avoid
        let full = NSRange(location: 0, length: storage.length)
        let caret = paragraphRange(around: textView.selectedRange)
        lastCaretParagraph = caret
        storage.beginEditing()
        for key in Self.managedKeys { storage.removeAttribute(key, range: full) }
        storage.addAttributes([.font: Self.baseFont, .foregroundColor: UIColor.label], range: full)
        for span in spans where span.range.upperBound <= storage.length {
            var attrs = attributes(for: span.kind)
            if hideMode == .attributes, span.kind == .mark, NSIntersectionRange(span.range, caret).length == 0, !(span.range.length == 0) {
                attrs = [.font: Self.hiddenFont, .foregroundColor: UIColor.clear]
            }
            storage.addAttributes(attrs, range: span.range)
        }
        storage.endEditing()
        let applied = clock.now

        marks = hideMode == .substitute ? spans.filter { $0.kind == .mark }.map(\.range) : []
        stats.parseMilliseconds = ms(parsed - start)
        stats.applyMilliseconds = ms(applied - parsed)
        stats.spans = spans.count
        refreshCounts()
    }

    private func ms(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
    }

    private func refreshCounts() {
        let text = textView.text ?? ""
        stats.characters = (text as NSString).length
        stats.lines = text.reduce(1) { $1 == "\n" ? $0 + 1 : $0 }
        stats.textKit2 = textView.textLayoutManager != nil
        var found = 0
        textView.textStorage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: textView.textStorage.length)) { value, _, _ in
            if value != nil { found += 1 }
        }
        stats.attachments = found
    }

    private func paragraphRange(around range: NSRange) -> NSRange {
        let ns = (textView.text ?? "") as NSString
        guard ns.length > 0 else { return NSRange(location: 0, length: 0) }
        return ns.paragraphRange(for: NSRange(location: min(range.location, ns.length), length: 0))
    }

    // MARK: Text

    func load(_ text: String) {
        textView.text = text
        textView.undoManager?.removeAllActions()
        textView.selectedRange = NSRange(location: 0, length: 0)
        textView.setContentOffset(.zero, animated: false)
        stats.fullLayoutMilliseconds = nil
        stats.worstEditMilliseconds = 0
        restyle(force: true)
    }

    /// Lays out the whole text, which TextKit 2 otherwise does only for what is on screen: the worst case for a long note.
    func measureFullLayout() {
        guard let layout = textView.textLayoutManager else { return }
        let start = clock.now
        layout.ensureLayout(for: layout.documentRange)
        stats.fullLayoutMilliseconds = ms(clock.now - start)
    }

    func presentFind() { textView.findInteraction?.presentFindNavigator(showingReplace: false) }

    // MARK: UITextViewDelegate

    func textViewDidChange(_ textView: UITextView) {
        let start = clock.now
        restyle()
        updateCompletion()
        let elapsed = ms(clock.now - start)
        stats.lastEditMilliseconds = elapsed
        stats.worstEditMilliseconds = max(stats.worstEditMilliseconds, elapsed)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        if restylePending, textView.markedTextRange == nil { restyle() }
        // Hiding follows the caret: only when it moves to another paragraph does anything need to change.
        if hideMode == .attributes, paragraphRange(around: textView.selectedRange) != lastCaretParagraph { restyle() }
    }

    // MARK: Hiding the syntax, second way

    private var marks: [NSRange] = []

    private func configureHiding() {
        (textView.textLayoutManager?.textContentManager as? NSTextContentStorage)?.delegate = hideMode == .substitute ? self : nil
    }

    func textContentStorage(_ textContentStorage: NSTextContentStorage, textParagraphWith range: NSRange) -> NSTextParagraph? {
        guard hideMode == .substitute, let storage = textContentStorage.textStorage else { return nil }
        let caret = paragraphRange(around: textView.selectedRange)
        guard NSIntersectionRange(range, caret).length == 0 else { return nil }
        let display = NSMutableAttributedString(attributedString: storage.attributedSubstring(from: range))
        for mark in marks.reversed() where NSIntersectionRange(mark, range).length == mark.length {
            display.deleteCharacters(in: NSRange(location: mark.location - range.location, length: mark.length))
        }
        return NSTextParagraph(attributedString: display)
    }

    // MARK: Completion list at the caret

    private static let components = ["Info", "Warning", "Image", "Drawio", "Toc", "Mark", "Footnotes", "YouTube", "Repo", "Chart"]

    /// After a `<` (and letters), lists the components that fit, just under the caret.
    func updateCompletion() {
        let ns = (textView.text ?? "") as NSString
        let caret = textView.selectedRange.location
        guard textView.selectedRange.length == 0, caret <= ns.length else { return hideCompletion() }
        var i = caret
        while i > 0, CharacterSet.letters.contains(UnicodeScalar(ns.character(at: i - 1)) ?? " ") { i -= 1 }
        guard i > 0, ns.character(at: i - 1) == 0x3C else { return hideCompletion() }  // `<`
        let typed = ns.substring(with: NSRange(location: i, length: caret - i)).lowercased()
        let items = Self.components.filter { $0.lowercased().hasPrefix(typed) }
        guard !items.isEmpty, let end = textView.selectedTextRange?.end else { return hideCompletion() }
        completionItems = items
        let rect = textView.caretRect(for: end)
        let list = completionList ?? CompletionList()
        completionList = list
        list.onPick = { [weak self] name in self?.insertComponent(name, replacing: NSRange(location: i, length: caret - i)) }
        list.show(items, near: rect, in: textView)
    }

    private func hideCompletion() {
        completionItems = []
        completionList?.removeFromSuperview()
    }

    private func insertComponent(_ name: String, replacing range: NSRange) {
        let block = ["Info", "Warning", "Chart"].contains(name)
        let text = block ? "\(name)>\n\n\n\n</\(name)>" : "\(name) />"
        textView.textStorage.replaceCharacters(in: range, with: text)
        textView.selectedRange = NSRange(location: range.location + (block ? name.count + 3 : name.count + 1), length: 0)
        hideCompletion()
        textViewDidChange(textView)
    }

    // MARK: Views inside the text

    /// Puts a view in the line at the caret: a picture, a PencilKit canvas or a SwiftUI panel.
    func insertAttachment(_ kind: LabAttachment.Kind) {
        let attachment = LabAttachment(kind: kind)
        let piece = NSMutableAttributedString(string: "\n")
        piece.append(NSAttributedString(attachment: attachment))
        piece.append(NSAttributedString(string: "\n"))
        piece.addAttributes([.font: Self.baseFont], range: NSRange(location: 0, length: 1))
        textView.textStorage.insert(piece, at: textView.selectedRange.location)
        textViewDidChange(textView)
    }
}

// MARK: - Completion list

private final class CompletionList: UIView {
    var onPick: ((String) -> Void)?
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
        stack.alignment = .fill
        addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 4), stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4), stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ items: [String], near caret: CGRect, in textView: UITextView) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for item in items.prefix(6) {
            var configuration = UIButton.Configuration.plain()
            configuration.title = "<\(item)>"
            configuration.baseForegroundColor = .label
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
            let button = UIButton(configuration: configuration, primaryAction: UIAction { [weak self] _ in self?.onPick?(item) })
            button.contentHorizontalAlignment = .leading
            stack.addArrangedSubview(button)
        }
        let size = CGSize(width: 190, height: CGFloat(min(items.count, 6)) * 34 + 8)
        // Under the caret, or above it when that would run off the bottom of the visible text.
        let visibleBottom = textView.contentOffset.y + textView.bounds.height - textView.adjustedContentInset.bottom
        let below = caret.maxY + 4
        let y = below + size.height > visibleBottom ? max(caret.minY - size.height - 4, textView.contentOffset.y) : below
        let x = min(max(caret.minX, textView.textContainerInset.left), textView.bounds.width - size.width - 8)
        frame = CGRect(origin: CGPoint(x: x, y: y), size: size)
        if superview !== textView { textView.addSubview(self) }
    }
}

// MARK: - Views as text attachments

/// A character in the text that is drawn as a view (TextKit 2's `NSTextAttachmentViewProvider`).
final class LabAttachment: NSTextAttachment {
    enum Kind { case picture, ink, panel }
    let kind: Kind

    init(kind: Kind) {
        self.kind = kind
        super.init(data: nil, ofType: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func viewProvider(for parentView: UIView?, location: any NSTextLocation, textContainer: NSTextContainer?) -> NSTextAttachmentViewProvider? {
        let provider = LabViewProvider(textAttachment: self, parentView: parentView, textLayoutManager: textContainer?.textLayoutManager, location: location)
        provider.tracksTextAttachmentViewBounds = true
        return provider
    }
}

private final class LabViewProvider: NSTextAttachmentViewProvider {
    private var kind: LabAttachment.Kind { (textAttachment as? LabAttachment)?.kind ?? .picture }

    override func loadView() {
        // TextKit calls this on the main thread; the base class does not say so.
        let kind = self.kind
        view = MainActor.assumeIsolated { Self.makeView(kind) }
    }

    @MainActor private static func makeView(_ kind: LabAttachment.Kind) -> UIView {
        switch kind {
        case .picture:
            let image = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 160)).image { context in
                let colors = [UIColor.systemTeal.cgColor, UIColor.systemIndigo.cgColor] as CFArray
                let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
                context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 400, y: 160), options: [])
            }
            let view = UIImageView(image: image)
            view.contentMode = .scaleAspectFit
            view.layer.cornerRadius = 8
            view.clipsToBounds = true
            return view
        case .ink:
            let canvas = PKCanvasView()
            canvas.drawingPolicy = .anyInput
            canvas.backgroundColor = .secondarySystemBackground
            canvas.isScrollEnabled = false
            canvas.layer.cornerRadius = 8
            return canvas
        case .panel:
            return UIHostingConfiguration { LabPanel() }.makeContentView()
        }
    }

    override func attachmentBounds(for attributes: [NSAttributedString.Key: Any], location: any NSTextLocation, textContainer: NSTextContainer?, proposedLineFragment: CGRect, position: CGPoint) -> CGRect {
        let width = max(min(proposedLineFragment.width - 8, 560), 120)
        switch kind {
        case .picture: return CGRect(x: 0, y: 0, width: width, height: width * 0.4)
        case .ink: return CGRect(x: 0, y: 0, width: width, height: 200)
        case .panel: return CGRect(x: 0, y: 0, width: width, height: 96)
        }
    }
}

private struct LabPanel: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill").foregroundStyle(Color.accentColor)
            Text("A SwiftUI view inside the text. It is a view, so it is selectable only as one character.").font(.callout)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - SwiftUI

struct EditorTextView: UIViewRepresentable {
    let lab: EditorLab
    func makeUIView(context: Context) -> UITextView { lab.textView }
    func updateUIView(_ view: UITextView, context: Context) {}
}

// MARK: - Lab texts

extension EditorLab {
    /// Puts a view in the text every `lines` lines, from the bottom up so earlier positions stay where they are.
    func addAttachments(everyLines lines: Int) {
        let ns = (textView.text ?? "") as NSString
        var offsets: [Int] = []
        var line = 0
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byLines, .substringNotRequired]) { _, range, _, _ in
            line += 1
            if line % lines == 0 { offsets.append(range.upperBound) }
        }
        let kinds: [LabAttachment.Kind] = [.picture, .panel, .picture, .ink]
        for (index, offset) in offsets.enumerated().reversed() {
            let piece = NSMutableAttributedString(string: "\n")
            piece.append(NSAttributedString(attachment: LabAttachment(kind: kinds[index % kinds.count])))
            textView.textStorage.insert(piece, at: offset)
        }
        restyle(force: true)
    }
}

enum LabText {
    static let sample = """
        ---
        title: Editor lab
        tags:
        - spike
        createdAt: 2026-11-06
        ---
        # Editor lab

        Type here. Text with **bold**, *emphasis*, ~~strikethrough~~, `inline code` and a [link](https://example.com).
        Staging resets <Mark color="green">every night</Mark>.

        <Info>

        A panel with a list:

        - back up first
        - then deploy

        </Info>

        > A quote, with `code` in it.

        ## Code

        ```swift
        let greeting = "hello"
        ```

        1. one
        2. two
        - [x] done
        - [ ] todo

        ---

        Type a `<` at the start of a line to open the completion list. Pull down the keyboard and write with the Pencil to try Scribble.

        """

    /// A note of about `lines` lines made of the sample's kinds of text.
    static func big(lines: Int) -> String {
        var out = ["---", "title: Big note", "---", "# Big note", ""]
        var section = 0
        while out.count < lines {
            out += ["## Section \(section)", "", "Some **bold** text, *emphasis*, `code` and a [link](https://example.com/\(section)) with é and 😀. The rest of this line is plain text to make it long enough to wrap onto a second line on an iPad.", "", "- item one", "- item two", "", "> a quote", "", "```", "let x = \(section)", "```", ""]
            section += 1
        }
        return out.joined(separator: "\n")
    }
}
