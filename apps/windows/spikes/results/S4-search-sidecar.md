# S4: the Meilisearch sidecar driven from .NET

**Result: 2 of 2 tests pass on macOS against the pinned Meilisearch 1.53.1. The Windows Job Object is compiled, never run.**

Decision 1 (the user's) is to bundle Meilisearch like the Electron app. `Search/MeiliSidecar.cs` does what `meili.ts` and `searchIndex.ts` do, over REST with no SDK:
the same flags (`--db-path`, `--http-addr 127.0.0.1:<free port>`, `--dump-dir`, `--snapshot-dir`, `--no-analytics`), the same environment (`MEILI_MASTER_KEY`, `MEILI_ENV=production`),
one index `notes` with primary key `id`, searchable `title`/`content`/`description`, filterable `tags`/`created_at_ts`/`updated_at_ts`, the same document shape, and a 50-hit cap.

| Check | Result |
|---|---|
| Start, wait for `/health` | healthy in 228 to 645 ms (macOS arm64, warm disk) |
| Index three notes, search | exact, typo (`kubernets` finds Kubernetes, `routng` finds Routing in React), filter (`tags = k8s`) and no-match all right |
| Hard kill with 1,500 notes queued, start again on the same folder | the new process is healthy and indexes and finds a note: the Electron plan's W8 test, passed here |

Found on the way: creating an index that exists is an **asynchronous task that fails**, not an HTTP error, so the code looks first (as `searchIndex.ts` does with `getIndex`).

**Windows, unverified:** `JobObject` (P/Invoke: `CreateJobObjectW`, `SetInformationJobObject` with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, `AssignProcessToJobObject`) puts the child in a job
that Windows kills when the host process ends for any reason, which would remove the orphan problem the Electron plan spends a risk row on (`reapOrphan` cannot work there: no `ps`).
`CreateNoWindow` stands in for `windowsHide`. Two real `meilisearch` processes with parent PID 1, about eight days old, from `composition-rss-smoke-*` runs, are alive on this Mac (not touched), a small piece
of evidence that orphaning happens. The test to run on Windows is in S5's list: kill the host, find no `meilisearch.exe`.
**Also unverified:** an Arm64 build of the app running Meilisearch's x64 binary under emulation (there is no Windows Arm64 Meilisearch); the Windows `meilisearch.exe` itself starting from a .NET host.
