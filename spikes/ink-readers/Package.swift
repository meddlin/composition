// swift-tools-version: 6.0
import PackageDescription

// A throwaway Mac app that reads the same drawings with Vision and with PencilKit's PKStrokeRecognizer (docs/architecture/ink.md, "Search"). It is an app, not a
// test, because handwritingd refuses to read for xcodebuild's test host. Run it with ./run.sh. Not shipped, not in CI.
let package = Package(
    name: "InkReaders",
    platforms: [.macOS("27.0")],
    dependencies: [.package(path: "../../apps/ios/CompositionCore")],
    targets: [
        .executableTarget(name: "InkReaders", dependencies: [
            .product(name: "CompositionInk", package: "CompositionCore"),
            .product(name: "CompositionCore", package: "CompositionCore"),
        ]),
    ]
)
