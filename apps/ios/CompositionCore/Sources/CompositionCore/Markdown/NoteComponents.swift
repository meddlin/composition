import Foundation

// What the components read from their props (spike S4): ports of the desktop's chartData.ts, repoRef.ts, youtubeRef.ts,
// imageWidth.ts and the `app_data/` part of imageRefs.ts. They are pure, so they are checked against the real TypeScript
// (apps/ios/conformance/component-cases.json and what the desktop answers for each, in MdxComponentTests).
//
// The one thing that has no equal here is JavaScript's `new URL`, the WHATWG parser: these use URLComponents and add the
// parts of WHATWG's behaviour a note can reach (a default port is dropped, `.` and `..` segments are resolved).

private extension NSRegularExpression {
    static func make(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        // Patterns are constants in this file.
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    func firstMatch(in text: String) -> NSTextCheckingResult? {
        firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    }

    func isMatch(_ text: String) -> Bool { firstMatch(in: text) != nil }
}

private extension NSTextCheckingResult {
    func group(_ index: Int, in text: String) -> String? {
        let range = self.range(at: index)
        return range.location == NSNotFound ? nil : Range(range, in: text).map { String(text[$0]) }
    }
}

private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

/// The parts of a URL that a note's address can have, read the way a browser would.
private struct ParsedURL {
    var scheme: String  // lower case, without the colon
    var host: String  // lower case, with the port unless it is the scheme's default
    var hostname: String
    var path: String
    var query: [(name: String, value: String)]

    init?(_ text: String) {
        guard let parts = URLComponents(string: text), let scheme = parts.scheme?.lowercased() else { return nil }
        self.scheme = scheme
        hostname = (parts.host ?? "").lowercased()
        let defaults = ["https": 443, "http": 80, "ssh": 22, "git": 9418]
        if let port = parts.port, port != defaults[scheme] { host = "\(hostname):\(port)" } else { host = hostname }
        // `.` and `..` segments are resolved, as a browser does before a path is looked at.
        var kept: [Substring] = []
        for segment in parts.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false) {
            if segment == "." { continue }
            if segment == ".." { if kept.count > 1 { kept.removeLast() }; continue }
            kept.append(segment)
        }
        path = kept.joined(separator: "/")
        query = (parts.queryItems ?? []).map { ($0.name, $0.value ?? "") }
    }

    func parameter(_ name: String) -> String? { query.first { $0.name == name }?.value }
}

private let hasScheme = NSRegularExpression.make("^[a-z][a-z0-9+.-]*:", caseInsensitive: true)

/// `new URL(text)` for an address with or without `https://`.
private func addressURL(_ text: String) -> ParsedURL? {
    ParsedURL(hasScheme.isMatch(text) ? text : "https://\(text)")
}

// MARK: <Chart>

public enum ChartType: String, CaseIterable, Sendable { case bar, line, area, pie }

public struct ChartRow: Equatable, Sendable {
    public var label: String
    /// A series' number for this row; a cell that is not a number is a gap, so the column is missing.
    public var values: [String: Double]
}

public struct ChartSpec: Equatable, Sendable {
    public var type: ChartType
    public var x: String
    public var y: [String]
    public var rows: [ChartRow]
}

public enum ChartParse: Equatable, Sendable {
    case chart(ChartSpec)
    /// In words, for the notice shown where the chart would be.
    case failure(String)
}

public enum NoteChart {
    public static let defaultType = ChartType.bar
    public static let maxRows = 500

    /// CSV as rows of cells. Cells may be quoted (`"a, b"`, `""` for a quote), a quoted cell may hold a newline, `\r\n` is one
    /// line break, and blank lines are skipped.
    public static func parseCsv(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var cell = String.UnicodeScalarView()
        var quoted = false
        let scalars = Array(text.unicodeScalars)

        func endCell() { row.append(String(cell)); cell = String.UnicodeScalarView() }
        func endRow() {
            endCell()
            if row.contains(where: { !trimmed($0).isEmpty }) { rows.append(row.map(trimmed)) }
            row = []
        }

        var i = 0
        while i < scalars.count {
            let c = scalars[i]
            if quoted {
                if c == "\"", i + 1 < scalars.count, scalars[i + 1] == "\"" { cell.append("\""); i += 1 } else if c == "\"" { quoted = false } else { cell.append(c) }
            } else if c == "\"", trimmed(String(cell)).isEmpty {
                cell = String.UnicodeScalarView()
                quoted = true
            } else if c == "," {
                endCell()
            } else if c == "\n" {
                endRow()
            } else if c == "\r" {
                if i + 1 < scalars.count, scalars[i + 1] == "\n" { i += 1 }
                endRow()
            } else {
                cell.append(c)
            }
            i += 1
        }
        endRow()
        return rows
    }

    private static let numberPattern = NSRegularExpression.make("^[-+]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\\.[0-9]+)?\\z|^[-+]?\\.[0-9]+\\z")

    /// A cell as a number: plain, with thousands separators, or a percentage (`12%` is 12). Nothing else is a number.
    public static func parseNumber(_ cell: String) -> Double? {
        var text = trimmed(cell)
        if text.hasSuffix("%") { text.removeLast() }
        guard numberPattern.isMatch(text) else { return nil }
        guard let value = Double(text.replacingOccurrences(of: ",", with: "")), value.isFinite else { return nil }
        return value
    }

    private static func columns(_ value: String?) -> [String] {
        (value ?? "").split(separator: ",", omittingEmptySubsequences: false).map { trimmed(String($0)) }.filter { !$0.isEmpty }
    }

    /// The chart for a CSV table: the first row names the columns, `x` picks the label column (the first by default), `y` the
    /// series (every other column of numbers by default).
    public static func parse(type: String?, x: String?, y: String?, csv: String) -> ChartParse {
        let table = parseCsv(csv)
        guard let header = table.first else { return .failure("Chart: add a ```csv block with a header row and the data.") }
        let body = Array(table.dropFirst())
        if body.isEmpty { return .failure("Chart: the data has a header but no rows.") }
        if body.count > maxRows { return .failure("Chart: \(body.count) rows is too many to draw (up to \(maxRows)).") }
        if Set(header).count != header.count { return .failure("Chart: two columns have the same name.") }

        let chartType = type.flatMap { ChartType(rawValue: trimmed($0)) } ?? defaultType
        let xName = x.map(trimmed).flatMap { $0.isEmpty ? nil : $0 } ?? header[0]
        if !header.contains(xName) { return .failure("Chart: no column named “\(xName)”. Columns: \(header.joined(separator: ", ")).") }

        let requested = columns(y)
        if let unknown = requested.first(where: { !header.contains($0) }) {
            return .failure("Chart: no column named “\(unknown)”. Columns: \(header.joined(separator: ", ")).")
        }

        func holdsNumbers(_ name: String) -> Bool {
            guard let at = header.firstIndex(of: name) else { return false }
            return body.contains { parseNumber(at < $0.count ? $0[at] : "") != nil }
        }
        let series = (requested.isEmpty ? header.filter { $0 != xName && holdsNumbers($0) } : requested).filter { $0 != xName }
        if series.isEmpty { return .failure("Chart: no column of numbers to draw. Name one with y=\"column\".") }
        if !requested.isEmpty, let empty = series.first(where: { !holdsNumbers($0) }) {
            return .failure("Chart: column “\(empty)” has no numbers.")
        }

        let xAt = header.firstIndex(of: xName)!
        let rows = body.map { cells -> ChartRow in
            var values: [String: Double] = [:]
            for name in series {
                let at = header.firstIndex(of: name)!
                if let value = parseNumber(at < cells.count ? cells[at] : "") { values[name] = value }
            }
            return ChartRow(label: xAt < cells.count ? cells[xAt] : "", values: values)
        }
        return .chart(ChartSpec(type: chartType, x: xName, y: series, rows: rows))
    }
}

// MARK: <Repo>

public struct RepoRef: Equatable, Sendable {
    public var host: String
    /// Who runs it, when the host is a known one.
    public var service: String?
    public var owner: String
    public var name: String
    /// Where to open it: `https://host/owner/name`, rebuilt, never the text as written.
    public var href: String

    public var label: String { "\(owner)/\(name)" }
}

public enum NoteRepo {
    private static let knownHosts: [String: (service: String, nested: Bool)] = [
        "github.com": ("GitHub", false), "gitlab.com": ("GitLab", true), "bitbucket.org": ("Bitbucket", false),
        "codeberg.org": ("Codeberg", false), "git.sr.ht": ("SourceHut", false),
    ]
    private static let pageSegments: Set<String> = ["-", "tree", "blob", "src", "raw", "commit", "commits", "issues", "pulls", "pull", "merge_requests", "releases", "wiki", "actions"]
    private static let segment = NSRegularExpression.make("^[A-Za-z0-9_.~-]+\\z")
    private static let scpLike = NSRegularExpression.make("^[A-Za-z0-9_.-]+@([A-Za-z0-9_.-]+):(?!/)(.+)$")

    /// What a note's `<Repo url="…" />` points at; nil when it is not an address with an owner and a repository name.
    public static func parse(_ url: String?) -> RepoRef? {
        guard let text = url.map(trimmed), !text.isEmpty, !text.unicodeScalars.contains(where: { $0.properties.isWhitespace }) else { return nil }

        var host: String
        var path: String
        var scheme = "https"
        if let scp = scpLike.firstMatch(in: text), let scpHost = scp.group(1, in: text), let scpPath = scp.group(2, in: text) {
            host = scpHost
            path = scpPath
        } else {
            guard let link = addressURL(text) else { return nil }
            if link.scheme == "https" || link.scheme == "http" { scheme = link.scheme } else if link.scheme != "ssh", link.scheme != "git" { return nil }
            host = link.host
            path = link.path
        }

        host = host.lowercased()
        if host.hasPrefix("www.") { host.removeFirst(4) }
        guard host.contains(".") else { return nil }  // a name with no dot is a typo, not a host

        let segments = path.split(separator: "/").map(String.init)
        let known = knownHosts[host]
        let end: Int
        if let known, !known.nested { end = 2 } else {
            end = segments.indices.first { $0 >= 2 && pageSegments.contains(segments[$0]) } ?? segments.count
        }
        let repoPath = Array(segments.prefix(end))
        guard repoPath.count >= 2, repoPath.allSatisfy({ segment.isMatch($0) }) else { return nil }

        var name = repoPath[repoPath.count - 1]
        if name.hasSuffix(".git") { name.removeLast(4) }
        guard !name.isEmpty, name != ".", name != ".." else { return nil }
        let owner = repoPath.dropLast().joined(separator: "/")
        return RepoRef(host: host, service: known?.service, owner: owner, name: name, href: "\(scheme)://\(host)/\(owner)/\(name)")
    }
}

// MARK: <YouTube>

public struct YouTubeRef: Equatable, Sendable {
    public var id: String
    /// Where to begin playing, in whole seconds.
    public var start: Int

    /// The privacy-enhanced player: YouTube sets no cookies until the video is played.
    public var embedURL: String { "https://www.youtube-nocookie.com/embed/\(id)?rel=0\(start > 0 ? "&start=\(start)" : "")" }
    /// Where the video is on youtube.com, for opening it there.
    public var watchURL: String { "https://www.youtube.com/watch?v=\(id)\(start > 0 ? "&t=\(start)s" : "")" }
}

public enum NoteYouTube {
    private static let id = NSRegularExpression.make("^[A-Za-z0-9_-]{11}\\z")
    private static let hosts: Set<String> = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]
    private static let idPaths: Set<String> = ["embed", "shorts", "live", "v"]
    private static let seconds = NSRegularExpression.make("^[0-9]+s?\\z")
    private static let clock = NSRegularExpression.make("^(?:([0-9]+):)?([0-9]{1,2}):([0-9]{1,2})\\z")
    private static let units = NSRegularExpression.make("^(?:([0-9]+)h)?(?:([0-9]+)m)?(?:([0-9]+)s)?\\z")

    /// A start time in seconds: `90`, `90s`, `1:30`, `1:02:03` or `1m30s`. Nil for anything else.
    public static func parseStart(_ value: String?) -> Int? {
        guard let text = value.map({ trimmed($0).lowercased() }), !text.isEmpty else { return nil }
        if seconds.isMatch(text) { return Int(text.hasSuffix("s") ? String(text.dropLast()) : text) }
        func number(_ match: NSTextCheckingResult, _ index: Int) -> Int { match.group(index, in: text).flatMap { Int($0) } ?? 0 }
        if let match = clock.firstMatch(in: text) { return number(match, 1) * 3600 + number(match, 2) * 60 + number(match, 3) }
        if let match = units.firstMatch(in: text) { return number(match, 1) * 3600 + number(match, 2) * 60 + number(match, 3) }
        return nil
    }

    /// What a note's `<YouTube url="…" start="…" />` points at; nil when it is not a YouTube video.
    public static func parse(_ url: String?, start: String? = nil) -> YouTubeRef? {
        guard let text = url.map(trimmed), !text.isEmpty else { return nil }
        let explicitStart = parseStart(start)
        if id.isMatch(text) { return YouTubeRef(id: text, start: explicitStart ?? 0) }

        guard let link = addressURL(text), link.scheme == "https" || link.scheme == "http" else { return nil }
        let segments = link.path.split(separator: "/").map(String.init)
        var videoId: String?
        if link.hostname == "youtu.be" {
            videoId = segments.first
        } else if hosts.contains(link.hostname) {
            if segments.first == "watch" { videoId = link.parameter("v") } else if let first = segments.first, idPaths.contains(first), segments.count > 1 { videoId = segments[1] }
        }
        guard let videoId, id.isMatch(videoId) else { return nil }
        let fromLink = parseStart(link.parameter("t") ?? link.parameter("start"))
        return YouTubeRef(id: videoId, start: explicitStart ?? fromLink ?? 0)
    }
}

// MARK: <Image>

public struct ImageWidth: Equatable, Sendable {
    public enum Unit: String, Sendable { case px, percent = "%" }
    public var value: Double
    public var unit: Unit
}

public enum NoteImage {
    private static let width = NSRegularExpression.make("^\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(px|%)?\\s*\\z", caseInsensitive: true)
    private static let imageName = NSRegularExpression.make("^[A-Za-z0-9][A-Za-z0-9._-]*\\.(png|jpe?g|gif|webp)\\z", caseInsensitive: true)
    public static let directoryName = "app_data"

    /// How wide an `<Image>` is drawn: pixels (`400`, `400px`) or a share of the note's width (`50%`, never over 100). Anything
    /// else is nil, so a half-typed value leaves the image at full size.
    public static func parseWidth(_ raw: String?) -> ImageWidth? {
        guard let raw, let match = width.firstMatch(in: raw), let number = match.group(1, in: raw), let value = Double(number), value > 0 else { return nil }
        let percent = match.group(2, in: raw) == "%"
        return ImageWidth(value: percent ? min(value, 100) : value, unit: percent ? .percent : .px)
    }

    /// The file name a note's `app_data/…` path refers to, or nil when it is not a stored image.
    public static func name(fromRef src: String) -> String? {
        let prefix = "\(directoryName)/"
        let rest: String
        if src.hasPrefix("./\(prefix)") { rest = String(src.dropFirst(2 + prefix.count)) } else if src.hasPrefix(prefix) { rest = String(src.dropFirst(prefix.count)) } else { return nil }
        return imageName.isMatch(rest) ? rest : nil
    }
}
