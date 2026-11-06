# Required npm test — 6 November 2026

**FAIL:627tests,564passed,63failed; no skips/cancellations/todo.** The exact `npm test` command ran once against integrated commit`ef777c365b1d9d9e9aeed20bba5a0a6a2eb2decd`, tree`8a8edc30e148715c48e3041fc2da9dce47314118`, after merging current base`ecce0b3`. Its existing Node script now includes`--test-concurrency=1`. Command and supervisor both exited1. Worker25.52s; whole supervised run28.95s. This is a failed required run, not a full-suite acceptance stamp.

57failures report missing`pg`:56file-load failures plus one named Greg publication integration case. Their behavioral assertions did not execute. The shared installed dependency inventory was present and unchanged; normal Node package resolution from this worktree did not find`pg`. No package installation, loader injection or credential access was attempted.

The other six failures are original assertions:

| Test location | Observed mismatch |
| --- | --- |
| gcsp-greg-dashboard.test.js:179 | Refused state expects0, observes1. |
| gcsp-greg-dashboard.test.js:377 | CSS scanner includes the new publish @import text in its unscoped-selector result. |
| gcsp-greg-publish-render.test.js:90 and98 | Focus/selected row is`price:gallery-cost`; fixtures expect`price:second`. |
| gcsp-shell.test.js:729 | Source-level location/history prohibition matches the adopted offer entry. |
| launcher-package.test.js:48 | Discovery selects actual`gcsp-offer.html`; fixture expects nested`blocks/gcsp/offer/preview.html`. |

These are observed mismatches. Product-vs-fixture/scanner cause and severity remain untriaged; they were not repaired, downgraded or waived. Dispatcher owns separate backlog intake under Gary's direction. FUCQ-140–143 remain previously deferred findings; this result does not mark them fixed.

The dispatcher amended its grant to permit ordinary owned-process-group supervision without a native handle for every transient synchronous child. This run reuses`test_stamp.run_command/run_process` and the existing strict budget implementation, with one small ignored local adapter for raw ALL-row charging, no pruning/discounts/foreign mutations, direct600s work cap, aggregate group+supervisor sampling and explicit final group/process/open-file checks. No shared framework/catalogue changed. Maximums:2048MiB aggregate RSS,256MiB combined allocation,4MiB logs,1MiB metadata,600s work/660s total; reserves512MiB physical RAM and5GiB disk. Sampled aggregate peak405,864,448bytes; combined charged disk peak9,525,504bytes. Polling cannot measure every transient peak; this limitation was expressly accepted in the amended grant.

Source and dependency identities matched before/after. Direct selected handle was joined. The finalizer proved group/process/open-file absence, removed only scratch`/private/tmp/test-stamp-shard-67286d809a8b4caf9ec486da07e2694b` (device16777232/inode173693077), and released/read back only its bound token. A separate lane postrun read-only collection confirmed launcher/120observed-process identities/group/scratch/token absent and an empty locked raw ledger. Outer tool session29657 joined exit1. No cleanup mutation was needed after the run; independent root collection remains separate.

[Machine result](required-npm-result-2026-11-06.json) pins the unchanged original output, receipt, ownership manifest, lane collection and grant. Originals remain local under`.claude/test-runs/fucq100/required-npm-61c9513623224f00b24dee01083e29b0/`; the file called`raw.tap` contains Node's original default spec output and six totals. The once-only attempt is consumed. No automatic retry, product repair, Jira write or acceptance change followed. Required full validation is failing; Resume/current backend cases behind missing imports and rendered desktop/narrow/keyboard acceptance remain open.
