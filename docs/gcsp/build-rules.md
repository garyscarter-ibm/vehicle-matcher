# GCSP build rules

Binding direction from Russell, 2 November 2026. Every GCSP story author, designer, implementer and reviewer reads this file and passes the relevant rules to child agents. These decisions supersede earlier scope-reduction suggestions and requirements to settle every demo policy before building.

## Complete the planned demonstration

All planned capabilities in the candidate demonstration journey and HLD must work. Russell confirms that there is time to build them. Plan sequencing and dependencies toward completing the whole build; the 30-minute presentation slot determines the walkthrough, not a reduced implementation scope. Earlier stretch labels do not justify deferring a planned capability.

**Agreed exception, Russell, 4 November 2026:** follow Gary's FUCQ-6 Q5 recommendation. FUCQ-21 and FUCQ-26 go first; the employee policy uses `rankCars()` directly; FUCQ-22–25 may proceed in parallel; FUCQ-27/28 move to **after 12 November 2026**, protected by the retail baseline. This changes the timing of those two extraction stories. The remaining planned capabilities retain the full-build direction. The [HLD agreement](hld-agreement-2026-11-04.md) records all five accepted review changes.

**Agreed exception, Gary, 4 November 2026 (equal-authority rule, `AGENTS.md`):** the demo data route is real configurations with synthetic stock on top. FUCQ-77 collects at least 200 real, constructible configurations covering every scheme model line, and FUCQ-78 generates synthetic scheme stock on them. FUCQ-61's 10,000-configuration run moves to **after 12 November 2026** if still wanted; FUCQ-62 keeps corpus publication.

**Runtime dependencies (review Q4, 4 November 2026):** the zero-runtime-dependency convention is relaxed for `pg` only, for the GCSP PostgreSQL repository. Any other runtime dependency needs Gary's approval first.

The existing distinction between functioning demonstration behaviour through adapters and future authorised BMW integration remains in force. Architecture review, backlog authoring and execution follow the agreed workflow; recording this direction does not start pollers or publish Jira changes.

## Plausible assumptions in one shared source

Rules may be developed through trial and improvement. Implementers may select plausible assumptions where the right rule, number or fact is not yet known, observe the results and improve them. Missing confirmation alone does not block demo implementation.

1. **Keep assumptions plausible and explicit.** Give each assumed rule/value a stable key, a short basis for its plausibility and its assumed/verified status. Include units and source/date where applicable. Use confirmed facts when available and record their provenance in the same source.
2. **Establish one canonical machine-readable policy/assumptions source.** The first relevant implementation story records its repository location and shared access interface here. This instruction records the build requirement; the runtime source has not yet been implemented by this documentation change.
3. **Make every consumer use that source.** Application services, manual and buddy journeys, Greg's views, calculations, fixture generators and simulations obtain the active assumptions through the shared interface. Clients receive the relevant server-owned projection. Tests read the active defaults from the same source and may supply explicit alternative inputs to exercise behaviour. Keep active values and rule selections out of scattered literals, duplicate defaults and separately maintained client/server tables.
4. **Make correction a one-place change.** Replacing an assumption with a validated rule or real number/fact changes its authoritative entry; consumers pick it up through the shared interface and normal activation/recalculation. Keep configurable rule selections and parameters separate from the code that applies them, so routine policy refinement does not require editing each consumer.
5. **Preserve coherent versions.** Record the policy version used for calculations, runs and offers. A new active version governs subsequent work according to the existing effective-date and quote rules; historical records and pinned active quotes retain the version needed to explain them. Historical snapshots are evidence, not competing active defaults.

Acceptance for relevant implementation: demonstrate that changing an entry in the central source changes the affected calculations and displays consistently, while preserving the required historical/active-offer behaviour. Each story's existing `decided`, `acceptance` and `validate` sections reference this rule and the keys it consumes or introduces.

Plausible synthetic rules permit progress without claiming verified BMW policy, real-system access or successful external actions. The [demo brief](demo-brief.md) and [experience quality contract](experience-quality.md) continue to govern working behaviour and acceptance.

## Refine the experience through hands-on trials

Russell's further direction, 2 November: refine difficult user-visible flows through trial and improvement after the first build. Supply [repeatable manual scenarios](manual-acceptance-scenarios.md), covering the successful journey and applicable difficult cases, so he can reset, click through, observe and improve them. Each relevant implementation Epic contributes its scenarios; shared preparation/reset support is FUCQ-75. A dedicated preparation Story is appropriate when it needs distinct delivery work, rather than automatically creating a test Story under every Epic.

Real employee and ordering-lead walkthroughs are expected after the 12 November demo. Demonstrate the intention clearly to seek BMW's mandate for that refinement. Their prior participation is not a prerequisite for building or demonstrating the proposed experience; existing functional and visual acceptance continues to apply.
