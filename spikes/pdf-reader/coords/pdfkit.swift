// Spike C, PDFKit side (macOS; PDFKit is the same framework the iPad uses).
// build: swiftc -O coords/pdfkit.swift -o pdfkit-check     run: ./pdfkit-check geometry.pdf > pdfkit.json
// Same fixture as coords/pdfjs.mjs: a red square at raw user-space (100,100)-(150,150) and the text ANCHOR TEXT, baseline (100,300).
// Per page it reports PDFKit's geometry, where the red square appears in a rendered page, where PDFKit says the text is in page
// space, and what changes on the page when an annotation positioned with the raw rectangle is added to it.
import AppKit
import PDFKit

guard CommandLine.arguments.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    FileHandle.standardError.write(Data("usage: pdfkit-check geometry.pdf\n".utf8))
    exit(1)
}

let raw = CGRect(x: 100, y: 100, width: 50, height: 50)
let scale: CGFloat = 2

func box(_ r: CGRect) -> [Double] { [r.minX, r.minY, r.maxX, r.maxY].map { Double($0) } }
func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

/// RGBA pixels of a rendered page, top-left origin.
struct Pixels {
    let width: Int
    let height: Int
    let data: [UInt8]
    func at(_ x: Int, _ y: Int) -> (Int, Int, Int) {
        let i = (y * width + x) * 4
        return (Int(data[i]), Int(data[i + 1]), Int(data[i + 2]))
    }
}

func render(_ page: PDFPage, size: CGSize) -> Pixels {
    let image = page.thumbnail(of: size, for: .cropBox)
    var rect = CGRect(origin: .zero, size: image.size)
    guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { fatalError("no cgImage") }
    let w = cg.width, h = cg.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    return Pixels(width: w, height: h, data: data)
}

typealias PxBox = (x0: Int, y0: Int, x1: Int, y1: Int)
func pts(_ b: PxBox?) -> [Double]? { b.map { [Double($0.x0), Double($0.y0), Double($0.x1), Double($0.y1)].map { round2($0 / Double(scale)) } } }

/// Pure-red pixels and their extent (px).
func red(_ p: Pixels) -> (count: Int, box: PxBox?) {
    var n = 0
    var b: PxBox = (p.width, p.height, -1, -1)
    for y in 0..<p.height {
        for x in 0..<p.width {
            let (r, g, bl) = p.at(x, y)
            if r > 200 && g < 80 && bl < 80 {
                n += 1
                b = (min(b.x0, x), min(b.y0, y), max(b.x1, x + 1), max(b.y1, y + 1))
            }
        }
    }
    return (n, n > 0 ? b : nil)
}

/// Pixels that differ between two renders: how many, their extent, and how many lie outside `around` (grown by 2 px).
func changed(_ a: Pixels, _ b: Pixels, around: PxBox?) -> (count: Int, box: PxBox?, outside: Int) {
    var n = 0, outside = 0
    var box: PxBox = (a.width, a.height, -1, -1)
    for y in 0..<a.height {
        for x in 0..<a.width {
            let (r1, g1, b1) = a.at(x, y), (r2, g2, b2) = b.at(x, y)
            if abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2) > 30 {
                n += 1
                box = (min(box.x0, x), min(box.y0, y), max(box.x1, x + 1), max(box.y1, y + 1))
                if let r = around, !(x >= r.x0 - 2 && x < r.x1 + 2 && y >= r.y0 - 2 && y < r.y1 + 2) { outside += 1 }
            }
        }
    }
    return (n, n > 0 ? box : nil, outside)
}

var out: [[String: Any]] = []
for i in 0..<doc.pageCount {
    let page = doc.page(at: i)!
    let crop = page.bounds(for: .cropBox)
    let media = page.bounds(for: .mediaBox)
    // bounds(for:) is the unrotated box; the page is displayed with width and height swapped at 90 and 270
    let turned = page.rotation % 180 != 0
    let size = CGSize(width: (turned ? crop.height : crop.width) * scale, height: (turned ? crop.width : crop.height) * scale)

    var row: [String: Any] = [
        "index": i, "rotation": page.rotation, "crop": box(crop), "media": box(media),
        "displayed": [Double(size.width / scale), Double(size.height / scale)],
    ]

    if let sel = doc.findString("ANCHOR TEXT", withOptions: []).first(where: { $0.pages.contains(page) }) {
        let b = sel.bounds(for: page)
        row["text"] = ["x": round2(b.minX), "y": round2(b.minY), "width": round2(b.width), "height": round2(b.height)]
    }

    let base = render(page, size: size)
    let r0 = red(base)
    row["redCount"] = r0.count
    row["redRectViewport"] = pts(r0.box) as Any

    // 1. a square annotation whose bounds are the raw rectangle: does it cover the red square exactly?
    let square = PDFAnnotation(bounds: raw, forType: .square, withProperties: nil)
    square.color = NSColor.blue
    square.interiorColor = NSColor.blue
    let border = PDFBorder(); border.lineWidth = 0
    square.border = border
    page.addAnnotation(square)
    let sq = render(page, size: size)
    row["square"] = ["redLeft": red(sq).count, "changedOutsideRect": changed(base, sq, around: r0.box).outside]
    page.removeAnnotation(square)

    // 2. a highlight with bounds = the raw rectangle and quad points RELATIVE to the bounds' origin (top-left, top-right, bottom-left, bottom-right)
    func highlight(_ quad: [CGPoint]) -> [String: Any] {
        let hl = PDFAnnotation(bounds: raw, forType: .highlight, withProperties: nil)
        hl.color = NSColor(red: 0, green: 1, blue: 0, alpha: 1)
        hl.quadrilateralPoints = quad.map { NSValue(point: $0) }
        page.addAnnotation(hl)
        let r = render(page, size: size)
        page.removeAnnotation(hl)
        let c = changed(base, r, around: r0.box)
        return ["changedPixels": c.count, "changedBox": pts(c.box) as Any, "changedOutsideRect": c.outside]
    }
    row["highlightRelative"] = highlight([CGPoint(x: 0, y: 50), CGPoint(x: 50, y: 50), CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 0)])
    // 3. the same quad written in page space (absolute): the mistake the relative form avoids
    row["highlightAbsolute"] = highlight([CGPoint(x: 100, y: 150), CGPoint(x: 150, y: 150), CGPoint(x: 100, y: 100), CGPoint(x: 150, y: 100)])

    out.append(row)
}
let json = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
print(String(data: json, encoding: .utf8)!)
