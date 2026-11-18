import Foundation

/// Reads the editor's `live-report` (`LiveReport`, `-liveReport 1`): `class:from-to,from-to;class:…` as `class → ranges`.
///
/// Since Step 7 of docs/ipad-live-default-plan.md (D5) a note's frontmatter is drawn, away from the caret, as the Preview's header: a block whose every character is
/// hidden. The notes the Live tests type into have a frontmatter, so by default what that block puts in the report (`block-frontmatter`, its `hidden` and `ax-silent`
/// run, its `draw-block` line and its `flat` lines) is left out, and a test reads only what it typed. `keepingFrontmatter` gives the report as it is.
enum LiveReportReading {
    static func parse(_ label: String, keepingFrontmatter: Bool = false) -> [String: String] {
        var out: [String: [(Int, Int)]] = [:]
        var order: [String] = []
        for part in label.split(separator: ";") {
            let pair = part.split(separator: ":", maxSplits: 1)
            guard pair.count == 2 else { continue }
            let key = String(pair[0])
            order.append(key)
            out[key] = pair[1].split(separator: ",").compactMap { range in
                let ends = range.split(separator: "-").compactMap { Int($0) }
                return ends.count == 2 ? (ends[0], ends[1]) : nil
            }
        }
        if !keepingFrontmatter, let block = out["block-frontmatter"]?.first {
            // The frontmatter's lines, its last line break included.
            let cut = (block.0, block.1 + 1)
            out["block-frontmatter"] = nil
            for key in out.keys {
                out[key] = out[key]!.flatMap { range -> [(Int, Int)] in
                    guard range.0 < cut.1, range.1 > cut.0 else { return [range] }
                    var kept: [(Int, Int)] = []
                    if range.0 < cut.0 { kept.append((range.0, cut.0)) }
                    if range.1 > cut.1 { kept.append((cut.1, range.1)) }
                    return kept
                }
            }
        }
        var result: [String: String] = [:]
        for key in order {
            guard let ranges = out[key], !ranges.isEmpty else { continue }
            result[key] = ranges.map { "\($0.0)-\($0.1)" }.joined(separator: ",")
        }
        return result
    }
}
