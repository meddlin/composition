import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// The iPad app's icon is the desktop's notebook (apps/desktop/build/app-icon-1024.png, a PNG with a transparent background) on an opaque tile: iOS fills
// transparency with black and the App Store refuses an icon with an alpha channel. This puts it on a background of one colour, enlarged to fill the tile, and
// writes a PNG without an alpha channel. How apps/ios/Composition/Assets.xcassets/AppIcon.appiconset/AppIcon.png was made:
//   swiftc -O -o /tmp/flatten apps/ios/scripts/flatten-app-icon.swift
//   /tmp/flatten apps/desktop/build/app-icon-1024.png apps/ios/Composition/Assets.xcassets/AppIcon.appiconset/AppIcon.png "#9a4a1f" 1.12
// (#9a4a1f is the Cream scheme's accent; 1.12 is how much the notebook is enlarged about the middle of its own box.)
let args = CommandLine.arguments
guard args.count == 5, let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil), let art = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("usage: flatten in.png out.png #rrggbb scale") }
let hex = args[3].dropFirst()
let value = UInt32(hex, radix: 16)!
let red = CGFloat((value >> 16) & 255) / 255, green = CGFloat((value >> 8) & 255) / 255, blue = CGFloat(value & 255) / 255
let scale = CGFloat(Double(args[4])!)
let side = 1024

// The box the notebook occupies: every pixel that is not nearly transparent.
let w = art.width, h = art.height
var pixels = [UInt8](repeating: 0, count: w * h * 4)
let probe = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
probe.draw(art, in: CGRect(x: 0, y: 0, width: w, height: h))
var minX = w, maxX = 0, minY = h, maxY = 0
for y in 0..<h { for x in 0..<w where pixels[(y * w + x) * 4 + 3] > 40 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
let box = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)

let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(srgbRed: red, green: green, blue: blue, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: side, height: side))
context.interpolationQuality = .high
// The notebook's box lands in the middle of the tile, scaled by `scale` (the image's own scale is 1, as it is 1024 square).
// (CGContext's y runs up, as the probe's did, so the same box coordinates work for both.)
let centreX = box.midX, centreY = CGFloat(h) - box.midY  // the box was measured from the top row, the context counts from the bottom
context.translateBy(x: CGFloat(side) / 2, y: CGFloat(side) / 2)
context.scaleBy(x: scale, y: scale)
context.translateBy(x: -centreX, y: -centreY)
context.draw(art, in: CGRect(x: 0, y: 0, width: w, height: h))
let out = context.makeImage()!
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, out, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("could not write") }
print("box", box, "->", args[2])
