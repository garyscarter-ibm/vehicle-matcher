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

## Programmatic candidate — 11 November follow-up

The collaborator endorsed the narrative principle and requested a programmatic form, explicitly confirming that no runtime LLM will interpret it. The following defines a deterministic candidate for that principle. It is a discussion design, not a change to the running allocator.

### Inputs and stored state

- Identify the employee's choice by employee, entitlement slot and server-owned selection-cycle identity. Each choice can receive at most one active offer. A new selection cycle starts fresh; editing preferences or pausing/resuming does not create a new cycle.
- Store `firstCompetitionMissRelease: integer | null` for that choice. `null` means no retained priority. The integer is the sequence number of its earliest unresolved loss through competition, not a count of refreshes or elapsed days.
- Each real release has a stable ID, increasing sequence number, server-owned random seed and frozen cohort/stock/policy snapshot. Persist one outcome per release/choice. Retries, brief changes and decline/expiry reallocations are not new fairness releases.
- For each participating choice, build its complete suitable-car list using the existing recommendation decisions and server exclusions. A car qualifies only when `gateStatus === 'eligible'` and `suitable === true`, it is available/visible, consent and entitlement permit a hold, and existing declined-car exclusions permit it. Current recommendation code sets `suitable` from the eligibility gates; this candidate adds no minimum preference-score threshold or language-based judgement.
- Participation requires an active buddy, the existing confirmed brief/permission/eligibility facts, a known renewal date and no occupying hold/allocation. Unknown or failed evaluations remain explicit processing outcomes; an error is never converted into an empty suitable list.

### Queue and suitable-car assignment

Generate `ticket = SHA256([release.seed, release.id, choice.identity])`. Sort choices by this ascending tuple:

```text
(
  firstCompetitionMissRelease ?? INFINITY,
  renewalDueDate,
  ticket,
  choice.identity
)
```

Thus protected choices precede unprotected choices; the oldest qualifying miss wins; equal waiting histories use earlier renewal, then the release lottery, then stable identity. This explicitly places waiting history ahead of renewal urgency, changing the current urgency-first policy. Fit ranks cars for an employee, not employees ahead of the queue.

Build the full provisional assignment before claiming cars. For each choice in queue order, use the following deterministic placement rule. Each choice's suitable-car list is ordered by descending existing fit score (null after numeric scores), then exact car ID. `owner` maps exact car IDs to choices:

```text
place(choice, seenCars):
  for car in suitableCars[choice]:
    if car.id not in seenCars AND owner[car.id] is absent:
      owner[car.id] = choice
      return true
  for car in suitableCars[choice]:
    if car.id in seenCars: continue
    add car.id to seenCars
    previous = owner[car.id]
    if previous is absent OR place(previous, seenCars):
      owner[car.id] = choice
      return true
  return false

for choice in queue:
  place(choice, empty set)
```

Free suitable cars are tried first, preserving earlier choices where another free car can serve the later employee. If needed, this can move a higher-priority choice between its suitable cars while preserving its allocation. For A→{X,Y}, B→{X}, it produces A→Y/B→X. Moving a provisional assignment can reduce individual fit within the suitable set to serve another employee; that is an explicit trade-off. Secured offers are outside this provisional reassignment.

For a concrete admission rule, this candidate gives the new tranche's Buddy pass priority over new manual claims on that tranche; remaining cars open to manual claims afterwards. Both routes still use the existing shared atomic claim authority. This admission choice is proposed explicitly and is not current-policy evidence. Another admission policy would need its own precise ordering before fairness could be claimed across both routes.

Claim the saved plan through the existing authority, in queue order. Revalidate versions and suitability. Known conflicts trigger reconciliation of the uncommitted remainder, retaining the original cohort order and all secured offers. Uncertain writes stay pending. Do not finalise a competition miss while a claim or source change remains unresolved.

### Exact outcomes and state changes

Use the frozen suitable list and authoritative secured-claim results, in the following precedence:

| Outcome | Computed condition | Update |
|---|---|---|
| `OFFERED` | A suitable hold/offer was successfully secured for this choice | Set `firstCompetitionMissRelease = null` |
| `NOT_PARTICIPATING` | The choice did not meet the cohort conditions or withdrew before claim | Preserve state |
| `RETRY_PENDING` | Required evaluation, input reconciliation or claim result is unresolved | Preserve state; do not finalise a miss |
| `NO_SUITABLE_STOCK` | Evaluation completed successfully and the frozen suitable list is empty | Preserve state |
| `MISSED_COMPETITION` | The suitable list is non-empty, no offer was secured, allocation is complete, and every car on the list was authoritatively secured for another choice | Set to this release's sequence only if currently null; otherwise preserve the older value |

Any remaining inconsistent/unallocated case is `RETRY_PENDING`, not an inferred competition loss. A later successful offer, including one produced after a decline/expiry within the same release, clears priority immediately. A stale release finalisation must check whether an offer has since been secured for this choice and cannot recreate priority after that opportunity. Use idempotent receipts and version-checked state updates through the repository; a repeated release outcome cannot grant priority twice.

Priority is consumed when the suitable offer is secured, before the employee responds. Rejection, expiry and notification delivery failure create no competition credit and do not restore spent priority. This makes the opportunity, rather than acceptance, the measurable fairness event. This simplified candidate has no extra rejection penalty or `x`/`y`/`z` adjustments.

### Worked decisions

- Three choices and two mutually suitable cars: two offers; the third records this release as its first competition miss. At the next release it precedes both unprotected choices if still participating and suitable stock exists.
- Seven protected choices and three suitable cars: the first three that can be matched receive offers; the rest keep their original priority dates. No impossible next-release guarantee is made.
- A protected choice with no suitable stock receives no offer and retains its date; later choices can still use the stock.
- Declining an offered car does not create a miss. A paused buddy earns no new miss; resuming preserves its existing date.
- Refreshing/retrying reuses the ticket and outcome receipt. Processing errors never create a scarcity credit.

### Validation scope for the follow-up

Documentation-only candidate: compare the queue, placement and outcome rules against the examples above, check the existing suitability definition and comparator, then validate Markdown whitespace and local links. No allocator, policy seed, UI, Jira or product-map status changes are part of this follow-up. Application/browser tests are not run, and the pseudocode is not claimed as an executed production implementation. No test scratch or owned processes are created.

## Current-source evidence and review scope

- [Allocation contract](allocation-contract.md): existing eligibility/brief gates, renewal/fit/lottery policy, decline/expiry distinctions, frozen plans, claim handoff and replay.
- [`lottery()` and `compare()`](../../server/gcsp/allocation/index.js): the present draw hashes seed/run/employee/exact-car identity, and the configured comparator orders employee/car pairs. This is not one freshly drawn employee queue per release.
- [Canonical policy source](../../server/gcsp/policy/seed-v1.json): `allocation.tieBreak.rule` currently selects `renewalDueThenFitThenSeededLottery`; future rule selections and parameters also belong behind PolicyService under the [build rules](build-rules.md).
- [Buddy hold contract](buddy-holds.md): existing atomic hold/claim/offer authority. The review does not establish a new implementation defect or prove the proposed fairness policy.

Validation selected before editing: review the capacity and compatibility counterexamples, inspect the current comparator/policy and claim contracts, check the changed Markdown and relative file links. The changed paths are this note and its entry in the GCSP index. No application callers, fixtures, configuration or integration boundaries change. Runtime, browser and full-suite tests are excluded because this is a discussion record with no executable or UI change; no test scratch or child processes are required.
