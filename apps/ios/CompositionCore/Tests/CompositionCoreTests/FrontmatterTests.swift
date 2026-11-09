import Foundation
import Testing

@testable import CompositionCore

// Frontmatter without the desktop at hand: the shapes that matter, and the guards. The 111 + 123 + 16 inputs checked against the
// real library are in FrontmatterConformanceTests.

@Suite("Frontmatter: reading and writing a note's header block")
struct FrontmatterTests {
    private let note = """
        ---
        title: A note
        description: ''
        tags:
        - alpha
        - beta
        createdAt: 2026-11-06
        updatedAt: 2026-11-07
        ---
        # Body

        """

    @Test("a block the app wrote is read into its parts, and the body is what follows")
    func reads() {
        let (frontmatter, body) = NoteFrontmatter.parse(note)
        #expect(frontmatter == Frontmatter(title: "A note", tags: ["alpha", "beta"], createdAt: "2026-11-06", updatedAt: "2026-11-07"))
        #expect(body == "# Body\n")
        #expect(NoteFrontmatter.strip(note) == "# Body\n")
    }

    @Test("what is read can be rendered back to the same bytes")
    func roundTrip() throws {
        let (frontmatter, body) = NoteFrontmatter.parse(note)
        let parsed = try #require(frontmatter)
        #expect(NoteFrontmatter.render(parsed, body: body) == note)
    }

    @Test("a new block is written the way the desktop writes it")
    func generates() {
        #expect(
            NoteFrontmatter.generate(title: "Hello: world", createdAt: "2026-11-06T09:30:00.000Z", updatedAt: "2026-11-06 10:00", description: "It's", tags: ["a b", "true", "x:y"])
                == "---\ntitle: 'Hello: world'\ndescription: It's\ntags:\n- a b\n- 'true'\n- x:y\ncreatedAt: 2026-11-06\nupdatedAt: 2026-11-06\n---\n")
        #expect(NoteFrontmatter.generate(title: "", createdAt: "", updatedAt: "") == "---\ntitle: ''\ndescription: ''\ntags: []\ncreatedAt: ''\nupdatedAt: ''\n---\n")
    }

    @Test("a long title is folded at 78 columns, as the desktop folds it")
    func folds() {
        let title = Array(repeating: "word", count: 40).joined(separator: " ")
        let block = NoteFrontmatter.generate(title: title, createdAt: "", updatedAt: "")
        #expect(block.hasPrefix("---\ntitle: >-\n  word word"))
        #expect(block.split(separator: "\n").allSatisfy { $0.count <= 80 })
        #expect(NoteFrontmatter.parse(block).frontmatter?.title == title)
    }

    @Test("text that is not a mapping, or does not parse, leaves the note without frontmatter")
    func refuses() {
        for text in ["# Just a note\n", "---\njust words\n---\nbody", "---\n- a\n- b\n---\nbody", "---\ntitle: [unclosed\n---\nbody", "---\ntitle: a\ntitle: b\n---\nbody"] {
            let (frontmatter, body) = NoteFrontmatter.parse(text)
            #expect(frontmatter == nil && body == text, "\(text)")
            #expect(NoteFrontmatter.split(text).frontmatter == nil)
        }
    }

    @Test("a header image is set, changed and removed without touching the rest")
    func headerImage() {
        let fallback = (title: "Fallback", createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z")
        let withImage = NoteFrontmatter.withHeaderImage(note, HeaderImage(image: "app_data/a.png", layout: .centered), fallback: fallback)
        #expect(withImage.contains("headerImage: app_data/a.png\nheaderImageLayout: centered\n---\n# Body"))
        #expect(NoteFrontmatter.parse(withImage).frontmatter?.headerImage == HeaderImage(image: "app_data/a.png", layout: .centered))
        #expect(NoteFrontmatter.withHeaderImage(withImage, nil, fallback: fallback) == note)

        let bare = NoteFrontmatter.withHeaderImage("# No block\n", HeaderImage(image: "https://example.com/a.png"), fallback: fallback)
        #expect(bare.hasPrefix("---\ntitle: Fallback\n"))
        #expect(bare.hasSuffix("headerImageLayout: full\n---\n# No block\n"))
    }

    @Test("dates keep their day, and what is not a date is left as written")
    func dates() {
        #expect(NoteFrontmatter.dateOnly("2026-11-06T09:30:00.000Z") == "2026-11-06")
        #expect(NoteFrontmatter.dateOnly("  2026-11-06 09:30 ") == "2026-11-06")
        #expect(NoteFrontmatter.dateOnly("2026-11-06X") == "2026-11-06X")
        #expect(NoteFrontmatter.dateOnly("yesterday") == "yesterday")
        // A date typed by hand is a YAML timestamp; it is read as the day it names.
        #expect(NoteFrontmatter.parse("---\ncreatedAt: 2026-11-06T23:30:00-05:00\n---\n").frontmatter?.createdAt == "2026-11-07")
    }

    @Test("tags are trimmed, empty ones are dropped, and they join with commas")
    func tags() {
        #expect(NoteFrontmatter.tagsToString([" a ", "", "b "]) == "a,b")
        #expect(NoteFrontmatter.tagsFromString(" a , b ,, c ") == ["a", "b", "c"])
        #expect(NoteFrontmatter.parse("---\ntags: a, b\n---\n").frontmatter?.tags == ["a", "b"])
    }

    @Test("JavaScript's spellings of numbers and dates")
    func javascriptText() {
        #expect(JavaScriptText.numberString(1e21) == "1e+21")
        #expect(JavaScriptText.numberString(123_456_789_012_345_680_000) == "123456789012345680000")
        #expect(JavaScriptText.numberString(0.000001) == "0.000001")
        #expect(JavaScriptText.numberString(1e-7) == "1e-7")
        #expect(JavaScriptText.numberString(-1.5) == "-1.5")
        #expect(JavaScriptText.numberString(100) == "100")
        #expect(JavaScriptText.numberString(.infinity) == "Infinity")
        #expect(JavaScriptText.isoString(milliseconds: 0) == "1970-01-01T00:00:00.000Z")
        #expect(JavaScriptText.isoString(milliseconds: -1) == "1969-12-31T23:59:59.999Z")
        #expect(JavaScriptText.trim("\u{FEFF} a \u{A0}\n") == "a")
    }

    @Test("hostile input is refused quickly instead of overflowing or stalling")
    func guards() {
        let deep = "---\ntitle: " + String(repeating: "[", count: 20_000) + "\n---\n"
        #expect(NoteFrontmatter.parse(deep).frontmatter == nil)

        // Forty lists that each hold the one before twice: 2^40 items, shared, never copied. Reading them as tags stops early.
        let chain = "a0: &a0 [x, x]\n" + (1..<40).map { "a\($0): &a\($0) [*a\($0 - 1), *a\($0 - 1)]\n" }.joined()
        var started = Date()
        #expect(NoteFrontmatter.parse("---\n" + chain + "tags: *a39\ntitle: t\n---\n").frontmatter?.title == "t")
        #expect(Date().timeIntervalSince(started) < 5, "aliases of aliases")

        started = Date()
        let big = "---\n" + (0..<20_000).map { "key\($0): value \($0)\n" }.joined() + "title: many\n---\nbody"
        #expect(NoteFrontmatter.parse(big).frontmatter?.title == "many")
        #expect(Date().timeIntervalSince(started) < 5, "20,000 keys")
    }
}
