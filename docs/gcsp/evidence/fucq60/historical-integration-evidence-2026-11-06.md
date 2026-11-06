# FUCQ-60 retained historical integration evidence

6 November 2026. The bounded historical consumer and review F2 correction are implemented; nine scoped cases passed against the actual frozen F59 v2 session/key modules. This proves one retained **1 November 2026** configuration through historical admission, unchanged F60 enrichment, F54 candidate validation, an isolated actual registry and read-only lookup. Independent re-review, canonical branch assembly, wider source and representative asset evidence, and the authored final suite remain open. FUCQ-60 is not complete.

## Review F2 correction

Independent code review of initial checkpoint `cacbee6624abf335fe069a9bcdff6233b779dcce` found MAJOR F2: `readRetainedHistoricalInput` validated caller-owned pins synchronously but dereferenced them again after file I/O. Immediate mutation could substitute a compatible altered manifest's hash and obtain an internally registered historical input. The new regression reproduced this as `Missing expected rejection` before the fix. The reader now clones and validates the pin snapshot before its first await, then uses that detached snapshot for every file check, returned provenance and input digest. No producer, adapter, source artifact or schema changed.

The regression uses an owned synthetic manifest with altered generator metadata and the retained configuration bytes. Changing caller pins immediately after invocation cannot admit that manifest. A second immediate mutation during a valid retained read leaves all three original literal pins intact in both the returned input and the actual ingress receipt, with observed date **2026-11-01**. The full focused actual-producer file then passed **9/9, zero skips**. Initial eight-case evidence is historical and superseded for the changed source by the current identities below; independent re-review is still required.

## Delivered composition

`scripts/gcsp/historical-enrichment.mjs` exports `readRetainedHistoricalInput({directory, snapshotPath, pins})` and `createHistoricalEnrichmentRun({input, createCollectionSession, createConfigurationKey, producerIdentity, policyService, policyRead, statePath, limits, asOf, now, onPhase})`. The latter returns `{session, run, writeCandidate}`. It implements the composition reviewed in [the historical plan](historical-integration-plan-2026-11-06.md), with the final API shown here superseding that plan's proposed signatures.

The reader snapshots caller pins before its first await, bounds each file to 2 MiB, checks the reviewed manifest/JSONL/snapshot pins, selects the single `dated-snapshot` row and deeply freezes its input. An internal identity check refuses caller-created clones. The canonical F59 key helper reads the existing file-backed PolicyService; no key algorithm, policy defaults or executor is copied. Producer metadata, limits and policy-read arguments are cloned before the first await. Injected functions are a trusted same-process port: declarative metadata alone cannot attest their implementation. The proof hashes the actual producer modules before import and fails on missing or changed bytes.

The real session starts with empty accepted evidence and null receipt/catalogue. Its sole offline `catalogue` operation resolves the actual F39 adapter against the pinned snapshot. The full response must equal the retained original F39 envelope. `historical-ingress` commits the accepted record, historical receipt, catalogue and admitted flag together; reopened state must retain that exact admission. Its lease closes before unchanged `enrichFleet` uses the same accepted content, operation and request. The proof's catalogue budget of one succeeds through actual cache reuse, with no second ledger. The actual F60 report is durably committed in `historical-result`.

`writeCandidate` requires the supplied receipt/report to match both the committed result and actual enrichment-stage records. It preserves the original F54 configuration row and full F39 envelope, packages zero images and an empty VIN inventory through the existing publisher, then validates the candidate. Manifest source contexts contain only the retained dated GB source. A sibling `candidate.f60.json` joins the historical receipt and F60 report to the validated manifest digest. Exclusive staging, an atomic hard link and directory sync expose a complete immutable sidecar; interruption cleans its exact staging file, and an existing conflicting sidecar is preserved and refused. The module does not activate a registry. Only the proof publishes to its owned isolated store.

## Qualifications and preserved facts

These meanings remain separate:

| Boundary | Recorded meaning |
| --- | --- |
| Ingress receipt | `kind: retained-historical-source`, original 2026-11-01 provenance |
| F60 report | `status: incomplete`, `qualification: offline-session-not-source-qualified` |
| F54 manifest | Existing `bounded-fixture-or-partial-corpus` qualification |
| F54 lookup | `complete` means its documented supported catalogue subset; field and physical unknowns remain explicit |

The actual lookup retains observed/catalogue/retrieved **2026-11-01**, GB/en-GB, T5MJ/72HH, G61E/raw G61, S0337, all 47 factory codes and accessory `SE000001` quantity 1. Catalogue production identity **2027-01-05** does not fill physical production date. Physical production, steering and body length remain null; acceleration retains its unit, fitted equipment and images remain unknown, VIN and order UUID remain null, and no eligibility field is inferred. No source or image request, browser, SQL connection, credential operation or shared runtime activation occurred.

The separate **6 November 2026** public observation remains **accepted 0** and adds zero configurations. This retained sample is no new configuration and does not establish F77's required 200 distinct real configurations or scheme coverage. Imagery and broader source coverage remain open. No screen or HLD topology changed; this stays within the existing collector/validator/publisher, static corpus and read-only backend lookup.

## Scoped validation and identities

Selected command, with an explicit absolute real F59 producer root before integration:

```sh
F60_PRODUCER_ROOT=/absolute/selected/F59/root \
node --test --test-concurrency=1 --experimental-test-coverage \
server/test/gcsp-historical-enrichment.test.js
```

The portable test defaults to this repository's producer modules after assembly and fails rather than skipping or stubbing an unavailable/mismatched producer. Frozen F59 executable source is `aee5e902a20d82b880694064a10ad9842aaddd3a`; reviewed producer documentation is `f4c9697e5ee1eecf7cfbf288aae11e266c9f2c72`.

| File | SHA-256 |
| --- | --- |
| `scripts/gcsp/historical-enrichment.mjs` | `a6052d2da056f004465110c706f05d03b66ccf6e4000e7820f0b52715b286b8e` |
| `server/test/gcsp-historical-enrichment.test.js` | `c6ec793bdabab28913b80daa2a087f1e58db2890ee1a9c558270d374ce663308` |
| Unchanged `scripts/gcsp/enrich-fleet.mjs` | `f6bc477435cb3caada23ddc3113b59e35a39ad7593a1dfd648d491125ea7a900` |
| F59 `scripts/gcsp/collection-session.mjs` | `7495084c33c84538beb6ae3a04a292dbc0a800af6c9a10144de8e9728fc4b4b2` |
| F59 `scripts/gcsp/configuration-key.mjs` | `2527393ebb3c0221595200283293ec88c584a1a7178ed1060e2313c0e1998b60` |

Retained source pins and unchanged F39/F54 modules are recorded in the reviewed plan and the run's identity receipt. The final scoped run passed **9/9, zero skips**:

1. Actual historical admission/enrichment/candidate/sidecar/registry/lookup, no outbound transport, cache reuse and reopen.
2. Changed pins, frozen/forged inputs and caller metadata mutation during awaited policy read.
3. Immediate caller pin mutation cannot admit an altered compatible manifest or change retained input/receipt provenance.
4. Cached response before admission, empty accepted state and reopen without another underlying operation.
5. Committed admission reopen and rejection of changed date, accessory quantity or missing receipt.
6. Altered reports and immutable sidecar conflicts.
7. Actual F54 interrupted selection, reopen and idempotent publication.
8. Interrupted sidecar staging, absence of a final partial file and recovery.
9. Refusal to revert admission or replace the report independently of enrichment-stage records.

New module coverage is **100% lines, 92.50% branches and 95.24% functions**. This is aggregate V8 coverage; per-test contexts are unavailable. The reviewed function-to-test map supplements it. Automatic selection reported `language unspecified`; its failure and explicit selection plan were inspected before execution, without a full-suite fallback. The unchanged earlier six-case actual generic-session proof and 50-case pure/F39/F42 evidence were retained after source/test/adapter/fixture hash checks. This historical run's `F60_PRODUCER_ROOT` differs from those prior environments; their whole environment identities are not relabelled or reissued.

The F2 red run selected only the new mutation regression. The green run selected this one historical integration file because the changed reader supplies admission/provenance to the F39/F60/F54 composition; unrelated generic-session, pure/adapter and full suites were not rerun. Plans and function-to-test impact identities were recorded before each run. Source/test remain frozen after green.

Final strict targeted key: `39e70fd145497b7b64d2aea3f817819b0a336f77b7f36e14d19b93cd5125a726`.

Local receipts under `/Users/usget/Claude/vehicle-matcher/.claude/`:

- `test-runs/targeted-39e70fd145497b7b64d2aea3f817819b0a336f77b7f36e14d19b93cd5125a726-default-1793966100732321000.json`
- `test-runs/impact/fucq60-f2-3d3c06727ec9ff69.json`
- `dev-poller-resume-20261106/lead60/historical-f2-{red,green}-{plan,receipt,overlay}.json` and `historical-f2-summary.json`
- Initial implementation records remain historical: `dev-poller-resume-20261106/lead60/historical-summary.json`, initial targeted key `6ab73799546be03f2c8d2831e655109717964ae2b30d25675317cfbd2e2d746f`, and `dev-poller-resume-20261106/pass-1151/f60-{code,security}-review-round0.json`.

## Resource and handoff receipt

One worker used a 128 MiB scratch/384 MiB RAM/300-second outer bound and 1 MiB log cap. The nested planner's default 600-second estimate was subordinate to the enforced outer 300-second termination bound. The F2 red/green correction removed and independently verified absence of all **four** owned outer/nested roots and process groups, with **250,080 bytes** of sampled scratch peaks removed and maximum sampled test RSS **246,005,760 bytes**. The green nested proof took 3.192 seconds; its outer supervisor took 4.118 seconds with no scratch allocation. Initial historical implementation had already removed 18 roots and 1,852,224 sampled scratch bytes; combined historical totals are 22 roots and 2,102,304 sampled scratch bytes. Supervisors stopped and joined owned process groups. Successful logs were condensed and useful bounded failure logs retained.

The exact owned temporary `server/node_modules` symlink enabled `pg` import for the canonical file-backed PolicyService and was removed/verified absent after every run; no SQL connection or installation occurred. Prior exact task-owned bytecode cleanup remains recorded separately. There was no large output, compatibility exception or leftover. Source/test hashes were verified after the final run and remain frozen. This checkpoint changes only those source/test files plus this evidence, the owned DEV Result and FUCQ-60 map facts. It grants no merge, story closure, shared-store publication, live source/image activity or full-suite run.
