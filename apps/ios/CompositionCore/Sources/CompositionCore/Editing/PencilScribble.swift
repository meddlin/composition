import Foundation

/// Whether Scribble (writing with the Pencil, turned into text) may begin in this app's text: Appearance ▸ Writing ▸ "Write with the Pencil (Scribble)". iPadOS has
/// only a switch for the whole iPad (Settings ▸ Apple Pencil ▸ Scribble); the owner found Scribble unreliable in notes (Gates LD1 and LD4) and asked for one of the
/// app's own. While it is off, Scribble begins nowhere in the app's text: the note's text in the Live and Markdown tabs, and every other field (search, the Reading
/// List's link, filters, names, PDF comments). The Pencil still draws, ticks a task box, opens a drawing, and selects and scrolls as a finger does.
///
/// Kept on this iPad only (`UserDefaults`, as "Open notes in" is), not in `settings.json`: the desktop has no Scribble, and a restored backup leaves it alone. Off until
/// switched on (the owner's choice, 2026-11-28). Only the toggle writes the key, so a value never chosen follows `defaultOn`.
public enum PencilScribble {
    public static let key = "pencilScribble"
    public static let defaultOn = false

    /// The setting as `defaults` has it, `defaultOn` when it was never chosen. A launch argument (`-pencilScribble 1`, for the UI tests) is read as `bool(forKey:)` reads it.
    public static func isOn(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: key) == nil ? defaultOn : defaults.bool(forKey: key)
    }
}
