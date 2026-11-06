import Foundation
import GRDB
import Testing

@testable import CompositionCore

/// Spike S1, risk R6: is FTS5 in the SQLite GRDB links, and which tokenizers does it have? The answer is printed so the
/// design doc can record it per platform (run `swift test` for the Mac, `xcodebuild test` for the Simulator).
@Suite("FTS5")
struct Fts5Tests {
    @Test("FTS5 is compiled in and answers a MATCH query")
    func fts5Available() throws {
        let queue = try DatabaseQueue()
        try queue.write { db in
            let version = try String.fetchOne(db, sql: "SELECT sqlite_version()") ?? "?"
            let fts5 = try Int.fetchOne(db, sql: "SELECT sqlite_compileoption_used('ENABLE_FTS5')") ?? 0
            print("S1 SQLite \(version), ENABLE_FTS5=\(fts5)")

            try db.execute(sql: "CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, tokenize = 'porter unicode61')")
            try db.execute(sql: "INSERT INTO notes_fts (title, content) VALUES ('Trip plan', 'Walking through the old harbour')")
            try db.execute(sql: "INSERT INTO notes_fts (title, content) VALUES ('Groceries', 'Eggs and milk')")

            let hits = try String.fetchAll(db, sql: "SELECT title FROM notes_fts WHERE notes_fts MATCH ?", arguments: ["walk*"])
            #expect(hits == ["Trip plan"])
            // Porter stemming: "walks" finds "Walking".
            let stemmed = try String.fetchAll(db, sql: "SELECT title FROM notes_fts WHERE notes_fts MATCH ?", arguments: ["walks"])
            #expect(stemmed == ["Trip plan"])
        }
    }

    @Test("which tokenizers exist, for the typo-tolerance layer (C1)")
    func tokenizers() throws {
        let queue = try DatabaseQueue()
        try queue.write { db in
            for tokenizer in ["unicode61", "porter unicode61", "ascii", "trigram"] {
                do {
                    try db.execute(sql: "CREATE VIRTUAL TABLE t_\(abs(tokenizer.hashValue)) USING fts5(x, tokenize = '\(tokenizer)')")
                    print("S1 tokenizer '\(tokenizer)': available")
                } catch {
                    print("S1 tokenizer '\(tokenizer)': NOT available (\(error))")
                    if tokenizer != "trigram" { throw error }
                }
            }
            let vocab = try db.execute(sql: "CREATE VIRTUAL TABLE v USING fts5vocab(t_0, 'row')")
            _ = vocab
        }
    }
}
