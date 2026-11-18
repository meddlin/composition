import Foundation
import Testing

@testable import CompositionCore

// Return and Backspace in lists and quotes (docs/ipad-live-default-plan.md, Step 4), by hand: each answer here is what the desktop's CodeMirror does,
// read from list-continuation-expected.json. ListContinuationConformanceTests compares every caret place of every case with the desktop.

/// The text after the edit, with `|` where the caret lands; nil where the key is left to do what it always does.
private func after(_ text: String, _ edit: LineEdit?) -> String? {
    guard let edit else { return nil }
    let units = Array(text.utf16)
    var out = Array(units[..<edit.start]) + Array(edit.text.utf16) + Array(units[edit.end...])
    out.insert(0x7C, at: edit.selection.lowerBound)
    return String(decoding: out, as: UTF16.self)
}

/// `text` has a `|` where the caret is.
private func press(_ key: String, in marked: String) -> String? {
    let caret = (marked as NSString).range(of: "|").location
    let text = marked.replacingOccurrences(of: "|", with: "")
    return after(text, key == "return" ? ListContinuation.newline(text, at: caret) : ListContinuation.deleteBackward(text, at: caret))
}

@Suite("Return and Backspace in lists and quotes")
struct ListContinuationTests {
    @Test("Return at the end of an item writes the next item's marker", arguments: [
        ("- one|", "- one\n- |"),
        ("* star|", "* star\n* |"),
        ("1. one|", "1. one\n2. |"),
        ("9) nine|", "9) nine\n10) |"),
        ("- [x] done|", "- [x] done\n- [ ] |"),
        ("> quote|", "> quote\n> |"),
        ("> - in quote|", "> - in quote\n> - |"),
        ("- outer\n  - inner|", "- outer\n  - inner\n  - |"),
        ("- a\n\t- tab|", "- a\n\t- tab\n    - |"),  // the desktop writes the tab's columns as spaces
        ("- trailing   |", "- trailing\n- |"),
    ])
    func continues(_ marked: String, _ expected: String) {
        #expect(press("return", in: marked) == expected)
    }

    @Test("Return in the middle of an item splits it, and the numbers after it go up")
    func splits() {
        #expect(press("return", in: "- fo|o") == "- fo\n- |o")
        #expect(press("return", in: "1. a|\n2. b\n3. c") == "1. a\n2. |\n3. b\n4. c")
    }

    @Test("Return on an empty item takes its marker off: the list ends, or the item moves out a level")
    func ends() {
        #expect(press("return", in: "- one\n- two\n- |") == "- one\n- two\n|")
        #expect(press("return", in: "- |") == "|")
        #expect(press("return", in: "1. outer\n   1. a\n   2. b\n   3. |\n2. after") == "1. outer\n   1. a\n   2. b\n2. |\n3. after")
        #expect(press("return", in: "> - a\n> - b\n> - |") == "> - a\n> - b\n> |")
    }

    @Test("on the second item of a tight list, Return first makes the list loose, as the desktop does")
    func loosens() {
        #expect(press("return", in: "- one\n- |") == "- one\n\n- |")
        #expect(press("return", in: "- one\n\n- |") == "- one\n\n|")
    }

    @Test("Return on an empty quote line writes another, and on the second ends the quote")
    func quotes() {
        #expect(press("return", in: "> one\n> |") == "> one\n>\n> |")
        #expect(press("return", in: "> one\n>\n> |") == "> one\n\n|")
    }

    @Test("Return is left alone outside lists and quotes, in code, inside an HTML tag and inside the marker")
    func declines() {
        for marked in ["text|", "|", "```\n- not a list|\n```", "- item\n  ```\n  code|\n  ```", "- <Ma|rk>x</Mark>", "1|. one", "- - -|"] {
            #expect(press("return", in: marked) == nil, "\(marked)")
        }
    }

    @Test("Backspace just after an empty marker turns it into spaces, and then takes the spaces")
    func backspace() {
        #expect(press("backspace", in: "- one\n- |") == "- one\n  |")
        #expect(press("backspace", in: "- one\n  |") == "- one\n|")
        #expect(press("backspace", in: "1. one\n2. |") == "1. one\n   |")
        #expect(press("backspace", in: "- [x] done\n- [ ] |") == "- [x] done\n      |")
        #expect(press("backspace", in: "> one\n> |") == "> one\n|")
        #expect(press("backspace", in: "> > deep\n> > |") == "> > deep\n> |")
        #expect(press("backspace", in: "- |") == "|")
    }

    @Test("Backspace is left alone in an item's text and outside lists")
    func backspaceDeclines() {
        for marked in ["- one|", "- one |x", "text |", "|", "- [ ] task|"] {
            #expect(press("backspace", in: marked) == nil, "\(marked)")
        }
    }
}
