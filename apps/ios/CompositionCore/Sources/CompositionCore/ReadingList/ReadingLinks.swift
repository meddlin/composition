import Foundation

// The Reading List's pure rules: a port of the desktop's `readingList.ts` and the two limits in `readingListApi.ts`
// (docs/reading-list-plan.md, R4 to R6 and R9). `fixtures/conformance/reading-list.json` holds what the desktop's code answers for
// each of them; `ReadingListConformanceTests` replays it.

/// One link in the Reading List. `title` is empty until its page has been opened and said what it is called.
public struct ReadingItem: Equatable, Hashable, Sendable, Identifiable {
    public var id: Int64
    /// Always an absolute `http:` or `https:` address, as `ReadingLinks.normalize` writes it.
    public var url: String
    public var title: String
    public var read: Bool
    public var createdAt: String
    public var updatedAt: String

    public init(id: Int64, url: String, title: String = "", read: Bool = false, createdAt: String = "", updatedAt: String = "") {
        (self.id, self.url, self.title, self.read, self.createdAt, self.updatedAt) = (id, url, title, read, createdAt, updatedAt)
    }

    /// What a row is called: the page's title when it has one, else the host.
    public var label: String { ReadingLinks.label(url: url, title: title) }

    /// The host, without a leading `www.`.
    public var host: String { ReadingLinks.hostLabel(url) }
}

public enum ReadingLinks {
    /// The longest a link may be, in UTF-16 units as JavaScript counts a string's length.
    public static let maxURLLength = 2048
    /// The longest a stored title may be, in UTF-16 units; a longer page title is cut.
    public static let maxTitleLength = 300
    /// The Reading List's id among the desktop's plugins (`plugins.ts`), the key in `settings.json`'s `plugins`.
    public static let pluginId = "reading-list"

    /// Why a link was not taken, in the desktop's words.
    public enum Problem: Error, Equatable, Sendable, LocalizedError {
        case empty
        case tooLong
        case notWeb
        case notALink
        case hasCredentials

        public var errorDescription: String? {
            switch self {
            case .empty: "Paste a link to add."
            case .tooLong: "That link is too long."
            case .notWeb: "Only web links (http or https) can be added."
            case .notALink: "That does not look like a link."
            case .hasCredentials: "Remove the user name and password from the link."
            }
        }
    }

    /// The schemes named without `//`, which the "no scheme, so add https://" rule must not mistake for a host and port.
    private static let opaqueSchemes = ["javascript", "data", "file", "blob", "about", "mailto", "tel", "vbscript", "view-source", "chrome", "devtools", "app"]

    /// A link as it is stored (`normalizeReadingUrl`): trimmed, `https://` added when there is no scheme, the fragment dropped. Only
    /// `http:` and `https:` pass, because the address becomes a navigation in a web view.
    public static func normalize(_ input: String) -> Result<String, Problem> {
        let text = jsTrim(input)
        if text.isEmpty { return .failure(.empty) }
        if text.utf16.count > maxURLLength { return .failure(.tooLong) }
        let lowered = asciiLowercased(text)
        if opaqueSchemes.contains(where: { lowered.hasPrefix($0 + ":") }) { return .failure(.notWeb) }
        guard let parsed = WebAddress.parse(hasSchemeWithSlashes(text) ? text : "https://" + text) else { return .failure(.notALink) }
        guard parsed.scheme == "http" || parsed.scheme == "https" else { return .failure(.notWeb) }
        guard parsed.hostname != "" else { return .failure(.notALink) }
        guard parsed.username == "", parsed.password == "" else { return .failure(.hasCredentials) }
        return .success(parsed.href)
    }

    /// What to call a link until its page has said (`hostLabel`): the host name without a leading `www.`; the address itself when it has none.
    public static func hostLabel(_ url: String) -> String {
        guard let parsed = WebAddress.parse(url) else { return url }
        var host = parsed.hostname
        if host.count >= 4, asciiLowercased(String(host.prefix(4))) == "www." { host.removeFirst(4) }
        return host.isEmpty ? url : host
    }

    /// What a row is called (`readingItemLabel`): the page's title when it has one, else the host.
    public static func label(url: String, title: String) -> String { title.isEmpty ? hostLabel(url) : title }

    /// A page title as it is stored (`cleanReadingTitle`): on one line, trimmed, cut at the limit. Nil when nothing is left.
    ///
    /// JavaScript cuts by UTF-16 unit, so a cut can fall between the two halves of a character outside the Basic Multilingual Plane. The
    /// desktop's SQLite driver then stores the half as one U+FFFD under Node 24 and later (three under Node 22); one is written here.
    public static func cleanTitle(_ title: String) -> String? {
        var oneLine = ""
        var inSpace = false
        for scalar in title.unicodeScalars {
            if isJSWhitespace(scalar) {
                if !inSpace { oneLine.append(" ") }
                inSpace = true
            } else {
                oneLine.unicodeScalars.append(scalar)
                inSpace = false
            }
        }
        let trimmed = jsTrim(oneLine)
        let units = Array(trimmed.utf16)
        var cut: String
        if units.count <= maxTitleLength {
            cut = trimmed
        } else if UTF16.isLeadSurrogate(units[maxTitleLength - 1]) {
            cut = String(decoding: units[..<(maxTitleLength - 1)], as: UTF16.self) + "\u{FFFD}"
        } else {
            cut = String(decoding: units[..<maxTitleLength], as: UTF16.self)
        }
        cut = jsTrimEnd(cut)
        return cut.isEmpty ? nil : cut
    }

    /// The list as it is shown (`sortReadingItems`): unread first, then read, each oldest first.
    public static func sorted(_ items: [ReadingItem]) -> [ReadingItem] {
        items.sorted { ($0.read ? 1 : 0, $0.id) < ($1.read ? 1 : 0, $1.id) }
    }

    // MARK: JavaScript's idea of white space

    /// `\s` and `String.prototype.trim`: the ECMAScript WhiteSpace and LineTerminator code points. Not U+0085, which Foundation
    /// counts as a new line and JavaScript does not.
    static func isJSWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0d, 0x20, 0xa0, 0x1680, 0x2000...0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff: true
        default: false
        }
    }

    static func jsTrim(_ text: String) -> String {
        let scalars = text.unicodeScalars
        guard let start = scalars.firstIndex(where: { !isJSWhitespace($0) }) else { return "" }
        let end = scalars.lastIndex(where: { !isJSWhitespace($0) })!
        return String(scalars[start...end])
    }

    static func jsTrimEnd(_ text: String) -> String {
        let scalars = text.unicodeScalars
        guard let end = scalars.lastIndex(where: { !isJSWhitespace($0) }) else { return "" }
        return String(scalars[...end])
    }

    /// Only A to Z are folded, as a JavaScript `/i` pattern without `u` folds them.
    private static func asciiLowercased(_ text: String) -> String {
        String(String.UnicodeScalarView(text.unicodeScalars.map { ("A"..."Z").contains($0) ? Unicode.Scalar($0.value + 0x20)! : $0 }))
    }

    /// `/^[a-z][a-z0-9+.-]*:\/\//i`
    private static func hasSchemeWithSlashes(_ text: String) -> Bool {
        let scalars = Array(text.unicodeScalars.prefix(4096))
        guard let first = scalars.first, first.isASCIILetter else { return false }
        var index = 1
        while index < scalars.count, scalars[index].isASCIILetter || scalars[index].isASCIIDigit || "+.-".unicodeScalars.contains(scalars[index]) { index += 1 }
        return index + 2 < scalars.count && scalars[index] == ":" && scalars[index + 1] == "/" && scalars[index + 2] == "/"
    }
}

// MARK: Whether the plugin is on

/// The desktop's built-in plugins as `settings.json` keeps them (`plugins.ts`, `parsePluginSettings`). The iPad has one of them, the
/// Reading List, which is off until someone turns it on, because it lets the app load web pages.
public enum PluginSettings {
    /// Whether the Reading List is on, given what `plugins` holds in the settings file: only a real `true` or `false` counts.
    public static func readingListEnabled(settingsValue value: Any?) -> Bool {
        guard let plugins = value as? [String: Any], let flag = plugins[ReadingLinks.pluginId] as? NSNumber,
            CFGetTypeID(flag) == CFBooleanGetTypeID()
        else { return false }
        return flag.boolValue
    }
}
