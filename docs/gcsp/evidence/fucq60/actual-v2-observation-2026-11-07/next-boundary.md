# Next bounded enrichment and image step

## Actual observation

The consumed allocation completed on 7 November 2026 at 03:14:24 UTC, with four GETs, 714,234 decoded bytes, no failures and no retries. Safe artifacts and the original primary are retained in this directory. `live-review.json` records the hash, scope, byte, privacy and cleanup verification. The four-GET allocation cannot be reused.

OTD returned business key `120610284`, source status `1`, and 80 technical entries. Its five preconfiguration codes are a subset of the accepted 51 factory codes. Four keys have finite numeric values and already have an explicit meaning/unit mapping in the existing BMW catalogue adapter:

| Source key | Observed raw value | Existing mapped field | Existing mapped unit |
| --- | ---: | --- | --- |
| N_SITZE | 5 | seats | COUNT |
| A_GEPR_V211 | 300 | luggageNormal | LITRES |
| A_GEPR_V214 | 1135 | luggageExpanded | LITRES |
| E_0_100KMH | 7.8 | acceleration | SECONDS |

The response has no explicit retained unit fields. These are candidate interpretations from the existing mapping, not newly admitted source facts. `A_LAENGE=4361` remains unmapped: the current adapter does not define a body-length mapping. Five text/list values were deliberately excluded by the safe projector (`VERBRMOT_BZEIUNG`, `E_ABGAS`, `VERBRMOT_KRAFTSTART`, `SCR_JA_NEIN`, `GETR_ART`); their strings cannot be reconstructed from this evidence. Source identity is bound by the exact allocated request and accepted source context; these projections do not establish an independent manifest echo of the full configuration. Effect date remains request validity and physical build date remains unknown.

COSY returned 79 view entries, including 39 desktop entries at 2560×1646. Desktop has **eight HEROFRONT candidates**. Selecting by POV alone would be ambiguous. The retained projection records structural keys and pointers, but deliberately drops group-name values, distinction values and opaque asset URLs. No asset was downloaded, so model, paint, wheels, interior, equipment and exact-vehicle fidelity remain unknown.

## Proposed zero-egress fact boundary

Review whether the existing four BMW OTD reference-code mappings above are sufficient semantic/unit authority for this new registered source version. If approved, qualify only those four exact keys using the pinned observation, finite numeric/placeholder checks, exact request registration, actual observation date and the existing mapping's version/digest. Record that units come from the approved mapping, not a returned unit field. No extra source call is required. Preserve body length and the other 76 keys as unknown/unmapped; reject any substitution or re-sealed context change.

Add an optional technical operation to the existing `enrichFleet` stage with a pinned immutable stage input and shared accounting. Its retained input is this observation artifact, and it may populate only the four existing outcome fact fields. Preserve the original catalogue source and attach the technical source provenance separately through existing source-context conventions. Validate the four known results, unknown/placeholder cases, exact scope, zero egress and unchanged existing v2 selection behavior.

This does not by itself admit the facts into the ordinary corpus. `registered-catalogue-sources.js` reconstructs the immutable original selection envelope and the publisher/history retain the existing configuration content. A separate reviewed integration change must carry qualified technical evidence without changing the frozen source envelope or overwriting the same retained configuration. Do not invent a parallel runtime store to bypass that boundary.

## Proposed image boundary, requiring a fresh reviewed allocation

Prepare one exact representative render for the same accepted 1F7E/82GE/51-code registration. Reuse existing live imagery transport/selection behavior, adding the required v2 identity support without fabricating v1 trim, production date or complete legacy request fields. The existing image adapter currently supports T5MJ and the v2 enrichment branch returns before image admission; both boundaries must be handled explicitly.

The smallest source allocation is four GETs: current configurator page, its discovered settings JSON, the same registered COSY manifest, and at most one WebP asset. No OTD request is needed. Pin `/stage-fullscreen-views-legacy-newnames/desktop/namedImages/0/images/0` as the single variant to inspect; require its actual object to have POV HEROFRONT, validate its group name and complete distinction tuple, and retain that safe tuple before fetching its in-memory asset URL. Do not substitute another of the eight HEROFRONT entries or silently fall back if the pinned entry changes. The group name and distinction values must be learned from this fresh response; none are guessed from the current structural projection.

Proposed ceiling: four sequential GETs, 4 MiB aggregate, 1 MiB per JSON/HTML response, 2 MiB for the one WebP, 10 seconds per request, 90 seconds source, 120 seconds supervisor, one worker, 512/448 MiB host/group RAM and 64 MiB scratch. No retry or source write. Validate WebP content type and bytes/hash/dimensions (2560×1646), retain the asset directly outside scratch, and perform local visual inspection before claiming model or paint fidelity. All unverified fidelity stays unknown. The exact next runner, limits and hash pins need parent review before any source release.

After qualification, extend the existing approved-image association and `images.jsonl` publication route for this exact retained configuration; preserve the existing image and use no model/paint fallback. Root retains authority over ordinary-corpus integration and deployment. Neither this proposal nor the completed shape observation establishes original F60 acceptance or target capacity.
