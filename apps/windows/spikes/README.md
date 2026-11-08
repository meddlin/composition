# Windows native app: spikes

Spike code for [docs/windows-native-app-design.md](../../../docs/windows-native-app-design.md). **Throwaway-grade, and not part of the root
workspace or CI** (the design's step 2 decides how a real `apps/windows` joins CI; until then nothing here is built by a workflow).
Nothing under `apps/web`, `apps/desktop` or `apps/cli` is edited: the oracle and preview spikes import from `apps/web/src` and
write only inside this folder.

Dates are 2026-11-07. Written on a Mac; **no spike has been run on Windows.**

| # | Spike | What it answers | Where it ran | Result |
|---|---|---|---|---|
| S1 | [`core/`](core/) + [`oracle/`](oracle/): a .NET library with the schema pass, uuid pass and backup, checked against the desktop's real `db.ts` and `backup.ts` both ways | Can .NET share the desktop's database and backups without drift? Does its SQLite have FTS5? | **macOS (arm64)**, SDK 9.0.200. Windows binaries of SQLite were only inspected, not run | [results/S1-core.md](results/S1-core.md): 16 of 16 tests pass |
| S2 | the same tests, `FrontmatterProbeTests` + `oracle/frontmatter.oracle.ts` | What does the shared corpus look like today, and how far is stock YamlDotNet from js-yaml on it? | macOS | [results/S2-corpus-and-yaml.md](results/S2-corpus-and-yaml.md) |
| S3 | [`preview/`](preview/): the web app's real `NoteMarkdown` built as a standalone page | Can the ten MDX components be hosted in a WebView2 control without rewriting them? | macOS, in the Browser pane (Chromium). **Not WebView2** | [results/S3-preview-bundle.md](results/S3-preview-bundle.md) |
| S4 | [`core/src/Composition.Core/Search/`](core/src/Composition.Core/Search/): the Meilisearch sidecar driven from .NET, with a Job Object for Windows | Can a .NET host run the desktop's Meilisearch index, and survive a hard kill? | macOS, against the pinned Meilisearch 1.53.1. **The Job Object never ran** | [results/S4-search-sidecar.md](results/S4-search-sidecar.md) |
| S5 | [`shell/`](shell/): a WinUI 3 window with a RichEditBox and a WebView2 | Gate B's numbers: RichEditBox on a 5,000-line note, WebView2 memory and start-up, the preview in WebView2 | **Windows only. Written, not built, not run** | [results/S5-shell-windows.md](results/S5-shell-windows.md) |

## Run the Mac-side spikes

Needs the web dependencies (`cd apps/web && pnpm install --frozen-lockfile`) and the .NET SDK.

```bash
apps/windows/spikes/run-core-spike.sh                       # S1, plus S2 and S4 when their inputs are given
COMPOSITION_MEILI_BIN=$(command -v meilisearch) apps/windows/spikes/run-core-spike.sh   # adds S4
apps/windows/spikes/preview/build.sh                        # S3: builds preview/dist
```

S2 needs `COMPOSITION_CORPUS_DIR` pointing at a directory that holds the shared corpus's `frontmatter-cases.json`. That corpus is not on
`main` (see the S2 note). For the recorded run it was extracted from the iPad branch with `git archive` into a scratch folder and **not
copied into this repository**.
