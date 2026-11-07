# GCSP build rules

Binding direction from Russell, 2 November 2026. Every GCSP story author, designer, implementer and reviewer reads this file and passes the relevant rules to child agents. These decisions supersede earlier scope-reduction suggestions and requirements to settle every demo policy before building.

## Scope split decision, 7 November 2026

Russell explicitly authorised the partial-story splits in the [MoSCoW review](backlog-moscow-review-2026-11-07.md): keep each necessary part under its existing Story number and put its remaining scope into a new native Story in To Do. This is the human contract revision permitted by the claimed-scope rule below. Native descriptions and claimed/local records are reconciled; claims, statuses, existing estimates and historical evidence are preserved.

- FUCQ-114/118/120/124 retain appointment/return planning, progress and connected acceptance through a confirmed plan. FUCQ-167/168/169/171 own later physical completion, no-show/missed-return, rebooking and advanced lifecycle/help verification, after the demo. Planning never changes the current-car relationship.
- FUCQ-122/126/128 retain useful help with named ownership/status, main presenter controls and the matching-second-offer replay. Optional case operations, wider scenario choice and the no-second-match replay package are FUCQ-170/172/173.
- FUCQ-136/137/138 retain real multi-seed process measures, immutable results, offline execution, an authorised stored-result read route and honest display/assumptions. Additional experiments, browser worker jobs and interactive reruns are FUCQ-174/175/176.

Every moved capability keeps its relevant functional, integration, access and experience evidence. Preserve canonical policy, exact identity, pending reconciliation and provenance. Each new remainder is unassigned and To Do, linked as a split; it does not block its retained Story. Re-estimate actual remaining work at pickup. The other whole-capability MoSCoW recommendations remain proposals; the learned-model lane and remaining full-build promises are not waived by these ten splits.

## Demo delivery and scope control

Gary's standing directions, 6 November 2026, apply to story authors, implementers, reviewers, dispatchers and
every descendant, across all harnesses. They take precedence over earlier workflow wording where it conflicts.

1. **Deliver a complete working demo.** Prioritise connected, demoable journeys and integrate coherent,
   validated increments promptly. Avoid optional hardening, refactoring and new validation frameworks while
   they delay the planned demonstration. Retain the agreed adapter, authority and access boundaries.
2. **Backlog lower-severity defects.** Triage the actual impact. Every defect below Critical/High becomes a
   linked backlog Bug to be reviewed and picked up independently later. Record its evidence, severity, originating
   Story and known limitation; it does not expand or block the current Story's review or merge. Critical/High
   defects require resolution or an explicit collaborator decision to defer them. A specific deferral, including
   Gary's FUCQ-100 integration disposition, remains specific and does not lower the recorded severity.
3. **Keep claimed acceptance stable.** New feature requests and proposed AC additions or changes become
   separate, bounded backlog Stories for collaborator review and prioritisation before pickup/build. Link the
   originating Story for traceability rather than adding an automatic blocking dependency. Agent/dispatcher
   approval of implementation work does not authorise expanding a claimed Story's ACs. Any explicit human
   instruction to revise an existing contract must be recorded and reconciled in Jira and the claimed record.
4. **Preserve the original obligations and evidence.** An unmet original AC remains part of the current Story;
   it cannot be reclassified as a new feature merely to declare completion. Record real test failures, skips,
   unrun checks and deferred defects. An authorised integration merge may unblock other work while full
   acceptance remains open; it is not a passing suite, an accepted Story or permission to mark Done.

FUCQ-149 is the backlog proposal extracted from the agent-added manual Resume criterion in FUCQ-100.
It awaits collaborator review and prioritisation; FUCQ-100 retains its original seven backend criteria.
Already-merged implementation and separately tracked defects remain available for that review.

Pass this section, the experience contract and the relevant original ACs in every delegated brief.

## Complete the planned demonstration

All planned capabilities in the candidate demonstration journey and HLD must work. Russell confirms that there is time to build them. Plan sequencing and dependencies toward completing the whole build; the 30-minute presentation slot determines the walkthrough, not a reduced implementation scope. Earlier stretch labels do not justify deferring a planned capability.

**Agreed exception, Russell, 4 November 2026:** follow Gary's FUCQ-6 Q5 recommendation. FUCQ-21 and FUCQ-26 go first; the employee policy uses `rankCars()` directly; FUCQ-22–25 may proceed in parallel; FUCQ-27/28 move to **after 12 November 2026**, protected by the retail baseline. This changes the timing of those two extraction stories. The remaining planned capabilities retain the full-build direction. The [HLD agreement](hld-agreement-2026-11-04.md) records all five accepted review changes.

**Agreed exception, Gary, 4 November 2026 (equal-authority rule, `AGENTS.md`):** the demo data route is real configurations with synthetic stock on top. FUCQ-77 collects at least 200 real, constructible configurations covering every scheme model line, and FUCQ-78 generates synthetic scheme stock on them. FUCQ-61's 10,000-configuration run moves to **after 12 November 2026** if still wanted; FUCQ-62 keeps corpus publication.

**Runtime dependencies (review Q4, 4 November 2026):** the zero-runtime-dependency convention is relaxed for `pg` only, for the GCSP PostgreSQL repository. Any other runtime dependency needs Gary's approval first.

The existing distinction between functioning demonstration behaviour through adapters and future authorised BMW integration remains in force. Architecture review, backlog authoring and execution follow the agreed workflow; recording this direction does not start pollers or publish Jira changes.

## Plausible assumptions in one shared source

**Story pickup, Gary, 5 November 2026:** use actual technical readiness rather than treating Jira dependency links
as automatic gates. Existing agreed interfaces can permit independent implementation before the full functional
journey is complete. Record the code/contract basis, scope and outstanding integration evidence, and meet the
authored acceptance before declaring completion. Explicit pauses/date holds, source permissions, claim/file
ownership and genuine technical blockers remain binding. The [readiness direction](technical-readiness-2026-11-05.md)
records the distinction; this does not authorise editing Jira links.

Rules may be developed through trial and improvement. Implementers may select plausible assumptions where the right rule, number or fact is not yet known, observe the results and improve them. Missing confirmation alone does not block demo implementation.

1. **Keep assumptions plausible and explicit.** Give each assumed rule/value a stable key, a short basis for its plausibility and its assumed/verified status. Include units and source/date where applicable. Use confirmed facts when available and record their provenance in the same source.
2. **Establish one canonical machine-readable policy/assumptions source.** The canonical file-backed source is `server/gcsp/policy/seed-v1.json`, read only through `PolicyService` exported by `server/gcsp/policy/index.js` (FUCQ-82). Its typed reads are `getActiveVersion`, `getEligibility`, `getAllowance`, `getPointsCost` and `getAssumption`; all return the resolved policy version and explicit failures. Consumers inject this interface, not JSON or local defaults. FUCQ-83 replaces the file provider with dated PostgreSQL storage through the same port; retained/pinned versions remain explainable.
3. **Make every consumer use that source.** Application services, manual and buddy journeys, Greg's views, calculations, fixture generators and simulations obtain the active assumptions through the shared interface. Clients receive the relevant server-owned projection. Tests read the active defaults from the same source and may supply explicit alternative inputs to exercise behaviour. Keep active values and rule selections out of scattered literals, duplicate defaults and separately maintained client/server tables.
4. **Make correction a one-place change.** Replacing an assumption with a validated rule or real number/fact changes its authoritative entry; consumers pick it up through the shared interface and normal activation/recalculation. Keep configurable rule selections and parameters separate from the code that applies them, so routine policy refinement does not require editing each consumer.
5. **Preserve coherent versions.** Record the policy version used for calculations, runs and offers. A new active version governs subsequent work according to the existing effective-date and quote rules; historical records and pinned active quotes retain the version needed to explain them. Historical snapshots are evidence, not competing active defaults.

Acceptance for relevant implementation: demonstrate that changing an entry in the central source changes the affected calculations and displays consistently, while preserving the required historical/active-offer behaviour. Each story's existing `decided`, `acceptance` and `validate` sections reference this rule and the keys it consumes or introduces.

Plausible synthetic rules permit progress without claiming verified BMW policy, real-system access or successful external actions. The [demo brief](demo-brief.md) and [experience quality contract](experience-quality.md) continue to govern working behaviour and acceptance.

## Refine the experience through hands-on trials

Russell's further direction, 2 November: refine difficult user-visible flows through trial and improvement after the first build. Supply [repeatable manual scenarios](manual-acceptance-scenarios.md), covering the successful journey and applicable difficult cases, so he can reset, click through, observe and improve them. Each relevant implementation Epic contributes its scenarios; shared preparation/reset support is FUCQ-75. A dedicated preparation Story is appropriate when it needs distinct delivery work, rather than automatically creating a test Story under every Epic.

Real employee and ordering-lead walkthroughs are expected after the 12 November demo. Demonstrate the intention clearly to seek BMW's mandate for that refinement. Their prior participation is not a prerequisite for building or demonstrating the proposed experience; existing functional and visual acceptance continues to apply.
