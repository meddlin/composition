import Foundation

// Where a note's header image comes from: the Swift twin of the desktop's `headerImageSrc` and `headerImageName` (headerImageSource.ts). The frontmatter's
// `headerImage` is `app_data/<name>` for a stored picture, or an `https://` address typed by hand. Anything else (a `data:` URI, a stray word) is not a header
// image, so a half-typed value shows nothing rather than something broken.

public enum HeaderImageSource: Equatable, Sendable {
    /// A picture in `app_data/`, by file name.
    case stored(name: String)
    /// An `http://` or `https://` address. The iPad fetches nothing from the network, so it is named in the header image sheet and not drawn.
    case web(String)

    private static let webAddress = try! NSRegularExpression(pattern: "^https?://\\S+\\z", options: [.caseInsensitive])

    /// What `ref` (the frontmatter's `headerImage`) points at, or nil when it points at nothing a header image can be.
    public static func resolve(_ ref: String) -> HeaderImageSource? {
        if let name = NoteImage.name(fromRef: ref) { return .stored(name: name) }
        let whole = NSRange(location: 0, length: (ref as NSString).length)
        return webAddress.firstMatch(in: ref, range: whole) != nil ? .web(ref) : nil
    }

    /// The stored picture's file name when `ref` is one (what the picker marks as chosen), else nil.
    public static func storedName(of ref: String?) -> String? {
        guard let ref, case .stored(let name)? = resolve(ref) else { return nil }
        return name
    }
}
