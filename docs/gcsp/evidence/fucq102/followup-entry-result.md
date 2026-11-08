# Follow-up entry: original failed check

6 November 2026. The once-only grant `fucq102-followup-da78f25-0159`
ran at published harness commit `da78f25d2214b60f34f8c2b2c18992c43592cfb4`.
**Failed: 11 executed, 8 passed, 3 failed, no skips or cancellations.**
No retry or repair was performed under this grant. The original checkpoint remains
`incomplete`; this is failure evidence, not story acceptance or a full-suite stamp.

The original command was:

```sh
/Library/Developer/CommandLineTools/usr/bin/python3 -I -B \
  docs/gcsp/evidence/fucq102/followup-entry-supervisor.py \
  --execute \
  --admission-sha 33a737bdf8e6dff86f9fe806b831243f0984c64e34aed68a0022c1dace11ed60 \
  --dispatcher-grant fucq102-followup-da78f25-0159
```

## Observed failures and harness deviation

The initial reload/lost-response case, distinct historical/quoted-brief case, and
terminal-version/quote-expiry/car-reuse case each expected `{ decisionId }` but
received `followup: null`. The application cause is not established by this receipt.
The eight passing rejection/authority/race cases do not establish a working
positive follow-up path while those three cases fail.

The child emitted Node's **spec reporter**, with `✔`/`✖` cases and `ℹ` totals.
The supervisor searched for TAP `not ok` failures and `#` totals. Its first-failure
stop condition therefore did not fire, all eleven cases ran, and its original
structured `testCounts`/`testNames` are empty. This violated the within-entry
stop-first-failure condition. The counts above are derived separately from the
unchanged original log, with all eleven names matching the planned selection.
Child exit was 1; supervisor exit was 2.

## Original evidence and readback

Original root, retained unchanged:

`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq102/followup-9d6eec0b291741f1ba7fa06a4586a751/`

Byte-identical bounded copies are in [followup-entry-run-9d6eec0b/](followup-entry-run-9d6eec0b/):

- `test.log`: original reporter output; SHA-256
  `7a8efa031bd0caefbe78d77230b8cdfc447174d36c7c045e1cc79ad69beba088`.
- `modules.jsonl`, `plan.json`, `checkpoint.json`, `summary.json`.
- `ownership/c48bb4a0b4dd464ba62cad1b692668c5.json`: original ownership manifest,
  process identities and finalizer receipt.
- `readback.json`: separately derived counts, copy hashes, source/dependency
  readback, budget basis and fresh cleanup observations. It does not alter the
  original summary's empty counts.

Readback matched all 193 frozen physical identities, 51 immutable source/data
blobs, 38 absent resolution candidates and the absent dependency link. The journal
contains exactly the 44 declared JavaScript modules with matching hashes. Original
`pinsPreserved` is true. Source-plan SHA-256 remains
`fd2eb341905bba23414e799bb011c0d415564c0c4ac656a0b0047d82a8111c3a`.

## Budget and cleanup

The fresh strict locked HostBudget admitted the run: this follows from the frozen
control flow requiring acquisition and reservation readback before mirror creation
and child launch, together with the retained launch and strict release receipt.
No separate initial headroom snapshot was persisted; a numeric initial-headroom
claim is unavailable.

Limits were one worker, 120 seconds, 768 MiB aggregate RAM, 128 MiB combined
scratch/output, 2 MiB log, 5 GiB disk reserve and 512 MiB RAM reserve. Recorded
wall time was 14.7125 seconds, peak aggregate RSS 249,839,616 bytes, combined
allocation 1,236,992 bytes and log 4,128 bytes. Retained checkpoint files total
33,738 bytes, including the additional readback.

The original finalizer reports joined, PID/group absence, scratch absence and
reservation absence. A subsequent read-only audit independently found the recorded
PID/start identity and group 81295 absent, the owned scratch
`/private/tmp/test-stamp-shard-c48bb4a0b4dd464ba62cad1b692668c5` absent, and its token
absent from the structurally validated ledger under the frozen reservation lock.
No owned leftover was observed. This ordinary failed-run cleanup does not exercise
injected cancellation or establish that every exceptional cleanup path works.

## Remaining work

The dispatcher subsequently authorised author-only diagnosis and minimal owned
access/test/harness repair, including the reporter mismatch and exceptional cleanup
review. A fresh source/harness review and exact grant are required before any new
execution. The original failed evidence remains intact.

105 projection/client/host adoption, canonical default 107 question registration,
runtime/deployment, remote/browser/native database and full integration acceptance
remain outstanding. Earlier 32/32 access evidence remains separately labelled.
No Jira, claims or product-map acceptance state changes are made here.

Agents: Hugo, requested/selected `gpt-6.1-sol` / `high`; no fallback or descendants.
