import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// The last step of build.sh: takes the PNG that rsvg-convert drew and writes the PNG the asset catalog holds, with the pixel format Apple asks for.
//   finish-icon <mode> in.png out.png
//   opaque       colour, sRGB, no alpha channel (the "Any" icon, which is also the App Store icon: the upload refuses an alpha channel, ITMS-90717)
//   transparent  colour, sRGB, alpha kept (the "Dark" icon: Xcode asks for a transparent background so the system's own shows through)
//   gray         grayscale, Gray Gamma 2.2, no alpha channel (the "Tinted" icon: Xcode asks for a grayscale image)
// It checks the size (exactly 1024 x 1024) and, for the two opaque modes, that no pixel is even slightly transparent.
let args = CommandLine.arguments
guard args.count == 4, let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, nil), let art = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("usage: finish-icon opaque|transparent|gray in.png out.png")
}
let side = 1024
guard art.width == side, art.height == side else { fatalError("\(args[2]) is \(art.width) x \(art.height), not \(side) x \(side)") }

// Read the drawn pixels as premultiplied sRGB to look at their alpha.
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
var pixels = [UInt8](repeating: 0, count: side * side * 4)
let probe = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4, space: srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
probe.draw(art, in: CGRect(x: 0, y: 0, width: side, height: side))
let transparentPixels = stride(from: 3, to: pixels.count, by: 4).filter { pixels[$0] != 255 }.count
if args[1] != "transparent" && transparentPixels > 0 { fatalError("\(args[2]) has \(transparentPixels) pixels that are not fully opaque; a \(args[1]) icon must have none") }

let context: CGContext
switch args[1] {
case "opaque":
    context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: srgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
case "transparent":
    context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
case "gray":
    context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.genericGrayGamma2_2)!, bitmapInfo: CGImageAlphaInfo.none.rawValue)!
default:
    fatalError("mode must be opaque, transparent or gray")
}
context.interpolationQuality = .high
context.draw(art, in: CGRect(x: 0, y: 0, width: side, height: side))
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[3]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("could not write \(args[3])") }
print(args[1], "->", args[3])
