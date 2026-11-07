# Scenario results (local)

| Measure | lean | postgres | convex |
|---|---|---|---|
| Push ack, typical / p95 (ms) | 10 / 21 | 15.9 / 31.9 | 17.2 / 47.3 |
| Propagation to device B, typical / p95 (ms) | 15.9 / 27.8 | 19 / 32.6 | 20.9 / 50.6 |
| Burst of 500: last edit to B converged (ms); edits per push | 6; 1 | 6; 1.1 | 20; 1.5 |
| Burst push ack p95 (ms) | 7.9 | 12.7 | 34.8 |
| First push after idle / warm median (ms) | 15 / 7.6 | 18 / 12.2 | 23 / 15.4 |
| 10 MB first sync: upload (ms) / empty-device pull (ms) | 437 / 233 | 580 / 544 | 3680 / 3023 |
| Concurrent pushes: duplicate or out-of-place versions | 0 / 0 | 0 / 0 | 0 / 0 |
| Concurrent pushes: 5xx retries / given up / p95 / max (ms) | 0 / 0 / 10.3 / 14.5 | 0 / 0 / 52.6 / 105 | 6 / 0 / 142.6 / 1496.3 |
| Faults: texts lost / replica divergences | 0 / 0 | 0 / 0 | 0 / 0 |
| Kill the API: longest sync pause (ms); edits lost | 15726; 0 | 12534; 0 | –; – |
| Kill the database: longest sync pause (ms); edits lost | –; – | 11495; 0 | –; – |
| Restore: command (ms); records the restored server lacked; lost for good | 2082; 0; 0 | 495; 70; 0 | 4240; 70; 0 |
| Restore: devices noticed the new epoch / healed (ms) | 102 / 117 | 101 / 112 | 100 / 378 |
| Restore right after a write (lean's replication lag): records lacked / lost for good | 70 / 0 | – / – | – / – |
| Restore: epoch rotated by hand? | no (automatic) | yes (extra step) | yes (extra step) |

Restore rows: lean restores the latest replica, so what it lacks is replication lag; Postgres and Convex are restored to a backup point taken before the last 70 writes, on purpose, so "lacked" is 70 by construction there and the row tests the healing, not durability.

Checks: normal lean=pass postgres=pass convex=pass; burst lean=pass postgres=pass convex=pass; library lean=pass postgres=pass convex=pass; concurrent lean=pass postgres=pass convex=pass; faults lean=pass postgres=pass convex=pass; idle lean=pass postgres=pass convex=pass; outage-api lean=pass postgres=pass convex=pass; outage-database lean=– postgres=pass convex=–; restore lean=pass postgres=pass convex=pass; restore-immediate lean=pass postgres=– convex=–

Runs from 2026-11-07T04:53:38.236Z to 2026-11-07T04:59:23.535Z. Raw files sit beside this one.
