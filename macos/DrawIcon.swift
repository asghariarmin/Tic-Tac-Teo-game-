import AppKit

let image = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)

func color(_ hex: UInt32) -> NSColor {
    NSColor(
        srgbRed: CGFloat(hex >> 16) / 255,
        green: CGFloat((hex >> 8) & 255) / 255,
        blue: CGFloat(hex & 255) / 255,
        alpha: 1
    )
}

func rect(_ x: Int, _ y: Int, _ width: Int, _ height: Int, _ fill: UInt32, radius: CGFloat = 0) {
    color(fill).setFill()
    let bounds = NSRect(x: x, y: 1024 - y - height, width: width, height: height)
    NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
}

func sprite(_ rows: [String], x: Int, y: Int, fill: UInt32, shadow: UInt32) {
    let pixel = 28
    for (row, line) in rows.enumerated() {
        for (column, mark) in line.enumerated() where mark == "1" {
            rect(x + column * pixel + 9, y + row * pixel + 10, pixel, pixel, shadow)
        }
    }
    for (row, line) in rows.enumerated() {
        for (column, mark) in line.enumerated() where mark == "1" {
            rect(x + column * pixel, y + row * pixel, pixel, pixel, fill)
        }
    }
}

rect(90, 108, 844, 844, 0x101020, radius: 196)
rect(90, 84, 844, 844, 0x424363, radius: 196)
rect(100, 94, 824, 824, 0x1a1b2e, radius: 186)
rect(186, 221, 652, 548, 0x494b69, radius: 58)
rect(196, 231, 632, 528, 0x101120, radius: 48)
rect(238, 273, 548, 444, 0x24263e, radius: 22)
rect(500, 308, 24, 372, 0x393b56)
rect(267, 481, 490, 24, 0x393b56)
rect(225, 157, 26, 26, 0x56eedb)
rect(265, 157, 26, 26, 0xffcc73)
rect(305, 157, 26, 26, 0xbdabff)
rect(444, 830, 136, 18, 0x535576)

sprite(["1100011", "1110111", "0111110", "0011100", "0111110", "1110111", "1100011"],
       x: 276, y: 312, fill: 0x56eedb, shadow: 0x287a7c)
sprite(["0011100", "0111110", "1100011", "1100011", "1100011", "0111110", "0011100"],
       x: 550, y: 490, fill: 0xffcc73, shadow: 0x925e51)

NSGraphicsContext.restoreGraphicsState()
let png = image.representation(using: .png, properties: [:])!
var icon = Data("icns".utf8)
icon.append(contentsOf: withUnsafeBytes(of: UInt32(png.count + 16).bigEndian, Array.init))
icon.append(contentsOf: "ic10".utf8)
icon.append(contentsOf: withUnsafeBytes(of: UInt32(png.count + 8).bigEndian, Array.init))
icon.append(png)
try icon.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
