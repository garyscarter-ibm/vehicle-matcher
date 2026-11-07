# Historical F44 request — 5 November 2026

The [actual observation](observation.json) stopped on **HTTP 400** from the historical F44 model-tree request at **23:45:06 UTC on 5 November 2026**. It yielded no catalogue models or returned dates. The cause is unknown: this result cannot distinguish historical support, date/flag constraints or another request constraint. It proves neither global F44 unavailability nor discontinued production, and provides no substitute generation or constructibility evidence. The earlier [dated F44 HTTP 200 empty result](../scheme-catalogue-2026-11-05/README.md) remains a separate unchanged observation.

The [plan](plan.json) selected order/effect request dates **1 October 2024**, anchored to the retained [eligibility matrix](../../../sources/choices-eligibility-matrices-2024-10.md), which explicitly names F44 and orders from that date. No retained source proved historical F44 catalogue order/effect dates. Both dates are request probes; the eligibility effective date remains distinct from a catalogue date, returned model effect date, production era or model year. `future-models=false` and `closest-fallback=false` prohibit silently substituting another generation.

Exactly three serial read-only GETs consumed the selected budget, with zero retries:

| Request | HTTP | Decoded body bytes consumed | Client time |
|---|---|---|---|
| Public page | 200 | 17,763 | 216 ms |
| Discovered public settings | 200 | 620,646 | 56 ms |
| Exact F44 historical model tree | 400 | 0; failed body not read or retained | 108 ms |

Total consumed decoded bodies: **638,409 bytes**, **397 ms** client wall time. The failure body's wire size is unknown and is not included as downloaded content. Pre-execution limits were three attempts, one worker, 10 seconds per complete request, 45 seconds total, 1 MiB per bootstrap response, 2 MiB tree, 4 MiB aggregate and zero cache entries. No solver, OTD, manifest, image, browser, login, garage/save/order or other write occurred. The public application header and successful raw bodies remained memory-only and were discarded. New configurations, VINs and profile activations are zero; the historical distinct configuration total remains **three**.

Gary's existing public-source/pilot/retention/display authority and the dispatcher's selected continuation apply. The three-request plan is consumed: this checkpoint executes no retry, date sweep or flag change. The [exclusive execution marker](execution.json) refuses a repeated run. Further calls require a separately selected finite plan and resource admission. No renewed human source approval is outstanding.

The [preflight](preflight.json), execution and observation pin the plan, client, helper, tests and five input identities. Those executed bytes remain unchanged. Scoped validation recorded **16/16** tests, zero failures/skips, 10,231.879334 ms, including the exact historical URL/flags, substituted-generation refusal, separate returned model effect date, private-field exclusion, finite request/byte/wall boundaries and an actual ten-second stalled-body timeout. Node native coverage measured the helper at 100% lines, 80.51% branches and 96% functions; per-test contexts are unavailable. Synthetic transport fixtures count only as test input. Matching completed evidence is reused without rerunning the tests or source calls.

The [offline validator](validate.py) checks the actual HTTP failure, zero observations, request accounting, safe retained fields and pinned identities; [validation.json](validation.json) records the scoped result. No full suite or screenshot applies because this evidence-only change has no runtime, profile, registry, UI or database consumer. Unchanged prior catalogue/known-seed/profile evidence is reused at its pinned identity. Recheck from the checkout root:

```sh
python3 -B docs/gcsp/evidence/fucq-58/historical-f44-2026-11-05/validate.py
```

Resource summaries and independent cleanup audit are retained under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-restart-20261105/lead58/historical-f44-resources/`. Each chunk has an external ownership manifest, HostBudget admission, propagated temporary paths and a process-group finalizer. Successful verbose logs are removed; a bounded safe HTTP 400 summary remains. No browser/profile compatibility exception, archive, large output or OneDrive allocation was required. Foreground apps/tabs/focus remain undisturbed.

FUCQ-58 remains blocked on compatible GB/RHD profile evidence, exact dated constructibility across all scheme models and five-WMI multiple-build coverage. The shared map's `scheme-catalogue` slice remains in progress; final qualification/integration remains blocked. This result adds no profile activation, corpus collection or FUCQ-61 work before 13 November.
