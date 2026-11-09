#if DEBUG || EDITOR_TEST_HOOKS
import Darwin
import UIKit

/// The speed of the editor proper (docs/ipad-live-view-plan.md, step L7), measured on the note that is open: `-liveBench <file>` (with `-openMode Live` or `Markdown`) runs this once the
/// text view is made, and writes the result as JSON to that file, for `LiveSpeedUITests` to read. A Release build needs `EDITOR_TEST_HOOKS` for it
/// (`SWIFT_ACTIVE_COMPILATION_CONDITIONS=EDITOR_TEST_HOOKS`). What it measures, on the real `MarkdownStyler`, `LiveModel` and `LiveOverlay`:
/// the first full pass (until the colouring has settled), the process's CPU while idle after it, 200 keystrokes typed 16 ms apart into a paragraph with marks (the styler's own
/// part, and the whole of UIKit's insert plus the layout of what changed), a caret moved across a construct and to another paragraph (the same two), and the pause's pass after
/// typing.
@MainActor
enum LiveBench {
    private static let clock = ContinuousClock()

    private static func milliseconds(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
    }

    private static func cpuSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        return Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1e6 + Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1e6
    }

    private static func summary(_ values: [Double]) -> [String: Double] {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return [:] }
        return ["median": sorted[sorted.count / 2], "p95": sorted[min(sorted.count - 1, sorted.count * 95 / 100)], "max": sorted[sorted.count - 1], "samples": Double(sorted.count)]
    }

    /// Waits until the styler's colouring has settled, up to `limit` seconds; whether it did.
    private static func settle(_ styler: MarkdownStyler, limit: Double = 600) async -> Bool {
        let end = clock.now + .seconds(limit)
        while !styler.isSettled, clock.now < end { try? await Task.sleep(for: .milliseconds(20)) }
        return styler.isSettled
    }

    static func run(in view: UITextView, styler: MarkdownStyler, openedAt: ContinuousClock.Instant) async -> String {
        var result: [String: Any] = ["build": _isDebugAssertConfiguration() ? "Debug" : "Release", "mode": styler.isLive ? "Live" : "Markdown", "characters": view.textStorage.length]
        // How busy the Mac is: the Simulator shares it, so a number taken at a load of 100 says little.
        var load = [Double](repeating: 0, count: 3)
        getloadavg(&load, 3)
        result["loadAverageAtStart"] = load.map { (($0 * 10).rounded()) / 10 }

        // The first full pass: from the note being opened until nothing is reading, putting colours on or due.
        let settled = await settle(styler)
        let first = styler.measurements
        result["firstPass"] = [
            "settled": settled, "settledAfterMilliseconds": milliseconds(clock.now - openedAt), "passes": styler.passesStarted, "readMilliseconds": first.fullReadMilliseconds,
            "putOnMilliseconds": first.putOnMilliseconds, "worstStepMilliseconds": first.worstStepMilliseconds, "passMilliseconds": first.lastPassMilliseconds,
        ] as [String: Any]

        // Whether it comes to rest: the process's CPU over three seconds of nothing.
        let cpu = cpuSeconds()
        try? await Task.sleep(for: .seconds(3))
        result["idleCPUPercent"] = (cpuSeconds() - cpu) / 3 * 100
        result["passesAfterIdle"] = styler.passesStarted
        // The text system lays the note out for a while after it opens (the same in the Markdown tab); another three seconds say that it ends.
        let again = cpuSeconds()
        try? await Task.sleep(for: .seconds(3))
        result["idleCPUPercentThen"] = (cpuSeconds() - again) / 3 * 100

        // Typing into a paragraph with marks in the middle of the note.
        view.becomeFirstResponder()
        let whole = view.nativeText as NSString
        // `-liveBenchAt 0.1`: how far into the note to type (a share of its length; the middle by default).
        let share = UserDefaults.standard.object(forKey: "liveBenchAt") == nil ? 0.5 : UserDefaults.standard.double(forKey: "liveBenchAt")
        result["typedAt"] = share
        func paragraphWithMarks() -> NSRange {
            let current = view.nativeText as NSString
            let middle = Int(Double(current.length) * share)
            let found = current.range(of: "**", options: [], range: NSRange(location: middle, length: current.length - middle))
            return found.location == NSNotFound ? current.paragraphRange(for: NSRange(location: middle, length: 0)) : current.paragraphRange(for: found)
        }
        let paragraph = paragraphWithMarks()
        view.selectedRange = NSRange(location: paragraph.location, length: 0)
        await settleAfterMove(styler)
        styler.resetMeasurements()
        let passesBeforeTyping = styler.passesStarted
        var whole1: [Double] = [], insert: [Double] = [], layout: [Double] = []
        let phrase = Array("Typing in the middle of a long note, with **bold** and `code` and a [link](https://x.test).\n")
        let count = 200
        for index in 0..<count {
            let started = clock.now
            view.insertText(String(phrase[index % phrase.count]))
            let inserted = clock.now
            view.layoutIfNeeded()
            let laid = clock.now
            insert.append(milliseconds(inserted - started))
            layout.append(milliseconds(laid - inserted))
            whole1.append(milliseconds(laid - started))
            try? await Task.sleep(for: .milliseconds(16))
        }
        let typing = styler.measurements
        result["typing"] = [
            "keystrokes": count, "styler": summary(typing.editMilliseconds), "insert": summary(insert), "layout": summary(layout), "whole": summary(whole1),
            "overBudget": whole1.filter { $0 > 16 }.count, "quickEdits": typing.quickEdits, "fallbackEdits": typing.fallbackEdits,
        ] as [String: Any]

        // The pause's pass after typing.
        let typedAt = clock.now
        try? await Task.sleep(for: .milliseconds(50))
        let after = await settle(styler)
        result["afterTyping"] = ["settled": after, "settledAfterMilliseconds": milliseconds(clock.now - typedAt), "passes": styler.passesStarted - passesBeforeTyping,
                                 "readMilliseconds": styler.measurements.fullReadMilliseconds, "putOnMilliseconds": styler.measurements.putOnMilliseconds,
                                 "worstStepMilliseconds": styler.measurements.worstStepMilliseconds] as [String: Any]

        // A caret moved across a construct (into a bold word and out of it, ends included) and to another paragraph and back.
        let anchor = paragraphWithMarks()
        let text = view.nativeText as NSString
        let bold = text.range(of: "**bold**", options: [], range: NSRange(location: anchor.location, length: min(400, text.length - anchor.location)))
        let inside = bold.location == NSNotFound ? anchor.location + 3 : bold.location + 4
        let outside = bold.location == NSNotFound ? anchor.location : bold.location + bold.length + 3
        let far = min(text.length - 1, anchor.location + 6_000)
        func moves(_ positions: [Int], times: Int) async -> (styler: [Double], whole: [Double]) {
            styler.resetMeasurements()
            var wholeTimes: [Double] = []
            for index in 0..<times {
                let started = clock.now
                view.selectedRange = NSRange(location: positions[index % positions.count], length: 0)
                view.layoutIfNeeded()
                wholeTimes.append(milliseconds(clock.now - started))
                try? await Task.sleep(for: .milliseconds(16))
            }
            return (styler.measurements.selectionMilliseconds, wholeTimes)
        }
        let across = await moves([inside, outside], times: 100)
        result["caretAcrossAConstruct"] = ["styler": summary(across.styler), "whole": summary(across.whole)] as [String: Any]
        let toOther = await moves([inside, far], times: 100)
        result["caretToAnotherParagraph"] = ["styler": summary(toOther.styler), "whole": summary(toOther.whole)] as [String: Any]
        _ = whole
        getloadavg(&load, 3)
        result["loadAverageAtEnd"] = load.map { (($0 * 10).rounded()) / 10 }
        let data = (try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    private static func settleAfterMove(_ styler: MarkdownStyler) async { try? await Task.sleep(for: .milliseconds(400)); _ = await settle(styler, limit: 60) }
}
#endif
