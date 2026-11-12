# Windows native app: spikes

Spike code for [docs/windows-native-app-design.md](../../../docs/windows-native-app-design.md). **Throwaway-grade, and not part of the root
workspace or CI.** Nothing under `apps/web`, `apps/desktop` or `apps/cli` is edited: the preview spike imports from `apps/web/src` and writes
only inside this folder.

**Gate A passed on 2026-11-12.** S1 (the core and its oracle) and S4 (the search sidecar, inside the core) were promoted to
[`apps/windows/`](../README.md): `Composition.Core`, `Composition.Core.Tests`, `oracle/` and `scripts/conformance.sh`. The S2 YAML probe
(`FrontmatterProbeTests`, `oracle/frontmatter.oracle.ts`) was deleted; its numbers are in its note, and the code is in git history before
the promotion. What stays here is what Gate B still needs: S3's preview page and S5's shell.

Dates are 2026-11-07. Written on a Mac. **On 2026-11-12 S1, S2 and S5 ran on the physical x64 Windows PC** (S5 over Remote Desktop, so its timings
are not Gate B numbers); S3 and S4 have still not run on Windows.

| # | Spike | What it answers | Where it ran | Result |
|---|---|---|---|---|
| S1 | The .NET core with the schema pass, uuid pass and backup, checked against the desktop's real `db.ts` and `backup.ts` both ways. **Promoted** to `apps/windows/` | Can .NET share the desktop's database and backups without drift? Does its SQLite have FTS5? | **macOS (arm64)**, SDK 9.0.200; **Windows x64** (2026-11-12), SDK 10.0.404 | [results/S1-core.md](results/S1-core.md): 16 of 16 tests pass on macOS; on Windows, every backup and restore test passes, and the schema tests failed on `main`'s new PDF tables (drift, not Windows; fixed in the promotion) |
| S2 | A YamlDotNet probe against the shared corpus. **Deleted** at Gate A | What does the shared corpus look like today, and how far is stock YamlDotNet from js-yaml on it? | macOS; Windows x64, from `fixtures/conformance/` on `main` (same numbers) | [results/S2-corpus-and-yaml.md](results/S2-corpus-and-yaml.md) |
| S3 | [`preview/`](preview/): the web app's real `NoteMarkdown` built as a standalone page | Can the ten MDX components be hosted in a WebView2 control without rewriting them? | macOS, in the Browser pane (Chromium); built on Windows for S5 | [results/S3-preview-bundle.md](results/S3-preview-bundle.md) |
| S4 | The Meilisearch sidecar driven from .NET, with a Job Object for Windows. **Promoted** with the core (`apps/windows/Composition.Core/Search/`) | Can a .NET host run the desktop's Meilisearch index, and survive a hard kill? | macOS, against the pinned Meilisearch 1.53.1. **The Job Object never ran** | [results/S4-search-sidecar.md](results/S4-search-sidecar.md) |
| S5 | [`shell/`](shell/): a WinUI 3 window with a RichEditBox and a WebView2 | Gate B's numbers: RichEditBox on a 5,000-line note, WebView2 memory and start-up, the preview in WebView2 | **Windows x64, over Remote Desktop** (2026-11-12): builds and runs after three fixes | [results/S5-shell-windows.md](results/S5-shell-windows.md): preview path passes; RichEditBox typing fails the proposed line over RDP, needs a console run |

## Run the spikes that are left

```bash
apps/windows/spikes/preview/build.sh                        # S3: builds preview/dist (macOS, Linux; see the S5 note for Windows)
```

S5 runs on Windows only: see [results/S5-shell-windows.md](results/S5-shell-windows.md#run-it). The promoted core runs with
`apps/windows/scripts/conformance.sh` ([apps/windows/README.md](../README.md)).
