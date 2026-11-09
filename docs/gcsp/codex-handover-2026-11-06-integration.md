# Integration handover for Russell's next poller pass

Gary requested this shared handover on 6 November 2026 so Russell sees the two
cross-owner integration gaps when his poller resumes. Pull `gcsp-poc`, read this
note and the current Story Results, then reconcile the live branches before acting.
This note adds no acceptance criteria, new Story, claim transfer or authority to
resume a paused run. Preserve current run instructions and exclusive file ownership.

| Existing work | Gap and owner | Next action in the existing scope |
| --- | --- | --- |
| FUCQ-100 / DEV-2026-11-04-060 | Original AC5 needs the real allocator caller. FUCQ-96 / DEV-2026-11-04-059 is claimed by `usget` (Russell). | Connect the existing allocator/trusted resolver to the integrated buddy transaction through the current runtime registration. Publish the additive composition checkpoint and identify the source for the actual success/replay and stale-first/next-candidate checks. |
| FUCQ-122 / DEV-2026-11-04-084 | Original activity help entry is absent. The activity host is FUCQ-95 / DEV-2026-11-04-083, claimed by `usget` (Russell). | Wire the existing help consumer into the actual activity host, retaining read-only opening/review and explicit confirmation. Coordinate through the existing FUCQ-122 handoff rather than create a duplicate Story. |
| FUCQ-122 order-progress placement | FUCQ-120 / DEV-2026-11-04-082 is the existing order-progress Story; its local record is unclaimed and no host branch was observed. | Reconcile its current pickup/host plan and preserve the help integration point. This handover does not claim FUCQ-120 or authorise a new Codex implementation ticket. |

## FUCQ-100 source and evidence

The FUCQ-100 implementation is already integrated; its seven original backend ACs
remain the contract. The current shared runtime lacks the published FUCQ-96
allocator/resolver composition. Static field compatibility and old isolated proofs
do not establish execution of that actual caller in the current composition.

At this observation, FUCQ-96's live branch `dev/DEV-2026-11-04-059` is
`d12358bcd02f4c10a5dc9f0851efe94bc2c9d864`. Read the
[original-scope disposition](evidence/fucq100/original-scope-disposition-2026-11-06.md)
and the [current FUCQ-100 Result](../../_dev/in-progress/DEV-2026-11-04-060.md).
The existing native FUCQ-96 handoff is comment `3627724`; an acknowledgement has
not been observed. Publish current composition evidence before planning a new run.
There is no Story-specific FUCQ-96 pause in the shared record; any independently
verified launcher pause still applies.

The last required full suite remains failed: 1,590 tests, 1,569 pass, 16 fail and
five skipped. Preserve its exact evidence and the recorded defect dispositions.
Do not repeat previously passed unchanged checks or describe integration as full
acceptance. FUCQ-149 holds the separate Resume proposal and remains paused/unclaimed.

## FUCQ-122 source and evidence

The reusable consumer is already shipped: `<gcsp-help embedded>`,
`mountHelpBody` / `mountHelp` in `blocks/gcsp/cases/gcsp-help.js`, the existing
HTTP adapter and `gcsp-help.html`. FUCQ-95's observed live branch
`dev/DEV-2026-11-04-083` is `c50851b4e0ba000dda5f233204b6a08324e1a0d1`.
Its `gcsp-activity-live.html` / `blocks/gcsp/activity/live.js` host has Brief/Activity
navigation but no help entry. The shared tree has neither the activity nor
order-progress host, so another standalone help check cannot prove those placements.

The existing [Cowork relay MSG-2026-11-06-GC-001](../../_dev/cowork-inbox/MSG-2026-11-06-GC-001.md)
is awaiting Cowork, not acknowledged implementation. It requests routing to the
existing FUCQ-95 owner and preserves FUCQ-120's future seam. See the
[source finding](evidence/fucq122/current-host-browser-2026-11-06/activity-order-help-source-note.md)
and [cumulative evidence matrix](evidence/fucq122/current-host-browser-2026-11-06/original-ac-evidence-matrix.md).

Gary's existing FUCQ-122 lead continues independent original acceptance work.
Desktop/narrow waiting, explicit preference confirmation and reload evidence is
published. The 6 November desktop resolved/closed attempt also reached its four
selected checkpoints; compact publication is being prepared. That raw attempt is
incomplete, exit 1, with 15 errors retained. This progress does not establish full
acceptance or remove the remaining placements, state/remedy, queue, accessibility
and full-suite gaps. FUCQ-150 is the independent Medium queue-width defect.

## Delivery rules and acknowledgement

Follow `AGENTS.md`, [build rules](build-rules.md#demo-delivery-and-scope-control)
and [experience quality](experience-quality.md), and pass them to every delegate.
Prioritise the working demo. Keep the claimed ACs fixed; proposed additions need
separate backlog Stories for collaborator prioritisation. Defects below Critical/High
remain independent linked backlog Bugs; retain actual failures, unrun checks and
specific authorised deferrals. Integration does not authorise acceptance or Done.

On the next authorised owner pass, acknowledge the applicable handoff through
`_tools/dev_mail.py` and record the current checkpoint or concrete remaining blocker
in the owning Story's Result. Retain equal collaborator authority and measured,
owned runtime resources with independent cleanup. No new runtime grant is implied
by this handover. Gary's personal polling and coordination files remain local.
