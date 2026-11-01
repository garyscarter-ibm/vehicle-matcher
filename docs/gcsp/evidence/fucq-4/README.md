# FUCQ-4 research evidence

Observed 1 November 2026. Interpretation and source URLs are in [the research report](../../bmw-interface-research.md). These are research records, not runtime fixtures or complete API specifications.

| File | Contents |
|---|---|
| `requests-2026-11-01.json` | Fifteen exact selected browser request examples, retail POST body, browser HTTP status and native no-cookie/no-key 401 results. One legacy `bmwi` request had an empty browser result despite HTTP 200. |
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

Private full/partial/encrypted VINs, credentials, API-key values, session/CSRF/CAPTCHA tokens, garage IDs and user-specific handbook/image URLs are excluded. Website bundles, raw HAR files and complete browser headers were not copied into the repository. Successful HTTP/application statuses are recorded separately. Native replay of protected UCP URLs should return 401 absent authorised access; this is an expected research result, not a passing live-provider integration test.
