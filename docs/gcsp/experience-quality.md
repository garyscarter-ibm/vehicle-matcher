# GCSP experience quality contract

Binding project direction, 1 November 2026. Russell requires the 12 November demo's look, feel and UX to be credible as a production experience, with consistency maintained across stories and agents. This is an acceptance requirement for each relevant story. BMW production deployment acceptance remains a separate matter.

Every GCSP story author, designer, implementer and reviewer reads this contract. It applies to screens and to any service or data change that affects what a user sees or can do. A story with no such impact records that reason and uses the relevant non-visual checks.

## Delivery sequence, agreed 5 November 2026

Russell discussed the sequence with Gary and instructed: **do not pause for layout reviews until there is a working end-to-end demo**. Build the working system first, then undertake the UI pass. This supersedes the earlier requirement to wait for human review of a representative body before continuing implementation. It applies to all current and subsequent stories and agents until that working-system checkpoint.

Two standing requirements continue throughout: **no unnecessary prose**, and **enforce the component library and ratchet**. Reuse or extend an existing suitable component; add one only when a suitable component is genuinely absent. Keep required functional, accessibility, responsive/browser checks and agent inspection of the rendered result. These checks do not create a human layout-review pause. Source/access permissions, story dependencies and substantive behavioral decisions remain binding.

## Visual reference

**Agreed direction, Russell, 1 November 2026:** the [eight supplied GCSP screenshots](screens/README.md) are the visual reference for the application **header, sidebar and palette**. Breadcrumbs may be retained where useful. Redesign the body toward the consumer-facing Used Cars experience, using shared components and a clearer, more visual presentation. The existing dense portal forms/tables and seven-step wizard are historical journey evidence, not body layouts to reproduce.

The screenshots are already available under `docs/gcsp/screens/` and were inspected directly. No additional upload or separate pre-existing visual design is required. Retain the slim branded portal header/account context, narrow icon navigation and white/light-grey/neutral/teal palette. Apply that palette through scenario-scoped semantic tokens while preserving the existing Used Cars brand themes. Do not reproduce browser or operating-system chrome.

Use the consumer-facing site's vehicle imagery, hierarchy, spacing, cards, controls and explained recommendations as body-design direction. Adapt them to scheme facts, points/contribution, employee decisions and relevant states rather than copying retail labels or the old portal's page composition. Breadcrumbs and the legacy stepper are separate: retaining one does not require the other.

The missing-reference blocker is cleared by this direction. Use the existing representative employee reference and record the repository path/version followed by each implementation. The 5 November delivery sequence above defers further human layout reviews until the end-to-end demo works. Establish Greg's denser operational treatment using the same shell and shared visual language, without pausing implementation for layout review.

Use the project's available product-design or Impeccable guidance to develop and critique the redesigned body. Later agents follow the supplied shell references, this direction and the resulting reviewed implementation reference. Raise deliberate departures through the same design review. The IBM Carbon service blueprint remains a separate explanatory artifact.

## Embeddable blocks

Employee and Greg UI are separate GCSP blocks that import the shared kit; `vehicle-matcher` stays retail-only (HLD review Q8). Each GCSP block also mounts as a standard custom element, so it can drop into the target platform's Angular app (Q18). That app's content security policy forbids inline scripts and `eval`, so GCSP blocks and their pages use no inline `<script>` bodies, inline event-handler attributes (`onclick=` and the like), `eval`, `new Function` or string timers. UI stories state this in `acceptance` and check it in `validate`.

## Author and brief each story

Use the existing story sections so the obligations survive Jira import:

1. In `decided`, cite this contract, the applicable agreed reference and relevant existing component decisions.
2. In `acceptance`, name the changed screen/interaction, the states it must handle and the observable visual/UX outcomes. Select the relevant states below rather than copying a generic polish checkbox.
3. In `validate`, specify relevant automated checks and a browser inspection at desktop and narrow/mobile sizes, with keyboard interaction where controls change. Email offer pages need a usable narrow-screen experience.
4. Give every child agent the contract path, applicable reference and relevant acceptance criteria. Each child passes these to its descendants. A reviewer needs the same context as the implementer.

A code-kind story that changes a response, error, offer state or visible timing follows the same user-experience obligations. Backend-only work can validate its presentation contract and explain why new screenshots are unnecessary. Use existing fields rather than adding new required story metadata.

## Repeatable manual trials

**Refinement direction, 2 November:** the first integrated build gives Russell something to try, inspect and improve. Follow the [manual acceptance scenario approach](manual-acceptance-scenarios.md), recorded as FUCQ-75: shared setup/reset and replay support, with each relevant implementation Epic supplying or linking a successful walkthrough and applicable difficult cases. Use existing Story acceptance/validation sections; add a separate scenario-preparation Story where the work needs it. Research-only Epics do not require artificial UI test Stories.

When a connected capability is offered for Russell's review, include its known starting state, setup/reset instructions, short click-through steps, current expected outcome and a record of observed behaviour/feedback. Identify provisional UX/policy assumptions and refine them through trials. Runtime values still come from the canonical source in the [build rules](build-rules.md). Scenario delivery extends the existing functional checks and rendered review evidence.

Walkthroughs with real employees and an ordering lead are expected after the 12 November demo, subject to BMW's mandate. The demo should communicate a coherent working intention that supports that mandate. Representative-user validation is not a pre-demo gate; the functional and visual quality obligations in this contract still govern the build.

## Build consistently

- Keep product copy concise: useful labels, facts and consequences only. Remove repetitive explanation, internal implementation prose and redundant status summaries.
- Follow [COMPONENTS.md](../../COMPONENTS.md): reuse, extend, then add a shared component when necessary. Put shared behaviour, styling and tokens into the kit; update its catalogue and gallery alongside the consuming view. Establish a gallery when the first component work creates a suitable place for it.
- Share typography, spacing, colour, form controls, buttons, cards and status language across employee, Greg and launcher surfaces. A role's information density can differ while the component language remains consistent. Carry brand/theme context through the supported journeys.
- Use real vehicle imagery and the supported specification data. Make representative images and missing data understandable where relevant to the employee's decision. Useful fallbacks are part of the designed experience.
- Make labels, hierarchy, primary actions and consequences clear. Keep preference controls, buddy activity and offer status understandable without an explanation from the presenter.
- Render useful loading, empty, no-match, validation/error, success, disabled and expired/rejected/accepted states where the story introduces them. Reopening or refreshing an offer must show its actual current state.
- Preserve keyboard access, visible focus, readable contrast, reduced-motion support and layouts that cope with realistic long vehicle names and absent data. Animation should support understanding and feedback.
- Follow [the demo brief](demo-brief.md): input assumptions are explicit, while calculations and state changes function through the adapters. Visual refinement includes correct behaviour and grounded explanations.

## Verify before declaring a UI story built

The implementer inspects the actual rendered surface at the selected desktop and narrow widths, fixes visible defects together, then records evidence. Include screenshot/artifact paths, the states and interactions checked, and any remaining limitation in the story result. A delegated implementer can supply captures; the story lead or reviewer still checks the rendered result against the reference and relevant adjacent screens.

Run relevant automated checks, including the UI ratchet for component work. Its current roots cover block JavaScript and its cap covers one stylesheet. Launcher HTML, other stylesheets and new application paths need explicit coverage review when introduced. Extend appropriate checks alongside those surfaces; browser inspection remains necessary for visual quality.

Completion requires the relevant acceptance criteria, functional checks and visual review evidence. Treat unresolved visual or interaction defects as remaining work. Keep owner acceptance and the configured merge workflow intact; applying this contract does not alter backlog statuses or start a dispatcher.

## Live-change demonstration

The same quality bar applies if a BMW suggestion is built during the meeting. Record the suggestion, clarify and authorise a bounded item, refine the story, then build and verify through the normal workflow. Present a verified result when ready while keeping the current demonstration on a known tested release. Completion during the meeting depends on the actual change.

## Review record

Independent policy review, 1 November 2026: reviewer tier Opus; requested and selected `gpt-6.1-sol` / `high`, no fallback or descendants. The review found no material issues. Effective runtime settings were not independently verified.
