import Foundation
import Testing

@testable import CompositionCore

// Build plan Step 8: the desktop's `images.ts`, `imageRefs.ts` and `imageToMdx.ts`, against the real functions. The inputs are
// apps/ios/conformance/images-cases.json (75 byte strings to sniff, 160 names, 24 real stores into a folder, alt text, Markdown and tags for 19
// names, 11 notes' image references, and 1,504 cursors and selections over texts for the conversion to `<Image />` tags); what the desktop
// made of each is images-expected.json (see ConformanceTests.swift for how to run this).

private struct Cases: Decodable {
    struct Name: Decodable { let title: String, file: String, hex: String, ext: String }
    struct Store: Decodable { let title: String, file: String, hex: String; let maxBytes: Int? }
    struct Named: Decodable { let name: String }
    struct Markdown: Decodable { let name: String; let alt: String? }
    struct Hex: Decodable { let hex: String }
    struct Text: Decodable { let text: String }
    struct Selection: Decodable { let text: String, start: Int, end: Int }
    let sniff: [Hex]
    let fileName: [Name]
    let store: [Store]
    let alt: [Named]
    let markdown: [Markdown]
    let tag: [Named]
    let refs: [Text]
    let toMdx: [Selection]
}

private struct Expected: Decodable {
    struct Stored: Decodable {
        let name: String?
        let error: String?
        let size: Int?
        let sha256: String?
        let reused: Bool?
    }

    struct Tag: Decodable { let tag: String?; let error: String? }
    struct Edit: Decodable, Equatable { let start: Int, end: Int, text: String, caret: Int }
    let sniff: [String?]
    let fileName: [String]
    let store: [Stored]
    let alt: [String]
    let markdown: [String]
    let tag: [Tag]
    let refs: [[String]]
    let toMdx: [Edit?]
}

private func bytes(_ hex: String) -> Data {
    var data = Data()
    var index = hex.startIndex
    while index < hex.endIndex {
        let next = hex.index(index, offsetBy: 2)
        data.append(UInt8(hex[index..<next], radix: 16)!)
        index = next
    }
    return data
}

private func shown(_ text: String) -> String { String(reflecting: text.count > 60 ? String(text.prefix(60)) + "…" : text) }

@Suite("Images against the desktop", .serialized, .enabled(if: conformanceDirectory != nil, "COMPOSITION_CONFORMANCE_DIR is not set"))
struct ImagesConformanceTests {
    private func load() throws -> (Cases, Expected) {
        let directory = try #require(conformanceDirectory)
        let cases = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: directory.appendingPathComponent("images-cases.json")))
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("images-expected.json")))
        return (cases, expected)
    }

    @Test("every byte string is sniffed as sniffImage does")
    func sniffing() throws {
        let (cases, expected) = try load()
        #expect(cases.sniff.count == expected.sniff.count)
        for (index, item) in cases.sniff.enumerated() {
            #expect(StoredImages.sniff(bytes(item.hex))?.rawValue == expected.sniff[index], "bytes \(item.hex)")
        }
    }

    @Test("every stored name is the one imageFileName makes")
    func names() throws {
        let (cases, expected) = try load()
        #expect(cases.fileName.count == expected.fileName.count)
        for (index, item) in cases.fileName.enumerated() {
            let type = try #require(StoredImageType(rawValue: item.ext))
            #expect(StoredImages.fileName(noteTitle: item.title, fileName: item.file, data: bytes(item.hex), type: type) == expected.fileName[index], "title \(shown(item.title)), file \(shown(item.file))")
        }
    }

    @Test("every real store gives the desktop's name or refusal, the same bytes on disk, and reuses the file the second time")
    func storing() throws {
        let (cases, expected) = try load()
        #expect(cases.store.count == expected.store.count)
        for (index, item) in cases.store.enumerated() {
            try withScratch { scratch in
                let location = DataLocation(directory: scratch.directory)
                let data = bytes(item.hex)
                let want = expected.store[index]
                let result = StoredImages.store(noteTitle: item.title, fileName: item.file, data: data, in: location, maxBytes: item.maxBytes)
                if let error = want.error {
                    #expect(result == .failed(error), "case \(index)")
                } else {
                    #expect(result == .stored(name: want.name!), "case \(index)")
                    let written = try Data(contentsOf: location.imagesURL.appendingPathComponent(want.name!))
                    #expect(written == data && written.count == want.size, "the file's bytes, case \(index)")
                    #expect(StoredImages.store(noteTitle: item.title, fileName: item.file, data: data, in: location, maxBytes: item.maxBytes) == result && want.reused == true, "stored again, case \(index)")
                }
            }
        }
    }

    @Test("alt text, Markdown, tags and references are what imageRefs.ts makes")
    func text() throws {
        let (cases, expected) = try load()
        for (index, item) in cases.alt.enumerated() { #expect(StoredImages.alt(forName: item.name) == expected.alt[index], "alt of \(shown(item.name))") }
        for (index, item) in cases.markdown.enumerated() { #expect(StoredImages.markdown(forName: item.name, alt: item.alt) == expected.markdown[index], "markdown of \(shown(item.name)) with \(String(describing: item.alt))") }
        for (index, item) in cases.tag.enumerated() {
            let want = expected.tag[index]
            if let tag = want.tag {
                #expect((try? StoredImages.tag(forName: item.name)) == tag, "tag of \(shown(item.name))")
            } else {
                #expect(throws: StoredImages.NotAnImageName.self) { try StoredImages.tag(forName: item.name) }
                #expect((StoredImages.NotAnImageName(name: item.name)).localizedDescription == want.error, "refusal for \(shown(item.name))")
            }
        }
        for (index, item) in cases.refs.enumerated() { #expect(StoredImages.findRefs(in: item.text).sorted() == expected.refs[index], "references in \(shown(item.text))") }
    }

    @Test("every cursor and selection converts to the edit imagesToMdx makes, or to none")
    func conversion() throws {
        let (cases, expected) = try load()
        #expect(cases.toMdx.count == expected.toMdx.count)
        var edits = 0
        for (index, item) in cases.toMdx.enumerated() {
            let got = MarkdownImages.toMdx(item.text, selectionStart: item.start, selectionEnd: item.end)
            let want = expected.toMdx[index]
            let mapped = got.map { Expected.Edit(start: $0.start, end: $0.end, text: $0.text, caret: $0.caret) }
            if want != nil { edits += 1 }
            #expect(mapped == want, "\(shown(item.text)) from \(item.start) to \(item.end)")
        }
        #expect(edits > 300)
    }
}
