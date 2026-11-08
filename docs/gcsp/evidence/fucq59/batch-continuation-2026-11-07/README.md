# F59 interrupted batch continuation — offline validation

The existing collector now accepts an exact hashed predecessor, a distinct checkpoint and a fresh finite live allocation. It preserves prior admissions, records, caches, identities and spending, strictly recovers retained solver evidence, and never repeats a solver request already started. Missing responses become honest rejected work.

95 scoped offline checks pass (18 batch, 77 shared collector/session), with zero skipped tests and zero source requests. Prior red checks and final code/test identities are recorded in [validation.json](validation.json). The shared session, source/projector and binder modules are unchanged.

Each continuation still needs four explicitly budgeted bootstrap GETs to recover ephemeral live capabilities. Changed retained/fresh model or definition context stops before any new solve. This is functional explicit continuation, not proof of cross-allocation bootstrap-cache reuse, actual LIVE resumption, or all original F59 AC4. No Story acceptance transition follows this receipt.

Owned scratch, dependency link and reservation were removed by the supervisor and verified absent; measured peaks and external failure/coverage receipts are in the JSON receipt.

Independent review of `e08b63d4` found a High: a fresh continuation discarded durable refusal stops. The [follow-up validation](stop-review-validation.json) records its three-line allowlist correction, narrow red/green and 19/19 batch checks. HTTP 401/403/429, source refusals, substitutions, malformed shapes, generic source failure and unknown stops now reject before a new marker or request. The original 95-check receipt remains historical; 77 unchanged shared checks are reused with reviewed module/test/fixture identity.

Medium FUCQ-152 remains separately backlogged: different allocation IDs can fork one predecessor and repeat pending work. It is not repaired by this stop-classification fix or made a merge dependency. Use one selected continuation chain; actual live proof remains unexecuted.
