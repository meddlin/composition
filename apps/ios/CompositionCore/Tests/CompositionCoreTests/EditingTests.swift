import Foundation
import Testing

@testable import CompositionCore

// Build plan Step 9, in plain words. The completions, indenting, emphasis and note links are held against the desktop's real functions in
// EditingConformanceTests; the highlight is a smaller rule of our own (see MarkHighlight), so what it does is said here.

private func apply(_ edit: LineEdit, to text: String) -> String {
    let source = text as NSString
    return source.replacingCharacters(in: NSRange(location: edit.start, length: edit.end - edit.start), with: edit.text)
}

@Suite("Typing aids")
struct EditingTests {
    @Test("a < offers the components that fit, and choosing one leaves the caret where the desktop's template says")
    func components() throws {
        let offered = try #require(MdxCompletions.target("Some text <Im", caret: 13))
        #expect(offered.items.map(\.name) == ["Image"] && offered.start == 10 && offered.end == 13)
        let expansion = MdxCompletions.expand(offered.items[0])
        #expect(expansion.text == "<Image src=\"\" alt=\"\" />" && expansion.caret == 12)
        #expect(MdxCompletions.target("a<b", caret: 3) == nil, "a < inside a word is not a tag")
    }

    @Test("inside a tag, the props it lacks are offered, and inside the quotes of one, its values")
    func props() throws {
        let text = "<Image src=\"x\" "
        let props = try #require(MdxCompletions.target(text, caret: text.utf16.count))
        #expect(props.items.map(\.name) == ["alt", "title", "width"])
        let quoted = "<Image width=\"5"
        let values = try #require(MdxCompletions.target(quoted, caret: quoted.utf16.count))
        #expect(values.items.map(\.name) == ["50%"] && values.label == "width values")
        #expect(MdxCompletions.target("```\n<Image \n```", caret: 11) == nil, "nothing in a code block")
    }

    @Test("an empty frontmatter line offers the properties the block lacks, and a slash offers snippets")
    func frontmatterAndSnippets() throws {
        let note = "---\ntitle: A\n\n---\nbody"
        let missing = try #require(MdxCompletions.target(note, caret: 13))
        #expect(missing.items.map(\.name) == ["description", "tags", "createdAt", "updatedAt", "headerImage", "headerImageLayout"])
        let snippets = try #require(MdxCompletions.target("text\n/ta", caret: 8))
        #expect(snippets.items.map(\.name) == ["table", "tasks"] && snippets.items[0].label == "/table")
    }

    @Test("a [[ lists notes by title, those that start with the words first, and the link carries the id")
    func noteLinks() throws {
        let notes = [NoteLinks.Candidate(id: 1, title: "Trip plan"), NoteLinks.Candidate(id: 2, title: "Plan B"), NoteLinks.Candidate(id: 3, title: "Roadmap"), NoteLinks.Candidate(id: 4, title: "")]
        let trigger = try #require(NoteLinks.findTrigger("see [[pla", caret: 9))
        #expect(trigger.start == 4 && trigger.query == "pla")
        #expect(NoteLinks.match(notes, query: "pla", excluding: nil).map(\.id) == [2, 1])
        #expect(NoteLinks.match(notes, query: "pla", excluding: 2).map(\.id) == [1], "not the note being edited")
        #expect(NoteLinks.link(to: notes[1]) == "[Plan B](note:2)")
        #expect(NoteLinks.link(to: notes[3]) == "[Untitled](note:4)")
        #expect(NoteLinks.id(fromRef: "note:42") == 42 && NoteLinks.id(fromRef: "https://x") == nil)
    }

    @Test("indenting lines puts a tab in front of each, and outdenting takes a tab or up to four spaces off")
    func indenting() throws {
        let text = "one\n  two\n\nthree"
        let indented = try #require(IndentLines.edit(text, from: 0, to: text.utf16.count, command: .indent))
        #expect(apply(indented, to: text) == "\tone\n\t  two\n\n\tthree", "an empty line is left alone")
        let outdented = try #require(IndentLines.edit("\tone\n      two", from: 0, to: 12, command: .outdent))
        #expect(apply(outdented, to: "\tone\n      two") == "one\n  two")
        #expect(IndentLines.edit("one", from: 0, to: 0, command: .outdent) == nil, "nothing to take off")
    }

    @Test("bold and italic wrap the words, keep the spaces outside, and the same command takes them off")
    func emphasis() throws {
        let text = "a  word  b"
        let bold = try #require(EmphasisToggle.toggle(text, from: 1, to: 9, .bold))
        #expect(apply(bold, to: text) == "a  **word**  b" && bold.selection == 5..<9)
        let again = try #require(EmphasisToggle.toggle("a  **word**  b", from: 5, to: 9, .bold))
        #expect(apply(again, to: "a  **word**  b") == "a  word  b")
        let both = try #require(EmphasisToggle.toggle("**x**", from: 2, to: 3, .italic))
        #expect(apply(both, to: "**x**") == "***x***")
        #expect(EmphasisToggle.toggle("   ", from: 0, to: 3, .bold) == nil)
    }

    @Test("highlighting wraps the words in a Mark, outside the spaces; the same words again change the colour, and removing leaves the words")
    func highlighting() throws {
        let text = "---\ntitle: A\n---\nsome  words here"  // two spaces, so the words start after the second
        let from = ("---\ntitle: A\n---\nsome" as NSString).length + 1
        let edit = try MarkHighlight.highlight(text, range: from..<(from + 7), color: "green").get()
        let marked = apply(edit, to: text)
        #expect(marked.hasSuffix("some  <Mark color=\"green\">words</Mark> here"))
        let at = (marked as NSString).range(of: "words").location
        #expect(MarkHighlight.existing(in: marked, range: at..<(at + 5))?.color == "green")
        let recoloured = try MarkHighlight.highlight(marked, range: at..<(at + 5), color: "pink").get()
        #expect(apply(recoloured, to: marked).hasSuffix("some  <Mark color=\"pink\">words</Mark> here"))
        let removed = try #require(MarkHighlight.remove(marked, range: at..<(at + 5)))
        #expect(apply(removed, to: marked) == text)
    }

    @Test("a selection that is not plain words on one line is refused, with the reason")
    func refusing() {
        func why(_ text: String, _ from: Int, _ to: Int) -> MarkHighlight.Refusal? {
            if case .failure(let refusal) = MarkHighlight.highlight(text, range: from..<to, color: "yellow") { return refusal }
            return nil
        }
        #expect(why("a\nb", 0, 3) == .acrossLines)
        #expect(why("---\ntitle: A\n---\nx", 4, 9) == .inFrontmatter)
        #expect(why("**bold** text", 0, 8) == .hasMarkup)
        #expect(why("```\ncode\n```", 4, 8) == .inCode)
        #expect(why("use `code here` now", 7, 11) == .inCode)
        #expect(why("<Image src=\"app_data/x.png\" />", 21, 26) == .inTag)
        #expect(why("text", 2, 2) == .nothingSelected)
    }
}
