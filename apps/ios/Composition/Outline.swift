import CompositionCore
import SwiftUI
import UIKit

// The heading rail (the tracker's M3† row; the desktop's `HeadingRail.tsx`): the note's headings as an outline, and a tap on one goes there, in the editor and in the
// preview. The desktop draws a column of ticks beside the text. On the iPad it is a list in a popover from the toolbar's Outline button: a tick is two points tall and
// a finger needs 44, VoiceOver reads a list, and in a narrow window (Slide Over, a third of the screen) the system turns the popover into a sheet by itself, so it
// fits whatever width it is given. The headings come from `NoteOutline` in CompositionCore.

/// A request from the outline for the preview to scroll to a heading: the preview watches `serial`, which changes with every request, so asking for the same
/// heading twice scrolls twice.
@MainActor @Observable
final class OutlineJump {
    private(set) var ordinal = 0
    private(set) var serial = 0

    func go(to ordinal: Int) {
        self.ordinal = ordinal
        serial += 1
    }
}

extension NoteTextView {
    /// Puts the caret at the start of the line at `offset` and scrolls the text so that the line is at the top.
    func reveal(offset: Int) {
        let at = min(max(offset, 0), textStorage.length)
        selectedRange = NSRange(location: at, length: 0)
        layoutIfNeeded()
        guard let position = self.position(from: beginningOfDocument, offset: at) else { return }
        let line = caretRect(for: position)
        let low = -adjustedContentInset.top
        let high = max(low, contentSize.height - bounds.height + adjustedContentInset.bottom)
        let y = min(max(line.minY - adjustedContentInset.top - 8, low), high)
        setContentOffset(CGPoint(x: contentOffset.x, y: y), animated: !UIAccessibility.isReduceMotionEnabled)
    }
}

/// The outline: every heading, indented by its level, with the one the caret is in marked. Nil `headings` is "still being read".
struct OutlineList: View {
    let headings: [OutlineHeading]?
    /// The ordinal of the heading the caret is under, in a tab with a caret.
    let current: Int?
    let select: (OutlineHeading) -> Void
    @Environment(\.look) private var look

    var body: some View {
        Group {
            if let headings {
                if headings.isEmpty {
                    ContentUnavailableView("No headings yet", systemImage: "list.bullet.indent", description: Text("Start a line with # to make one."))
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) { ForEach(headings) { row($0) } }.padding(.vertical, 8)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 320, idealWidth: 360, minHeight: 160, idealHeight: 420, maxHeight: 520)
        .background(look.background)
        .foregroundStyle(look.foreground)
        .accessibilityIdentifier("outline")
    }

    private func row(_ heading: OutlineHeading) -> some View {
        let name = heading.text.isEmpty ? "Untitled heading" : heading.text
        let isCurrent = heading.ordinal == current
        return Button { select(heading) } label: {
            HStack(spacing: 8) {
                Text(name)
                    .font(heading.level <= 2 ? .body.weight(.semibold) : .body)
                    .foregroundStyle(heading.text.isEmpty ? look.mutedText : look.foreground)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if isCurrent { Image(systemName: "location.fill").font(.caption).foregroundStyle(look.brand).accessibilityHidden(true) }
            }
            .padding(.leading, 16 + CGFloat(min(heading.level, 6) - 1) * 16)
            .padding(.trailing, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(name), heading level \(heading.level)")
        .accessibilityAddTraits(isCurrent ? [.isSelected] : [])
        .accessibilityIdentifier("outline-heading-\(heading.ordinal)")
    }
}
