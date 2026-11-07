# Immutable `.6` public boundary

This adapts the existing `.5` release and download runners to the frozen [offline `.6` package](../fleet-dot6-package/README.md). The immutable release target is `6f3c4578f1d5f3fb0a53ad0262ef66284618f071`, containing the identical standard descriptor. Tag: `fleet-2026-11-07-6`; manifest: `421ccd4ec6377e7e97d61f9017d76643ddbeaa76c2ebd5e4cf7f1d88d48a039d`.

The [plan](plan.json) declares one worker, 512 MiB host / 448 MiB child RAM, 120-second chunks and **192 MiB owned OneDrive scratch** for the public cache plus restored store. It preserves `.5` release and tag readback, forbids asset replacement and tag movement, and reuses unchanged `.5` proof and recovery tests.

The supervised read-only `--check` passed in 2.072 seconds at 136,249,344 bytes maximum sampled child RSS, with zero scratch bytes. It verified all 21 pinned assets / 44,787,324 bytes, the exact descriptor at the pushed target commit, the prior release/tag, and absence of the new release/tag. Owned groups, scratch, reservation and the temporary dependency link were absent afterwards. See [check-2-results.json](check-2-results.json).

An initial read-only check failed because `gh --jq .sha` returned bare text while the helper parsed JSON. The query now returns `{sha}`. Its bounded failed log, process result and successful cleanup are retained in [check-failed.json](check-failed.json); no public mutation occurred in either check.

Root reviewed these exact pins before the publish chunk. The runner requires a retained `root-release.json` with matching plan, runner, check receipt, target and release identity. The public output root is:

`/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/fleet-dot6-public-20261107`

| Prepared file | SHA256 |
| --- | --- |
| `plan.json` | `889e5dafec0e5f37482ca55adfc7db79226ac8943371bcf6e71aa5c66cee14c1` |
| `run.mjs` | `caf080576e25960159c888dd09468a811b53d97d7f2ae86066d5e9c5a44d90e0` |
| `supervise.py` | `8db5c1c00d12a57b8e3da5a4265e827aebd66f659fcd8fd5876d3b3fbf30baf9` |
| `check-2/check.json` under output root | `34fb1f30bffaf09b9f93225d4ad3e7aa9e6389ef813ec177c7bc58cd7790ee62` |

Root released those pins in [root-release.json](root-release.json). **Publication passed**: GitHub release `437293645` has all 21 exact assets, 44,787,324 bytes, and the immutable tag points to the declared target. Both the `.5` release readback and tag were unchanged. See [publish-results.json](publish-results.json); receipt SHA256 `d5eac213532b3b627a50806bc5eb555a9785a7f8b34f33e966218ad13f5edd0c`. The chunk took 34.894 seconds at 139,493,376 bytes maximum sampled child RSS, measured zero scratch bytes, and removed all owned scratch, groups, reservations and dependency links with no leftovers.

The authorised `python3 -I supervise.py publish` and `python3 -I supervise.py download` commands have each completed once. Their owned phase roots are spent and the supervisor rejects a repeat. Each phase writes useful receipts outside scratch and cleans its owned working set. No continuation was needed; a partial upload could resume only by a fresh `publish-N` chunk that validates all existing remote assets exactly and never overwrites them.

The download chunk uses the actual production restore CLI with anonymous approved-host instrumentation, verifies all public asset bytes and complete history, starts a fresh offline CLI, and runs all 871 direct plus 871 production HTTP checks. Its only new rollback case corrupts the `.6`-only source shard in owned downloaded scratch: `.5` must recover with 479 source configurations and its one image, while the selection and complete inventory bytes remain intact; exact bytes are restored afterwards. The required distinct count is 869 for this partial-corpus check. The 10,000/source/model/profile/year/plant/five-WMI acceptance obligations remain open. Ordinary activation, YAML, Render/live work and BMW/source traffic remain outside this run.

**Anonymous restore and offline verification passed.** All 21 public assets matched the descriptor after 42 anonymous HTTP requests (21 redirects and 21 HTTP 200 responses), with no authorization or cookie header. The production CLI cold-restored the exact inventory SHA256 `de151e509d55d674fe8fb094e77728a7c3e2665bb8f96ea28bc2df2ce9301f3f` (870 configuration associations, one identity, seven datasets). A fresh offline CLI restore was idempotent. All **871 direct and 871 HTTP cases** passed with zero errors, zero source/provider egress and the HTTP server closed. The changed source rollback recovered `.5` with 479 source configurations and one image, preserved pointer/inventory bytes, restored the exact source bytes and cold-loaded `.6` again.

The download chunk took 38.622 seconds, with 313,229,312 bytes maximum sampled process-group RSS. Its 71,133,152-byte peak OneDrive scratch allocation was removed. Owned groups, scratch, reservations and dependency links were absent afterwards; no compatibility exception or leftovers. The useful retained evidence is 24,113 bytes under the public output `download` directory. See [download-results.json](download-results.json), [download-receipt.json](download-receipt.json), [offline-restart-receipt.json](offline-restart-receipt.json), [changed-edge-receipt.json](changed-edge-receipt.json), [public-network-receipt.json](public-network-receipt.json) and [offline-network-receipt.json](offline-network-receipt.json). The final receipt SHA256 is `af2696a0a34e80638efc6a4bdacaf15e017b2317a65b70ee070bfa75d8756b89`. These are scoped public-package results; whole Story acceptance and root's ordinary/CI/live boundaries are separate.
