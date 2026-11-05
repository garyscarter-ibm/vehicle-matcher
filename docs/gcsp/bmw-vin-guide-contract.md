# Offline VIN handbook contract — FUCQ-43

Implemented 5 November 2026 inside the existing Node backend's `server/vehicle-evidence/` component. This is a replaceable content/illustration port, with explicit local synthetic input. It adds no HTTP route, second identity resolver, registry, database, scheme assumption, runtime dependency or live BMW provider.

The binding [brief](demo-brief.md), [build rules](build-rules.md), [experience contract](experience-quality.md), [canonical HLD](../design/gcsp-high-level-design.md#vehicle-evidence-and-adapter-contracts), [dated interface research](bmw-interface-research.md#5-vin-lookup-official-bmw-routes) and [synthetic registry](synthetic-vin-service.md) govern this module. Supplied GCSP screenshots retain shell/palette authority, with Used Cars body direction and shared-kit reuse for a future consumer. This backend-only change validates presentation projections; it introduces no screen and claims no new screenshot, live-provider or production proof.

## Selection and request

`createBmwVinGuideAdapter({ provider?, fallbackProvider?, guard?, timeoutMs? })` returns `resolve({ vin, locale }, serverContext?)`. No provider means `disabled`. Both provider selection and fallback are trusted server configuration. No environment variable or request flag activates a provider. Each selected provider supplies `{ id, version, sourceKind, resolve(request, { signal }) }`, with `sourceKind: synthetic | authorised-live`. Provider identity and source mode are captured together; request objects passed to providers are frozen.

Request validation accepts exactly 17 ASCII VIN characters, excludes I/O/Q, and uppercases letters. No trimming, seven-character shorthand, assumed reserved range, WMI inference or regional checksum creates identity or authority. Locale is explicit two-letter language and region, normalised to `en-GB` form. A valid unsupported locale stays `unsupported-locale`; no implicit language fallback occurs. The default content-operation timeout is 1,500 ms, configurable from 1 through 30,000 ms. Providers receive an abort signal and must bound their underlying work and stop it on abort; the adapter itself contains no transport or background worker.

`createSyntheticBmwVinGuideProvider({ vin, scenario })` binds a caller-supplied, explicitly fictional association from the existing synthetic allocator. It is content input, not identity discovery. Supported scenarios are `available`, `no-guide`, `partial`, `unavailable`; only `en-GB` is supplied. Metadata lives in `server/vehicle-evidence/fixtures/bmw-vin-guide-synthetic.v1.json`. It contains no VIN, upstream response, private URL or BMW-derived content. The provider opens no connection. A synthetic primary can never fall back to an authorised-live provider, even when a caller supplies otherwise valid real-lookup context. A provider switch creates a fresh adapter and receives the same transport guard.

## Result and presentation meaning

All results have schema version `1`, an explicit status/locale, source provider/version/kind/observation date, guide, illustration, per-section completeness, unknown physical facts, unknown equipment and a bounded attempt record. The normalized content input is `{ status, observedDate, guide, illustration, completeness }`; `guide` has optional safe title/derivative/brand/disclaimer, bounded `{ id, title }` sections and `{ assetRef, label, format, availability }` links. Full handbook completeness must be explicitly supplied; it is never inferred from an HTTP success or nonempty array. Missing, invalid or truncated metadata reduces completeness. Source exceptions and invalid responses become safe unavailable outcomes without retaining their messages.

| Status | Meaning |
|---|---|
| `disabled` | No provider explicitly selected. |
| `invalid-input` | VIN or explicit locale format invalid; provider not entered. |
| `available` | Explicitly complete handbook metadata with title, usable disclaimer, sections and link metadata. |
| `no-guide` | Valid request with no guide, distinct from source failure. |
| `unsupported-locale` | Requested language unsupported; no silent substitution. |
| `partial` | Some content available with missing/unknown or incomplete sections. |
| `source-unavailable` | Source, identity guard or timeout prevents a usable lookup. |

Link `availability` describes the returned metadata. This story supplies no documents or asset delivery route: projected links always carry `delivery: metadata-only` and `href: null`, so a consumer must not create a navigable link from the opaque `assetRef`. The illustration is explicitly `vin-linked-illustration`, fidelity `unverified`, with `available | unavailable | unknown` status. Its synthetic asset reference is a fixture marker, not a delivered image or exact-car photograph. Future authorised delivery is a separate consumer/asset concern.

Guide title, derivative, brand, sections, disclaimer and illustration never establish paint, wheels, installed equipment, build date, connected usage or scheme eligibility. Those six fields remain `{ state: unknown, value: null }`; equipment remains `{ state: unknown, codes: null, complete: false }`. No catalogue or October 2024 scheme join occurs. `presentBmwVinGuide(result, existingFacts)` returns the content section and a detached copy of independent current-car facts, including on source failure. It never promotes handbook claims into those facts or turns a failure into complete empty equipment.

No VIN is echoed in results, attempt records or errors. Normalisation drops unknown fields and all URLs, rejects markup/control characters and VIN-shaped metadata, and excludes the requested identifying suffix from displayed content. This does not authorize handing raw provider results to a browser: future live mapping and transport logging must preserve the project's stricter private-value/retention requirements before activation.

## Trusted identity seam and remaining FUCQ-19 boundary

`createBmwVinGuideIdentityGuard({ registry, authorizeExternalLookup })` reuses the existing `registry.classifyIdentity(vin)` port; it creates no persistent identity source. It runs before entering an authorised-live provider, before any key/manual/pdf/cosy operation, and again on every eligible fallback. Missing/malformed/unavailable registry classification, a known synthetic association, absent context or authorization failure returns unavailable without entering transport. Durable registry history keeps known synthetic identities blocked across deactivation, restart and publication failure. No positive permission is cached.

A synthetic-inventory `not-found / identityKind: unknown` result is only negative evidence. The independently injected `authorizeExternalLookup({ context, vin, locale })` must validate its own server-owned context, exact target/locale, current identity and explicitly authorized external purpose. It must return `{ status: ok, identityKind: real, lookupFlow: externally-authorised, authorized: true }` to permit entry. A browser JSON copy, valid checksum, registry miss, synthetic demo flow or unknown-registry lookup flow is insufficient. The existing DemoIdentity adapter owns opaque contexts and persisted access checks; its fictional employee/presenter roles do not confer real-VIN access. A future sanctioned identity adapter must supply this narrow authorization callback rather than invent another session or resolver here.

FUCQ-19's actual HTTP/consuming adapter is **unbuilt by this story**. It must inject the same registry classifier and identity-owned authorization seam, keep synthetic and unknown-registry flows non-forwarding, and exercise registry miss/outage, provider switch and fallback through its actual HTTP boundary. The offline adapter's passing tests do not establish that future integration. No provider deployment, live activation, key discovery or real/private VIN lookup was performed.

## Repeatable isolated service trial

Starting state: Node dependencies installed, no server needed, no credentials/configuration or persisted run changed. Run from the worktree root. The existing allocator creates a small explicitly fictional input in memory; it is never printed. Reset by running the command again: each adapter is new and no persistent handbook state exists. Do not replace the input with a real VIN.

```sh
node --input-type=module <<'NODE'
import { corpusInput } from './server/test/helpers/vin-corpus-fixture.js';
import { createBmwVinGuideAdapter, presentBmwVinGuide } from './server/vehicle-evidence/bmw-vin-guide-adapter.js';
import { createSyntheticBmwVinGuideProvider } from './server/vehicle-evidence/bmw-vin-guide-synthetic.js';
const input = await corpusInput();
const vin = input.allocationInventory.records[0].vin17;
const request = { vin, locale: 'en-GB' };
const adapter = (scenario) => createBmwVinGuideAdapter({ provider: createSyntheticBmwVinGuideProvider({ vin, scenario }) });
const results = [await createBmwVinGuideAdapter().resolve(request), await adapter('available').resolve({}),
  await adapter('available').resolve(request), await adapter('no-guide').resolve(request),
  await adapter('available').resolve({ ...request, locale: 'de-DE' }), await adapter('partial').resolve(request),
  await adapter('unavailable').resolve(request)];
for (const result of results) {
  const shown = presentBmwVinGuide(result, { paint: { state: 'known', value: 'Supplied scenario blue' } });
  console.log(JSON.stringify({ status: shown.status, message: shown.message, source: shown.source.kind,
    knownPaint: shown.currentCarFacts.paint.value, equipment: shown.equipment }));
}
NODE
```

Observed 5 November: the command produced the seven states in table order on both first run and reset. Each kept `Supplied scenario blue`; each kept equipment unknown, null codes and `complete: false`. The available record was labelled synthetic; no network, real lookup, document navigation or image display was exercised. Automated `server/test/bmw-vin-guide-adapter.test.js` additionally instruments key/manual/pdf/cosy entry points, validates safe completeness, and tests the actual registry's retained-history refusal. These are service/presentation trials, not screenshot or employee-journey acceptance.

Design evidence: the canonical topology already places this port inside the Node vehicle-evidence component, so no component, store or external connection is added. Root's read-only draw.io plugin check at 03:39 on 5 November returned `closed / tabs: []`. Diagram rendering, status recolouring and refreshed export inspection are unavailable; no open/new-tab/foreground/raw-XML workaround was used. Shared HLD/contracts prose remains with the parallel story's serialized owner.
