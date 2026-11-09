import Foundation

/// Where the user has been, for stepping back to what they were just looking at and forward again: a port of `navHistory.ts` (build plan
/// Step 7), generic over what a place is. The desktop's places are a note, a group or Home; the iPad's are a note or a choice in the
/// sidebar, and the rules are the same. A history is not saved: relaunching starts a new one.
public struct NavigationHistory<Place: Equatable & Sendable>: Equatable, Sendable {
    /// The oldest first.
    public private(set) var entries: [Place] = []
    /// The entry being looked at; -1 only while nothing has been recorded.
    public private(set) var cursor = -1

    /// The oldest entries are forgotten past this.
    public static var maxEntries: Int { 100 }

    public init() {}

    /// Notes where the user now is. Looking at what the history already points at changes nothing, which is what lets a step back or
    /// forward apply its target without recording it as a new visit. Anywhere else becomes the newest entry, dropping whatever was
    /// ahead of the cursor, as a browser does.
    public mutating func record(_ place: Place) {
        if entries.indices.contains(cursor), entries[cursor] == place { return }
        entries = Array((entries[..<(cursor + 1)] + [place]).suffix(Self.maxEntries))
        cursor = entries.count - 1
    }

    /// The nearest earlier entry that is still worth showing, with the history moved onto it; nil when there is none. Entries for
    /// notes or groups that are gone are passed over but kept, so a forward step after a back step still lands where it should.
    public mutating func back(isValid: (Place) -> Bool) -> Place? { step(-1, isValid) }

    public mutating func forward(isValid: (Place) -> Bool) -> Place? { step(1, isValid) }

    /// Whether a step in that direction would land anywhere (for dimming a button).
    public func canGoBack(isValid: (Place) -> Bool) -> Bool { target(-1, isValid) != nil }

    public func canGoForward(isValid: (Place) -> Bool) -> Bool { target(1, isValid) != nil }

    private func target(_ direction: Int, _ isValid: (Place) -> Bool) -> Int? {
        var at = cursor + direction
        while entries.indices.contains(at) {
            if isValid(entries[at]) { return at }
            at += direction
        }
        return nil
    }

    private mutating func step(_ direction: Int, _ isValid: (Place) -> Bool) -> Place? {
        guard let at = target(direction, isValid) else { return nil }
        cursor = at
        return entries[at]
    }
}
