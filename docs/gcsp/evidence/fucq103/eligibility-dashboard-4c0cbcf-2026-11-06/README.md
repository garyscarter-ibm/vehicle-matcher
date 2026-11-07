# Lead-audited dashboard3 proof, 6 November 2026

At tested revision `4c0cbcfcab52da9f6cf54a5cba743390dc1f7c7e`, the once-granted
`eligibility-dashboard` selection passed **3/3** exact cases in
`server/test/gcsp-greg-dashboard-data.test.js`, with zero suites, failures,
cancellations, skipped or todo cases. The [420-byte original SPEC log](test.log) is
copied byte for byte. Child and supervisor exits were 0. No completed mode was rerun.

Grant `fucq103-eligibility-dashboard-4c0cbcf-1230` came from the Codex assist
assignment's conditional-once grant. An independent managed reviewer (Doug the Dog,
opus/high) passed the proposal, name-pattern closure, static import closure and strict
all-row ledger invariants before execution. The grant is consumed; there is no retry.

The six other cases in the file were filtered out and stay **unexercised**: fixture
states/abort, `toDashboardView` banding/errors, gate and key labels, `outcomeToState`,
the HTTP adapter, and the em dash/inline-script scan.

Limits. Cases 1 and 3 use explicit alternative privacy threshold 1; only case 2 uses
canonical threshold 5, with one synthetic subject. Helpers confirm a brief through
BriefService but write stock, quote, hold, offer and decision rows directly, so no
actual producer journey is shown. The fixture comparison checks shape only (keys,
types, first array item, empty/null allowed), not numerical or semantic parity. No
HTTP, listener, DOM or rendered dashboard was exercised.

Wall 4.02s; peak aggregate RSS 989.5MiB within 1024MiB; combined peak 4,348,490B;
scratch removal 4,338,401B. Three owned PIDs and group 85924 are absent, the listener
inventory is empty, scratch and worktree dependency paths are absent, and the ledger
reads `{}` with the exact token gone. The [concise index](index.json) binds the
originals by path, bytes and SHA-256. Root final collection is pending.
