import CompositionCore
import SwiftUI
import UIKit

/// Following a link written in a note, from either tab that draws links (Step 2 of docs/ipad-live-default-plan.md): the Preview's tap, and the Live tab's ↗
/// and ⌘-tap. A `note:` link opens that note, a `pdf:` link opens its PDF beside this note at its page, and a web or mail address opens in the system's
/// app. A `#heading` link and anything else is not followed, as in the Preview.
@MainActor
struct LinkFollower {
    let model: AppModel
    /// The note the link is in (a PDF opens beside it).
    let noteId: Int64?

    enum Target {
        case note(Int64)
        case pdf(PdfRef)
        case web(URL)
        case none
    }

    /// What `href`, as written in a link (or as the Live model makes it from an autolink or a bare address), points at.
    nonisolated static func target(of href: String) -> Target {
        if href.hasPrefix("pdf:"), let ref = PdfRefs.parse(href) { return .pdf(ref) }
        if href.hasPrefix("note:") { return NoteLinks.id(fromRef: href).map { .note($0) } ?? .none }
        guard let url = URL(string: href), let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return .none }
        return .web(url)
    }

    /// Whether a `pdf:` link's PDF is on this iPad (a link to another kind of address always is): one that is not is drawn struck through and not followed.
    static func isHere(_ href: String, model: AppModel) -> Bool {
        guard case .pdf(let ref) = target(of: href) else { return true }
        return model.isPdfHere(uuid: ref.uuid)
    }

    /// Follows `href`. False when there is nothing to follow there.
    @discardableResult
    func follow(_ href: String) -> Bool {
        switch Self.target(of: href) {
        case .note(let id): model.followNoteLink(id)
        case .pdf(let ref): model.followPdfLink(ref, from: noteId)
        case .web(let url): UIApplication.shared.open(url)
        case .none: return false
        }
        return true
    }

    /// The Preview's `openURL`: a note or a PDF is opened here, and the system opens the rest.
    func open(_ url: URL) -> OpenURLAction.Result {
        switch Self.target(of: url.absoluteString) {
        case .note(let id):
            model.followNoteLink(id)
            return .handled
        case .pdf(let ref):
            model.followPdfLink(ref, from: noteId)
            return .handled
        case .web, .none:
            return .systemAction
        }
    }
}
