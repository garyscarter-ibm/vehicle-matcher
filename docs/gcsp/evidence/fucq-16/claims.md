# Live catalogue claims record (FUCQ-48)

Date: 9 November 2026. Three kinds of claim are kept apart here. None of them may be read as another.

| Claim | Status on 9 November 2026 | Evidence | What it does not show |
| --- | --- | --- | --- |
| 1. Observed unsupported demo access | Observed, 1 November 2026 | [bmw-interface-research.md](../../bmw-interface-research.md), "Follow-up: public website key replay": selected UCP reads returned 200 with the public configurator website key and 401 without it | Anything after 1 November, quotas, other models, terms of use or BMW support |
| 2. Authorised live demo proof (FUCQ-48 AC2) | **Not executed. AC2 unmet.** | None. Precondition: live run not executed, it needs the user's direct go-ahead in the session that runs it ([runbook](live-verification-runbook.md)) | Not applicable until a `--live` run passes |
| 3. Supported production integration | **None** | No BMW-issued access, agreement or dated export exists | Must not be inferred from claims 1 or 2 |

## What the offline proof covers

`node --test server/test/verify-live-catalogue.test.js` drives the harness with injected transports only (`evidenceClass:
offline-mock`). It proves the harness's own behaviour: ledger before every request, the cap, the stop conditions, refused paths,
redaction, the CLI's refusal of argument secrets, the plan-only default, and these story criteria in fixture form:

- AC3: a controlled G21 T3MQ request resolving to T3SK petrol is `identity-mismatch` after the matrix and solver reads, with the
  modelCode difference shown, no option or OTD read and no technical value known. It is never a pass. The live source is not asked
  to reproduce the historical substitution.
- AC4: a source failure for the snapshot identity gives `source-unavailable` with a labelled snapshot choice that is
  `automatic: false`; for another identity it gives the unavailable label and no choice. Neither report nor ledger holds the key,
  a URL or upstream body text, every request is a GET, and no garage, share, telemetry or eligibility field appears.
- AC6: importing the harness, or running it without `--live`, sends nothing; no npm script, server module or workflow reaches it;
  the default provider is the snapshot and makes no transport call.

**Offline mocks alone do not satisfy the live positive criterion (AC2).** An offline `pass` shows the comparison logic works on
fixtures shaped like the 1 November evidence. It says nothing about BMW's current responses.

## Limits that stay true even after a live pass

A passing live run would show one exact, constructible configuration with evidenced values on one date through the unsupported
demo route. It would not show quotas, rate limits, other models, catalogue reliability, production support or any entitlement, and
the operation policy values ([operation-policy.md](operation-policy.md)) would remain assumptions until observed.
