# F62 static artifact packaging — 7 November 2026

Prepared for independent review; no release asset has been uploaded or verified publicly and no Render setting has changed. This adds one explicit build-time download/restore path to the existing indexed JSONL publisher and registry. HLD pages 05/06 and `docs/design/gcsp-high-level-design.md` already specify versioned static deployment artifacts inside the Node backend. No topology, dependency, service, SQL or screen change is required. Experience evidence is exact presentation/source identity and failed-candidate recovery; no new screenshots apply.

The code-owned `server/gcsp/vehicle-evidence/fleet-releases.json` pins the actual `.4` release, its `.3` previous selection and 15 raw files totalling **20,689,730 bytes**. It includes current/previous manifests and JSONL, the active/last-good pointers, complete durable identity inventory and four exact admitted-source files. Source names are content-addressed and capped at 32 MiB each. Source applicability is pinned per manifest so corrupting the new-only source does not poison the previous version. Raw assets need no archive or extraction code.

Every downloaded file must match its exact declared length and SHA-256. Only the pinned public repository release URL and bounded GitHub CDN redirects are permitted; compressed bodies, partial/oversize data, arbitrary hosts and more than three redirects fail. Transfers write exclusive owned temporary files. A complete cache is rehashed before validation; missing offline cache fails without fetching. Fresh stores receive an entirely validated staged directory. Existing stores use the unchanged registry publisher, retaining their existing history and selection on rejection. Runtime lookup only reads local files and restores trusted source registrations; it has no download method. Missing new cache preserves the existing Git-bundled source route.

Limits are selected by server-owned code using the checksum of the actual manifest bytes. HTTP inputs and manifest fields cannot widen them. The default and this actual release remain **64 MiB per JSONL, 1 MiB per row, 100,000 rows**. A later code-reviewed selected release may opt into at most 256 MiB per JSONL; each descriptor permits at most 256 files and 2 GiB aggregate. This is a bounded mechanism, not a measured 10,000-source acceptance claim.

## Operator commands after reviewed integration

Use explicit absolute paths. For the current release:

```sh
fleet_release=8af582cf0dc60488daa6a6bf105d0eb80bcda98d77958960f98abd5e2e15c3e9
node server/scripts/fleet-artifacts.mjs pack --release "$fleet_release" \
  --store "$PWD/server/data/gcsp/vehicle-evidence/fleet-source.v1" \
  --output /absolute/owned/package-parent
```

The output parent must already exist; the release child must be absent. The package keeps descriptor `asset.path` beneath that child. **Publish each file using its descriptor `asset.name` as the remote asset filename**, which differs from the nested local basename. A `gh release upload file#label` label does not rename the remote asset. Use an upload API accepting the filename or an owned flat naming stage; preserve the exact bytes and clean that stage. Prepared tag: `fleet-2026-11-07-4` in `garyscarter-ibm/vehicle-matcher`. Operator upload/public GET verification and release policy are separate parent work. Do not replace already published bytes under this descriptor.

Proposed Render build addition, executed with `rootDir: server`, after normal dependency installation:

```sh
fleet_release=8af582cf0dc60488daa6a6bf105d0eb80bcda98d77958960f98abd5e2e15c3e9
node scripts/fleet-artifacts.mjs restore --release "$fleet_release" \
  --store "$PWD/data/gcsp/vehicle-evidence/fleet-source.v1" \
  --cache "$PWD/data/gcsp/vehicle-evidence/fleet-artifacts.v1" --network download
```

No command has been added to Render automatically. After a complete cache exists, the same command with `--network offline` revalidates and restores without transport. Runtime starts normally with the existing offline guard. Keep the source cache available next to the store; it is the source qualification input, not disposable after build. `GCSP_VEHICLE_EVIDENCE_ROOT` retains its existing custom-store override; the code default source cache is under the server data root.

For this package, existing `.3` → `.4` publication preserves the full durable history because the target already contains the preceding history and the current version contains every retained configuration/VIN. Cold restore preserves exact incoming inventory bytes. The existing-store path does not import arbitrary inventory associations absent from both its retained history and the selected incoming corpus. A future descriptor with removed historical records requires explicit review of that condition; this patch does not change publisher history semantics. The descriptor retains the immediate previous corpus only, with full durable identity inventory; it does not carry every historic version directory.

## Scoped evidence and cleanup

`packaging-results/` retains results, selections and cleanup receipts. `packaging-actual-proof.mjs` is the actual input proof; `supervise-packaging.py` records the single-worker bounded harness and exact external result locations. The initial red run failed because the module did not yet exist. Five initial unit cases then passed. Final scoped regression: **36 passed, zero failed/skipped**, covering the new transfer/descriptor/manifest-limit tests and existing source qualification, indexed corpus, registry, publication and lookup tests. It took 8.620 seconds, peaked at 262,799,360 RSS bytes and removed 663,680 scratch bytes.

Final actual proof took **10.540 seconds**, peaked at **283,656,192 RSS bytes** and removed **67,628,608 scratch bytes**, below the selected 96 MiB scratch/512 MiB host/448 MiB child/90-second bounds. It packed/restored the actual **349 source configurations /350 total /1 VIN /0 images**, preserved exact active/inventory bytes, proved idempotent reuse, rejected corrupt source/missing cache/partial transfer without replacing the store, and recovered the previous selection with the new-only source corrupted. Fifteen injected local download responses exercised successful transfer/count reporting without public network access. A fresh registry then passed **351 direct and 351 local HTTP checks, zero errors and zero outbound calls**. The original source store stayed unchanged.

Every owned scratch root, group, reservation and temporary dependency link is confirmed absent in cleanup receipts. No compatibility exception or leftover allocation; no archive, source copy or verbose successful output tree is retained. Existing installed dependencies and source trees were preserved. Evidence and the impact map `.claude/test-runs/impact/fucq62-static-artifact-packaging.json` are small retained artifacts. Tests ran on installed Node 26.7.0; Node 20 execution, public release downloads, Render cold build/deploy and the unrelated full suite remain unrun. No full Story acceptance or Done transition is claimed.
