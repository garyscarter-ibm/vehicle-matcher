# Stock sampler execution and privacy boundary

`scripts/gcsp/sample-stock-locator.mjs` is an offline preparation tool. Importing it or running it without
`--execute` makes no requests and writes nothing. It has no runtime caller. No accepted FUCQ-77 demo plan
was available when this boundary was implemented on 6 November 2026. No live sample or observed aggregate
is supplied by its tests.

Execution requires all three CLI arguments: `--execute --plan <persisted-plan.json> --output <aggregate.json>`.
Do not execute until the actual FUCQ-77 plan has been accepted and the exact model/source request specification
has been reviewed. The JSON contract below describes required fields; it is not an execution plan or approval.

The following F77 acceptance envelope is a **proposed adapter contract awaiting the actual FUCQ-77 plan**,
not an existing accepted interface. Its mapping must be agreed against the actual accepted artifact before live use.
The execution plan has `kind: "accepted-f77"`, `fixture: false`, an integer `maxRequests` between 1 and 400,
`concurrency: 1`, `retries: 0`, and a nonempty `models` array. Its `f77` object names a repository-relative
`docs/gcsp/…json` acceptance artifact in `reference` and binds its exact bytes through `sha256`.
That artifact must contain `kind: "fucq-77-demo-plan"`, `issue: "FUCQ-77"`, `status: "accepted"`, the
collaborator's `acceptedBy` display name, `acceptedDate` in YYYY-MM-DD form, and `modelLines` entries containing
the exact accepted `modelLineId` and `title` pairs. Both sets must match completely. This machine-readable
acceptance envelope records a collaborator's actual decision; populating these fields does not establish consent.
If FUCQ-77 publishes a different artifact structure, agree its mapping before execution. No acceptance record
has been invented or checked in for this work.

Each plan model contains `modelLineId`, `title`, reviewed `colours` and `upholsteries` display-label allowlists,
and a finite ordered `requests` array of complete URLs. The first URL is HTTPS `/results` at `stock.bmw.co.uk`;
subsequent URLs are HTTPS `/results/more` on that same origin. Credentials, fragments, other hosts and detail
routes are rejected. Review query parameters against the source model selected by FUCQ-77: the sampler does
not guess source model IDs or generate queries. The total listed requests must fit the plan budget before
the first request. Request lists and labels are copied before asynchronous work so caller mutation cannot widen
the validated plan. A model stops at its first `finished: true`; a missing final marker rejects the entire sample.

Model IDs use lowercase letters, digits and hyphens, start with a letter, have at most 40 characters, and cannot
contain seven consecutive digits. Titles and category labels use readable letters, spaces, apostrophes, hyphens,
slashes and parentheses, with at most 80 characters and 24 characters per word. Source category text must match
a reviewed label exactly; unexpected or malformed labels reject the sample with `source-invalid`. This keeps
arbitrary source identifiers out of output even when supplied in a display field. Missing categories have explicit
unknown counts. Add a legitimate new label to the reviewed plan rather than silently retaining arbitrary text.

The report contains only `sampleDate`, `requestCount`, `evidenceKind`, `models`, the static `source` label
`BMW UK new-car stock locator`, `planDigest`, and `f77`. The digest is SHA256 of the validated, projected plan,
including its finite request specification; the raw plan and URLs are omitted. `f77` contains only the bounded
accepted reference and SHA256 digest, or null for a fixture. Each model contains its planned
identity/title, its own `sampleDate` and actual `requestCount`, `carCount`, colour/upholstery `{label,count,share}` arrays, category `unknownCounts`, lead-time weeks,
delivery-date spread, and a GBP price band. Shares divide by all observed cars, so unknown cars do not silently
inflate known shares. Ranges contain `min`, `max` and `unknownCount`; absent bounds remain null. A partially known
lead-time pair contributes any known bound and increments its unknown count. Malformed dates, unparseable prices
and invalid week bounds remain unknown; a reversed week pair is entirely unknown. Prices accept finite nonnegative
numeric GBP values up to £1m or plain numeric/GBP/£ strings with valid thousands grouping and up to two decimal
places. These numeric/size bounds protect parsing; they do not define scheme policy.

No car record, source identifier, dealer, image URL, response body, request URL or caught exception text enters
the report or logs. Pages are reduced one at a time. Requests use redirect refusal, omitted credentials, no cache,
a maximum 15-second timeout, a 1 MiB page cap, a 16 MiB total body cap and at most 1,000 cars per page. There are
no retries. HTTP 401, 403 and 429 stop immediately without reading their bodies or making subsequent requests.
Other transport, redirect, size, parse, incomplete coverage or budget failures also prevent publication. Errors
are fixed generic codes. A complete report is written to an exclusive temporary sibling with mode 0600, then
atomically renamed to the explicit JSON destination. An existing report is unchanged when sampling fails.

For offline tests only, `kind: "fixture", fixture: true` requires an explicitly injected synthetic `fetchImpl`.
The CLI always rejects fixture plans. Such reports say `evidenceKind: "synthetic fixture"` and cannot provide
observed-aggregate evidence or FUCQ-77 acceptance. The pure `createAggregate` and `accumulatePage` exports permit
testing reduction without a transport; tampered aggregate state and unknown output fields are rejected.

## Proposed canonical-policy handoff, held for real evidence

Canonical publication remains held. The current policy validator permits `assumed` and `verified` statuses;
it does not accept the story's `observed aggregate` status. This sampler does not edit the shared policy seed,
invent observed values, create another loader, or label a fixture as verified BMW evidence. The parent story owns
the validator/publication agreement and actual PolicyService integration.

The proposed normalized value for each `stock.aggregate.<modelLineId>` entry is:

```text
{
  modelLineId, carCount,
  colourShares: { <reviewed label>: <share> },
  upholsteryShares: { <reviewed label>: <share> },
  leadTimeWeeks: { min, max },
  deliveryDateSpread: { min, max },
  priceBand: { min, max, currency: "GBP" },
  sampleDate, requestCount,
  sourceKind: "observed-aggregate"
}
```

The synthetic counterpart must use `sourceKind: "synthetic-fixture"`. Convert only reviewed array labels and
their shares into maps; preserve the planned model identity. Reject canonical conversion when category unknown
counts or any range unknown count are nonzero, required ranges are null, or a model has no observed cars.
Do not renormalize incomplete coverage silently. Carry the static source label, plan digest and accepted F77
reference/digest into the entry's provenance, alongside its basis, source date and the agreed policy status.
Per-model request counts come from the model entry, rather than duplicating the whole sample count for every model.
This shape is a documented proposal for later publication, not an active policy source or a claim that those
keys are currently publishable.

Scoped validation is `node --test server/test/gcsp-stock-sampler.test.js`, run through the resource supervisor.
All cars are tiny inline synthetic objects. No car-level fixture file, dependency installation, live request,
browser action, canonical seed edit or full suite is needed to exercise this boundary. Live source completeness,
accepted-plan identity and later central-policy publication remain separate acceptance evidence.
