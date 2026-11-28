import CompositionCore
import Foundation
import Testing

/// Appearance ▸ Writing ▸ "Write with the Pencil (Scribble)" (`PencilScribble`): off until chosen, and then what was chosen.
@Suite struct PencilScribbleTests {
    private func freshDefaults() throws -> UserDefaults {
        let name = "PencilScribbleTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func scribbleIsOffUntilSwitchedOn() throws {
        #expect(PencilScribble.defaultOn == false)
        #expect(PencilScribble.isOn(in: try freshDefaults()) == false)
    }

    @Test func aChoiceIsKept() throws {
        let defaults = try freshDefaults()
        defaults.set(true, forKey: PencilScribble.key)
        #expect(PencilScribble.isOn(in: defaults))
        defaults.set(false, forKey: PencilScribble.key)
        #expect(!PencilScribble.isOn(in: defaults))
    }

    /// The UI tests pass `-pencilScribble 1` (or `0`), which `UserDefaults` holds as text.
    @Test func aLaunchArgumentIsRead() throws {
        let defaults = try freshDefaults()
        defaults.set("1", forKey: PencilScribble.key)
        #expect(PencilScribble.isOn(in: defaults))
        defaults.set("0", forKey: PencilScribble.key)
        #expect(!PencilScribble.isOn(in: defaults))
    }
}
