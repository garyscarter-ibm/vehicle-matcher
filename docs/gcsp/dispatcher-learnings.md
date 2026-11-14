# Shared dispatcher learnings

Started at Gary's request on 14 November 2026. Both pollers record delivery issues and their resolution here,
so improvements can be carried into agent-scaffolding. This log is shared through `gcsp-poc-dev`.

Append an event when an issue is identified, mitigated, resolved, recurs or its diagnosis changes. Use a unique
ID such as `DL-20261114-GC-001` or `DL-20261114-RG-001`, then reuse it for later events. Preserve earlier entries;
correct them with a new event. Include UTC time, poller, impact, evidence, cause/uncertainty, action, outcome and
framework follow-up. Keep raw logs, credentials, private data and personal coordination files elsewhere.

States: **identified**, **mitigating**, **verified resolved**, **reopened**. A proposed framework change remains
a proposal until implemented and checked; record its eventual commit/check evidence against the same ID.
The log does not replace required defect records, expand Stories or add a delivery gate. Pull before writing;
commit and push named paths through the existing helper, preserving concurrent appends from the other poller.

## 2026-11-14 16:51 UTC · GC Codex · DL-20261114-GC-001 · identified

- **Issue/impact:** dispatch overhead and scheduling holds reduced useful parallel delivery. At the 16:32
  observation only FUCQ-447 was confirmed active; FUCQ-442 and FUCQ-446 were held by GC scheduling.
- **Cause/evidence:** repeated separate source, test-preparation, review and runtime-release handoffs are
  recorded in FUCQ-434 coordination comments 3629457/3629458 and the Story delivery histories. The capacity
  tool at 16:50 reported `can_start=3`; resource capacity did not require keeping both independent Stories held.
- **Action/outcome:** identified as a dispatcher process problem. Existing resource ownership, original
  acceptance criteria and conflict protection remain necessary; they do not require a new permission round
  for every routine implementation/test step.
- **Framework follow-up:** make a bounded Story release include implementation and proportionate checks;
  recheck runnable existing work against actual capacity and file conflicts, rather than waiting for an
  unrelated checkpoint. Measure useful delivery before calling this resolved.

## 2026-11-14 16:52 UTC · GC Codex · DL-20261114-GC-001 · mitigating

- **Action:** resumed the existing FUCQ-442 lead for its original stock screen, minimal vehicle card and
  compact media support, with source and selected checks authorised together. Exact allocated files exclude
  the FUCQ-447 worker's table, routes and catalogue/gallery edits; parent integrates shared wiring serially.
- **Evidence/outcome:** owned clean worker fast-forwarded and published at
  `8cbcfe7580785dacf77cb7b8ddff598d712756ae`. App API confirmed both Emmet/FUCQ-442 and Hubie/FUCQ-447 executing.
  Two active workers is a scheduling improvement; this release has no completed validation/delivery result yet.
- **Framework follow-up:** validate that the simpler release produces coherent tested integrations without
  widening the original Story or repeating preparation rounds. Framework implementation remains proposed.

## 2026-11-14 16:50 UTC · GC Codex · DL-20261114-GC-002 · mitigating

- **Issue/impact:** a global "active" count can be mistaken for complete visibility across both pollers.
- **Cause/evidence:** all 18 native In Progress Stories had leases, but nine belonged to the other poller
  without fresh execution evidence available here. Its latest observed FUCQ-434 coordination comment was
  3629458 at 10:29:52 UTC. A lease or native In Progress status cannot establish current execution or inactivity.
- **Action/outcome:** apply Gary's six exclusive buckets: To do, active, held, blocked, in review and done.
  Label those nine reservations **held — execution unverified**, with the observation time. Preserve native
  Jira statuses. Fresh native query and lease reconciliation still cover exactly the authorised 66 Stories.
- **Framework follow-up:** exchange small expiring execution observations between pollers, separate from
  leases and tracker status. Reporting semantics are applied locally; shared execution visibility is unresolved.

## 2026-11-14 16:35 UTC · GC Codex · DL-20261114-GC-003 · mitigating

- **Issue/impact:** the global Jira lifecycle planner took approximately eight minutes and produced 198
  proposals when only FUCQ-417's lifecycle needed action.
- **Cause/evidence:** the planner scanned historical adoption dates across Git refs for unrelated Stories.
  Only the authorised FUCQ-417 operation was applied; the Story is native In Review and cleaned up. Its
  acceptance disposition and evidence map are in `docs/gcsp/evidence/fucq417/`.
- **Action/outcome:** GC's local adapter now accepts an explicit issue scope before planning and rejects
  acknowledgements for foreign keys. Syntax was checked; the scoped runtime has not yet been exercised.
- **Framework follow-up:** add native scoped lifecycle planning to agent-scaffolding and verify it against
  both selected and excluded issues. Do not call the performance problem resolved from syntax checking alone.

## 2026-11-14 16:54 UTC · GC Codex · DL-20261114-GC-004 · mitigating

- **Issue/impact:** inherited output-placement and cleanup instructions conflict with Gary's explicit
  prohibition on all OneDrive access, including reads and cleanup verification.
- **Cause/evidence:** historical resource instructions require large outputs in synced storage. They cannot
  override the later human restriction. Historical observations retained locally are not fresh cloud audits.
- **Action/outcome:** current worker releases prohibit all such access and use bounded local scratch with
  the resource helper's explicit local reason and `/private/tmp` output root. Persisted the restriction in
  shared `AGENTS.md` and linked it from `CLAUDE.md`; no OneDrive inspection or cleanup was performed for this log.
- **Framework follow-up:** make explicit forbidden storage locations binding throughout allocation, imports,
  finalizers and audits; support local output policy without a cloud-aware runner. Do not verify this by
  probing a forbidden location. Future checks must retain resource limits and report any resulting limitation.

## 2026-11-14 16:54 UTC · GC Codex · DL-20261114-GC-005 · mitigating

- **Issue/impact:** scope and validation requirements can grow while an existing Story is being delivered.
- **Cause/evidence:** Gary reaffirmed strict bounds after today's stalled-work concern. Shared policy commit
  `2855b2f837a4392ac81d4c887867e1e4dee5c7fe` fixes the original criteria, applicable contracts and named files;
  lower-severity defects remain independent backlog work. Existing unmet criteria remain actual Story work.
- **Action/outcome:** current FUCQ-442/FUCQ-447 briefs carry exact original criteria, finite source allocations,
  selected checks and remaining acceptance gaps. Five GC Stories, FUCQ-412–415 and FUCQ-417, have since reached
  native In Review with integrated/pushed evidence. This does not prove all stalled work is resolved or accepted.
- **Framework follow-up:** carry the claimed contract through build and review; distinguish original gaps
  from proposed additions and reuse unchanged applicable evidence. Keep optional hardening off delivery gates.

## 2026-11-14 16:55 UTC · GC Codex · DL-20261114-GC-006 · identified

- **Issue/impact:** the installed headless browser could not establish rendered evidence for the new
  FUCQ-447 queue/detail UI. Desktop, narrow-screen and browser keyboard checks remain unverified.
- **Evidence/cause:** Hubie's current worker report says all 61 selected tests passed, but the Chrome
  attempt printed a blank page and failed to exit within 30 seconds, with display/process-policy errors.
  These results are worker-reported pending the parent receipt audit; the precise browser cause is unresolved.
- **Action/outcome:** the worker reports stopping its process group and removing owned local scratch,
  preserving the failed check and continuing the bounded source checkpoint without a browser repair campaign.
  Tests alone do not establish rendered or whole-Story acceptance.
- **Framework follow-up:** detect supported installed browser capability before allocating a rendered run,
  retain a bounded failure and stop/join its owned process group. Avoid repeatedly releasing the same failed
  environment without a causal correction. This entry neither authorises browser repair nor waives original checks.

## 2026-11-14 16:57 UTC · GC Codex · DL-20261114-GC-002 · mitigating

- **Correction/evidence:** a full coordination-comment read confirms 3629458 at 10:29:52 UTC was authored by
  GC, not the other poller. The latest Russell-authored update observed is 3629446 at 09:23:23 UTC. Preserve
  author identity as well as the timestamp when describing peer evidence. The nine execution-unverified
  reservations remain held; this correction establishes neither activity nor inactivity.
- **Action/outcome:** at Gary's explicit request, coordination comment 3629463 now asks the peer for a
  current per-Story execution/blocker/last-progress/next-action report, the overall bottleneck and any help
  needed from GC. No response has yet been observed. The earlier comment's author attribution was corrected.
- **Framework follow-up:** attach source author and observation time to cross-poller status evidence;
  distinguish an outbound request, a peer reply and a verified worker observation.


## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-001 · mitigating

- **Evidence/outcome:** FUCQ-447's bounded queue/table release produced compilation and 64/64 selected
  passing tests. Parent matched all 127 inputs and resource receipts; independent review found no actionable
  issue. Exact worker `8f539829506ec1c0491edb279b33caf781e93e44` is integrated/pushed as `b0c5ff37b1d10c6b23e6efde108e6a535742275e`.
- **Action:** publish the coherent increment promptly while retaining the original Story's unchecked
  criteria and failed/unrun browser/connected checks. FUCQ-442 continues its separate allocated screen work.
- **Framework follow-up:** this is direct evidence for a useful combined implementation/check release;
  it does not establish sustained throughput or resolve the framework scheduling problem. Current measured
  `can_start=2` remains below the three-slot new-Story-lead budget, so no new reservation was taken.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-004 · mitigating

- **Evidence/outcome:** the parent audited the current FUCQ-447 local runner/receipts, selected dependency
  identities and actual local teardown. All owned scratch/processes/tokens were absent at 17:05 UTC; the
  unrelated reservation was preserved. The audit used only explicit allowed local paths.
- **Action/follow-up:** the local mitigation worked for this increment; inherited forbidden-storage
  instructions remain overridden. No forbidden path was probed, and no framework implementation fix is claimed.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-006 · identified

- **Confirmed evidence:** independent review and parent audit retain native-2's incomplete Chrome
  about:blank attempt (blank DOM, 30-second timeout, display/process-policy errors). Native-3 passed 64
  tests only; it did not repeat or pass rendering. Product browser and keyboard evidence remain open.
- **Action/follow-up:** publish the source increment with this precise limit; avoid repeating a failed
  browser release without a causal change. No browser repair or acceptance waiver was introduced.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-007 · mitigating

- **Issue/evidence:** FUCQ-442 reports Chrome starts, but its isolated fixture initially could not
  bootstrap Angular's partially compiled libraries. This is worker-reported fixture setup evidence, not
  a production defect. Native ngc compilation passed; a fixture-only compiler import enabled 17 reported
  browser checks. Parent pin/resource audit and the final checkpoint are still pending.
- **Action/outcome:** the worker continues the same bounded release, correcting a missing original
  monthly-points summary found during visual inspection. No new feature or test-framework expansion.
- **Framework follow-up:** distinguish fixture bootstrap failures from product failures, retain each
  attempt, and require the final source identity for any reused visual evidence. Do not call this verified yet.

## 2026-11-14 17:07 UTC · GC Codex · DL-20261114-GC-008 · verified resolved

- **Issue/cause:** parent and reviewer source audits attempted to read a binary input through
  scaffold_git's text-output wrapper, raising UnicodeDecodeError before finishing pin verification.
- **Action/evidence/outcome:** parent used SHA-256 of exact local bytes plus tracked-file/clean frozen-HEAD
  comparison; reviewer used immutable Git blob IDs plus byte hashes. Both independently completed all 127
  pins. Parent receipt SHA-256 `ebef098dad6a1e45a1578b68e48f245d0eee4d991425efe7a039f448c74b57a4`.
- **Framework follow-up:** provide a binary-safe immutable-object audit API. The local audit failure
  is resolved; no shared framework patch, product source change or extra runtime was needed.
