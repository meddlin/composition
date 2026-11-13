using Microsoft.Data.Sqlite;
using Xunit;
using Xunit.Abstractions;

namespace Composition.Core.Tests;

/// <summary>What the SQLite that ships with Microsoft.Data.Sqlite can do. Runs on the host's native build (macOS here); the Windows binaries were only inspected, see results/S1-core.md.</summary>
public class SqliteFeatureTests(ITestOutputHelper output)
{
    private static SqliteConnection Memory()
    {
        var c = new SqliteConnection("Data Source=:memory:");
        c.Open();
        return c;
    }

    [Fact]
    public void Fts5IsCompiledIn()
    {
        using var db = Memory();
        output.WriteLine("sqlite_version = " + Dump.Scalar<string>(db, "select sqlite_version()"));
        using var cmd = db.CreateCommand();
        cmd.CommandText = "PRAGMA compile_options";
        using var r = cmd.ExecuteReader();
        var options = new List<string>();
        while (r.Read()) options.Add(r.GetString(0));
        Assert.Contains("ENABLE_FTS5", options);
    }

    [Fact]
    public void WhatTheSearchDesignNeeds()
    {
        using var db = Memory();
        // The iPad design's choices: unicode61 with diacritics removed, prefix indexes, bm25 weights, fts5vocab for typo
        // expansion, trigram as the fallback, contentless_delete for a derived index. All of them, here.
        Schema.Exec(db, "create virtual table t using fts5(title, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3')");
        Schema.Exec(db, "insert into t(title, body) values ('Routing notes', 'Café résumé naïve'), ('Kubernetes', 'pods')");
        Assert.Equal(1, Dump.Scalar<long>(db, "select count(*) from t where t match 'rout*'"));
        Assert.Equal(1, Dump.Scalar<long>(db, "select count(*) from t where t match 'cafe'")); // diacritics folded
        Assert.Equal(1, Dump.Scalar<long>(db, "select count(*) from t where title match 'kubernetes'"));
        Assert.True(Dump.Scalar<double>(db, "select bm25(t, 10.0, 1.0) from t where t match 'routing'") < 0);
        Schema.Exec(db, "create virtual table v using fts5vocab(t, 'row')");
        Assert.True(Dump.Scalar<long>(db, "select count(*) from v where term like 'rout%'") >= 1);
        Schema.Exec(db, "create virtual table tg using fts5(x, tokenize='trigram')");
        Schema.Exec(db, "create virtual table cd using fts5(x, content='', contentless_delete=1)");
    }

    [Fact]
    public void OtherThingsTheSchemaPassUses()
    {
        using var db = Memory();
        Assert.Equal(32, Dump.Scalar<string>(db, "select lower(hex(randomblob(16)))").Length);
        Schema.Exec(db, "create table x (a)");
        Schema.Exec(db, "insert into x values (1)");
        Assert.Equal(1, Dump.Scalar<long>(db, "select json_extract('{\"a\":1}', '$.a')"));
    }
}
