# Live catalogue operation policy (FUCQ-47)

Date: 9 November 2026. Status: ASSUMED.

The live catalogue route is an unsupported demo route that uses the public configurator website key. BMW publishes no terms, rate
limits or cache terms for it, and this is not a production entitlement. Every value below is an assumption chosen to be polite and
bounded, recorded in code as `BMW_LIVE_CATALOGUE_OPERATION_POLICY` (`server/vehicle-evidence/bmw-live-catalogue.js`, version
`bmw-ucp-operation-policy.v1`). No value has been checked against BMW's behaviour live.

## Policy keys

| Key | Value | Unit | Basis | Status |
| --- | --- | --- | --- | --- |
| `concurrency` | 1 | requests in flight, process-wide | Courtesy to an unsupported route; whole resolves queue behind one gate. | assumed |
| `attemptTimeoutMs` | 5000 | ms per request | Longer than a normal page-driven read; short enough to fail before a visitor gives up. | assumed |
| `maxAttemptsPerRead` | 2 | attempts | One retry, for transient failures only (5xx, timeout, transport error). | assumed |
| `retryDelayMs` | 1000 | ms | Short pause before the single retry. | assumed |
| `resolveDeadlineMs` | 20000 | ms per resolve | Worst case is bounded: at most 8 requests per resolve (4 reads, 2 attempts each). Queue time counts. | assumed |
| `rateLimit.defaultRetryAfterMs` | 60000 | ms | Used when a 429 has no usable Retry-After. | assumed |
| `rateLimit.minRetryAfterMs` | 1000 | ms | Floor for a stated Retry-After. | assumed |
| `rateLimit.maxRetryAfterMs` | 900000 | ms | Ceiling (15 minutes); a 429 is honoured as a cooldown with no request, and never retried inside a resolve. | assumed |
| `authRefusalHoldMs` | 1800000 | ms | 30 minutes. A 401 or 403 is never retried or looped; the provider refuses locally for the hold. | assumed |
| `cache.allowed` | true | boolean | Catalogue facts are reusable for one identical configuration. Set false to switch the cache off. | assumed |
| `cache.scope` | `process-memory` | scope | Never persisted; gone on restart. | assumed |
| `cache.freshForMs` | 600000 | ms | 10 minutes. A saved answer inside this window is served as fresh with no request. | assumed |
| `cache.expiresAfterMs` | 3600000 | ms | 60 minutes. Nothing older is ever served. | assumed |
| `cache.maxEntries` | 32 | entries | Bounded memory; the oldest entry is dropped first. | assumed |

Why the cache values: catalogue facts change on BMW release dates, not minute to minute, so a short freshness window loses little.
The 10 minute freshness bounds how long a visitor can see an answer without a recent read, and the 60 minute expiry bounds how long
a saved answer can stand in for a failed refresh. The retail stock feed's 5 minute TTL in `server/stock.js` was deliberately not
copied: it is a different source with different terms and it reflects stock churn, which the catalogue does not have.

## Failure taxonomy

| Code | Trigger | Retried | Hold or cooldown | Stale served | Snapshot offer |
| --- | --- | --- | --- | --- | --- |
| `source-not-selected`, `transport-unavailable`, `credentials-unavailable` | Provider off, no transport, no usable key | No | None | No | If the snapshot holds this exact identity |
| `source-failed` | Transport threw, redirect, unexpected status, unreadable clock | Once if the transport threw | None | Yes, if the clock is readable | If the snapshot holds this exact identity |
| `source-timeout` | Attempt or resolve deadline exceeded | Once | None | Yes | If the snapshot holds this exact identity |
| `source-server-error` | HTTP 5xx | Once | None | Yes | If the snapshot holds this exact identity |
| `source-rate-limited` | HTTP 429 | Never | Cooldown from Retry-After (clamped) | Yes, also during the cooldown | If the snapshot holds this exact identity |
| `source-auth-refused` | HTTP 401 or 403 | Never | 30 minute hold, no cache served | Never | If the snapshot holds this exact identity |
| `source-empty` | No models in the matrix | No | None | No | If the snapshot holds this exact identity |
| `source-invalid` | Unparseable, oversize or wrongly shaped body | No | None | No | If the snapshot holds this exact identity |
| `source-application-error` | Other 4xx, or an `error`/`errors` marker in a 200 | No | None | No | If the snapshot holds this exact identity |
| `live-not-found` | Model not in a non-empty matrix | No | None | No | No |
| `live-identity-mismatch`, `live-not-constructible` | Live data describes another identity or cannot be built | No | None | No | No |
| `invalid-request`, `unsupported-market` | Request fails validation, or market is not GB en-GB | No | None | No | No |

`live-data-expired` is a presentation code only: it is shown when a saved answer is presented at or after its expiry.

## Cache identity

The key (`bmwLiveCatalogueCacheKey`) is the JSON of the policy version, the OTD mapping version and the full lookup identity:
provider, provider version, schema version, source version, market, locale, catalogue, order, effect, production and tax dates,
model code, range, raw range, AG model, trim, the sorted option list and the sorted accessories with quantities. Option order alone
never changes the key; any other change misses. Only exact-identity successes (status `ok` or `partial`) are stored. Failures,
not-found, mismatches and not-constructible results are never stored. Callers receive clones, so they cannot change a saved answer.

## Freshness and labelling

Every live envelope carries `freshness`: `state`, `retrievedAt`, `freshUntil`, `expiresAt`, `cache` (`miss`, `hit` or `stale`) and
`policyVersion`. Order inside a resolve: validation and credential checks, auth hold (refuse, never serve cache), a fresh saved answer
(returned with no request, even in a rate cooldown), rate cooldown, then the four reads.

- Fresh: served as normal. A hit keeps the original retrieval time and date.
- Stale: if a refresh ends in `source-failed`, `source-timeout`, `source-server-error` or `source-rate-limited` and the saved answer
  has not expired, it is returned as status `partial` (never `ok`), `freshness.state: stale`, with `freshness.staleReason` holding the
  failure (and `retryAfterSeconds` for a 429). The presentation label is "Live catalogue, stale (unsupported demo route)".
- Expired: at or after `expiresAfterMs` nothing is served; the result is `source-unavailable` with null dates and freshness. A
  presentation given `now` at or after `expiresAt` shows `live-data-expired`, and a live answer with missing or invalid freshness is
  shown as unavailable, never as fresh.

## Snapshot choice

After a live failure that allows an offer, the provider asks the snapshot adapter (local, no network) for the same request. Only an
`ok` or `partial` result, which the adapter returns for an exact identity, produces an `explicit-snapshot-selection` descriptor with
the snapshot's provider, version, observed date and resolved identity, `automatic: false`. Otherwise `snapshotChoice` is null and the
envelope stays `source-unavailable`. The descriptor holds no facts; the snapshot is taken only by `selectBmwCatalogueSnapshot`, which
keeps its own provider, version, observed date and identity, and leaves snapshot mismatches as mismatches.

## Redaction and trace seam

Envelopes, presentation and trace events never carry the key, a URL, headers, upstream text or the solver state token. Trace events
(injected `trace`, optional, errors ignored) have fixed fields only: `request` (host, family, attempt) before every transport call,
then `response`, `retry`, `hold` and `cache` (`hit` or `stale`). FUCQ-48's evidence ledger should write from this seam.

## Open items

- All values are unverified against live behaviour. FUCQ-48 should observe real latency, 429 and Retry-After behaviour, and error
  body shapes, then revisit the table.
- The top-level `error` or non-empty `errors` application marker is an assumption, not an observed shape.
- BMW may refuse or rotate the public key at any time; the provider then holds for 30 minutes and the snapshot stays the default.
