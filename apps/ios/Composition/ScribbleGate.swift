import CompositionCore
import UIKit

/// Appearance ▸ Writing ▸ "Write with the Pencil (Scribble)" (`PencilScribble`) for the app's text outside the note: the search fields, the Reading List's link, the
/// filters, the names asked for in prompts, PDF comments and page labels, the scan import's title. While it is off Scribble begins in none of them; the owner chose that
/// they follow the setting too (2026-11-28). The note's own text view has `LiveScribble`, which reads the same setting and also keeps Scribble off what Live draws.
///
/// A text field says where Scribble may begin through a `UIScribbleInteraction` of its own (WWDC20, "Meet Scribble for iPad"), but SwiftUI's `TextField`,
/// `.searchable` and `TextEditor` have no Scribble modifier and do not hand out their UIKit views. So every `UITextField` and `UITextView` is given the interaction as it
/// first joins a window, by `UIAppearance`, which sets a property set on a class's appearance proxy on each instance (of the class and its subclasses) as it does.
@MainActor
final class ScribbleGate: NSObject, UIScribbleInteractionDelegate {
    static let shared = ScribbleGate()

    /// Called once, as the app starts, before any window.
    static func installEverywhere() {
        UITextField.appearance().followsScribbleSetting = true
        UITextView.appearance().followsScribbleSetting = true
    }

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
        PencilScribble.isOn()
    }
}

extension UIView {
    /// Whether the view has `ScribbleGate`'s interaction; set to true (by `UIAppearance`, on text fields and text views), it is given it. The note's text view is left
    /// to its own (`LiveScribble`).
    @objc dynamic var followsScribbleSetting: Bool {
        get { interactions.contains { ($0 as? UIScribbleInteraction)?.delegate === ScribbleGate.shared } }
        set {
            guard newValue, !followsScribbleSetting, !(self is NoteTextView) else { return }
            addInteraction(UIScribbleInteraction(delegate: ScribbleGate.shared))
        }
    }
}
