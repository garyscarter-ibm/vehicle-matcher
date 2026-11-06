# Greg eligibility repair: first execution stopped at loader admission

FUCQ-100, 6 November 2026. Dispatcher 0033 approved the four production paths and two test paths
from the [diagnosis](buddy-greg-eligibility-diagnosis.md). FUCQ-103 released its three Greg paths.
The draft is based on `f5f83cbaac71740d25e3de18498022c3f416998f`. Its first granted run stopped
before any business case; the product draft remains unaccepted and uncommitted.
No source from 103, 69, 122 or 126 was adopted.

## First granted execution, 6 November 2026

The dispatcher granted exactly one run, `fucq100-eligibility-f0e186d-0033`, against checkpoint
`f0e186dd01c4053cdaa4609d5720c871f39ef9e0` and catalogue SHA-256
`65b63242b8548984ae418cc01e137b29721ee06510d728821d8d46e2cb493b95`. All admission pins matched.
The [failed-run evidence](evidence/fucq100/greg-eligibility-first-run.json) preserves the exact totals,
original bounded log identity, receipts and independent cleanup audit.

Node 26.5.0 refused self-registration with `Invalid loader registration` before either test module
loaded. TAP reports two failed file subtests, zero passes/skips; none of the 25 business cases ran.
The module journal does not exist because the resolver rejected the request before its first record
call. Its path in the receipt is a proposed output path, not evidence that a journal was produced.
No product or harness correction and no retry followed this failure.

The observed failure is at the exact self URL/specifier/parent predicate. A static hypothesis is that
the launcher supplies an absolute loader path while the predicate requires a URL specifier; the
original error records neither specifier nor parent, so the failing disjunct is not established.
A correction or diagnostic rerun requires a new dispatcher decision and reviewed pins.

The independent parent audit verifies both manifests removed, owned scratch and reservations absent,
all recorded and owner PIDs absent by ESRCH (including two with unknown recorded starts), complete
group absence, no owned TCP listener, strict locked ledger validity, preserved worktree and all frozen
108 source/8 helper/executable/54 installed hash and physical identities unchanged. The original log
is retained at 2,460 bytes. Business acceptance remains unproved.

## Authored behavior

`manual-context/recommendation-facts.js` is a pure shared projection. Both Greg readers derive the
original fact from the exact persisted employee, brief, slot and current-contract driver. The current
contract's explicit driver can be nominated. With no current contract reference, only a unique owned
employee-kind driver supplies the fact. False, absent, unknown, nonboolean and bad-provenance facts
retain their original representation and pass through the existing FUCQ-29 gate. A flattened true
cannot override that bound fact.

The dispatcher's final semantics are applied: missing or ambiguous employee-kind choice remains
unconfirmed when no explicit reference requires a driver. Dangling explicit references, duplicate
primary identities, foreign ownership/run/slot/scheme and corrupt dated source/record-set envelopes
produce generic unavailable. Demand performs this mapping before its no-visible-stock shortcut.
Neither helper results nor aggregate errors expose driver identifiers or diagnostics.

Static review corrected a draft exception that treated wholly missing manualContext as unconfirmed
when no contract was referenced. Missing manualContext, account or source now always produces generic
unavailable. The absent/ambiguous-driver outcome requires a valid account/source envelope. Focused
expectations cover missing manualContext both with and without a contract reference, plus missing
account and source. This correction does not add a product path or an executed case.

Both repository loaders now include entitlement_slots in their existing stable-read sets. The fact
identity includes employee and slot revisions. No records are updated or cached by these reads. Role
checks, stock visibility, decline exclusion, privacy bands and policy/time/points/quote gates remain
with their existing services. Source repair does not make a one-person cohort large enough to publish
an aggregate score.

## Selected checks and frozen identities

The [run catalogue](evidence/fucq100/greg-eligibility-run-catalogue.json) records 108 source/resource
and package metadata paths, 281 static edges, 54 installed pg identities, Node/Python and eight
helper/configuration hashes. All identities are rechecked before allocation and after execution.
The stamp first verifies the supplied catalogue hash and every helper hash using only standard-library
code, before importing the supervisor or any custom helper. The inner supervisor compares its complete
catalogue before importing runtime-supervisor and its transitive test_resources module. This admission
ordering was corrected during static review; no test command was used to exercise the earlier ordering.
A strict loader checks each file-backed ES module against the catalogue and records a bounded module
journal. The generated loader admits its own exact URL only from the exact worktree-directory parent,
checks its generated-byte hash pinned in the child environment, and journals that registration. It
admits no scratch directory wildcard. pg resolves to the previously audited read-only package; no
source module is redirected.

Exactly 25 cases are selected: eight new focused cases and all 17 cases in the updated demand test.
Data-driven assertions cover the approved driver/reference/fact outcomes, default manual preparation,
unchanged records/provenance, aggregation and both slot read fences. The old unknown-fact test now
changes the actual driver's eligibility instead of deleting a referenced contract. Its setup uses
real seedManualDemoContext rather than inserting a flattened fixture.

The first focused case uses actual default Paula preparation and the actual employee/Greg services.
The cohort case copies full canonical-shaped records into explicitly synthetic, coherently bound
stored subjects. Those extra subjects are fixture inputs, not authenticated employee sessions. It
proves projection and privacy behavior against the actual canonical threshold. It does not claim
that a default run contains five real employees or prove weighted scoring on this older 100 scorer.

One existing demand test opens an ephemeral loopback HTTP listener. Its local listener, fetches and
server shutdown are explicitly included in the execution request. The eight new cases are in-process.
No browser, native database, external provider, full suite, business scenario or unchanged nine-case
runtime rerun is requested. Actual 103 weighted response validation remains a subsequent combined
source gate; its published scorer is retained on that branch and is untouched here.

## Proposed command and resource ownership

The first grant above is consumed. Only after a new exact dispatcher execution grant, invoke:

```text
/usr/bin/python3 -I docs/gcsp/evidence/fucq100/greg-eligibility-stamp.py --dispatcher-grant <grant> --catalogue-sha256 <reviewed hash>
```

The wrapper uses test_stamp.py --targeted f5f83cba with an explicit selected command. All Git reads
use scaffold_git under the short checkout mutex. The targeted dry plan precedes the one selected run;
a failed command stops the chunk. There is no automatic retry or alternative source overlay.

One worker; 120-second execution bounds; 768 MiB aggregate descendant RSS; 128 MiB parent scratch
budget with an inner reservation of at most 64 MiB; 2 MiB combined bounded output. The outer sampler
includes the inner supervisor and all descendants. The inner RAM admission may shrink inside that
parent allocation, with a 128 MiB minimum. Both supervisors register external manifests/finalizers
before owned scratch creation. Debug, database aliases and preloads are stripped. Test cookies and
gate values originate inside tests; deployed gate/mail settings are removed from the child.
The same local sanitizer runs before both launches and strips inherited coverage/profiling/debug,
Node/Python injection, native loader/preload/sanitizer, malloc tracing and shell startup settings,
including NODE_V8_COVERAGE and DYLD_INSERT_LIBRARIES. Removed variable names alone enter receipts;
values are neither inspected for review nor logged. The generated loader hash is newly set by its
supervisor after sanitization. No shared sanitizer was edited.

Plans, receipts and bounded redacted logs remain under shared .claude/test-runs/fucq100. Scratch and
module journals start under unique manifest-owned temporary roots; useful bounded journals are retained
with the receipt. Stop/join all owned descendants before scratch removal, then verify PID/group/root
and reservation absence. Source/dependency identity uncertainty or cleanup uncertainty prevents pass.
Both supervisors read the reservation ledger strictly under its existing lock, reject malformed JSON,
duplicate keys, non-object ledgers and invalid accounting/owner entries, and record unreadable or
unknown state as failed cleanup. Their local HostBudget release also uses that strict read so a
permissive release cannot erase a corrupt ledger before the final check. No shared resource helper
was edited. Outer cleanup uncertainty forces a nonzero stamp result.
Both local PID probes require ESRCH or a different nonempty start identity to prove the recorded
process is gone. Permission errors, failed ps/identity queries and missing start identities remain
unproved; strict group checks and SafeScratch retention still apply.
Both samplers record every observed owned PID even when its start query fails. Such a record cannot
disappear from the final proof: a missing start keeps absence unproved while that PID exists.
Preparation time is separate from the 120-second child bound. Independent final audit remains the
launching session's responsibility. No resources have been allocated by catalogue generation.

## Remaining boundaries

The existing 99 dashboard helper and some 103 helpers still construct partial flattened manualContext
fixtures. They require owner-scoped canonical preparation before those changed-source regressions can
be reused. No earlier 103 controlled result is claimed as proof for this changed graph. Persisted data
from other producers and live adapters was not inspected or migrated; invalid retained envelopes keep
their explicit unavailable outcome. There is no historical record rewrite or backfill.

After scoped execution and cleanup pass, publish the coherent validated source chunk. Dispatcher
retains merge/Jira/final acceptance and the separate 69/122/126 composition, allocator96, remote and
full105 association gates.
