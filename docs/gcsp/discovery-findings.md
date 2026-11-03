# Employee car scheme discovery findings

Reviewed 31 October 2026 on `gcsp-poc`, updated 1 November. Russell authorised backlog housekeeping and five foundation items. FUCQ-2 remains the conversation entry point, outside the actionable backlog; FUCQ-3 records the completed personas. The 22 product capabilities remain proposals for later refinement.

## What this project needs to demonstrate

Russell's clarified deliverable is the **12 November BMW demonstration**. It must answer what GCSP's modernisation makes possible and demonstrate IBM's AI-enabled delivery approach through reusable EDS-style blocks, ambitious experiences and credible functioning behaviour. The [demo brief](demo-brief.md) records the purpose, adapter requirements and candidate moments. Live BMW deployment is not the immediate objective; the final feature set and epic structure remain open.

Russell has since specified the required elements: employee home with current-car/connected data, contract countdown, preferences and buddy switch; tranche-release trigger; ideally real email; an offer landing page; and Greg's aggregate demand, future ordering, points and weighting controls. The buddy can recommend and temporarily reserve; roughly two hours is proposed, with rejection/expiry returning the car to the pool. Preferences will use sliders/structured input without a required site LLM. A 1,000-employee route comparison is a stretch goal. The six broad grouping statements are retained as hills; the [capability-level proposal](capability-breakdown.md) gives a finer decomposition for review. Existing Jira objects have now been reused for the foundation work below.

Russell prefers investigating Microsoft email using his Entra developer setup, documented in Trailblazer. The authorised read-only project review found Entra/profile access and a historical Outlook connection, but did not verify a current sender mailbox, `Mail.Send` authorisation or Azure Communication Services Email setup. The [demo brief](demo-brief.md#email-adapter-and-microsoft-setup--checked-1-november) records the evidence and provider choices. Every mail provider requires an adapter; Brevo remains available as an alternative. No tenant changes or emails were made.

## Foundation backlog — refreshed 1 November

Russell authorised retitling and populating these items, preserving Jira objects and their history. All five are Medium / To Do, with no implementation stories or poller started:

| Jira item | Current purpose |
|---|---|
| [FUCQ-4](https://ibm-consulting.atlassian.net/browse/FUCQ-4) | Agree the end-to-end process in a visual HTML flow. |
| [FUCQ-5](https://ibm-consulting.atlassian.net/browse/FUCQ-5) | Investigate and prove BMW UK website/configurator data interfaces. |
| [FUCQ-6](https://ibm-consulting.atlassian.net/browse/FUCQ-6) | Agree the high-level design. |
| [FUCQ-7](https://ibm-consulting.atlassian.net/browse/FUCQ-7) | Recreate the current GCSP selection journey with shared components. |
| [FUCQ-8](https://ibm-consulting.atlassian.net/browse/FUCQ-8) | Assess reuse of the existing recommendation intelligence. |

FUCQ-2 is retained as discovery context and no longer carries the backlog label, so the feature picker will not treat the overall conversation as implementation work. FUCQ-3's description now points to the repo rather than Confluence and is Done, reflecting the persona drafts Russell acknowledged. FUCQ-9 to FUCQ-12 are Rejected with a superseded label and explanatory comments; the underlying ideas remain in the discussion and capability proposal. Nothing was deleted. The five foundation descriptions were read back and verified against the authored updates.

Russell subsequently requested [FUCQ-13](https://ibm-consulting.atlassian.net/browse/FUCQ-13), a shared employee-car/used-car launcher with the brand switcher. FUCQ-4 now includes unresolved-renewal flags, Greg's manual-intervention jobs and next-best options, with recovery priority left for policy refinement. FUCQ-6 now includes the technical release path and later BMW integration conditions. These additions preserve the original 22 proposed capabilities.

The clarified demo outcome is agreement to discuss a 2027 next-generation front-end roadmap across FS and NSC, alongside evidence that agentic coding can support account delivery now. See the [demo brief](demo-brief.md), [delivery evidence](delivery-evidence.md) and [questions for GC](questions-for-gc.md). Human presentation logistics belong to Russell. The deployed frontend's configured Render API was identified and its health endpoint verified on 1 November; deployment settings remain for Gary to confirm.

The existing product helps one consumer find an approved-used car in retailer stock. The BMW opportunity concerns employees choosing their next scheme car, and potentially how the scheme team forecasts demand and allocates scarce cars across employees. These are related problems with different data and rules.

The strongest opportunity in the research is to capture what employees actually want before availability and time pressure distort their choices. A better recommendation screen can help, but by itself it cannot remove the allocation race or improve production planning.

## Evidence reviewed and its limits

- [Background and source summaries](background.md): the portal walkthrough with Sandeep, 2024 IBM proposal, 2025 user stories/process map, and October/November 2024 discovery notes.
- [Choices guidelines v1.6](sources/choices-car-scheme-guidelines-v1.6.md), June 2024: scheme mechanism, eligibility, contributions, ordering, renewal, insurance and contract constraints. Its stated next review was June 2025. Three relevant figures did not survive extraction: the family tree, age/licence table and ordering-window table.
- [Eligibility matrices](sources/choices-eligibility-matrices-2024-10.md), effective October 2024: separate FS/UK and RR/Production grade bands, model/engine eligibility and towbar markers. They contain neither points prices nor grade allowances.
- All eight [portal screenshots](screens/), reviewed visually. These come from INT with junk data; they establish layout and the steps, not valid prices, rules or dates.
- [Mural process map PDF](sources/mural/timeline-2024-11-07.pdf), reviewed visually, and its CSV sticky-note export. This documents the ordering lead time and the gap between production planning and employee selection.
- Current source, component catalogue, API and engine tests, deployment configuration, and the main product audits and decision records. Some older design documents still say “not built” although the current source implements the change.

These materials support a credible demonstration. They do not establish BMW's current 2026 policy or production integration contracts. Original Box decks and PDFs referenced by the summaries were not separately retrieved.

## Agreed eligibility baseline

Russell confirmed on 31 October 2026 that the eligibility data in the research should be used as the POC baseline despite its age. A newer policy release is not a prerequisite for this POC.

Use the October 2024 vehicle eligibility matrices as supplied, selecting the matrix for the employee's organisation:

- **FS/UK (BMW / FS & Alphabet):** G1–6, G7, G8–10 and G11–14; eligibility is recorded per model/body, engine and grade band.
- **RR/Production:** PG1, G8–G10 and G11 & G12, with its own eligibility decisions. Do not translate its grades into FS/UK bands or assume the same model access.
- Both cover BMW only, including electric and M models, and identify towbar-capable derivatives. Neither contains points prices or allowances.

For example, the FS/UK baseline permits a G7 employee a 320i or 330e but reserves the M340i for G8–10 and above. Full M models are restricted to G11–14. RR/Production permits PG1 employees a 320i or 330e, but not an M340i; its full M models require G11 & G12.

The June 2024 Choices guidelines supply the available general eligibility rules: age 18+, exclusion of interns/apprentices/Year 1 graduates, and a second family/partner car from G9 for the population described by that guide. Detailed driver-age/licence thresholds and the family tree remain absent from the extracted figures; use explicit demo assumptions if those details enter scope. Points/allowance amounts and scheme inventory are separate data gaps. The model/engine eligibility baseline itself is available and agreed.

## Background and business problem

The portal starts from an employee account and existing contracts. The ordering wizard selects scheme, driver, contract, collection and brand, then a series/body style, an actual available vehicle, vehicle details, terms and confirmation. Approval and later handover occur after this journey. Cars are selected from the scheme's available stock, not freely configured.

The walkthrough records a two-minute vehicle hold followed by five minutes to accept terms. The earlier proposal describes a Monday-morning race. That disadvantages employees who cannot be online at release time and confuses an available compromise with a positive preference.

The 2024 proposal suggested ranked first/second/third choices plus a later satisfaction score. The 2025 follow-on adds an administrator controlling model minimums/maximums, a production availability response, allocation to employees, and priority after a disappointing previous allocation. One process example asks for five choices despite the employee stories asking for three. These are proposals and unresolved policy choices.

Historical orders alone cannot reveal unmet demand. Training on them can reproduce the constrained race. Useful future observations would distinguish ideal preferences, acceptable alternatives, the cars available at decision time, the offer, the employee's acceptance/rejection and later satisfaction.

The scheme also has commercial and operational objectives: throughput, residual values, fleet mix, timely renewals and less manual administration. The 2024 notes describe about 7,500 scheme vehicles, a three-person team, 300–400 weekly releases and 40–50 unallocated cars per stock review. Those are dated discovery estimates, not verified current baselines. The reported TNR channel changes reduce the ability to move unwanted cars elsewhere, increasing the value of getting the mix right.

## Rules that matter to recommendations

Eligibility is a gate before ranking. It depends on the employing organisation and its grade bands, scheme, nominated driver, age/licence and insurance restrictions, vehicle allowance and renewal window. A high lifestyle score cannot override it. For example, the FS/UK matrix allows a G7 employee a 320i but not an M340i; the RR/Production matrix uses different bands.

Contributions are monthly points and potentially salary top-ups. The 2024 guideline allows cash contributions at £1 per point above entitlement, but this does not remove model eligibility restrictions. The scheme uses an interest-free purchase loan and Alphabet buyback arrangement, with taxable benefits; it is not safe to reuse a normal retail PCP or salary-sacrifice tax calculator. Actual points, allowances and any net-cost claims need their own authoritative data.

The employee can normally select only existing specifications. Towbar and lumbar-support requests are limited exceptions. A preference for an option must not imply that an unavailable configuration can be ordered.

The sources conflict on several rules:

| Topic | Evidence | Consequence |
|---|---|---|
| Contract duration/mileage | Walkthrough: six months/6,500 miles for Options and ten months/10,500 for Preferences. June 2024 Choices guide: up to nine months/8,000–10,000 miles. November 2024 note anticipates 18 months under TNR. | Select and date the demo's scheme rules explicitly. |
| Release time | Earlier proposal: 9am Monday race. Walkthrough: Monday/Wednesday/Friday, Monday at 11:30. | Avoid presenting either as current verified policy. |
| Scheme/brand coverage | General guide includes BMW/MINI; stock-management note says MINI unavailable for normal Choices at that time. | Confirm first scheme, employer population and brands. |
| Ranked list size | Stories use three; a process example uses five. | Decide whether the first POC captures a shortlist, allocates cars, or both. |
| Driver rules and cost | Detailed driver figures are absent from the extracted guide; matrices have no points values. | Use the agreed 2024 model eligibility baseline. Recover missing figures or mark demo assumptions only for the details not supplied. |

## Codebase and reuse

The application has two deployables: a portable Adobe EDS block using vanilla JavaScript/CSS with no build step, and a zero-dependency Node HTTP backend. `server/brands.js` controls six brands: BMW, MINI, Ford, Honda, Motorrad and Ferrari. BMW/MINI use retailer feeds, Honda/Motorrad/Ferrari have bespoke live adapters, and Ford currently uses fixtures. Tokens and brand copy supply the visual/voice variations.

`blocks/vehicle-matcher/vehicle-matcher.js` supplies brand, API, retailer, scope and copy context, then mounts a registered mode. The registry contains `questionnaire`, `swipe` (file `mingle.js`), `head-to-head` (`knockout.js`), `podium` and `guess-who`.

| Existing piece | Reuse potential | Scheme-specific work |
|---|---|---|
| EDS shell, BMW tokens and mode contract | A dedicated employee experience can use the same shell and presentation foundations. | Add explicit scheme/employee context; retailer and dealer/national scope do not describe scheme eligibility. |
| `question-ui.js`, `preview-feed.js`, `ui.js` | Preference capture, sliders, conditional questions and debounced live recommendations. | Ask about scheme-relevant costs and needs. Keep employee constraints authoritative. |
| `result-card.js` | Photos, model/specification, colours, variants and explanation layout. | Points, top-up, availability date, scheme action and allocation state; retail price and dealer link currently dominate. |
| `server/engine.js` | Pure deterministic ranking, reasons, trade-offs, honest tie/weak-result handling and grouping. | Separate eligibility/cost rules and supply an appropriate vehicle schema. |
| Stock adapters and mapping | Established boundary between external data and the engine. | Scheme inventory or synthetic fixtures, stable vehicle identity, exact derivative/specification and collection availability. |
| Audits and tests | Regression protection and reproducible persona evaluation. | Employee personas and scarcity/eligibility scenarios; consumer tuning is not scheme validation. |

The engine applies budget/practicality hard filters, then combines fit at 80% and taste at 20%. It is a rules-based recommender, not a trained ML model. Its retail budget permits up to 15% stretch. Body/fuel preferences can be missed and disclosed as trade-offs; this behaviour must not become a way to soften scheme eligibility or a stated hard contribution limit.

Most modes use shared HTTP matching/preview endpoints. Guess Who is an important exception: `/api/pool` sends a compact complete display/filter pool and filters it in the browser. A future employee pool would need eligibility enforced on the server before it is returned.

The current server has no employee account store, saved preference records, satisfaction history, reservation/order state or multi-employee allocator. The optional shared demo access key is not employee authentication or role-based access. Retail stock is cached, including stale fallback, so displaying a car does not reserve or guarantee it.

Model-level specifications in `mapping.js` include fallbacks and some estimates. Grouping merges similar listings and unions their equipment. That is useful for discovery, but an allocation must refer to one exact available vehicle and its actual specification. Dealer distance should also be distinguished from the scheme's permitted handover locations and dates.

## Product and technical challenges

1. **Define the claim.** Recommendation for an employee, fair allocation across employees and demand planning are three separately demonstrable capabilities. A good shortlist does not prove the latter two.
2. **Define fairness.** Ranked preferences, previous disappointment, urgent renewal, lotteries and role requirements can conflict. The policy needs a visible explanation, not just a hidden weight. Ranking one person's cars cannot prevent several people receiving the same car.
3. **Make costs credible.** The supplied research has eligibility but lacks the actual points/allowance tables. Synthetic values can demonstrate behaviour if clearly identified. They cannot substantiate take-home-pay claims.
4. **Represent scarcity honestly.** Preferences, recommendations, offers, holds, accepted allocations and approved orders are different states. Real holds need atomic server-side state and expiry/revalidation; a POC may simulate them, but should say so.
5. **Show business influence openly.** Model quotas and stock-clearing goals can help the scheme, but explanations should distinguish an employee fit from a business constraint. Do not quietly downgrade preferences and claim a better personal match.
6. **Measure against realistic employees.** Existing audits found that random answer sets overstated how much questions influenced results. Use realistic employee personas and deliberate collisions for a scarce car, plus ineligible, unaffordable, unavailable and no-acceptable-car cases.
7. **Keep the demonstration reliable.** Live retail feeds and Render cold starts create avoidable dependencies for a scheme demo. A versioned scenario dataset and a clear deployment route for this branch would make demonstrations reproducible.

## Current discovery direction

Russell confirmed on 31 October 2026 that we should build the backlog first and avoid rushing into feature proposals. The first idea is to create personas, recorded as [FUCQ-3](https://ibm-consulting.atlassian.net/browse/FUCQ-3). Three provisional drafts now cover the employee car chooser, scheme ordering lead and platform IT director; see the [persona index](personas/README.md). They separate source-backed context from hypotheses and candidate measures. They are discovery drafts, not validated interviews or agreed feature requirements.

Russell confirmed on 31 October 2026 that project documentation and personas should stay in the repository because Confluence is unavailable to the team. Keep employee personas in [personas/](personas/README.md), linked to FUCQ-3. The earlier Confluence storage option is superseded; no Confluence setup is required for this project.

Sandeep Sundar is our contact currently working on the backend system and supplied the screenshots. Russell will put questions to him. Maintain the running [questions for Sandeep](questions-for-sandeep.md), starting with vehicle points prices and employee allowances, and capture answers as they arrive.

Following the persona drafts, Russell proposed advance preferences/proactive selection, stick-or-twist choice, retaining the manual route, a more exciting employee experience, dynamic points, demand nudges and preference-informed ordering. These were initially captured as exploratory ideas in FUCQ-4 to FUCQ-10, then repurposed or superseded in the foundation refresh above. The underlying ideas remain in the [capability proposal](capability-breakdown.md). The [business model exploration](business-model-exploration.md) critiques their economics and incentives, with a separate [argument check](business-model-argument-check.md). No allocation policy, points policy or feature implementation has been approved. Questions SAN-006 to SAN-010 cover supply constraints, lifecycle economics, pricing authority, fair access and return timing.

Russell subsequently clarified that the model should elicit lifestyle/taste attributes before specific vehicle choices, allowing recommendations to shape employee demand and BMW's future used supply. Employee model demand and residual outcomes are responsive to the mix, not fixed inputs. X-or-y preference questions and an adjustable EV emphasis for UK regulatory objectives were initially captured as FUCQ-11 and FUCQ-12; those records are now superseded, with the ideas retained in the capability proposal. The exploration reflects this framing; the [primary-source EV check](zev-mandate-research.md) supports the general new-registration principle, while BMW-specific accounting and priorities are covered by SAN-011.

Russell clarified that exploratory discussion should remain between us until the shape is agreed, followed by agreement on bounded backlog items. FUCQ-2 remains the conversation entry point. The 1 November housekeeping above was explicitly authorised; capture further discussion in the repo before making further discussion-driven Jira updates. All scaffolding stays on.

Russell has also confirmed that the 22 proposed capabilities are useful and should be retained. The foundation work should inform their later scope, order and detail. They remain product directions for progressive refinement rather than discarded ideas or a fixed implementation plan.

The latest discussion explores preference spectra, distinguishing strength of preference from importance, and recommendations anchored in the employee's current car. VIN-linked specification, connected-use observations and explicit feedback about whether and why the employee likes the car provide different evidence. Russell's hypothetical satisfied, high-mileage 5 Series Touring driver should have a suitable next Touring as a leading option where needs continue. The same current-car context should appear in future visuals. These refinements are recorded in the [business model exploration](business-model-exploration.md); SAN-012 asks what current-car data is actually available.

## Collaboration and scaffolding

- All four pieces are enabled: design, inbox, Jira backlog and component kit. FUCQ board 2132 was read from Jira and has Story point estimate and the expected review column. Its recorded board-only setting is inherited, not independently verified in the Jira navigation.
- [FUCQ-2](https://ibm-consulting.atlassian.net/browse/FUCQ-2) is the conversation entry point, last checked as Medium / To Do, outside the actionable backlog. The five foundation items are authorised; agree further bounded items as that work informs the product direction. No implementation stories or poller were started.
- Gary's repository login is verified as `garyscarter-ibm`. He will use a separate machine/clone; Russell will add his Jira access before work starts.
- Shared integration branch: `gcsp-poc`, already recorded as `base_branch`. Story work uses separate `dev/<story-id>` branches/worktrees and remote claim leases. The shared checkout stays on the integration branch; merges are serialized by the workflow.
- Team members: `usget` (Russell, unprefixed IDs) and `garyscarter-ibm` (Gary, `GC` IDs). Russell remains the inbox/workflow owner, preserving the existing setting; Gary owns the GitHub repository. No protected data paths are designated.
- `.claude/scaffolding.json` was previously ignored. It is now shareable through a specific `.gitignore` exception. `.claude/member.json` and other machine state stay local. Gary's clone will need `python3 -B _tools/dev_mail.py team --me garyscarter-ibm` after receiving these changes, followed by his own Jira member setup once access exists.
- Refreshed vendored `_tools/scaffold_git.py` from 1.3.0 to 1.4.0; the other inbox tools were already current. The generated project `AGENTS.md` section was checked and is unchanged.
- The component catalogue and UI ratchet exist. No gallery or draw.io HLD exists yet. Under the scaffolding workflow the first feature design creates the HLD before implementation; this discovery review does not specify a new architecture.
- Codex's live gateway check passes for IBM Global. The general doctor separately reports Claude's default Anthropic endpoint; that is not the active Codex endpoint. The managed-install refresh was staged, but applying it requires the user's macOS password, and repinning Claude's plugin requires quitting Claude Desktop. Neither was applied during this review.
- GitHub Pages deploys from `main`; no dedicated `gcsp-poc` deployment is defined in the workflow. Backend branch selection on Render was not checked.

These setup and discovery changes are local and uncommitted. Existing research files were left intact. They must be committed and shared before Gary's clone can receive them.

## Validation

`npm test`: **234 passed, zero failures** on 31 October 2026. This covers existing engine, API, rendering and UI ratchet behaviour. It does not validate current BMW policy, a live scheme integration or future allocation logic. Scaffolding CLI/team configuration checks were also run after setup.

## Questions to revisit after personas and backlog discovery

1. What should BMW see at the end of the first demo: a better recommendation/shortlist, a fair allocation, a demand-planning dashboard, or a complete story across these?
2. Are we improving selection from today's stock, capturing future preferences before production ordering, or supporting both as clearly different journeys?
3. Which employee/scheme population is first: FS/UK Choices, Production/RR, Preferences, or a simplified fictional scheme? BMW only or MINI as well?
4. With the research eligibility data agreed as the baseline, can we obtain points/allowance amounts and scheme inventory, or should those use explicitly synthetic values? Detailed driver-table rules need recovery or assumptions only if the chosen journey uses them.
5. If allocation is included, what does fairness mean, and what should happen when several employees want the same car or none of their choices is available?
6. Where should the POC stop: saved preferences, simulated offer/acceptance, or a handoff to the existing portal? Does any real BMW system need to participate?
7. The demo is 12 November, 30 minutes, with Stuart, Gareth, Raj, Ian, Stephen and other direct reports. What is the running order, how should Russell/Gary divide ownership, and where will the branch's demo be hosted?
8. The adapter requirement is agreed: source data may be synthetic, while selected business behaviour must function and remain usable with future BMW adapters. Which existing backend capabilities should be extended for the agreed story? Authoritative scheme rules and saved/allocation state need additional behaviour; simply changing a mode does not provide them.
