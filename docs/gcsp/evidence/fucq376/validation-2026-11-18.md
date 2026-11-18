# FUCQ-376 scoped validation — 18 November 2026

Implementation `b1e17419ef368e924a5687677385ae7f6861ebcd`, branch `dev/DEV-2026-11-11-GC-001`, base `d0557060a6638d7ba05454c1f615553111445d64`. Original three Bug criteria have scoped proof and independent review. Parent integration, green covering batch and acceptance remain outstanding.

## Repair and scope

The default server's registered-source, JSONL-buffer, validation and summary loops performed long synchronous record passes. Existing awaits could resolve as microtasks without giving timers or HTTP requests a turn. The repair adds a per-load monotonic 8 ms checkpoint which awaits `setImmediate` between existing atomic records. The private summary is async and both callers await it. The render harness again uses the real default lookup.

Changed production: `server/gcsp/vehicle-evidence/{load-checkpoint,registered-catalogue-sources,indexed-jsonl,corpus-publisher}.js`. Changed tests: `server/test/dom-harness.js` and `server/test/gcsp-vehicle-evidence-readiness.test.js`. The file-backed corpus remains authority; the lookup is a read-only derived view. No new store/cache, source anchors, validation semantics, output/readiness shape, corpus bytes, UI markup or styling changed. FUCQ-302/FUCQ-305 and Java/Angular/provider behavior are outside the original contract.

## Original criteria

| Criterion | Retained evidence |
| --- | --- |
| Fresh default loading stays within about 100 ms per piece on a 5 ms timer | Baseline ready 6204 ms, total 6228 ms, maximum gap **2661 ms**. New automated regression fails on unchanged production at **2659 ms**, passes after repair. Separate corrected quiet probe: ready **6182 ms**, total **6206 ms**, maximum gap **36 ms**, 778 timer samples and 204 readiness polls. |
| Readiness and results unchanged | Ready manifest before/after `28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884`. Five real-corpus resolve/classify/readiness samples (first/middle/last configurations, sole VIN and unknown configuration) byte-identical, SHA-256 `f456b5576ec9d2348cf19f58dc1e3b1074835770bb16d6d8dd0264065b2cc92a`. Preservation/refusal tests cover integrity, policy and publication boundaries. |
| Original render with real lookup | Removed ced02a8e harness stub; original render **41/41 pass, zero skips**. Module V8 contexts show actual source/index/validation/summary/checkpoint execution. |

The new automated regression starts its timer before fresh default `buildServer()`, observes loading/503, exercises ordinary `/health` HTTP while loading, then requires ready/200 and a maximum timer gap of 100 ms. A single record remains atomic. Measurements support the retained default-corpus contract in this environment; they are not a hard real-time guarantee for arbitrary future records or host scheduling.

## Selected validation

Node **26.7.0**, npm **11.19.0**, existing `pg` **8.23.1**. One test worker, serial commands, `NODE_OPTIONS=--experimental-vm-modules`; `NODE_V8_COVERAGE` captured module/worker contexts during these required runs.

```sh
node --test --test-concurrency=1 \
 server/test/gcsp-indexed-jsonl.test.js \
 server/test/gcsp-registered-catalogue-sources.test.js \
 server/test/gcsp-corpus-indexed.test.js \
 server/test/gcsp-vin-registry.test.js \
 server/test/gcsp-local-corpus-policy.test.js \
 server/test/gcsp-vehicle-evidence-lookup.test.js \
 server/test/gcsp-vehicle-evidence-readiness.test.js \
 server/test/gcsp-vin-publication.test.js \
 server/test/gcsp-technical-supplement.test.js

node --test --test-concurrency=1 server/test/render.test.js
```

First run **70/70**, supervisor 134.859 s; second **41/41**, supervisor 29.479 s. **111/111**, zero failures/cancellations/skips. Syntax and `git diff --check` passed. Final six source/test SHA-256 identities were checked again before implementation commit and match both receipts and independent review. No source/test change followed validation. Full suite deferred to the parent covering batch.

Selection follows the four changed loader modules, lookup/readiness and writer/publication callers, plus the original real-lookup render regression. Existing unchanged corpus input identity: `e00248268edfb4a92a7fd7f990230ddd3bf17a06acc27186f101bf3f96a5ef4b`, 256,269,028 B referenced in place and not copied. Impact map records file/function ownership, fixture/config/subprocess edges, observed module contexts and timings. Unattributed subprocess contexts remain unattributed; missing observations do not establish irrelevance.

## Independent review and retained evidence

Mater's source/security and scoped original-criterion review **passed with no actionable findings**, including both awaited summary callers and exact source/test receipt pins. Sulley and Mater requested/selected/runtime-confirmed `gpt-6.1-sol/high`, IBM Global, no fallback. Existing parent roster retains confirmation; no fresh saved-title verification is claimed. No new UI surface requires visual critique; the original render regression covers the unchanged composition and product output.

Primary local retained paths (all beneath `/Users/usget/Claude/vehicle-matcher`):

- `.claude/poller/run-20261117-2335/f376-independent-review.md`
- `.claude/poller/run-20261117-2335/resources/f376/`: plan, baseline/red/green probes and receipts, five-sample lookup JSONs, scoped/render logs and ownership receipts, coverage-context summaries, impact summary and final cleanup receipt.
- `.claude/test-runs/impact/f376-c8459b9899dbd52f.json`: 56,793 B, identity `c8459b9899dbd52f6d4972c1e835357860e8c6e9582cf6f38487ade02b7f6d60`.

## Resources and cleanup

One worker; bounded local scratch, registered supervisor finalizers, HostBudget reservation and exclusive runtime lane. Planned chunk ceilings: 2 GiB scratch, 1.5 GiB RSS, 600 s; 5 GiB emergency reserve. No database, copied corpus or cloud output. Initial dependency preflight failed before corpus execution because the worktree lacked `pg`; an owned link to the existing primary `server/node_modules` supplied the unchanged dependency. No install or product dependency change.

Consolidated receipt observed **2026-11-18T02:05:52.498569+00:00**: all nine recorded process identities dead; owned `/private/tmp/vm-poller-20261118-f376`, reservation and lane absent; dependency link removed, installed dependency tree preserved. Measured finalizer removal **13,017,728 B**; maximum scratch **8,868,384 B**; maximum Node child-group RSS **545,685,504 B**. **No cleanup issues or leftovers.** Bounded local Node/V8 temporary working data was the declared compatibility exception. No OneDrive access, including cleanup checks. Retained summaries/logs are small and local; no successful verbose output tree or input copy is retained.
