using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Composition.Core;

public sealed record BackupCounts(long Notes, long Groups, long TrashedNotes, long TrashedGroups, long Attachments,
    long Todos, long ArchivedTodos, long Contacts, long Images);

public sealed record BackupSummary(string File, long Bytes, string CreatedAt, BackupCounts Counts);

/// <summary>An unpacked, checked backup waiting in a scratch folder (nothing outside it has been touched).</summary>
public sealed record StagedBackup(string Dir, string CreatedAt, BackupCounts Counts, byte[]? SettingsJson, bool HasImages, bool HasAttachments);

/// <summary>
/// Backup and restore, ported from apps/web/src/lib/composition/backup.ts. One <c>.tar.gz</c>:
/// <c>composition-backup.json</c>, <c>settings.json</c>, <c>composition.db</c> (a <c>VACUUM INTO</c> snapshot),
/// <c>app_data/&lt;image&gt;</c>, <c>attachments/&lt;file&gt;</c>. Restore is two steps (stage, then apply with rollback)
/// so nothing is touched until the file is known to be good.
/// </summary>
public static class Backup
{
    public const string Format = "composition-backup";
    public const int FormatVersion = 1;
    public const string ImageDir = "app_data";
    public const string AttachmentDir = "attachments";
    private const string ManifestName = "composition-backup.json";
    private const string SettingsName = "settings.json";
    private const string DatabaseName = "composition.db";
    private static readonly string[] DatabaseSuffixes = ["-wal", "-shm", "-journal"];
    private const long MaxJsonBytes = 1024 * 1024;

    // imageRefs.ts IMAGE_NAME and backup.ts STORED_NAME, copied.
    private static readonly Regex ImageName = new(@"^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex StoredName = new(@"^[A-Za-z0-9][A-Za-z0-9._-]*$", RegexOptions.CultureInvariant);

    private static SqliteConnection OpenFile(string file, bool readOnly)
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = file,
            Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString());
        c.Open();
        return c;
    }

    private static long Count(SqliteConnection db, string table, string where = "1")
    {
        try
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*) FROM {table} WHERE {where}";
            return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        }
        catch (SqliteException)
        {
            return 0; // a table or column an older version never created counts as 0
        }
    }

    private static BackupCounts CountRows(string databaseFile, long images)
    {
        using var db = OpenFile(databaseFile, readOnly: true);
        var archived = Count(db, "todos", "archived_at IS NOT NULL");
        return new BackupCounts(Count(db, "notes"), Count(db, "groups"), Count(db, "trashed_notes"), Count(db, "trashed_groups"),
            Count(db, "attachments"), Count(db, "todos") - archived, archived, Count(db, "contacts"), images);
    }

    private static List<string> ListFiles(string dir) =>
        Directory.Exists(dir)
            ? Directory.EnumerateFiles(dir).Select(Path.GetFileName).OfType<string>().Where(n => !n.StartsWith('.')).Order(StringComparer.Ordinal).ToList()
            : [];

    private static byte[] ManifestBytes(string createdAt, BackupCounts c)
    {
        using var stream = new MemoryStream();
        // NewLine "\n": the default is Environment.NewLine, which is "\r\n" on Windows; JSON.stringify writes "\n".
        using (var w = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true, NewLine = "\n" }))
        {
            w.WriteStartObject();
            w.WriteString("format", Format);
            w.WriteNumber("version", FormatVersion);
            w.WriteString("createdAt", createdAt);
            w.WriteStartObject("counts");
            w.WriteNumber("notes", c.Notes);
            w.WriteNumber("groups", c.Groups);
            w.WriteNumber("trashedNotes", c.TrashedNotes);
            w.WriteNumber("trashedGroups", c.TrashedGroups);
            w.WriteNumber("attachments", c.Attachments);
            w.WriteNumber("todos", c.Todos);
            w.WriteNumber("archivedTodos", c.ArchivedTodos);
            w.WriteNumber("contacts", c.Contacts);
            w.WriteNumber("images", c.Images);
            w.WriteEndObject();
            w.WriteEndObject();
        }
        stream.WriteByte((byte)'\n');
        return stream.ToArray();
    }

    /// <summary>
    /// Writes the backup to <paramref name="file"/>. <paramref name="db"/> is the live connection: the snapshot is taken with
    /// <c>VACUUM INTO</c>, which is consistent while the app is writing. <paramref name="settingsJson"/> is carried as it is
    /// (the iPad design's G5: a partial settings file would reset the desktop's colour scheme on restore).
    /// </summary>
    public static BackupSummary Create(string file, SqliteConnection db, string appDataDir, byte[]? settingsJson, DateTime? now = null)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
        var scratch = Directory.CreateTempSubdirectory(".composition-backup-").FullName;
        try
        {
            var snapshot = Path.Combine(scratch, DatabaseName);
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = "VACUUM INTO $path";
                cmd.Parameters.AddWithValue("$path", snapshot);
                cmd.ExecuteNonQuery();
            }
            var images = ListFiles(Path.Combine(appDataDir, ImageDir)).Where(n => ImageName.IsMatch(n)).ToList();
            var attachments = ListFiles(Path.Combine(appDataDir, AttachmentDir)).Where(n => StoredName.IsMatch(n)).ToList();
            var createdAt = Timestamp.Format(now ?? DateTime.UtcNow);
            var counts = CountRows(snapshot, images.Count);

            var contents = new List<(string, byte[])> { (ManifestName, ManifestBytes(createdAt, counts)) };
            if (settingsJson is not null) contents.Add((SettingsName, settingsJson));
            var sources = new List<ArchiveSource> { new(DatabaseName, snapshot) };
            sources.AddRange(images.Select(n => new ArchiveSource($"{ImageDir}/{n}", Path.Combine(appDataDir, ImageDir, n))));
            sources.AddRange(attachments.Select(n => new ArchiveSource($"{AttachmentDir}/{n}", Path.Combine(appDataDir, AttachmentDir, n))));
            TarGz.Write(file, contents, sources);
            return new BackupSummary(file, new FileInfo(file).Length, createdAt, counts);
        }
        finally
        {
            Directory.Delete(scratch, recursive: true);
        }
    }

    private static byte[] ReadJson(Stream data, long size, string what)
    {
        if (size > MaxJsonBytes) throw new ArchiveError($"The backup's {what} is too large to be real.");
        using var buffer = new MemoryStream();
        data.CopyTo(buffer);
        try { using var _ = JsonDocument.Parse(buffer.ToArray()); }
        catch (JsonException) { throw new ArchiveError($"The backup's {what} is damaged."); }
        return buffer.ToArray();
    }

    /// <summary>Unpacks and validates the backup into a scratch folder inside <paramref name="appDataDir"/> (same disk as the final location, so the swap is a rename).</summary>
    public static StagedBackup Stage(string file, string appDataDir)
    {
        if (!File.Exists(file)) throw new ArchiveError($"Can't read {file}.");
        Directory.CreateDirectory(appDataDir);
        var dir = Path.Combine(appDataDir, ".restore-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(dir);
        try
        {
            string? createdAt = null;
            byte[]? settings = null;
            var hasDatabase = false;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            long images = 0, attachments = 0;

            TarGz.Read(file, (name, size, data) =>
            {
                if (!seen.Add(name)) throw new ArchiveError($"The backup lists {name} twice.");
                if (name == ManifestName)
                {
                    var json = ReadJson(data, size, "description");
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;
                    if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("format", out var f) || f.GetString() != Format
                        || !root.TryGetProperty("version", out var v) || v.ValueKind != JsonValueKind.Number)
                        throw new ArchiveError("This is not a Composition backup.");
                    if (v.GetInt32() > FormatVersion)
                        throw new ArchiveError($"This backup was made by a newer version of Composition (backup format {v.GetInt32()}); update Composition to restore it.");
                    createdAt = root.GetProperty("createdAt").GetString();
                    return;
                }
                if (name == SettingsName) { settings = ReadJson(data, size, "settings"); return; }

                string target;
                if (name == DatabaseName)
                {
                    hasDatabase = true;
                    target = Path.Combine(dir, DatabaseName);
                }
                else
                {
                    var parts = name.Split('/');
                    var valid = parts.Length == 2 && ((parts[0] == ImageDir && ImageName.IsMatch(parts[1])) || (parts[0] == AttachmentDir && StoredName.IsMatch(parts[1])));
                    if (!valid) throw new ArchiveError($"The backup contains a file Composition doesn't know ({name}), so it was not restored.");
                    if (parts[0] == ImageDir) images++; else attachments++;
                    Directory.CreateDirectory(Path.Combine(dir, parts[0]));
                    target = Path.Combine(dir, parts[0], parts[1]);
                }
                using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                data.CopyTo(output);
            });

            if (createdAt is null) throw new ArchiveError("This is not a Composition backup.");
            if (!hasDatabase) throw new ArchiveError("This backup has no database in it, so nothing was restored.");
            var staged = Path.Combine(dir, DatabaseName);
            AssertUsable(staged);
            return new StagedBackup(dir, createdAt, CountRows(staged, images), settings, images > 0, attachments > 0);
        }
        catch
        {
            Directory.Delete(dir, recursive: true);
            throw;
        }
    }

    private static void AssertUsable(string databaseFile)
    {
        try
        {
            using var db = OpenFile(databaseFile, readOnly: true);
            using var check = db.CreateCommand();
            check.CommandText = "PRAGMA quick_check";
            var ok = Convert.ToString(check.ExecuteScalar(), CultureInfo.InvariantCulture) == "ok";
            using var has = db.CreateCommand();
            has.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'";
            if (!ok || has.ExecuteScalar() is null)
                throw new ArchiveError("The database inside this backup is damaged or isn't a Composition database, so nothing was restored.");
        }
        catch (SqliteException)
        {
            throw new ArchiveError("The database inside this backup is damaged, so nothing was restored.");
        }
    }

    private static bool Exists(string path) => File.Exists(path) || Directory.Exists(path);

    /// <summary>A rename, falling back to copy-then-delete across volumes.</summary>
    private static void MoveEntry(string source, string target)
    {
        try
        {
            if (Directory.Exists(source)) Directory.Move(source, target); else File.Move(source, target);
        }
        catch (IOException) when (!Exists(target))
        {
            if (Directory.Exists(source)) { CopyDirectory(source, target); Directory.Delete(source, true); }
            else { File.Copy(source, target); File.Delete(source); }
        }
    }

    private static void CopyDirectory(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var f in Directory.EnumerateFiles(source)) File.Copy(f, Path.Combine(target, Path.GetFileName(f)));
        foreach (var d in Directory.EnumerateDirectories(source)) CopyDirectory(d, Path.Combine(target, Path.GetFileName(d)));
    }

    /// <summary>
    /// Replaces the current database, images and attachments with the staged ones, with a rollback if anything fails halfway.
    /// The caller must have closed every connection to the database (with pooling on, on Windows, "closed" is not enough).
    /// </summary>
    public static void ApplyStaged(StagedBackup staged, string appDataDir, string dbPath)
    {
        var aside = Path.Combine(staged.Dir, "previous");
        Directory.CreateDirectory(aside);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);

        var swaps = new List<(string Current, string? Replacement)> { (dbPath, Path.Combine(staged.Dir, DatabaseName)) };
        swaps.AddRange(DatabaseSuffixes.Select(s => (dbPath + s, (string?)null)));
        swaps.Add((Path.Combine(appDataDir, ImageDir), staged.HasImages ? Path.Combine(staged.Dir, ImageDir) : null));
        swaps.Add((Path.Combine(appDataDir, AttachmentDir), staged.HasAttachments ? Path.Combine(staged.Dir, AttachmentDir) : null));

        var setAside = new List<(string Current, string Parked)>();
        var placed = new List<string>();
        try
        {
            for (var i = 0; i < swaps.Count; i++)
            {
                var current = swaps[i].Current;
                if (!Exists(current)) continue;
                var parked = Path.Combine(aside, i.ToString(CultureInfo.InvariantCulture));
                MoveEntry(current, parked);
                setAside.Add((current, parked));
            }
            foreach (var (current, replacement) in swaps)
            {
                if (replacement is null) continue;
                MoveEntry(replacement, current);
                placed.Add(current);
            }
        }
        catch (Exception error)
        {
            foreach (var p in Enumerable.Reverse(placed)) { try { if (Directory.Exists(p)) Directory.Delete(p, true); else File.Delete(p); } catch (IOException) { } }
            foreach (var (current, parked) in Enumerable.Reverse(setAside)) { try { MoveEntry(parked, current); } catch (IOException) { } }
            throw new ArchiveError($"Could not restore: {error.Message}. Your previous data was put back.");
        }
        Directory.Delete(staged.Dir, recursive: true);
    }
}
