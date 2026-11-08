import Foundation
import Testing

@testable import CompositionCore

@Suite("The restricted MDX layer: blocks")
struct NoteScannerTests {
    private func markdown(_ block: NoteBlock) -> String? {
        if case .markdown(let text) = block { return text }
        return nil
    }

    @Test("a note that mentions no component is plain Markdown, scanned for nothing")
    func plain() {
        let note = NoteScanner.scan("# T\n\nA stray < and { are fine here.\n")
        #expect(!note.isMdx && note.isValid && note.elements.isEmpty)
        #expect(note.blocks == [.markdown("# T\n\nA stray < and { are fine here.\n")])
        #expect(note.headings == [NoteHeading(depth: 1, text: "T")])
    }

    @Test("a panel holds what is between its tags, and panels nest")
    func panels() throws {
        let note = NoteScanner.scan("before\n\n<Info>\n\nouter\n\n<Warning>\n\ninner\n\n</Warning>\n\n</Info>\n\nafter\n")
        #expect(note.isValid)
        #expect(note.blocks.count == 3)
        #expect(markdown(note.blocks[0])?.contains("before") == true && markdown(note.blocks[2])?.contains("after") == true)
        guard case .element(let name, _, let children) = note.blocks[1] else { Issue.record("not an element"); return }
        #expect(name == "Info" && children.count == 2)
        #expect(markdown(children[0])?.contains("outer") == true)
        guard case .element(let inner, _, let innerChildren) = children[1] else { Issue.record("no inner element"); return }
        #expect(inner == "Warning" && markdown(innerChildren[0])?.contains("inner") == true)
    }

    @Test("a tag inside a line of text stays in the text, and a block tag with props is an element without children")
    func inlineAndSelfClosing() throws {
        let marked = NoteScanner.scan("Staging resets <Mark color=\"green\">every night</Mark>.\n")
        #expect(marked.blocks == [.markdown("Staging resets <Mark color=\"green\">every night</Mark>.\n")])
        #expect(marked.elements == [MdxElement(name: "Mark", props: ["color": .text("green")], isBlock: false, depth: 0)])

        let image = NoteScanner.scan("<Image src=\"app_data/a.png\" alt=\"A &amp; B\" width=\"50%\" />\n")
        #expect(image.blocks == [.element(name: "Image", props: ["src": .text("app_data/a.png"), "alt": .text("A & B"), "width": .text("50%")], children: [])])
    }

    @Test("a chart keeps its CSV block as its child")
    func chart() throws {
        let note = NoteScanner.scan("<Chart type=\"bar\">\n\n```csv\na,b\n1,2\n```\n\n</Chart>\n")
        guard case .element("Chart", _, let children) = try #require(note.blocks.first) else { Issue.record("no chart"); return }
        #expect(markdown(children[0])?.contains("a,b\n1,2") == true)
    }

    @Test("a note that is not valid MDX comes back whole, as Markdown, with the reason")
    func invalid() {
        let body = "<Info>\n\nnever closed\n"
        let note = NoteScanner.scan(body)
        #expect(note.isMdx && !note.isValid && note.error != nil)
        #expect(note.blocks == [.markdown(body)] && note.elements.isEmpty)
    }

    @Test("what code holds is not a tag, a brace or a footnote")
    func code() {
        let note = NoteScanner.scan("```\n<Foo> {x} [^a]\n```\n\nUse `<Bar>` and `{y}` and `[^a]`.\n\n<Toc />\n")
        #expect(note.isValid && note.elements.map(\.name) == ["Toc"] && note.footnotes.isEmpty)
    }

    @Test("footnotes are numbered by where they are cited, whatever they are called")
    func footnotes() {
        let note = NoteScanner.scan("Second[^b] then first[^a], second again[^b], and none[^x].\n\n[^a]: A.\n[^b]: B.\n[^z]: never cited.\n\n<Footnotes />\n")
        #expect(note.footnotes == ["b", "a"])
    }

    @Test("character references in a prop are read")
    func entities() {
        #expect(NoteScanner.decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#65; &#x42; &nope; &") == "a & b <c> \"d\" A B &nope; &")
    }

    @Test("a definition leaves the Markdown for the list, its text is kept, and a note without components has footnotes too")
    func footnoteText() {
        let note = NoteScanner.scan("Second[^b] then first[^a]. Code `[^a]` and none[^x].\n\n[^a]: First, with a [link](https://x.test).\n[^b]: Second\n    over two lines.\n\nEnd.\n")
        #expect(!note.isMdx && note.footnotes == ["b", "a"])
        #expect(note.footnoteBodies == ["a": "First, with a [link](https://x.test).", "b": "Second\nover two lines."])
        let text = markdown(note.blocks[0]) ?? ""
        #expect(text.contains("Second[^b] then first[^a]."))
        #expect(text.contains("`[^a]`") && text.contains("none[^x]."))
        #expect(!text.contains("[^a]:") && text.contains("End."))
    }

    @Test("frontmatter is split from the body, and a block that is not a mapping is not frontmatter")
    func frontmatter() {
        let note = "---\ntitle: A note\ntags:\n- x\n- y\n---\n# Body\n"
        #expect(NoteFrontmatter.split(note).frontmatter == "title: A note\ntags:\n- x\n- y")
        #expect(NoteFrontmatter.split(note).body == "# Body\n")
        #expect(NoteFrontmatter.split("# No block\n").frontmatter == nil)
        let notYaml = "---\njust some words\n---\nafter\n"
        #expect(NoteFrontmatter.split(notYaml).frontmatter == nil && NoteFrontmatter.split(notYaml).body == notYaml)
        #expect(NoteFrontmatter.split("---\n---\nafter").frontmatter == nil)
    }
}
