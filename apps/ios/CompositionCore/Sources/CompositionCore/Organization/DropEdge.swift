import Foundation

/// Where on a row a drag is hovering: above it, onto it, or below it. A port of `dropEdge.ts` (build plan Step 7).
public enum DropEdge: String, Sendable, Equatable, CaseIterable {
    case before, into, after

    /// The share of a row's height, at each end, that counts as its edge when it can also be dropped onto.
    static let edgeBand = 0.25

    /// Which edge of a row the pointer is on, given the edges the drag may use there; nil when it may use none. A row that can be
    /// dropped onto keeps its middle for that and gives only the outer bands to `before` and `after`; one that can only be placed
    /// beside (a note) splits down the middle.
    public static func at(offsetY: Double, height: Double, allowed: [DropEdge]) -> DropEdge? {
        if allowed.contains(.into) {
            if offsetY < height * edgeBand && allowed.contains(.before) { return .before }
            if offsetY > height * (1 - edgeBand) && allowed.contains(.after) { return .after }
            return .into
        }
        let preferred: DropEdge = offsetY < height / 2 ? .before : .after
        if allowed.contains(preferred) { return preferred }
        return allowed.first { $0 == .before || $0 == .after }
    }
}
