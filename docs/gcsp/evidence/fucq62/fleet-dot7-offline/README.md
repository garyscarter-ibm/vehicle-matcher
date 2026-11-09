# Offline .7 preparation — 7 November 2026

Prepared through the existing F54 writer, registry, release descriptor and raw-asset pack route. Public release/upload, public GET, ordinary activation, Render and CI/YAML changes have not run. Root review and an exact release grant remain required for the public boundary. Whole Story acceptance is not established.

| Pin | Value |
| --- | --- |
| Manifest / release ID | `86ec3769dd55631007974869264f6d8a25671d9cf041f715e107b1435c297f4f` |
| Descriptor SHA-256 | `0ae8f96be792f83c7b43a6f8408e62f12ba39cf1039a0c0ab885f3a3cfbcacf2` |
| New registered source SHA-256 | `fd8d384e60b2058e27ee0b95c089cb7f7183bfd2d511761e39e566a6fc8cde9c` |
| Pack | 22 assets, 11 source shards, 63,361,942 bytes |
| Catalogue | 1,134 configurations; 1,133 admitted sources; 1 retained VIN; 2 representative image associations |
| Prior .6 manifest | `421ccd4ec6377e7e97d61f9017d76643ddbeaa76c2ebd5e4cf7f1d88d48a039d` |

`plan.json` freezes all 264 original accepted line hashes and their primary/proof inputs. The final canonical index has 1,136 entries, 1,133 admitted sources and 1,846 spent; two historical nonadmitted observations are explicitly excluded. All 870 prior configuration lines, VIN bytes, the old image line, and complete durable identity/version/history mappings are retained. The new image is an additive representative association, with exact vehicle/model/paint/wheel/interior/equipment fidelity unknown. The four technical facts remain retained enrichment output; immutable catalogue unknowns are unchanged.

Scoped proof: candidate validation, isolated publish/idempotent repeat/cold restart, and all 22 packed asset hashes passed. The retained audit checked all 1,135 lookup DTOs and configured consumers plus the supported deterministic 1,024 HTTP sample. Diagnosis established exact retained lookup parity for 1,135/1,135; configured consumers pass 1,133/1,135. The actual 1F7A and 1F7C source references contain documented empty `mandatory-elements=` values that the configured consumer rejects. This Medium defect remains independently deferred; see `consumer-bug-draft.md`. The failed all-record consumer gate remains visible and has no acceptance waiver.

`audit-summary2-results.json` summarizes the retained failed report and diagnostic proof with their hashes and matching production/input identities. `http-complement2-results.json` checks the exact remaining 111 HTTP requests: 1,024 + 111 gives 1,135 unique actual request IDs, zero overlap, exact DTO/manifest parity and zero source/provider egress. Production CLI `--sample-size 1135` is unsupported and must not be used. The existing 1,024 cap is a separate named Medium limitation; the operational complement changes no production API.

`audit.mjs` intentionally preserves the original strict gate and will fail while the configured-consumer defect remains. The operational summarizer preserves `invalid-active` and separates lookup, consumer and HTTP outcomes. `failed-attempts.json` preserves the failed candidate image-order assertion, failed consumer audit, and complement harness VIN-indexing failure. The candidate assertion was corrected by comparing image IDs in stable order; the complement was corrected to include actual VIN metadata. Two preallocation harness failures consumed no allocation. Successful summaries are scoped; no full npm suite was run. Existing unchanged engine 69+11 tests and .6/.5 transport/missing-cache/stale-cache/interruption recovery evidence are reused.

The retained candidate, isolated store, descriptor and raw pack are under:
`/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/fleet-dot7-offline-20261107`.

Every phase runs through `supervise.py` with a manifest outside scratch, one worker, 512 MiB host/448 MiB combined child RSS, 64 MiB local scratch and a 120-second bound. Outputs go directly to OneDrive. The first recovery attempt exceeded combined RSS by 5,931,008 bytes and was stopped; its owned cloud working set was removed. Recovery was replanned to finish CLI subprocesses before parent registry loads. Phase receipts provide measured allocation, process join, scratch/link/reservation absence and unchanged root ordinary .6 tree hashes. No compatibility exception is used.

Agents: Mike Wazowski, requested/selected `gpt-6.1-sol` / `medium`; no fallback or descendants. Root owns final release review and integration.

Recovery passed in 20.26 seconds at 354,516,992 bytes sampled aggregate RSS. Actual 22-asset offline CLI cold restore, idempotent CLI restart, fresh registry load and both image associations passed. Corrupt new 264-source and cached image assets were rejected; corrupted current source/image selection recovered .6 with 869 sources and one image. Current pointer and full history bytes stayed unchanged, and exact owned bytes were restored. Cleanup removed 102,103,040 bytes of cloud scratch plus 8,192 bytes local scratch. Retained output is 152,157,595 logical / 152,682,208 allocated bytes; no leftovers. See `recovery2-results.json`.
