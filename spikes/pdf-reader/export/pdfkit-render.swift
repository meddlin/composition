// Spike D, PDFKit side (macOS). build: swiftc -O export/pdfkit-render.swift -o pdfkit-render
// run: ./pdfkit-render out.pdf renders/ [0,5,9]   writes renders/p0.png ... (scale 2, crop box, annotations drawn) and prints, per page,
// the annotations PDFKit read from the file: type, bounds, contents. This is what the iPad (and Preview) would see. A third
// argument limits it to those pages (0-based), for a file of hundreds.
import AppKit
import PDFKit

guard CommandLine.arguments.count > 2, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    FileHandle.standardError.write(Data("usage: pdfkit-render file.pdf outdir\n".utf8))
    exit(1)
}
let outDir = URL(fileURLWithPath: CommandLine.arguments[2])
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let scale: CGFloat = 2

let only: [Int]? = CommandLine.arguments.count > 3 && !CommandLine.arguments[3].isEmpty ? CommandLine.arguments[3].split(separator: ",").compactMap { Int($0) } : nil
var pages: [[String: Any]] = []
for i in (only ?? Array(0..<doc.pageCount)) where i < doc.pageCount {
    let page = doc.page(at: i)!
    let crop = page.bounds(for: .cropBox)
    let turned = page.rotation % 180 != 0
    let size = CGSize(width: (turned ? crop.height : crop.width) * scale, height: (turned ? crop.width : crop.height) * scale)
    let image = page.thumbnail(of: size, for: .cropBox)
    var rect = CGRect(origin: .zero, size: image.size)
    let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)!
    let w = cg.width, h = cg.height
    // draw on white so transparent areas read as white, then write a PNG
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    let png = NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
    try png.write(to: outDir.appendingPathComponent("p\(i).png"))

    let annots: [[String: Any]] = page.annotations.map { a in
        ["type": a.type ?? "", "bounds": [a.bounds.minX, a.bounds.minY, a.bounds.maxX, a.bounds.maxY].map { Double($0) },
         "contents": a.contents ?? "", "quadPoints": (a.quadrilateralPoints ?? []).count]
    }
    pages.append(["index": i, "size": [Double(w) / Double(scale), Double(h) / Double(scale)], "annotations": annots])
}
let json = try JSONSerialization.data(withJSONObject: pages, options: [.prettyPrinted, .sortedKeys])
print(String(data: json, encoding: .utf8)!)
