# FUCQ-134 shared completion clock repair

6 November 2026. Authoring authorized by root's local `fucq134-clock-repair-1304.md` brief, against published `57d8f1781eca0707994afa7eb26d26a8f4d15ff3`. Existing claim, branch and dispatcher remain. No descendants, runtime grant or retry. Agents: requested/selected `gpt-6.1-sol/high`, no fallback.

## Genuine passing cases, incomplete completion

The original run `first-chunk-1c224188912d4bdaa7abe82794c1ebaa` reports exact TAP tests3/pass3/fail0/cancelled0/skipped0/todo0. Node and controller exited0. All expiry assertions ran and passed in this run. Independent audit exited1 with `Controller start time is unknown`; the immutable receipt remains `passed:false`, `candidatePassed:true`, awaiting independent audit. Cleanup PASS is separate. Whole-story acceptance is not established.

Original shared test-runs evidence, preserved unchanged:

| File | SHA-256 |
| --- | --- |
| Run `test.log`, 17,852 bytes | `fb39a8c84d260b04d71d9299dfa455d212bb20e4e85718f1d27c805350a7b0c0` |
| Run `receipt.json` | `63847dbedd5b5806ef825243977cd16cec42d70a6443ba6fba1d54d3f1c712fd` |
| Run `checkpoint.json` | `b76620ca5c833eded76d2c942692086c6db5439594c88a4cd29e81a56bbcb60a` |
| `ownership/fucq134-39130fa8f3074636b49e306eed489d0a.json` | `654b5544cd43c56947b0b413f683b4f95aa33007e6854166dde76f55af3ede25` |
| `ownership/fucq134-02-audit-stderr-1301.txt` | `3cea867b96ccdf499a632891d09134ee6ebe0cd178b7a28b1da7b687c2b0a391` |

Claude's authoritative local report is `.claude/results/claude-assist-fucq134-2026-11-06-02.md`. Root independently confirmed the defect: the supervisor exported its process's `time.monotonic()` value, while the separate Python3.9 auditor compared it with another process's epoch. Root's two supplied local-monotonic reads were 0.02595325 then 0.020205125; the corresponding system uptime reads increased from 644804.17390475 to 644804.292801333. This author performed no clock read or new runtime probe.

## Small helper contract delta

The selected shared clock contract is exactly `{"kind":"CLOCK_UPTIME_RAW","platform":"darwin","units":"seconds"}`. Supervisor and auditor use `time.clock_gettime(time.CLOCK_UPTIME_RAW)` for the cross-process timestamp and elapsed deadline on the same host/boot. This is the nonadjustable system-wide uptime source selected in root's diagnosis; no calendar-clock or process-monotonic fallback is permitted. Other platforms, missing APIs, non-float/nonfinite/nonpositive readings, missing/different clock labels and future start values refuse completion.

- Supervisor captures `startedSharedSeconds` before its unchanged local interval origin and before admission/setup. It verifies the frozen clock label and imported completion helper's label, then includes the label in the provisional receipt identity and ticket. Plan-only does not read the shared clock.
- Completion accepts the new labelled timestamp, checks the same120-second overall deadline at audit entry, its resource check and after stdout flush, and labels its bounded completion output. Its existing three-second pipe-read interval remains process-local.
- All supervisor-local `time.monotonic()` intervals, recursive accounting, strict ALL-row ownership/reservations, finalizer, signals/joins, read/write guards, memory/disk reserves, output limits and required controller/audit exit0 remain. The added early overall-deadline refusal strengthens an existing bound; it does not extend it.
- The static freezer adds only the literal clock metadata. The two clock readers and three metadata literals match statically. No product/test/fixture, DemoClock, policy or shared resource helper changes. Legacy `startedMonotonic` tickets are not reinterpreted; changed helper hashes and the new mandatory clock fields refuse old tickets. Original evidence is never rewritten.

## Replacement pins

- Admission SHA-256: `1e6a0151cbd8ba8b1951fb02a8e0597b3821c651ad8ae5d57843f65e080f5104`.
- Source identity remains `92911cf980e13502fd897fb4a6b6f01be38b5477d691c865ced7b1437ecc81c9`: all45 sources /975883bytes /72 accepted edges unchanged,236 physical nodes.
- Supervisor SHA-256: `58973cd2e52c3d3eff8194795c877b5e2a863061c345d7e0644de2c8a27589ae`.
- Completion SHA-256: `8302181c22211fc7ce18c44d4013f583c3b4a47381533add977f9db1664c94d3`.
- Static freezer SHA-256: `b6c972882db06fc48fe165ae944ee76587d27b2a0a1a6fc52b0f9209e65ea7d3`.
- Strict resource helper remains `301cb06742ef1fe4fac4d35f63b7e6a1accbc3ac743a21a23b18a1c2a40e6a1c`; shared helper pins and all resource limits remain unchanged.

Only the static authoring freezer ran: it reads/hashes source inputs, imports the unchanged pinned Git adapter and writes admission data. Neither modified supervisor/completion helper was imported or executed. No plan-only command, clock read, test, reservation, scratch, service, browser or database was launched. Author static validation PASS: matching clock literals/readers, all45 source reuse, unchanged local timing/readers/resource gates, four ASTs, JSON/content pins,11 original evidence hashes and documentation/diff checks. This supports authoring only. No screen or user-visible product behavior changes; no visual acceptance claim.

## Next finite validation, deferred

1. Independent consequential review of these exact helper bytes, clock labels, initial timestamp ordering, unchanged local intervals and safety gates, replacement admission and original evidence. Reuse the unchanged genuine3/3 product evidence without relabelling the failed audit.
2. Only with explicit root authorization, a separately owned sequential two-process clock semantic check using the pinned Python and labelled helper API: at most10seconds total,3seconds per child,8KiB output, within the existing resource/cleanup contract. Verify comparable increasing readings and finite nonnegative elapsed time, and refusal of unsupported clock labels/platform/API and invalid/future timestamps. No new helper mode or fallback. This check has not been authored or run.
3. After current admission and a new once-only grant, the existing controller/independent-audit protocol can validate the changed helper boundary with exactly `isolation`, `real-claim-review-allocate`, `untaken-expiry`. Require exact three-case TAP, actual Node/controller/audit exit0, bounded complete stdout, final tool wait and independent cleanup. Use the replacement admission above, not a consumed grant. No prior ticket can complete this new run.

Existing bounds remain120seconds whole/110execution,768MiB aggregate RSS,128MiB combined output/scratch,2MiB log,5GiB emergency reserve, one worker and unchanged completion margins. Root owns admission, grants, resource collection, merge and closure. No full/upstream/native/live/corpus/route/cache/outcome or whole-story acceptance follows. Earlier0/3/gradeUNKNOWN,2/3 and parser failures remain historical and distinct.
