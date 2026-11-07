# Convex: what the docs say, and what the spike saw

Resolved **before** writing the Convex implementation, as spike S8 asks (backups, export, regions, production terms,
serializability). Docs read 2026-11-06. "Seen" lines are from running the spike's functions, not from a doc.

## The five questions

| Question | Answer | Source | Status |
|---|---|---|---|
| **Backups** | Manual: "Backup Now" in the dashboard, kept 7 days, downloadable. **Periodic (daily 7 days / weekly 14 days) needs the Pro plan.** Free and Starter store **at most two backups per deployment**. Restore is destructive (wipes existing data), can restore from another deployment on the same team, and the docs advise taking a fresh backup first. | [Backups](https://docs.convex.dev/database/backup-restore) | Read. Not exercised in the dashboard (the spike drives export/import by CLI). |
| **Export** | `npx convex export --path file.zip` (optionally `--include-file-storage`): one `documents.jsonl` per table. `npx convex import --replace-all -y file.zip` puts it back. These work with a deploy key, so a restore drill is scriptable. | [CLI](https://docs.convex.dev/cli) and `convex import --help` | Read, and **run locally** (export then `--replace-all` import, restore drill passes). Not yet run against a cloud deployment. |
| **Regions** | `aws-us-east-1` (standard price), `aws-eu-west-1`, `aws-ap-southeast-2`, `aws-ca-central-1` (the last three carry a 30% regional surcharge on paid plans; a Convex blog post says EU is available on all plans including free). **A deployment's region cannot be changed**: move by export and import. Chosen in the dashboard or `convex deployment create --region`. | [Regions](https://docs.convex.dev/production/regions) | Read. The two sources disagree on whether EU is surcharged on Starter. |
| **Production terms** | The pricing FAQ and limits page say nothing that forbids production use on Starter. Starter is pay-as-you-go ("metered charges may apply" past the included amounts); Free "may return HTTP errors" if it stays over a limit. The FAQ states: "we'll never delete a record that was written to your tables in a mutation that returned successfully." Professional is the plan the docs associate with "production features" and periodic backups. **No SLA or support terms were found, and the Terms of Service text did not load** (the fetch returned only the page title and navigation). | [Pricing FAQ](https://www.convex.dev/pricing/faq), [Limits](https://docs.convex.dev/production/state/limits) | **Unresolved.** Read the ToS and Service Level Terms before relying on Starter for paying users. |
| **Are mutations serializable?** | **Yes.** The docs say Convex "provides true serializability", using optimistic concurrency control: a transaction commits only if every record in its read set is still the latest version, otherwise it is re-run automatically ("several retries if necessary"; no exact limit is documented). The page speaks of transactions generally and does not say "mutations" by name, but a mutation is a transaction. | [Optimistic concurrency control](https://docs.convex.dev/database/advanced/occ) | Read, **and seen**: four and eight devices pushing for one user at once produced exactly `1..head` with no duplicates (see below). |

## Limits that bite this design

From [Limits](https://docs.convex.dev/production/state/limits). Free and Starter run the **S16** deployment class; Professional runs S256.

| Limit | Value | Why it matters here |
|---|---|---|
| Document size | 1 MiB | Records are capped at 512 KiB in the protocol. |
| Data written per transaction | 16 MiB; 16,000 documents | A 100-record push of 2 MiB is far inside it. |
| Query/mutation time | 1 second (your code only) | A full 100-record push ran well inside it locally. |
| **Mutation write throughput** | **4 MiB on S16, 8 MiB on S256** (the page does not say the window; the error says "per second") | **A first sync of a 10 MB library is at the cap**: it can only go in about 2.5 s at best, and a bigger library or a restore import can be refused. Seen locally, below. |
| Concurrent mutations | 16 on S16 (256 on S256) | Fine for one user's devices; a hot counter row serializes them anyway. |
| HTTP actions | no request-size limit stated, 100 MiB response, 64 MiB memory | The spike enforces its own 4 MiB body cap. |
| Storage on Free/Starter | 0.5 GB database, 1 GB bandwidth, 1M function calls a month included | At ~3,000 calls per user a month, 100 users is about 0.3M calls. |

## What the spike saw (local backend; the cloud numbers are in `results/real/`)

- **The contract suite passes unchanged**: 30 of 30 on the local anonymous backend. Version assignment is inside one mutation (`sync:push`).
- **A hot counter row is a hot document.** Every push reads and writes the user's `userSeq` row, so concurrent pushes conflict and Convex re-runs them. With eight devices pushing at once, a handful of pushes exhausted the retries and came back as an error: *"Documents read from or written to the "userSeq" table changed while this mutation was being run and on every subsequent retry. Another call to this mutation changed the document…"*. The HTTP action turned it into a 503 and the client's retry (same `batchId`) succeeded every time, so no version was lost or repeated. Under the design's assumption (devices of one user edit at least 20 s apart) this does not happen; it is the price of the unhappy path.
- **No SSE.** An HTTP action cannot hold a stream open without a function call per tick, so the change hint is a live query (`sync:head`) over Convex's WebSocket, advertised in `/v1/info`. That puts the Convex client library in each app, which the design lists as an open concern. Polling `/v1/sync` works as a fallback.
- **Write throughput is real.** Importing a 22 MB export (a restore drill after the 10 MB library scenario) was followed by *"Too many writes per second. Your deployment is limited to 4 MiB bytes written per second."* on the next write. The rotate-epoch call had to retry.
- **Restore does not change the epoch.** `import --replace-all` restores the `meta` table too, so the old epoch comes back. A rotate-epoch step is needed after a Convex restore (and after a Neon restore); only the lean entrypoint does it by itself.
- **Mutation arguments carry bytes natively** (`v.bytes()`), so payloads are stored as bytes, not base64.

## What this does not cover

Convex Auth or Clerk integration (spike S4), file storage for blobs, scheduled jobs (the retry-record purge exists as `sync:purgeBatches` but is not scheduled), and the Convex Swift client's behaviour on iPad (the harness and scenarios use the JavaScript client).
