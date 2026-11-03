# FUCQ-13 · Shared launcher implementation stories

**Published and verified:** five native Jira Stories, FUCQ-32–36, under [FUCQ-13](https://ibm-consulting.atlassian.net/browse/FUCQ-13). All stories are To Do and Medium/P3 with author size M; no Story Points were authored. FUCQ-13 is In Progress under the scaffolding authoring procedure.

Template: [_dev/story-template.md](../../_dev/story-template.md). Metadata uses native parent/priority, kind/size/design-impact labels and seven directed Blocks relationships. [Publication verification](evidence/fucq-12/story-publication.json) records the native read-back.

A shared experience selector, brand continuity, compatible retail navigation, gated integration with the employee entry supplied by FUCQ-7, and a verifiable static deployment package. This does not implement the employee journey, matching, transactions or hosting changes.

Design: [HLD](../design/README.md), [experience contract](experience-quality.md), [visual reference guide](screens/README.md). No implementation, poller, commit or deployment was started. FUCQ-7 supplies the working employee entry; FUCQ-25 supplies corrected retail share context.

| Story | Outcome | Depends on |
|---|---|---|
| [FUCQ-32](https://ibm-consulting.atlassian.net/browse/FUCQ-32) | Resolve experience and brand routes while preserving existing links | none |
| [FUCQ-33](https://ibm-consulting.atlassian.net/browse/FUCQ-33) | Choose a car experience and brand from the shared launcher | FUCQ-32 |
| [FUCQ-34](https://ibm-consulting.atlassian.net/browse/FUCQ-34) | Return to the launcher without losing the used-car journey context | FUCQ-33, FUCQ-25 |
| [FUCQ-35](https://ibm-consulting.atlassian.net/browse/FUCQ-35) | Open the supported employee experience through the shared entry point | FUCQ-33, FUCQ-7 |
| [FUCQ-36](https://ibm-consulting.atlassian.net/browse/FUCQ-36) | Package and verify both launcher routes for the existing static host | FUCQ-34, FUCQ-35 |

Shared decisions: Russell authorised FUCQ-13 implementation stories against the agreed docs/design/high-level-design.drawio on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. The HLD's shared launcher, migration and deployment views govern this capability; use the existing Node/vanilla ES-module stack and Pages/Render topology. The supplied screenshots govern employee header/sidebar/palette, breadcrumbs are optional, and employee bodies are redesigned toward Used Cars. FUCQ-7 owns that shell and page composition. Carry these decisions and the relevant acceptance/validation criteria into every child-agent brief. Keep proposed HLD elements proposed until implementation and verification justify a status change.

Independent scoping requested/selected `gpt-6-luna` / `high`; independent review requested/selected `gpt-6.1-sol` / `high`, passed. No fallback or descendants. Effective runtime settings were not independently inspected.

---

### [FUCQ-32](https://ibm-consulting.atlassian.net/browse/FUCQ-32) · Resolve experience and brand routes while preserving existing links

```text
id: FUCQ-32
title: Resolve experience and brand routes while preserving existing links
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-13, implementation from agreed HLD)
epic: FUCQ-13
priority: P3
priority_reason: from FUCQ-13
size: M
depends_on: none
```

## Goal

As a visitor with a new or existing demo link, I want the correct experience and brand to open so the shared launcher does not break access to Used Cars.

## Acceptance criteria

- [ ] Add a small frontend entry registry and testable URL resolver with experience=launcher|used-cars|employee-cars. Experience and brand remain independent; these navigation values never select a backend recommendation policy or employee entitlement.
- [ ] A fresh index.html URL with no experience, brand or existing retail context opens the shared launcher. An explicit experience=used-cars opens the existing retail brand picker when no brand is selected, or the branded retail shell when one is selected. experience=launcher explicitly reopens the shared selector while retaining a selected brand.
- [ ] Existing index.html retail links without experience retain their behaviour when they contain brand, mode, scope, retailer, retailerName or an answer hash; a legacy URL without a brand still reaches the retail picker. block.html remains a compatible standalone retail entry. Preserve the existing unknown-retail-brand fallback to BMW.
- [ ] The registry exposes the six existing retail brands and five existing mode keys; initial employee demo coverage is BMW only, consistent with the brief and supplied eligibility baseline. Unsupported employee brands and unknown experience values resolve to explicit recoverable states, without silently changing brand or falling into retail.
- [ ] Link construction retains the application's base pathname, including a GitHub Pages repository prefix. Preserve relevant retail query/hash context within retail navigation; entering employee cars excludes retail mode, scope, retailer overrides and retail answer hashes. Do not copy buyer answers into an employee brief.
- [ ] Retain local/remote API resolution and the existing demo-password behaviour. Consume a legacy key parameter through the existing session gate and remove it before any generated link; no new URL or diagnostic output contains a password. Employee routing is controlled by configured capability availability, not inferred from retail brand support.

## Files or areas

- index.html
- block.html (compatibility checks)
- blocks/demo-launcher/entry-context.js (proposed)
- server/test/launcher-context.test.js (proposed)
- docs/gcsp/fucq-12-stories.md

## Decided

Russell authorised FUCQ-13 implementation stories against the agreed docs/design/high-level-design.drawio on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. The HLD's shared launcher, migration and deployment views govern this capability; use the existing Node/vanilla ES-module stack and Pages/Render topology. The supplied screenshots govern employee header/sidebar/palette, breadcrumbs are optional, and employee bodies are redesigned toward Used Cars. FUCQ-7 owns that shell and page composition. Carry these decisions and the relevant acceptance/validation criteria into every child-agent brief. Keep proposed HLD elements proposed until implementation and verification justify a status change.

The HLD separates navigation context from server-selected policy. Use additive query routing on the current static entry point; no SPA framework, path-rewrite service or new host is needed. Preserve legacy retail URLs before adding the new default selector. Read docs/gcsp/experience-quality.md and screens/README.md; this contract story changes URL resolution and state presentation contracts, while L2-L4 provide the rendered screens. Capture route/error expectations here; screenshots of those screens belong to their consuming stories.

Prerequisites (native Blocks links): none.

## Out of scope

Matching or API policy changes, employee identity/authorisation, new employee brands, saved accounts, durable preference state, employee screen composition and production deployment.

## Validate

- node --test server/test/launcher-context.test.js — route table covers fresh root, explicit routes, legacy brand/mode/scope/hash links, unknown values, BMW-only employee support, key removal and a repository-prefixed base path.
- node --test server/test/render.test.js server/test/api.test.js — current brand/mode mounts and HTTP contracts remain compatible.
- npm test — passes; record actual checks and explain that rendered launcher/error evidence is supplied by L2-L4.

---

### [FUCQ-33](https://ibm-consulting.atlassian.net/browse/FUCQ-33) · Choose a car experience and brand from the shared launcher

```text
id: FUCQ-33
title: Choose a car experience and brand from the shared launcher
kind: ui
design_impact: yes
ui: el; new: experienceChoice and brandSelector, because result cards and question options do not express navigation destinations. Reuse or extract consumed screenIntro/button/statusScreen primitives where suitable; catalogue and gallery them with the view.
requested: 2026-11-01, by Russell (backlog FUCQ-13, implementation from agreed HLD)
epic: FUCQ-13
priority: P3
priority_reason: from FUCQ-13
size: M
depends_on: FUCQ-32
```

## Goal

As a demo visitor, I want clear Employee cars and Used cars choices with a visible brand selector so I understand what I can open.

## Acceptance criteria

- [ ] The shared launcher offers Employee cars and Used cars with concise descriptions and clear next actions. Used cars enters the retained retail picker/shell; Employee cars targets the registered employee entry only when available. A selected brand is visible and carried through the chosen supported route.
- [ ] The selector preserves access to BMW, MINI, Ford, Honda, Motorrad and Ferrari for retail. With no selected brand, Used cars leads to the existing picker and Employee cars identifies BMW coverage explicitly. With another brand selected, explain that the employee demo supports BMW and offer an explicit Choose BMW action; do not silently replace the user's brand.
- [ ] When employee capability is not registered/enabled, show an understandable unavailable state and a working Used cars route. Do not present an enabled employee CTA leading to a placeholder or broken module. Missing imagery or logos have designed fallbacks and never hide the destination label.
- [ ] Use the shared component kit and semantic tokens, with consumer-facing hierarchy, useful spacing and vehicle imagery where appropriate. Keep existing retail brand themes stable. Record and review one representative launcher design early under the experience contract, then save desktop and narrow rendered evidence of the implemented result.
- [ ] Provide semantic headings/landmarks, labelled brand controls, keyboard-operable choices, visible focus, readable contrast and reduced-motion behaviour. Long names, 320px-wide screens, loading and unavailable states remain legible without horizontal overflow or inaccessible disabled explanations.
- [ ] Catalogue any shared primitives in COMPONENTS.md and establish or extend their gallery. Put new launcher JS under an explicitly checked ratchet root and cover its styles; do not leave index.html inline rendering or a new stylesheet outside equivalent reuse checks, raise existing debt baselines, or copy employee shell markup into the launcher.

## Files or areas

- index.html
- blocks/demo-launcher/ (proposed)
- blocks/vehicle-matcher/ui.js and tokens.css (where genuinely shared)
- COMPONENTS.md
- server/test/launcher-render.test.js (proposed)
- server/test/ui-ratchet.test.js
- server/test/ui-ratchet.json

## Decided

Russell authorised FUCQ-13 implementation stories against the agreed docs/design/high-level-design.drawio on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. The HLD's shared launcher, migration and deployment views govern this capability; use the existing Node/vanilla ES-module stack and Pages/Render topology. The supplied screenshots govern employee header/sidebar/palette, breadcrumbs are optional, and employee bodies are redesigned toward Used Cars. FUCQ-7 owns that shell and page composition. Carry these decisions and the relevant acceptance/validation criteria into every child-agent brief. Keep proposed HLD elements proposed until implementation and verification justify a status change.

ui: el; new experienceChoice and brandSelector because no current navigation component fits; extract only consumed common primitives. Follow docs/gcsp/experience-quality.md and screens/README.md. The GCSP references define employee shell treatment; FUCQ-7 owns shell/page integration. The launcher is a shared entry surface and must fit the same typography, spacing and component language. This is normal design review using the available references, not an external missing-reference/upload blocker. Do not wait for FUCQ-31's recommendation-card work to build independent navigation components.

Prerequisites (native Blocks links): FUCQ-32.

## Out of scope

Rebuilding the retail picker or modes, GCSP header/sidebar implementation, employee home/offer/Greg pages, matching logic, new branding sources and hosting changes.

## Validate

- node --test server/test/launcher-context.test.js server/test/launcher-render.test.js — both choices, brand continuity, unsupported/unavailable entry, image fallback and keyboard interactions pass.
- node --test server/test/ui-ratchet.test.js server/test/render.test.js — new surfaces have explicit coverage and existing retail mounts/debt limits pass; npm test passes.
- Browser via npm run serve with npm run server: inspect desktop and 320px/narrow launcher states, all brand controls, no-brand/unsupported/unavailable states, keyboard/focus and reduced motion. Save screenshots and the reviewed design reference under docs/gcsp/evidence/fucq-12/.

---

### [FUCQ-34](https://ibm-consulting.atlassian.net/browse/FUCQ-34) · Return to the launcher without losing the used-car journey context

```text
id: FUCQ-34
title: Return to the launcher without losing the used-car journey context
kind: ui
design_impact: yes
ui: el, L2 brandSelector and shared navigation/button primitives; retain existing retail mode controls and result components.
requested: 2026-11-01, by Russell (backlog FUCQ-13, implementation from agreed HLD)
epic: FUCQ-13
priority: P3
priority_reason: from FUCQ-13
size: M
depends_on: FUCQ-33, FUCQ-25
```

## Goal

As a used-car visitor, I want to switch brand or return to the shared launcher predictably so navigation preserves the journey I chose.

## Acceptance criteria

- [ ] Provide clear routes from the retail picker and branded shell back to the shared launcher and to brand selection without removing existing real-brand-site links or retail mode navigation. Selected brand remains visible at the shared entry.
- [ ] Returning to the same retail journey, refreshing, and browser Back/Forward preserve its supported brand, mode lock, scope, retailer context and answer hash. Use the corrected context-preserving share contract from FUCQ-25 rather than implementing another share serializer.
- [ ] Changing brand is deliberate and does not replay a different brand's incompatible answer hash. Explain any fresh-start behaviour before the action; retain valid mode/scope/API context and recompute the retailer identity/label for the chosen brand without carrying an invalid dealer override into another programme.
- [ ] Switching into employee cars carries only the supported brand and permitted navigation/backend configuration; no retail answer hash, retailer scope or purchase preferences enter employee state. Returning to retail can reopen the separately retained retail location without persisting an employee brief or offer.
- [ ] Legacy direct index.html and block.html links continue opening their intended retail view without an extra compulsory selection step. Local API overrides, deployed API defaults and the session demo gate still work; generated navigation/share URLs never include the consumed access key.
- [ ] The added controls fit all six retail themes and remain usable at desktop/narrow widths with keyboard focus and meaningful link labels. Existing questionnaire, mingle, knockout, podium and guess-who behaviour remains unchanged apart from the authorised navigation additions.

## Files or areas

- index.html
- block.html (compatibility and optional shared-entry link)
- blocks/demo-launcher/entry-context.js (proposed)
- blocks/vehicle-matcher/vehicle-matcher.js
- server/test/launcher-navigation.test.js (proposed)
- server/test/render.test.js

## Decided

Russell authorised FUCQ-13 implementation stories against the agreed docs/design/high-level-design.drawio on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. The HLD's shared launcher, migration and deployment views govern this capability; use the existing Node/vanilla ES-module stack and Pages/Render topology. The supplied screenshots govern employee header/sidebar/palette, breadcrumbs are optional, and employee bodies are redesigned toward Used Cars. FUCQ-7 owns that shell and page composition. Carry these decisions and the relevant acceptance/validation criteria into every child-agent brief. Keep proposed HLD elements proposed until implementation and verification justify a status change.

ui: el, L2 brandSelector and shared navigation/button primitives. FUCQ-25 owns corrected retail share-link generation; FUCQ-13 owns launcher/brand navigation and its integration. Preserve the six-brand/five-mode contract in the HLD migration view. Follow docs/gcsp/experience-quality.md and screens/README.md, using the current consumer retail presentation as the reference for additions within retail. URL navigation is not an employee preference or transaction store; keep any return location session-local and scoped to retail.

Prerequisites (native Blocks links): FUCQ-33, FUCQ-25.

## Out of scope

Retail recommendation retuning, new retail modes, cross-brand answer translation, durable history/accounts/shortlists, employee brief saving and offer lifecycle actions.

## Validate

- node --test server/test/launcher-navigation.test.js server/test/launcher-context.test.js — same-brand round trips, deliberate brand changes, Back/Forward/refresh, hash isolation, retailer labels and gate/API context pass.
- node --test server/test/render.test.js server/test/ui-ratchet.test.js — all existing retail brand/mode mounts and reuse checks pass; npm test passes.
- Browser: traverse shared launcher → retail → launcher → retail and switch brands at desktop/narrow widths. Open one national BMW answer link, another-brand locked-mode link and block.html directly; verify copied links and keyboard focus. Record all six brands/five modes in a compact regression matrix with screenshot evidence for representative themes.

---

### [FUCQ-35](https://ibm-consulting.atlassian.net/browse/FUCQ-35) · Open the supported employee experience through the shared entry point

```text
id: FUCQ-35
title: Open the supported employee experience through the shared entry point
kind: ui
design_impact: yes
ui: L2 experienceChoice, brandSelector and shared status/navigation/button primitives; consume the FUCQ-7 employee shell rather than reproducing it.
requested: 2026-11-01, by Russell (backlog FUCQ-13, implementation from agreed HLD)
epic: FUCQ-13
priority: P3
priority_reason: from FUCQ-13
size: M
depends_on: FUCQ-33, FUCQ-7
```

## Goal

As a BMW employee-demo visitor, I want the launcher to open the working employee journey so I reach the agreed experience with clear context and recovery.

## Acceptance criteria

- [ ] Register and load the real entry supplied by FUCQ-7 for experience=employee-cars with BMW context. The enabled launcher action, direct URL, refresh and browser navigation reach that same working employee entry; a fake home, canned confirmation or retail matcher mounted under an employee label is not acceptance.
- [ ] Keep employee loading/mounting separate from retail. A disabled capability or failed employee module/provider produces a clear, retryable/unavailable state with a working path back to the launcher and Used cars. Retail remains usable with employee routing disabled and does not load employee-only modules merely to open a legacy retail URL.
- [ ] Reject unsupported employee brands visibly and offer an explicit BMW/Used cars choice. Brand selection and public experience query values cannot set an employee identifier, choose a permissive retail policy, widen a permitted stock pool or manufacture scheme support.
- [ ] Carry the agreed brand context into the employee header/navigation and back to the launcher. FUCQ-7 supplies the screenshot-based header, icon sidebar, neutral/teal palette and redesigned consumer-style body; any breadcrumbs remain optional. FUCQ-13 adds navigation integration only and preserves the actual employee page/adapter state semantics.
- [ ] Retain the existing demo gate without presenting the shared password as employee identity. Exercise a rejected/expired demo session and employee-entry load failure without blank screens, duplicate mounts or loss of the user's recovery actions. No access key appears in links or evidence.
- [ ] Employee entry/return controls, loading/error states and focus transitions are coherent at desktop and narrow widths and by keyboard. A supported employee route opens real implemented functionality before this story can be marked built.

## Files or areas

- index.html
- blocks/demo-launcher/ (proposed)
- FUCQ-7 employee entry/mount adapter
- server/test/launcher-employee-entry.test.js (proposed)
- docs/design/README.md

## Decided

Russell authorised FUCQ-13 implementation stories against the agreed docs/design/high-level-design.drawio on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. The HLD's shared launcher, migration and deployment views govern this capability; use the existing Node/vanilla ES-module stack and Pages/Render topology. The supplied screenshots govern employee header/sidebar/palette, breadcrumbs are optional, and employee bodies are redesigned toward Used Cars. FUCQ-7 owns that shell and page composition. Carry these decisions and the relevant acceptance/validation criteria into every child-agent brief. Keep proposed HLD elements proposed until implementation and verification justify a status change.

ui: L2 shared navigation/status components and the FUCQ-7 shell. Native blocker FUCQ-7 is an explicit prerequisite: agree its concrete entry/mount contract at integration and do not replace delivery with a stub. Initial BMW-only coverage is established by demo-brief.md; the detailed scheme matrix belongs to employee services. Follow docs/gcsp/experience-quality.md and screens/README.md. Server-owned recommendation/eligibility policy remains with FUCQ-8/FUCQ-7; the launcher never supplies authority. Disable employee routing independently as the HLD requires.

Prerequisites (native Blocks links): FUCQ-33, FUCQ-7.

## Out of scope

Implementing FUCQ-7 screens or FUCQ-8 recommendation services, employee authentication, Greg-role switching, saved briefs, reservations/offers, mail and new employee brands.

## Validate

- node --test server/test/launcher-employee-entry.test.js server/test/launcher-context.test.js — real entry contract, disabled/load-failure recovery, unsupported brand, direct/refresh route, single mount and navigation isolation pass.
- node --test server/test/render.test.js server/test/api.test.js server/test/ui-ratchet.test.js — retail remains green when employee routing is on and off; npm test passes.
- Browser: with FUCQ-7 delivered, open employee cars from the launcher and by direct URL at desktop/narrow widths; inspect the actual shell, brand, keyboard/focus, loading/error/retry and return paths. Repeat a retail direct link with employee entry disabled and save evidence.

---

### [FUCQ-36](https://ibm-consulting.atlassian.net/browse/FUCQ-36) · Package and verify both launcher routes for the existing static host

```text
id: FUCQ-36
title: Package and verify both launcher routes for the existing static host
kind: code
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-13, implementation from agreed HLD)
epic: FUCQ-13
priority: P3
priority_reason: from FUCQ-13
size: M
depends_on: FUCQ-34, FUCQ-35
```

## Goal

As the demo release owner, I want a complete, verifiable static package so both experiences work through the existing Pages and Render deployment path.

## Acceptance criteria

- [ ] The Pages assembly includes the launcher, registered employee entry, all imported modules/styles, component gallery where applicable, logos and necessary vehicle/image fallback assets. Required assets fail packaging checks when missing; do not publish source-only server/configuration/stock-fixture files to solve a missing asset.
- [ ] Exercise the assembled site at a repository-prefixed path with local and deployed-style API configuration. Shared launcher, retail picker/shell, employee entry, direct URLs and refresh work without server path rewrites or localhost leaks in the deployed configuration.
- [ ] Keep the existing main/workflow_dispatch release triggers and current Render topology. Document the exact frontend/backend compatibility requirement and employee-route availability switch. With employee disabled, the package still serves all existing retail links/brands/modes; the rollback path retains the retail entry contract.
- [ ] Add deterministic assembly/asset and entry smoke checks to the existing verification path; cover the dynamic import targets and shared API default used by index.html alongside the block.html API rewrite. Missing modules, broken relative assets and a mismatched API setting produce actionable failures.
- [ ] Update README/HLD deployment notes and a release checklist with actual validated revision/configuration details, route examples, outstanding Gary-owned live branch/release decisions and instructions for later deployed smoke checks. Do not claim a local package test proves the live backend revision or BMW operational readiness.
- [ ] Inspect the assembled launcher and both routes at desktop/narrow sizes and with keyboard navigation; record asset/network and error-state observations plus the retail regression matrix. This story prepares and verifies the package; publishing or changing hosting is a separate release action.

## Files or areas

- .github/workflows/pages.yml
- scripts/assemble-site.mjs (proposed, if extracted for repeatable checks)
- server/test/launcher-package.test.js (proposed)
- README.md
- docs/design/README.md
- docs/gcsp/evidence/fucq-12/

## Decided

Russell authorised FUCQ-13 implementation stories against the agreed docs/design/high-level-design.drawio on 1 November 2026. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. The HLD's shared launcher, migration and deployment views govern this capability; use the existing Node/vanilla ES-module stack and Pages/Render topology. The supplied screenshots govern employee header/sidebar/palette, breadcrumbs are optional, and employee bodies are redesigned toward Used Cars. FUCQ-7 owns that shell and page composition. Carry these decisions and the relevant acceptance/validation criteria into every child-agent brief. Keep proposed HLD elements proposed until implementation and verification justify a status change.

Follow the HLD deployment/migration views and docs/gcsp/experience-quality.md. This changes packaging/verification inside the existing topology, not infrastructure or product layout. Changed asset/API delivery affects visible behaviour, so validate the rendered assembled package as specified. Prefer one reusable assembly path exercised by CI and tests over a second approximation of the workflow. No live deployment, provisioning, mail or production acceptance is authorised by story authoring.

Prerequisites (native Blocks links): FUCQ-34, FUCQ-35.

## Out of scope

Publishing a release, changing deployment branches/triggers or hosting providers, provisioning storage/identity/mail, implementing employee services, and claiming unverified live configuration.

## Validate

- node --test server/test/launcher-package.test.js — assembles into an isolated temporary directory and proves required modules/assets, repository-prefix URLs, API configuration, disabled employee fallback and missing-asset failures without deploying.
- npm test — launcher/context/integration/package checks and existing retail suite pass; git diff --check passes.
- Serve the assembled tree under a repository prefix and inspect desktop/narrow launcher, retail and real FUCQ-7 employee entry. Record actual revision pair/configuration and limitations in docs/gcsp/evidence/fucq-12/. The release checklist separately requires deployed frontend/API smoke checks after an authorised compatible release.
