# Offline collector contract

The first FUCQ-59 lane executes only injected offline sources. No network provider is installed. Importing either module performs no collection. Default, dry-run, CI, lookup and demo-start modes report incomplete output with zero operations; `live` rejects with `live-source-unallocated`. Offline fixture completion always reports `offline-fixture-not-source-qualified`.

`createFleetCollector` takes an explicit versioned plan, injected `source: {kind: 'offline', version, discover, solve}`, a canonical `PolicyService`, an absolute owned checkpoint path and `mode: 'offline'`. The plan contains schema/plan/version/seed, source ID/version, all F39 market/locale/catalogue/order/effect/production/tax dates, model codes, target, candidate count and finite limits. `policyRead: {asOf, policyVersion}` is required in the plan and independent of those catalogue dates. An optional injected read may add the run ID but must agree with that policy pin.

Limits explicitly declare each operation's lifetime request budget, maximum candidates, attempts per exact source request, timeout, absolute run duration, retry delay, cache entries/retention, checkpoint bytes, concurrency one and image requests zero. Discovery supplies the real VG/AG/range/trim mapping, typed selectable definitions and complete base elements. Candidates are reproducible seeded subsets or explicit discovered-code requests. Only the injected solver can establish constructibility.

Accepted records preserve the complete typed resolved factory and accessory selection, configurator model range, exact F39 catalogue request/lookup identity, decoded canonical identity and solver-added/removed/ignored requests. The semantic ID includes upper-case VG model and sorted unique complete factory codes, then padded standard Base64. Dates, source/version/request differences and accessory-only variants never increase the distinct configuration count. No VIN is assigned.

The CLI accepts only absolute explicit paths:

```sh
node scripts/gcsp/collect-fleet.mjs --plan /owned/plan.json --offline /owned/fixture.json --checkpoint /owned/checkpoint.json
```

The bounded JSON fixture has `discovery` and `responses`, with responses keyed by the deterministic `candidateId` returned by `buildCandidateQueue`. Missing responses reject rather than fabricate a result. The CLI prints counts, coverage and checkpoint location; complete records remain in the private checkpoint. Under-target output remains `incomplete`.

`collector.session.withCheckpoint(callback, {stage: {id, version, inputDigest}, initialState})` is the downstream seam. The callback receives `{state, stageState, execute, commit, stop, checkDeadline}`. F60 must predeclare its offline operations in the collector's `operations` and plan budgets before collection begins, then call `execute` on this same session. This retains the actual run's source identities, ledger, retry allowance, cache and deadline. Each stage owns its version/input digest/data. Changing the run plan, source, tool, policy or limits rejects checkpoint compatibility; changing an existing stage's version/input rejects stage compatibility.

All operation callbacks must respect their AbortSignal; they supply offline data only. The session persists an attempt before calling the source, never retries projection/checkpoint failures as transport failures, and conservatively stops on 401/403/429. Writes use checksummed bounded envelopes, fsynced staging, atomic rename and directory sync. Unique writer markers prevent concurrent writers; recovery deletes only exact staging/marker paths recorded for a dead local participant. Unknown ownership is preserved for diagnosis. A run whose persisted absolute deadline has expired cannot gain another allowance by reopening the checkpoint.

This seam is tested with a synthetic facts operation; it does not claim F60 consumer integration, actual selected-source mapping, profile/constructibility qualification, 200 accepted configurations, imagery or the deferred 10,000 run. F58 owns source qualification, F77 plan selection, F60 enrichment and F78 stock/sampling.
