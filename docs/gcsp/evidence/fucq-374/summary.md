# FUCQ-374 page load, before and after

Local offline memory host, desktop Chrome 1280x900, 100 ms added round trip, 20 Mbit/s. Median of 3 runs each, cold (cache cleared) then warm (same browser). Wall is navigation to network idle, less the 500 ms idle window. Before: gcsp-poc fc872861. After: dev/DEV-2026-11-10-GC-045. No page errors in any run. Account and Greg pages now need a signed-in user and were not timed.

| Page | Before (ms) | After (ms) | FCP before | FCP after |
|---|---|---|---|---|
| cold-login | 1080 | 223 | 976 | 252 |
| cold-offer | 2264 | 1771 | 1832 | 1336 |
| cold-outbox | 1193 | 666 | 872 | 340 |
| cold-presenter | 924 | 806 | 784 | 664 |
| warm-login | 976 | 129 | 868 | 132 |
| warm-offer | 2223 | 562 | 1788 | 132 |
| warm-outbox | 1189 | 454 | 860 | 128 |
| warm-presenter | 968 | 232 | 856 | 128 |
