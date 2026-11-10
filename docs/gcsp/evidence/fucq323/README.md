# Vehicle image coverage, FUCQ-323

Russell requested complete vehicle imagery on 10 November 2026, including the missing 3 Series Touring. His subsequent direction makes live BMW configurator delivery the primary source, with cached successful responses and retained images for provider failure or unsupported models.

## Source findings

A configuration ID alone is insufficient for the public renderer. Independently retained configuration observations supply the AG model code, effective date and full factory option selection. The server reads the current configurator page/settings, resolves the current FRONTLEFT sand manifest image, and returns its bytes on a stable same-origin image route. Configurator keys and opaque COSY URLs remain in memory and never enter browser responses, source control or logs.

The bounded source capture obtained 246 live renders successfully. The catalogue has 247 configuration associations (including one previously approved legacy i5), 201 generation/model/paint variant associations, four structural demo representatives and 240 unique retained derivatives. There are 238 live image IDs; the G20 saloon uses official BMW Group photo P90549617 and the legacy i5 remains a retained fallback. Full supported-fleet validation covers 2,424 GB configurations; a US G23 reference is excluded from the supported scheme.

The catalogue and source evidence are SHA-pinned. Every retained asset is checked for path, byte count and SHA-256 before use. The existing strict source-corpus admission registry is unchanged. Public presentation overlays also repair supported snapshots saved before this change, after authority/digest checks, without changing stored stock, selection terms, command inputs or pending payloads.

The live delivery smoke returned the G21 image with HTTP 200 in 1,536 ms, then in 1 ms from cache with zero additional upstream requests. All four upstream stages returned 200. Safe details are in [live-smoke.json](live-smoke.json).

## Fidelity and limitations

These are representative catalogue/model images. Matching source configuration and paint does not prove exact physical VIN, trim, wheels or equipment appearance. The manifest does not echo a complete vehicle identity. Configurations outside the captured sample use a matching generation/paint representative. The G20 photo is a 330i saloon model representative, without an exact 320i appearance claim.

Observed BMW image cache metadata permits 604,800 seconds. The adapter caps its successful-byte cache at seven days and 32 MiB, coalesces identical requests, and allows at most two concurrent upstream jobs. It applies time, response-size and fixed-host limits. Source errors, unsupported configurations and invalid source evidence use a byte-verified retained derivative. No upstream URL longevity or future key-rotation guarantee has been established. No licence grant was observed in response metadata; the source is BMW's public configurator and official press media.

## Validation

Validation is scoped to changed image sources/projections and their current-car, stock, manual, offer/activity and order-progress consumers. The affected selector lacked a JavaScript selection plugin and proposed the full suite; that fallback was rejected in favour of explicit boundary commands. Full unrelated simulations and native PostgreSQL generation are outside this image repair; the latter requires GCSP_DATABASE_URL.

Final scoped command results, rendered desktop/narrow critique and resource cleanup receipt are recorded below when the final review is complete. Deployment is a separate environment observation.
