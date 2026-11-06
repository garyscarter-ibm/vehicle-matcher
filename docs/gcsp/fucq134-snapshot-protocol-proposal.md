# FUCQ-134 fixed-field snapshot protocol proposal

6 November 2026. Author-only diagnosis against publication
`7293e52f313c02fd8c5dc8a8e0be74a1912da3fd`. Dibble passed narrow proposal review
at `02eda65732b294c3e7b2fd70ded84e9bc9ca51e0`, proposal SHA-256
`f238a112ea42fe2774427cd1311c0dc134579e90994373de7e532441a0bc1774`.
Root authorized the minimal author-only implementation below. The authored
repair awaits implementation review and fresh execution admission. No probe,
test, allocation, retry or new run grant follows from this note.

## Preserved failure and evidence

The separately granted once-only attempt used admission
`2c4deec6736bcb81944c06e5e3a4ff7b0d92044820c141d68beb181c7a7c399a`.
Actual controller exit **2**, immediate independent completion-audit exit **1**,
and tool-wait exit **1** are captured in shared ownership evidence
`fucq134-first-chunk-attempt-0837.json`, SHA-256
`261f6e4f64c67b9ac033145c254f7122268a01a8dc98d7dace6f51fdeb73d629`.
No complete stdout or completed three-case TAP result was retained. Node launched;
the bounded log ends with an isolation failure marker without a TAP summary.

The first failure was `SnapshotUncertain` in execution. Its diagnostic is exact:
query exit 0, empty stderr, owner row present; first rejected line 626,
reason `state-grammar`, raw fixed fields (including four final ASCII spaces):

```json
"34537 34535   603      0 ?    Fri Nov  6 08:37:31 2026\u0020\u0020\u0020\u0020"
```

Manifest `ownership/fucq134-ba7c9bc73b1d4c42b900a5d5637ce6db.json` remains
unchanged, SHA-256
`46a341ff0f95a99b4b68d87d57c8159b3b047baf932900ace061bd6a37c47e68`.
Its historical `uncertainGroups: [34518]` is retained even though later controller
cleanup reports absence. Root's independent
`ownership/fucq134-second-run-root-cleanup-0813.json` now reports PASS: 19 checks,
798 fresh identity rows, exact owned PIDs/groups/scratch/token absent, no open
files, empty ledger and no cleanup mutations or ledger writes. Its query omits
both RSS and STAT, so it establishes neither the proposed five-field/RSS
protocol nor a successful test. Cleanup uncertainty alone is superseded;
controller 2/audit 1, the first failure and historical uncertainty remain.
The report does not establish why ps emitted `?`, whether it was transient, or
that the other fields certify a current process identity.

The original earlier failed manifest remains SHA-256
`098f4dcfa8a35de7d324a6391a7024759ab38d1898a4a0897f14840b655d13fc`;
its causal row remains **UNKNOWN**. Neither later sample reconstructs it.

## Published six-field dependency trace

At publication `7293e52`, in
`docs/gcsp/evidence/fucq134/first-chunk-resources.py`:

- Lines 42–98: `process_snapshot` requests PID, PPID, PGID, RSS, OS state and
  start; validates state and stores it. State rejection invalidates the whole
  snapshot, clears that partial start and retains partial observations.
- Lines 101–114: `definitely_absent` uses PID/start comparison, or a missing PID
  plus `os.kill(pid, 0)` returning `ProcessLookupError`. It never uses OS state.
- Lines 168–205 and supervisor lines 150–158: owner binding and RSS accounting
  use PID/start, PPID, PGID and RSS; no OS-state consumer.
- Lines 370–435: ownership, anchored groups, descendant closure and uncertainty
  retention use PID/start/PPID/PGID; RSS sums all selected members.
- Lines 438–501 and 506–595: registration, exact-identity signals, direct joins
  and absence proof do not read OS state. Group absence requires no returned
  row in any recorded or uncertain group. An extant zombie therefore blocks
  absence regardless of its state label.
- Lines 655–710 and strict budget lines 208–252: final cleanup still requires
  joined children, PID/group absence, pinned inputs, exact scratch inode/device,
  empty bounded lsof result, locked full-row deletion binding, scratch absence
  and exact reservation release. No OS-state dependency.

Other `state` fields in this helper describe launch/probe/scratch lifecycle;
those remain required and are unrelated to ps STAT. The shared
`_tools/test_resources.py:307` group helper does read STAT and excludes zombies;
the owned strict proof does not call it. Do not change or substitute that helper.

## Proposed narrow contract

Replace the single fixed query protocol with:

```text
/bin/ps -axo pid=,ppid=,pgid=,rss=,lstart=
```

Parse every row after the existing trailing-ASCII-space normalization with
`split(None, 4)`. Require exactly five fields, the existing ASCII decimal checks
for the first four fields, positive PID/PGID, no duplicate PID and the unchanged
full start grammar at index 4. Returned rows contain PID/PPID/PGID/RSS/start;
do not manufacture an OS-state value. Keep current RSS units/conversion.

Preserve partial PID/PPID/PGID observations and unknown starts on malformed
required fields, with the timestamp index adjusted consistently in both checks.
Any invalid required row, query error/stderr/timeout, empty output or missing
owner rejects the entire snapshot. Preserve first-rejection/query diagnostics
and their existing finite bounds. Retain every valid row for ownership closure,
group checks and accounting, including rows outside the currently selected tree.

This changes the required OS data contract globally. It does not add `?` to a
state whitelist, skip a row, retry a rejected sample using fewer fields or treat
an apparently foreign row as harmless. An extant owned identity with unknown
start cannot establish absence or authorize an identity-based signal. Historical
unknown start can resolve through a missing PID plus `os.kill(pid, 0)` returning
`ProcessLookupError` (ESRCH), as the unchanged absence helper already permits.
Unresolved launches and unanchored/shared groups retain their existing gates.
Historical uncertainty and failure evidence are never rewritten. Zombies remain
present because presence is independent of STAT, and invalid required
identity/RSS fields remain fatal to the whole snapshot.

## Review boundary and remaining validation

The trace supports removing an unused required field while preserving the
existing sampled-identity model; it does not prove the proposed OS query works
at runtime or strengthen the existing ps snapshot/race assumptions. Dibble's
proposal review accepted the five required fields for authoring the narrow
repair; implementation and runtime validation are separate gates.

The approved authoring is limited to the owned parser protocol, matching
diagnostics/documentation and a new frozen admission. Keep all code
from `def definitely_absent` onward, supervisor cleanup/signaling/accounting,
shared helpers and completion/resource limits unchanged. Static review should
compare those boundaries exactly and inspect partial-observation handling.
Any runtime validation needs separate current admission and a new explicit grant;
neither consumed grant can be reused. No fallback query or automatic retry.

The three synthetic mechanics cases remain the sole prospective runtime scope.
No route/cache/outcome/canonical-policy/corpus/UI/browser/native/full/live proof
or story acceptance follows from this proposal or the failed attempt.
Agents: requested/selected gpt-6.1-sol/high; no fallback or descendants.
