# Immutable .8 offline preparation — 7 November 2026

Prepared the 790 parent-audited F70 admissions through the existing candidate writer, qualified source binder, isolated registry publisher, release descriptor, raw-asset pack and offline restore APIs. No public/source/image/native-database traffic, ordinary activation, deployment or CI/YAML change ran. Whole Story acceptance remains unestablished.

| Pin | Value |
| --- | --- |
| Manifest / release | `9b514af9f883ce360fe7f42de16bd19d7a74f570e77cc9b6fb094f559aef9043` |
| Descriptor SHA-256 | `4bdd52141fc37fa85faca210da96789b8775f6a31c8b004abf4f80c7f58e7305` |
| New 790-line source SHA-256 | `4d5d0766342d817d06f3e60aed1ae87ba4446c4510cf00c18cb32798f56aeeda` |
| New source bytes | 16,411,688 |
| Pack | 23 assets; 12 source shards; 99,480,791 bytes |
| Catalogue | 1,924 configurations; 1,923 admitted sources; 1 VIN; 2 representative images |
| Previous .7 manifest | `86ec3769dd55631007974869264f6d8a25671d9cf041f715e107b1435c297f4f` |
| Planned immutable tag | `fleet-2026-11-07-8` |

`plan.json` pins all 790 original accepted lines and their checkpoint/proof files across the four pilots and 97 suffix sessions. The parent audit is pinned at `0ea5e936f9a8a497eff1207488ad6bbe2800f5da03305c01fe9e6843e1a0b16d`. The final canonical index has 1,926 entries and 2,636 spent requests; its two retained, nonadmitted historical observations are excluded from the candidate union.

All 1,134 prior configuration lines, VIN bytes, both image lines and all prior version files remain byte-identical. The isolated publisher preserves all 1,134 historical configuration mappings, one synthetic identity and eight datasets, adding only the new 790 configurations and one dataset. The two existing representative image associations remain unchanged; no image was added for .8. Exact image fidelity and the four immutable technical unknowns are unchanged.

The full direct audit compared all 1,925 DTOs with retained rows and the exact .8 manifest: **1,925 pass, zero DTO mismatches**. Configured consumers pass 1,456 and fail 469 (144 `1F7A`, 325 `1F7C`). Every failure has the same present-empty `mandatory-elements=` citation signature and `source-unavailable` consumer result; every corresponding direct DTO still matches. This is the existing specifically deferred Medium defect, with no AC waiver. The strict verifier therefore **fails with raw `invalid-active` and 469 errors**; `strict-audit-report.json` preserves it. The one existing [Bug draft](../fleet-dot7-offline/consumer-bug-draft.md) now records this impact; no verified native Jira key is available.

HTTP parity passed in exact chunks of 1,024 and 901 requests, each below the verifier's 1,024 sample limit. Their unique union is all 1,925 request keys, overlap zero, with exact DTO and manifest equality, zero HTTP errors, zero external/source calls and closed loopback servers. The independent direct diagnosis counts actual failures rather than assuming the earlier two-record impact.

Offline recovery passed five cases: actual 23-asset CLI cold restore, corrupted new-source rejection plus registry fallback to .7, corrupted cached image-association rejection, corrupted current-image registry fallback to .7, and fresh idempotent CLI/restart with both representative associations. Every case preserves exact selection and full history bytes; injected corruption is restored before teardown. Existing unchanged transport/interruption recovery evidence is reused.

One worker ran each scoped chunk. Maximum sampled aggregate RSS was 341,868,544 bytes, below the 640 MiB host and 576 MiB child ceilings. Bounded V8 collection ran only during the required strict audit (880,142 raw bytes, removed after the 78-context summary). The supervisors removed local scratch (14,905,440 bytes summed measured peaks) and 158,205,984 bytes of allocated disposable cloud recovery data. All eight owned roots, child groups, dependency links and reservations are absent; no compatibility exception or leftover remains. Inputs and code identities were unchanged within every chunk.

Retained output is directly under `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/fleet-dot8-1923-20261107`. `summary.json` pins all receipts, reports actual failed/unrun checks and links the exact selection/ownership evidence. The full diagnostic failure bodies stay in the pinned OneDrive receipt; Git holds a compact diagnostic summary. Raw proof wrappers retain several inherited labels/prose from the .7 route (`newImageAssociationAdditive`, `all1135`, `.6`); the frozen baseline pins, expected counts and measured receipts establish .7 → .8, 790 additions, 1,925 requests and no image addition. These labels are explicitly annotated in `summary.json`.

The 69+11 unchanged engine checks and prior recovery matrix are reused; no full suite was run. Historical failed Mac public proofs were preserved without rerun. .8 public publication/download/restore, Linux/Node20 build, ordinary activation and production probe remain unrun and require the parent’s separately reviewed grant.
