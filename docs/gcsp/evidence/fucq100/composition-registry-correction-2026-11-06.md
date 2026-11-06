# Composition registry correction

The composition test still expected the five handlers installed before ordering,
approval and document services were connected. Current startup additionally
registers `selection-order-reconciliation`, `lifecycle-approvals` and
`lifecycle-documents` before sealing the clock.

The test now checks all eight handler names, their stages and registration order.
It repeats the three additional services' startup methods alongside the existing
ones, checks that no duplicate registration occurs, and checks that a mechanics
reset retains the complete registry. Assertions that startup releases no stock,
that old employee authority becomes stale and that missing fresh-run inputs fail
truthfully are retained. Production behavior is unchanged.

Validation for this checkpoint is source inspection against `buildServer` and the
eight registration declarations, plus `scaffold_git` diff/whitespace checks.
No Node import, syntax check, test, browser or database command ran for this change.
This checkpoint is not runtime acceptance or a full-suite stamp.

The next selected checks are the existing registry/memoization and mechanics-reset
cases in `server/test/gcsp-runtime-composition.test.js`, followed by any affected
connected acceptance and the authored `npm test` requirement. The existing frozen
runtime catalogue contains the previous test hash; refresh the exact candidate
identity and apply the established bounded resource/cleanup contract before running.
Earlier HTTPS and module proofs remain evidence only for their original scope;
their consumed execution grants are not renewed by this correction.
