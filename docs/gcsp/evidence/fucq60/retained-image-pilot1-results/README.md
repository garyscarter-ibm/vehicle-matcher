# Retained image pilot 1: isolated actual-data proof

The parent reviewed and authorised the concrete plan at `7ec6bb1c` before the single actual-data execution. The proof passed on 7 November 2026 using that unchanged executable and the integrated pilot code from `d0873843`.

The isolated candidate is `0f7edad7be5263960259446fab9efdea515fb77b86112b23a37c772e3fc1c05d`, version `2026-11-07.4-image-pilot1`. It contains the same 350 configuration rows, 349 qualifying source configurations and one retained synthetic VIN association as baseline `.4`, plus one exact F42 retained representative image.

- Configuration file: all 6,500,952 bytes unchanged, SHA-256 `da5c54020b9ccf2eddef8160a8df4e501f7ce57884b195bd275e242ff843f2f5`.
- VIN file: all 2,565 bytes unchanged, SHA-256 `8e9c7d5f34d4843aeb9de5b7a707c53c339c9a1f64e5675fe04e73e2417cbccd`.
- All retained configuration/full-row digest entries, VIN/physical-car identity associations and previous dataset entries unchanged. One isolated dataset version was added.
- Cold registry and default local composition served the exact imaged configuration through the application port, with the representative label and physical production date still unknown.
- All 351 application-port routes and all 351 loopback HTTP routes passed, including the imaged configuration. There were zero reconciliation errors, HTTP errors, external calls or source calls. The loopback server was closed.
- The original 27-file, 19,975,738-byte source-store tree was unchanged. No ordinary selection, last-good pointer, identity inventory or version was published or edited by the proof.

The run took 13.944 seconds, with measured peak RSS 240,533,504 bytes and peak scratch 35,973,120 bytes. This stayed within the approved one-worker / 512 MiB host / 448 MiB child / 64 MiB scratch / 90-second bounds. The supervisor finalizer removed scratch and the temporary dependency link, verified owned process group 60553 had no live members, and released the host reservation. There are no recorded leftovers or compatibility exceptions.

The image is the original 82,798-byte WebP, SHA-256 `fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe`, HEROFRONT, 2560×1646. F42 model and white-paint observation remain authoritative. Wheels, interior, equipment match and exact physical-car appearance remain unknown. Other 349 rows remain without images; no v2 image mapping is inferred.

## Receipts

- [Actual proof receipt and all-record audit](actual-receipt.json)
- [Code/test identity and measured resources](actual-result.json)
- [Allocation and test-selection plan](actual-plan.json)
- [Filesystem/process cleanup evidence](actual-cleanup.json)
- [All 14 owned allocations and output condensation](all-allocations-cleanup.json)
- [Scoped check summary, including retained failed-run explanations](scoped-checks.json)
- [Approved plan and provenance](../retained-image-pilot1-plan-2026-11-07.md)
- [Exact proof executable](../reproduce-retained-image-pilot1.mjs)

The external resource supervisor remains at `/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f60/retained-image-pilot1/run.py`; its actual command was `python3 -I -B <supervisor> actual`. Its run-owned manifest and finalizer were registered before allocation. All 14 pilot allocations, including expected reds and the setup failure, are verified absent, with no live owned groups or reservations. Their summed measured peak allocations removed total 57,217,024 bytes; this is a sum across sequential chunks. A further 3,010,454 bytes of successful verbose output and aggregate coverage were condensed into the local file/function impact summary; expected red and useful setup-failure logs remain bounded outside scratch.

This is scoped image-delivery evidence. It does not establish whole-story acceptance, full source/profile/VIN breadth, the 10,000-configuration target, stock/SQL integration, public image delivery or active publication. Independent code/security review and any ordinary publication remain with the parent.
