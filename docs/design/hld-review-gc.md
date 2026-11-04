# GCSP HLD review: Gary's questions and decisions

Review of the GCSP high-level design on `origin/gcsp-poc` (`docs/design/gcsp-high-level-design.md`,
`docs/design/high-level-design.drawio`, head `58d978e`), started 4 November 2026. Jira: FUCQ-6 (In Review).
Each question is **Open**, **Answered** or **Deferred**. Under the equal-authority rule (`AGENTS.md`, 4 Nov) every answer here is a project decision; those marked † change Russell's earlier design and are flagged for his information.

Reassessed on 4 Nov after merging `gcsp-poc` into this branch, which was first cut from `main`. No application code differs between the two; the gap was GCSP docs, scaffolding and the UI ratchet test (234 tests pass after the merge). To resume, ask Claude to "pick up the deferred HLD questions".

## Summary of the HLD

- **What it is:** one canonical draw.io HLD extended with a GCSP parent overview (page 00) and detail pages
  01–08. It covers today's retail matcher, a shared recommendation core, the employee journey (Paula), the
  scheme/ordering lead (Greg), vehicle evidence/VIN, lifecycle, predictive ordering (FUCQ-74) and deployment.
- **Target shape:** a pure, deterministic recommendation core shared by two policies: retail (unchanged
  contracts, six brands, five modes) and employee (hard eligibility/essential gates first, then explained ranking).
  Everything is modules inside the existing Node backend: no new services, except a VIN lookup HTTP endpoint.
- **New stateful core:** briefs, exact-car holds, offers, decisions, cases, event receipts, a notification
  outbox and forecast/plan snapshots, all in one proposed PostgreSQL repository behind a port (not provisioned).
  Hold + offer + outbox commit atomically. The mail transport (Microsoft Graph/ACS or Brevo) sits behind an adapter.
- **Supply:** Greg's `FutureOrderRequest` → provider-acknowledged `ConfirmedSupply` → `ReleasedStock`. Only
  released stock can be held. FUCQ-74 adds an offline-trained discrete-choice demand model plus a constrained
  order planner, with the deterministic fit score kept separate.
- **Policy:** one canonical, machine-readable, versioned policy/assumptions source that every consumer reads
  (build rules, 2 Nov). Plausible assumptions are allowed if they are keyed and labelled.
- **Vehicle evidence:** immutable synthetic VIN registry + 10,000-configuration corpus published as versioned
  static artifacts, separate from the mutable SQL store. Synthetic VINs never reach a real decoder.
- **Identity:** `DemoIdentityAdapter` behind the existing shared-password gate. Offer emails use hashed,
  run-bound opaque tokens.
- **Deployment:** Pages (from `main`, rewrites `block.html`'s `data-api`) + Render free plan (`render.yaml`),
  plus `sync-block.yml`, which pushes block changes on `main` to `poc-ret-eds-sites`. Release order: additive
  backend first, then frontend. SQL, the runner and the mail sender are prerequisites for transactional features.
- **Status:** everything GCSP is purple (proposed). Nothing built, provisioned or sent. Final agreement belongs
  to Russell/Gary.

## Context that shapes the questions

- The demo is 12 November: 8 days away. The build rules (2 Nov) require full planned scope, with no stretch items.
- The repo convention is zero runtime dependencies. Postgres, a solver or ML training would break it.
- The Render free plan sleeps after about 15 minutes idle. The HLD itself says that is not a job runner.
- `gcsp-poc` is 15 commits ahead of `main`. Merging to `main` publishes to Pages *and* syncs the block to the EDS repo.

## Questions

| # | Area | Question | Recommendation | Status | Answer / note |
|---|---|---|---|---|---|
| Q1 | Release | Where does GCSP run before 12 Nov: a separate Render service + Pages route from `gcsp-poc`, or merge to `main` and the existing hosts? | Separate environment; keep `main`/retail untouched until after the demo | Answered | Separate env from `gcsp-poc`; `main` and retail untouched until after the demo. Frontend is a Render static site built from `gcsp-poc` (Pages publishes one site, from `main`). |
| Q2 | State | Which durable store for briefs/holds/offers/outbox? | Managed Postgres (synthetic data only) behind the repository port | Answered | Managed Postgres. **Flag to Gary if it will significantly increase costs.** Unverified estimate: Render free Postgres (expires after 30 days) or Neon free tier is about $0; Render paid is about $6–7 a month. |
| Q3 | Background work | What runs expiry/release/escalation when no browser is open? | Presenter ticks only for the demo; no unattended promises | Answered | Presenter ticks. No unattended expiry or watch promises in the demo. |
| Q4 | Conventions | Is the zero-runtime-dependency rule relaxed (e.g. `pg`)? | Allow `pg` only; anything else needs your approval | Answered | Allow `pg` only. Any other runtime dependency needs Gary's approval. |
| Q5 | Engine | Extract the shared core (FUCQ-8) before the demo, or have the employee consumer call the current engine and extract afterwards? | Call the current engine now; extract after 12 Nov under parity tests | Answered | Option A †: FUCQ-21 (baseline) + FUCQ-26 (typed terms) first; employee policy calls `rankCars()` directly (it already scores exact cars before grouping); FUCQ-22 to 25 in parallel; FUCQ-27/28 after 12 Nov under the baseline. Jira dependencies re-pointed: FUCQ-29/30/31 no longer wait on FUCQ-27/28. |
| Q6 | Policy source | Where does the canonical policy/assumptions source live, given Greg publishes versions at runtime? | Repo file seeds v1; DB versions are runtime authority | Answered | Resumed 4 Nov: Postgres tables shaped like the target model (dated scheme-rule links, include/exclude rules, per-scheme price plan, grade allowance), seeded from a reviewed repo file; Greg's publish writes a new dated row; one PolicyService reads it. No extra infrastructure cost (Postgres already agreed in Q2), just a few more tables than a JSON blob. |
| Q7 | VIN lookup | Should the backend vehicle adapter call its own HTTP endpoint (as designed) or the module in-process? | In-process behind the port; HTTP endpoint for external use and tests | Answered | In-process port †. HTTP route wraps the same module; contract tests prove parity. Overrides the HLD's self-call rule. |
| Q8 | Frontend | Employee/Greg UI: new modes in the `vehicle-matcher` block, or separate blocks sharing the kit? | Separate blocks reusing shared modules | Answered | Separate EDS blocks importing the shared kit; `vehicle-matcher` stays retail-only. |
| Q9 | Scope | Accept full scope by 12 Nov as the build rules require? | Accept, but name a critical demo path that must be green first | Answered | Full scope, with a critical demo path (Paula offer → decline → second offer → select; Greg dashboard) green first. |
| Q10 | FUCQ-74 | Learned model trained on synthetic data as the primary planner signal? | Deterministic baseline primary; learned model shown, labelled synthetic | Answered | Deterministic expressed-demand/fit baseline drives the plan; learned model runs alongside, labelled synthetic-trained. |
| Q11 | Mail | Which transport for the demo? | Captured outbox viewer always; one real transport if ready | Answered | Outbox viewer always; one real transport (Microsoft or Brevo) if sender setup is ready. |
| Q12 | EDS sync | Gate `sync-block.yml` while GCSP changes the shared block? | Manual dispatch only until after the demo | Answered | Leave as is. GCSP blocks won't go to EDS; the demo wraps them in dummy pages hosted in the repo on GitHub Pages. |
| Q13 | Vehicle identity | Is VIN the right key to synthesise (FUCQ-19/20)? | Key by synthetic order reference + configuration; VIN optional | Answered | † Resumed 4 Nov after the knowledge-base answers: exact stock keyed by synthetic order reference + configuration. VIN only on delivered cars (e.g. Paula's current car). Re-scope FUCQ-19/20 (stories FUCQ-52 to 63): keep the distinct-configuration corpus; the VIN generator covers current cars only. Formats fixed after round 3: `orderUuid` key, 7-digit `orderNumber` for display, `configurationId` in the target's Base64 form. |
| Q14 | Integration target | Which platform do the demo's adapters and later BMW integration gates model: the legacy mainframe or the target AWS platform? | Target AWS platform | Answered | † Gary, 4 Nov: build against the target AWS platform (built or in build), not the mainframe. HLD's demo brief says "GCSP remains a UI over the mainframe for now"; the BMW-integration gates and adapter contracts should be re-pointed at the AWS target once the knowledge-base answers are in. |
| Q15 | Holds | The target cart hold is about 2 minutes, first come first served. The demo's buddy holds for hours. | Two hold types | Answered | Keep the short manual cart hold as the target has it; present the longer buddy offer hold as a proposed new capability, labelled, with a configurable duration. |
| Q16 | Paula's journey | Is "lower max contribution" (blueprint step 07) right for a Choices employee? | Change a preference instead | Answered | † After declining, Paula confirms one preference change (e.g. body style or an essential), not a contribution ceiling. Agreed by Russell, 4 Nov (`docs/gcsp/hld-agreement-2026-11-04.md`). The 2024 Choices guide's £1 per point top-up stays in the policy source as a keyed assumption but doesn't drive this step. |
| Q17 | Connected-use data | The target has no usage or connected-car feed, but the demo opens with MPG/mileage summaries. | Keep, labelled future | Answered | Keep with synthetic data, explicitly labelled a future capability needing a new data source. |
| Q18 | Reuse story | The target front end is Angular with the group design system, with no documented way to add external components. | Web components | Answered | Package the employee/Greg blocks so they also mount as standard custom elements, so the claim is "drops into the target Angular app". New build requirement on Q8's blocks: no inline scripts, inline event handlers or `eval` (target CSP, round-2 answer 6). |
| Q19 | Lifecycle states | Use the target's real approval and appointment stage names? | Adopt target states | Answered | Synthetic order/appointment lifecycle uses the target's approval stages and appointment states; HR approval configurable because the target may drop it. Replaces the HLD's own post-selection state names. |

## Knowledge-base findings that affect the HLD (4 Nov)

The answers came from the AWS migration knowledge bases, anonymised. They stay **outside this public repo**: this
section records only what they change for the design, in general terms.

| Finding (target platform) | Effect on the HLD |
|---|---|
| A VIN is assigned only partway through the order lifecycle. Stock offered to the scheme is identified by an order reference, with no VIN. A delivered (current) car has one. | Confirms Q13. Key exact stock by a synthetic order reference; VIN optional. Re-scope FUCQ-19/20. |
| Cars reach the scheme when the ordering system reassigns them to the scheme's stock accounts. GCSP pulls the list; no stock events reach GCSP. | Model "release" as stock appearing on the next pull (fits presenter ticks, Q3), not as a pushed event. |
| Future orders live upstream with separate requested/confirmed production and delivery dates on one status scale. GCSP doesn't create them directly. | The HLD's request → confirmed → released split maps onto that status scale. Greg's "submit order" is a request to the ordering side, not a GCSP write. |
| Holds are a short local cart hold in the GCSP database (about two minutes), first come first served, and nothing upstream is told. Saving turns the hold into an allocation in one transaction. | The HLD's local-SQL hold design matches the target. Remote-reservation reconciliation is needed only on the save-time order update. A buddy offer hold measured in hours is a new concept. |
| Eligibility rules are structured and machine-readable in the GCSP database: dated scheme-rule links, include/exclude rules, field ranges. Points sit on a dated per-scheme price plan; grade sets an allowance. | Gives the policy source (Q6) a real shape to copy. |
| An older answer says Choices has no cash top-up; contribution rules aren't documented. | The 2024 Choices guide allows £1 per point; kept as a keyed policy assumption. Q16 uses a preference change, so the demo doesn't depend on it. |
| No vehicle usage or connected-car data is available to GCSP. | The demo's "connected-use summaries" have no target source. |
| The target front end is Angular with the group design system. The backend is Java services on managed PostgreSQL. No EDS and no documented way to add external components. | Postgres confirms Q2. The "reusable blocks" story needs a credible embedding route (Q17). |
| Approval stages and appointment states exist (HR and sales-manager approval, sent to ordering, appointment scheduled/completed). | Adopt them as the demo's synthetic lifecycle states rather than inventing new ones. |
| Employee and driver data is now stored locally in GCSP's own database. | Matches the demo storing employee records in its own Postgres. |
| No KPIs or reports exist for order volumes, time to order or unallocated stock. Order flow, allocation and cart designs are still drafts. | Greg's dashboard is net new, and the demo can inform designs that aren't settled yet. Worth saying in the pitch. |

## Round-2 knowledge-base findings (4 Nov)

| Finding (target platform) | Effect on the demo |
|---|---|
| The allowance is set by company and grade, with a monthly points cost per car. An order is blocked when the allowance is too low. A cash top-up is unconfirmed for the target. | Supports Q16 (preference change). The points allowance is the affordability gate; the top-up stays an unused keyed assumption. |
| No rule requires home charging for electric or plug-in cars. | Paula's charging question is a demo assumption. Label it in the policy source, not as a BMW rule. |
| Quota setting, order lead times and release sizes aren't documented. | Greg's planning inputs and the synthetic release sizes are plausible keyed assumptions. Nothing in the target contradicts them. |
| Releases come in weekly windows plus campaigns, first come first served. | This is the problem the buddy solves (employees racing for stock). Use it in the pitch. |
| The target captures no preferences, saved searches or stock alerts. | The buddy is genuinely new to the platform, not a reskin. |
| Nothing rules out bundling web components into the Angular app. The content security policy forbids inline scripts and `eval`. | Q18 stands, with a build rule: GCSP blocks use no inline scripts, inline event handlers or `eval`. |

## Round-3 knowledge-base findings (4 Nov)

| Finding (target platform) | Effect on the demo |
|---|---|
| A configuration ID exists, separate from the order: Base64 of the VG model code, a colon and the sorted option codes. It is used to group identical configurations. | `configurationId` follows this rule (HLD "Synthetic identifier formats"). Separator, paint/upholstery inclusion and padding are keyed assumptions. |
| The allocation key is the order UUID. The order number is a short digit string with leading zeros; the wholesaler order ID is an integer. | Stock, holds and allocations key on a synthetic `orderUuid`; employees see a 7-digit `orderNumber`. |
| Stability of order identifiers through amendment isn't settled. | Identifiers never change within a demo run (keyed assumption). |
| Specification fields are named model codes, range, series, body, fuel, drive, colours, upholstery code and an equipment map keyed by option code. | Synthetic records use those field names, so a real source maps onto them directly. |
| Which code eligibility rules and points prices match isn't defined. | Policy rules match on a keyed field in the policy source. |

## HLD pages these decisions change

To be applied in one pass now that sign-off isn't required (equal-authority rule, 4 Nov).

| Page | Changes |
|---|---|
| 00 GCSP architecture | Separate GCSP blocks, also packaged as web components (Q8, Q18); no EDS route (Q12); integration target is the AWS platform (Q14†) |
| 02 Shared recommendation target | Interim: the employee policy calls `rankCars()` directly; shared evaluator after the demo (Q5†) |
| 03 / Employee data adapters | Exact stock keyed by order reference + configuration (Q13†); connected-use marked future, synthetic only (Q17); adapters modelled on the target's fleet, pricing and eligibility services (Q14†) |
| Employee transactions | Two hold types: short cart hold and proposed buddy offer hold (Q15); policy as dated tables behind one PolicyService (Q6); presenter ticks, no unattended runner (Q3) |
| 04 Migration and regression | New order: FUCQ-21 + 26 first, 27/28 after the demo (Q5†) |
| 05 Deployment and integration | Separate Render backend + Render static frontend from `gcsp-poc` (Q1); managed Postgres (Q2); EDS sync isn't a GCSP dependency (Q12); BMW gates re-pointed at the AWS target (Q14†) |
| 06 Vehicle evidence providers | VIN lookup in-process behind a port (Q7†); VIN only on delivered cars; corpus keyed by configuration (Q13†) |
| 07 Planning and lifecycle | Target approval and appointment state names (Q19) |
| 08 Predictive order planning | Deterministic baseline drives the plan; learned model shown alongside, labelled synthetic (Q10) |
| 01 Current implementation | No change |

## Fact checks for Gary (from GC-001)

These are facts only the dashboard owner can confirm. They aren't design choices.

- [ ] Who owns the Render service and the Pages site?
- [ ] Which branch/revision does Render auto-deploy, and is the live plan the free plan in `render.yaml`?
- [ ] Is `DEMO_ACCESS_KEY` set on the live service?
- [ ] Who holds the `EDS_SYNC_TOKEN` for `poc-ret-eds-sites`, and who else consumes that repo?
