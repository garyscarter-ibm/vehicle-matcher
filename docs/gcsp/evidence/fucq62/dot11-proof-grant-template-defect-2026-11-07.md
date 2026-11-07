# Deferred proof grant-template mismatch

Origin: FUCQ-62, `.11` proof packet prepared 7 November 2026. Recommended severity Low: the helper emits one invalid parent grant entry and supervised preflight refuses it before any child, scratch, dependency link or reservation allocation; no product data or runtime behavior is affected. Backlog Bug link is pending parent triage; this note does not claim a Bug was created or the defect repaired.

Actual reproduction reported by parent: `prepare-grant.py` adds the frozen ordinary activation receipt `.../ordinary/receipt.json`. Supervisor line49 filters prior receipt pins to basenames ending `-receipt.json` or `offline-proof-summary.json`; plain `receipt.json` is excluded. The first publish preflight therefore raised AssertionError. Only an empty invocation log and parent grant metadata were created; parent preserved that failed preflight identity.

Parent explicitly deferred this belowHigh tooling defect and computed the exact supervisor-filtered list (`[]` for publish) for a new grant, leaving the sealed160codepins/proofplan unchanged. Later phases must compute the same literal supervisor filter. No proof replay, production repair, acceptance waiver or Storyscope expansion follows from this workaround. Keep the helper defect linked independently for later pickup.
