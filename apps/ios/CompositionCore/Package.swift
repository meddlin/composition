// swift-tools-version: 6.0
import PackageDescription

// CompositionCore: the iPad app's data layer (docs/ipad-app-design.md). Foundation and GRDB only, never UIKit, so it
// builds and tests on a Mac with `swift test`. The macOS platform is there for that, not as a product.
let package = Package(
    name: "CompositionCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CompositionCore", targets: ["CompositionCore"]),
    ],
    dependencies: [
        // Pinned to an exact version, as the design requires of every dependency (docs/ipad-app-design.md, Dependencies).
        .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.12.0"),
        .package(url: "https://github.com/swiftlang/swift-markdown.git", exact: "0.9.0"),
    ],
    targets: [
        .target(
            name: "CompositionCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "Markdown", package: "swift-markdown"),
            ]
        ),
        .testTarget(
            name: "CompositionCoreTests",
            dependencies: ["CompositionCore"]
        ),
    ]
)
