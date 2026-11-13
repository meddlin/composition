using System.Diagnostics;
using System.Text.Json.Nodes;
using Composition.Core.Search;
using Xunit;
using Xunit.Abstractions;

namespace Composition.Core.Tests;

/// <summary>Runs only when COMPOSITION_MEILI_BIN names a meilisearch executable (macOS here: the desktop's pinned v1.53.1).</summary>
public sealed class MeiliFactAttribute : FactAttribute
{
    public MeiliFactAttribute()
    {
        var bin = Environment.GetEnvironmentVariable("COMPOSITION_MEILI_BIN");
        if (bin is null || !File.Exists(bin)) Skip = "COMPOSITION_MEILI_BIN is not set to a meilisearch binary.";
    }
}

public class SidecarTests(ITestOutputHelper output)
{
    private static string Bin => Environment.GetEnvironmentVariable("COMPOSITION_MEILI_BIN")!;
    private static readonly DateTime T = new(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);

    private static MeiliSidecar New(string root) => new(Bin, Path.Combine(root, "search", "meili_data"), Path.Combine(root, "search", "meili.log"));

    private static JsonObject Doc(long id, string title, string content, params string[] tags) =>
        MeiliSidecar.NoteDocument(id, title, "", content, tags, T, T.AddMinutes(id));

    [MeiliFact]
    public async Task StartsHealthy_IndexesLikeTheDesktop_AndToleratesTypos()
    {
        using var sidecar = New(Scratch.NewDir());
        var sw = Stopwatch.StartNew();
        await sidecar.StartAsync();
        output.WriteLine($"started and healthy in {sw.ElapsedMilliseconds} ms (pid {sidecar.ProcessId})");
        await sidecar.EnsureIndexAsync();
        await sidecar.EnsureIndexAsync(); // idempotent, as ensureIndex() is
        var task = await sidecar.AddDocumentsAsync([
            Doc(1, "Kubernetes deployment notes", "pods, services and ingress", "devops", "k8s"),
            Doc(2, "Routing in React", "client side routing with a router", "web"),
            Doc(3, "Grocery list", "milk eggs bread", "home"),
        ]);
        await sidecar.WaitTaskAsync(task);

        Assert.Equal([1L], await sidecar.SearchIdsAsync("kubernetes"));
        Assert.Equal([1L], await sidecar.SearchIdsAsync("kubernets")); // one letter missing: still found (the iPad's C1 regression does not exist here)
        Assert.Equal([2L], await sidecar.SearchIdsAsync("routng"));
        Assert.Equal([1L], await sidecar.SearchIdsAsync("", filter: "tags = k8s"));
        Assert.Empty(await sidecar.SearchIdsAsync("zzzzqqqq"));
    }

    [MeiliFact]
    public async Task AHardKillDuringIndexing_LeavesAnIndexTheNextStartServes()
    {
        // The Electron plan's W8 test: "kill during indexing, start again, search works".
        var root = Scratch.NewDir();
        using (var first = New(root))
        {
            await first.StartAsync();
            await first.EnsureIndexAsync();
            var big = Enumerable.Range(1, 1500).Select(i => Doc(i, $"Bulk note {i}", string.Concat(Enumerable.Repeat("lorem ipsum dolor sit amet ", 200)))).ToList();
            await first.AddDocumentsAsync(big); // not waited for
            first.Kill();
            Assert.False(first.Running);
        }
        using var second = New(root);
        await second.StartAsync();
        await second.EnsureIndexAsync();
        var task = await second.AddDocumentsAsync([Doc(9999, "After the crash", "still works")]);
        await second.WaitTaskAsync(task);
        Assert.Contains(9999L, await second.SearchIdsAsync("crash"));
    }
}
