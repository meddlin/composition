import SwiftUI

/// The open-source packages the app is built from, and their licences, as their authors ship them (build plan Step 11). The texts are in `Licences/`,
/// copied unchanged from the packages' own checkouts; the versions are the pins in `Composition.xcodeproj/.../Package.resolved` (and `CompositionCore/Package.swift`),
/// and are to be changed together with them.
struct LicencesView: View {
    private struct Package: Identifiable {
        let name: String
        let version: String
        let licence: String
        let address: String
        let files: [String]
        var id: String { name }
    }

    private static let packages = [
        Package(name: "GRDB.swift", version: "7.12.0", licence: "MIT", address: "https://github.com/groue/GRDB.swift", files: ["GRDB-LICENSE"]),
        Package(name: "swift-markdown", version: "0.9.0", licence: "Apache 2.0 with the Runtime Library Exception", address: "https://github.com/swiftlang/swift-markdown",
            files: ["swift-markdown-LICENSE", "swift-markdown-NOTICE"]),
        Package(name: "swift-cmark", version: "0.9.0", licence: "BSD 2-Clause, and the licences of cmark-gfm", address: "https://github.com/swiftlang/swift-cmark", files: ["swift-cmark-COPYING"]),
    ]

    @Environment(\.look) private var look

    var body: some View {
        List {
            Section {
                ForEach(Self.packages) { package in
                    NavigationLink {
                        LicenceText(package: package.name, address: package.address, files: package.files)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(package.name).font(.headline)
                            Text("Version \(package.version) · \(package.licence)").font(.subheadline).foregroundStyle(look.mutedText)
                        }
                    }
                    .accessibilityIdentifier("licence-\(package.name)")
                }
            } footer: {
                Text("Composition is built with these open-source packages. Their licences are shown as their authors wrote them.")
            }
            .listRowBackground(look.surface)
        }
        .scrollContentBackground(.hidden)
        .background(look.background)
        .navigationTitle("Open-source licences")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct LicenceText: View {
    let package: String
    let address: String
    let files: [String]
    @Environment(\.look) private var look

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(address).font(.footnote).foregroundStyle(look.mutedText)
                ForEach(files, id: \.self) { file in
                    Text(Self.text(of: file)).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(look.background)
        .navigationTitle(package)
        .navigationBarTitleDisplayMode(.inline)
    }

    private static func text(of file: String) -> String {
        guard let url = Bundle.main.url(forResource: file, withExtension: "txt"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "The licence text is missing from this build." }
        return text
    }
}
