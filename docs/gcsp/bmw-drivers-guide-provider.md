# Offline Driver’s Guide provider contract — FUCQ-44

Implemented inside the existing Node vehicle-evidence component. `createBmwDriversGuideAdapter` in
`server/vehicle-evidence/bmw-drivers-guide-provider.js` is the only exported entry. It returns the existing
FUCQ-43 adapter contract. Its raw provider is private and cannot be selected separately to bypass the guard.
No transport means disabled. No built-in fetch, environment activation, credential, public lookup route,
persistence, document/image retrieval, UI, stock, mapping or catalogue change is supplied.

Live activation, demo use and retention remain **unapproved and disabled**. Offline tests use generated
fictional identities and generated RSA keys with injected transport. A privately supplied authorised real VIN
is only a prerequisite for an optional later live check, not for this offline capability. No live check was run.

## Dependencies and guarded requests

The minimum explicit backend dependencies are `{ transport, guard }`. Optional dependencies are
`clock`, `keyHandling: { encrypt }`, `decodeManual` and `timeoutMs`.
The existing FUCQ-43 identity guard checks entry, then checks the exact VIN and locale again before each key,
requested manual and alternative manual request. The trusted context is passed through the wrapper to the
private provider. UK-English fallback requires its own current authority for `en-GB`; approval of the requested
locale alone grants no additional locale permission. Registry misses still require independent real-identity
and purpose authorization. Synthetic primary providers retain their zero-external-call and no-live-fallback rules.

Transport receives `{ method: 'GET', url, signal, redirect: 'error', maxResponseBytes }` and returns
`{ status: number, body: string | Uint8Array, redirected?: boolean, url?: string }`. It must enforce the supplied
byte limit while reading, honour abort and refuse redirects; provider validation independently rejects excess
body bytes, non-200 responses, redirected responses and changed returned URLs. Injected transport implementations
own their own logging and resource lifecycle; this module cannot sanitize logging performed inside a caller’s
transport. Activation needs a separately reviewed transport satisfying these obligations.

The only constructed sources are the fixed `https://baonline.bmw.com/digital/v4.0/key` and
`https://baonline.bmw.com/digital/v4.0/manual` paths. The manual request contains only base64url `encryptedVin`
and an explicit lowercase language-region locale. No source-returned URL, alternate endpoint, redirect,
PDF/cosy route or arbitrary retry is followed. A fresh key is obtained on every resolve, with no cache.

The default whole-operation and per-request ceiling is 1,500 ms, configurable from 1 to 30,000 ms. The outer
adapter bounds the total operation as well as aborting pending requests. Key/manual response limits are 16 KiB /
256 KiB. At most one requested-locale manual request and one source-offered `en-gb` alternative are made;
unknown/missing alternatives, another language or region, and already-requested UK English cause no retry.
Only `MANUAL_NOT_AVAILABLE` and `UNSUPPORTED_LOCALE` responses can offer that alternative. The same encrypted
identity is retained between the two manual attempts. Contradictory safe nonempty derivative or brand metadata
between those attempts is an identity mismatch; absent values remain unknown. Guard denial or timeout prevents a late fallback.

## Evidence-backed operations and provisional metadata mappings

The 1 November [redacted research](evidence/fucq-4/drivers-guide-native-2026-11-01.json) establishes the routes,
`publicKeyData.pem` as base64 DER/SPKI, RSA PKCS#1 v1.5 encryption, `MANUAL_NOT_AVAILABLE` / `OK` observations,
the material locale difference, and the named title (`carName`), derivative, brand and handbook disclaimer content.
It does **not** retain a complete wire schema, exact interface enum values, the location of the algorithm
declaration, content containers, returned locale or locale-availability field paths. This implementation therefore
requires no invented `interfaceVersion` field or enum and does not assume a `manualData` source container.
Unknown interface metadata is safely ignored.

Key validation requires `publicKeyData.pem` as canonical base64 DER/SPKI and at least one `algorithm: 'RSA'`
declaration at the root or within `publicKeyData`. If both declarations are present, both must be `RSA`;
contradictory, malformed, OAEP, PSS or other declarations fail closed. These are the explicitly supported declaration
placements, not a claim that both were observed. Any supplied root application status must be `OK`; numeric 422
and unknown values are application failures. An absent key status is accepted only when the known key schema and
actual crypto checks validate, because its exact application schema was not retained.

Actual decoded key type must be unrestricted RSA with a 2,048–4,096-bit modulus, even when encryption is injected.
Canonical SPKI round-trip rejects extra DER content. Keys over 1,024 decoded bytes, PEM text, malformed base64,
RSA-PSS, other algorithms and smaller/larger RSA keys fail closed. Default encryption uses Node RSA PKCS#1 v1.5
then base64url. No key material is embedded or persisted; injected encryption returns modulus-sized ciphertext bytes.

Manual HTTP and raw root application status are validated before any decoder runs. The observed statuses `OK`
and `MANUAL_NOT_AVAILABLE` are supported. `UNSUPPORTED_LOCALE`, `VEHICLE_NOT_FOUND` and `SERVICE_UNAVAILABLE`
are explicit offline mappings, not additional claimed upstream observations. Unknown or missing application schema
fails closed; HTTP 200/application 422 never succeeds. A decoder cannot override HTTP/application outcomes.

The default parser projects only these named fields directly from the raw envelope: `locale`, `availableLocales`,
`carName`, `derivative`, `brand`, `handbookDisclaimer`, `sections` and `links`. This is a minimal root-field mapping,
not a complete verified upstream schema. Bare `{ status: 'MANUAL_NOT_AVAILABLE' }` returns `no-guide` without
requiring metadata, invented containers or a returned locale. `OK` requires at least one recognized metadata
property (`carName`, `derivative`, `brand`, `handbookDisclaimer`, `sections`, `links`) to distinguish a supported
partial payload from an unknown container. Invalid/missing field values stay unknown; no metadata completeness
or vehicle equipment is inferred. An `OK` response with no recognized metadata is `invalid-source`.

If a returned `locale` is supplied, it must match the exact attempted lowercase locale. Missing returned locale
remains `resolvedLocale: null`, including after fallback; requested locale is always retained. Only the explicitly
returned `availableLocales` list can offer `en-gb`. Container and locale-availability mapping remain provisional.

An optional `decodeManual(data)` dependency makes another provisional source container mapping explicit. It receives
the parsed response privately in memory and returns the same small field schema; raw response identifiers are
checked before it runs and decoded identifiers are checked afterwards. A thrown decoder, non-object result,
unsupported `OK` shape, excessive decoded size or depth produces a fixed safe failure. Decoders may be synchronous
or return a promise; the whole-operation timeout still applies. The focused fixtures explicitly inject this example:

```js
const decodeManual = (data) => data.manualData;
// A fictional transport response used only by the tests:
const responseBody = {
  status: 'OK',
  manualData: {
    locale: 'en-gb', carName: 'Fictional handbook', derivative: 'Fictional reference', brand: 'BMW',
    handbookDisclaimer: 'Non-binding additional service. Described equipment may not be fitted.',
    sections: [{ title: 'Getting started' }],
    links: [{ label: 'Handbook', format: 'pdf', availability: 'available' }],
  },
};
```

This example container is fictional and does not silently become the default BMW schema. Sections/links are capped
at 64/16. Local opaque section/link references replace returned identifiers; unknown fields are dropped. Successful
metadata stays `partial`, since this subset does not establish complete handbook coverage. Optional later approved
live verification can refine the decoder and locale paths; it is not a blocker for the tested offline capability.

## Safe outcomes and presentation

The shared wrapper adds `requestedLocale`, `resolvedLocale` and an allowlisted `failureDetail`, retaining the
existing `locale` as the requested locale for compatibility. `no-match` is a distinct additive status.
`MANUAL_NOT_AVAILABLE` maps to `no-guide`; an unsupported locale stays `unsupported-locale`. Numeric application
422 and unknown application values never become success, even with HTTP 200. HTTP errors, application errors,
timeout, transport error, invalid source, oversized response, identity mismatch and locale mismatch retain fixed
enumerated diagnostics. No upstream error message or HTTP status text is returned.

Response VIN identity fields, when present, must match the request. A mismatch is a safe failure, never a model
or VIN substitution. Projection drops unknown identifiers, URLs, query/hash routes, markup and controls. Known
request/encrypted/returned identifiers and identifying fragments are rejected in displayed text. Inputs and raw
responses remain local to the operation; results, errors, console output and retained evidence contain no full,
suffix, partial or encrypted VIN, response identifier or private URL. There is no logging, tracing or analytics
sink in the provider; caller-owned transport logging is outside that assertion.

The FUCQ-43 provider/source labels, metadata-only links, disclaimer and unknown-equipment semantics remain.
Missing/unsafe disclaimer remains unknown and partial, with the presentation message retaining the equipment
warning. Paint, wheels, installed equipment, build date, connected usage and scheme eligibility stay unknown;
independent current-car facts survive success or failure. No new policy assumption or policy source is needed.

## Validation and visual rationale

Focused offline coverage lives in `server/test/bmw-vin-guide-adapter.test.js`: guarded entry/key/manual/fallback,
fresh generated keys, private PKCS#1 v1.5 padding/decryption checks, bounded locale attempts, independent HTTP /
application outcomes, malformed/unsupported key and JSON inputs, returned identity mismatch, hostile metadata,
throwing sources, timeouts/late completions, privacy and the presentation invariants. Ciphertext, keys and
synthetic identities are held only in memory; assertion failures use fixed safe messages for private comparisons.

This story adds no screen or user interaction. The approved body reference remains revision `a7fc178` in
[evidence/fucq-6/README.md](evidence/fucq-6/README.md); supplied GCSP screenshots retain header/sidebar/palette
authority, with Used Cars body direction and shared `COMPONENTS.md` reuse for a future consumer. Metadata,
disclaimer, independent facts and unknown-equipment assertions replace new screenshots for this backend-only
slice. A consuming screen still needs the separately refined desktop, narrow and keyboard acceptance gates.
