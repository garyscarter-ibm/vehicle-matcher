# GCSP experience quality contract

Binding project direction, 1 November 2026. Russell requires the 12 November demo's look, feel and UX to be credible as a production experience, with consistency maintained across stories and agents. This is an acceptance requirement for each relevant story. BMW production deployment acceptance remains a separate matter.

Every GCSP story author, designer, implementer and reviewer reads this contract. It applies to screens and to any service or data change that affects what a user sees or can do. A story with no such impact records that reason and uses the relevant non-visual checks.

## Visual reference

**Current status: no GCSP visual reference has been agreed.** The existing brand tokens and component catalogue are foundations. The supplied GCSP screenshots evidence the current journey and decisions; they do not establish the new visual standard. The component gallery is also not yet present.

Before parallel UI implementation, the first UI design/refinement work should establish a representative employee surface with Russell/Gary: typography, spacing, imagery, controls, navigation and key states. Record the agreed reference here as a repository path or stable URL with its version/date and the person who agreed it. Establish Greg's denser operational treatment when that surface is introduced, using the same shared visual language. Subsequent stories follow these references and raise deliberate changes through the same design review.

Use the project's available product-design or Impeccable guidance to establish and critique the reference. Later agents use the chosen direction as their authority. A missing reference is a design task to resolve with Russell/Gary before UI implementation fans out.

## Author and brief each story

Use the existing story sections so the obligations survive Jira import:

1. In `decided`, cite this contract, the applicable agreed reference and relevant existing component decisions.
2. In `acceptance`, name the changed screen/interaction, the states it must handle and the observable visual/UX outcomes. Select the relevant states below rather than copying a generic polish checkbox.
3. In `validate`, specify relevant automated checks and a browser inspection at desktop and narrow/mobile sizes, with keyboard interaction where controls change. Email offer pages need a usable narrow-screen experience.
4. Give every child agent the contract path, applicable reference and relevant acceptance criteria. Each child passes these to its descendants. A reviewer needs the same context as the implementer.

A code-kind story that changes a response, error, offer state or visible timing follows the same user-experience obligations. Backend-only work can validate its presentation contract and explain why new screenshots are unnecessary. Use existing fields rather than adding new required story metadata.

## Build consistently

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
