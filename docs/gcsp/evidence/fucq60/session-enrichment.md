# FUCQ-60 real shared-session consumer checkpoint

6 November 2026. This scoped checkpoint adds `enrichFleet` to the existing pure enrichment module. The consumer takes the real collector's `session` and unchanged `accepted` records. It calls only `withCheckpoint`, `execute`, `commit`, `stop` and `checkDeadline`; the FUCQ-59 implementation continues to own source operations, cache, counters, retry allowances, deadlines, writer leases and atomic persistence. No producer code is copied or replaced.

Declare the offline catalogue operation and optional retained-image-manifest operation, together with their finite request budgets, when constructing the collector. Keep `imageRequests: 0`. After `collector.run()`, pass its session and accepted records to `enrichFleet`. The image operation reads retained registered metadata through FUCQ-42; this checkpoint performs no image download or outbound request. Omitting the image operation leaves imagery explicitly unavailable while facts can remain partial.

The consumer binds its versioned stage to all accepted source records, operation names, view/dimensions, provider options, retention decision and assessment date. It compares supplied accepted records with the actual collector checkpoint and checks their complete FUCQ-39 lookup identities. Image request additions are restricted to view/dimensions. A changed stage input cannot reuse previous enrichment outcomes. The original run identity, absolute deadline and lifetime ledger remain unchanged when entering another stage or reopening the collector.

Each committed outcome advances one persisted cursor. An interruption after a cached source response reuses that response; an interruption after the outcome commit does not repeat the outcome. If an image operation exhausts its bounded execution, valid catalogue facts are committed as a partial record with an explicit image execution reason before the stage stops. Catalogue failure leaves the configuration pending. Every record remains `partial` or `rejected`; `processing: finished` describes the stage cursor only. Reports retain `status: incomplete`, `qualification: offline-session-not-source-qualified`, corpus integration unknowns, per-source identity/fidelity and the shared counters.

## Actual producer proof

The portable `session-reuse-proof.mjs` harness requires an explicit absolute producer module and exact producer/session hashes. Missing modules and hash changes fail; it has no skip or stub fallback. It imports the real FUCQ-59 collector, which creates the real persisted session, and invokes the real FUCQ-60 consumer with the existing FUCQ-39/FUCQ-42 offline adapters and canonical file-backed PolicyService. It records actual module paths and boundary hashes at runtime. No absolute worktree dependency is committed in the harness.

The selected producer was FUCQ-59 commit `fdb71c2a34b3501ed0549424947ec67c1145f433`:

- `collect-fleet.mjs`: `1656b49e2423ab95ebe3e3987c6988f7099f3fe5f590c888dcf324c9e31ee019`
- `collection-session.mjs`: `aed978263f9c904c9c5f75daf9d1ff254bdd02ec177d5cd04421c5e8cfa70881`

Run the harness with a deliberately selected producer, substituting its absolute module path:

```sh
node --experimental-test-coverage docs/gcsp/evidence/fucq60/session-reuse-proof.mjs \
  --producer /absolute/path/to/scripts/gcsp/collect-fleet.mjs \
  --producer-sha256 1656b49e2423ab95ebe3e3987c6988f7099f3fe5f590c888dcf324c9e31ee019 \
  --session-sha256 aed978263f9c904c9c5f75daf9d1ff254bdd02ec177d5cd04421c5e8cfa70881
```

Six integration regressions passed: collect→enrich→reopened resume with one underlying catalogue call; persistent absolute deadline; lifetime request/retry limits across interrupted writes and new stages; immutable accepted/stage inputs; valid facts retained on image stop; and no repeated work after an outcome commit. Catalogue/image adapter calls are offline fixture observations. They do not establish live source coverage, new configurations or representative asset coverage. Aggregate enrichment coverage in this proof was 96.15% lines, 85.13% branches and 97.37% functions; no per-test coverage contexts are claimed.

The serial pure/FUCQ-39/FUCQ-42 command was rechecked on the consumer source and passed 50/50. Strict targeted evidence key: `6644471626fddcaa47039c81f53186bb0ab5d3646548659ef3d6d36849bab3e4`. The automatic JavaScript selector cannot establish the foreign producer boundary, so its exact module selection and hashes are recorded separately in the proof receipt. No full suite or full stamp is claimed.

Run evidence remains in the launcher's `lead60` receipt directory, with `session-summary.json`, the pinned proof identity, targeted receipt, impact map and filesystem cleanup evidence. This checkpoint used 128 MiB scratch, 384 MiB sampled RAM and a 300-second outer bound, with one sequential test process. Its final proof peaked at 37,088 scratch bytes and 164,233,216 sampled RSS bytes. The scoped contract worker removed 667,744 scratch bytes. The authorised temporary dependency symlink resolved the installed `pg` package for importing PolicyService; the file-backed provider was used, no SQL connection occurred, and the owned symlink was removed and verified absent. The first proof attempt exposed that missing package before reaching its assertions; the final real proof passed with the declared overlay. No large-output placement or compatibility exception was needed.

Canonical producer assembly in the integrated branch remains required. Real catalogue coverage, representative retained image fidelity/coverage, FUCQ-54 corpus/presentation integration and the authored final `npm test` gate also remain open. The pure and actual offline integration proofs cannot close those gates. FUCQ-60 remains in progress/blocked for full delivery.
