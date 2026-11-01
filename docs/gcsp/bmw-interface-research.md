# BMW vehicle interfaces: FUCQ-4 research and refinement

Observed **1 November 2026** for the **12 November demonstration**. [FUCQ-4](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-4). Scope authorised by Russell: research in the session and implementation-ready stories; no adapter implementation or dispatcher. Russell subsequently added bimmer.work and M Decoder to the investigation and supplied one VIN for lookup testing. Its plaintext, suffix and encrypted forms are omitted from retained evidence.

## Findings and demo recommendation

BMW's UK configurator supplies a useful dated catalogue, option descriptions, configuration rules, technical values and generated imagery. Its successful browser calls use a website-supplied `x-api-key`. Fifteen selected requests replayed without cookies or a key all returned **401**; the image-manifest API did too. These are observed website services, with no supported integration entitlement established. Do not extract the website's key for an adapter.

There is a repeatable BMW VIN route for **Driver's Guide content and an image**: a fresh native HTTPS client retrieved the public encryption key, encrypted the supplied VIN, and obtained the UK handbook and JPEG without cookies or an API key. That is useful for a current-car reference. It does **not** establish a full build sheet, installed equipment, exact exterior specification or connected-use data. Know Your BMW returned no match for the same input.

Neither free third-party decoder produced a decoded result in the bounded tests. M Decoder's newer site advertises the documented **Outvin API**, using HTTP Basic authentication. It is a plausible future build-data provider, but access, successful payloads, use rights and fees remain unproved. Its terms constrain storage and reuse, so it must not inherit the BMW snapshot/cache policy by default.

For a repeatable demo, build a **versioned snapshot-backed catalogue/specification adapter**, a separate **representative imagery adapter**, and a **VIN-linked content adapter**. Keep approved live providers replaceable and explicit. The snapshot may reproduce an observed catalogue configuration; it must not pretend to be an available GCSP car, a historical VIN's specification, or the October 2024 eligibility matrix. A live catalogue provider is separately gated on sanctioned BMW access. No free-decoder scraping or CAPTCHA dependency is recommended.

The [implementation story map](bmw-interface-stories.md) records the bounded children and their gates. FUCQ-5 must agree the HLD before new adapter wiring. The proposals below are inputs to that design, not an approved replacement for it.

## Evidence and limits of the investigation

All observations are from 1 November 2026 unless a source is explicitly described as dated background. Primary sources were the current BMW UK website/configurator, BMW Driver's Guide, their browser requests and public frontend source, BMW technical pages, and the two requested third-party services and Outvin's published documentation/terms.

Native hosted web search was unavailable in the runtime. Parallel Search found and extracted public sources; OpenTabs inspected the dynamic sites through the browser. Native throwaway Node/Python requests tested stateless repeatability. Research stayed in the main session. No BMW customer login, BMW ID credentials, connected-car account, provider registration, paid lookup or downstream reservation/order operation was used. Normal configurator loading itself created temporary anonymous garage configurations; that website side effect is described below and was excluded from deliberate replay.

The sample covers one positively identified electric configuration, two paint selections, one model-substitution case and one user-supplied VIN. It is not a catalogue-wide coverage test or uptime measurement. Browser response capture truncated several large payloads, so retained JSON is explicitly an excerpt, not a full API schema. Successful technical access does not establish service support, licensing or permission to reuse production data.

Retained evidence:

- [Evidence index and checksums](evidence/fucq-4/README.md).
- [Exact selected configurator requests and anonymous replay results](evidence/fucq-4/requests-2026-11-01.json), including the retail-calculation request body.
- [Selected observed model, option and technical values](evidence/fucq-4/observations-2026-11-01.json).
- [Rule result and image-manifest excerpts](evidence/fucq-4/response-excerpts-2026-11-01.json), with ephemeral state and opaque asset URLs omitted.
- [Redacted native Driver's Guide proof](evidence/fucq-4/drivers-guide-native-2026-11-01.json).
- [Third-party observations](evidence/fucq-4/third-party-2026-11-01.json).

## 1. Catalogue identity and dates

Entry points: [BMW UK configurator](https://www.bmw.co.uk/en/configurator.html) and [the sampled i5 Touring configuration](https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ). Observed frontend release: `release_4.15.1_2`, script `/js/index.1793364349.js`.

| Identifier | Observed value | Meaning and constraint |
|---|---|---|
| Market / language | `gb` / `en`; browser locale `en_GB` | Preserve market and locale; do not equate a global derivative with UK equipment. |
| Brand in useful UCP requests | `bmwCar` | An initial `bmwi` request returned HTTP 200 with an empty result. Status alone is insufficient. |
| Configurator model range | `G61E` | Raw/localisation range was `G61`; these are separate fields. |
| UK configuration model | `T5MJ` | BMW i5 eDrive40 M Sport Touring. |
| AG model | `72HH` | Used by OTD and COSY. It is not interchangeable with `T5MJ`. |
| Steering / propulsion | `RL`, rear-wheel drive, electric | Observed model attributes, not evidence about any particular VIN. |
| Requested order date | `2026-11-01` | A date parameter, not a release or delivery promise. |
| Selected effect / tax date | `2027-01-05` | Returned future production context; retain it visibly in provenance. |
| Production date representation | `20270105` | COSY's `effectdate` uses this compact format. |

The model-tree request uses `future-models=true` and `closest-fallback=true`. The actual chosen effect date differs from the requested lookup date. A catalogue adapter must return the resolved identity/dates and identify a fallback. It cannot silently label future production data as the current specification.

**Observed substitution:** the official [330e Touring page](https://www.bmw.co.uk/en/all-models/3-series/3-series-touring/3-series-touring-g21phev-lci.html) linked to `G21/T3MQ`. Opening that configurator link resolved to **`G21/T3SK`, BMW 320i Sport Touring**, a petrol car, with AG model `22FY`. The returned technical sample was 5 seats, 500–1510 litres and 7.6 seconds to 100 km/h. This is evidence of fallback behaviour, not proof of the intended 330e interface. An adapter must reject or explicitly report such a mismatch before enrichment or imagery.

The agreed scheme eligibility baseline remains **October 2024**. Neither the sampled January 2027 catalogue nor the historical test VIN changes it. Do not join them by a broad name such as “3 Series” or “i5”.

## 2. Observed configurator endpoints

UCP base: `https://prod.ucp.bmw.cloud`. All successful application requests in this matrix were observed in the website's browser context with `x-api-key`. The 15 selected native replays without it returned 401 `{"message":"Unauthorized"}`. Exact paths, complete option lists, query strings and the pricing POST body are retained in the request evidence.

| Family / observed request | Useful response evidence | POC interpretation |
|---|---|---|
| `GET /model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{date}/order-dates/{date}` | Model/range identity and dates, derivative, powertrain, model codes. | Catalogue discovery; not released stock. |
| `GET /rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/{date}/order-dates/{date}/models/{model}` | `constructible`, `configuration`, `configurationState`, `configurationChanges`, `classifiedConfiguration`. | Resolve compatible options; compare requested and resolved configuration. |
| `GET /localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{date}/order-dates/{date}/applications/connext/models/{model}/options/languages/en?trim=S0337` | Option codes, types, `phrases.longDescription`. | Labels/definitions; not fitted-equipment evidence. |
| `GET /localisations/marketing-texts/countries/gb/model-ranges/G61/models/T5MJ/languages/en/validity-dates/{date}` | Code-keyed sales text, long/short descriptions and publication notices. | Supplementary copy; sanitise HTML and retain caveats. |
| `GET /localisations/overridden-vehicle-data/.../applications/connext/sales-group-tree/models/{model}/languages/en` | Array of sales/display groups. | Category hierarchy if needed; no need to reproduce the full retail UI. |
| `GET /localisations/overridden-rulesolver-data/rule-sets/pcaso,con/.../sales-group-tree/languages/en/models/{model}/effect-dates/{date}/order-dates/{date}` | Array of rule-related group overrides. | Configuration support, not scheme policy. |
| `GET /classifiers/sources/pcaso/brands/bmwCar/countries/gb/classifiers/energyTax_wltp-non-binding/...` | Classifier response for a complete configuration. | Observed non-binding retail classification; tax/GCSP logic not refined here. |
| `GET /otd/country-groups/eu27+/ag-models/72HH/validity-dates/{date}/otd-for-configuration?included-options={allOptions}` | `businessKey`, `status`, `values`, `preConfigurationOptions`. | Best observed source for configuration-specific technical values. |
| `GET /localisations/channels/con/countries/gb/accessories/phrases/models/{model}/languages/en/validity-dates/{date}` | Accessory-ID keyed text. | Available accessory definitions. |
| `GET /accessories/channels/con/countries/gb/models/{model}/validity-dates/{date}` | Accessory-ID keyed metadata. | Available accessories, not necessarily factory-installed. |
| `GET /pricing/price-lists/pcaso,con/.../models/{model}/available-accessories` | `accessories`, invalid IDs, undefined-price list, `metadata`. | Retail accessories and prices. |
| `POST /pricing/calculation/public-calculation/price-lists/pcaso,con/brands/bmwCar/countries/gb` | Browser HTTP 200; request contains settings, validity dates, configuration and selected accessories. | Retail calculation. It supplies **no verified GCSP points or allowances**. |
| `GET /pricing/calculation/public-calculation/price-lists/pcaso,con/.../models/{model}/tax-dates/{date}/package-pricing` | `packagePricingList`, `invalidOptionCodes`, `optionsWithUndefinedPrices`, `metadata`. | Retail package prices; do not turn ignored invalid options into a successful exact match. |

The website also calls `GET /rulesolver/constructibility-check/configuration-state/{uuid}/add-element-bulk-invocation/{options}` for option alternatives. Its UUID comes from a current rule response. It is ephemeral; never paste a captured UUID into an adapter or durable cache identity.

Normal website loading automatically called `POST /garage/applications/connext/brands/bmwCar/countries/gb/anon-configurations` and received **201**, with `configId`, creation/update dates and expiry. The UI describes saved configuration links as lasting **90 days**. No deliberate replay of this write was performed. Share codes and garage records are unnecessary for read-only enrichment and must remain out of the adapter scope.

### Access and cache proof

No-key native requests, and variants supplying Origin, Referer or both, returned 401. A first browser fetch without an explicit key appeared to succeed because it reused a cached response. Retesting with **`cache: 'no-store'`, `credentials: 'omit'`** returned 401, with no `x-api-key` in the captured request. An OPTIONS preflight returning 200 is also not successful data access.

Only header **names** are retained. No website key was extracted for reuse. Browser success proves that the website has access; it does not prove an anonymous or supported server API. Production integration needs a supported endpoint/credential arrangement confirmed by BMW.

### Repeatable request examples

Without a supplied authorised credential this exact catalogue request reproduces the observed **401**:

```sh
curl --fail-with-body \
  'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2026-11-01/order-dates/2026-11-01?gfs-policy=none&cluster=default&model-ranges=G61E&future-models=true&closest-fallback=true'
```

For an approved live provider, supply credentials through backend secret configuration and use the exact request records in the evidence. Do not put keys in command arguments, browser code, captured HAR files or Jira. No successful authorised standalone UCP client was built in this research.

The initial rule request was:

```text
GET https://prod.ucp.bmw.cloud/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/models/T5MJ
  ?included-elements=FKSFU,P0300,S0337,S043L
  &mandatory-elements=S0337
  &add-rules-for-mandatory-element-classes=fabric,paint,rim
  &application=connext
```

Its normalised option list, rather than those four seed codes, belongs in the subsequent OTD/image requests. Example response structure, shortened for explanation:

```json
{
  "constructible": true,
  "configuration": {
    "modelCode": "T5MJ",
    "elements": {
      "P0300": { "code": "P0300", "type": "option" },
      "S0488": { "code": "S0488", "type": "option" }
    }
  },
  "configurationState": "<fresh state from response>",
  "configurationChanges": {
    "addedElements": {
      "S0488": { "code": "S0488", "type": "option" }
    }
  }
}
```

This is a selected-field excerpt: many elements and `classifiedConfiguration` are omitted, and the state identifier is replaced. It is not a complete replay fixture.

## 3. Specifications, equipment and colours

Selected OTD `values` entries are objects such as `{"referenceName":"N_SITZE","targetValue":5}`. The following meanings were cross-checked where possible against the official [i5 Touring technical page](https://www.bmw.co.uk/en/all-models/bmw-i/i5/i5-touring-technical-data.html), which is directly readable without an API key. Values apply to the sampled configuration/date.

| OTD reference | Observed value | Interpretation / display contract |
|---|---|---|
| `N_SITZE` | 5 | Seats. |
| `A_GEPR_V211`, `A_GEPR_V214` | 570, 1700 | Luggage capacity in litres, normal / expanded. Do not flatten to one ambiguous boot figure. |
| `E_0_100KMH` | 6.1 | Seconds from 0–100 km/h. The UK page labels 0–62 mph; preserve the source's measurement definition. |
| `A_LAENGE`, `A_BREITE`, `A_HOEHE` | 5060, 1900, 1515 | Length, width excluding mirrors, height in mm. Width including mirrors is a separate field, 2156. |
| `C_LEIST_GES` | 250 | Combined power, kW; the response also has PS/BHP variants. Never relabel one unit as another. |
| `BAT_REESS_ENERINH_NET` | 81.2 | Usable battery energy, kWh; gross is separately 83.9. |
| `CHRG_LADELEISTUNG_AC`, `CHRG_LADELEISTUNG_DC` | 11, 205 | Configuration's maximum charging powers, kW. Official page mentions an optional 22 kW AC specification; do not overwrite the sample with the range maximum. |

The model tree's dimension/weight fields included **`"0000"`** placeholders. These are unknown, not zero measurements. Unmapped OTD codes, missing fields, hyphens and malformed values must remain unknown until their meanings and units are established. Do not transplant the old matcher's model-level estimates into a supposedly exact source result.

Colour/equipment examples from the option and marketing sources:

| Code | Observed description | What it proves |
|---|---|---|
| `P0300` | Alpine White | Selected in the initial configuration. |
| `P0475` | Black Sapphire | Available alternative; selected in the second image test. |
| `FKSFU` | Perforated and Quilted Veganza in Smoke White | Selected upholstery label. |
| `S0488` | Lumbar Support | Present in the resolved sample's selected options. |
| `S03AC` | Towbar | Definition available, but **not selected in the sampled configuration**. |

Option definitions, selectable options, selected catalogue equipment and verified VIN-fitted equipment are four different things. An absent code in an incomplete VIN source is unknown, rather than proof that the feature is absent. A selected catalogue code is still not proof that a released physical car carries it.

Marketing text contains HTML, option conditions and potentially inconsistent wording. The sampled lumbar-support text unexpectedly referred to the rear seat backrest while describing driver/front-passenger support. Use stable labels and verified attributes for matching; sanitise optional explanatory HTML and do not make stronger claims from prose. Accessory availability also does not imply installation or retrofitting permission.

The anonymous technical HTML is a useful human cross-check or a separate future parser candidate. It mixes derivatives, maximum/optional figures and marketing sections. This investigation does not establish a robust HTML adapter or a substitute for an approved structured API.

## 4. Configuration imagery

Observed manifest request (complete selected options supplied in the real request):

```text
GET https://prod.cosy.bmw.cloud/image-urls/dynamic-named-images/mandators/connext-bmw/collections/stage-fullscreen-views-legacy-newnames/brands/bmwCar/models/72HH
  ?effectdate=20270105
  &hub=CLOUD_PROD_INTERNET
  &imagetype=webp
  &options=<complete normalised options>
```

The browser received 200 with `x-api-key`; a native no-key manifest request returned 401. Returned sections included thumbnails/mobile/tablet/desktop, with `metaData` and `namedImages[]`; each named group contains `images[]` with `viewImage` and `distinctionParameters`. Observed sizes included desktop **2560×1646** and mobile **1280×1152**.

There were **39 desktop entries including crop variants**. Named views included HEROFRONT, FRONTRIGHT, WHEEL, HEROREAR, REARLEFT, SIDELEFT, SIDERIGHT, FRONTLEFT, DASH, INTERIORSIDE and FRONTSEATS. That is not evidence of 39 unique angles, a licensed 360-degree viewer, or a supported iframe/embed.

The manifest returned opaque `https://prod.cosy.bmw.cloud/connext-bmw/cosySec?...` asset URLs. Direct GETs of two returned assets succeeded without cookies or a key. Do not construct, edit or assume permanence of their opaque query parameters; expiry/stability was not established. The distinction is **protected manifest resolution, directly retrievable returned asset**.

Two downloaded catalogue renders were visually inspected. Changing the normalised paint selection from Alpine White to Black Sapphire changed the image colour while retaining the same i5 Touring front view:

| Selection | Retained research image | Bytes | SHA-256 |
|---|---|---:|---|
| `P0300` Alpine White | [White reference](evidence/fucq-4/i5-alpine-white-reference.webp) | 82,798 | `fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe` |
| `P0475` Black Sapphire | [Black reference](evidence/fucq-4/i5-black-sapphire-reference.webp) | 86,286 | `4c38cdb43b6438b7ae54fd1c882280bf744e88a17f2ce43597c5dd2c4890b5de` |

These are research references, not runtime assets. They demonstrate model/paint variation for this sample. They do not verify every wheel, interior or equipment option. An imagery contract must carry **representative render**, supported/unknown fidelity, source, date, selected configuration identity, viewpoint and fallback state. A stock photograph of an exact car, a VIN-linked illustration and a generated catalogue render must retain different labels. Do not quietly show another model/paint when an asset fails.

## 5. VIN lookup: official BMW routes

### Know Your BMW: no match in this sample

[Know Your BMW](https://knowyour.bmw.co.uk/) accepts the last seven characters, uppercases them and calls:

```text
GET https://knowyour.bmw.co.uk/api/v1/vehicles?vin=<last-seven>
```

The site describes coverage for UK vehicles built since November 2018 and Ireland since March 2020. A synthetic negative input and the supplied VIN's suffix each returned **HTTP 200** with **`{"status":422,"body":""}`** and displayed “Vehicle not found”. This does not establish that the supplied VIN is invalid or prove its build date. Do not interpret HTTP 200 as a positive decode.

Public frontend source refers to success fields `model_description`, `vin_number`, `colour_description` and a guide `location`. **That success shape was not exercised.** No full equipment contract, positive colour decode or supported API entitlement was proven here.

### Driver's Guide: positive, repeatable VIN-linked content

[BMW Driver's Guide](https://driversguide.bmw.com/) redirects to [the BMW online handbook VIN search](https://baonline.bmw.com/#/bmw/vin-search). Its website describes 2012-onward coverage and partial support for older vehicles.

For the supplied VIN, default locale `en-us` returned **HTTP 200 / `MANUAL_NOT_AVAILABLE`**, derivative **F30**, with UK English among alternatives. Selecting **English (UK)** and resubmitting returned **HTTP 200 / `OK`**, title **“THE BMW 3 SERIES WITH eDRIVE.”** Locale is material, and a negative locale result is not a missing vehicle.

Observed operations:

| Operation | Request | Observed result |
|---|---|---|
| Public encryption key | `GET https://baonline.bmw.com/digital/v4.0/key` | 200; `publicKeyData.pem`, `algorithm`, interface/status fields. Despite its name, `pem` was base64-encoded DER/SPKI, without PEM headers. |
| Handbook tree | `GET /digital/v4.0/manual?encryptedVin=<private-value>&locale=en-gb` | 200 / `OK`, derivative F30, brand BMW, title/disclaimer and content entry points. |
| PDF manual list | `GET /digital/v4.0/pdfManual?encryptedVin=<private-value>&locale=en-gb` | Browser 200 / `OK`; handbook and Navigation / Entertainment / Communication documents. |
| VIN-linked image | `GET /digital/v4.0/cosy?encryptedVin=<private-value>&locale=en-gb` | 200 JPEG, 1825×1000, 305,724 bytes. |

Public script `/main-7UGWFA5O.js` calls `getPublicKey()`, JSEncrypt's `encrypt(clearVin)`, then converts Base64 to URL-safe Base64. A native Node replay independently verified the equivalent **RSA PKCS#1 v1.5** encryption and fresh HTTPS requests:

```js
// Illustrative operations inside a controlled backend probe, not a product adapter.
const keyResponse = await fetch('https://baonline.bmw.com/digital/v4.0/key');
const { publicKeyData } = await keyResponse.json();
const key = crypto.createPublicKey({
  key: Buffer.from(publicKeyData.pem, 'base64'), format: 'der', type: 'spki',
});
const encryptedVin = crypto.publicEncrypt(
  { key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(authorisedVin),
).toString('base64url');
// Send encryptedVin and the requested locale to manual/cosy; never log their URLs.
```

The replay used a newly fetched public key and no cookies, `Authorization` or API key. `en-us` reproduced `MANUAL_NOT_AVAILABLE`; `en-gb` reproduced `OK`. The image SHA-256 was `946bf4c6ac588040205cdd7f911d04088b2ef42733f858dc9828932009936f58`, matching the browser's no-store, credentials-omitted image request. Only redacted results were retained; the VIN-linked image and private URLs were not copied into the repository.

The guide's disclaimer says it describes equipment largely on a vehicle-specific basis, but **individual equipment/functions described may not be available in the vehicle**. It is an additional, non-binding service, not a replacement for the vehicle's handbook. Therefore this proves handbook/content retrieval and a VIN-linked illustration, **not** a build-sheet API, verified fitted equipment, exact colour/wheels, current software state, mileage, journeys or charging history. No connected-use endpoint was found or tested in this investigation.

Encryption does not make a VIN-linked URL safe to publish. Full, partial and encrypted identifiers, source response VIN fields, PDF/image URLs and hash routes all need redaction from logs, error messages, telemetry, fixtures, Jira and repository evidence. Live lookup should be an explicit provider choice; default tests must use synthetic inputs with stubbed transport.

## 6. Requested third-party fallbacks

Russell reports that [bimmer.work](https://bimmer.work/) and [M Decoder](https://www.mdecoder.com/) sometimes work but can be flaky. That is user experience, not a measured reliability result. This session investigated both using ordinary browser interaction and public documentation; no CAPTCHA bypass, rate-limit circumvention, registration or paid access was attempted.

### bimmer.work

The homepage claims VIN-based factory option lists, configuration images and 360-degree views. The live page exposes an HTML form **`POST /query.php`**, with `vin` (17 characters) and hidden `recaptcha_token`, using Google reCAPTCHA Enterprise. A form action is not a documented JSON API.

Two ordinary-browser submissions of the supplied VIN produced **no decoded result**. The token was not populated when inspected; one attempt left the submit button disabled and the later attempt returned it to enabled. No successful `/query.php` response was captured. This is an unresolved browser flow, not a confirmed “VIN not found” result and not proof that the service never works. No successful vehicle/options/image payload or public API access contract was established. The homepage's 360-degree claim remains unverified here.

**Recommendation:** do not implement a server scraper or make the demo depend on the browser CAPTCHA flow. Retain it as a manual reference candidate if it works for a presenter, with separately agreed data reuse. Revisit only with an offered/supported API contract.

### M Decoder free website

The live homepage accepts 17 characters and uses a **POST form to the current page**, with fields `vin` and a session `_token`. The captured subsequent result route was **`GET /decode/<VIN-suffix>`**, returning HTML, not an observed JSON decode API. Do not retain that suffix-bearing URL.

The supplied input first produced “Please Wait — Data will be available in 30 seconds. Please refresh the page.” After the advertised delay and one refresh, it displayed **“Solve Captcha”**. No decoded build or option data was returned. The site explicitly disclaims BMW affiliation. Recent vehicle rows on the homepage show that it publishes model/paint/upholstery summaries, but those rows do not prove the supplied VIN's data or a supported integration route.

**Recommendation:** no automated free-site adapter based on this evidence. A queued/waiting response or challenge must become a provider-unavailable state, not a negative decode or an empty equipment list.

### M Decoder's advertised Outvin API

The first-party subdomain [new.mdecoder.com/vin-decoder-api](https://new.mdecoder.com/vin-decoder-api) identifies **Outvin / SIA Social Minds**, links to registration for pricing, and links to its [SwaggerHub documentation](https://app.swaggerhub.com/apis-docs/outvin/Outvin/1.0.3). This identifies an advertised commercial route; it does not prove that the free website calls that API internally.

Parallel Fetch returned unrelated content for the SwaggerHub URL. Opening it in the live browser showed **Outvin API 1.0.3**; the public [OpenAPI JSON](https://api.swaggerhub.com/apis/outvin/Outvin/1.0.3) independently returned 200. Use those verified sources, not the bad extract.

Documented production base: **`https://www.outvin.com/api/v1/`**. Authentication: **HTTP Basic**, using an Outvin user email and password. The alternate `virtserver.swaggerhub.com` server is a mock and cannot prove live VIN data.

| Documented operation | Documented contract | What was proven |
|---|---|---|
| `GET /vehicle/{VIN}` | Required 17-character VIN; responses 200, 400 invalid format, 401 credentials, 402 payment, 404 not found, 5XX. | Documentation reachable. **The 200 response has no body schema or example in v1.0.3.** No positive decode. |
| `GET /status?type=0` | Source type 0 vehicle identification; type 1 history. Documented `makes[]` contains `brandCode`, `make`. | Unauthenticated native `/status` returned 403. Its documented schema is not observed live output. |
| `GET /history/{VIN}/{type}` | Service/history products, separately documented and billed. | Out of this task's scope; not tested. It supplies no proven current connected-use telemetry. |

The docs publish free test VINs. A native no-credential request using the **vendor's published BMW sample**, rather than the user's VIN, returned **403**. Both 403 responses were `text/plain`; they do not establish whether the origin's documented 401 was reached or an access layer rejected the request. No account existed for an authenticated proof. No price, entitlement, remaining provider credit or successful-result coverage was verified.

Live browser verification of [Outvin terms v1.0](https://new.mdecoder.com/terms-and-conditions) confirmed material constraints:

- Sections 1–3 limit use to professional automotive aftermarket purposes and make coverage dependent on brand, market, age and source availability. Confirm that this BMW employee-scheme demonstration is permitted.
- Sections 7–9 constrain customer-facing display, redistribution, scraping and storage. In particular, the customer must not retain raw/substantial outputs to create or enrich a separate dataset; only limited trace records are generally permitted. Twelve-month repeat access is **provider-side access**, not permission to save local response fixtures or an offline VIN database.
- Section 11 permits rate limits and contract changes. Section 12 makes fees/product conditions relevant. Section 14 does not promise uninterrupted access; section 15 allows incomplete/inconsistent data.

**Recommendation:** Outvin is the most concrete third-party API candidate found, but **not ready for a truthful implementation story yet**. First obtain permitted demo/display/test/retention terms, account access and fees, then one authorised successful response plus negative/error examples and a field dictionary. Do not guess a build-sheet schema or keep vendor outputs as fixtures under the current unconfirmed rights. No contact was sent and no purchase/signup was made.

## 7. Adapter boundaries and story implications

These are refinement recommendations for FUCQ-5 and the child stories, with the external-data boundaries already binding in the [demo brief](demo-brief.md).

| Boundary | Input / output | Keep separate |
|---|---|---|
| Catalogue/specification | UK market, catalogue/order/effect dates, model/type/AG IDs, trim and complete selected options → supported specs, option definitions and configuration selection. | VIN build facts, stock availability, employee eligibility/points. |
| Configuration imagery | Resolved catalogue identity + full options + viewport/viewpoint → representative render and fidelity/provenance. | Physical-car photography, unverified VIN appearance, image availability versus car availability. |
| VIN-linked content | Explicitly authorised VIN + locale → guide availability, handbook links/content metadata and VIN-linked image status. | Installed equipment, connected statistics, exact configuration. |
| Future VIN build provider | Permitted provider contract + authorised lookup → provider-attributed identity/build fields with completeness. | Handbook-derived guesses and BMW-authoritative claims for third-party results. |
| GCSP scheme/state | Scheme-specific dates, employee/grade, authoritative or labelled fixture rules, exact released vehicle ID. | Retail prices, catalogue constructibility and retailer used-stock inventory. |

Existing code reinforces that split: `server/stock.js` dispatches retailer/dealer/national feeds; `server/mapping.js` maps listing data and supplies model-level defaults/estimates; VIN is currently an identifier fallback, not a decoder. `stock.js` separately enriches listing colours. `server/index.js` projects match display fields; the existing result-card image fallback belongs to the used-car experience. Reuse appropriate HTTP/normalisation patterns without overwriting those routes or presenting their estimates as exact BMW facts. See [discovery findings](discovery-findings.md) and FUCQ-7 for engine reuse scope.

The proposed narrow shared contract should carry:

- Requested **and** resolved market/identity/dates/options; an exact-match/mismatch result before combining sources. Stable cache identity includes provider/version, market, locale, dates, model/AG mapping and sorted normalised options; never a garage code or rule-state UUID.
- Provider, source kind (`observed snapshot`, `live`, `synthetic fixture`), observation/retrieval date and relevant catalogue validity. Distinguish observed facts from illustrative assumptions at field level when mixed.
- Explicit `ok`, `partial`, `not-found`, `unsupported`, `source-unavailable`, `identity-mismatch` and input-validation outcomes as applicable. Separate transport/HTTP status from source application status. Unknown fields stay unknown and do not become zero, false or empty “complete” lists.
- Attribute meaning/unit; option definition versus selected versus verified fitted status; completeness sufficient to distinguish absent from unknown.
- Image role/fidelity/viewpoint and a purposeful missing-image outcome. A missing image must not suppress otherwise valid facts or fabricate another car.
- Bounded timeouts, response validation, no secret/identifier logging, explicit provider choice and safe fallback provenance. Do not silently switch providers and preserve an “official” label. Provider-specific retention rules override generic caching.

No new GCSP endpoint, screen, points calculation, VIN persistence or connected-data pipeline is designed/implemented in this session. Internal modules/contract tests can be specified now; FUCQ-5 agrees their placement and later consumer wiring. The [experience quality contract](experience-quality.md) applies to the presentation contract even for backend stories. No GCSP visual reference has been agreed, so these stories must not invent UI; future consuming screens need desktop/narrow/keyboard review against the agreed reference and `COMPONENTS.md`.

## 8. Questions and decisions still needed

Russell retains the human discussion with Sandeep. The running list's SAN-004 and SAN-012 stay open; website research is not an answer from BMW.

1. **Supported BMW data access:** which service should supply UK catalogue, selected/fitted equipment, model/AG identifiers, paint and renders to this demo/later integration? Can BMW provide sanctioned credentials or an anonymised dated export, usage/retention/image rights, coverage and rate limits?
2. **Authoritative VIN/build mapping:** can VSS or another approved service return static VIN specifications, build date, exact codes, fitted options and image identifiers? Which fields and completeness guarantees distinguish original build from retrofits/current software? Can a non-personal representative payload be shared?
3. **Dated joins:** how should October 2024 scheme eligibility map to the actual demonstration vehicles and current/future catalogue identifiers? Which date owns each rule? Do not infer the join from similar names.
4. **Driver's Guide:** is its handbook/image route an acceptable demo source? What supported interface and display/retention terms apply? It does not answer the connected-use questions.
5. **Third-party alternative:** if the official build-data route is unavailable, is Outvin permitted for this demo? Confirm use/display/retention/fees and obtain an authorised sample before refining implementation. The free-site CAPTCHA routes are not a dependable adapter contract.
6. **Connected-use facts:** mileage, journeys, charging, attribution/consent and observation periods remain unproven. They still require Sandeep/Pete Thorne or the relevant owner, independently of VIN decoding.

## Research and review record

Read-only repository scoper: requested Haiku, selected `gpt-6-luna` / `high`, no fallback or descendants. Independent refinement reviewer: requested Opus, selected `gpt-6.1-sol` / `high`, no fallback or descendants. Both were resolved with `tiers spawn ... --harness codex`; effective runtime settings were not independently verified. Neither delegated agent performed live web research. Final review evidence is recorded in the story map after the written artefacts are checked.
