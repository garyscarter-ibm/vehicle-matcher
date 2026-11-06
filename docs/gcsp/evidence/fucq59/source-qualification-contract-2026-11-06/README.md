# Pure BMW field-evidence contract — checkpoint 1

6 November 2026. The parent approved only checkpoint 1 of the [qualification plan](../source-qualification-plan-2026-11-06/README.md). The new internal module and its focused tests implement that checkpoint. The collector, common session, public-source descriptors, F39 adapter/snapshots, F60 consumer and F77 plan remain unchanged. No source allocation or checkpoint 2 implementation follows from this result.

`qualifyBmwSourceFields({target, artifacts, claims, requiredFields})` accepts bounded retained JSON bytes and a reviewed source manifest. Each artifact declares its expected SHA-256, observation-date locator, exact context locators and response/request roots. Claims name a supported field and its exact JSON pointer. The pure function performs no I/O and returns `qualified`, `missing` or `conflict` for each requested field, with actual values, artifact hashes, pointers, dates, context and confidence. Every report remains `field-evidence-only` with `admission: false`.

The manifest is an explicit caller-owned source contract. Its response/request roots and context bindings require review against the actual source shape; a matching hash establishes byte identity, not real-world truth. This is an inspection primitive, not an automatic BMW source certifier. Its future caller must preserve the original request, source capture and full resolved selection through the existing owning ports.

## Boundaries enforced

- Hash-check actual bytes before parsing; reject malformed UTF-8/JSON and duplicate object keys, including escaped duplicate names. Limit artifacts to 32, each at most 1 MiB and 2 MiB total; check size before making a byte copy. Bound claims, roots and pointers.
- Read exact RFC 6901 own-property locators. Never search descendants, follow inherited properties or borrow a nearby field. Require an actual observation date and exact model/AG/order/effect context; a filename or matching canonical ID does not supply them.
- Request roots take precedence over response roots. A query or mandatory trim input cannot corroborate its own source role. Typed field names prevent an effect-date locator from becoming catalogue-production evidence.
- Validate calendar dates, codes and bounded labels. Preserve catalogue production separately from physical production, model year, plant and fitted equipment; those physical/VIN fields remain unsupported and null. Preserve the literal steering code without interpreting RL.
- Require explicit code-keyed paint/fabric definitions. Accessory quantity must be an actual positive integer on the selected accessory and bind the complete factory-code set and accessory-code set. Another paint, source date or same canonical ID cannot transplant quantity.
- Conflicting direct values refuse qualification. F39 catalogue date must equal the actual observation date; order and resolved effect dates stay separate.

## Scoped evidence

The selected command was:

```sh
node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-bmw-source-qualification.test.js
```

All **20 tests pass**, with zero failures/skips/cancellations/todos. Native coverage of the new module is 100% lines, 93.14% branches and 100% functions. The runner reports 98.46 ms in Node and 0.251 seconds supervised wall time. This validates only the pure module and its reviewed dependencies. The JavaScript affected selector has no configured plug-in and falls back to a full suite; that fallback was reviewed and not admitted. No full suite or unrelated boundary test was run.

The tests consume the exact retained 1 November F39 snapshot and 6 November safe observation bytes. Historical production/tax/trim fields qualify only for their original observation date. Current production, independent trim role and accessory quantity remain missing. A projection without an embedded observation date stays unqualified even when its filename says 5 November; no F58 evidence was copied or relabelled. F58's richer projection/date association is an integration obligation for its owning source contract.

The initial baseline failed because the new module did not exist. Subsequent field-meaning/context and duplicate-key regressions failed with behavioral assertions before implementation fixes. Their bounded failure logs remain in the external receipts. The exact final code/test/input hashes, selected command and result are in [result.json](result.json).

No source requests, browser/image/SQL/credential calls, descendants, snapshots, accepted public rows, VINs or runtime activation were created. All 74 F77 model/engine mappings remain pending, with eight configurations per mapped entry, at least 200 overall and at least 20 real exact deep links still required. The four-request diagnostic remains proposed and unallocated.

## Resource and handoff receipt

One worker per chunk; 64 MiB scratch, 384 MiB RAM, 120 seconds and 1 MiB log cap. The supervisor established external ownership manifests before creating each scratch root, propagated TMPDIR/TMP/TEMP, joined owned process groups and removed scratch. Independent checks confirm all nine owned roots and groups absent. No scratch files were allocated; empty owned directories were removed. No dependency overlay, bytecode, compatibility exception or large output was created.

Sampled peak RSS across short runs was 2,408,448 bytes; subsecond Node processes can finish between samples, so this is not asserted as the actual peak. HostBudget plus parent actual-job accounting was used; continuous global-ledger charging remains unverified. Successful verbose logs totalling 10,535 bytes were removed after retaining hashes and concise results. Useful bounded failure logs remain. No leftovers.

External receipts and cleanup proof: `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-resume-20261106/lead59/source-qualification-contract/`. Shared code/test-identity impact map: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/f59-source-qualification-a47ab896572a12a2.json`. The map records reviewed file/function ownership, dependency and fixture edges, native combined-file coverage and per-test timings; native Node coverage does not expose individual per-test function contexts, and none are claimed.

The source-qualification and publication slices remain blocked. Next work needs dispatcher review and allocation for checkpoint 2; shared F39 registration retains its separate ownership gate. Cecil Turtle requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants. No screen or topology changed, so no rendered visual evidence is applicable.

## F4 review correction

Sam Sheepdog's independent code review found that the original mutation assertion compared source data already serialized before the call; that object was never supplied to the verifier. The corrected test snapshots the actual supplied target, artifacts, claims, required fields and Buffer bytes, successfully qualifies tax date, then compares those same supplied objects and the original Buffer reference/content. Size and missing-artifact checks are separate. The production module remains frozen at SHA-256 `eda2660125ff589a968d861d02f86122ef71df30354351cfe4eee76f43d355e8`.

The same focused command now passes **21/21**, zero failures/skips, with 100% line/93.14% branch/100% function coverage of the unchanged module. This supersedes the test-file identity of the original 20-case evidence above; it does not promote source acceptance. [mutation-review.json](mutation-review.json) records the exact identities, review finding and scoped receipt. Independent re-review is pending.

The one owned correction-run root and process group are independently absent; zero scratch files or overlays were created. Its bounded successful log was removed after retaining its hash, timings and concise result. No leftovers or new traffic; checkpoint 2 and the GET allocation remain zero. External correction receipts are under `lead59/source-qualification-contract/mutation-review/`; the identity-keyed impact-map path is in the result. Production/source/F39/F60 contracts and all existing acceptance boundaries stay frozen.
