import CoreGraphics
import Foundation
import Testing

@testable import CompositionCore
@testable import CompositionInk

@Suite("Ink: a new drawing is cut to what was drawn")
struct InkCropTests {
    /// A pen line from (100, 200) to (160, 230), with a nib of 4 by 6.
    func line() -> InkDocument {
        InkDocument(width: 834, height: 1194, strokes: [InkStroke(points: [InkPoint(x: 100, y: 200, width: 4, height: 6), InkPoint(x: 160, y: 230, t: 100, width: 4, height: 6)])])
    }

    @Test func theInkBoundsAreThePointsGrownByHalfTheNib() throws {
        let bounds = try #require(line().inkBounds)
        #expect(bounds == CGRect(x: 98, y: 197, width: 64, height: 36))
        #expect(InkDocument(width: 10, height: 10).inkBounds == nil)
        #expect(InkDocument(width: 10, height: 10, strokes: [InkStroke(points: [])]).inkBounds == nil)
    }

    @Test func theCutPageHasThePaddingAllRound() throws {
        let cut = line().cropped()
        #expect((cut.width, cut.height) == (64 + 32, 36 + 32))
        // The first point is half a nib plus the padding from the top left; the strokes moved together.
        #expect(cut.strokes[0].points[0].x == 100 - 98 + 16 && cut.strokes[0].points[0].y == 200 - 197 + 16)
        #expect(cut.strokes[0].points[1].x == 160 - 98 + 16 && cut.strokes[0].points[1].y == 230 - 197 + 16)
        // The ink touches no side: its bounds sit inside the page with the padding left over on every side.
        let ink = try #require(cut.inkBounds)
        #expect(ink.minX == 16 && ink.minY == 16 && ink.maxX == cut.width - 16 && ink.maxY == cut.height - 16)
        // The rest of the stroke is untouched.
        #expect(cut.strokes[0].points[1].t == 100 && cut.strokes[0].points[1].width == 4)
    }

    @Test func aLoneDotGetsAPageOfTheMinimumSideRoundItsMiddle() throws {
        let dot = InkDocument(width: 834, height: 1194, strokes: [InkStroke(points: [InkPoint(x: 400, y: 500, width: 3, height: 3)])])
        let cut = dot.cropped()
        #expect((cut.width, cut.height) == (InkCrop.minimumSide, InkCrop.minimumSide))
        #expect(cut.strokes[0].points[0].x == InkCrop.minimumSide / 2 && cut.strokes[0].points[0].y == InkCrop.minimumSide / 2)
    }

    @Test func aDrawingWithNoInkIsLeftAlone() {
        let empty = InkDocument(width: 834, height: 1194)
        #expect(empty.cropped() == empty && empty.cropBox() == nil)
    }

    @Test func cuttingAgainChangesNothing() throws {
        let once = line().cropped()
        #expect(once.cropped() == once)
        // And the page opened for editing, moved by the room it is given and cut on Done, comes back as it was.
        let reopened = once.translated(dx: InkCrop.editingRoom, dy: InkCrop.editingRoom, canvas: CGSize(width: 834, height: 1194))
        #expect(reopened.cropped() == once)
    }

    @Test func theCutBoxIsAtTheFormatsStepSoWritingItChangesNothing() throws {
        let odd = InkDocument(width: 834, height: 1194, strokes: [InkStroke(points: [InkPoint(x: 100.123, y: 200.456, width: 3.33, height: 3.33), InkPoint(x: 160.987, y: 230.001, width: 3.33, height: 3.33)])])
        let cut = odd.cropped()
        let again = try InkDocument(json: cut.json)
        #expect(again.json == cut.json)
        #expect(abs(again.width - cut.width) < 0.005 && abs(again.height - cut.height) < 0.005)
    }
}
