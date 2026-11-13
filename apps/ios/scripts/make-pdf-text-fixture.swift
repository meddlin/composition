import CoreGraphics
import CoreText
import Foundation

// Writes the PDFs the search of a PDF's own text is checked with (docs/architecture/search.md, "The text of a PDF").
//
//   swiftc -O -o /tmp/pdf-text-fixture apps/ios/scripts/make-pdf-text-fixture.swift
//   /tmp/pdf-text-fixture fixture fixtures/conformance/pdf-text.pdf      the committed fixture: one awkward case a page
//   /tmp/pdf-text-fixture book 600 /tmp/book-600.pdf                     a book of filler text, for timing an index (not committed)
//
// The fixture is an input only. What its text must come to is what the desktop's pdf.js reads from it, through the desktop's own
// `pdfText.ts` (apps/ios/scripts/pdf-text-oracle.mjs writes that into fixtures/conformance/pdf-text.json), and the iPad's PDFKit has to
// agree. CoreText is used because it writes text the way real PDFs carry it: subset TrueType fonts with ToUnicode maps, ligature glyphs.

let letter = CGRect(x: 0, y: 0, width: 612, height: 792)

func font(_ name: String, _ size: CGFloat) -> CTFont { CTFontCreateWithName(name as CFString, size, nil) }

/// One line of text with its baseline at `point`, in the font given (CoreText shapes it: a font with ligatures uses them).
func line(_ text: String, at point: CGPoint, font: CTFont, in context: CGContext, ligatures: Bool = true) {
    var attributes: [NSAttributedString.Key: Any] = [.init(kCTFontAttributeName as String): font]
    attributes[.init(kCTLigatureAttributeName as String)] = ligatures ? 1 : 0
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    context.textPosition = point
    CTLineDraw(line, context)
}

/// A paragraph set into `rect` (top-left origin rules do not apply: PDF space, y up).
func paragraph(_ text: String, in rect: CGRect, font: CTFont, context: CGContext) {
    let attributed = NSAttributedString(string: text, attributes: [.init(kCTFontAttributeName as String): font])
    let setter = CTFramesetterCreateWithAttributedString(attributed)
    let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: rect, transform: nil), nil)
    CTFrameDraw(frame, context)
}

func page(_ context: CGContext, box: CGRect = letter, rotate: Int = 0, _ draw: (CGContext) -> Void) {
    var mediaBox = box
    let info: [CFString: Any] = rotate == 0 ? [kCGPDFContextMediaBox: Data(bytes: &mediaBox, count: MemoryLayout<CGRect>.size)] :
        [kCGPDFContextMediaBox: Data(bytes: &mediaBox, count: MemoryLayout<CGRect>.size), "Rotate" as CFString: rotate]
    context.beginPDFPage(info as CFDictionary)
    draw(context)
    context.endPDFPage()
}

func fixture(to url: URL) {
    var box = letter
    let info: [CFString: Any] = [kCGPDFContextTitle: "Search fixture", kCGPDFContextCreator: "make-pdf-text-fixture.swift"]
    guard let context = CGContext(url as CFURL, mediaBox: &box, info as CFDictionary) else { fatalError("cannot write \(url.path)") }
    let body = font("Helvetica", 14)
    let serif = font("Times New Roman", 16)

    // 1. Plain words, found nowhere else.
    page(context) { c in
        line("Page one: the lighthouse keeper counted quetzals", at: CGPoint(x: 72, y: 700), font: body, in: c)
        line("at the harbour wall, 1987 of them.", at: CGPoint(x: 72, y: 680), font: body, in: c)
    }
    // 2. Ligatures drawn as one glyph (fi, fl, ffi in a serif that has them), and the same words drawn as letters.
    page(context) { c in
        line("The official affidavit flew to the fjord office.", at: CGPoint(x: 72, y: 700), font: serif, in: c)
        line("Spelled out: official affidavit flew.", at: CGPoint(x: 72, y: 676), font: serif, in: c, ligatures: false)
    }
    // 3. A word broken over two lines with a hyphen, a soft hyphen, and a compound with a real hyphen at the end of a line.
    page(context) { c in
        line("Careful extrac-", at: CGPoint(x: 72, y: 700), font: body, in: c)
        line("tion of every term.", at: CGPoint(x: 72, y: 682), font: body, in: c)
        line("A well-", at: CGPoint(x: 72, y: 650), font: body, in: c)
        line("Known name.", at: CGPoint(x: 72, y: 632), font: body, in: c)
        line("Notwith\u{00AD}", at: CGPoint(x: 72, y: 600), font: body, in: c)
        line("standing the rain.", at: CGPoint(x: 72, y: 582), font: body, in: c)
    }
    // 4. Accents, Greek and Cyrillic (the scripts the export supports), and full-width letters.
    page(context) { c in
        line("Café naïve façade Zürich", at: CGPoint(x: 72, y: 700), font: body, in: c)
        line("Ζεύς Αθήνα Москва Санкт", at: CGPoint(x: 72, y: 676), font: font("Helvetica", 14), in: c)
        line("Ｗｉｄｅ letters", at: CGPoint(x: 72, y: 652), font: font("Hiragino Sans W3", 14), in: c)
    }
    // 5. Two columns.
    page(context) { c in
        paragraph("Left column speaks of marmalade and of the tidal estuary near the old mill.", in: CGRect(x: 72, y: 400, width: 220, height: 320), font: body, context: c)
        paragraph("Right column answers with saxophones and a quiet observatory on the hill.", in: CGRect(x: 320, y: 400, width: 220, height: 320), font: body, context: c)
    }
    // 6. A page turned a quarter (its /Rotate is 90): the text is still in its own order.
    page(context, rotate: 90) { c in
        line("Sideways page about cormorants.", at: CGPoint(x: 72, y: 700), font: body, in: c)
    }
    // 7. A "scan": shapes and no text at all.
    page(context) { c in
        c.setFillColor(CGColor(gray: 0.3, alpha: 1))
        for row in 0..<20 { c.fill(CGRect(x: 72, y: 700 - CGFloat(row) * 24, width: CGFloat(200 + (row * 37) % 260), height: 10)) }
    }
    // 8. Punctuation, numbers and a URL, which split into words differently.
    page(context) { c in
        line("Version 3.14 (beta) e-mail: x@example.com", at: CGPoint(x: 72, y: 700), font: body, in: c)
        line("https://example.org/path_to/item-42 — done.", at: CGPoint(x: 72, y: 676), font: body, in: c)
    }
    context.closePDF()
}

/// A book of `pages` pages of filler text, about 400 words a page, for timing.
func book(pages: Int, to url: URL) {
    var box = letter
    guard let context = CGContext(url as CFURL, mediaBox: &box, nil) else { fatalError("cannot write \(url.path)") }
    let body = font("Times New Roman", 11)
    let words = """
        the of and to in a is that for it as was with be by on not he this are or his from at which but have an they you were her one all we can
        there their has been if more when will would who so no she other its may these about than into them could time only new some what like
        then also two any first after where most such over those between through each because many very even same during before under while
        harbour lighthouse estuary observatory marmalade cormorant saxophone affidavit quetzal meridian latitude parallax archipelago
        """.split(whereSeparator: \.isWhitespace).map(String.init)
    var generator = SystemRandomNumberGenerator()
    for number in 1...pages {
        page(context) { c in
            var text = "Chapter page \(number). "
            for _ in 0..<400 { text += words[Int(generator.next() % UInt64(words.count))] + " " }
            paragraph(text, in: CGRect(x: 72, y: 72, width: 468, height: 648), font: body, context: c)
        }
    }
    context.closePDF()
}

let args = CommandLine.arguments
switch args.dropFirst().first {
case "fixture" where args.count == 3: fixture(to: URL(fileURLWithPath: args[2]))
case "book" where args.count == 4: book(pages: Int(args[2])!, to: URL(fileURLWithPath: args[3]))
default: fatalError("usage: make-pdf-text-fixture fixture OUT.pdf | book PAGES OUT.pdf")
}
