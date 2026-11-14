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
