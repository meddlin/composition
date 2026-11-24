import Foundation
import Testing

@testable import CompositionCore

// Gate LD7's footnote navigation (docs/manual-tests/ipad.md item 364): the Live tab follows a citation to its definition and a footnote list's ↩ back to the
// citation by the desktop's ids (`fn-label`, `fnref-label`), found as the desktop's `fragmentOffset` finds them (apps/web/src/components/notes/noteLinkActions.ts,
// whose test has the same note).

@Suite("In-note addresses of footnotes (Gate LD7)")
struct NoteFragmentsTests {
    private let text = "---\ntitle: x\n---\n# Intro\n\nSee[^1].\n\n## Next Steps!\n\n## Next Steps\n\n```\n# not a heading\n```\n\n[^1]: The note.\n"

    private func at(_ piece: String) -> Int { (text as NSString).range(of: piece).location }

    @Test("a footnote's definition and its citation, with or without remark-gfm's `user-content-`, as the desktop finds them")
    func definitionAndReference() {
        #expect(NoteFragments.offset(of: "user-content-fn-1", in: text) == at("[^1]:"))
        #expect(NoteFragments.offset(of: "fn-1", in: text) == at("[^1]:"))
        #expect(NoteFragments.offset(of: "fnref-1", in: text) == at("[^1]"))
        #expect(NoteFragments.offset(of: NoteFragments.referenceID("1"), in: text) == at("[^1]"))
    }

    @Test("nothing for an id nothing has, nor for a heading's slug (the iPad's `<Toc />` goes by the heading's number)")
    func nothing() {
        #expect(NoteFragments.offset(of: "fn-2", in: text) == nil)
        #expect(NoteFragments.offset(of: "fnref-2", in: text) == nil)
        #expect(NoteFragments.offset(of: "intro", in: text) == nil)
        #expect(NoteFragments.offset(of: "fn-", in: text) == nil)
    }

    @Test("a definition is `[^label]:` at the start of a line, after up to three spaces; a citation is the first `[^label]` not followed by `:`")
    func definitionAtALineStart() {
        let text = "A[^a]: not a definition.\n    [^a]: four spaces is code.\n   [^a]: three spaces.\n"
        #expect(NoteFragments.offset(of: "fn-a", in: text) == (text as NSString).range(of: "[^a]: three").location)
        #expect(NoteFragments.offset(of: "fnref-a", in: text) == nil)  // every `[^a]` here is followed by `:`
        let cited = "Words[^a] and[^a].\n\n[^a]: Note."
        #expect(NoteFragments.offset(of: "fnref-a", in: cited) == 5)
    }

    @Test("a footnote's label from its number, which is the Preview's (the order of first citation), and a citation's label from its source")
    func labels() {
        let text = "One[^b], two[^a], three[^b].\n\n[^a]: A.\n[^b]: B."
        #expect(NoteFragments.footnoteLabel(number: 1, in: text) == "b")
        #expect(NoteFragments.footnoteLabel(number: 2, in: text) == "a")
        #expect(NoteFragments.footnoteLabel(number: 3, in: text) == nil)
        #expect(NoteFragments.citationLabel("[^note]") == "note")
        #expect(NoteFragments.citationLabel("[^]") == nil)
        #expect(NoteFragments.citationLabel("[a]") == nil)
    }

    @Test("places are in UTF-16 units, as the text view counts")
    func utf16() {
        let text = "😀 See[^x].\n\n[^x]: Note."
        #expect(NoteFragments.offset(of: "fnref-x", in: text) == 6)
        #expect(NoteFragments.offset(of: "fn-x", in: text) == (text as NSString).range(of: "[^x]:").location)
    }
}
