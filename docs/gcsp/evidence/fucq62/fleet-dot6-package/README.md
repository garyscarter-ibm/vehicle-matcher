# Offline `.6` release package

Prepared the already validated, frozen 869-source candidate through the existing F54 `SyntheticRegistry` publisher and F62 `fleet-release.v1` / `packFleetRelease` APIs. The four later model-breadth pilot admissions remain separate. This checkpoint adds only the standard code-owned release descriptor and preparation evidence; the ordinary store, YAML and public release are unchanged.

The release tag is `fleet-2026-11-07-6`. Its manifest digest is `421ccd4ec6377e7e97d61f9017d76643ddbeaa76c2ebd5e4cf7f1d88d48a039d`; previous `.5` is `7f4396b8fcddf14eb0d7386a47cbc41f58e1385d8ee30a0bda95f292c016e431`.

The descriptor is [descriptor.json](descriptor.json), SHA256 `40300d27cd612e709887c0cf6f5c4cdb0c3c68133fa0b5ea428a37296cd01a4c`. It pins **21 nonempty assets, 44,787,324 bytes**: 25,671,263 corpus bytes and 19,116,061 bytes in ten registered source shards. All old descriptor entries are unchanged.

Durable outputs are directly under:

`/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/fleet-dot6-package-20261107`

| Output | Relative path |
| --- | --- |
| Complete isolated store, retaining every old version | `isolated-store` |
| Standard raw release assets | `pack/421ccd4ec6377e7e97d61f9017d76643ddbeaa76c2ebd5e4cf7f1d88d48a039d` |
| Descriptor | `descriptor.json` |
| Existing publisher, history and immutable-byte evidence | `publication-receipt.json` |
| Existing packer asset/hash evidence | `pack-receipt.json` |

The isolated current corpus has 870 configurations, 869 qualifying complete distinct source configurations, one VIN mapping and one representative image. Its inventory retains 870 configuration associations, one identity and seven dataset/version entries. Every previous configuration association (480), identity (one), dataset entry (six) and prior version file (29) is identical. Old 480-line preservation and candidate qualification reuse the unchanged [candidate evidence](../fleet-dot6-offline/results.json); candidate, VIN and image file hashes were rechecked rather than rebuilding the candidate or repeating the `.5` audit.

| Isolated asset | Bytes | SHA256 |
| --- | ---: | --- |
| `active.json` | 374 | `24f662947b4ca490ae3c3eedfcc72f2a83e1715d83823e1f9a9bd2ff89f5e3f3` |
| `last-good.json` | 198 | `e1dab16065050450bc8635702623f3e881c15c641a06933bf44bdb6a08471331` |
| `identity-inventory.json` | 504,129 | `de151e509d55d674fe8fb094e77728a7c3e2665bb8f96ea28bc2df2ce9301f3f` |

[describe-results.json](describe-results.json) and [pack-results.json](pack-results.json) retain the scoped selection, process result and cleanup evidence. Describe passed in 8.541 seconds at maximum sampled RSS 199,032,832 bytes; pack passed in 0.490 seconds at 102,645,760 bytes. Both used one child, a 448 MiB child / 512 MiB host RAM budget, 64 MiB scratch cap and 120-second cap. Both measured zero scratch bytes and zero external calls with the offline denial control passing. All owned groups were joined, scratch roots and reservations were absent, and the temporary inode-checked dependency link was removed. There is no compatibility exception or cleanup leftover. Retained output is 90,273,056 logical bytes / 90,590,464 allocated bytes on OneDrive; no upload completion is inferred.

[handoff.json](handoff.json) gives every packed asset's exact local path, size and hash, input pins, output receipt hashes and the existing API/CLI entry points for root's next boundary. These preparations are spent checkpoints: do not repeat them into the same owned roots. The wrapper deliberately rejects an existing phase/output. The full 871 direct plus 871 HTTP public-restore proof, public upload, immutable public checks, ordinary activation, Linux/live checks and YAML integration are assigned to root and were not run here. The package is a partial corpus; the 10,000/source/model/profile/year/plant/five-WMI acceptance obligations remain open.
