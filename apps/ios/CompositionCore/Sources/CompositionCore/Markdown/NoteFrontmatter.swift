import Foundation

// The YAML block at the top of a note (`---`, then `key: value` lines, then `---`): the Swift side of the desktop's
// `frontmatter.ts`, function for function (build plan, Step 3). Every note ever saved carries a block written by it, so the
// iPad reads one exactly as the desktop does and, when it saves a note, writes the bytes the desktop would have written.
//
// What counts as frontmatter is decided by a YAML reader (YAML/YAMLReader.swift, a port of the library the desktop uses): a
// block that is not a YAML mapping, or that does not parse, leaves the note with no frontmatter, and the text stays as it is.

/// How a note's header image sits above its title: across the whole note, or at its own size in the middle.
public enum HeaderImageLayout: String, Sendable, CaseIterable {
    case full
    case centered
}

/// A picture shown above the note's title: `app_data/<name>` for a stored image, or an `https://` address.
public struct HeaderImage: Equatable, Sendable {
    public var image: String
    public var layout: HeaderImageLayout

    public init(image: String, layout: HeaderImageLayout = .full) {
        self.image = image
        self.layout = layout
    }
}

public struct Frontmatter: Equatable, Sendable {
    public var title: String
    public var description: String
    public var tags: [String]
    public var createdAt: String
    public var updatedAt: String
    /// Absent (not empty) when the note has none, so a note without one is written exactly as it was before this existed.
    public var headerImage: HeaderImage?

    public init(title: String, description: String = "", tags: [String] = [], createdAt: String, updatedAt: String, headerImage: HeaderImage? = nil) {
        self.title = title
        self.description = description
        self.tags = tags
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.headerImage = headerImage
    }
}

public enum NoteFrontmatter {
    /// The opening `---` line, a non-greedy YAML body, then the closing `---` line, anchored at the very start of the text.
    private static let block = try! NSRegularExpression(pattern: "^---\\r?\\n([\\s\\S]*?)\\r?\\n---[ \\t]*\\r?\\n?")

    private static func match(_ content: String) -> (inner: String, body: String)? {
        let text = content as NSString
        guard let found = block.firstMatch(in: content, range: NSRange(location: 0, length: text.length)) else { return nil }
        return (text.substring(with: found.range(at: 1)), text.substring(from: found.range.location + found.range.length))
    }

    private static func mapping(of yaml: String) -> YAMLMapping? {
        guard let value = try? YAMLReader.load(yaml), case .mapping(let mapping) = value else { return nil }
        return mapping
    }

    // MARK: Reading

    /// `parse`: the frontmatter and the body after it; nil and the whole text when there is no block at the very top, the block
    /// is not a YAML mapping, or the YAML does not parse. It never fails: the block is free-form text a person edits.
    public static func parse(_ content: String) -> (frontmatter: Frontmatter?, body: String) {
        guard let found = match(content), let record = mapping(of: found.inner) else { return (nil, content) }

        var frontmatter = Frontmatter(
            title: asString(record["title"]),
            description: asString(record["description"]),
            tags: asTagList(record["tags"]),
            createdAt: dateOnly(asString(record["createdAt"])),
            updatedAt: dateOnly(asString(record["updatedAt"])))
        let image = JavaScriptText.trim(asString(record["headerImage"]))
        if !image.isEmpty {
            frontmatter.headerImage = HeaderImage(image: image, layout: asLayout(record["headerImageLayout"]))
        }
        return (frontmatter, found.body)
    }

    /// The block's YAML text (without the dashes) and the body after it, with the same idea of a block as `parse`.
    public static func split(_ content: String) -> (frontmatter: String?, body: String) {
        guard let found = match(content), mapping(of: found.inner) != nil else { return (nil, content) }
        return (found.inner, found.body)
    }

    /// `strip`: the content with any leading frontmatter block removed.
    public static func strip(_ content: String) -> String { parse(content).body }

    // MARK: Writing

    /// `generate`: a new block.
    public static func generate(title: String, createdAt: String, updatedAt: String, description: String = "", tags: [String] = []) -> String {
        serialize(Frontmatter(title: title, description: description, tags: tags, createdAt: createdAt, updatedAt: updatedAt))
    }

    /// `render`: content reassembled from a (possibly edited) frontmatter and a body.
    public static func render(_ frontmatter: Frontmatter, body: String) -> String { serialize(frontmatter) + body }

    /// `withHeaderImage`: `content` with its header image set (nil removes it), keeping everything else. A note that has no
    /// frontmatter block gets one made from `fallback`.
    public static func withHeaderImage(_ content: String, _ header: HeaderImage?, fallback: (title: String, createdAt: String, updatedAt: String)) -> String {
        let (parsed, body) = parse(content)
        var frontmatter = parsed ?? Frontmatter(title: fallback.title, createdAt: fallback.createdAt, updatedAt: fallback.updatedAt)
        frontmatter.headerImage = header
        return render(frontmatter, body: body)
    }

    /// A list of tags as the database keeps them: trimmed, without empty ones, joined by commas.
    public static func tagsToString(_ tags: [String]) -> String {
        tags.map(JavaScriptText.trim).filter { !$0.isEmpty }.joined(separator: ",")
    }

    public static func tagsFromString(_ tags: String) -> [String] {
        tags.split(separator: ",", omittingEmptySubsequences: false).map { JavaScriptText.trim(String($0)) }.filter { !$0.isEmpty }
    }

    private static func serialize(_ frontmatter: Frontmatter) -> String {
        var pairs: [(key: String, value: YAMLWriter.Value)] = [
            ("title", .string(frontmatter.title)),
            ("description", .string(frontmatter.description)),
            ("tags", .list(frontmatter.tags)),
            ("createdAt", .string(dateOnly(frontmatter.createdAt))),
            ("updatedAt", .string(dateOnly(frontmatter.updatedAt))),
        ]
        // After the keys every version has always written, and only when set.
        if let header = frontmatter.headerImage, !header.image.isEmpty {
            pairs.append(("headerImage", .string(header.image)))
            pairs.append(("headerImageLayout", .string(header.layout.rawValue)))
        }
        // A bare date would be read back as a timestamp, so the writer quotes it; unquote it so the editor shows plain dates.
        let yaml = YAMLWriter.dump(pairs).split(separator: "\n", omittingEmptySubsequences: false).map { unquotedDate(String($0)) }.joined(separator: "\n")
        return "---\n" + yaml + "---\n"
    }

    /// `createdAt: '2026-11-06'` → `createdAt: 2026-11-06` (the same for `updatedAt`); any other line is returned as it is.
    private static func unquotedDate(_ line: String) -> String {
        for key in ["createdAt: '", "updatedAt: '"] where line.hasPrefix(key) {
            let rest = Array(line.utf8.dropFirst(key.utf8.count))
            guard rest.count == 11, rest[10] == 0x27, isDate(rest[0..<10]) else { return line }
            return String(key.dropLast()) + String(decoding: rest[0..<10], as: UTF8.self)
        }
        return line
    }

    private static func isDate<C: Collection>(_ bytes: C) -> Bool where C.Element == UInt8 {
        let units = Array(bytes)
        guard units.count == 10 else { return false }
        for (index, unit) in units.enumerated() {
            if index == 4 || index == 7 {
                if unit != 0x2D { return false }
            } else if unit < 0x30 || unit > 0x39 {
                return false
            }
        }
        return true
    }

    /// The frontmatter shows only the date; the full timestamp lives in the database. Takes the leading `YYYY-MM-DD` of an
    /// ISO string as written (no time zone conversion); anything else is left alone.
    static func dateOnly(_ value: String) -> String {
        let trimmed = Array(JavaScriptText.trim(value).utf8)
        guard trimmed.count >= 10, isDate(trimmed[0..<10]) else { return value }
        guard trimmed.count == 10 || trimmed[10] == 0x54 || trimmed[10] == 0x20 else { return value }
        return String(decoding: trimmed[0..<10], as: UTF8.self)
    }

    // MARK: Reading the values

    /// JavaScript's `asString`: nothing is empty, a date is its ISO text, anything else is `String(value)`.
    private static func asString(_ value: YAMLValue?) -> String {
        switch value {
        case nil, .null?: ""
        case .timestamp(let milliseconds)?: JavaScriptText.isoString(milliseconds: milliseconds)
        case let value?: JavaScriptText.string(value)
        }
    }

    private static func asLayout(_ value: YAMLValue?) -> HeaderImageLayout {
        let name = JavaScriptText.trim(asString(value)).lowercased()
        return HeaderImageLayout(rawValue: name) ?? .full
    }

    private static func asTagList(_ value: YAMLValue?) -> [String] {
        switch value {
        case .sequence(let items)?:
            return items.map { JavaScriptText.trim(JavaScriptText.string($0)) }.filter { !$0.isEmpty }
        case .string(let text)?:
            return tagsFromString(text)
        default:
            return []
        }
    }
}
