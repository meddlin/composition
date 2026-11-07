# Results

`local/` is everything on one laptop: it measures what the software adds and none of the network, host or provider.
`real/` is the three deployed hosts (empty until the real run). `SUMMARY.md` beside the raw JSON is made by
`node scripts/summarize.ts local|real` from the newest file per scenario.

`typing-before-fix-*.json` (lean and Postgres only) is the hotspot typing scenario run against the **first engine and
server** (commit `f80fd80`, in a scratch copy with only the scenario files added), kept as the "before" for the three fixes
described in the design doc. The `typing-*.json` files without that prefix are the same seeded session on the current code.
