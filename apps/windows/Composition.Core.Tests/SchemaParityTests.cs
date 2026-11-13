using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Composition.Core.Tests;

/// <summary>
/// The schema pass against the desktop's real db.ts. Direction 1: the .NET pass on a database the desktop made or touched.
/// Direction 2 (the other half) is oracle/schema.oracle.ts "reverse": the real db.ts on databases this side wrote, which
/// scripts/conformance.sh runs after these tests.
/// </summary>
public partial class SchemaParityTests
{
    [GeneratedRegex("^[0-9a-f]{32}$")]
    private static partial Regex Hex32();

    [OracleFact]
    public void AFreshDatabaseHasTheDesktopsExactSchema()
    {
        var file = Path.Combine(Scratch.NewDir(), "composition.db");
        using var db = Schema.Open(file);
        Dump.AssertSame(Oracle.Json("ts-fresh.schema.json")["master"]!, Dump.Schema(db)["master"]!, "sqlite_master (every table, index and trigger, SQL text included)");
        Dump.AssertSame(Oracle.Json("ts-fresh.schema.json")["columns"]!, Dump.Schema(db)["columns"]!, "table_info");
    }

    [OracleFact]
    public void TheOldestDatabaseMigratesTheWayTheDesktopMigratesIt()
    {
        var file = Path.Combine(Scratch.NewDir(), "composition.db");
        File.Copy(Oracle.Path("old.db"), file);
        using var db = Schema.Open(file);
        var expectedSchema = Oracle.Json("ts-old-migrated.schema.json");
        Dump.AssertSame(expectedSchema["master"]!, Dump.Schema(db)["master"]!, "sqlite_master after migrating the oldest database");
        Dump.AssertSame(expectedSchema["columns"]!, Dump.Schema(db)["columns"]!, "table_info after migrating");

        var actual = Dump.Data(db);
        Dump.AssertSame(Dump.WithoutRandom((JsonObject)Oracle.Json("ts-old-migrated.data.json")), Dump.WithoutRandom(actual), "row data after migrating (uuids and the adopted notebook's timestamps ignored)");

        // the uuids themselves: present, 32 lowercase hex, unique within a table
        foreach (var table in Schema.UuidTables)
        {
            var uuids = actual[table]!.AsArray().Select(r => r!["uuid"]!.GetValue<string>()).ToList();
            Assert.All(uuids, u => Assert.Matches(Hex32(), u));
            Assert.Equal(uuids.Count, uuids.Distinct().Count());
        }
        // "ticked" to-dos became done, as db.ts does
        Assert.Equal("done", actual["todos"]![0]!["status"]!.GetValue<string>());
        Assert.Equal("todo", actual["todos"]![1]!["status"]!.GetValue<string>());
    }

    [OracleFact]
    public void ADatabaseTheDesktopHasTouchedIsANoOp()
    {
        var file = Path.Combine(Scratch.NewDir(), "composition.db");
        File.Copy(Oracle.Path("ts-populated.db"), file);

        JsonNode schemaBefore, dataBefore;
        long versionBefore;
        using (var raw = new SqliteConnection($"Data Source={file};Pooling=False"))
        {
            raw.Open();
            schemaBefore = Dump.Schema(raw);
            dataBefore = Dump.Data(raw);
            versionBefore = Dump.SchemaVersion(raw);
        }

        using var db = Schema.Open(file);
        Assert.Equal(0, Dump.Scalar<long>(db, "SELECT total_changes()")); // not one row changed, by us or by a trigger
        Assert.Equal(versionBefore, Dump.SchemaVersion(db)); // nothing was altered or created
        Dump.AssertSame(schemaBefore, Dump.Schema(db), "schema after the .NET pass");
        Dump.AssertSame(dataBefore, Dump.Data(db), "data after the .NET pass");
    }

    [Fact]
    public void TheSchemaTextHasUnixLineEndingsWhateverTheCheckoutHas()
    {
        // db.ts writes LF; a CRLF checkout of Schema.cs must not put CR characters into the shared database's sqlite_master.
        using var db = Schema.Open(Path.Combine(Scratch.NewDir(), "composition.db"));
        Assert.Equal(0, Dump.Scalar<long>(db, "SELECT COUNT(*) FROM sqlite_master WHERE instr(sql, char(13)) > 0"));
    }

    [Fact]
    public void ASecondOpenWritesNothing()
    {
        var file = Path.Combine(Scratch.NewDir(), "composition.db");
        Schema.Open(file).Dispose();
        using var db = Schema.Open(file);
        Assert.Equal(0, Dump.Scalar<long>(db, "SELECT total_changes()"));
    }

    [Fact]
    public void ARowInsertedWithoutAUuidGetsOne_AndTheIndexIsUnique()
    {
        var file = Path.Combine(Scratch.NewDir(), "composition.db");
        using var db = Schema.Open(file);
        Schema.Exec(db, "INSERT INTO notes (title, created_at, updated_at, notebook_id) VALUES ('a', 'x', 'x', 1)");
        Schema.Exec(db, "INSERT INTO groups (name, created_at, updated_at, notebook_id) VALUES ('g', 'x', 'x', 1)");
        Schema.Exec(db, "INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at) VALUES (5, 't', 'x', 'x', 'x')");
        Schema.Exec(db, "INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, created_at) VALUES (1, 'a.pdf', 'a-1.pdf', 'x', 1, 1, 'x')");
        Schema.Exec(db, "INSERT INTO pdf_annotations (document_id, page, kind, color, created_at, updated_at) VALUES (1, 0, 'note', 'yellow', 'x', 'x')");
        Schema.Exec(db, "INSERT INTO pdf_bookmarks (document_id, page, created_at) VALUES (1, 0, 'x')");
        foreach (var table in new[] { "notes", "groups", "trashed_notes", "documents", "pdf_annotations", "pdf_bookmarks" })
            Assert.Matches(Hex32(), Dump.Scalar<string>(db, $"SELECT uuid FROM {table}"));
        // an explicit duplicate is refused by the unique index, as on the desktop
        var uuid = Dump.Scalar<string>(db, "SELECT uuid FROM notes");
        Assert.Throws<SqliteException>(() => Schema.Exec(db, $"INSERT INTO notes (title, created_at, updated_at, uuid) VALUES ('b', 'x', 'x', '{uuid}')"));
    }

    [Fact]
    public void TheBackfillFillsEveryRowInBatches()
    {
        var file = Path.Combine(Scratch.NewDir(), "composition.db");
        using (var old = new SqliteConnection($"Data Source={file};Pooling=False"))
        {
            old.Open();
            Schema.Exec(old, "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
            Schema.InImmediateTransaction(old, () =>
            {
                for (var i = 0; i < 450; i++) Schema.Exec(old, $"INSERT INTO notes (title, created_at, updated_at) VALUES ('n{i}', 'x', 'x')");
            });
        }
        using var db = Schema.Open(file);
        Assert.Equal(450, Dump.Scalar<long>(db, "SELECT COUNT(DISTINCT uuid) FROM notes WHERE uuid IS NOT NULL"));
        Assert.Equal(0, Dump.Scalar<long>(db, "SELECT COUNT(*) FROM notes WHERE uuid IS NULL"));
        Assert.Equal(450, Dump.Scalar<long>(db, "SELECT COUNT(*) FROM notes WHERE notebook_id = 1")); // adoptOrphans
    }
}
