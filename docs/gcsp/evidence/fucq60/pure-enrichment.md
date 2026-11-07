# FUCQ-60 pure enrichment checkpoint

6 November 2026. This is an independent, scoped implementation checkpoint. FUCQ-60 remains blocked on its real integration and source/asset evidence gates.

`scripts/gcsp/enrich-fleet.mjs` exports synchronous `enrichConfiguration` and `reportEnrichment`. It consumes trusted results from the existing FUCQ-39 catalogue and FUCQ-42 image ports; it performs no source, filesystem, session, provider or network operations. Its caller supplies the accepted configuration ID, complete resolved catalogue request, source envelopes, explicit retention decision and assessment date. It preserves that ID without creating a VIN, stock car or new identity authority. FUCQ-54 integration must validate the canonical ID binding before publication.

The transform canonicalises and compares the requested and resolved vehicle and provider lookup identities before applying facts. Model/AG/range, market/locale, all dates, complete factory selections and accessory quantities remain part of the source context. Unknown measurements retain null values, meanings, units and reasons; no unknown becomes zero. Catalogue definitions, configurable equipment, selected equipment and unknown physical fitting remain separate. Paint and upholstery selections retain their catalogue provenance. Inconsistent selected-equipment lists become unknown.

Image projection uses the existing registered image presenter, exact source identities, paint and view/size checks. It excludes generic substitutions and opaque URLs. Missing, unsupported, broken, expired or retention-denied images leave valid facts usable as partial. Model and paint fidelity remain verified only as declared by the adapter; body, wheels, interior, equipment and exact vehicle appearance retain unknowns. Image hashes can share a content entry while each configuration keeps its own source and appearance reference. Conflicting byte/type/dimension metadata for one hash is rejected. Grouping fixtures prove this transformation, not new observed configurations or representative coverage.

Every record remains `partial` or `rejected`, with `scope: pure-enrichment`. Shared accounting and corpus integration are explicitly unvalidated. The output contains no stock availability, scheme points, eligibility or connected-use projection. It adds no screen or UI component; presentation truth, unknowns and fidelity are verified through contracts under the experience-quality requirement and canonical HLD page 06.

## Validation

The scoped command passed 50/50 tests, including 9 authored enrichment regressions and the existing catalogue/image suites:

```sh
node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-fleet-enrichment.test.js server/test/bmw-catalogue-adapter.test.js server/test/bmw-image-adapter.test.js
```

The strict targeted selector used that explicit command because automatic JavaScript impact selection is unavailable. The enrichment module measured 97.71% line, 91.21% branch and 100% function coverage. Coverage is aggregate; no per-test coverage contexts are claimed. Reviewed boundaries include snapshot fixture loading, registered asset integrity and source presentation. A malformed-envelope label test prevents image URL leakage through a paint label.

The initial regression failed because the module was absent. Review found and fixed an incorrect upholstery expectation (`FKSFU` is the retained source selection); the final focused run passed. No full suite, live source request, image download, SQL call, key retrieval or dependency overlay ran.

Persistent run evidence is under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-resume-20261106/lead60/`: plans, resource ownership manifests, targeted receipts and concise summary. The nested targeted worker removed 1,728,672 bytes of scratch and sampled 62,701,568 bytes maximum RSS; its scratch path is verified absent. The outer supervisor also removed its scratch. No large output, compatibility exception or leftover allocation is required. The test runner's inner estimate was 600 seconds; the enclosing supervisor imposed the authorised 300-second limit. Final tests used one test worker.

The first combined three-file boundary command omitted the explicit Node concurrency flag and could run three file workers; the final serial command corrected this. All chunks stayed within the 384 MiB sampled RAM bound; the maximum sampled RSS was 126,189,568 bytes. All owned scratch roots are verified absent, with 3,748,224 bytes of sampled scratch peaks removed across the run. Successful verbose logs were replaced by concise summaries; bounded useful initial failure logs remain.

## Remaining delivery gates

- Integrate the exact published FUCQ-59 persisted session. The agreed `withCheckpoint` stage metadata/data must share the same lifetime request/cache/budget/retry ledger across collect, enrich and resume. No executor is copied or stubbed into this checkpoint.
- Qualify real catalogue coverage and representative retained image assets by model/body/paint/view, dimensions and fidelity. The existing public UK source/retention authority remains valid; it does not establish measured coverage. Image request budget in this lane is zero.
- Validate actual FUCQ-54 corpus/publication and consuming presentation contracts, including canonical ID binding. Pure fixtures do not prove them.
- Run the authored final `npm test` integration gate under the dispatcher's serial grant. No full stamp is claimed.

Scooby Doo, they/them, thread `01a1b05f-dcbc-7e50-a2f9-0332b39f082a`; title saved and verified. Requested/selected model `gpt-6.1-sol`, effort `high`, no fallback or descendants. The session's `turn_context` independently records that model/effort pair. Gateway preflight passed IBM Global.
