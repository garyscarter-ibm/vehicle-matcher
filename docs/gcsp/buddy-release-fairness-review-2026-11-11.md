# Buddy release fairness — proposal review

Discussion captured on 11 November 2026. This is a review of a proposed rule, awaiting collaborator decisions; it does not adopt a policy, set parameter values or authorise implementation/backlog changes.

The capability is fair access to suitable reserved offers for competing employees over successive releases. Practical requirements, eligibility, employee choice and scarce exact-car stock still constrain every offer.

## Proposal under review

- Give each active buddy a random ticket defining its release queue position.
- Move buddies whose employees rejected their previous choice back by `x` places.
- When there are more buddies than released cars, guarantee those missing out a qualifying position next release, bumping them into the last qualifying slot if necessary and relegating its previous occupant.
- Give a buddy below position `y` that finds no good recommendation a jump of `z` places next release.

`x`, `y` and `z`, the meaning of a qualifying slot and adjustment precedence remain unspecified.

## Six gaps to close

1. **Can the next-release guarantee be fulfilled?** With 10 active buddies and 3 cars, 7 miss out. If the next release also has 3 cars, all 7 cannot receive a qualifying place. Even sufficient car numbers do not guarantee sufficient *suitable* cars. Retained priority, ordered by longest qualifying wait and conditional on suitable stock, is a feasible promise; an unconditional next-release offer is not. Multiple protected buddies must be considered together, so inserting a second one cannot evict a first one. Any displacement belongs in the unpublished plan, before reservations are secured.

2. **Does a slot mean a search turn or a suitable reserved offer?** The first `N` queue positions cannot be treated as winners merely because there are `N` cars. A buddy finding nothing suitable should leave the remaining stock available to later buddies. Suitability also links assignments: if A can use X or Y and B can use only X, giving A its first choice X leaves B empty-handed and Y unused, although A→Y/B→X serves both. Queue priority and the objective of serving more employees can conflict; decide which wins before promising either outcome.

3. **Which missed outcomes earn priority, and can the adjustments stack?** Missing out because a suitable car went to someone ahead is different from having no suitable car anywhere in the starting pool. The latter points to a supply/brief gap that a better ticket cannot fix. A missed buddy could qualify for both next-release protection and the `z` jump; a later penalty could also conflict with retained protection. Define one outcome per employee/entitlement per release, precedence, caps, expiry and reset conditions. The `y` threshold creates a cliff between adjacent positions, while fixed place adjustments have very different effects in queues of 2 and 200. A retained scarcity-priority rule may remove the need for a separate `y`/`z` rule.

4. **What behaviour should a rejection penalty discourage?** An inaccurate offer, newly discovered practical problem or changed terms is different from declining an otherwise accurately described match. A blanket penalty can discourage useful feedback and make an employee feel obliged to take an unsuitable car. Expiry and failed notification delivery are separate outcomes. Decide whether a penalty is needed at all; if retained, define its trigger, duration and maximum explicitly. Define whether an actual suitable offer or an eventual acceptance consumes waiting priority, so rejecting or allowing offers to lapse cannot manufacture a scarcity miss.

5. **Where do urgency and the manual route sit?** The current configured rule prioritises renewal date, then fit, then a seeded lottery over employee/car pairs. A lottery-led buddy queue changes that policy. Decide whether renewal urgency outranks waiting protection, whether a fit advantage outweighs a ticket, and how manual claims share the same scarce stock. Fairness history should attach to the employee's entitlement/selection cycle, so recreating a buddy, editing a brief or toggling participation cannot erase a penalty or create extra tickets.

6. **What prevents timing and retries from deciding the winner?** A lottery establishes priority; it does not itself prevent concurrent claims. Freeze the participating cohort, policy version and draw once for each genuine release, persist the plan, and reuse it on retries. A fresh release can have a fresh draw; refreshes, brief edits and reallocation triggers should not offer repeated chances to redraw. Keep the existing atomic shared claim authority for exact cars and entitlements. If manual callers or multiple workers can race, their admission must also respect the chosen priority rule: an atomic first-writer win alone does not enforce lottery order. Count waiting outcomes once at a defined release reconciliation point, rather than on every tick or retry.

## Suggested direction for discussion

Prefer retained priority for verified losses through competition, ordered by waiting history, with a fresh lottery between otherwise equal contenders. Preserve suitability gates and explicitly decide how renewal urgency ranks against that priority. Allocate actual suitable cars across the queue rather than reserving an arbitrary number of queue positions. Keep any additional boosts or penalties bounded and define their relationship to the protected group before selecting `x`, `y` or `z`.

This improves the promise to “your previous miss increases your priority until a suitable opportunity is available.” It still cannot guarantee a car or a fixed waiting time when suitable supply remains insufficient.

## Current-source evidence and review scope

- [Allocation contract](allocation-contract.md): existing eligibility/brief gates, renewal/fit/lottery policy, decline/expiry distinctions, frozen plans, claim handoff and replay.
- [`lottery()` and `compare()`](../../server/gcsp/allocation/index.js): the present draw hashes seed/run/employee/exact-car identity, and the configured comparator orders employee/car pairs. This is not one freshly drawn employee queue per release.
- [Canonical policy source](../../server/gcsp/policy/seed-v1.json): `allocation.tieBreak.rule` currently selects `renewalDueThenFitThenSeededLottery`; future rule selections and parameters also belong behind PolicyService under the [build rules](build-rules.md).
- [Buddy hold contract](buddy-holds.md): existing atomic hold/claim/offer authority. The review does not establish a new implementation defect or prove the proposed fairness policy.

Validation selected before editing: review the capacity and compatibility counterexamples, inspect the current comparator/policy and claim contracts, check the changed Markdown and relative file links. The changed paths are this note and its entry in the GCSP index. No application callers, fixtures, configuration or integration boundaries change. Runtime, browser and full-suite tests are excluded because this is a discussion record with no executable or UI change; no test scratch or child processes are required.
