# S5 on a Windows machine: runs the spike unattended and prints its numbers. Close every other WebView2 app first (Teams, Outlook,
# Widgets) or the memory figure counts theirs. Run from this folder in PowerShell 7 or Windows PowerShell.
param([string]$Runtime = "win-x64")   # win-arm64 on an Arm machine
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$here\..\preview\dist\index.html")) { throw "Build the preview page first (spikes/preview/build.sh needs Node and apps/web's dependencies; copy preview\dist over from the Mac if Node is not installed here)." }
dotnet publish "$here\Composition.Shell.Spike.csproj" -c Release -r $Runtime --self-contained -o "$here\out\$Runtime"
$results = Join-Path $env:TEMP "composition-shell-spike-results.json"
Remove-Item $results -ErrorAction SilentlyContinue
$env:COMPOSITION_SPIKE_AUTORUN = "1"
$p = Start-Process "$here\out\$Runtime\Composition.Shell.Spike.exe" -PassThru
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw "The spike did not finish in 120 s." }
Get-Content $results
"`nExe folder size (MB): " + [math]::Round(((Get-ChildItem "$here\out\$Runtime" -Recurse | Measure-Object Length -Sum).Sum / 1MB), 1)
