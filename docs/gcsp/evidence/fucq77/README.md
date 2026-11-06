# FUCQ-77 offline plan checkpoint

6 November 2026. This checkpoint adds an executable **offline plan contract**, not collected demo data.
The [proposed plan](../../../../server/data/gcsp/vehicle-evidence/demo-plan.json) remains pending.
All 74 model-and-engine entries need exact current UK source qualification; none is an exclusion.

The archived October 2024 transcription contains 66 rows per scheme, 132 total. The plan retains
every original row, line number, grade label/value and towbar marker. It splits only explicit commas
and slashes in the engine column, yielding 74 distinct model-and-engine entries with their original
row memberships. It does not infer engine prefixes, successor generations or M-car body variants.
The FS&UK X6 M60i row permits a towbar and the RR&Production row has no marker: both are preserved.
This is archived evidence for collection coverage; the runtime eligibility source remains PolicyService.

The two minima apply together: at least eight distinct configurations per mapped entry, and at
least 200 overall. If all 74 entries are mapped, the minimum is **592**, before any larger target.
An engine list such as `218i, 220i` cannot be covered with eight configurations of only one engine.

## Readiness and source evidence

`scripts/gcsp/demo-plan.mjs` exports `parseEligibilityMatrices`, `createDemoPlan`,
`validateDemoPlan` and `assertDemoPlanReady`. The validator compares retained rows and atomic
coverage against the complete archive and its SHA-256. Pending mappings are valid draft states
but block readiness and `assertDemoPlanReady`. Declaring `status: ready` cannot override blockers.

A mapping requires exact matrix model/engine, current UK configurator range, VG code, AG code
and a retained source locator/hash. Its observation date must match the explicit qualification
date; historical observations never become fresh checks. A supplied `verifyEvidence` adapter
must check the actual retained artifact bytes, locator and extracted claims. There is no permissive
default adapter. Merely entering evidence metadata in JSON cannot produce readiness.

An exclusion requires a reason and a verified exhaustive current UK range observation for that
exact model/engine. An empty or partial F44 response, absence from a selected projection, a changed
model generation, or a similarly named engine is insufficient. In particular, 330e cannot map
to evidence for 320i. Model year remains a separate source fact and cannot be inferred from an
effect date, order date or observed year.

The read-only FUCQ-58 sibling worktree retains a 5 November model tree for F70 and an empty F44
response; its selected F70 fields explicitly have unknown derivative, body, model year and
constructibility. The known-seed G61 refresh retains T5MJ/72HH, catalogue key G61E and payload
range G61 with the original source dates. These are candidates for a later exact qualification,
not current mappings or exclusions. The dispatcher's two current selected records and the three
1 November constructible observations are distinct measurements; this checkpoint accepts zero
demo configurations. Source/retention/display authorisation remains in force.

## Contracts and remaining delivery gates

The existing F39 dated catalogue adapter and F54 publisher/registry permit independent validation.
The corpus continues to use `server/gcsp/vehicle-evidence/corpus-publisher.js` and
`synthetic-registry.js`; this checkpoint introduces no alternative corpus format, collector,
cache, budget engine, policy registry or source client. F59/F60 plan-selection hooks belong to
their producers and require parent-coordinated pinned checkpoints before integration.

The full product-map plan retains these unfinished gates:

- Current exact mappings/exclusions and the accepted complete plan.
- F59 canonical collector and F60 real facts/COSY enrichment integration, preserving requested and
  resolved identities, all complete factory codes, accessory separation and changed-model rejection.
- At least eight real distinct builds per mapped entry and at least 200 overall, varying paint,
  upholstery, wheels and a pack. Dates/cache metadata cannot create distinct configurations.
- Every ID recomputed as padded standard Base64 of uppercase VG + `:` + sorted uppercase complete
  factory codes, including paint/upholstery and excluding dealer accessories; no duplicates.
- At least 20 real headless deep-link checks with exact resolved selection equality. Retained
  historical browser examples do not satisfy this sample. Page loads create anonymous garage
  records according to the retained research: the actual browser plan must address that boundary.
- F54 versioned `manifest.json`/`configurations.jsonl`, checksum/count consistency and lookup proof.
- The authored collector/verifier focused integration suite and parent-coordinated final `npm test`.

Every future live chunk needs an actual finite engineering plan within the 3,000-request ceiling
and concurrency at most two: include request/image/download byte limits, timeouts, retries/backoff,
elapsed time, checkpoint/resume and 401/403/429 handling. No renewed source permission is required.
There are zero source, credential, browser or image requests in this checkpoint. CI, demo startup
and runtime BMW calls remain prohibited. No consuming screen changes; presentation truth is
checked through facts' source/date/unit/unknown fields and representative-image fidelity.

## Scoped validation

```sh
node --test server/test/gcsp-demo-plan.test.js
node scripts/gcsp/demo-plan.mjs --config server/data/gcsp/vehicle-evidence/demo-plan.json
```

The second command performs an offline draft check and returns `valid: true`, `ready: false`.
It has no execution, key or transport capability. A future `collect-fleet --execute` must call
the readiness guard before creating a source session; that producer integration remains open.

The test selection excludes collector/enrichment/runtime/native SQL and full-suite acceptance.
The JavaScript affected selector is unavailable, so the explicit narrow regression is selected.
Persistent selection/ownership/checkpoint/cleanup receipts are in
`/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-resume-20261106/lead77/`;
shared impact evidence is under `.claude/test-runs/impact/`. One worker is limited to 128 MiB
scratch, 384 MiB sampled RAM and 300 seconds, with HostBudget reservation and finalizer cleanup.
The vendored resource API exposes `Scratch`/`run_process` rather than `RunResources`; it provides
the same owned root, external manifest, process-group join and verified-deletion lifecycle.
