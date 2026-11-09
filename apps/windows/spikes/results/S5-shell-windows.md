# S5: the WinUI 3 shell, RichEditBox and WebView2 (Windows only)

**Status: written on a Mac, never built, never run. Every behaviour below is unverified.** This is the spike Gate B waits for.

## What was checked on the Mac, and what could not be

| Checked | Result |
|---|---|
| `dotnet restore` of an unpackaged WinUI 3 project, `Microsoft.WindowsAppSDK` 2.6.5, win-x64 and win-arm64 (with `EnableWindowsTargeting`) | **Resolves.** Its managed assets are `net6.0-windows10.0.17763.0`, so a `net10.0-windows` project can consume them; WebView2 arrives as 1.0.3719.77 |
| `dotnet build` | **Fails on macOS at the XAML compiler** ("output file was not created"): the compiler only runs on Windows. So the C# in `shell/` has not even been type-checked |
| `net10.0-windows` | Not tried: no .NET 10 SDK here |

## What it measures (on a Windows machine)

`measure.ps1` publishes the spike self-contained for `win-x64` (or `win-arm64`) and runs it unattended; it writes `%TEMP%\composition-shell-spike-results.json`:

| Number | Why it matters | Proposed pass line (a proposal; the user sets it at Gate B) |
|---|---|---|
| `msSetText5000Lines`, `msColourAll5000Lines` | Can a RichEditBox hold and colour a long note at all (Decision 2) | each under 1,000 ms |
| `typeEdit_ms_p50 / p95 / max` over 200 edits mid-note | Typing latency of the call, with the colourer running (the paint is not included; see below) | p95 under 16 ms, max under 50 ms |
| `msWebView2EnsureCore`, `msPreviewPageLoaded` | WebView2 cost at start and the page's first load | under 500 ms and 1,000 ms on the x64 PC |
| `msPostMessageToRendered300Lines`, `pageReportedMs` | The preview path end to end | under 200 ms |
| `mbWorkingSet_app`, `mbWorkingSet_webview2_all`, `webview2ProcessCount`, private-memory pair | The memory claim behind "go native": the Mac measurement (395 MB, of which Electron's floor is about 85 MB) is the only baseline, and it is a different OS | compare with the Electron Windows build on the **same machine** once it exists; do not compare with the Mac figure |
| `msFromProcessStartToFirstActivate`, `msFromLaunchToResults` | Cold start | record |
| exe folder size (printed) | Self-contained Windows App SDK footprint | record |
| `os`, `processArchitecture`, `dotnet`, `webView2Runtime` | So the numbers say what they ran on | |

Close every other WebView2 app first (Teams, Outlook, Widgets): the memory figure counts every `msedgewebview2.exe`.

## What it does not measure, and the checks that need a person

Paint latency and real typing feel (a person, Gate B); IME composition in Japanese and Chinese in the RichEditBox; Narrator reading the editor and the preview; high contrast; the
WebView2 "airspace" behaviour (can a XAML flyout draw over the web view?); touch and pen; Mica; DPI changes between monitors; and the Job Object test (S4): start the host, kill it from Task Manager, confirm no `meilisearch.exe`
remains. The acceptance list is in [the design's native bar](../../../../docs/windows-native-app-design.md#the-native-bar-windows).

## Before running

1. A Windows 11 machine (Arm VM is fine for everything but speed; see the design's Decision 6), Visual Studio 2022 with the ".NET desktop development" workload and the Windows App SDK, or the .NET 10 SDK and `dotnet`.
2. `apps/windows/spikes/preview/dist` from the Mac (`preview/build.sh`), or Node 22+ and `pnpm install` in `apps/web` on the Windows machine.
3. `pwsh apps/windows/spikes/shell/measure.ps1` (add `-Runtime win-arm64` on Arm). Paste back the JSON and the folder size.
