# Ordinary `.9` Git/runtime handling assessment

Recommendation: after the current exact `.9` live proof finishes, commit the eight ordinary data paths below as one coherent checkpoint. Preserve every existing version and the actual ordinary publication-owner file. This follows the `.8` and `.7` treatment; it does not require another source gathering or publication run. No root changes are made by this assessment.

Observed root HEAD: `12657190b786d47b344bcb5e131901652df9c5e8`. Root Git contains 47 ordinary-store files. Actual storage has 52 files and ten versions: three tracked control files changed and five new `.9` version files remain untracked. HEAD still selects `.8`; actual `active.json` selects `.9` with `.8` as previous. `last-good.json` advances to `.8`. Durable inventory changes from 1,924 configurations / nine datasets / one identity to 2,425 configurations / ten datasets / the same one identity. The exact successful ordinary activation receipt is `567fbc0fed031db8ce9c4c1bd43502001637aa4e09e4c29c0f1247dff6c0b1a4`. Its acceptance remains false because the existing 485 consumer failures remain. Native proof is unrun.

Existing Git treatment is explicit: commit `f76498aa` (ordinary `.8`) and `6feb8f2a` (ordinary `.7`) each committed these three control files and all five files of the new version directory, retaining older directories. `.gitignore` contains no fleet-source rule. Its separate raw-feed and national-stock cache exclusions do not describe this retained ordinary corpus. The registered sources and code-owned release descriptor are separately versioned; this recommendation does not re-create them.

`render.gcsp.yaml`, rather than retail `render.yaml`, pins `.9` and calls the artifact CLI during build against the checkout ordinary-store path. `restoreFleetRelease()` downloads and verifies code-approved artifacts, then publishes additively into an existing store; a missing store takes its cold-restore branch. Runtime `createLocalVehicleEvidenceLookup()` only loads the already published store and has no restore/network path. Current Linux CI independently cold-restores a fresh scratch store, repeats offline, then runs its scoped proof. Therefore CI/Render restore can advance `.8` checkout data, but does not change what a clean Git checkout initially contains or independently establish live success. These are code-path observations, not new build/deployment evidence.

The coherent commit should include exactly:

| Repository-relative path | Bytes | SHA256 |
| --- | ---: | --- |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/active.json` | 374 | `337266f829e1878280898a94968051e465c9462c89dc91eaac9e5e43d39ab814` |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/identity-inventory.json` | 1,367,256 | `f7fdf7460388e6012b81e3a3abd1879dc4bbae61e333b86d5afdbc93aa01e439` |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/last-good.json` | 198 | `6a3c3fcecb1f6ef4e06d3685c6e0e0c52285057043f4538a7f5f4d8514e1bf45` |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/versions/28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884/configurations.jsonl` | 45,277,494 | `355b05a93af83b60f6801470fff5dbe082f3c3ec662a45a1f2c17e7cf90496ea` |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/versions/28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884/images.jsonl` | 1,410 | `eb04f0dca3046b045dd000ef4312eabc3d4b9af59b141cb0bd0e26a32230588a` |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/versions/28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884/manifest.json` | 8,254 | `28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884` |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/versions/28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884/publication-owner.json` | 81 | `eaa6a5bf69285d6f38a86e8388098e1cdaad1cd3fc501335d5dec9d93847e862` |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1/versions/28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884/vins.jsonl` | 2,565 | `8e9c7d5f34d4843aeb9de5b7a707c53c339c9a1f64e5675fe04e73e2417cbccd` |

Keep the live proof stable first. The API build filter includes `server/**` and automatic deployment is triggered by commits; a later data commit may create a new Render deployment. Preserve the current exact deployment/code receipt, identify any later deployment separately, and use the existing proportional validation evidence for unchanged bytes. A Git data commit is not a second corpus publication and does not establish original Story acceptance.

Do not commit pointers/inventory alone while omitting their selected version. Do not delete `.9`, restore controls to `.8`, normalize publication owners to the isolated store, or add an ad hoc ignore rule to hide the state. Those actions would discard the observed operational baseline or leave clean-checkout lookup inconsistent. An artifact-only/local-store migration would be a separate design/scope decision; it is unnecessary for this demo checkpoint. The `.10` prepared plan already pins the actual root `.9` tree read-only; retaining these bytes preserves that baseline.

The `.9` public format intentionally contains current and previous corpus files plus complete durable identity/configuration/dataset inventory; older local version directories remain part of Git/local history. The two actual ordinary publication-owner labels differ from isolated `.8`/`.9` labels and are already recorded separately in the `.10` plan. Retain the ordinary `.9` owner file exactly, consistent with prior commits; it is publication evidence, not a credential or replacement source authority.

`docs/gcsp/build-rules.md` calls for coherent validated increments and explicit retention of failed/unrun checks. It provides no exception requiring this data to be omitted from Git. This assessment changes no acceptance criteria, creates no new feature scope and does not block the ongoing demo/live work.

Verification was bounded read-only inspection of Git status/history, pointers/inventory counts, already pinned ordinary bytes, ignore rules and restoration source paths. No source call, proof, publication, browser, credential access or root write occurred. No scratch was created; removed scratch allocation is zero and there are no owned leftovers. Exact observation pins and command-scope facts are in `evidence.json`.
