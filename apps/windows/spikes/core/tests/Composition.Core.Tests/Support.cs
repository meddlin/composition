using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Composition.Core.Tests;

/// <summary>A test that needs the oracle's files (written by the desktop's real TypeScript). Skipped, not failed, without them.</summary>
public sealed class OracleFactAttribute : FactAttribute
{
    public OracleFactAttribute()
    {
        if (Oracle.Dir is null) Skip = "COMPOSITION_ORACLE_DIR is not set; run apps/windows/spikes/run-core-spike.sh.";
    }
}

public static class Oracle
{
    public static string? Dir => Environment.GetEnvironmentVariable("COMPOSITION_ORACLE_DIR");
    public static string Path(string name) => System.IO.Path.Combine(Dir!, name);
    public static JsonNode Json(string name) => JsonNode.Parse(File.ReadAllText(Path(name)))!;
}

public static class Scratch
{
    public static string NewDir()
    {
        var dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "composition-core-spike-" + Guid.NewGuid().ToString("N")[..10]);
        Directory.CreateDirectory(dir);
        return dir;
    }
}

public static class Dump
{
    /// <summary>The same shape as oracle/support.ts <c>dumpSchema</c>, minus journal_mode.</summary>
    public static JsonNode Schema(SqliteConnection db)
    {
        var master = new JsonArray();
        var tables = new List<string>();
        using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                master.Add(new JsonObject
                {
                    ["type"] = r.GetString(0),
                    ["name"] = r.GetString(1),
                    ["tbl_name"] = r.GetString(2),
                    ["sql"] = r.IsDBNull(3) ? null : r.GetString(3),
                });
                if (r.GetString(0) == "table" && !r.GetString(1).StartsWith("sqlite_", StringComparison.Ordinal)) tables.Add(r.GetString(1));
            }
        }
        var columns = new JsonObject();
        foreach (var table in tables)
        {
            var list = new JsonArray();
            using var cmd = db.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info({table})";
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new JsonObject
                {
                    ["cid"] = r.GetInt64(0),
                    ["name"] = r.GetString(1),
                    ["type"] = r.GetString(2),
                    ["notnull"] = r.GetInt64(3),
                    ["dflt_value"] = r.IsDBNull(4) ? null : r.GetString(4),
                    ["pk"] = r.GetInt64(5),
                });
            columns[table] = list;
        }
        return new JsonObject { ["master"] = master, ["columns"] = columns };
    }

    public static long SchemaVersion(SqliteConnection db) => Scalar<long>(db, "PRAGMA schema_version");

    public static T Scalar<T>(SqliteConnection db, string sql)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return (T)Convert.ChangeType(cmd.ExecuteScalar()!, typeof(T), CultureInfo.InvariantCulture);
    }

    /// <summary>Every row of every table, by table name, in rowid order (oracle/support.ts <c>dumpData</c>).</summary>
    public static JsonObject Data(SqliteConnection db)
    {
        var result = new JsonObject();
        var names = new List<string>();
        using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
            using var r = cmd.ExecuteReader();
            while (r.Read()) names.Add(r.GetString(0));
        }
        foreach (var name in names)
        {
            var rows = new JsonArray();
            using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT * FROM {name} ORDER BY rowid";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var row = new JsonObject();
                for (var i = 0; i < r.FieldCount; i++)
                    row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i) switch
                    {
                        long l => JsonValue.Create(l),
                        string s => JsonValue.Create(s),
                        double d => JsonValue.Create(d),
                        var other => JsonValue.Create(Convert.ToString(other, CultureInfo.InvariantCulture)),
                    };
                rows.Add(row);
            }
            result[name] = rows;
        }
        return result;
    }

    public static void AssertSame(JsonNode expected, JsonNode actual, string what)
    {
        if (JsonNode.DeepEquals(expected, actual)) return;
        var where = FirstDifference(expected, actual, "$") ?? "(shapes differ)";
        Assert.Fail($"{what} differs. First difference at {where}");
    }

    /// <summary>The path of the first place two JSON trees differ, with both sides' values there.</summary>
    private static string? FirstDifference(JsonNode? a, JsonNode? b, string path)
    {
        if (JsonNode.DeepEquals(a, b)) return null;
        if (a is JsonObject oa && b is JsonObject ob)
        {
            foreach (var key in oa.Select(k => k.Key).Union(ob.Select(k => k.Key)))
            {
                oa.TryGetPropertyValue(key, out var va);
                ob.TryGetPropertyValue(key, out var vb);
                var d = FirstDifference(va, vb, $"{path}.{key}");
                if (d is not null) return d;
            }
        }
        if (a is JsonArray aa && b is JsonArray ab)
        {
            for (var i = 0; i < Math.Max(aa.Count, ab.Count); i++)
            {
                var d = FirstDifference(i < aa.Count ? aa[i] : null, i < ab.Count ? ab[i] : null, $"{path}[{i}]");
                if (d is not null) return d;
            }
        }
        return $"{path}\n  desktop: {Short(a)}\n  .NET:    {Short(b)}";
    }

    private static string Short(JsonNode? n)
    {
        var text = n?.ToJsonString() ?? "(missing)";
        return text.Length > 400 ? text[..400] + "…" : text;
    }

    /// <summary>Drops what is legitimately different between two runs (the random uuid, the "now" of a freshly adopted notebook).</summary>
    public static JsonObject WithoutRandom(JsonObject data)
    {
        var copy = (JsonObject)JsonNode.Parse(data.ToJsonString())!;
        foreach (var (table, rows) in copy)
        {
            foreach (var row in rows!.AsArray().Select(r => r!.AsObject()))
            {
                row.Remove("uuid");
                if (table == "notebooks") { row.Remove("created_at"); row.Remove("updated_at"); }
            }
        }
        return copy;
    }
}
