using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Composition.Shell.Spike;

/// <summary>
/// S5: the native frame around the two things Decision 2 turns on, measured. Nothing here is production code and none of it has been run.
/// The numbers it writes (results.json) are the spike's output; see README.md for what to do with them.
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly Dictionary<string, object> _results = new();
    private readonly Stopwatch _sinceLaunch = Stopwatch.StartNew();
    private TaskCompletionSource<JsonElement>? _rendered;
    private bool _previewReady;

    public MainWindow()
    {
        InitializeComponent();
        Activated += OnFirstActivated;
        Editor.Loaded += async (_, _) => await InitPreviewAsync();
    }

    private void OnFirstActivated(object sender, WindowActivatedEventArgs e)
    {
        Activated -= OnFirstActivated;
        _results["os"] = RuntimeInformation.OSDescription;
        _results["processArchitecture"] = RuntimeInformation.ProcessArchitecture.ToString();
        _results["dotnet"] = RuntimeInformation.FrameworkDescription;
        _results["msFromProcessStartToFirstActivate"] = (long)(DateTime.Now - App.ProcessStart).TotalMilliseconds;
    }

    private async Task InitPreviewAsync()
    {
        try
        {
            var dist = Environment.GetEnvironmentVariable("COMPOSITION_PREVIEW_DIST") ?? Path.Combine(AppContext.BaseDirectory, "preview");
            var sw = Stopwatch.StartNew();
            await Preview.EnsureCoreWebView2Async();
            _results["msWebView2EnsureCore"] = sw.ElapsedMilliseconds;
            _results["webView2Runtime"] = CoreWebView2Environment.GetAvailableBrowserVersionString();
            // The page and the stored images come from folders on disk through virtual hosts: https URLs, no bridge, no local web server.
            Preview.CoreWebView2.SetVirtualHostNameToFolderMapping("composition.app", dist, CoreWebView2HostResourceAccessKind.Allow);
            var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".composition");
            Directory.CreateDirectory(data);
            Preview.CoreWebView2.SetVirtualHostNameToFolderMapping("composition.local", data, CoreWebView2HostResourceAccessKind.DenyCors);
            Preview.CoreWebView2.WebMessageReceived += (_, e) =>
            {
                using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                if (doc.RootElement.TryGetProperty("type", out var t) && t.GetString() == "rendered") _rendered?.TrySetResult(doc.RootElement.Clone());
            };
            var loaded = new TaskCompletionSource();
            Preview.CoreWebView2.NavigationCompleted += (_, _) => loaded.TrySetResult();
            sw.Restart();
            Preview.CoreWebView2.Navigate("https://composition.app/index.html");
            await loaded.Task;
            _results["msPreviewPageLoaded"] = sw.ElapsedMilliseconds;
            _previewReady = true;
            Say("Preview ready.");
            if (Environment.GetEnvironmentVariable("COMPOSITION_SPIKE_AUTORUN") == "1") await RunAllAsync(exitWhenDone: true);
        }
        catch (Exception ex) { Say("Preview failed: " + ex.Message); _results["previewError"] = ex.ToString(); }
    }

    private static string Note(int lines)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < lines; i++)
        {
            sb.Append(i % 50 switch
            {
                0 => $"# Section {i / 50}\r",
                1 => "<Info>\r",
                3 => "</Info>\r",
                5 => "```ts\r",
                9 => "```\r",
                var n when n % 7 == 0 => $"- item {i} with **bold**, _emphasis_ and a [link](note:{i})\r",
                _ => $"Line {i}: the quick brown fox jumps over the lazy dog, café résumé naïve 日本語.\r",
            });
        }
        return sb.ToString();
    }

    private void Say(string text) => Status.Text = text;

    private void LoadNote_Click(object sender, RoutedEventArgs e) => LoadNote();
    private void ColourAll_Click(object sender, RoutedEventArgs e) => ColourAll();
    private void Type_Click(object sender, RoutedEventArgs e) => TypeTimed();
    private async void Render_Click(object sender, RoutedEventArgs e) => await RenderAsync();
    private async void RunAll_Click(object sender, RoutedEventArgs e) => await RunAllAsync(exitWhenDone: false);

    private void LoadNote()
    {
        var text = Note(5000);
        var sw = Stopwatch.StartNew();
        Editor.Document.SetText(TextSetOptions.None, text);
        _results["msSetText5000Lines"] = sw.ElapsedMilliseconds;
        Say($"Loaded 5,000 lines in {sw.ElapsedMilliseconds} ms.");
    }

    private void ColourAll()
    {
        var sw = Stopwatch.StartNew();
        MarkdownColour.ApplyAll(Editor.Document);
        _results["msColourAll5000Lines"] = sw.ElapsedMilliseconds;
        Say($"Coloured the whole note in {sw.ElapsedMilliseconds} ms.");
    }

    private void TypeTimed()
    {
        var doc = Editor.Document;
        doc.Selection.SetRange(0, 0);
        // In the middle of the note, where a person is likely to be typing.
        doc.GetText(TextGetOptions.None, out var all);
        var middle = all.IndexOf("Line 2500:", StringComparison.Ordinal);
        doc.Selection.SetRange(Math.Max(middle, 0), Math.Max(middle, 0));
        var times = new List<double>(200);
        for (var i = 0; i < 200; i++)
        {
            var t0 = Stopwatch.GetTimestamp();
            doc.Selection.TypeText("x");
            MarkdownColour.ApplyParagraph(doc, doc.Selection.StartPosition);
            times.Add(Stopwatch.GetElapsedTime(t0).TotalMilliseconds);
        }
        times.Sort();
        _results["typeEdit_ms_p50"] = Math.Round(times[times.Count / 2], 2);
        _results["typeEdit_ms_p95"] = Math.Round(times[(int)(times.Count * 0.95)], 2);
        _results["typeEdit_ms_max"] = Math.Round(times[^1], 2);
        Say($"200 edits in a 5,000-line note: p50 {_results["typeEdit_ms_p50"]} ms, p95 {_results["typeEdit_ms_p95"]} ms, max {_results["typeEdit_ms_max"]} ms (the call, not the paint).");
    }

    private async Task RenderAsync()
    {
        if (!_previewReady) { Say("The preview page is not loaded."); return; }
        Editor.Document.GetText(TextGetOptions.None, out var text);
        var body = string.Join('\n', text.Split('\r').Take(300));
        _rendered = new TaskCompletionSource<JsonElement>();
        var sw = Stopwatch.StartNew();
        Preview.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "render", body, theme = "dark" }));
        var reply = await Task.WhenAny(_rendered.Task, Task.Delay(10_000));
        if (reply != _rendered.Task) { _results["previewRender"] = "timed out"; Say("Preview did not answer."); return; }
        _results["msPostMessageToRendered300Lines"] = sw.ElapsedMilliseconds;
        _results["pageReportedMs"] = _rendered.Task.Result.GetProperty("ms").GetInt64();
        Say($"Preview rendered 300 lines in {sw.ElapsedMilliseconds} ms (page says {_results["pageReportedMs"]} ms).");
    }

    private async Task RunAllAsync(bool exitWhenDone)
    {
        LoadNote();
        ColourAll();
        TypeTimed();
        await RenderAsync();
        await Task.Delay(1500); // let WebView2's helper processes settle before counting them
        RecordMemory();
        _results["msFromLaunchToResults"] = _sinceLaunch.ElapsedMilliseconds;
        var file = Path.Combine(Path.GetTempPath(), "composition-shell-spike-results.json");
        File.WriteAllText(file, JsonSerializer.Serialize(_results, new JsonSerializerOptions { WriteIndented = true }));
        Say("Wrote " + file);
        if (exitWhenDone) Application.Current.Exit();
    }

    private void RecordMemory()
    {
        long Mb(long bytes) => bytes / 1024 / 1024;
        using var self = Process.GetCurrentProcess();
        // Counts EVERY msedgewebview2 on the machine, so run this on a machine with no other WebView2 app open.
        var web = Process.GetProcessesByName("msedgewebview2");
        _results["mbWorkingSet_app"] = Mb(self.WorkingSet64);
        _results["mbWorkingSet_webview2_all"] = Mb(web.Sum(p => p.WorkingSet64));
        _results["webview2ProcessCount"] = web.Length;
        _results["mbPrivate_app"] = Mb(self.PrivateMemorySize64);
        _results["mbPrivate_webview2_all"] = Mb(web.Sum(p => p.PrivateMemorySize64));
        foreach (var p in web) p.Dispose();
    }
}
