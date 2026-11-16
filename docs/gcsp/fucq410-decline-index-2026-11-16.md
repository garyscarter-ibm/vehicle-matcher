# FUCQ-410 decline-history indexes — 16 November 2026

`DEV-2026-11-13-GC-003`, five points; branch `dev/DEV-2026-11-13-GC-003`.
Claim/base: `e352ce324399c00c3ac46593204290fe44090325`. Development is built for the isolated native Node boundary. The parent dispatcher owns worker publication, shared integration, Jira and acceptance.

## Scope and implementation

The original acceptance and `validate` remain unchanged in the Story. Existing snapshot rows, `intent()` and `inputDigest()` permit independent preparation work; no interface or database prerequisite is missing. `AGENTS.md`, the demo brief, build rules, experience contract, technical-readiness direction, shared contracts, `COMPONENTS.md` and `screens/README.md` govern this change. The latter visual-reference path is relative to this document's directory.

Only `server/gcsp/allocation/index.js` changes in production. Each preparation now builds offer-ID-to-car references, employee/car decline histories and employee/version prior-brief lookups. Nested Maps preserve opaque IDs without delimiter collisions. Duplicate offers retain every matching car; duplicate prior briefs retain the first source row, including draft/legacy rows. Decline lists preserve history order. Strict version comparisons retain numeric/string/null/missing distinctions and never match `NaN`.

Intent digests are calculated lazily once per relevant brief object in that preparation. An unrelated malformed brief is not hashed. Missing history still excludes immediately, and a malformed earlier matching brief still produces the existing `allocation-source-invalid` failure before a later missing-history row. No source rows, provenance, preference capture or history are rewritten. No cache survives preparation. Ranking, complete fallback contenders, occupancy, quote construction, conditional claims and receipt replay remain on their existing paths.

The new focused module uses the actual allocation service and fixture, replacing only snapshot reads to represent duplicate and legacy history that current writes cannot create. Its independent oracle retains the former filter/some/find expression. It checks exact employee/car exclusion, first duplicates, provenance-only changes, preference changes, includes-list set order, missing/legacy versions and ordered malformed-history failures. Synthetic growth uses 12 history rows/two cars and 24 rows/eight cars. Each observed decision/offer/prior-version field-read count remains at most three times history size despite the larger car pool; each relevant prior intent is read once. These are operation bounds at the changed history boundary, not whole-allocator load or latency claims.

## Validation and acceptance

| Selected command | Result |
| --- | --- |
| `node --test --test-concurrency=1 server/test/gcsp-allocation-decline-index.test.js` | 5 passed; 0 failed/skipped |
| `node --test --test-concurrency=1 server/test/gcsp-allocation.test.js` | 23 passed; 0 failed/skipped |
| `node --test --test-concurrency=1 server/test/gcsp-second-offer-policy.test.js` | 9 passed; 0 failed/skipped |

The 37 distinct checks passed against one frozen input identity. Existing cases retain deterministic winners, first-visible stock rows and quote provenance, conflict/stale fallback, event replay, uncertain-claim resume, repaired-source retry, absent dependencies, no assignment and canonical second-offer policy. Lead reviewed the complete production/test diff, the preparation caller, first-match/order/failure semantics and the focused oracle before accepting both planned slices. `git diff --check` passed. This is explicit scoped-command evidence; no full-suite stamp is claimed.

- AC1: supported by unchanged-intent/provenance oracle cases and the existing real allocator decline case; input history remains deeply equal.
- AC2: supported by changed preference, missing/legacy/strict version and malformed ordered-history cases; existing second-offer validation remains passing.
- AC3: supported by preparation-local indexes, replacement of all three full-history scans in the car loop and bounded operation regressions.
- AC4: existing presentation contracts are preserved: there is no screen, copy, response shape, offer state or provenance change. The original `validate` explicitly exempts isolated internal computation from new screenshots. No new rendered inspection was allocated. The tracked FUCQ-409 delivery record preserves the prior desktop/narrow release/offer/history/no-match/conflict/replay observations from 13 November; those are historical observations, not a fresh inspection of their externally stored artifacts. Connected visible changes would still require the original rendered gate.

No full suite, load run, build, browser, Java/Angular campaign, external email or native PostgreSQL process was run. The change neither alters SQL nor introduces a new repository boundary; memory fixtures do not establish native PostgreSQL or live BMW acceptance. No original internal-computation criterion remains open. Shared integration and collaborator acceptance remain separate.

## Runtime identity and retained evidence

All paths below are local to this Story worktree, under `.claude/`. No OneDrive location was accessed, including for cleanup or verification.

The finite supervisor is `fucq410-runtime-20261116-a02/run.py`, SHA256 `3eac9eff5f54554e4c185e25d0644258d8b6a469e863360e167d9b6ea8e4d2a9`. It selects the three commands before allocation, pins and copies 245 source/config/installed-package/Node/native-library inputs (128,994,882 bytes), and verifies original and frozen bytes after the run. Native Node is the installed 26.5.0 binary; `pg` 8.23.1 and its installed transitive package bytes are copied, without installation or a borrowed `node_modules` link. System libraries remain supplied by the macOS shared cache. HOME/TMP/cache and test inputs are owned. The original source tree and installed packages are preserved.

| Tested input | SHA256 |
| --- | --- |
| allocation/index.js | `870788b5c71fd6f2281b2af41c36a099d4fc3028467f2e3d3a638e0b5b6eabaf` |
| focused decline-index test | `e624ef094f73eb40ba29c4d475da4fe02dfa4ad5a31d63a8f66635f23f067305` |
| existing allocation test | `60cd8c14ffb15b8277f84e0556d2ef7237576b4713dc26f6047f60c3c7bc46f9` |
| existing second-offer-policy test | `93b6e82d3bc2a4e53bd2dd47085524dbd6e8213edc8d92383dc786afdaad606c` |
| complete inputs.json | `e76dd5a71b7170b1e74914c07b079c152a3b92b3408e6393721b7da4950d8242` |
| supervisor receipt.json | `facf01e7e716a7a404b003a39e75c1653992066dc6225173018dc10ded113c7c` |

The outside ownership manifest and finalizer precede scratch creation. A canonical HostBudget reservation at `/Users/garycarter/.cache/agent-scaffolding/test-resources` granted 768 MiB disk and 1,280 MiB aggregate RSS, with a 2 GiB inclusive ceiling, 5 GiB free reserve, 480-second work/600-second total limit including 120-second cleanup, one worker and a cumulative 2 MiB retained-output cap. The run uses bounded streamed logs and independent teardown attempts.

Actual a02 elapsed time was 25.22 seconds. Sampled maxima were 129,771,520 bytes disk, 289,685,504 bytes RSS including the supervisor/observed descendants, and 419,452,928 bytes inclusive. Test output was 4,305 bytes. The supervisor retained 159,744 allocated bytes across both attempts at its final sample; subsequent compact audits/agent/impact receipts remain below 2 MiB. Sampling is not a continuous/native containment proof for transient or detached processes between samples.

The supervisor stopped/joined its children, found no remaining owned processes/listeners/groups, removed 129,615,872 scratch bytes at `/private/tmp/gcsp-f410-c8cec465a4274970a2d66ef22b5317e0`, and verified root and canonical reservation absence. An independent audit at 20:23 UTC verified the supervisor was gone, original pins matched, root/reservation/listeners were absent; one generic helper group result did not affirm absence. A complete direct process snapshot at 20:24:15 UTC observed zero rows for all three groups, retaining both observations. There is no remaining owned resource or cleanup issue.

Retained local a02 files: `plan.json`, `inputs.json`, `receipt.json`, `ownership.json`, `independent-audit.json`, `agents.json`, `run.py` and `chunk-1.log` through `chunk-3.log`. `fucq410-runtime-20261116-a01/` retains the earlier preparation failure: `CalledProcessError(1, ['/usr/bin/otool', '-L', '/opt/homebrew/Cellar/node/26.5.0/lib/libbrotlicommon.1.dylib'])`. It created no scratch, reservation or test process and ran no checks. A02 resolves `@rpath` dependencies relative to each referring library before the Node library directory; successful copied-runtime execution verifies this correction. No failed test was retried or concealed.

## Map, agents and handoff

Only FUCQ-410's authored map row changes; all 301 peer rows are unchanged. Existing verified associations with `allocation` and `offer-journey` remain intact; component definitions are unchanged. Stable slices are `decline-index` and `integration`, completed after lead review and the selected checks. The latter means this Story's scoped delivery integration checks, not shared-branch deployment or Jira acceptance. Worker observations/expiry are explicit; no activity is inferred from commits.

Grub 2 requested/selected/effective `gpt-6.1-sol` / `high`; Scooby Doo 2 requested/selected/effective `gpt-6.1-sol` / `medium`. No fallback or further descendants. Saved titles were independently read back, and effective model/effort read from exact dated session `turn_context` records. Scooby authored source/tests and the lead performed source review, runtime and cleanup review.

For the parent: review the unchanged visible-contract assessment and exact local receipts, then publish/integrate only into `gcsp-poc-dev` through the guarded workflow. The worktree's generic Git helper pushes only the base branch; the worker did not call that push. Retain needed small local receipts before any later worktree cleanup. Parent learning-log candidates are the corrected relative-library preparation failure and the non-affirmative generic process-group helper sample; neither is a product defect or new Story gate.
