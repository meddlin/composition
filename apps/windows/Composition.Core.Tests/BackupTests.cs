using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Composition.Core.Tests;

public class BackupTests
{
    private static readonly string LongImage = string.Concat(Enumerable.Repeat("a-very-long-image-name-", 5)) + "0123456789ab.png";

    private static void Fill(SqliteConnection db)
    {
        // the same rows as oracle/support.ts populate(), inserted without a uuid
        const string t = "2026-11-01T10:00:00.000Z";
        void Insert(string sql, params object?[] p)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = Rewrite(sql);
            for (var i = 0; i < p.Length; i++) cmd.Parameters.AddWithValue("$" + i, p[i] ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
        Insert("INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, ?, ?)", "Work", t, t);
        Insert("INSERT INTO groups (name, parent_id, created_at, updated_at, notebook_id, position) VALUES (?, ?, ?, ?, ?, ?)", "Projects", null, t, t, 1, 0);
        Insert("INSERT INTO groups (name, parent_id, created_at, updated_at, notebook_id, position) VALUES (?, ?, ?, ?, ?, ?)", "Sub", 1, t, t, 1, 0);
        for (var i = 1; i <= 6; i++)
            Insert("INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id, position, notebook_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                $"Note {i}", $"---\ntitle: Note {i}\n---\nBody {i} café ☕ 日本語", i % 2 == 1 ? "a,b" : "", "", t, t,
                i % 3 == 0 ? 2L : i % 3 == 1 ? 1L : null, (long)i, 1L);
        Insert("INSERT INTO trashed_notes (id, title, content, created_at, updated_at, group_id, deleted_at, notebook_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", 90L, "Trashed", "gone", t, t, null, t, 1L);
        Insert("INSERT INTO trashed_groups (id, name, parent_id, created_at, updated_at, deleted_at, notebook_id) VALUES (?, ?, ?, ?, ?, ?, ?)", 91L, "Trashed group", null, t, t, t, 1L);
        Insert("INSERT INTO attachments (note_id, file_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)", 1L, "Spec.pdf", "spec-1a2b3c.pdf", 5L, t);
        Insert("INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, view_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            2L, "Paper.pdf", "paper-0a1b2c.pdf", string.Concat(Enumerable.Repeat("ab", 32)), 6L, 2L, null, t);
        Insert("INSERT INTO pdf_annotations (document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            1L, 0L, "highlight", "yellow", "[[72,700,300,712]]", "a quoted line", "", null, null, t, t);
        Insert("INSERT INTO pdf_bookmarks (document_id, page, label, created_at) VALUES (?, ?, ?, ?)", 1L, 1L, "Intro", t);
    }

    /// <summary>"?" placeholders to numbered named parameters, so the SQL above reads like the oracle's.</summary>
    private static string Rewrite(string sql)
    {
        var sb = new StringBuilder();
        var n = 0;
        foreach (var ch in sql) sb.Append(ch == '?' ? "$" + n++ : ch.ToString());
        return sb.ToString();
    }

    private static void WriteAppFiles(string appDataDir)
    {
        Directory.CreateDirectory(Path.Combine(appDataDir, "app_data"));
        Directory.CreateDirectory(Path.Combine(appDataDir, "attachments"));
        Directory.CreateDirectory(Path.Combine(appDataDir, "documents"));
        File.WriteAllText(Path.Combine(appDataDir, "app_data", "diagram-0123456789ab.png"), "PNGDATA-1");
        File.WriteAllText(Path.Combine(appDataDir, "app_data", "photo-0123456789ab.jpg"), "JPEGDATA-22");
        File.WriteAllText(Path.Combine(appDataDir, "app_data", LongImage), "LONG");
        File.WriteAllText(Path.Combine(appDataDir, "attachments", "spec-1a2b3c.pdf"), "%PDF-1");
        File.WriteAllText(Path.Combine(appDataDir, "documents", "paper-0a1b2c.pdf"), "%PDF-2");
    }

    private static byte[] SettingsFromDesktopBackup()
    {
        byte[]? found = null;
        TarGz.Read(Oracle.Path("ts-backup.tar.gz"), (name, _, data) =>
        {
            if (name != "settings.json") return;
            using var ms = new MemoryStream();
            data.CopyTo(ms);
            found = ms.ToArray();
        });
        return found ?? throw new InvalidOperationException("the desktop backup has no settings.json");
    }

    [OracleFact]
    public void ADesktopBackupRestoresHere_EveryRowAndUuidIntact()
    {
        var appData = Scratch.NewDir();
        var dbPath = Path.Combine(appData, "composition.db");
        var staged = Backup.Stage(Oracle.Path("ts-backup.tar.gz"), appData);
        var summary = Oracle.Json("ts-backup.summary.json");
        Assert.Equal(summary["counts"]!["notes"]!.GetValue<long>(), staged.Counts.Notes);
        Assert.Equal(summary["counts"]!["images"]!.GetValue<long>(), staged.Counts.Images);
        Assert.Equal(summary["createdAt"]!.GetValue<string>(), staged.CreatedAt);
        Assert.Equal(summary["counts"]!["documents"]!.GetValue<long>(), staged.Counts.Documents);
        Assert.True(staged.HasImages && staged.HasAttachments && staged.HasDocuments && staged.SettingsJson is not null);

        Backup.ApplyStaged(staged, appData, dbPath);
        using var db = Schema.Open(dbPath); // a restored desktop database goes through the .NET pass: must be a no-op
        Assert.Equal(0, Dump.Scalar<long>(db, "SELECT total_changes()"));
        var expected = (JsonObject)Oracle.Json("ts-populated.data.json");
        var actual = Dump.Data(db);
        foreach (var table in Schema.UuidTables)
            Dump.AssertSame(expected[table]!, actual[table]!, $"{table} (uuid included)");
        Assert.Equal("PNGDATA-1", File.ReadAllText(Path.Combine(appData, "app_data", "diagram-0123456789ab.png")));
        Assert.Equal("LONG", File.ReadAllText(Path.Combine(appData, "app_data", LongImage))); // GNU long-name entry from Node's writer
        Assert.Equal("%PDF-1", File.ReadAllText(Path.Combine(appData, "attachments", "spec-1a2b3c.pdf")));
        Assert.Equal("%PDF-2", File.ReadAllText(Path.Combine(appData, "documents", "paper-0a1b2c.pdf")));
        Assert.False(Directory.EnumerateDirectories(appData, ".restore-*").Any()); // the scratch folder is gone
    }

    /// <summary>
    /// Writes what the real desktop code then reads back (oracle/schema.oracle.ts, phase "reverse"): a fresh .NET database with
    /// rows, the oldest database migrated by .NET, and a .NET backup carrying the desktop's own settings.json bytes.
    /// </summary>
    [OracleFact]
    public void WritesTheFilesTheDesktopReadsBack()
    {
        var oracle = Oracle.Dir!;
        var appData = Scratch.NewDir();
        WriteAppFiles(appData);
        var dbFile = Path.Combine(appData, "composition.db");
        var settings = SettingsFromDesktopBackup();

        using (var db = Schema.Open(dbFile))
        {
            Fill(db);
            var summary = Backup.Create(Path.Combine(oracle, "net-backup.tar.gz"), db, appData, settings, new DateTime(2026, 11, 7, 12, 0, 0, DateTimeKind.Utc));
            File.WriteAllText(Path.Combine(oracle, "net-backup.summary.json"), new JsonObject
            {
                ["createdAt"] = summary.CreatedAt,
                ["counts"] = new JsonObject
                {
                    ["notes"] = summary.Counts.Notes, ["groups"] = summary.Counts.Groups, ["trashedNotes"] = summary.Counts.TrashedNotes,
                    ["trashedGroups"] = summary.Counts.TrashedGroups, ["attachments"] = summary.Counts.Attachments, ["documents"] = summary.Counts.Documents, ["todos"] = summary.Counts.Todos,
                    ["archivedTodos"] = summary.Counts.ArchivedTodos, ["contacts"] = summary.Counts.Contacts, ["images"] = summary.Counts.Images,
                },
            }.ToJsonString());
            File.WriteAllText(Path.Combine(oracle, "net-fresh.data.json"), Dump.Data(db).ToJsonString());
        }
        // pooling is off, so Dispose closed the file: copy it for the desktop to open (a WAL database checkpoints on last close)
        File.Copy(dbFile, Path.Combine(oracle, "net-fresh.db"), overwrite: true);

        var oldFile = Path.Combine(Scratch.NewDir(), "composition.db");
        File.Copy(Oracle.Path("old.db"), oldFile);
        Schema.Open(oldFile).Dispose();
        File.Copy(oldFile, Path.Combine(oracle, "net-old-migrated.db"), overwrite: true);
    }

    [OracleFact]
    public void TheSettingsFileIsCarriedAsItCame()
    {
        // G5 of the iPad plan: a native app that rewrote settings.json would reset the desktop's colour scheme on restore.
        var appData = Scratch.NewDir();
        var settings = SettingsFromDesktopBackup();
        using var db = Schema.Open(Path.Combine(appData, "composition.db"));
        var file = Path.Combine(appData, "out.tar.gz");
        Backup.Create(file, db, appData, settings);
        var staged = Backup.Stage(file, Scratch.NewDir());
        Assert.Equal(settings, staged.SettingsJson);
    }

    [Fact]
    public void ThePlatformsOwnTarCanListWhatWeWrote()
    {
        var appData = Scratch.NewDir();
        WriteAppFiles(appData);
        using var db = Schema.Open(Path.Combine(appData, "composition.db"));
        Fill(db);
        var file = Path.Combine(appData, "b.tar.gz");
        Backup.Create(file, db, appData, "{}"u8.ToArray());

        string listing;
        try
        {
            using var tar = Process.Start(new ProcessStartInfo("tar", ["-tzf", file]) { RedirectStandardOutput = true, RedirectStandardError = true })!;
            listing = tar.StandardOutput.ReadToEnd();
            tar.WaitForExit();
            Assert.Equal(0, tar.ExitCode);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return; // no tar on this machine (Windows 10 1803+ and macOS have one)
        }
        var names = listing.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(n => n.Trim()).ToList();
        Assert.Contains("composition-backup.json", names);
        Assert.Contains("composition.db", names);
        Assert.Contains("app_data/diagram-0123456789ab.png", names);
        Assert.Contains($"app_data/{LongImage}", names);
        Assert.Contains("attachments/spec-1a2b3c.pdf", names);
        Assert.Contains("documents/paper-0a1b2c.pdf", names);
    }

    [Fact]
    public void ARoundTripThroughOurOwnWriterAndReaderKeepsEverything()
    {
        var appData = Scratch.NewDir();
        WriteAppFiles(appData);
        using var db = Schema.Open(Path.Combine(appData, "composition.db"));
        Fill(db);
        var before = Dump.Data(db);
        var file = Path.Combine(appData, "b.tar.gz");
        Backup.Create(file, db, appData, null);
        db.Dispose();

        var target = Scratch.NewDir();
        var staged = Backup.Stage(file, target);
        Assert.Null(staged.SettingsJson); // a backup without settings keeps the current ones (the desktop's rule)
        Backup.ApplyStaged(staged, target, Path.Combine(target, "composition.db"));
        using var restored = Schema.Open(Path.Combine(target, "composition.db"));
        foreach (var table in Schema.UuidTables) Dump.AssertSame(before[table]!, Dump.Data(restored)[table]!, table);
    }

    [Fact]
    public void ARestoreRefusesWhatTheDesktopRefuses()
    {
        var dir = Scratch.NewDir();
        // not a gzip at all
        var junk = Path.Combine(dir, "junk.tar.gz");
        File.WriteAllText(junk, "this is not a backup");
        Assert.Throws<ArchiveError>(() => Backup.Stage(junk, Scratch.NewDir()));
        // a gzip of the wrong thing
        var odd = Path.Combine(dir, "odd.tar.gz");
        TarGz.Write(odd, [("composition-backup.json", "{\"format\":\"composition-backup\",\"version\":1,\"createdAt\":\"x\"}"u8.ToArray()), ("../escape.txt", "x"u8.ToArray())], []);
        var error = Assert.Throws<ArchiveError>(() => Backup.Stage(odd, Scratch.NewDir()));
        Assert.Contains("doesn't know", error.Message);
        // a newer format
        var newer = Path.Combine(dir, "newer.tar.gz");
        TarGz.Write(newer, [("composition-backup.json", "{\"format\":\"composition-backup\",\"version\":2,\"createdAt\":\"x\"}"u8.ToArray())], []);
        Assert.Contains("newer version", Assert.Throws<ArchiveError>(() => Backup.Stage(newer, Scratch.NewDir())).Message);
        // no database in it
        var empty = Path.Combine(dir, "empty.tar.gz");
        TarGz.Write(empty, [("composition-backup.json", "{\"format\":\"composition-backup\",\"version\":1,\"createdAt\":\"x\"}"u8.ToArray())], []);
        Assert.Contains("no database", Assert.Throws<ArchiveError>(() => Backup.Stage(empty, Scratch.NewDir())).Message);
        // staging a refused backup leaves no scratch folder behind
        var target = Scratch.NewDir();
        Assert.Throws<ArchiveError>(() => Backup.Stage(empty, target));
        Assert.Empty(Directory.EnumerateDirectories(target));
    }

    [Fact]
    public void AFailedSwapPutsThePreviousDataBack()
    {
        var appData = Scratch.NewDir();
        var dbPath = Path.Combine(appData, "composition.db");
        using (var db = Schema.Open(dbPath)) Schema.Exec(db, "INSERT INTO notes (title, created_at, updated_at, notebook_id) VALUES ('keep me', 'x', 'x', 1)");

        var src = Scratch.NewDir();
        using (var db = Schema.Open(Path.Combine(src, "composition.db")))
            Backup.Create(Path.Combine(src, "b.tar.gz"), db, src, null);
        var staged = Backup.Stage(Path.Combine(src, "b.tar.gz"), appData);
        File.Delete(Path.Combine(staged.Dir, "composition.db")); // sabotage: the staged database vanishes before the swap
        Assert.Throws<ArchiveError>(() => Backup.ApplyStaged(staged, appData, dbPath));
        using var kept = Schema.Open(dbPath);
        Assert.Equal("keep me", Dump.Scalar<string>(kept, "SELECT title FROM notes"));
    }
}
