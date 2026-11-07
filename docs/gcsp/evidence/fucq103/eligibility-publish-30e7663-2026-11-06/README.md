# Lead-audited publish15 proof, 6 November 2026

At tested revision `30e76636e1c363fe32c786f8d956d7f5608f556f` (evidence-only after
the `f80fc61` product/test freeze), the once-granted `eligibility-publish` selection
passed **15/15** cases in `server/test/gcsp-greg-publish.test.js`, the whole file with no
name filter, with zero suites, failures, cancellations, skipped or todo cases. The
[1,670-byte original SPEC log](test.log) is copied byte for byte. Child and supervisor
exits were 0. No completed mode was rerun.

Grant `fucq103-eligibility-publish-30e7663-1320` came from the Codex assist
assignment's conditional-once-per-chunk grant. An independent managed reviewer
(Foghorn Leghorn, opus/high) passed the exact command, the 219-source and dependency
closure, the assertions, the strict all-row ledger admission and all-outcome cleanup
before execution. The grant is consumed; there is no retry.

Limits. Every case uses the in-memory repository and policy store, not PostgreSQL.
All fixtures except case 8 use the helper's alternative privacy threshold 1; case 8
alone checks canonical threshold 5. Non-legacy fixtures override every preference
weight to a neutral 1. Case 10 uses a stub provider with synthetic candidates. Case 6's
forged-pin check asserts only a non-ok status. Case 9 calls route handlers directly
without HTTP registration, and case 1 is mainly a shape check. No HTTP listener, DOM,
rendered panel or actual producer journey was exercised.

Wall 9.38s; peak aggregate RSS 932.4MiB within 1024MiB; combined peak 4,348,416B;
scratch removal 4,338,401B. Three owned PIDs and group 17988 are absent, the listener
inventory is empty, scratch and worktree dependency paths are absent, and the ledger
reads `{}` with the exact token gone. The [concise index](index.json) binds the
originals by path, bytes and SHA-256. Root final collection is pending.
