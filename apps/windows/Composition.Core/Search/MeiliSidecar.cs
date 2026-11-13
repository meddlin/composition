using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Composition.Core.Search;

public sealed class MeiliException(string message) : Exception(message);

/// <summary>
/// The desktop's Meilisearch sidecar (apps/desktop/src/main/meili.ts and apps/web/src/lib/composition/searchIndex.ts) driven from
/// .NET: the same flags, the same environment, the same one index "notes" with the same settings and document shape, over
/// Meilisearch's REST API (no SDK dependency). On Windows the child is put in a Job Object that kills it when this process
/// ends for any reason, which is what the Electron plan's "orphaned meilisearch.exe after a crash" risk wanted and could not
/// have (windows-build-plan.md, meili.ts reapOrphan).
/// </summary>
public sealed class MeiliSidecar : IDisposable
{
    private const string IndexUid = "notes";
    private readonly string _binary, _dataDir, _logPath;
    private Process? _process;
    private HttpClient? _http;
    private StreamWriter? _log;
    private JobObject? _job;

    public MeiliSidecar(string binary, string dataDir, string logPath)
    {
        _binary = binary;
        _dataDir = dataDir;
        _logPath = logPath;
    }

    public Uri? Url { get; private set; }
    public int? ProcessId => _process?.Id;
    public bool Running => _process is { HasExited: false };

    public async Task StartAsync(TimeSpan? healthTimeout = null)
    {
        if (_process is not null) throw new MeiliException("Meilisearch is already running");
        var stateDir = Path.GetDirectoryName(Path.GetFullPath(_dataDir))!;
        Directory.CreateDirectory(_dataDir);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_logPath))!);
        var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var port = FreePort();
        Url = new Uri($"http://127.0.0.1:{port}");

        var psi = new ProcessStartInfo(_binary)
        {
            WorkingDirectory = stateDir,
            UseShellExecute = false,
            CreateNoWindow = true, // the Windows equivalent of windowsHide: no console flashes up
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var arg in new[] { "--db-path", _dataDir, "--http-addr", $"127.0.0.1:{port}", "--dump-dir", Path.Combine(stateDir, "dumps"),
                     "--snapshot-dir", Path.Combine(stateDir, "snapshots"), "--no-analytics" }) psi.ArgumentList.Add(arg);
        psi.Environment["MEILI_MASTER_KEY"] = key;
        psi.Environment["MEILI_ENV"] = "production";

        _log = new StreamWriter(new FileStream(_logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
        _process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _process.OutputDataReceived += (_, e) => { if (e.Data is not null) lock (_log) _log.WriteLine(e.Data); };
        _process.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (_log) _log.WriteLine(e.Data); };
        try { _process.Start(); }
        catch (Exception e) { throw new MeiliException($"Could not start Meilisearch ({_binary}): {e.Message}"); }
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        // Before anything else can go wrong: tie the child's life to ours (Windows only; a no-op elsewhere).
        if (OperatingSystem.IsWindows()) { _job = JobObject.CreateKillOnClose(); _job.Add(_process); }

        _http = new HttpClient { BaseAddress = Url, Timeout = TimeSpan.FromSeconds(30) };
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var deadline = DateTime.UtcNow + (healthTimeout ?? TimeSpan.FromSeconds(15));
        while (DateTime.UtcNow < deadline)
        {
            if (_process.HasExited) throw new MeiliException($"Meilisearch exited early (code {_process.ExitCode}).");
            try { if ((await _http.GetAsync("/health")).IsSuccessStatusCode) return; }
            catch (HttpRequestException) { /* not listening yet */ }
            await Task.Delay(100);
        }
        Dispose();
        throw new MeiliException("Meilisearch did not become healthy in time.");
    }

    /// <summary>The desktop's index: id as primary key; searchable title, content, description; filterable tags and the two timestamps.</summary>
    public async Task EnsureIndexAsync()
    {
        // Creating an index that exists is an async task that fails, not a 409, so look first (searchIndex.ts does getIndex, then createIndex).
        using (var exists = await _http!.GetAsync($"/indexes/{IndexUid}"))
        {
            if (!exists.IsSuccessStatusCode)
                await WaitTaskAsync((await Send(HttpMethod.Post, "/indexes", new JsonObject { ["uid"] = IndexUid, ["primaryKey"] = "id" }))!.Value);
        }
        var settings = await Send(HttpMethod.Patch, $"/indexes/{IndexUid}/settings", new JsonObject
        {
            ["searchableAttributes"] = new JsonArray("title", "content", "description"),
            ["filterableAttributes"] = new JsonArray("tags", "created_at_ts", "updated_at_ts"),
            ["sortableAttributes"] = new JsonArray("updated_at_ts"),
        });
        await WaitTaskAsync(settings!.Value);
    }

    /// <summary>searchIndex.ts <c>noteToDocument</c>.</summary>
    public static JsonObject NoteDocument(long id, string title, string description, string content, IEnumerable<string> tags, DateTime createdUtc, DateTime updatedUtc) => new()
    {
        ["id"] = id, ["title"] = title, ["description"] = description, ["content"] = content,
        ["tags"] = new JsonArray(tags.Select(t => (JsonNode?)t).ToArray()),
        ["created_at_ts"] = new DateTimeOffset(createdUtc).ToUnixTimeSeconds(),
        ["updated_at_ts"] = new DateTimeOffset(updatedUtc).ToUnixTimeSeconds(),
    };

    /// <summary>Returns the task uid without waiting, so a caller can kill the process mid-indexing.</summary>
    public async Task<long> AddDocumentsAsync(IEnumerable<JsonObject> documents)
    {
        var task = await Send(HttpMethod.Post, $"/indexes/{IndexUid}/documents", new JsonArray(documents.Select(d => (JsonNode?)d).ToArray()));
        return task!.Value;
    }

    public async Task WaitTaskAsync(long uid)
    {
        for (var i = 0; i < 600; i++)
        {
            using var response = await _http!.GetAsync($"/tasks/{uid}");
            var status = JsonNode.Parse(await response.Content.ReadAsStringAsync())?["status"]?.GetValue<string>();
            if (status == "succeeded") return;
            if (status == "failed" || status == "canceled") throw new MeiliException($"Meilisearch task {uid} {status}.");
            await Task.Delay(50);
        }
        throw new MeiliException($"Meilisearch task {uid} did not finish.");
    }

    /// <summary>Ids of the hits, best first, capped at 50 like the desktop's SEARCH_LIMIT.</summary>
    public async Task<List<long>> SearchIdsAsync(string query, string? filter = null)
    {
        var body = new JsonObject { ["q"] = query, ["limit"] = 50, ["attributesToRetrieve"] = new JsonArray("id") };
        if (filter is not null) body["filter"] = filter;
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/indexes/{IndexUid}/search") { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        using var response = await _http!.SendAsync(request);
        if (!response.IsSuccessStatusCode) throw new MeiliException($"search failed: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!["hits"]!.AsArray().Select(h => h!["id"]!.GetValue<long>()).ToList();
    }

    private async Task<long?> Send(HttpMethod method, string path, JsonNode body)
    {
        using var request = new HttpRequestMessage(method, path) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        using var response = await _http!.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new MeiliException($"{method} {path} failed: {(int)response.StatusCode} {text}");
        return JsonNode.Parse(text)!["taskUid"]!.GetValue<long>();
    }

    /// <summary>A hard kill, as on the desktop (Windows has no SIGTERM for a GUI app's child). The index is derived data, rebuilt from SQLite on start.</summary>
    public void Kill()
    {
        try { _process?.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        _process?.WaitForExit(5000);
    }

    private static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public void Dispose()
    {
        Kill();
        _http?.Dispose();
        _log?.Dispose();
        _job?.Dispose();
        _process?.Dispose();
        _process = null;
    }
}

/// <summary>
/// A Windows Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: when the last handle to the job closes (which Windows does when
/// this process exits or is killed), every process in it is terminated. UNVERIFIED: written on macOS, compiled there, never run.
/// </summary>
internal sealed class JobObject : IDisposable
{
    private IntPtr _handle;
    private JobObject(IntPtr handle) => _handle = handle;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimit
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimit
    {
        public BasicLimit Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint KillOnJobClose = 0x2000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);

    public static JobObject CreateKillOnClose()
    {
        var handle = CreateJobObjectW(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new MeiliException($"CreateJobObject failed ({Marshal.GetLastWin32Error()}).");
        var info = new ExtendedLimit { Basic = { LimitFlags = KillOnJobClose } };
        var size = Marshal.SizeOf<ExtendedLimit>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, buffer, (uint)size))
                throw new MeiliException($"SetInformationJobObject failed ({Marshal.GetLastWin32Error()}).");
        }
        finally { Marshal.FreeHGlobal(buffer); }
        return new JobObject(handle);
    }

    public void Add(Process process)
    {
        if (!AssignProcessToJobObject(_handle, process.Handle))
            throw new MeiliException($"AssignProcessToJobObject failed ({Marshal.GetLastWin32Error()}).");
    }

    public void Dispose()
    {
        if (_handle != IntPtr.Zero) { CloseHandle(_handle); _handle = IntPtr.Zero; }
    }
}
