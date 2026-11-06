# Greg eligibility repair: authored source awaiting execution review

FUCQ-100, 6 November 2026. Dispatcher 0033 approved the four production paths and two test paths
from the [diagnosis](buddy-greg-eligibility-diagnosis.md). FUCQ-103 released its three Greg paths.
The draft is based on `f5f83cbaac71740d25e3de18498022c3f416998f`; it has not been executed or accepted.
No source from 103, 69, 122 or 126 was adopted.

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

Both repository loaders now include entitlement_slots in their existing stable-read sets. The fact
identity includes employee and slot revisions. No records are updated or cached by these reads. Role
checks, stock visibility, decline exclusion, privacy bands and policy/time/points/quote gates remain
with their existing services. Source repair does not make a one-person cohort large enough to publish
an aggregate score.

## Selected checks and frozen identities

The [run catalogue](evidence/fucq100/greg-eligibility-run-catalogue.json) records 108 source/resource
and package metadata paths, 281 static edges, 54 installed pg identities, Node/Python and eight
helper/configuration hashes. All identities are rechecked before allocation and after execution.
A strict loader checks each file-backed ES module against the catalogue and records a bounded module
journal. pg resolves to the previously audited read-only package; no source module is redirected.

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

After an exact dispatcher execution grant, invoke:

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

Plans, receipts and bounded redacted logs remain under shared .claude/test-runs/fucq100. Scratch and
module journals start under unique manifest-owned temporary roots; useful bounded journals are retained
with the receipt. Stop/join all owned descendants before scratch removal, then verify PID/group/root
and reservation absence. Source/dependency identity uncertainty or cleanup uncertainty prevents pass.
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
