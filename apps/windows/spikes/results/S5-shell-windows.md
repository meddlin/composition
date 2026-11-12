# S5: the WinUI 3 shell, RichEditBox and WebView2 (Windows only)

**Status (2026-11-12): built and run on Windows for the first time**, on the physical x64 PC (Windows 11 build 26300, AMD64, Radeon RX 480, 16 GB),
with .NET SDK 10.0.404 (runtime 10.0.15), Windows App SDK 2.6.5 and the WebView2 Runtime 157.0.4341.46.
**Every timing below was taken over Remote Desktop** (`rdp-tcp#0`, Microsoft Remote Display Adapter), so none of them is a Gate B number yet:
RDP changes how XAML, RichEdit and WebView2 render. Gate B needs the same run at the PC's own console.

## What it took to build and run

Written on a Mac, where the XAML compiler cannot run, so the C# had never been type-checked. On Windows:

| Problem | Fix |
|---|---|
| `ITextDocument` is inaccessible (CS0122) | WinUI 3's `RichEditBox.Document` is a `Microsoft.UI.Text.RichEditTextDocument`; `ITextDocument` is the UWP name. `MarkdownColour.cs` now takes `RichEditTextDocument` |
| `Operator '%' cannot be applied to 'int' and 'string'` | `i % 50 switch { … }` parses as `i % (50 switch { … })`; now `(i % 50) switch` |
| The XAML compiler's `WMC9999` / `WMC1509` | Only a symptom of the C# errors in pass 2; gone once they were fixed |
| **The published exe dies at start** in `Microsoft.UI.Xaml.dll` (stowed exception `0xc000027b`) | `dotnet publish` of the unpackaged app left out its own `Composition.Shell.Spike.pri` (the build output had it). `<EnableMsixTooling>true</EnableMsixTooling>` in the project fixes it; the published exe then runs and writes its results. **Carry this into the real app's project** |

No Visual Studio is installed: `dotnet build` and `dotnet publish` with the SDK alone are enough for an unpackaged WinUI 3 app. That is **the clean Windows build D7 asked for**: .NET 10 with Windows App SDK 2.6.5 builds, publishes and runs.

The memory figures were changed to count **only this app's WebView2 processes** (`CoreWebView2.Environment.GetProcessInfos()`), because the old machine-wide count included Windows Search and Microsoft 365 Copilot (19 `msedgewebview2` processes against our 6). The typing figure was split into its two parts, and a batched variant added (below).

## Results (over RDP; three runs from the build output, numbers are the range)

| Number | Result | Proposed pass line | Verdict over RDP |
|---|---|---|---|
| `msSetText5000Lines` | 1,029 to 1,082 ms | under 1,000 | just over |
| `msColourAll5000Lines` | 485 to 513 ms | under 1,000 | passes |
| `typeEdit` (one character, then recolour its paragraph), p50 / p95 / max | **34 / 43 to 46 / 410 to 506 ms** | p95 under 16, max under 50 | **fails** |
| … of which `typeTextOnly` (RichEdit inserting one character) | 17 / 21 to 25 / 410 to 486 ms | | |
| … of which `colourParagraphOnly` (one `GetRange`, `Expand`, set colour) | 17 / 20 to 23 / 26 to 34 ms | | |
| `typeEditBatched` (the same edit inside `BatchDisplayUpdates`) | 37 / 42 / 411 ms | | no better |
| `msWebView2EnsureCore` | 1,618 ms cold (first run, creates the user data folder); 273 to 290 ms warm | under 500 | warm passes, cold fails |
| `msPreviewPageLoaded` | 159 to 208 ms | under 1,000 | passes |
| `msPostMessageToRendered300Lines` (`pageReportedMs`) | 55 to 84 ms (43 to 58 ms) | under 200 | passes |
| `msFromProcessStartToFirstActivate` | 952 ms cold; 279 to 384 ms warm | record | |
| App process: working set / private | 138 to 148 MB / 70 to 75 MB | | |
| Our WebView2 (6 processes): working set / private | 426 to 431 MB / 304 to 316 MB | compare with Electron **on this PC** | not yet comparable |
| Published folder, self-contained win-x64, untrimmed | 242.7 MB | record | |

## What the numbers say, and do not

- **The preview path is fine**: the page loads in about 0.2 s and a 300-line render arrives in under 0.1 s.
- **RichEditBox editing is the open question (R1).** Each text-object call costs about 17 ms on a 5,000-line wrapped note: one frame at 60 Hz,
  which looked like waiting on the display, but holding repaint with `BatchDisplayUpdates` changed nothing, so it is not repaint. The max of 400 to 500 ms
  is one stall per 200 edits. Both could be RDP's rendering path. **Next:** the same run at the console; if it still fails, the same edits on a 300-line
  note (to tell a per-call cost from one that grows with the note) and with `TextWrapping="NoWrap"`, before D2's fallback (CodeMirror in WebView2) is considered.
- **Memory:** about 140 MB for the app plus about 430 MB working set (310 MB private) for its WebView2 processes. This does **not** yet show the "go native" memory win (R2);
  it needs the Electron build measured on this PC, and a console run, since WebView2's GPU process under RDP is not representative.
- The loop types on the UI thread without yielding, so it measures the call, not what a person feels; paint latency and feel are a person's job at Gate B.

## Still not measured, needs a person at the console

Paint latency and typing feel; IME composition in Japanese and Chinese in the RichEditBox; Narrator reading the editor and the preview; high contrast;
the WebView2 "airspace" behaviour (can a XAML flyout draw over the web view?); touch and pen; Mica (there is no Mica over RDP); DPI changes between monitors;
and the Job Object test (S4). The acceptance list is in [the design's native bar](../../../../docs/windows-native-app-design.md#the-native-bar-windows).

## Run it

1. Windows 10 or 11 with the .NET 10 SDK (Visual Studio is not needed), and the WebView2 Runtime (shipped with Windows 11).
2. The preview page: in `apps/web`, `npx pnpm@12.8.1 install --frozen-lockfile`; then, in `spikes/preview`, link `apps/web/node_modules` as `node_modules`
   (a directory junction on Windows: `New-Item -ItemType Junction node_modules -Target ..\..\..\web\node_modules`) and run
   `..\..\..\web\node_modules\.bin\vite.cmd build --config vite.config.mts` (what `build.sh` does on macOS and Linux).
3. **At the machine's own console, not over Remote Desktop:** `powershell -ExecutionPolicy Bypass -File apps\windows\spikes\shell\measure.ps1`
   (add `-Runtime win-arm64` on Arm). It publishes, runs the spike unattended and prints the JSON and the folder size. Run it twice: the first run is the cold start.
