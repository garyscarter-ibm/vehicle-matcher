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

The final integrated check passed **177/177**, with no failures or skips, in 2.7 seconds. It covers catalogue/projection/live-provider tests, the actual hosted cookie-gated image route, the latest login identity and offer-decision boundaries, and the UI ratchet. This is scoped validation, not a full-suite result. Earlier source/current/generated, offer, account and media boundary runs also passed. [validation.json](validation.json) records commands, identities, exclusions and the actual earlier failures, timeouts and unrun PostgreSQL check.

Implementation `7f011ca1` includes base `29c5b636`. The subsequent base `c64b1cf6` brought only backlog, claim, archive and evidence metadata. All 274 reviewed application/test/asset hashes still match; the identical-code evidence is reused rather than repeating unrelated tests. [reviewed-code-identity.json](reviewed-code-identity.json) pins those files.

## Rendered review

The independent reviewer inspected 30 desktop/narrow images, eight corrected/selected-state supplements and two final contact/action captures at 1280 and 375 pixels. States cover current Touring, empty/search results, long-name gallery/detail, selected review, contact/actions, confirmed account, order progress, G20/G21 recommendations, offer/declarations/activity, error and forced retained fallback. The parent inspected the key live/fallback, corrected media and selected states as well.

Corrections make the current-car picture contain the entire car, give offer/activity pictures a shared contained 16:9 frame with captions below, hide empty order badges and place populated offer/activity badges at the top-left. The final independent verdict is **passed for scoped imagery**. The selected-review badge still clips into a dark strip; the full car and separate order number remain readable. This Low/P3 issue is separately captured as FUCQ-345, linked to FUCQ-70 and this discovery, for independent prioritisation. Its repository evidence is retained, and narrow screenshot attachment937452 was verified in Jira.

The CLI design detector executed with zero findings. The browser detector was attempted on gallery/account/offer, but CSP refused its script: `injected=false`, `findings=null`. It did not execute successfully. The last two action captures exist and were visually reviewed; their mechanical receipt remains incomplete because the phone field is above the desktop scroll position. Earlier desktop evidence shows the field, and all fields/actions appear in the narrow capture. Claim identity remained unchanged. Initial absent-order API reads returned 404 before successful later claim/order reads. These limitations are recorded in [visual-review.json](visual-review.json), alongside the independent critique and the 17 retained screenshot hashes.

To review the repair, sign in, open Your cars and inspect the current Touring. Browse available cars, inspect a detailed car, resume a selected review, and follow the offer/activity and order-progress views. Cars should retain their model/body picture across these views, with the representative-image caption. The retained-fallback screenshots show the same behaviour during an upstream failure; this does not require making the live provider unavailable in the shared demo.

## Resources and delivery

One test/browser worker ran at a time. All 59 owned scratch manifests are removed and all 55 supervisor receipts confirm scratch cleanup. The measured maximum was 680.2 MiB RSS and 13.3 MiB scratch. The local browser-profile/TLS exception was removed after capture. The final cleanup removed 31,308,441 bytes of disposable input, screenshot and successful-log copies, with no leftovers; 916,693 bytes of selected screenshot evidence remain here. [resource-cleanup.json](resource-cleanup.json) records the exact cleanup manifest and retained receipts. No large cloud output was created.

The backend image-fix revision `98714a42` deployed successfully at 12:44:59 UTC on 10 November 2026. At 12:46 UTC, both public health checks returned 200, and the served image routing bundle, shared media/account styles and retained Touring WebP matched the reviewed local SHA-256 hashes, with the correct content types. The static site revision `1157ee10` also deployed successfully. [deployment.json](deployment.json) retains the earlier pre-rollout 404 observations and final successful checks. A signed-in hosted journey was not rerun because no existing authenticated background demo tab was available; actual cookie-gated image delivery is covered by the local integration test. Jira is In Review until collaborator acceptance.
