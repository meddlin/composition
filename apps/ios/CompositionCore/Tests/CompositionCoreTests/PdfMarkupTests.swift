import Foundation
import GRDB
import Testing

@testable import CompositionCore

// The PDF rules the shared corpus (PdfConformanceTests.swift) does not pin, and the parts of the repositories it does not reach.
// Where a rule is JavaScript's (how a number is written, how a half rounds, what counts as white space, what `length` counts), the
// expected values were made by running the desktop's own `pdfMarkup.ts` and a JavaScript engine over the inputs, not written by hand.

@Suite("PDF marks and their JSON")
struct PdfMarkupTests {
    private func highlight(_ changes: (inout PdfMarkInput) -> Void = { _ in }) -> PdfMarkInput {
        var input = PdfMarkInput(page: 0, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 0, y0: 0, x1: 1, y1: 1)])
        changes(&input)
        return input
    }

    private func ink(_ changes: (inout PdfMarkInput) -> Void = { _ in }) -> PdfMarkInput {
        var input = PdfMarkInput(page: 0, kind: .ink, color: "black", body: .object(JSONObject()))
        changes(&input)
        return input
    }

    private func note(_ changes: (inout PdfMarkInput) -> Void = { _ in }) -> PdfMarkInput {
        var input = PdfMarkInput(page: 0, kind: .text, color: "yellow", body: PdfTextNoteBody(rect: PdfRect(x0: 0, y0: 0, x1: 1, y1: 1), text: "x").json)
        changes(&input)
        return input
    }

    private func refused(_ input: PdfMarkInput) -> String? {
        do {
            _ = try PdfMarkup.validate(input)
            return nil
        } catch let error as InvalidMarkError {
            return error.message
        } catch {
            return "NOT AN InvalidMarkError: \(error)"
        }
    }

    // MARK: JSON

    @Test("a number is written the way JSON.stringify writes it")
    func numbersAreWrittenLikeJavaScript() throws {
        // [text, JSON.stringify(JSON.parse(text))], from node
        let cases: [(String, String)] = [
            ("0", "0"), ("-0", "0"), ("1", "1"), ("12", "12"), ("12.5", "12.5"), ("0.1", "0.1"), ("0.30000000000000004", "0.30000000000000004"),
            ("100.123", "100.123"), ("1e21", "1e+21"), ("1e-7", "1e-7"), ("0.000001", "0.000001"), ("0.0000001", "1e-7"),
            ("123456789012345680000", "123456789012345680000"), ("1.5e300", "1.5e+300"), ("5e-324", "5e-324"), ("1e16", "10000000000000000"),
            ("123456789.123456789", "123456789.12345679"), ("-2.5e-7", "-2.5e-7"), ("1.7976931348623157e308", "1.7976931348623157e+308"),
            ("4.35", "4.35"), ("-1.5", "-1.5"), ("12345678901234567890", "12345678901234567000"), ("0.00001234", "0.00001234"),
            ("9007199254740993", "9007199254740992"),
        ]
        for (text, expected) in cases {
            #expect(try JSONValue(parsing: text).serialized() == expected, "\(text)")
        }
        #expect(JSONValue.number(.nan).serialized() == "null" && JSONValue.number(.infinity).serialized() == "null")
    }

    @Test("an object keeps the order of its members, and a value comes back as it went in")
    func jsonRoundTrips() throws {
        let text = #"{"z":1,"a":[true,false,null,"x\ny\"\\\u0001é😀"],"m":{"b":2.5,"a":{}},"e":[]}"#
        let value = try JSONValue(parsing: text)
        #expect(value.serialized() == #"{"z":1,"a":[true,false,null,"x\ny\"\\\u0001é😀"],"m":{"b":2.5,"a":{}},"e":[]}"#)
        #expect(value.objectValue?.members.map(\.key) == ["z", "a", "m", "e"])
        #expect(try JSONValue(parsing: value.serialized()) == value)
        // Equal as JSON means equal whatever the order
        #expect(try JSONValue(parsing: #"{"a":1,"b":2}"#) == JSONValue(parsing: #"{"b":2,"a":1}"#))
        #expect(try JSONValue(parsing: #"{"a":1,"b":2}"#) != JSONValue(parsing: #"{"a":1,"b":3}"#))
        // A key given twice keeps its first place and its last value
        #expect(try JSONValue(parsing: #"{"a":1,"b":2,"a":3}"#).serialized() == #"{"a":3,"b":2}"#)
        // Escapes: a surrogate pair is one character, a lone surrogate becomes the replacement character
        #expect(try JSONValue(parsing: #""\ud83d\ude00 \/""#) == .string("😀 /"))
        #expect(try JSONValue(parsing: #""\ud83d""#) == .string("\u{fffd}"))
        #expect(try JSONValue(parsing: " \n[1 , 2]\t").serialized() == "[1,2]")
    }

    @Test("JSON that is not strict JSON is refused")
    func jsonIsStrict() {
        let bad = ["", "[1,]", "{\"a\":1,}", "{a:1}", "01", "1.", ".5", "+1", "1e", "[1] 2", "nul", "'a'", "\"a", "\"\u{1}\"", "\"\\x\"", "{\"a\" 1}", "[1 2]", "1e999", "-", "[", "\"\\u12\""]
        for text in bad {
            #expect(throws: JSONParseError.self, "\(text.debugDescription)") { try JSONValue(parsing: text) }
        }
        #expect(throws: JSONParseError.self) { try JSONValue(parsing: String(repeating: "[", count: 300) + String(repeating: "]", count: 300)) }
        #expect(throws: Never.self) { try JSONValue(parsing: String(repeating: "[", count: 200) + String(repeating: "]", count: 200)) }
    }

    // MARK: Rounding, one line, length

    @Test("a coordinate rounds to a thousandth, a half toward +infinity as JavaScript's Math.round does")
    func roundingIsJavaScripts() throws {
        // [x, x0 of the rectangle [x, 0, x + 100, 1] after the desktop validated it], from pdfMarkup.ts
        let cases: [(Double, Double)] = [
            (0.0005, 0.001), (-0.0005, 0), (-0.0015, -0.001), (1.0005, 1.001), (0.00025, 0), (-0.00025, 0), (1.2345, 1.235), (-1.2345, -1.234),
            (8.0005, 8.001), (-8.0005, -8.001), (0.0015, 0.002), (-0.0025, -0.002),
        ]
        for (x, expected) in cases {
            #expect(try PdfRect(x0: x, y0: 0, x1: x + 100, y1: 1).normalized().x0 == expected, "\(x)")
        }
    }

    @Test("a label or comment becomes one line the way the desktop's regular expression makes it")
    func oneLineIsJavaScripts() throws {
        // [text, validateBookmarkLabel(text)], from pdfMarkup.ts
        let cases: [(String, String)] = [
            ("a\u{a}b", "a b"), (" a \u{d}\u{a} b ", "a b"), ("a\u{a0}\u{a}b", "a b"), ("a\u{2028}b", "a\u{2028}b"), ("\u{feff}a\u{feff}", "a"),
            ("\u{85}a\u{85}", "\u{85}a\u{85}"), ("a \u{9} b", "a \u{9} b"), ("a\u{a}\u{a}\u{a}b", "a b"), ("\u{a}\u{a}", ""), ("a\u{2028}\u{a}b", "a b"),
            ("x\u{b}\u{c}\u{a} y", "x y"), ("\u{3000}a\u{3000}", "a"), ("a\u{180e}b", "a\u{180e}b"), ("\u{2029}a\u{2029}", "a"),
        ]
        for (text, expected) in cases {
            #expect(try PdfMarkup.validateBookmarkLabel(text) == expected, "\(text.unicodeScalars.map { String($0.value, radix: 16) })")
        }
        // "\r\n" is one Character to Swift and two characters to the rule
        #expect(try PdfMarkup.validateBookmarkLabel("a\r\nb\r\n") == "a b")
    }

    @Test("a limit counts UTF-16 units, as the desktop's `length` does: an emoji is two")
    func limitsCountUtf16() throws {
        let emoji = "\u{1F600}"
        #expect(try PdfMarkup.validateBookmarkLabel(String(repeating: emoji, count: 100)).utf16.count == 200)
        #expect(throws: InvalidMarkError.self) { try PdfMarkup.validateBookmarkLabel(String(repeating: emoji, count: 101)) }
        // "é" as e + a combining accent is two units and one Character
        #expect(try PdfMarkup.validateBookmarkLabel(String(repeating: "e\u{301}", count: 100)).count == 100)
        #expect(throws: InvalidMarkError.self) { try PdfMarkup.validateBookmarkLabel(String(repeating: "e\u{301}", count: 101)) }
        #expect(refused(highlight { $0.comment = String(repeating: emoji, count: 250) }) == nil)
        #expect(refused(highlight { $0.comment = String(repeating: emoji, count: 251) }) == "A comment can be at most 500 characters.")
        // the limit is on the line the comment becomes, not on what was typed around it
        #expect(refused(highlight { $0.comment = "\n" + String(repeating: "a", count: 500) + "\n" }) == nil)
    }

    // MARK: Marks the corpus does not try

    @Test("a mark is refused or kept as the desktop's validateAnnotation does, with its words")
    func moreMarks() throws {
        let colorMessage = "A color is a lowercase name."
        #expect(refused(ink { $0.color = String(repeating: "a", count: 32) }) == nil)
        #expect(refused(ink { $0.color = String(repeating: "a", count: 33) }) == colorMessage)
        #expect(refused(ink { $0.color = "1a" }) == colorMessage)
        #expect(refused(ink { $0.color = "a_b" }) == colorMessage)
        #expect(refused(ink { $0.color = "" }) == colorMessage)
        #expect(refused(ink { $0.color = "a-b-1" }) == nil)
        #expect(refused(highlight { $0.color = "ink-blue" }) == "A highlight is yellow, green, blue, pink, orange.")
        #expect(refused(highlight { $0.color = "orange" }) == nil)

        #expect(refused(note { $0.body = .array([]) }) == "A text note's body is its rect and its text.")
        #expect(refused(note { $0.body = .null }) == "A text note's body is its rect and its text.")
        #expect(refused(ink { $0.body = .null }) == "Ink needs its strokes as the body.")
        #expect(refused(ink { $0.rects = [] }) == "A ink has a body, not rectangles.")
        #expect(refused(highlight { $0.body = .null }) == nil)

        func sized(_ size: JSONValue) -> PdfMarkInput {
            note { $0.body = .object(JSONObject(["rect": PdfRect(x0: 0, y0: 0, x1: 1, y1: 1).json, "text": .string("x"), "fontSize": size])) }
        }
        let sizeMessage = "A text note's font size is from 1 to 200."
        #expect(refused(sized(.null)) == sizeMessage)
        #expect(refused(sized(.number(200.0004))) == sizeMessage)
        #expect(refused(sized(.number(0.9996))) == sizeMessage)
        #expect(refused(sized(.string("12"))) == sizeMessage)
        #expect(refused(sized(.number(1))) == nil && refused(sized(.number(200))) == nil)

        // the box is put in order, the keys the desktop does not know are dropped
        let extra = JSONValue.object(JSONObject(["rect": PdfRect(x0: 3, y0: 3, x1: 1, y1: 1).json, "text": .string("x"), "extra": .number(1)]))
        #expect(try PdfMarkup.validate(note { $0.body = extra }).body?.serialized() == #"{"rect":[1,1,3,3],"text":"x"}"#)

        let wide = PdfRect(x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7)
        #expect(refused(highlight { $0.rects = [wide] }) == nil)
        for bad in [PdfRect(x0: 0, y0: 0, x1: 10_000_001, y1: 1), PdfRect(x0: 0, y0: 0, x1: .nan, y1: 1), PdfRect(x0: 0, y0: 0, x1: .infinity, y1: 1)] {
            #expect(refused(highlight { $0.rects = [bad] }) == "A rectangle is four finite numbers: x0, y0, x1, y1.")
        }

        #expect(refused(highlight { $0.groupUuid = "0123456789ABCDEF0123456789abcdef" }) == "A group is a 32-character lowercase hex uuid.")
        #expect(refused(highlight { $0.groupUuid = "0123456789abcdef0123456789abcdef0" }) == "A group is a 32-character lowercase hex uuid.")
        #expect(refused(highlight { $0.page = -1 }) == "A page is a whole number from 0.")
        // a quote is kept as it is, line breaks and all
        #expect(try PdfMarkup.validate(highlight { $0.quote = "  a\nb  " }).quote == "  a\nb  ")
    }

    @Test("a reading position keeps what is sane and drops the rest")
    func viewStates() throws {
        func normalized(_ text: String) throws -> String { PdfViewState(normalizing: try JSONValue(parsing: text)).json.serialized() }
        // from normalizeViewState in pdfMarkup.ts
        #expect(try normalized(#"{"zoom":0.1}"#) == #"{"zoom":0.1}"#)
        #expect(try normalized(#"{"zoom":10}"#) == #"{"zoom":10}"#)
        #expect(try normalized(#"{"zoom":0.0999}"#) == "{}")
        #expect(try normalized(#"{"zoom":1.0005}"#) == #"{"zoom":1.001}"#)
        #expect(try normalized(#"{"zoom":-1}"#) == "{}")
        #expect(try normalized(#"{"page":0}"#) == #"{"page":0}"#)
        #expect(try normalized(#"{"page":1.0}"#) == #"{"page":1}"#)
        #expect(try normalized(#"{"darkPages":false}"#) == #"{"darkPages":false}"#)
        #expect(try normalized("[]") == "{}")
        #expect(try normalized(#"{"page":"3","zoom":"2"}"#) == "{}")
        #expect(try normalized(#"{"zoom":null}"#) == "{}")
        #expect(try normalized(#"{"page":9007199254740991}"#) == #"{"page":9007199254740991}"#)
        // The one place this differs from the desktop, which keeps any whole number: no PDF has more than 2^53 - 1 pages.
        #expect(try normalized(#"{"page":1e300}"#) == "{}")

        #expect(PdfViewState(storedJSON: nil) == PdfViewState() && PdfViewState(storedJSON: "") == PdfViewState() && PdfViewState(storedJSON: "{damaged") == PdfViewState())
        #expect(PdfViewState(page: -3, zoom: .nan, darkPages: true).normalized() == PdfViewState(darkPages: true))
    }

    // MARK: The repositories, past the corpus

    private func withDatabase<T>(_ body: (CompositionDatabase) throws -> T) throws -> T {
        try withScratch { scratch in
            let database = try CompositionDatabase.open(at: scratch.databaseURL)
            defer { try? database.close() }
            return try body(database)
        }
    }

    private func count(_ database: CompositionDatabase, _ table: String) throws -> Int {
        try database.pool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM \(table)") ?? 0 }
    }

    private func nextIds(_ database: CompositionDatabase) throws -> [String: Int64] {
        try database.pool.read { db in
            Dictionary(uniqueKeysWithValues: try Row.fetchAll(db, sql: "SELECT name, seq FROM sqlite_sequence WHERE name IN ('documents', 'pdf_annotations', 'pdf_bookmarks')").map { ($0["name"] as String, $0["seq"] as Int64) })
        }
    }

    @Test("a PDF is found by its note, its uuid and its bytes, and a reading position is stored whole")
    func documentLookups() throws {
        try withDatabase { database in
            let first = try database.createNote(title: "A"), second = try database.createNote(title: "B")
            let a = try database.addDocument(noteId: first.id, fileName: "a.pdf", storedName: "000000000001-a.pdf", sha256: "11", size: 5_000_000_000, pageCount: 0)
            let b = try database.addDocument(noteId: second.id, fileName: "b.pdf", storedName: "000000000002-b.pdf", sha256: "11", size: 2, pageCount: 3)
            #expect(a.size == 5_000_000_000 && a.pageCount == 0 && a.viewState == PdfViewState() && isUuid(a.uuid) && Timestamp.milliseconds(from: a.createdAt) != nil)
            #expect(try database.document(id: b.id) == b && database.document(uuid: a.uuid) == a && database.documentForNote(first.id) == a)
            #expect(try database.document(id: 99) == nil && database.document(uuid: "nope") == nil && database.documentForNote(99) == nil)
            #expect(try database.documents(sha256: "11") == [a, b] && database.documents(sha256: "22").isEmpty && database.listDocuments() == [a, b])

            try database.setViewState(id: a.id, state: PdfViewState())
            #expect(try database.pool.read { try String.fetchOne($0, sql: "SELECT view_state FROM documents WHERE id = ?", arguments: [a.id]) } == "{}")
            try database.setViewState(id: b.id, state: PdfViewState(page: 7, zoom: 2.0004, darkPages: false))
            #expect(try database.document(id: b.id)?.viewState == PdfViewState(page: 7, zoom: 2, darkPages: false))
            try database.setViewState(id: 99, state: PdfViewState(page: 1))  // a PDF that is gone: nothing happens

            #expect(throws: DocumentError.invalidPageCount) { try database.setPageCount(id: a.id, pageCount: 0) }
            try database.setPageCount(id: a.id, pageCount: 12)
            #expect(try database.document(id: a.id)?.pageCount == 12)
            #expect(DocumentError.noNote.localizedDescription == "That note no longer exists." && DocumentError.hasDocument.localizedDescription == "That note already has a PDF.")
        }
    }

    @Test("marks and bookmarks come back in order, by page, by uuid, and only on the pages that were asked for")
    func listings() throws {
        try withDatabase { database in
            let owner = try database.createNote(title: "A")
            let document = try database.addDocument(noteId: owner.id, fileName: "a.pdf", storedName: "000000000001-a.pdf", sha256: "11", size: 1, pageCount: 20)
            let rect = [PdfRect(x0: 0, y0: 0, x1: 1, y1: 1)]
            let late = try database.addAnnotation(documentId: document.id, PdfMarkInput(page: 9, kind: .highlight, color: "yellow", rects: rect))
            let early = try database.addAnnotation(documentId: document.id, PdfMarkInput(page: 2, kind: .underline, color: "green", rects: rect))
            let again = try database.addAnnotation(documentId: document.id, PdfMarkInput(page: 9, kind: .strikethrough, color: "pink", rects: rect))
            #expect(try database.annotations(documentId: document.id) == [early, late, again], "by page, then by when")
            #expect(try database.annotations(documentId: document.id, page: 9) == [late, again])
            #expect(try database.annotations(documentId: document.id, page: 3).isEmpty && database.annotations(documentId: 99).isEmpty)
            #expect(try database.annotation(id: early.id) == early && database.annotation(uuid: again.uuid) == again && database.annotation(id: 99) == nil)

            let far = try database.addBookmark(documentId: document.id, page: 15, label: "far")
            let near = try database.addBookmark(documentId: document.id, page: 1)
            #expect(try database.bookmarks(documentId: document.id) == [near, far] && database.bookmark(id: far.id) == far && database.bookmark(id: 99) == nil)
            #expect(try database.renameBookmark(id: 99, label: "x") == nil)
            #expect(throws: InvalidMarkError.self) { try database.renameBookmark(id: 99, label: String(repeating: "x", count: 201)) }
            #expect(throws: InvalidMarkError.self) { try database.addBookmark(documentId: document.id, page: -1) }
        }
    }

    @Test("a mark changed to something invalid, or a group with one bad page, leaves everything as it was, the next id too")
    func refusalsChangeNothing() throws {
        try withDatabase { database in
            let owner = try database.createNote(title: "A")
            let document = try database.addDocument(noteId: owner.id, fileName: "a.pdf", storedName: "000000000001-a.pdf", sha256: "11", size: 1, pageCount: 5)
            let mark = try database.addAnnotation(documentId: document.id, PdfMarkInput(page: 1, kind: .highlight, color: "yellow", rects: [PdfRect(x0: 0, y0: 0, x1: 1, y1: 1)], comment: "kept"))
            let ids = try nextIds(database)

            #expect(throws: InvalidMarkError.self) { try database.updateAnnotation(id: mark.id, changes: PdfMarkChanges(color: "red")) }
            #expect(throws: InvalidMarkError.self) { try database.updateAnnotation(id: mark.id, changes: PdfMarkChanges(comment: "changed", rects: .some(nil))) }
            #expect(throws: InvalidMarkError.self) { try database.updateAnnotation(id: mark.id, changes: PdfMarkChanges(body: .object(JSONObject()))) }
            #expect(try database.annotation(id: mark.id) == mark)

            let rect = [PdfRect(x0: 0, y0: 0, x1: 1, y1: 1)]
            #expect(throws: InvalidMarkError.self) {
                try database.addAnnotationGroup(documentId: document.id, [PdfMarkInput(page: 1, kind: .highlight, color: "pink", rects: rect), PdfMarkInput(page: 5, kind: .highlight, color: "pink", rects: rect)])
            }
            #expect(throws: InvalidMarkError.self) {
                try database.addAnnotationGroup(documentId: document.id, [PdfMarkInput(page: 1, kind: .highlight, color: "pink", rects: rect), PdfMarkInput(page: 2, kind: .ink, color: "black", body: .array([]))])
            }
            #expect(try count(database, "pdf_annotations") == 1 && nextIds(database) == ids)
            #expect(try database.updateAnnotation(id: 99, changes: PdfMarkChanges(comment: "x")) == nil)
            #expect(try database.addAnnotationGroup(documentId: document.id, []).isEmpty)
        }
    }

    @Test("an update changes what it names, can move a text note, and keeps the page, the kind and the group")
    func updates() throws {
        try withDatabase { database in
            let owner = try database.createNote(title: "A")
            let document = try database.addDocument(noteId: owner.id, fileName: "a.pdf", storedName: "000000000001-a.pdf", sha256: "11", size: 1, pageCount: 5)
            let rect = [PdfRect(x0: 0, y0: 0, x1: 1, y1: 1)]
            let pair = try database.addAnnotationGroup(documentId: document.id, [PdfMarkInput(page: 1, kind: .highlight, color: "pink", rects: rect, quote: "q"), PdfMarkInput(page: 2, kind: .highlight, color: "pink", rects: rect)])
            // a group the caller names is replaced by the one made here
            let named = try database.addAnnotationGroup(documentId: document.id, [PdfMarkInput(page: 0, kind: .underline, color: "blue", rects: rect, groupUuid: "0123456789abcdef0123456789abcdef")])
            #expect(named[0].groupUuid == nil && pair[0].groupUuid != nil && pair[0].groupUuid == pair[1].groupUuid)

            let moved = try #require(try database.updateAnnotation(id: pair[0].id, changes: PdfMarkChanges(color: "green", comment: " two\nlines ", rects: [PdfRect(x0: 9, y0: 8, x1: 1.00049, y1: 2)])))
            #expect(moved.rects == [PdfRect(x0: 1, y0: 2, x1: 9, y1: 8)] && moved.comment == "two lines" && moved.color == "green" && moved.quote == "q")
            #expect((moved.page, moved.kind, moved.groupUuid, moved.createdAt) == (pair[0].page, pair[0].kind, pair[0].groupUuid, pair[0].createdAt))

            let box = PdfTextNoteBody(rect: PdfRect(x0: 0, y0: 0, x1: 10, y1: 10), text: "hello", fontSize: 14)
            let text = try database.addAnnotation(documentId: document.id, PdfMarkInput(page: 3, kind: .text, color: "yellow", body: box.json))
            #expect(text.body.flatMap(PdfTextNoteBody.init) == box)
            let edited = PdfTextNoteBody(rect: PdfRect(x0: 5, y0: 5, x1: 20, y1: 20), text: "moved")
            let changed = try #require(try database.updateAnnotation(id: text.id, changes: PdfMarkChanges(body: edited.json)))
            #expect(changed.body.flatMap(PdfTextNoteBody.init) == edited && changed.rects == nil)
            #expect(try database.updateAnnotation(id: text.id, changes: PdfMarkChanges())?.body == changed.body, "nothing named, nothing changed")
        }
    }

    @Test("a row the desktop wrote reads, and a row this build cannot read is an error rather than a wrong mark")
    func readingRows() throws {
        try withDatabase { database in
            let owner = try database.createNote(title: "A")
            let document = try database.addDocument(noteId: owner.id, fileName: "a.pdf", storedName: "000000000001-a.pdf", sha256: "11", size: 1, pageCount: 0)
            try database.pool.write { db in
                try db.execute(sql: """
                    INSERT INTO pdf_annotations (document_id, page, kind, color, rects, body, created_at, updated_at)
                    VALUES (?, 4, 'highlight', 'yellow', '[[72.5,600,300.25,620],[72.5,580,210,600]]', NULL, 'x', 'x'),
                           (?, 5, 'text', 'orange', NULL, '{"rect":[400,100,560,160],"text":"Margin note","fontSize":12}', 'x', 'x')
                    """, arguments: [document.id, document.id])
            }
            let marks = try database.annotations(documentId: document.id)
            #expect(marks.map(\.page) == [4, 5] && marks.allSatisfy { isUuid($0.uuid) })
            #expect(marks[0].rects == [PdfRect(x0: 72.5, y0: 600, x1: 300.25, y1: 620), PdfRect(x0: 72.5, y0: 580, x1: 210, y1: 600)])
            #expect(marks[1].body.flatMap(PdfTextNoteBody.init) == PdfTextNoteBody(rect: PdfRect(x0: 400, y0: 100, x1: 560, y1: 160), text: "Margin note", fontSize: 12))

            for (column, value, message) in [("kind", "'squiggle'", "Unknown kind of mark: squiggle."), ("rects", "'[[1,2,3]]'", "A mark's rectangles are damaged."), ("rects", "'{'", "A mark's rectangles are damaged."), ("body", "'{'", "A mark's body is damaged.")] {
                try database.pool.write { try $0.execute(sql: "UPDATE pdf_annotations SET \(column) = \(value) WHERE page = 4") }
                #expect(throws: InvalidMarkError(message)) { try database.annotations(documentId: document.id) }
                try database.pool.write { try $0.execute(sql: "UPDATE pdf_annotations SET kind = 'highlight', rects = '[[0,0,1,1]]', body = NULL WHERE page = 4") }
            }
        }
    }

    @Test("dropping orphans also drops the marks and bookmarks of a PDF that is already gone")
    func strayRows() throws {
        try withDatabase { database in
            try database.pool.write { db in
                try db.execute(sql: "INSERT INTO pdf_annotations (document_id, page, kind, color, created_at, updated_at) VALUES (999, 0, 'highlight', 'yellow', 'x', 'x')")
                try db.execute(sql: "INSERT INTO pdf_bookmarks (document_id, page, created_at) VALUES (999, 0, 'x')")
            }
            #expect(try database.deleteOrphanedDocuments().isEmpty)
            #expect(try count(database, "pdf_annotations") == 0 && count(database, "pdf_bookmarks") == 0)
        }
    }
}
