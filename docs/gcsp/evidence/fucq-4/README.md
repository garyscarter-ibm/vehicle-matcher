# FUCQ-4 research evidence

Observed 1 November 2026. Interpretation and source URLs are in [the research report](../../bmw-interface-research.md). These are research records, not runtime fixtures or complete API specifications.

| File | Contents |
|---|---|
| `requests-2026-11-01.json` | Fifteen exact selected browser request examples, retail POST body, browser HTTP status and native no-cookie/no-key 401 results. One legacy `bmwi` request had an empty browser result despite HTTP 200. |
| `public-website-key-native-2026-11-01.json` | Follow-up: public configurator settings discovery and three paired native 401-without-key / 200-with-key replays, with selected catalogue/options/OTD checks. No key values retained. |
| `configuration-generation-native-2026-11-01.json` | Synthetic-fleet refinement pilot: three constructible i5 configurations and matching OTD reads; unsorted-seed 400 and successful sorted towbar request. Full resolved element lists (configuration options plus the selected accessory), no rule-state IDs or keys. |
| `observations-2026-11-01.json` | Selected i5 catalogue/model/options/OTD values, paint-change configuration, access notes, redacted VIN results and a G21 model-substitution case. |
| `response-excerpts-2026-11-01.json` | Rule configuration/additions and image-manifest shape, counts and selected entries, without ephemeral IDs or opaque asset URLs. |
| `drivers-guide-native-2026-11-01.json` | Fresh-key native RSA-encrypted lookup results, locale/application statuses and image byte count/hash, without private identifiers or URLs. |
| `third-party-2026-11-01.json` | Bounded free-site failures, documented Outvin API/access/schema limitations and source terms. No vendor decode output retained. |
| `i5-alpine-white-reference.webp` | BMW catalogue research render for `T5MJ` / `72HH`, effect date 2027-01-05, selected paint `P0300`. |
| `i5-black-sapphire-reference.webp` | Same model/date/view with selected paint `P0475`; visually inspected colour change. |

The two renders were returned by BMW's COSY manifest and retrieved from its opaque returned `cosySec` URLs. They illustrate catalogue appearance, not released inventory or the user's VIN. Do not make them runtime assets without the demonstration's agreed imagery/display terms and provenance. Their opaque URLs are deliberately not retained. The private VIN-linked image is not included.

## Verification

From the repository root:

```sh
python3 -B -m json.tool docs/gcsp/evidence/fucq-4/requests-2026-11-01.json >/dev/null
python3 -B -m json.tool docs/gcsp/evidence/fucq-4/public-website-key-native-2026-11-01.json >/dev/null
python3 -B -m json.tool docs/gcsp/evidence/fucq-4/configuration-generation-native-2026-11-01.json >/dev/null
python3 -B -m json.tool docs/gcsp/evidence/fucq-4/observations-2026-11-01.json >/dev/null
python3 -B -m json.tool docs/gcsp/evidence/fucq-4/response-excerpts-2026-11-01.json >/dev/null
python3 -B -m json.tool docs/gcsp/evidence/fucq-4/drivers-guide-native-2026-11-01.json >/dev/null
python3 -B -m json.tool docs/gcsp/evidence/fucq-4/third-party-2026-11-01.json >/dev/null
shasum -a 256 docs/gcsp/evidence/fucq-4/*.webp
```

Expected image digests:

```text
fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe  i5-alpine-white-reference.webp
4c38cdb43b6438b7ae54fd1c882280bf744e88a17f2ce43597c5dd2c4890b5de  i5-black-sapphire-reference.webp
```

Individual full/encrypted VINs, serials, identifying VIN fragments, VRMs, credentials, API-key values, session/CSRF/CAPTCHA tokens, garage IDs and user-specific handbook/image URLs are excluded. The authorised profile research below retains shared manufacturer/type codes and sanitised positional observations; these do not retain an individual vehicle identity. Website bundles, raw HAR files and complete browser headers were not copied into the repository. Successful HTTP/application statuses are recorded separately. Native replay of the selected UCP URLs returned 401 without a key and 200 with the public website's application key. The latter proves technical access for those requests, not a BMW-supported live-provider integration.

## Synthetic VIN rules follow-up

[`bmw-vin-rules-2026-11-01.json`](bmw-vin-rules-2026-11-01.json) records primary BMW MY2026/MY2027 Part 565 filing URLs and SHA-256 hashes, 145 extracted reference rows (82/63), five required WMIs, the separate plant dictionary and an independent check of the regulation's public checksum arithmetic (sum 411, remainder/check character 4). Both source table layouts were visually checked. All 145 manufacturer-filing descriptor rows are **reference-only North American evidence**, not enabled UK/RHD generator profiles. It contains no complete VINs or individual serials.

The [VIN rules research](../../synthetic-vin-rules.md) records exact checksum/year/serial rules, supported model/plant evidence, UK coverage gaps and generation acceptance. No generator, bulk corpus or service was built by this follow-up.

Five additional official vPIC **partial-pattern** checks corroborate the five MY2026 fixture categories and plant cities. All return HTTP 200 / `6 - Incomplete VIN` because the serial/check character were deliberately omitted. They do not establish successful complete-VIN/checksum validation. The evidence JSON retains the incomplete public manufacturer patterns and results; no complete synthetic VIN was generated or sent.

The same JSON's `ukDescriptorObservations` section records Russell's AutoTrader/photographed-plate/VINwiki method and twelve sanitised single-vehicle observations: a user-opened 120 result, one complete advert-to-220i Active Tourer lookup, and ten pairs supplied directly by Russell on 2 November. All twelve match checksum arithmetic and have position-ten `0`; the ten supplied pairs were not independently looked up. The latest eight are user-described as 2026 models, with the F95 manufacture-in-2026 statement specifically attributed to Russell’s report of AutoTrader. These observations do not prove UK-market/RHD status, build/model year, a universal checksum rule or a generation-wide descriptor mapping. Only shared WMI/descriptor codes, literal positional characters, serial shapes, arbitrary observation IDs and confidence/unknowns are retained. No full VIN, plate, individual serial, identifier hash, vehicle-specific URL or screenshot is retained. The supplied UK X5/X5 M use WBA/WBS, correcting the shortlist’s 5UX/5YM assumption; the separate five-WMI fixture/population requirement and profile activation remain open. The [sample checklist](../../vin-sample-checklist.md) records the completed first-pass collection.
