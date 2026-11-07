# Scenario results (local)

| Measure | lean | postgres | convex |
|---|---|---|---|
| Push ack, typical / p95 (ms) | 11.7 / 74.8 | 19.5 / 26.3 | 24 / 28 |
| Propagation to device B, typical / p95 (ms) | 16.8 / 88.6 | 23.5 / 31 | 27.2 / 33.5 |
| Hotspot typing, 90 s: iPad requests / KB up / KB down | 9 / 109.3 / 2 | 9 / 109.3 / 2 | 9 / 109.3 / 2 |
| Hotspot typing: last autosave to the other device holding it, p50 / max (ms) | 2474.9 / 2547.9 | 2520.9 / 2682.8 | 2477.2 / 2572.4 |
| Burst of 500: last edit to B converged (ms); edits per push | 6; 1 | 5; 1 | 11; 1 |
| Burst push ack p95 (ms) | 5.3 | 6.6 | 11.5 |
| First push after idle / warm median (ms) | 22 / 6.1 | 29 / 11.6 | 71 / 15.2 |
| 10 MB first sync: upload (ms) / empty-device pull (ms) | 424 / 334 | 553 / 273 | 3546 / 1911 |
| Concurrent pushes: duplicate or out-of-place versions | 0 / 0 | 0 / 0 | 0 / 0 |
| Concurrent pushes: 5xx retries / given up / p95 / max (ms) | 0 / 0 / 29.5 / 57.1 | 0 / 0 / 32.7 / 48 | 1 / 0 / 130.4 / 1227.7 |
| Faults: texts lost / replica divergences | 0 / 0 | 0 / 0 | 0 / 0 |
| Kill the API: longest sync pause (ms); edits lost | 15801; 0 | 11240; 0 | –; – |
| Kill the database: longest sync pause (ms); edits lost | –; – | 12467; 0 | –; – |
| Restore: command (ms); records the restored server lacked; lost for good | 1434; 0; 0 | 648; 70; 0 | 4276; 70; 0 |
| Restore: devices noticed the new epoch / healed (ms) | 100 / 110 | 101 / 110 | 101 / 123 |
| Restore right after a write (lean's replication lag): records lacked / lost for good | 70 / 0 | – / – | – / – |
| Restore: epoch rotated by hand? | no (automatic) | yes (extra step) | yes (extra step) |

Restore rows: lean restores the latest replica, so what it lacks is replication lag; Postgres and Convex are restored to a backup point taken before the last 70 writes, on purpose, so "lacked" is 70 by construction there and the row tests the healing, not durability.

Checks: normal lean=pass postgres=pass convex=pass; burst lean=pass postgres=pass convex=pass; library lean=pass postgres=pass convex=pass; concurrent lean=pass postgres=pass convex=pass; faults lean=pass postgres=pass convex=pass; typing lean=pass postgres=pass convex=pass; idle lean=pass postgres=pass convex=pass; outage-api lean=pass postgres=pass convex=pass; outage-database lean=– postgres=pass convex=–; restore lean=pass postgres=pass convex=pass; restore-immediate lean=pass postgres=– convex=–

Runs from 2026-11-07T05:49:23.825Z to 2026-11-07T06:00:03.848Z. Raw files sit beside this one.
