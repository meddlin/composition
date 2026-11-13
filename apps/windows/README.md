# Composition for Windows (native)

The native Windows app: C#/.NET 10 and WinUI 3, with the note's preview in a WebView2. The design, the feature tracker, the decisions and the
build steps are in [docs/windows-native-app-design.md](../../docs/windows-native-app-design.md). **The Electron desktop app is still the
shipping Windows plan** ([docs/windows-build-plan.md](../../docs/windows-build-plan.md)); this app reaches parity first.

Status (2026-11-12): Gate A passed; **build step 1 (the core) in progress**. There is no app yet.

## Layout

| Path | What |
|---|---|
| `Composition.Core/` | The data layer: the desktop's schema pass (`Schema.cs`), backup and restore (`Backup.cs`, `TarGz.cs`) and the Meilisearch sidecar (`Search/`, build step 2). No Windows-only API, so it builds and tests on macOS and Linux too |
| `Composition.Core.Tests/` | xUnit tests. The ones marked `[OracleFact]` need files the desktop's real TypeScript wrote, and skip without them |
| `oracle/` | Vitest files that run the desktop's **real** `db.ts` and `backup.ts` (from `apps/web`), to write those files and to read back what .NET wrote |
| `scripts/conformance.sh` | Runs the round trip: the desktop writes, .NET reads and writes, the desktop reads back |
| `global.json` | The .NET SDK decided at Gate A (D7) |
| `spikes/` | What Gate B still needs: the preview page (S3) and the WinUI 3 shell (S5) |

## Run the checks

Needs the .NET SDK from `global.json` and Node 24 or later. Once, install the web app's dependencies with its own pinned pnpm:

```bash
npx --yes pnpm@12.8.1 --dir apps/web install --frozen-lockfile
```

Then, from the repository root (Git Bash on Windows):

```bash
apps/windows/scripts/conformance.sh
```

`COMPOSITION_MEILI_BIN=<path to meilisearch>` also runs the search sidecar tests. `dotnet test apps/windows/Composition.slnx` alone runs the
tests that need no oracle files. CI runs the same script on Linux, macOS and Windows ([windows-core.yml](../../.github/workflows/windows-core.yml)).

## Rules

- **The desktop's TypeScript is the reference.** A schema or backup change in `apps/web/src/lib/composition` fails `windows-core` until the C# follows.
  Copy DDL statement for statement; never invent a column, table or file the desktop does not have (D3: both apps open the same database).
- **Schema text is written with LF line endings** whatever the checkout has (`Schema.ExecDdl`); a CRLF checkout once put `\r` into the shared schema.
- Connections are opened with `Pooling=False` (Windows keeps a pooled file open, which breaks the restore's file swap), a five-second busy timeout and WAL, as the desktop does.
