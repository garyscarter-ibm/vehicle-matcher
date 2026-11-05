# Retail compatibility integrated validation

5 November 2026. FUCQ-21 / DEV-2026-11-04-001. This receipt records execution separately from the [independent expected-outcome review](retail-compat-independent-review.md). The change adds tests and evidence; production sources, scoring settings and dependency declarations are unchanged by this story.

## First integrated checkpoint and selected checks

- Branch: `dev/DEV-2026-11-04-001`.
- First integrated HEAD: `fb3711808c3a5a8ff541bf085637763f54394201`; tree: `a16efdbcd83c8448fe213fa00c757e01c8793b99`.
- First integrated base: `61f4c82a59fe4eb8ee94110f70acc0484d0c379c`. The later executable identity integration is recorded as a separate final checkpoint below.
- Test code identity: `b86733f6a6066ac3adbbed249ac858b150afccb6188f1af5583d49ff59c1771f`; Node `v26.7.0`; npm `11.19.0`; Python `3.14.7`; default variant.
- `TASTE_SHARE` has no environment override and retains its captured default `0.2`.
- Input SHA-256: `05ec09609fc1c5707c92a0e7e8ad80335dc4ffac6859985f3fb18953c824c0d5`.
- Expected SHA-256: `140db30fe605e364d4b88f2143e770a8ad9195f014f2f08d6bf64a732c9447ea`.

The selected regressions protect mapping, ranking, exact identities, grouping, explanations, endpoint limits, questions, answer restoration and full-pool manual filtering. The existing render command checks the related client mounts. A full `npm test` run is an explicit story requirement; the passing scoped checks alone do not replace it. Live feeds, deployment, product repairs, retuning, new screenshots and raw parser coverage for the four mapped-only brand slices are excluded.

All commands ran from the worktree root through `python3 -B _tools/test_stamp.py`. Targeted commands used `--targeted 61f4c82 --command '<command>' --reason '<scope>'`; full runs used `--full --command 'npm test'`. Each full run held the machine-wide nonblocking `full-suite.lock`. No two full suites overlapped.

| Gate | Command | Observed result |
|---|---|---|
| Scoped compatibility, invocation 1 | `node --test server/test/recommendation-compat.test.js` | 157 passed, 0 failed, 0 skipped. |
| Scoped compatibility, invocation 2 | Same command and frozen inputs | 157 passed, 0 failed, 0 skipped. |
| Scoped client mounts | `node --test server/test/render.test.js` | 39 passed, including exactly 30 six-brand/five-mode mounts; 0 failed, 0 skipped. |
| Initial full attempt | `npm test` | 418 total: 417 passed, 1 loader failure, 0 skipped. Missing installed `pg` prevented the repository contract file from loading. |
| Narrow check after setup repair | `node --test server/test/gcsp-repository-contract.test.js` | 39 total: 37 passed, 0 failed, 2 skipped. |
| Required full gate after setup repair | `npm test` | 456 total: 454 passed, 0 failed, 2 skipped. |

Each compatibility invocation itself replays all 78 records twice. Inputs, expected outputs and fixture manifest retained identical hashes, byte counts, inodes, modification times and change times across validation. No fixture or source file was rewritten.

## Missing dependency and recovery

The initial full attempt stopped at `ERR_MODULE_NOT_FOUND: Cannot find package 'pg'`, imported by `server/test/gcsp-repository-contract.test.js`. The integrated base already declares and locks this dependency; the test and package files are identical to that base. This worktree had no installed `server/node_modules`, so no repository assertions ran in that file.

The dispatcher authorised routine setup repair. `npm ci --prefix server --ignore-scripts --no-audit --no-fund --silent` restored the locked server dependencies, including `pg@8.23.1`, without source, package or lockfile edits. The runner recorded this environment change, checked the repository module first and then repeated the required full gate once. The failed attempt remains in the retained summary. Both skips in the successful checks are live PostgreSQL integration/constraint checks because `GCSP_DATABASE_URL` is unset; no live database result is claimed.

## First full stamp and its environment

The successful full run recorded stamp key `eb765352da323f49df8f33e1bd9b456a56b4e5d38f84a0a00f538cdecec92884`, default variant, at `2026-11-05T00:26:40+0000`. Its environment hash is `232c3166627255cffb701fbdf23fa7ab27e0c1f413e86982db277892730ffd09`. The lead independently inspected the stamp JSON and verified it with:

```sh
INTEGRATED_VALIDATION_SCRATCH=/Users/usget/Claude/vehicle-matcher/.claude/test-runs/scratch/fucq21-20261105-retail-baseline/integrated-validation python3 -B _tools/test_stamp.py --status --command 'npm test'
```

The launcher bookkeeping variable participates in the helper's environment hash. A bare `--status` without it reports no matching stamp; this does not invalidate the saved test output. The scratch path in the variable is an identity string and is removed during cleanup. No stamp was edited or extra suite run performed to change this context. The generic wrapper records unknown Node test counts as `ran: null` and `skipped: 0`; the actual Node output above is the authority for 456 total and two skips.

## Final checkpoint after identity integration

The shared base then gained FUCQ-84 identity code, including a production handler boundary and 19 tests. Reusing the earlier stamp alone would not cover that executable change. The dispatcher required a D1 merge and all prescribed checks again; later queue and closeout records were included without changing their scope.

- Final tested HEAD: `8bbab3ba333728f6da07e25d866c20d1a470872d`.
- Final tested tree: `56aa07fa44ca7252f379377651698e6d08c4b83f`.
- Final integrated base: `ca9dfcede2acdb3eff7539d7fdbf0d336d0fcdff`, including identity merge `358b284`.
- Final code identity: `b6175704dfaaa1577a1a051f76c509ad558aab2260d975caa37702874c37f448`.

Both targeted compatibility invocations passed **157/157**, with unchanged fixture identities. The targeted render command passed **39/39**, including all **30** mounts. The single full run on this combined tree reported **475 total, 473 passed, zero failed and two skipped**. The skips explicitly name absent `GCSP_DATABASE_URL`; they are the two live PostgreSQL checks. All four prescribed invocations used the concrete final base above, the same Node/default blend and the restored locked dependency environment. The full-suite lock was released after the run, and the equipment lead was notified.

Final stamp key: `345f0076c44bdd4b7bfd143708acdb61ace1076ad5926d579260a61e6c19bab8`, default variant, recorded `2026-11-05T00:36:07+0000`; environment hash `1d854a9de0dbcb2837992ce629540456ed496825959efb209d8b6805879fbb6a`. The final test subprocess omitted launcher bookkeeping from its environment. The lead independently read the final TAP totals and exact stamp JSON, then verified exit zero with the ordinary command:

```sh
python3 -B _tools/test_stamp.py --status --command 'npm test'
```

The runner also verified plain `--status` without a command override. Later documentation and Result edits preserve this code identity; no additional full run is justified by those edits. The earlier failed attempt and successful first checkpoint remain history, not evidence substituted for this final combined-tree result.

## Resources and cleanup

One validation command ran at a time, with 600-second supervisors and a 32 MiB expected scratch / 1 GiB RAM plan. The largest sampled supervised process-group RSS was **706,560,000 bytes**. The largest test-chunk scratch observation was **745,760 allocated bytes**; the dependency installation separately peaked at **2,944,864 allocated scratch bytes**. These are measured process-group/chunk values, not whole-host memory figures.

The lead verified absence of the owned root `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/scratch/fucq21-20261105-retail-baseline`, including `compat-capture` and `integrated-validation`. All ten tool-owned scratch roots and ten owned log roots were also verified absent. Directly measured capture/lead/log cleanup removed **3,088,224 allocated bytes**; the already removed tool shards separately record a sum of **1,849,888 bytes** across their individual peak allocations. Installed `server/node_modules` is the retained locked environment, not disposable scratch. No archive, large generated output, OneDrive output or compatibility exception was needed; no leftovers remain.

Concise machine receipts and the reviewed file/function-to-test map remain outside scratch:

- Parent receipt: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/ownership/fucq21-20261105-retail-baseline.receipt.json`.
- Capture receipt: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/ownership/fucq21-20261105-compat-capture-receipt.json`.
- Validation receipt and retained summary: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/ownership/fucq21-20261105-integrated-validation.receipt.json` and `.summary.json`.
- Final impact map: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/fucq21-integrated-b6175704dfaaa157.json`.

The map includes fixture, configuration, subprocess, shared-handler and client-mount boundaries with measured timing/RSS. The prescribed Node commands do not emit per-test V8 coverage contexts; no additional suite was run to populate them, and unobserved paths remain unknown. The runner's final response omitted its resource report and contained unrelated checkpoint information. The lead independently reconciled the actual TAP, checkpoints and stamp, then completed the impact record and cleanup without another test run. The concise initial-failure JSON retains the loader error and counts after verbose logs were removed.

## Review and remaining boundaries

The story lead independently approved the exact input/expected hashes before final execution. The capture implementer requested/selected `gpt-6.1-sol` / `medium`; the lead requested/selected `gpt-6.1-sol` / `high`; the validation runner requested/selected `gpt-6-luna` / `high`. All selections used the authoritative tier tooling, with no fallback; effective runtime settings were not independently attested.

The [correction cases](retail-compat-corrections.md) remain future repair work. In particular, the narrow tourer explanation projection protects the surrounding decision while preserving the raw malformed-label evidence separately; its originating issue remains unresolved. No Jira defect or additional backlog scope was created. No rendered surface changed, so the agreed visual exemption applies.
