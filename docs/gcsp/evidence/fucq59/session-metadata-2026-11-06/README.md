# Executor observation metadata — checkpoint 2b, 6 November 2026

The existing collection session now gives an HTTP projector an optional third argument: `project(value, request, metadata)`. The executor owns this immutable metadata. Existing projectors and returned consumer payloads keep their existing behaviour. No source version, route, capability, acceptance path or field classifier is activated by this change.

The parent allocated only `scripts/gcsp/collection-session.mjs`, its owning collector/session test file and F59 evidence/result/map changes at base `78bc652019cb114825baeb863aee7cf855a7983d`. The [projection contract](../source-qualification-plan-2026-11-06/projection-contract.md) and its JSON, original plan, public source, collector, configuration key, qualifier, F39/F54/F60, dependencies and fixtures remain unchanged. HLD06 topology and screen behaviour are unchanged; visual reference is not applicable. Requested/selected agent: Cecil Turtle, `gpt-6.1-sol` / `high`, no fallback or descendants.

## Handoff semantics

| Field | Executor binding |
|---|---|
| `schemaVersion` | `collection-http-observation.v1`; an internal callback contract, not a source response format |
| `operation`, `sourceId`, `sourceVersion`, `capability` | Initial session operation/source binding, captured separately from mutable descriptor/checkpoint objects |
| `transportKind` | The initial session's `fixture` or `live` transport kind; fixture metadata does not become a real observation |
| `request.method`, `request.url` | Snapshot of the already-validated permitted GET actually passed to transport; URL serialised by `URL.href`; no request headers or logical caller assertions included |
| `observedAt` | Session-owned clock, ISO UTC timestamp after successful complete-body reading and parsing; a source observation time rather than a source publication, order or effect date |
| `responseBytes` | Count of the concatenated decoded HTTP body bytes consumed by the executor |
| `responseSha256` | SHA-256 of those exact bytes before UTF-8 decoding/JSON interpretation, including whitespace and original byte encoding; not the semantic JSON/cache digest or compressed wire bytes |

Metadata and its request object are frozen before the callback. Endpoint validation, response content type and metadata use the same privately captured capability. Later mutation of the object returned by `prepare` or of the descriptor cannot rewrite that handoff. Public application header values stay in the existing transport closure; raw bodies and headers are absent from metadata.

Only a completed, valid operation reaches projection. The existing malformed-JSON, returned-status, HTTP-status, byte, deadline and timeout stops continue to preserve consumed accounting and cancel/join work. An incomplete body never supplies a projector with an observation. Offline projectors receive `undefined` as the third argument and retain their previous values.

The cache still stores only the projector's bounded safe payload and its existing integrity digest. A projector may explicitly retain safe metadata in that payload; cache hits return that original payload without another projector call, request or new observation time. Existing projectors ignore the optional argument, so their outputs and existing cache/resume format remain unchanged. Session version remains `2`; an old cached payload without this optional metadata is not retroactively supplied with provenance.

## Scoped validation

The affected-test dry run reported no configured language plug-in and proposed `npm test`. That fallback was inspected and **not admitted**. The explicit owning file covers the changed executor, its unchanged collection/enrichment callers and HTTP fixture integration:

```sh
node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-fleet-collector.test.js
```

The final run passed **35/35**, with zero failures, skips, cancellations or todo, 5.639 seconds native test time / 5.790 seconds supervised child time. Session coverage in that same run was 100% lines, 97.36% branches and 92.45% functions. Native combined-file coverage does not provide individual test-to-function contexts; the impact record combines reviewed ownership with observed coverage and per-test timings. Unobserved branches/functions remain unknown; no extra suite was run to populate the map.

Four new synthetic cases cover exact multi-chunk UTF-8 byte hashing, source/request/time identity and immutability despite caller assertions/mutation; malformed JSON and returned failure status with durable stops; original fixture provenance/time across interruption/cache resume; and unchanged offline callbacks. The existing timeout case additionally proves no projector call before incomplete-body cancellation. All 31 prior owning-file cases still pass, including finite attempts/bytes, persisted deadline, durable stops, SIGKILL/resume, no default traffic, source-fixture outputs and closure-only settings.

The initial red run failed two real assertions because metadata was absent. A later red capability-mutation case exposed mutable descriptor content-type selection; capturing the initial binding fixed it. The final identities, selected command, red evidence, timing, impact path and cleanup receipt are in [result.json](result.json). Successful verbose logs were removed after their hashes/totals/timings were retained; bounded expected-red logs remain outside scratch.

## Remaining evidence and cleanup

This is metadata plumbing only. A digest of discarded response bytes cannot reconstruct their fields or prove a raw localisation schema. The raw-to-safe field manifest, strict richer 5/I projection, actual options response bindings, current production/trim-role/accessory quantity and F39 registration remain separate work. Metadata alone qualifies no field and admits no row. No helper, second executor, capture adapter, caller-defined envelope or raw compatibility claim was added.

The unchanged qualifier's 21-case proof remains prior scoped evidence at its original code/test identity. F60's nine-case result remains valid only at its immutable old producer pins; this new session identity needs later matching consumer integration evidence. Prior full-suite evidence is also historical to its recorded identity. No full suite or F60 integration was run here.

Four serial bounded chunks used one worker, 64 MiB scratch/384 MiB RAM/120 seconds/1 MiB log per chunk. Each had an outside ownership manifest before its unique absolute root, supervisor finalizer, propagated TMPDIR/TMP/TEMP and joined process group. The already-authorised temporary `server/node_modules` link to DEV069's existing dependency directory had its own manifest and registered cleanup; it was removed and independently checked absent after every chunk. No dependency was installed.

All four owned roots/groups and the overlay are independently absent; sampled scratch peaks sum to 2,204,608 bytes across the serial chunks. Highest sampled group RSS was 358,318,080 bytes; sampling does not establish the actual peak, especially for subsecond jobs. No large output, browser-profile/SQLite compatibility exception, agent-created bytecode artifact or leftover remains. Concise summaries and bounded failure evidence remain under the external run directory named in the JSON. HostBudget was used and the parent was notified of each actual job; continuous shared-ledger accounting is not claimed while the locale anomaly remains unresolved.

Fresh public acceptance remains zero; F59 remains six complete slices and two blocked. All 74 F77 mappings and the existing breadth/deep-link gates remain outstanding. The four-GET proposal and F39 writer are still unallocated; source/HTTP/image/browser/SQL/credential/activation/VIN operations in checkpoint 2b are zero. FUCQ-61 remains held until 13 November 2026.
