# Interrupted 200-candidate source allocation — 7 November 2026

The supervisor terminated this run after 119.241 seconds when child RSS reached 492,797,952 bytes, above its 469,762,048-byte child ceiling (512 MiB host reservation). The source trace records 57 actual GETs, including 53 solver requests. The callback trace reached cursor 53, with 52 accepted callbacks and one processed candidate without a callback. All 57 requests received HTTP 200 headers; no retry, transport failure or source substitution was recorded.

The supervisor then removed disposable scratch before the interrupted runner exported its primary collector checkpoint. Full accepted records, fresh definition/tree projections and solver captures from this allocation were lost. Callback IDs and hashes are insufficient to reconstruct those bindings and receive zero capacity credit. Retained admitted source capacity remains 29 from the earlier durable evidence. This run is incomplete and does not establish F61 acceptance.

The original execution marker is permanently spent. `spent-request-index-after.json` includes all 85 solver requests spent across the first 32 and this interrupted 53, including rejected/unretained requests. `unspent-candidates.json` identifies the remaining 147 exact requests for a separately pinned future allocation; it does not authorise replaying this allocation.

`receipt.json`, `resource-receipt.json`, `outcome-index.json`, source events and callbacks preserve the bounded surviving evidence and cleanup facts. All owned processes, scratch, dependency links and reservations are absent. The primary checkpoint for future runs must live in retained evidence from the outset and survive interrupted child or supervisor cleanup.
