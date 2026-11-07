# F59 interrupted batch continuation — offline validation

The existing collector now accepts an exact hashed predecessor, a distinct checkpoint and a fresh finite live allocation. It preserves prior admissions, records, caches, identities and spending, strictly recovers retained solver evidence, and never repeats a solver request already started. Missing responses become honest rejected work.

95 scoped offline checks pass (18 batch, 77 shared collector/session), with zero skipped tests and zero source requests. Prior red checks and final code/test identities are recorded in [validation.json](validation.json). The shared session, source/projector and binder modules are unchanged.

Each continuation still needs four explicitly budgeted bootstrap GETs to recover ephemeral live capabilities. Changed retained/fresh model or definition context stops before any new solve. This is functional explicit continuation, not proof of cross-allocation bootstrap-cache reuse, actual LIVE resumption, or all original F59 AC4. No Story acceptance transition follows this receipt.

Owned scratch, dependency link and reservation were removed by the supervisor and verified absent; measured peaks and external failure/coverage receipts are in the JSON receipt.
