# FUCQ-14–20 · Vehicle evidence and synthetic-fleet implementation stories

**Published and verified, 1 November 2026:** 27 native Jira Stories, FUCQ-37–63. All are **To Do**, Medium/P3 and unassigned, with author sizes S/M/L and no authored Story Points. Their seven parent Epics are independent and In Progress under the story-authoring procedure. No Epic has another Epic as parent.

Russell requested the child stories, then confirmed: **“HLD is canonical. Update the epics if they are out of date.”** All seven epic descriptions now follow the canonical [draw.io HLD](../design/high-level-design.drawio) and [whole-demo design record](../design/gcsp-high-level-design.md). Their existing research/dependency links were preserved. The new story graph has **41 directed Blocks relationships** and covers all **49 epic acceptance criteria**.

Use the [structured stories](fucq-13-19-stories.json), [_dev story template](../../_dev/story-template.md) and [native publication verification](evidence/fucq-13-19/story-publication.json). Jira remains the backlog authority. No duplicate `_dev/` queue, implementation, dispatcher, live-provider activation or bulk collection was started.

**Re-scope, 4 November 2026 (FUCQ-6 review Q7, Q13).** Each of FUCQ-52 to 63 now starts its Jira description with a re-scope section that overrides conflicting criteria. Vehicles have three identities:

- **Configuration:** `configurationId`, in the immutable corpus.
- **Exact stock car:** a synthetic order reference, in Postgres, generated per demo run.
- **Delivered car:** a VIN, attached at delivery or for an employee's current car only.

Backend consumers reach the lookup module in-process through its port. The HTTP route wraps the same module as `GET /api/gcsp/vehicle-evidence/{configurations|stock|vins}/:id`. The story text below predates the re-scope; Jira is the current version.

| Epic | Capability | Child stories | Count |
|---|---|---|---|
| [FUCQ-14](https://ibm-consulting.atlassian.net/browse/FUCQ-14) | Dated catalogue/specification snapshots | [FUCQ-37](https://ibm-consulting.atlassian.net/browse/FUCQ-37), [FUCQ-38](https://ibm-consulting.atlassian.net/browse/FUCQ-38), [FUCQ-39](https://ibm-consulting.atlassian.net/browse/FUCQ-39) | 3 |
| [FUCQ-15](https://ibm-consulting.atlassian.net/browse/FUCQ-15) | Representative configuration-image snapshots | [FUCQ-40](https://ibm-consulting.atlassian.net/browse/FUCQ-40), [FUCQ-41](https://ibm-consulting.atlassian.net/browse/FUCQ-41), [FUCQ-42](https://ibm-consulting.atlassian.net/browse/FUCQ-42) | 3 |
| [FUCQ-16](https://ibm-consulting.atlassian.net/browse/FUCQ-16) | VIN-linked handbook/illustration content | [FUCQ-43](https://ibm-consulting.atlassian.net/browse/FUCQ-43), [FUCQ-44](https://ibm-consulting.atlassian.net/browse/FUCQ-44), [FUCQ-45](https://ibm-consulting.atlassian.net/browse/FUCQ-45) | 3 |
| [FUCQ-17](https://ibm-consulting.atlassian.net/browse/FUCQ-17) | Access-gated live catalogue/specification provider | [FUCQ-46](https://ibm-consulting.atlassian.net/browse/FUCQ-46), [FUCQ-47](https://ibm-consulting.atlassian.net/browse/FUCQ-47), [FUCQ-48](https://ibm-consulting.atlassian.net/browse/FUCQ-48) | 3 |
| [FUCQ-18](https://ibm-consulting.atlassian.net/browse/FUCQ-18) | Access-gated live configuration imagery | [FUCQ-49](https://ibm-consulting.atlassian.net/browse/FUCQ-49), [FUCQ-50](https://ibm-consulting.atlassian.net/browse/FUCQ-50), [FUCQ-51](https://ibm-consulting.atlassian.net/browse/FUCQ-51) | 3 |
| [FUCQ-19](https://ibm-consulting.atlassian.net/browse/FUCQ-19) | Plausible VIN generator, immutable registry, HTTP lookup and adapter | [FUCQ-52](https://ibm-consulting.atlassian.net/browse/FUCQ-52), [FUCQ-53](https://ibm-consulting.atlassian.net/browse/FUCQ-53), [FUCQ-54](https://ibm-consulting.atlassian.net/browse/FUCQ-54), [FUCQ-55](https://ibm-consulting.atlassian.net/browse/FUCQ-55), [FUCQ-56](https://ibm-consulting.atlassian.net/browse/FUCQ-56), [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57) | 6 |
| [FUCQ-20](https://ibm-consulting.atlassian.net/browse/FUCQ-20) | Collect, enrich, publish and verify 10,000 distinct configurations | [FUCQ-58](https://ibm-consulting.atlassian.net/browse/FUCQ-58), [FUCQ-59](https://ibm-consulting.atlassian.net/browse/FUCQ-59), [FUCQ-60](https://ibm-consulting.atlassian.net/browse/FUCQ-60), [FUCQ-61](https://ibm-consulting.atlassian.net/browse/FUCQ-61), [FUCQ-62](https://ibm-consulting.atlassian.net/browse/FUCQ-62), [FUCQ-63](https://ibm-consulting.atlassian.net/browse/FUCQ-63) | 6 |

The HLD places these capabilities inside the existing Node backend, with versioned immutable corpus artifacts and a real `GET /api/gcsp/vehicle-evidence/synthetic-vins/:vin` contract. The consuming backend adapter calls that HTTP route. Mutable employee/fleet transactions remain separate. The synthetic route and all miss/outage/provider-switch paths remain offline; the explicit offline start profile also suppresses unrelated retail source warmers.

The [experience contract](experience-quality.md), [supplied visual references](screens/README.md) and [component catalogue](../../COMPONENTS.md) apply to every story. Screenshot header/sidebar/palette and Used Cars body direction are established. These stories add no screen: they verify presentation fields, units, source/synthetic labels, unknown/error states and image fidelity through contracts and actual asset checks. Later consuming UI needs its own desktop/narrow/keyboard evidence.

Specific source access/use/retention, permitted image delivery, selected UK/RHD profile qualification and numerical collection budgets remain explicit execution inputs. Public application-key replay is valid research evidence; it does not itself establish supported production access. Ten thousand means genuinely distinct complete resolved configurations, not different VINs, dates or accessory-only padding. Completeness of a resolved configuration does not justify fabricating missing technical or image facts.

Two story authors and one independent reviewer were requested/selected as Opus → `gpt-6.1-sol` / `high`, resolved through `tiers spawn --harness codex`, with no fallback or descendants. Effective runtime settings were not independently inspected. Review: **PASS — no blocking or major issues found.** Gateway: Codex IBM Global PASS.

## Dependency and acceptance coverage

| Epic | Epic acceptance criterion → implementing stories |
|---|---|
| [FUCQ-14](https://ibm-consulting.atlassian.net/browse/FUCQ-14) | 1: [FUCQ-37](https://ibm-consulting.atlassian.net/browse/FUCQ-37); 2: [FUCQ-37](https://ibm-consulting.atlassian.net/browse/FUCQ-37); 3: [FUCQ-37](https://ibm-consulting.atlassian.net/browse/FUCQ-37), [FUCQ-38](https://ibm-consulting.atlassian.net/browse/FUCQ-38); 4: [FUCQ-38](https://ibm-consulting.atlassian.net/browse/FUCQ-38); 5: [FUCQ-39](https://ibm-consulting.atlassian.net/browse/FUCQ-39); 6: [FUCQ-39](https://ibm-consulting.atlassian.net/browse/FUCQ-39); 7: [FUCQ-37](https://ibm-consulting.atlassian.net/browse/FUCQ-37), [FUCQ-39](https://ibm-consulting.atlassian.net/browse/FUCQ-39) |
| [FUCQ-15](https://ibm-consulting.atlassian.net/browse/FUCQ-15) | 1: [FUCQ-40](https://ibm-consulting.atlassian.net/browse/FUCQ-40), [FUCQ-42](https://ibm-consulting.atlassian.net/browse/FUCQ-42); 2: [FUCQ-40](https://ibm-consulting.atlassian.net/browse/FUCQ-40); 3: [FUCQ-40](https://ibm-consulting.atlassian.net/browse/FUCQ-40), [FUCQ-41](https://ibm-consulting.atlassian.net/browse/FUCQ-41); 4: [FUCQ-41](https://ibm-consulting.atlassian.net/browse/FUCQ-41); 5: [FUCQ-40](https://ibm-consulting.atlassian.net/browse/FUCQ-40), [FUCQ-42](https://ibm-consulting.atlassian.net/browse/FUCQ-42); 6: [FUCQ-41](https://ibm-consulting.atlassian.net/browse/FUCQ-41), [FUCQ-42](https://ibm-consulting.atlassian.net/browse/FUCQ-42) |
| [FUCQ-16](https://ibm-consulting.atlassian.net/browse/FUCQ-16) | 1: [FUCQ-43](https://ibm-consulting.atlassian.net/browse/FUCQ-43), [FUCQ-44](https://ibm-consulting.atlassian.net/browse/FUCQ-44); 2: [FUCQ-44](https://ibm-consulting.atlassian.net/browse/FUCQ-44), [FUCQ-45](https://ibm-consulting.atlassian.net/browse/FUCQ-45); 3: [FUCQ-43](https://ibm-consulting.atlassian.net/browse/FUCQ-43), [FUCQ-44](https://ibm-consulting.atlassian.net/browse/FUCQ-44); 4: [FUCQ-44](https://ibm-consulting.atlassian.net/browse/FUCQ-44); 5: [FUCQ-43](https://ibm-consulting.atlassian.net/browse/FUCQ-43), [FUCQ-45](https://ibm-consulting.atlassian.net/browse/FUCQ-45); 6: [FUCQ-43](https://ibm-consulting.atlassian.net/browse/FUCQ-43), [FUCQ-44](https://ibm-consulting.atlassian.net/browse/FUCQ-44), [FUCQ-45](https://ibm-consulting.atlassian.net/browse/FUCQ-45); 7: [FUCQ-43](https://ibm-consulting.atlassian.net/browse/FUCQ-43), [FUCQ-45](https://ibm-consulting.atlassian.net/browse/FUCQ-45) |
| [FUCQ-17](https://ibm-consulting.atlassian.net/browse/FUCQ-17) | 1: [FUCQ-46](https://ibm-consulting.atlassian.net/browse/FUCQ-46), [FUCQ-47](https://ibm-consulting.atlassian.net/browse/FUCQ-47), [FUCQ-48](https://ibm-consulting.atlassian.net/browse/FUCQ-48); 2: [FUCQ-46](https://ibm-consulting.atlassian.net/browse/FUCQ-46); 3: [FUCQ-46](https://ibm-consulting.atlassian.net/browse/FUCQ-46); 4: [FUCQ-46](https://ibm-consulting.atlassian.net/browse/FUCQ-46); 5: [FUCQ-47](https://ibm-consulting.atlassian.net/browse/FUCQ-47); 6: [FUCQ-46](https://ibm-consulting.atlassian.net/browse/FUCQ-46), [FUCQ-47](https://ibm-consulting.atlassian.net/browse/FUCQ-47); 7: [FUCQ-48](https://ibm-consulting.atlassian.net/browse/FUCQ-48) |
| [FUCQ-18](https://ibm-consulting.atlassian.net/browse/FUCQ-18) | 1: [FUCQ-49](https://ibm-consulting.atlassian.net/browse/FUCQ-49), [FUCQ-50](https://ibm-consulting.atlassian.net/browse/FUCQ-50), [FUCQ-51](https://ibm-consulting.atlassian.net/browse/FUCQ-51); 2: [FUCQ-49](https://ibm-consulting.atlassian.net/browse/FUCQ-49); 3: [FUCQ-49](https://ibm-consulting.atlassian.net/browse/FUCQ-49), [FUCQ-50](https://ibm-consulting.atlassian.net/browse/FUCQ-50); 4: [FUCQ-50](https://ibm-consulting.atlassian.net/browse/FUCQ-50); 5: [FUCQ-49](https://ibm-consulting.atlassian.net/browse/FUCQ-49), [FUCQ-50](https://ibm-consulting.atlassian.net/browse/FUCQ-50); 6: [FUCQ-51](https://ibm-consulting.atlassian.net/browse/FUCQ-51) |
| [FUCQ-19](https://ibm-consulting.atlassian.net/browse/FUCQ-19) | 1: [FUCQ-52](https://ibm-consulting.atlassian.net/browse/FUCQ-52), [FUCQ-54](https://ibm-consulting.atlassian.net/browse/FUCQ-54), [FUCQ-55](https://ibm-consulting.atlassian.net/browse/FUCQ-55), [FUCQ-56](https://ibm-consulting.atlassian.net/browse/FUCQ-56), [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57); 2: [FUCQ-52](https://ibm-consulting.atlassian.net/browse/FUCQ-52), [FUCQ-53](https://ibm-consulting.atlassian.net/browse/FUCQ-53); 3: [FUCQ-52](https://ibm-consulting.atlassian.net/browse/FUCQ-52), [FUCQ-53](https://ibm-consulting.atlassian.net/browse/FUCQ-53); 4: [FUCQ-53](https://ibm-consulting.atlassian.net/browse/FUCQ-53), [FUCQ-54](https://ibm-consulting.atlassian.net/browse/FUCQ-54), [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57); 5: [FUCQ-55](https://ibm-consulting.atlassian.net/browse/FUCQ-55), [FUCQ-56](https://ibm-consulting.atlassian.net/browse/FUCQ-56), [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57); 6: [FUCQ-55](https://ibm-consulting.atlassian.net/browse/FUCQ-55), [FUCQ-56](https://ibm-consulting.atlassian.net/browse/FUCQ-56), [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57); 7: [FUCQ-53](https://ibm-consulting.atlassian.net/browse/FUCQ-53), [FUCQ-54](https://ibm-consulting.atlassian.net/browse/FUCQ-54), [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57); 8: [FUCQ-55](https://ibm-consulting.atlassian.net/browse/FUCQ-55), [FUCQ-56](https://ibm-consulting.atlassian.net/browse/FUCQ-56), [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57) |
| [FUCQ-20](https://ibm-consulting.atlassian.net/browse/FUCQ-20) | 1: [FUCQ-58](https://ibm-consulting.atlassian.net/browse/FUCQ-58), [FUCQ-61](https://ibm-consulting.atlassian.net/browse/FUCQ-61); 2: [FUCQ-59](https://ibm-consulting.atlassian.net/browse/FUCQ-59); 3: [FUCQ-59](https://ibm-consulting.atlassian.net/browse/FUCQ-59), [FUCQ-61](https://ibm-consulting.atlassian.net/browse/FUCQ-61); 4: [FUCQ-60](https://ibm-consulting.atlassian.net/browse/FUCQ-60); 5: [FUCQ-58](https://ibm-consulting.atlassian.net/browse/FUCQ-58), [FUCQ-59](https://ibm-consulting.atlassian.net/browse/FUCQ-59), [FUCQ-61](https://ibm-consulting.atlassian.net/browse/FUCQ-61); 6: [FUCQ-62](https://ibm-consulting.atlassian.net/browse/FUCQ-62); 7: [FUCQ-61](https://ibm-consulting.atlassian.net/browse/FUCQ-61), [FUCQ-62](https://ibm-consulting.atlassian.net/browse/FUCQ-62); 8: [FUCQ-63](https://ibm-consulting.atlassian.net/browse/FUCQ-63) |

## Stories

### [FUCQ-37](https://ibm-consulting.atlassian.net/browse/FUCQ-37) · Resolve the dated i5 catalogue sample through a snapshot adapter

```text
id: FUCQ-37
title: Resolve the dated i5 catalogue sample through a snapshot adapter
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-14, implementation stories)
epic: FUCQ-14
priority: P3
priority_reason: from FUCQ-14
size: M
depends_on: none
```

## Goal

As a vehicle-description consumer, I want an exact dated BMW catalogue snapshot so I can display source-backed configuration facts repeatably.

## Acceptance criteria

- [ ] An isolated injectable server-side catalogue interface accepts market/locale, order/effect/production/tax context, model/range/AG identity, trim and the complete selected option set; its versioned snapshot provider returns requested and resolved identity, attributed facts, completeness and a result status.
- [ ] Publish a curated observed-snapshot sample derived from the retained evidence, preserving GB, T5MJ, 72HH, G61E and separate raw G61, order date 2026-11-01 and effect/production/tax context 2027-01-05. Keep source model/AG/range fields distinct.
- [ ] Resolve the evidenced complete configuration to 5 seats, 570 litres normal and 1700 litres expanded luggage capacity, and 6.1 seconds from 0 to 100 km/h. Each value retains the evidenced measurement definition and unit; 0–100 km/h is not silently relabelled as 0–62 mph.
- [ ] The narrow common envelope exposes provider/schema/snapshot version, source kind, observation/retrieval date, catalogue validity, requested/resolved identity and explicit known/unknown values. Mixed illustrative additions are marked synthetic per field rather than borrowing the observed label.
- [ ] Snapshot lookup uses only versioned local artifacts with injected transport that fails on any outbound attempt; source payload/storage names stay inside the provider. No rule-state/garage identifier or raw source HTML is exported.
- [ ] Presentation examples show observed source/date, definition/units and future catalogue context without suggesting a VIN build, released scheme car or live lookup. This introduces no consumer screen or shared-component change.

## Files or areas

- server vehicle-evidence modules within the existing Node backend (organisation follows canonical HLD)
- versioned backend snapshot artifacts and adapter usage documentation
- server/test/bmw-catalogue-adapter.test.js (proposed)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. This story owns the narrow identity/result/provenance envelope reused by FUCQ-15/16/19; avoid a generic provider framework. Preserve selected source option/accessory types and complete lists rather than promote excerpt-only evidence to a full raw API fixture.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Use the canonical HLD vehicle-evidence boundary; no external access or new HLD agreement is required for this offline slice.

Requested: 1 November 2026, by Russell (backlog FUCQ-14, implementation story authoring). Priority: P3; priority_reason: from FUCQ-14. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): none.

## Out of scope

Live BMW calls/credentials; VIN registry, decoding or employee persistence; Eligibility, pricing/points, stock, matching or telemetry; New screens, hosting or shared-retail changes

## Validate

- node --test server/test/bmw-catalogue-adapter.test.js — the real adapter resolves the exact local sample, asserts identity/dates and all four stated measurement values/definitions, and fails on any attempted external call.
- node --test server/test/api.test.js server/test/brand.test.js server/test/render.test.js — existing retail API, six-brand behaviour and result rendering stay compatible; npm test passes.
- Inspect retained normalised sample output against docs/gcsp/evidence/fucq-4/observations-2026-11-01.json and requests-2026-11-01.json; pass means field-level source/date/units and complete selected configuration agree. No screenshots: no screen changes.

---

### [FUCQ-38](https://ibm-consulting.atlassian.net/browse/FUCQ-38) · Preserve equipment certainty and partial catalogue facts

```text
id: FUCQ-38
title: Preserve equipment certainty and partial catalogue facts
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-14, implementation stories)
epic: FUCQ-14
priority: P3
priority_reason: from FUCQ-14
size: S
depends_on: FUCQ-37
```

## Goal

As a vehicle-description consumer, I want equipment and missing specifications labelled by evidence so I cannot mistake catalogue availability for fitted equipment.

## Acceptance criteria

- [ ] Expose option definitions, configurable availability, selected catalogue equipment and verified VIN-fitted equipment as distinct claims; this provider supplies no verified VIN-fitted claims.
- [ ] The sample retains paint P0300 Alpine White and upholstery FKSFU with labels and selected status. P0475 is an available alternative until selected by a separately resolved configuration; labels never select an option.
- [ ] S03AC Towbar definition alone does not set a fitted/selected towbar flag. Complete selection can state not selected in that catalogue configuration; absence in incomplete data remains unknown.
- [ ] Missing, malformed, hyphen/sentinel and model-tree 0000 values remain unknown with a reason. A real evidenced zero is not erased solely because the sentinel is unknown. No stock.js/mapping.js fallback fills gaps.
- [ ] Only evidenced OTD meanings/units become supported technical fields; unmapped values remain unknown/unmapped. Partial results preserve known facts, individual source/date and completeness rather than emitting empty complete equipment or false/zero defaults.
- [ ] Presentation contract examples visibly distinguish available/selected/unknown equipment and partial technical facts; no handbook, catalogue or image adds connected-use telemetry, eligibility or exact-car fit.

## Files or areas

- server vehicle-evidence modules within the existing Node backend (organisation follows canonical HLD)
- versioned backend snapshot artifacts and adapter usage documentation
- server/test/bmw-catalogue-adapter.test.js (proposed)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Observed catalogue equipment is not fitted equipment. The research S03AC definition and 0000 placeholders are mandatory negative fixtures. Normalised text is safe plain text, with no optional marketing HTML renderer.

Execution preconditions (retained here so Jira-to-inbox import preserves them): FUCQ-37 supplies the common envelope and observed sample; no live access is required.

Requested: 1 November 2026, by Russell (backlog FUCQ-14, implementation story authoring). Priority: P3; priority_reason: from FUCQ-14. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-37.

## Out of scope

VIN-fitted proof or build-sheet enrichment; Additional speculative OTD mappings; Marketing HTML rendering; UI or retail mapping/default changes

## Validate

- node --test server/test/bmw-catalogue-adapter.test.js — unselected S03AC, selected paint/upholstery, incomplete option absence, unknown 0000/malformed fields, valid zero and unmapped units pass without inferred defaults.
- npm test — all existing suites pass. Inspect normalised complete/partial examples for truthful equipment certainty, source labels and usable unknown reasons; no screenshots because no screen is added.

---

### [FUCQ-39](https://ibm-consulting.atlassian.net/browse/FUCQ-39) · Resolve snapshot variants and failures without silent substitution

```text
id: FUCQ-39
title: Resolve snapshot variants and failures without silent substitution
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-14, implementation stories)
epic: FUCQ-14
priority: P3
priority_reason: from FUCQ-14
size: M
depends_on: FUCQ-37, FUCQ-38
```

## Goal

As a vehicle-description consumer, I want deterministic snapshot resolution and explicit failures so the wrong car or date cannot masquerade as my request.

## Acceptance criteria

- [ ] Canonical lookup/cache identity contains provider and schema/snapshot version, market/locale, separate model/range/AG mapping, all relevant dates, trim and sorted complete selected options. Reordered options resolve identically; different paint/date/model/market/version never collide.
- [ ] Validate required identity/date/option inputs and distinguish invalid input, unsupported/not-found snapshot, identity mismatch, source unavailable and ok/partial. An incomplete selection cannot silently resolve a complete nearby configuration.
- [ ] Wrong model/AG, market or catalogue date never falls back to another snapshot or the October 2024 eligibility matrix. Any supported snapshot choice is explicit with its own resolved identity/source/date, not a relabelled live/exact success.
- [ ] Missing, unreadable, malformed or incompatible-version local artifacts return source unavailable with a safe failure reason; unrelated valid facts supplied by a caller remain intact. No network fallback or raw source payload is exposed.
- [ ] Adapter usage documentation shows configuration, exact request/result examples, all failure states and how FUCQ-15/16/19 reuse the envelope. Durable identity contains no garage/share/rule UUID or user identifier.
- [ ] Contract tests prove offline default, source/unknown/failure fields needed by a future screen, and no mutation or repurposing of used-car feed/default/image behaviour.

## Files or areas

- server vehicle-evidence modules within the existing Node backend (organisation follows canonical HLD)
- versioned backend snapshot artifacts and adapter usage documentation
- server/test/bmw-catalogue-adapter.test.js (proposed)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Exact dated snapshots are the default demo source. This capability supplies configuration facts only; safe failure semantics are part of its presentation contract and no screenshots are needed without a consuming screen.

Execution preconditions (retained here so Jira-to-inbox import preserves them): The FUCQ-37/FUCQ-38 catalogue contract is available; snapshot runtime stays offline.

Requested: 1 November 2026, by Russell (backlog FUCQ-14, implementation story authoring). Priority: P3; priority_reason: from FUCQ-14. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-37, FUCQ-38.

## Out of scope

Generic cache/provider framework; Automatic live lookup or nearby-model fallback; Employee/registry persistence; New endpoints/screens or retail contract changes

## Validate

- node --test server/test/bmw-catalogue-adapter.test.js — permutation/collision cases and invalid/unsupported/not-found/mismatch/unavailable outcomes pass; instrumented transport records zero external requests.
- node --test server/test/api.test.js server/test/brand.test.js server/test/render.test.js — retained used-car contracts pass; npm test passes.
- Review documented normalised success/partial/failure examples against docs/gcsp/experience-quality.md; source kind, unknown values and reasons are usable without raw errors. No screenshots: this story changes only the backend contract.

---

### [FUCQ-40](https://ibm-consulting.atlassian.net/browse/FUCQ-40) · Resolve registered white and black configuration renders

```text
id: FUCQ-40
title: Resolve registered white and black configuration renders
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-15, implementation stories)
epic: FUCQ-15
priority: P3
priority_reason: from FUCQ-15
size: M
depends_on: FUCQ-37
```

## Goal

As a vehicle-description consumer, I want a registered image for a resolved BMW configuration so I can show the corresponding representative model and paint.

## Acceptance criteria

- [ ] An isolated injectable snapshot image interface accepts resolved catalogue identity, dates, complete selected options and viewpoint/size, returning an asset or explicit unsupported/unavailable/mismatch outcome in the shared envelope.
- [ ] Register versioned sample assets/manifests only after the recorded permitted-demo-use decision. Retain origin, source/observation date, content type, dimensions, model/AG/date/options, viewpoint, representative-catalogue-render role and verified/unknown fidelity attributes.
- [ ] For the evidenced T5MJ/72HH G61E context, P0300 selects the white asset and P0475 selects the matching black asset. Retain each complete resolved source selection; changing a paint code cannot imply unobserved full configuration equivalence.
- [ ] Use a source-provided or explicitly registered local asset ID. Do not construct/edit opaque COSY parameters or treat their research URLs as permanent asset identifiers.
- [ ] Assets and manifest are usable offline with no signed/private VIN URL, key or user identifier retained. Snapshot mode never resolves a COSY manifest at runtime.
- [ ] Presentation results identify representative render, observation date and model/paint fidelity while unknown wheels/interior/equipment fidelity stays unknown. No new card/screen or change to retail result-card photo/brand behaviour is introduced.

## Files or areas

- server vehicle-evidence image provider (existing Node backend)
- versioned backend image assets and asset manifest at canonical HLD location
- server/test/bmw-image-adapter.test.js (proposed)
- blocks/vehicle-matcher/modes/result-card.js (compatibility only)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. The two research renders establish model/paint variation, not every option. Asset publication follows canonical HLD; final delivery/retention decisions are explicit inputs, not inferred from public reachability. FUCQ-17 is not required.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Record permitted demo display/retention for the chosen white/black assets before registering them as runtime artifacts; research files alone are not runtime permission. Use FUCQ-37 identity/provenance.

Requested: 1 November 2026, by Russell (backlog FUCQ-15, implementation story authoring). Priority: P3; priority_reason: from FUCQ-15. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-37.

## Out of scope

Live COSY calls or key discovery; 360-degree viewer; VIN-linked/exact-stock photograph claims; UI, generic proxy/download service or retail changes

## Validate

- node --test server/test/bmw-image-adapter.test.js — exact white/black requests resolve matching registered assets/metadata and outbound transport count stays zero.
- shasum -a 256 docs/gcsp/evidence/fucq-4/i5-alpine-white-reference.webp docs/gcsp/evidence/fucq-4/i5-black-sapphire-reference.webp — compare with evidence/fucq-4/README.md when those authorised assets are selected; inspect actual runtime asset dimensions/content type and visible same-model paint variation.
- npm test — retail image/brand behaviour remains unchanged. Review representative/unknown-fidelity output; no screenshots because no consuming screen changes.

---

### [FUCQ-41](https://ibm-consulting.atlassian.net/browse/FUCQ-41) · Return honest missing-image and fidelity results

```text
id: FUCQ-41
title: Return honest missing-image and fidelity results
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-15, implementation stories)
epic: FUCQ-15
priority: P3
priority_reason: from FUCQ-15
size: S
depends_on: FUCQ-40
```

## Goal

As a vehicle-description consumer, I want a useful no-image response so image gaps do not hide valid facts or misrepresent another car.

## Acceptance criteria

- [ ] Missing or broken files, malformed manifest records and mismatched model/date/paint produce explicit unavailable/unsupported/mismatch responses with safe reasons, without discarding separately valid specification results.
- [ ] A registered generic fallback is returned only through an explicit fallback choice, labelled representative with unknown configuration fidelity; it cannot inherit exact model/paint-match or verified-appearance claims.
- [ ] Catalogue renders, VIN-linked illustrations and exact-car stock photos have distinct roles. A full selected-option request never elevates unknown visual attributes to verified.
- [ ] Returned examples supply all fields needed to display representative-image, missing-image and per-attribute unknown-fidelity states with usable text. No upstream HTML/error, secret or private image URL leaks.
- [ ] Existing mediaWell/result-card photo-failure and brand behaviour remains unchanged; this server capability adds no screen or component.

## Files or areas

- server vehicle-evidence image provider and asset manifest
- server/test/bmw-image-adapter.test.js (proposed)
- blocks/vehicle-matcher/modes/result-card.js (compatibility only)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. A missing image is separate from missing vehicle facts. Apply the experience contract to the backend presentation states; later consumers implement shared-kit fallbacks under the agreed references.

Execution preconditions (retained here so Jira-to-inbox import preserves them): FUCQ-40 has the image contract and permitted registered sample assets.

Requested: 1 November 2026, by Russell (backlog FUCQ-15, implementation story authoring). Priority: P3; priority_reason: from FUCQ-15. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-40.

## Out of scope

New UI fallback component; Silent wrong-model/paint image substitution; VIN appearance/build proof; Retail result-card changes

## Validate

- node --test server/test/bmw-image-adapter.test.js — absent/broken asset, malformed manifest, wrong model/date/paint, explicit generic fallback and role/fidelity cases pass while valid specs survive.
- node --test server/test/render.test.js server/test/brand.test.js — used-car media and brands pass; npm test passes. Inspect representative/missing/unknown-fidelity examples; no screenshots because there is no changed screen.

---

### [FUCQ-42](https://ibm-consulting.atlassian.net/browse/FUCQ-42) · Select offline image views and sizes with exact lookup identity

```text
id: FUCQ-42
title: Select offline image views and sizes with exact lookup identity
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-15, implementation stories)
epic: FUCQ-15
priority: P3
priority_reason: from FUCQ-15
size: S
depends_on: FUCQ-40, FUCQ-41
```

## Goal

As an image consumer, I want deterministic supported views and sizes so one configuration cannot reuse another configuration’s cached render.

## Acceptance criteria

- [ ] Canonical image lookup/cache key includes provider/manifest version, complete resolved market/model/AG/date/trim/options identity, viewpoint and requested size. Sorting options is stable; changed identity, paint, date, view, size or version cannot collide.
- [ ] Return only a registered supported viewpoint and size, with actual dimensions/content type. Unsupported view/size has an explicit result; no guessed crop, opaque query edit or invented expiry is used.
- [ ] Validate manifest references, content type and dimensions before exposing an asset; missing/inconsistent metadata is unavailable rather than a confirmed match. The observed 39 entries/crops never becomes a 360-degree capability claim.
- [ ] Repeated exact requests remain deterministic and fully offline, including startup and provider selection. The usage record shows the representative, missing, unsupported and unknown-fidelity contract states.
- [ ] No signed/private VIN URL, credential or user identifier participates in keys, fixtures or browser-facing metadata; legacy used-car photo/brand output stays compatible.

## Files or areas

- server vehicle-evidence image lookup and versioned manifest
- server/test/bmw-image-adapter.test.js (proposed)
- adapter usage documentation

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Reuse FUCQ-37 identity semantics rather than define a second configuration identity. This story adds no screen; image artifact inspection and presentation-contract validation are sufficient here.

Execution preconditions (retained here so Jira-to-inbox import preserves them): FUCQ-40/FUCQ-41 supply registered image selection and failure semantics; any extra asset/view registration needs permitted use.

Requested: 1 November 2026, by Russell (backlog FUCQ-15, implementation story authoring). Priority: P3; priority_reason: from FUCQ-15. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-40, FUCQ-41.

## Out of scope

Live manifests; New image transforms/proxy service; 360-degree controls; Consuming UI or retail image changes

## Validate

- node --test server/test/bmw-image-adapter.test.js — option permutations, every key dimension, unsupported views/sizes, invalid type/dimensions and unavailable references pass with zero network calls.
- npm test — passes. Inspect documented output and registered assets for correct roles, dimensions and fidelity limits; no new screenshots because no screen changes.

---

### [FUCQ-43](https://ibm-consulting.atlassian.net/browse/FUCQ-43) · Expose offline handbook metadata with a synthetic-identity guard

```text
id: FUCQ-43
title: Expose offline handbook metadata with a synthetic-identity guard
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-16, implementation stories)
epic: FUCQ-16
priority: P3
priority_reason: from FUCQ-16
size: M
depends_on: FUCQ-37
```

## Goal

As a current-car content consumer, I want honest handbook metadata and safe identity routing so synthetic demo VINs never reach a real guide service.

## Acceptance criteria

- [ ] Define a replaceable server-side VIN-content contract and synthetic fixture provider for guide availability/title, derivative/brand when returned, usable disclaimer, handbook-link metadata, VIN-linked-illustration status, source/date and completeness.
- [ ] Lookup remains disabled unless a provider is explicitly selected; synthetic fixture mode performs zero external requests. Validate/case-normalise exactly 17 allowed BMW VIN-format characters and explicit locale, without applying an incompatible regional check digit as a universal validity rule.
- [ ] The real-provider entry guard requires trusted server-owned context for an externally authorised real-VIN lookup. Registry synthetic records and synthetic/unknown-registry lookup flows are rejected before any key/manual/pdf/cosy request, including provider switches and fallback. Browser identity flags, regex/checksum success and a registry miss are never permission to forward.
- [ ] Provide an injectable guard/identity-context seam for FUCQ-19 to consume and test. It adds no persistence/public VIN endpoint and does not use a regex/checksum or assumed reserved VIN range to discover synthetic identities.
- [ ] Guide title/sections/disclaimer/image remain handbook or illustration evidence. Paint, wheels, installed equipment, build date, connected usage and scheme eligibility stay unknown; never silently join a 2027 catalogue or 2024 matrix.
- [ ] Presentation examples distinguish disabled, invalid input, available, no-guide, unsupported locale, partial and unavailable states; a failure preserves other known current-car facts and cannot become a complete empty equipment list.

## Files or areas

- server vehicle-evidence VIN-content contract, synthetic provider and trusted identity guard
- server/test/bmw-vin-guide-adapter.test.js (proposed)
- FUCQ-19 registry/consuming adapter integration boundary (coordination only)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. FUCQ-19 owns registry classification and all synthetic lookup routing; this story owns rejection at the guide transport boundary. No generated or user-supplied real VIN, suffix, encrypted value or private lookup URL is committed. Known user-supplied live evidence is referenced only in redacted form.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Coordinate the narrow trusted identity-routing boundary with FUCQ-19; implementing this reusable guard does not require completing its registry. Default provider is synthetic/offline and lookup is disabled until explicitly configured.

Requested: 1 November 2026, by Russell (backlog FUCQ-16, implementation story authoring). Priority: P3; priority_reason: from FUCQ-16. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-37.

## Out of scope

Registry/service/generator implementation; Public VIN HTTP endpoint or persistence; Build sheet/connected data; New UI or third-party decoder fallback

## Validate

- node --test server/test/bmw-vin-guide-adapter.test.js — synthetic fixtures, disabled provider, canonicalisation/locale, metadata/unknown states and guard cases pass; instrument key/manual/pdf/cosy transports to assert zero calls for synthetic/unknown-registry paths.
- npm test — passes. Inspect guide/illustration/disclaimer/unknown-equipment presentation examples; no screenshots because this is an isolated backend contract.
- Coordinate the FUCQ-19 integration result: its actual HTTP adapter must exercise the same guard for registry miss/outage/provider-switch/fallback; no guide completion claim covers unbuilt registry paths.

---

### [FUCQ-44](https://ibm-consulting.atlassian.net/browse/FUCQ-44) · Retrieve guide metadata through fresh-key BMW encryption

```text
id: FUCQ-44
title: Retrieve guide metadata through fresh-key BMW encryption
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-16, implementation stories)
epic: FUCQ-16
priority: P3
priority_reason: from FUCQ-16
size: M
depends_on: FUCQ-43
```

## Goal

As an authorised current-car content consumer, I want the proven Driver’s Guide route behind the same contract so handbook availability can be checked without exposing the VIN.

## Acceptance criteria

- [ ] Implement explicitly selected BMW Driver’s Guide provider: GET fixed /digital/v4.0/key, decode publicKeyData.pem as base64 DER/SPKI, encrypt with RSA PKCS#1 v1.5 and encode base64url for /manual encryptedVin and explicit locale.
- [ ] Fetch/validate the current source key; do not embed a static encryption key, website API key, BMW ID credential, copied private lookup URL or user VIN. Unsupported/malformed key metadata/DER/algorithm is a safe invalid-source result.
- [ ] Try the requested locale, then only a returned/available UK-English alternative at most once for the same VIN. Preserve requested/resolved locale and identity; no endless fallback, unsupported locale substitution or model change.
- [ ] Validate HTTP status separately from application status/schema. HTTP 200/MANUAL_NOT_AVAILABLE is content unavailable, not transport success with a complete guide; no-match, unsupported locale, malformed response, timeout and source unavailable stay distinct. HTTP 200/application 422 is never a successful decode.
- [ ] Inject transport/clock/key handling for deterministic synthetic tests; fixed/allowlisted source URLs and bounded timeouts/retries prevent arbitrary requests. FUCQ-43 guard executes before every real-provider path.
- [ ] Return the FUCQ-43 metadata/disclaimer and source labels without inferring equipment. Plaintext, suffix/encrypted VIN, response VIN fields and query/hash URLs are absent from thrown exceptions, logs, traces, analytics and retained output.

## Files or areas

- server vehicle-evidence BMW Driver’s Guide provider and explicit backend configuration
- server/test/bmw-vin-guide-adapter.test.js (proposed)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Native evidence/drivers-guide-native-2026-11-01.json proves fresh-key encrypted handbook access without cookies/API keys and the material en-us/en-gb difference. It does not prove BMW production support or build-sheet data. No live source is enabled by default.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Record explicit Driver’s Guide live activation/demo-use and retention decisions separately. A privately supplied authorised real VIN is required only for an optional live check; tests use generated test identifiers and injected transport.

Requested: 1 November 2026, by Russell (backlog FUCQ-16, implementation story authoring). Priority: P3; priority_reason: from FUCQ-16. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-43.

## Out of scope

Know Your BMW or Outvin fallback; Persistence/public lookup endpoint; Fitted equipment, exact paint or telemetry; New UI or account credentials

## Validate

- node --test server/test/bmw-vin-guide-adapter.test.js — use generated RSA test key material to decrypt the captured test ciphertext privately and assert PKCS#1 v1.5/base64url, fresh-key validation, two-attempt locale bound, identity retention, independent HTTP/application outcomes and timeouts.
- node --test server/test/bmw-vin-guide-adapter.test.js — capture logs/errors/trace sinks and assert absence of complete/partial/encrypted synthetic identifiers, response VIN fields and private query/hash URLs across success and failure.
- npm test — passes. Inspect metadata source/disclaimer/unknown fields; no screenshots because no screen changes. Fixture success is explicitly recorded as offline proof, not a live activation claim.

---

### [FUCQ-45](https://ibm-consulting.atlassian.net/browse/FUCQ-45) · Expose controlled handbook links and VIN-linked image status

```text
id: FUCQ-45
title: Expose controlled handbook links and VIN-linked image status
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-16, implementation stories)
epic: FUCQ-16
priority: P3
priority_reason: from FUCQ-16
size: S
depends_on: FUCQ-44
```

## Goal

As a current-car content consumer, I want safe handbook references and illustration availability so I can access available content without treating it as exact vehicle specification.

## Acceptance criteria

- [ ] Allow the selected guide provider to request /pdfManual and /cosy through the same fixed/allowlisted controlled transport, same authorised identity guard and same bounded locale/identity handling as /manual.
- [ ] Validate returned link origins/protocol/content metadata and image content type; reject malformed, foreign or unsafe URLs and do not execute upstream HTML. Handbook-link metadata and image availability/role use the common source-labelled contract.
- [ ] Preserve usable non-binding guide disclaimer. Illustration status never asserts exact paint/wheels/fitted equipment; broken/missing illustration or PDF leaves valid handbook metadata and other current-car facts intact.
- [ ] Keep full/partial/encrypted VINs, source response VIN fields and private PDF/image/query/hash URLs out of logs, traces, exceptions, analytics, committed fixtures and retained evidence. No persistence/public VIN lookup or general upstream proxy is added.
- [ ] Provide a redacted opt-in verification procedure/harness excluded from npm test and default runtime. It reports provider/version/date, HTTP/application outcome, locale, link/image status and limits only; record whether it was exercised and distinguish demo proof from supported production proof.
- [ ] Contract examples cover usable guide references, no-PDF/no-image, unknown fidelity, invalid link and provider unavailable. No new screen is introduced, so asset/content and contract inspection provide experience evidence.

## Files or areas

- server vehicle-evidence Driver’s Guide PDF/image boundary
- server/test/bmw-vin-guide-adapter.test.js (proposed)
- scripts/gcsp/verify-vin-guide.mjs (proposed opt-in redacted harness)
- docs/gcsp/evidence/fucq-15/ (redacted proof/runbook)

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. The source image is VIN-linked illustration, not a catalogue render/exact-car photograph/build sheet. Never retain the private research image or copied private URLs. Live verification is separately authorised and cannot submit generated FUCQ-19 VINs.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Record live activation/use/retention before any live exercise; any content/asset delivery must use the canonical HLD route and allowed source policy. Optional live smoke uses a privately supplied authorised real VIN with no retained identifiers.

Requested: 1 November 2026, by Russell (backlog FUCQ-16, implementation story authoring). Priority: P3; priority_reason: from FUCQ-16. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-44.

## Out of scope

New screen or arbitrary content proxy; VIN persistence/public lookup; Third-party decoder/payment/CAPTCHA automation; Claiming optional live check is mandatory production certification

## Validate

- node --test server/test/bmw-vin-guide-adapter.test.js — PDF/cosy guard, fixed source and returned-link validation, missing/broken content, disclaimer, preservation of facts and identifier-leak assertions pass offline.
- npm test — passes with no external guide calls.
- node scripts/gcsp/verify-vin-guide.mjs --live — only under the recorded authorised live-use context, private identifier input and activation/retention decision; pass means redacted positive/negative content statuses and no identifiers/private URLs in output. If not run, state unexercised rather than claim live success. No new screenshots: no screen changes.

---

### [FUCQ-46](https://ibm-consulting.atlassian.net/browse/FUCQ-46) · Resolve a live catalogue configuration behind the snapshot contract

```text
id: FUCQ-46
title: Resolve a live catalogue configuration behind the snapshot contract
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-17, implementation stories)
epic: FUCQ-17
priority: P3
priority_reason: from FUCQ-17
size: M
depends_on: FUCQ-39
```

## Goal

As a catalogue consumer, I want an explicitly selected live provider so current source facts can replace snapshots without changing the consumer contract.

## Acceptance criteria

- [ ] Implement the existing C13 catalogue contract using the selected matrix, constructibility, option-label and OTD families or documented approved replacement; inject HTTP transport and keep snapshot the default.
- [ ] Carry requested/resolved GB market/locale, model/range/AG, order/effect/production/tax dates, trim and complete sorted selected options through the chain. Preserve source option versus accessory typing and inspect constructibility, added/removed/ignored/invalid options.
- [ ] Report actual resolution differences; changed model/market/date, incomplete/invalid selection or option loss never silently becomes the requested configuration. G21/T3MQ resolving to T3SK petrol is a rejected mismatch before specs/images join.
- [ ] Map only evidenced meanings/units and selected-equipment labels into the same contract. Missing/0000 remains unknown; definition/available/selected/fitted are distinct; retail prices never become GCSP points.
- [ ] Explicit provider configuration with absent access/credentials returns source unavailable and may offer an explicitly labelled snapshot selection. It cannot silently switch while retaining live/official labels.
- [ ] Make no garage/share-code write, replayed state UUID request or optional marketing-HTML fetch/render. Keys/raw upstream errors/HTML never reach browser responses or retained logs.
- [ ] Presentation examples preserve requested/resolved identities, source/date/completeness and unknown/failure reasons in the C13 shape; no consumer screen or retail feed behaviour changes.

## Files or areas

- server vehicle-evidence live catalogue provider/backend configuration
- server/test/bmw-live-catalogue.test.js (proposed)
- docs/gcsp/evidence/fucq-16/ provider setup record

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Live source choice remains explicit and externally gated: record sanctioned access/credentials, permitted demo use/retention and limits before implementation. The public-website-key follow-up proves technical catalogue access and remains a user-authorised unsupported demo candidate; do not reinstate a blanket website-key research/reuse prohibition. Selecting such a demo route or changing the sanctioned-provider gate requires an explicit recorded owner decision, never an inferred production entitlement. Keep keys backend-only and out of source, command arguments, logs and browser responses. Mock/fixture success is not authorised live completion or supported production integration. Observed paths and paired public-key evidence are references, not a complete supported schema. Any approved replacement must document equivalent mapping rather than fabricate UCP compatibility.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Before implementation record sanctioned endpoint/credential arrangement, permitted demo use/retention and rate limits, or an explicit owner-approved demo-provider/gate amendment. Credentials remain backend-only; no discovery/procurement is implied. Canonical HLD governs placement.

Requested: 1 November 2026, by Russell (backlog FUCQ-17, implementation story authoring). Priority: P3; priority_reason: from FUCQ-17. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-39.

## Out of scope

Provider signup/procurement or unrequested key discovery; Pricing/accessory product, garage writes; Imagery, VIN build or scheme logic; New UI/hosting activation or retail changes

## Validate

- node --test server/test/bmw-live-catalogue.test.js server/test/bmw-catalogue-adapter.test.js — injected exact chain, sorted complete options, source typing, solver mutations, invalid/incomplete inputs, 0000/unselected towbar and G21 substitution all satisfy the same consumer contract.
- npm test — passes offline; instrument transport to allow only injected expected read requests, assert no garage write and no leaked credential/raw error.
- Inspect live-labelled, snapshot-labelled, partial and mismatch contract examples; no screenshots because no consuming surface changes. Record this as fixture proof pending FUCQ-48 live verification.

---

### [FUCQ-47](https://ibm-consulting.atlassian.net/browse/FUCQ-47) · Bound live catalogue failures and preserve truthful fallback

```text
id: FUCQ-47
title: Bound live catalogue failures and preserve truthful fallback
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-17, implementation stories)
epic: FUCQ-17
priority: P3
priority_reason: from FUCQ-17
size: S
depends_on: FUCQ-46
```

## Goal

As a catalogue consumer, I want bounded failures and accurate freshness so an unreliable source cannot quietly substitute stale or wrong configuration facts.

## Acceptance criteria

- [ ] Map 401/403 auth failure, 429 with retry hints, 5xx, timeout, empty matrix, malformed/invalid schema and application failure to distinct safe contract outcomes. Auth failures never loop; retries/timeouts/concurrency are finite and follow recorded source limits.
- [ ] Cache only where allowed, with provider/schema/version, market/locale, model/range/AG, dates/trim and full sorted options identity plus recorded retrieval/freshness/expiry policy. No invented unlimited retention or cache across changed paint/date/model/provider.
- [ ] Explicit snapshot fallback retains its observed-snapshot provider/version/date and resolved identity; exact mismatches remain mismatches and stale live data cannot remain labelled fresh. If no matching permitted fallback exists, return source unavailable.
- [ ] Source failure does not become no eligible cars, empty complete equipment or inferred zero/default facts. Valid known facts from other sources remain usable.
- [ ] Redact secret-bearing headers, raw response/errors and source HTML from logs/traces/exceptions/browser output, including retry and startup paths. No request contains captured garage/share/rule UUIDs.
- [ ] Presentation contract examples make source, freshness, failure reason and snapshot choice observable without introducing a screen or altering used-car behaviour.

## Files or areas

- server vehicle-evidence live catalogue failure/cache boundary
- server/test/bmw-live-catalogue.test.js (proposed)
- provider retention/operation documentation

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Live source choice remains explicit and externally gated: record sanctioned access/credentials, permitted demo use/retention and limits before implementation. The public-website-key follow-up proves technical catalogue access and remains a user-authorised unsupported demo candidate; do not reinstate a blanket website-key research/reuse prohibition. Selecting such a demo route or changing the sanctioned-provider gate requires an explicit recorded owner decision, never an inferred production entitlement. Keep keys backend-only and out of source, command arguments, logs and browser responses. Mock/fixture success is not authorised live completion or supported production integration. Provider-specific terms control caching; do not copy the existing retailer cache TTL/rate policy into UCP. Offline tests use a fake clock and injected transport, never actual throttling.

Execution preconditions (retained here so Jira-to-inbox import preserves them): The selected source’s access/rate/cache/retention terms are recorded; FUCQ-46 provides the live request chain and unchanged contract.

Requested: 1 November 2026, by Russell (backlog FUCQ-17, implementation story authoring). Priority: P3; priority_reason: from FUCQ-17. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-46.

## Out of scope

Automatic live activation; Generic cache framework or source-wide crawler; Eligibility/stock fallback; New UI or retail cache changes

## Validate

- node --test server/test/bmw-live-catalogue.test.js — fake-clock tests verify finite auth/rate/server retries, Retry-After handling, timeout, empty/invalid/application failures, allowed cache freshness and all identity-key separations.
- node --test server/test/bmw-live-catalogue.test.js — credential/HTML/error-leak assertions and explicitly labelled same-identity snapshot/unavailable cases pass; npm test passes.
- Inspect normalised unavailable/partial/stale/snapshot-choice examples for safe source/freshness/reason fields. No new screenshots because no consumer screen changes.

---

### [FUCQ-48](https://ibm-consulting.atlassian.net/browse/FUCQ-48) · Verify the selected live catalogue provider with redacted evidence

```text
id: FUCQ-48
title: Verify the selected live catalogue provider with redacted evidence
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-17, implementation stories)
epic: FUCQ-17
priority: P3
priority_reason: from FUCQ-17
size: S
depends_on: FUCQ-46, FUCQ-47
```

## Goal

As a demo owner, I want a bounded redacted live verification so I can tell demonstrated provider capability from offline tests and supported production access.

## Acceptance criteria

- [ ] Provide an opt-in bounded read-only smoke harness/procedure outside npm test and ordinary lookup, taking its source/access context from secure backend configuration rather than command-line secrets.
- [ ] The authorised positive run proves exact requested/resolved identity/dates/complete options, one constructible normalised configuration and representative evidenced technical values/units against source output; retain only redacted normalised comparisons and provider/version/date/limitations.
- [ ] A separate controlled mismatch fixture verifies G21/T3MQ→T3SK petrol rejection; do not require the live source still to reproduce a historical substitution or accept it as success.
- [ ] Verify source unavailability yields the documented explicit snapshot choice/unavailable label with no credential or raw source leakage; no garage/share write or telemetry/eligibility assertion occurs.
- [ ] The setup/evidence record distinguishes observed unsupported demo access, authorised live demo proof and supported production integration. Offline mocks alone cannot satisfy the live positive criterion; missing external inputs leave this story incomplete with the exact precondition named.
- [ ] Run through the same selected provider/consumer contract used by application callers, with zero implicit calls from normal demo startup or CI. Inspect representative source/unknown/failure presentation fields; no new UI is added.

## Files or areas

- scripts/gcsp/verify-live-catalogue.mjs (proposed)
- server/test/bmw-live-catalogue.test.js (proposed)
- docs/gcsp/evidence/fucq-16/ redacted proof and runbook

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Live source choice remains explicit and externally gated: record sanctioned access/credentials, permitted demo use/retention and limits before implementation. The public-website-key follow-up proves technical catalogue access and remains a user-authorised unsupported demo candidate; do not reinstate a blanket website-key research/reuse prohibition. Selecting such a demo route or changing the sanctioned-provider gate requires an explicit recorded owner decision, never an inferred production entitlement. Keep keys backend-only and out of source, command arguments, logs and browser responses. Mock/fixture success is not authorised live completion or supported production integration. The current native 200 evidence covers only selected requests, not quotas, every model, production support or full catalogue reliability. Live verification must use the final selected provider, not rely on historical screenshots.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Selected sanctioned access or explicitly approved demo-provider gate amendment exists, along with permitted use/retention/rate limits and secure backend credential supply. Live completion cannot be claimed while these remain unavailable.

Requested: 1 November 2026, by Russell (backlog FUCQ-17, implementation story authoring). Priority: P3; priority_reason: from FUCQ-17. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-46, FUCQ-47.

## Out of scope

Bulk 10,000-configuration run; Deployment/procurement; Production readiness certification; New UI or provider selection by the implementer

## Validate

- node --test server/test/bmw-live-catalogue.test.js — the bounded smoke harness is exercised with injected success/error/mismatch responses and redaction assertions; npm test passes without external requests.
- node scripts/gcsp/verify-live-catalogue.mjs --live — after recorded access/use preconditions, pass requires positive exact normalised/source comparison, finite read count and redacted provider/version/date/limits evidence. Mock-only or unexecuted results do not pass live completion.
- Review docs/gcsp/evidence/fucq-16/ for separate offline/live/support claims and truthful presentation fields; no new screenshots because no consuming screen changes.

---

### [FUCQ-49](https://ibm-consulting.atlassian.net/browse/FUCQ-49) · Resolve named live renders for complete snapshot configurations

```text
id: FUCQ-49
title: Resolve named live renders for complete snapshot configurations
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-18, implementation stories)
epic: FUCQ-18
priority: P3
priority_reason: from FUCQ-18
size: M
depends_on: FUCQ-42
```

## Goal

As an image consumer, I want a live named configuration render behind the snapshot interface so I can resolve current representative imagery without changing vehicle facts.

## Acceptance criteria

- [ ] Implement C14 image-provider contract using observed COSY manifest path or approved replacement, resolved AG model, compact effect date, complete normalised selected options and requested view/viewport/size.
- [ ] Accept a complete known snapshot configuration without fetching a live catalogue. Validate requested/resolved model/date/options before combining manifest assets; detect wrong model/paint rather than silently showing another car.
- [ ] Choose a returned named asset and supported dimensions/content type from validated manifest fields; unsupported/missing view/size or malformed records return explicit unsupported/unavailable states.
- [ ] Treat returned cosySec asset URLs as opaque: never edit/query-build them, invent an expiry or infer a 360-degree embed from 39 entries/crops. Only source-registered permitted origins/asset references are accepted, with no arbitrary-URL proxy/download service.
- [ ] Retain representative-catalogue-render role, source/retrieval date, requested/resolved configuration and per-attribute verified/unknown fidelity. Complete options do not prove that all options are visibly depicted.
- [ ] Snapshot remains default and all normal tests are offline; absent credentials returns unavailable or explicit matching snapshot choice with truthful provenance. Image failure never discards valid specs or changes used-car image/brand behaviour.

## Files or areas

- server vehicle-evidence live image provider/backend configuration
- server/test/bmw-live-imagery.test.js (proposed)
- provider-specific manifest/access setup documentation

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Live source choice remains explicit and externally gated: record sanctioned access/credentials, permitted demo use/retention and limits before implementation. The public-website-key follow-up proves technical catalogue access and remains a user-authorised unsupported demo candidate; do not reinstate a blanket website-key research/reuse prohibition. Selecting such a demo route or changing the sanctioned-provider gate requires an explicit recorded owner decision, never an inferred production entitlement. Keep keys backend-only and out of source, command arguments, logs and browser responses. Mock/fixture success is not authorised live completion or supported production integration. Protected manifest resolution and directly retrievable returned assets are distinct access facts. The public-website-key follow-up did not prove COSY native replay; final selected access must be demonstrated. This provider is independent of FUCQ-17.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Before implementation record sanctioned manifest access/credentials (or explicitly approved demo-provider/gate amendment), allowed image display/retention and source limits. Resolve final source/delivery configuration within canonical HLD; complete C14 snapshot inputs suffice, with no FUCQ-17 dependency.

Requested: 1 November 2026, by Russell (backlog FUCQ-18, implementation story authoring). Priority: P3; priority_reason: from FUCQ-18. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-42.

## Out of scope

New live catalogue dependency; 360-degree UI; VIN imagery/build decoding or stock-photo claims; General proxy/download service, new screen or retail changes

## Validate

- node --test server/test/bmw-live-imagery.test.js server/test/bmw-image-adapter.test.js — complete snapshot input, exact request identity/options/date/view, named asset/dimensions and unsupported/malformed/wrong-model/paint cases pass with injected transport.
- npm test — passes offline. Inspect representative/unknown-fidelity/unavailable output and confirm no key/raw upstream error/private URL in retained output; no new screenshots because no consuming screen changes.

---

### [FUCQ-50](https://ibm-consulting.atlassian.net/browse/FUCQ-50) · Apply permitted image freshness and honest failure choices

```text
id: FUCQ-50
title: Apply permitted image freshness and honest failure choices
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-18, implementation stories)
epic: FUCQ-18
priority: P3
priority_reason: from FUCQ-18
size: S
depends_on: FUCQ-49
```

## Goal

As an image consumer, I want bounded asset failures and correct freshness so a stale render cannot be shown as an exact current image.

## Acceptance criteria

- [ ] Cache only under the recorded provider retention/freshness policy, keyed by provider/manifest version, complete configuration/date/options and view/size; different paint/model/date/view/size cannot collide.
- [ ] Manifest 401/403, 429/retry hints, 5xx/timeouts, malformed schema/missing views, invalid origin/content type/dimensions and expired/broken returned assets yield safe unavailable/unsupported outcomes with finite retries. Auth failures never loop.
- [ ] Any snapshot fallback is an explicitly selected C14 asset with its own snapshot source/date and fidelity; wrong model/paint never becomes a hidden fallback and a failed image does not suppress valid specs.
- [ ] Asset origins/redirects and content type follow the agreed delivery policy; opaque source parameters remain unmodified. Do not invent COSY asset lifetime, a shared universal cache TTL or permissions from public reachability.
- [ ] Credential/private URLs and raw upstream exceptions are excluded from retained logs/errors/traces and browser contract fields except the explicitly permitted delivery reference determined by the recorded asset route. No secret-bearing URL is published.
- [ ] Presentation contract covers unavailable image, snapshot choice, representative role, freshness and unknown fidelity; no screen/component or used-car media behaviour changes.

## Files or areas

- server vehicle-evidence live imagery failure/cache/asset boundary
- server/test/bmw-live-imagery.test.js (proposed)
- provider-specific retention/delivery documentation

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Live source choice remains explicit and externally gated: record sanctioned access/credentials, permitted demo use/retention and limits before implementation. The public-website-key follow-up proves technical catalogue access and remains a user-authorised unsupported demo candidate; do not reinstate a blanket website-key research/reuse prohibition. Selecting such a demo route or changing the sanctioned-provider gate requires an explicit recorded owner decision, never an inferred production entitlement. Keep keys backend-only and out of source, command arguments, logs and browser responses. Mock/fixture success is not authorised live completion or supported production integration. C14 already defines the image states. Retain them across providers; no silent official/live label survives a snapshot choice. Exact asset-delivery mechanics follow the canonical HLD and the selected source policy.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Selected manifest/asset access, allowed caching/display/retention and freshness policy are recorded; FUCQ-49 provides live named-asset resolution.

Requested: 1 November 2026, by Russell (backlog FUCQ-18, implementation story authoring). Priority: P3; priority_reason: from FUCQ-18. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-49.

## Out of scope

Generic URL fetch/proxy service; Asset transforms/360 viewer; New UI, retail media changes or fake image lifetime; Assuming display/retention rights

## Validate

- node --test server/test/bmw-live-imagery.test.js — fake-clock/transport cases cover every key dimension, allowed freshness, finite 401/403/429/5xx/timeout retries, expired/broken assets, invalid origin/type/dimensions and truthful snapshot/unavailable states.
- npm test — passes offline; captured logs/errors contain no credentials/private URLs. Inspect representative/freshness/missing/unknown-fidelity examples; no screenshots because no consuming screen changes.

---

### [FUCQ-51](https://ibm-consulting.atlassian.net/browse/FUCQ-51) · Verify live paint variation and the agreed asset delivery route

```text
id: FUCQ-51
title: Verify live paint variation and the agreed asset delivery route
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-18, implementation stories)
epic: FUCQ-18
priority: P3
priority_reason: from FUCQ-18
size: S
depends_on: FUCQ-49, FUCQ-50
```

## Goal

As a demo owner, I want redacted proof of live model/paint renders and usable delivery so the demo does not rely on an unverified image URL.

## Acceptance criteria

- [ ] Provide an opt-in bounded live manifest/asset verification harness excluded from npm test/default runtime and ordinary lookups. Complete known snapshot configurations are inputs; no implicit live-catalogue request is made.
- [ ] An authorised live run resolves the same model/view in P0300 white and P0475 black with matching identity/date/options and supported dimensions, validates the returned permitted asset origin/content type, and visually inspects the actual assets for same-model paint variation.
- [ ] Retain redacted model/view/configuration/source/provider/version/date evidence, paint variation and unknown option fidelity; no claim that wheels/interior/every encoded option is visually exact and no 360-degree claim.
- [ ] Verify one returned asset works through the recorded frontend delivery route with the required origin/CSP/authorisation conditions and no browser credential exposure. This is asset-route proof, not a new GCSP screen or deployment activation; where the route is owner-undecided, completion remains gated.
- [ ] Keep credentials, private/signed source URLs and opaque parameters out of retained output. Any permitted visual evidence/artifacts comply with the recorded retention policy and show representative role/fidelity limits.
- [ ] Mock tests alone cannot satisfy positive live/asset-route proof; report exact missing external input if blocked, and distinguish authorised demo proof from supported production access. Image failure remains separate from valid specs.

## Files or areas

- scripts/gcsp/verify-live-imagery.mjs (proposed)
- server/test/bmw-live-imagery.test.js (proposed)
- docs/gcsp/evidence/fucq-17/ redacted asset-route and visual proof

## Decided

Canonical architecture: docs/design/high-level-design.drawio, docs/design/README.md and docs/design/gcsp-high-level-design.md, as confirmed by Russell's current direction. Implement isolated vehicle-evidence modules in the existing Node backend; no second service/database or blanket pending-HLD blocker. Keep proposed capabilities distinct from implemented proof and leave owner-reserved deployment/provider decisions open. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md, COMPONENTS.md, bmw-interface-stories.md, bmw-interface-research.md and evidence/fucq-4/README.md. The supplied GCSP screenshots govern header/sidebar/palette; the body direction is Used Cars, breadcrumbs optional. The missing-reference blocker is cleared. These backend stories add no screen: presentation contract assertions replace new screenshots; any consuming UI requires separately refined desktop/narrow/keyboard gates and shared-kit reuse. Carry these references and the specific acceptance/validation obligations into every child brief. Preserve server/stock.js, server/mapping.js and retail response/image/brand contracts; never import their model estimates as exact catalogue facts. Catalogue information, handbook content, synthetic identity, scheme eligibility/points/stock and connected telemetry remain separate. Evidence is the dated 1 November 2026 research, not a complete API schema or production support proof. Current catalogue context does not replace the October 2024 scheme baseline. No API key, raw upstream error/HTML or private VIN identifier/URL enters browser payloads, source control or retained logs. Catalogue-image delivery uses only the separately permitted asset route; no credential-bearing URL is published and no private URL is retained in evidence. Live source choice remains explicit and externally gated: record sanctioned access/credentials, permitted demo use/retention and limits before implementation. The public-website-key follow-up proves technical catalogue access and remains a user-authorised unsupported demo candidate; do not reinstate a blanket website-key research/reuse prohibition. Selecting such a demo route or changing the sanctioned-provider gate requires an explicit recorded owner decision, never an inferred production entitlement. Keep keys backend-only and out of source, command arguments, logs and browser responses. Mock/fixture success is not authorised live completion or supported production integration. Use actual returned opaque assets unmodified; do not download them to an unapproved location. Visual asset inspection verifies model/paint only. There is no new surface; any later employee/Greg image UI must meet the full experience contract against the supplied references.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Selected live manifest access plus permitted display/retention and the exact frontend asset-delivery route are recorded. Live credentials are securely available backend-side; no live completion claim without a positive authorised run.

Requested: 1 November 2026, by Russell (backlog FUCQ-18, implementation story authoring). Priority: P3; priority_reason: from FUCQ-18. Author size: S. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-49, FUCQ-50.

## Out of scope

New screen/360 viewer; Bulk image collection; Live catalogue integration; Hosting change or production readiness certification

## Validate

- node --test server/test/bmw-live-imagery.test.js — harness/delivery checks pass with injected manifests/assets and redaction assertions; npm test remains offline.
- node scripts/gcsp/verify-live-imagery.mjs --live — after recorded access/display/retention/delivery inputs, pass requires two matching white/black live resolutions, bounded read count, valid assets, actual visual model/paint inspection and successful agreed-route use with no browser credentials.
- Inspect redacted evidence and authorised actual assets for representative role/date/model/view/paint and unknown option fidelity. No new application screenshots are required because no screen changes; retain only visual evidence permitted by source policy.

---

### [FUCQ-52](https://ibm-consulting.atlassian.net/browse/FUCQ-52) · Select evidenced VIN profiles for five compatible reference vehicle classes

```text
id: FUCQ-52
title: Select evidenced VIN profiles for five compatible reference vehicle classes
kind: code
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-19, implementation stories)
epic: FUCQ-19
priority: P3
priority_reason: from FUCQ-19
size: M
depends_on: FUCQ-37
```

## Goal

As a fleet publisher, I want to select a supported, evidenced VIN profile so each fictional identity matches the configuration's actual vehicle and market context.

## Acceptance criteria

- [ ] Implement a versioned profile registry and resolver. Every enabled profile binds model/derivative, generation and body, engine/powertrain, drive/transmission where material, market and steering context, model year/production era, WMI, descriptor format, position-nine convention, position-ten convention, allowed plants and serial shape. Record profile/schema version, source references/date, confidence, unresolved facts and enabled/candidate status.
- [ ] Provide five small matched MY2026 North American reference fixtures: WBA conventional passenger car (430i Convertible), WBS full-M passenger car (M3 Competition xDrive), WBY applicable BMW i passenger car (i5 eDrive40 Sedan), 5UX SAV (X5 xDrive50e), and 5YM full-M SAV (X5 M Competition). Bind the researched descriptor and corroborated model/era plant evidence to each; preserve each reference configuration's own source context. Required unknown configuration facts remain explicit, rather than invented to complete the fixture.
- [ ] A US reference profile can resolve only a matching labelled US/North American configuration; selecting it for GB/RHD, G61 Touring, another body, powertrain, year or plant fails as unsupported or identity-mismatch before generation. Profile evidence distinguishes manufacturer-filed descriptors, production-source/partial-pattern corroboration and fictional serial allocation; incomplete vPIC business-code-6 evidence is never described as a successful complete-VIN decode.
- [ ] Resolve descriptor mappings as evidenced whole values, not a universal character grammar. Chassis/generation, AG/model code and VIN descriptor remain separate fields. Do not cross-join an independent plant dictionary with every model, infer a plant from WMI country, derive model year from catalogue effect date, or treat selected catalogue options as verified fitted equipment.
- [ ] Preserve separately evidenced additional WMIs when represented models need them; no exhaustive five-WMI whitelist or category heuristic may force M2 into WBS, every EV into WBY, or a newer similarly named derivative into an older matrix profile. Unsupported profiles fail clearly; no speculative profile is enabled to satisfy coverage.
- [ ] The two retained UK observations remain candidate-only and cannot generate identities. Activation requires resolved exact derivative/body/powertrain/market/steering/era semantics with source/date/confidence and corroboration as defined in synthetic-vin-rules.md; individual VINs, plates, serials, identity hashes, identifying URLs/captures and personal fragments are absent from profiles and fixture sources.
- [ ] Under docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md, this backend-only capability adds no screen or control and preserves presentation truth: profile and fixture output carries market/steering, source confidence, unknown fields and reference-only status so a consumer cannot present the five-WMI proof as a UK factory build. Screenshot evidence is unnecessary because no rendered surface changes.

## Files or areas

- server/gcsp/vehicle-evidence/vin-profiles.js (proposed)
- server/data/gcsp/vehicle-evidence/vin-profiles.v1.json (proposed)
- server/test/fixtures/gcsp/vehicle-evidence/five-wmi-reference-configurations.json (proposed)
- server/test/gcsp-vin-profiles.test.js (proposed)
- docs/gcsp/synthetic-vin-rules.md
- FUCQ-14 snapshot identity/provenance contract

## Decided

Canonical decisions: docs/design/high-level-design.drawio and docs/design/gcsp-high-level-design.md govern this work; Russell's latest instruction makes that HLD canonical and removes the earlier blanket wait-for-HLD gate. Use modules and indexed immutable artifacts inside the existing Node backend, not a new microservice or database. Read docs/gcsp/README.md, demo-brief.md, synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/README.md. Reuse FUCQ-14 snapshot identity/provenance and the compatible FUCQ-15 image contract where applicable; preserve retail stock.js/mapping.js behaviour. docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md apply: supplied screenshots define header/sidebar/palette, bodies follow Used Cars and shared components. This story adds no screen; validate the backend presentation/provenance states and explain why no new screenshots are required. Pass these references and relevant acceptance/validation to any later authorised descendants; authoring does not authorise implementation dispatch. FUCQ-19 acceptance 1/2/3 requires a small platform proof only. The five researched North American fixture categories are permitted for structural validation and must remain market-consistent. UK candidate observations and a four-character model code do not activate a GB/RHD VIN profile. This story creates an executable selection/validation capability rather than a new research or bulk-collection task.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Use the canonical HLD and existing server deployment/access conventions. No new infrastructure or separate detailed-interface approval is assumed. FUCQ-14 provides reusable versioned snapshot identity/provenance and validation contracts. Use the existing sanitised evidence only; research is already complete for the structural reference proof.

Requested: 1 November 2026, by Russell (backlog FUCQ-19, implementation story authoring). Priority: P3; priority_reason: from FUCQ-19. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-37.

## Out of scope

UK/RHD profile research or activation without the required evidence; 10,000-configuration collection or population; Inventing configuration equipment/technical values or scheme eligibility; New screens, browser styling and real VIN lookup

## Validate

- node --test server/test/gcsp-vin-profiles.test.js — all five labelled reference profiles select their matching fixture; market/steering/body/powertrain/year/plant mismatches, candidate-only observations and unsupported additional-WMI contexts are rejected; source confidence and unknown-state assertions pass offline.
- node --test server/test/gcsp-vin-profiles.test.js server/test/api.test.js — profile presentation contracts meet docs/gcsp/experience-quality.md, screens/README.md and COMPONENTS.md; no raw personal identifiers are retained and retail API behaviour passes. No screenshot/browser evidence is required because this story adds no rendered surface.
- npm test — existing suite and new profile checks pass without external profile lookups.

---

### [FUCQ-53](https://ibm-consulting.atlassian.net/browse/FUCQ-53) · Allocate repeatable plausible VINs without changing published identities

```text
id: FUCQ-53
title: Allocate repeatable plausible VINs without changing published identities
kind: code
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-19, implementation stories)
epic: FUCQ-19
priority: P3
priority_reason: from FUCQ-19
size: M
depends_on: FUCQ-52
```

## Goal

As a fleet publisher, I want reproducible, unique plausible VIN allocations so restarts and later additions preserve every published vehicle-to-configuration association.

## Acceptance criteria

- [ ] Generate exactly 17 uppercase permitted VIN characters, excluding I/O/Q, whitespace and punctuation, from an enabled matching profile. Generate the constrained fictional suffix first, then calculate position nine exactly for checksum-bearing profiles using the documented transliteration, position weights, integer modulo 11 and X for remainder 10. Never choose the check character randomly.
- [ ] Apply each profile's evidenced position-nine and year/era conventions, descriptor, allowed model/era plant and serial shape, preserving leading zeros and required numeric tails. Do not overwrite a historical European descriptor character or impose US model-year/checksum rules on a different profile. Keep model year, fictional production date, registration date, catalogue order date and catalogue effect date distinct; reject unsupported production-era bounds.
- [ ] Record seed, generator algorithm/version, profile/version, selected serial, canonical VIN, vehicleId, configurationId, originating datasetId and identityKind=synthetic in a reusable allocation artifact. Randomness is deterministic from stable input identities and documented configuration; no observed real VIN, individual suffix/fragment or personal lookup data is a generator input or template.
- [ ] Clean generation from the same stable inputs/seed/version produces identical mappings and byte-stable canonical allocation content. Reordered input, restart/resume and later additions against the persisted allocation artifact reuse all existing allocations. A newer catalogue/profile/generator version cannot silently replace a published VIN, serial, vehicleId, configurationId or its source snapshot association; a conflicting request is rejected.
- [ ] Check uniqueness against the entire server-owned registry/allocation inventory, including overlapping datasets and retained published identities; a new seed or batch does not reset that check. Detect and resolve collisions deterministically within a documented finite attempt bound, report a precise exhaustion outcome, and do not leave partial allocations after failure. Reject competing writers or a stale base revision before publication can overwrite allocations.
- [ ] Tests force collisions and exhaustion using a bounded test serial space, exercise at least one leading-zero suffix and profile-specific serial shapes, and cover all eleven checksum remainders including X. The public regulatory checksum example verifies the documented sum 411/remainder 4 without copying a private or observed identity into retained evidence. Do not claim that checksum validity authenticates a vehicle or guarantees non-collision with real vehicles.
- [ ] Under docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md, this backend-only capability adds no screen or control and preserves presentation truth: allocation results distinguish synthetic association, supported profile evidence, validation failure, collision and exhaustion; unknown dates stay unknown and no source factory-build claim is introduced. No screen changes, so screenshots are unnecessary.

## Files or areas

- server/gcsp/vehicle-evidence/vin-generator.js (proposed)
- server/gcsp/vehicle-evidence/vin-allocation.js (proposed)
- server/scripts/generate-synthetic-vins.mjs (proposed)
- server/test/gcsp-vin-generator.test.js (proposed)
- server/test/gcsp-vin-allocation.test.js (proposed)
- server/test/fixtures/gcsp/vehicle-evidence/ (proposed)

## Decided

Canonical decisions: docs/design/high-level-design.drawio and docs/design/gcsp-high-level-design.md govern this work; Russell's latest instruction makes that HLD canonical and removes the earlier blanket wait-for-HLD gate. Use modules and indexed immutable artifacts inside the existing Node backend, not a new microservice or database. Read docs/gcsp/README.md, demo-brief.md, synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/README.md. Reuse FUCQ-14 snapshot identity/provenance and the compatible FUCQ-15 image contract where applicable; preserve retail stock.js/mapping.js behaviour. docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md apply: supplied screenshots define header/sidebar/palette, bodies follow Used Cars and shared components. This story adds no screen; validate the backend presentation/provenance states and explain why no new screenshots are required. Pass these references and relevant acceptance/validation to any later authorised descendants; authoring does not authorise implementation dispatch. Generator output is a plausible fictional identity, never a BMW-issued or globally reserved identifier. Registry/allocation metadata identifies synthetic records; regex/checksum validity does not. Retain existing associations when replaying a generation plan; finite collision handling and explicit exhaustion are required even for seeded randomness. The allocation artifact is an offline input to FUCQ-54, not a public write API or transaction database.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Use the canonical HLD and existing server deployment/access conventions. No new infrastructure or separate detailed-interface approval is assumed. FUCQ-52's enabled profile versions and stable FUCQ-14 configuration IDs are available. Input vehicles have stable vehicleId keys independent of input array order.

Requested: 1 November 2026, by Russell (backlog FUCQ-19, implementation story authoring). Priority: P3; priority_reason: from FUCQ-19. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-52.

## Out of scope

10,000-car run or collection scheduling; Claiming exact historic UK encoding beyond enabled evidence; Mutating published configurations or reissuing VINs during scenario reset; Scheme availability, offers, telemetry and real-decoder validation

## Validate

- node --test server/test/gcsp-vin-generator.test.js — regulation example arithmetic, all 11 remainders/X, transliteration, excluded letters, corrupted checks, leading zeros and supported year/plant/era/serial-shape cases pass offline.
- node --test server/test/gcsp-vin-allocation.test.js — deterministic clean rebuild/reordering, persisted resume/restart/additions, cross-dataset collisions, finite exhaustion, stale-writer rejection and immutable association tests pass; failures publish no partial mappings.
- node --test server/test/gcsp-vin-generator.test.js server/test/gcsp-vin-allocation.test.js — presentation/provenance outcomes conform to docs/gcsp/experience-quality.md, screens/README.md and COMPONENTS.md. No screenshot is required because only backend allocation contracts change; npm test passes.

---

### [FUCQ-54](https://ibm-consulting.atlassian.net/browse/FUCQ-54) · Publish and load immutable VIN datasets atomically

```text
id: FUCQ-54
title: Publish and load immutable VIN datasets atomically
kind: code
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-19, implementation stories)
epic: FUCQ-19
priority: P3
priority_reason: from FUCQ-19
size: M
depends_on: FUCQ-53, FUCQ-39
```

## Goal

As the demo operator, I want validated versioned VIN artifacts to activate atomically so invalid loads and restarts cannot corrupt lookup identity or remove the last usable corpus.

## Acceptance criteria

- [ ] Publish a versioned backend artifact directory containing manifest.json, configurations.jsonl and an indexed VIN registry plus the persisted allocation identity inventory. Manifest records datasetId/version, schema/profile/generator versions, seed metadata, source/catalogue contexts, record and distinct-configuration counts, coverage/completeness summaries and checksums; it does not claim the small fixture set satisfies FUCQ-20's 10,000 target.
- [ ] Before activation, validate artifact checksums/schema compatibility, unique stable IDs/VINs, enabled profile compatibility and canonical configuration signatures, every VIN-to-configuration/image reference, provenance and declared counts. Reject dangling references, duplicate VINs/IDs, conflicting existing associations, unsupported profiles, truncated JSONL and missing required artifacts; profile/code version drift must not silently regenerate identities.
- [ ] Stage and validate the complete candidate away from the active in-memory/file version, then atomically select one coherent immutable version. Readers see either the old complete version or the new complete version, never a mixture. On invalid/interrupted load the previous valid version stays readable, staging is recoverable, and a cold start with no valid corpus reports source-unavailable rather than an empty valid registry.
- [ ] Identical reloads are idempotent and preserve checksums/IDs/VIN mappings. Process restart reopens the selected validated version; demo reset changes mutable scenario/fleet references only and cannot rewrite the registry or erase synthetic identity routing metadata. Dataset additions preserve all prior VIN-to-configuration and originating dataset associations; explicit removal/deactivation never makes a previously synthetic identity eligible for live forwarding.
- [ ] Persist source-backed catalogue facts and the fictional VIN/build association separately, joined by stable configurationId and vehicleId. Market/steering/date context and selected-option completeness are not inferred from VIN spelling. Eligibility, points/contribution, availability/releases, holds/reservations, allocations and usage telemetry are excluded from this static service and may reference vehicleId through their separate contracts.
- [ ] Supply a repeatable local validation/publication/load command using temporary staging and explicit artifact paths, with actionable reports on rejected artifacts and the still-active version. Keep large generated binaries outside source commits, reference approved published assets, and do not add public write/reset endpoints or a new persistence service.
- [ ] Under docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md, this backend-only capability adds no screen or control and preserves presentation truth: loader reports and active-record contracts preserve source dates, field unknowns, image role/fidelity and synthetic/source labels across successful, idempotent and failed activation. No rendered view changes, so no screenshots are needed.

## Files or areas

- server/gcsp/vehicle-evidence/synthetic-registry.js (proposed)
- server/gcsp/vehicle-evidence/corpus-publisher.js (proposed)
- server/scripts/publish-synthetic-vin-dataset.mjs (proposed)
- server/data/gcsp/vehicle-evidence/<dataset-version>/ (proposed)
- server/test/gcsp-vin-registry.test.js (proposed)
- server/test/gcsp-vin-publication.test.js (proposed)
- docs/gcsp/synthetic-vin-service.md (proposed)

## Decided

Canonical decisions: docs/design/high-level-design.drawio and docs/design/gcsp-high-level-design.md govern this work; Russell's latest instruction makes that HLD canonical and removes the earlier blanket wait-for-HLD gate. Use modules and indexed immutable artifacts inside the existing Node backend, not a new microservice or database. Read docs/gcsp/README.md, demo-brief.md, synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/README.md. Reuse FUCQ-14 snapshot identity/provenance and the compatible FUCQ-15 image contract where applicable; preserve retail stock.js/mapping.js behaviour. docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md apply: supplied screenshots define header/sidebar/palette, bodies follow Used Cars and shared components. This story adds no screen; validate the backend presentation/provenance states and explain why no new screenshots are required. Pass these references and relevant acceptance/validation to any later authorised descendants; authoring does not authorise implementation dispatch. The canonical HLD specifies manifest/configuration/index artifacts and atomic selection inside the existing backend. Immutable corpus state is separate from the proposed SQL transaction repository. Retain a server-owned synthetic identity inventory independently of active configuration availability so errors/deactivation cannot reclassify an identity. Do not change render.yaml topology or provisioning; actual release/packaging owner decisions remain in the HLD release record.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Use the canonical HLD and existing server deployment/access conventions. No new infrastructure or separate detailed-interface approval is assumed. The publisher has FUCQ-53 allocation artifacts and FUCQ-14 source-backed configuration snapshots; packaging stays inside the server root used by render.yaml.

Requested: 1 November 2026, by Russell (backlog FUCQ-19, implementation story authoring). Priority: P3; priority_reason: from FUCQ-19. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-53, FUCQ-39.

## Out of scope

New database/microservice, provisioning or deployment; 10,000-distinct fleet publication; Mutable scheme ledger, employee scenarios or stock API changes; Live BMW/provider enrichment during load

## Validate

- node --test server/test/gcsp-vin-publication.test.js — temporary-directory tests prove manifest/checksum/reference validation, atomic old-or-new reader visibility, interrupted publication recovery, finite failure reporting and absence of partial activation.
- node --test server/test/gcsp-vin-registry.test.js — identical reload/restart/addition/reset checks preserve IDs and immutable mappings; bad schemas/references/duplicate VINs/profiles leave the previous corpus usable and cold-start absence is unavailable.
- node --test server/test/gcsp-vin-registry.test.js server/test/gcsp-vin-publication.test.js — docs/gcsp/experience-quality.md, screens/README.md and COMPONENTS.md presentation assertions preserve dates/units/unknowns/representative imagery/synthetic labels in all loader states. No new screenshots are needed because no view changes; npm test passes.

---

### [FUCQ-55](https://ibm-consulting.atlassian.net/browse/FUCQ-55) · Look up published synthetic vehicles through the existing HTTP backend

```text
id: FUCQ-55
title: Look up published synthetic vehicles through the existing HTTP backend
kind: code
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-19, implementation stories)
epic: FUCQ-19
priority: P3
priority_reason: from FUCQ-19
size: M
depends_on: FUCQ-54
```

## Goal

As a backend vehicle-data consumer, I want an actual HTTP lookup over the published synthetic corpus so the service boundary works in the deployment used by the demo.

## Acceptance criteria

- [ ] Serve GET /api/gcsp/vehicle-evidence/synthetic-vins/:vin from server/index.js through the existing Node HTTP server and configured demo/service access boundary. Inject the registry dependency through buildServer for tests. Expose no public generator/publish/load endpoint, new listening service or database; preserve existing retail routes and /health.
- [ ] Canonicalise a decoded input by trimming outer whitespace and uppercasing ASCII characters; require exactly 17 permitted characters and reject embedded whitespace, I/O/Q, punctuation, malformed URL encoding, extra path segments and ambiguous input. Stored/generated VINs remain canonical. Generator/loader validations apply the evidenced profile checksum and semantics; the raw lookup route does not infer a universal US market/year/check convention from an arbitrary unknown string.
- [ ] Known records return a versioned envelope containing canonical VIN, identityKind=synthetic, stable vehicleId/configurationId/datasetId, corpus/registry version, profile provenance and attributed facts. Preserve requested/resolved context, model/body/powertrain, paint/upholstery, selected equipment and completeness, technical value meaning/units, source/catalogue dates and image references/role/fidelity; source storage field names are not the application contract.
- [ ] Return HTTP 200 with explicit complete/partial status for valid known records, 400 invalid-input for invalid canonical format, 404 not-found for well-formed inputs absent from the closed registry, and 503 source-unavailable for an absent/invalid/unreadable corpus. A well-formed unknown remains not-found rather than being assigned a US profile to reject its checksum. Per-field absence remains unknown; a missing image or optional field does not turn valid facts into not-found. Unavailable is never translated to an empty successful fleet.
- [ ] Return typed unsupported and identity-mismatch outcomes through the narrow contract where a known requested profile/identity cannot be satisfied; document their HTTP mapping without collapsing them into not-found or partial success. Never return facts for another VIN, configuration, market or body as a successful match. Keep transport/HTTP status separate from record completeness.
- [ ] Lookup is closed over server-owned immutable identity records and never calls BMW, Driver's Guide or a third-party decoder for a miss, outage, invalid input or unsupported profile. Browser flags/query parameters cannot choose a live provider, mark an identity real or override dataset routing; response diagnostics contain no credentials or retained real identifiers.
- [ ] Default VIN provider wiring uses local published artifacts. Add a documented same-entry offline start command (npm run server:gcsp-offline) that starts this existing Node backend with the synthetic provider and suppresses unrelated live stock/dealer/geocode warmup calls; ordinary retail startup remains compatible. Cold offline start, lookup and restart work without credentials or external network.
- [ ] Under docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md, this backend-only capability adds no screen or control and preserves presentation truth: the HTTP states carry actionable typed errors, units, per-field unknowns and representative-image/synthetic labels for a future screen. No screen is added; browser/screenshot review belongs to the consuming UI story, while these contracts are inspected here.

## Files or areas

- server/index.js
- server/gcsp/vehicle-evidence/synthetic-vin-handler.js (proposed)
- server/gcsp/vehicle-evidence/vehicle-details-contract.js (proposed)
- package.json
- server/test/helpers.js
- server/test/gcsp-synthetic-vin-api.test.js (proposed)
- server/test/gcsp-offline-start.test.js (proposed)
- docs/gcsp/synthetic-vin-service.md (proposed)

## Decided

Canonical decisions: docs/design/high-level-design.drawio and docs/design/gcsp-high-level-design.md govern this work; Russell's latest instruction makes that HLD canonical and removes the earlier blanket wait-for-HLD gate. Use modules and indexed immutable artifacts inside the existing Node backend, not a new microservice or database. Read docs/gcsp/README.md, demo-brief.md, synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/README.md. Reuse FUCQ-14 snapshot identity/provenance and the compatible FUCQ-15 image contract where applicable; preserve retail stock.js/mapping.js behaviour. docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md apply: supplied screenshots define header/sidebar/palette, bodies follow Used Cars and shared components. This story adds no screen; validate the backend presentation/provenance states and explain why no new screenshots are required. Pass these references and relevant acceptance/validation to any later authorised descendants; authoring does not authorise implementation dispatch. The canonical HLD's actual HTTP route and same-process placement supersede earlier conceptual GET /vehicles/{vin} wording. Keep 400/404/503 distinct and use the existing access boundary; it is a shared demo gate, not employee identity. New GCSP runtime defaults are offline. The explicit offline startup profile must prevent existing main-entry retail warmers from causing external calls without retuning or restructuring normal used-car behaviour.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Use the canonical HLD and existing server deployment/access conventions. No new infrastructure or separate detailed-interface approval is assumed. FUCQ-54 supplies validated artifacts. Use the existing DEMO_ACCESS_KEY gate and buildServer dependency injection; any later hosting/access change is a separate owner decision.

Requested: 1 November 2026, by Russell (backlog FUCQ-19, implementation story authoring). Priority: P3; priority_reason: from FUCQ-19. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-54.

## Out of scope

A new HTTP server, public forwarding proxy or writable registry endpoint; Real VIN lookup, credentials or production identity/access redesign; Employee UI and scheme rules; Hosting/deployment changes or the 10,000 corpus

## Validate

- node --test server/test/gcsp-synthetic-vin-api.test.js — real buildServer instances on ephemeral ports pass complete/partial, canonical input, malformed input, unknown strings without inferred US profile/checksum assumptions, not-found, unavailable, unsupported/mismatch, configured gate and wrong-method/route tests; all live-transport spies remain at zero.
- node --test server/test/gcsp-offline-start.test.js server/test/api.test.js — subprocess offline start/restart reads packaged fixture artifacts, serves health/lookup and makes zero external startup calls; normal retail API/gate behaviour remains compatible.
- node --test server/test/gcsp-synthetic-vin-api.test.js — docs/gcsp/experience-quality.md, screens/README.md and COMPONENTS.md contract assertions cover units/unknowns/image fidelity/source dates/errors. No screenshot is required because the story changes HTTP presentation data, not a rendered surface; npm test passes.

---

### [FUCQ-56](https://ibm-consulting.atlassian.net/browse/FUCQ-56) · Consume VIN details through interchangeable offline backend adapters

```text
id: FUCQ-56
title: Consume VIN details through interchangeable offline backend adapters
kind: code
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-19, implementation stories)
epic: FUCQ-19
priority: P3
priority_reason: from FUCQ-19
size: M
depends_on: FUCQ-55, FUCQ-39
```

## Goal

As an application service, I want one vehicle-details interface across differently shaped providers so a future provider can be mapped without changing the consumer's facts or failure handling.

## Acceptance criteria

- [ ] Implement a backend demo HTTP adapter that calls FUCQ-55's actual route through an injected, server-configured base URL and transport. A small application-service contract consumer uses this adapter; it must not bypass HTTP by importing a private registry lookup. Provider-specific storage names, HTTP details and mapping logic remain inside adapters.
- [ ] Map the versioned wire result to one consumer vehicle-details contract preserving stable identity/configuration/dataset versions, identityKind=synthetic, requested/resolved model/market/date context, body/powertrain, paint/upholstery, selected equipment status, evidenced technical values/units, source confidence/dates, completeness and image references/role/fidelity. Preserve source catalogue facts versus fictional VIN/build association at record and mixed-field level.
- [ ] Implement a deliberately differently shaped local provider fixture/adapter (different nesting, identity labels and technical/image representation) supplying equivalent source facts through the same consumer interface. Equivalent complete and partial fixtures produce equivalent normalised facts, identity and provenance; this demonstrates replaceability only and is not a guessed BMW schema or proof of credential-only production compatibility.
- [ ] Exercise complete, partial, invalid-input, not-found, unsupported, source-unavailable and identity-mismatch with both providers where applicable. Timeouts, non-JSON/malformed/truncated responses, unknown schema versions and non-success HTTP results cannot become a successful empty object. Bound timeout/retry attempts and preserve transport status separately from capability/completeness.
- [ ] Verify response identity/configuration/context against the trusted request before facts are accepted. Wrong VIN, vehicleId/configurationId, dataset version where pinned, market/body/powertrain or a source's substituted model produces identity-mismatch and does not enter the consumer as the requested vehicle. Missing decision-critical facts remain unknown/needs-confirmation and are never filled from retail model defaults.
- [ ] Local provider selection is server configuration; requests cannot inject a source URL or request a live switch. Provider replacement preserves synthetic identity and source labels, never widens eligibility or adds stock/terms/usage facts. HTTP forwarding uses only the configured backend route and no browser/private URLs, source keys or opaque handbook links appear in evidence.
- [ ] Under docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md, this backend-only capability adds no screen or control and preserves presentation truth: contract fixtures explicitly support unknown paint/equipment/technical values, missing and representative images, correct units, source dates and actionable failure outcomes. Existing shared UI components remain the future rendering boundary; no screen changes here, so no screenshots are required.

## Files or areas

- server/gcsp/vehicle-evidence/vehicle-details-contract.js (proposed; reuse FUCQ-14 contract)
- server/gcsp/vehicle-evidence/synthetic-http-adapter.js (proposed)
- server/gcsp/vehicle-evidence/alternate-offline-adapter.js (proposed test/reference provider)
- server/test/gcsp-vehicle-details-contract.test.js (proposed)
- server/test/gcsp-synthetic-http-adapter.test.js (proposed)
- server/test/fixtures/gcsp/vehicle-evidence/alternate-provider.json (proposed)
- docs/gcsp/synthetic-vin-service.md (proposed)

## Decided

Canonical decisions: docs/design/high-level-design.drawio and docs/design/gcsp-high-level-design.md govern this work; Russell's latest instruction makes that HLD canonical and removes the earlier blanket wait-for-HLD gate. Use modules and indexed immutable artifacts inside the existing Node backend, not a new microservice or database. Read docs/gcsp/README.md, demo-brief.md, synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/README.md. Reuse FUCQ-14 snapshot identity/provenance and the compatible FUCQ-15 image contract where applicable; preserve retail stock.js/mapping.js behaviour. docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md apply: supplied screenshots define header/sidebar/palette, bodies follow Used Cars and shared components. This story adds no screen; validate the backend presentation/provenance states and explain why no new screenshots are required. Pass these references and relevant acceptance/validation to any later authorised descendants; authoring does not authorise implementation dispatch. The demo adapter must traverse actual HTTP even though caller and service share one Node deployment. Source substitution is demonstrated with a different offline payload through the same application-service interface; it creates no claim about an unproven BMW/Outvin response. FUCQ-15 imagery terms apply when an actual image is included; an explicit absent-image contract does not require inventing imagery or blocking the offline identity proof.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Use the canonical HLD and existing server deployment/access conventions. No new infrastructure or separate detailed-interface approval is assumed. FUCQ-55 serves the actual HTTP contract; reuse the FUCQ-14 consumer/source-provenance contract and align image fields with FUCQ-15 when available. The boundary proof needs no live provider or UI consumer.

Requested: 1 November 2026, by Russell (backlog FUCQ-19, implementation story authoring). Priority: P3; priority_reason: from FUCQ-19. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-55, FUCQ-39.

## Out of scope

Live BMW/Outvin payload guessing, credentials or integration; UI layout, recommendation scoring or scheme transactions; Retail mapping defaults presented as exact configuration facts; 10,000-fleet collection or production provider certification

## Validate

- node --test server/test/gcsp-synthetic-http-adapter.test.js — a real ephemeral FUCQ-55 HTTP server is consumed through the adapter; canonical identity, request validation, complete/partial mapping, mismatch, malformed data, version failure and bounded timeout/error cases pass without external calls.
- node --test server/test/gcsp-vehicle-details-contract.test.js — the same application-service consumer passes against HTTP and differently shaped offline providers with equivalent identity/facts and complete/partial/error outcomes; source payload names do not leak into its contract.
- node --test server/test/gcsp-vehicle-details-contract.test.js server/test/gcsp-synthetic-http-adapter.test.js — docs/gcsp/experience-quality.md, screens/README.md and COMPONENTS.md checks preserve source/synthetic labels, correct units, missing values and representative imagery. Screenshots are unnecessary because no rendered surface changes; npm test passes.

---

### [FUCQ-57](https://ibm-consulting.atlassian.net/browse/FUCQ-57) · Keep synthetic VINs offline across failures, resets and provider switches

```text
id: FUCQ-57
title: Keep synthetic VINs offline across failures, resets and provider switches
kind: code
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-19, implementation stories)
epic: FUCQ-19
priority: P3
priority_reason: from FUCQ-19
size: M
depends_on: FUCQ-56
```

## Goal

As the demo owner, I want server-owned synthetic routing to survive every error and provider change so generated VINs can never escape to a real handbook or decoder service.

## Acceptance criteria

- [ ] Make routing ownership explicit: the persisted FUCQ-53/C identity inventory and trusted server-side synthetic request context classify registered/generated identities; the vehicle-evidence router selects allowed offline providers. A regex, checksum, WMI, browser identityKind flag or client-selected provider cannot authorise or reclassify a VIN. Unknown or unavailable identity classification fails closed before any external transport.
- [ ] Enforce synthetic-only routing before provider/fallback execution. Known generated identities, retained inactive/published identities and closed synthetic-context unknown inputs may use only the published synthetic HTTP route or the deliberate alternative offline provider; an attempted real/BMW/Driver's Guide/third-party decoder switch is rejected as unsupported. Provider outage or not-found cannot trigger a live fallback or a caller-supplied URL.
- [ ] Use the common/compatible FUCQ-43 guard contract for handbook and real-decoder boundaries: only trusted server-owned externally authorised real-VIN context could permit real lookup, and synthetic/unknown context is rejected before key retrieval, encryption, manual/PDF/COSY/image transport or redirects. No real integration or credentials are required; test injected guide/decoder boundaries if FUCQ-43 is not yet present and integrate its implementation when available without creating a dependency cycle.
- [ ] Prove zero external VIN-bearing requests across complete/partial success, invalid input, unknown/missing registry record, unsupported profile, identity mismatch, timeout, unavailable/corrupt corpus, fallback, provider switch, deactivation, restart and scenario reset. Instrument outbound transport and key/guide/decoder spies; redirects and retry paths are included. Test an omitted/forged browser flag and a synthetic VIN that passes all structural checks.
- [ ] Publish small five-WMI end-to-end evidence: generate independent fictional serials, validate/load immutable matched reference artifacts, start the existing backend offline and consume the actual HTTP route through FUCQ-56 for every class. Reconcile loaded IDs/configuration references and immutable associations after reorder/resume/addition/reload/restart; the evidence reports fixture count, WMI/class/market coverage, complete/partial fields and all zero-egress results without exposing real identities.
- [ ] Provide reproducible run/generate/publish/load/API examples and recovery/reset instructions in docs/gcsp/synthetic-vin-service.md, including supported fixture market/era limitations, typed outcomes, existing demo access gate, artifact locations/checksums, default offline provider and the exact offline-start command. Document that private keys stay outside artifacts/logs and that no globally reserved serial range or real-fleet non-collision is guaranteed.
- [ ] Default fixture tests and the documented offline demo run need no BMW access or network beyond loopback. Scheme eligibility, points, stock/releases, reservations/allocations and telemetry remain separate contracts referencing vehicleId; no test counts reference profiles or repeated VINs as the 10,000 distinct UK configurations required by FUCQ-20.
- [ ] Under docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md, this backend-only capability adds no screen or control and preserves presentation truth: end-to-end consumer evidence includes synthetic/source attribution, reference-only market context, units, source dates, complete/partial/unknown and missing/representative image outcomes across provider switches. This delivers no screen; therefore no new screenshot is needed, and later consuming UI work must use the supplied GCSP shell/palette and Used Cars body direction with browser review.

## Files or areas

- server/gcsp/vehicle-evidence/identity-routing.js (proposed)
- server/gcsp/vehicle-evidence/synthetic-http-adapter.js (proposed)
- FUCQ-43-compatible trusted identity/access guard seam (without requiring live integration)
- server/test/gcsp-synthetic-vin-egress.test.js (proposed)
- server/test/gcsp-synthetic-vin-e2e.test.js (proposed)
- server/test/gcsp-offline-start.test.js (proposed)
- docs/gcsp/synthetic-vin-service.md (proposed)
- docs/gcsp/evidence/fucq-18/ (proposed)

## Decided

Canonical decisions: docs/design/high-level-design.drawio and docs/design/gcsp-high-level-design.md govern this work; Russell's latest instruction makes that HLD canonical and removes the earlier blanket wait-for-HLD gate. Use modules and indexed immutable artifacts inside the existing Node backend, not a new microservice or database. Read docs/gcsp/README.md, demo-brief.md, synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/README.md. Reuse FUCQ-14 snapshot identity/provenance and the compatible FUCQ-15 image contract where applicable; preserve retail stock.js/mapping.js behaviour. docs/gcsp/experience-quality.md, docs/gcsp/screens/README.md and COMPONENTS.md apply: supplied screenshots define header/sidebar/palette, bodies follow Used Cars and shared components. This story adds no screen; validate the backend presentation/provenance states and explain why no new screenshots are required. Pass these references and relevant acceptance/validation to any later authorised descendants; authoring does not authorise implementation dispatch. Zero generated-VIN forwarding applies to every BMW/Driver's Guide/third-party path, including guide/image fallbacks and provider switches. FUCQ-43 owns real-guide authorisation guards; this story owns synthetic registry provenance/routing and end-to-end proof through compatible boundaries. It does not require FUCQ-16 delivery to demonstrate safe offline operation. Published synthetic identity inventory must remain authoritative when active facts are missing. The proof is five-WMI fixtures only; FUCQ-20 owns the distinct full corpus.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Use the canonical HLD and existing server deployment/access conventions. No new infrastructure or separate detailed-interface approval is assumed. The prerequisite registry/generator/HTTP/adapter stories provide the registry inventory, generator, loader, HTTP service and two offline adapters. Consume a guard contract compatible with FUCQ-43: real handbook/decoder access needs trusted server-owned external authorisation; inject spy boundaries if FUCQ-43 is not yet implemented, so FUCQ-16 is not a prerequisite for this offline proof.

Requested: 1 November 2026, by Russell (backlog FUCQ-19, implementation story authoring). Priority: P3; priority_reason: from FUCQ-19. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-56.

## Out of scope

Real provider access or an operational live-VIN authorisation system; 10,000-config collection or claiming GB/RHD profile completeness; New screens, screenshots of unchanged pages, hosting or deployment; Changes to scheme policy, mutable stock/transactions, telemetry or retail matching

## Validate

- node --test server/test/gcsp-synthetic-vin-egress.test.js — instrument every external/key/handbook/image/decoder boundary and prove exactly zero calls for synthetic/unknown context across the complete error/switch/fallback/retry/redirect/reset matrix, including missing/forged client flags and structurally valid synthetic VINs.
- node --test server/test/gcsp-synthetic-vin-e2e.test.js server/test/gcsp-offline-start.test.js — from temporary immutable artifacts, generate/load/start/lookup all five market-consistent WMI fixtures through the actual HTTP adapter, reconcile identities after restart/reload and save sanitised evidence with zero non-loopback calls.
- node --test server/test/gcsp-vehicle-details-contract.test.js server/test/gcsp-synthetic-vin-e2e.test.js — docs/gcsp/experience-quality.md, screens/README.md and COMPONENTS.md presentation/provenance checks pass for unknown fields, dates/units, representative imagery and every typed state. No screenshot/browser capture is needed because no screen or control is changed.
- npm test — all VIN checks and existing retail suite pass offline. Record actual commands/results, artifact/checksum evidence and remaining limitations under docs/gcsp/evidence/fucq-18/.

---

### [FUCQ-58](https://ibm-consulting.atlassian.net/browse/FUCQ-58) · Qualify fleet coverage and budgets before collecting configurations

```text
id: FUCQ-58
title: Qualify fleet coverage and budgets before collecting configurations
kind: data
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-20, implementation stories)
epic: FUCQ-20
priority: P3
priority_reason: from FUCQ-20
size: M
depends_on: FUCQ-52, FUCQ-37
```

## Goal

As a demo fleet curator, I want an executable evidence-backed collection plan so the 10,000-car target uses plausible identities and a controlled source budget.

## Acceptance criteria

- [ ] Publish a versioned machine-readable fleet plan covering actual model/AG/derivative/generation/body/powertrain identifiers, market/steering/locale, order/effect/catalogue dates, selected option families, deterministic seed and tool/profile versions. Bind each represented configuration family to an enabled compatible FUCQ-52 profile, with source/date/confidence; chassis, AG and VIN descriptor remain distinct.
- [ ] Validate coverage for multiple genuinely distinct configurations in each requested WMI WBA/WBS/WBY/5UX/5YM; record planned counts, additional valid WMIs and explicit exclusions. A US reference profile cannot validate a GB/RHD record. Close selected UK descriptor/year/plant gaps with bounded corroborated evidence under synthetic-vin-rules.md; the two existing single observations alone do not qualify. Where required WMI coverage needs a different catalogue era or market, make that evidence-backed context explicit in the selected plan; never invent current production for a discontinued model.
- [ ] Implement an offline plan/dry-run command that estimates candidate, solver, OTD and image requests from coverage and cache policy. Declare hard budgets, finite retry/timeout/backoff/concurrency and stop conditions. A projection below 10,000 is an explicit risk/shortfall, never proof of capacity or permission to duplicate records.
- [ ] Validate the plan against known catalogue/profile fixtures and reject unsupported model/profile/context combinations, empty coverage, absent numeric limits and incompatible retention/asset destinations. The 2024 scheme matrix is a separate eligibility source, not the current catalogue or VIN profile.
- [ ] Retain reusable evidence and non-personal shared type codes only; discard sampled real VINs, plates, serials, private identifiers and identifier-bearing URLs/captures. Record open decisions in the runbook and make the real-run command refuse an unqualified plan.

## Files or areas

- scripts/gcsp/fleet-plan.mjs (proposed)
- server/data/gcsp/vehicle-evidence/fleet-plan.json (proposed)
- server/test/gcsp-fleet-plan.test.js (proposed)
- docs/gcsp/fleet-collection-runbook.md (proposed)

## Decided

Russell authorised child User Stories for independent FUCQ-14–20 on 1 November 2026 and directed that the HLD is canonical. Follow docs/design/high-level-design.drawio (06 Vehicle evidence providers and 05 Deployment and future integration) and docs/design/gcsp-high-level-design.md: one existing Node backend, versioned static corpus artifacts, separate mutable fleet/employee state. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. Supplied GCSP screenshots govern header/sidebar/palette; body direction is consumer Used Cars. These stories add no screen; validate presentation fields, source/unknown/error states and image fidelity through contracts rather than new UI screenshots. Any added screen requires separate desktop/narrow/keyboard acceptance and shared-component review. Propagate these obligations to every child. No Story Points are authored. Source/access/retention, selected-profile evidence and collection budgets expressly left open by the HLD remain run preconditions; a canonical design does not supply them. Evidence: docs/gcsp/synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/. Only three GB T5MJ/72HH/G61E configurations were proved; 48/48/49 selected elements include one SE000001 accessory, not 48/48/49 options. Complete sorted resolved selection, not a Cartesian product or changed VIN, determines a configuration. The target remains 10,000 genuinely distinct complete configurations, with multiple class-congruent configurations for every WBA/WBS/WBY/5UX/5YM. Primary US rows do not qualify GB/RHD profiles. This is delivery data/profile curation with a validated executable plan, not a reopened FUCQ-5 research spike. It introduces no screen and does not claim selected coverage or source permissions already exist. Complete configuration means a complete resolved selection; technical values or image attributes outside proved source coverage may remain explicitly unknown/partial rather than fabricated. The canonical HLD is the current authority; historical research text stating no visual reference or a blanket pending-HLD gate is superseded.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Before real collection, select the source/access and permitted retention/display basis, exact catalogue/market scope, numeric request/image/concurrency/retry budgets and artifact destination; no values or permissions are inferred.

Requested: 1 November 2026, by Russell (backlog FUCQ-20, implementation story authoring). Priority: P3; priority_reason: from FUCQ-20. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-52, FUCQ-37.

## Out of scope

Actual bulk collection; A second VIN generator or service; Production access procurement; Scheme rules, offers or usage telemetry

## Validate

- node --test server/test/gcsp-fleet-plan.test.js — valid five-WMI plan, profile/market/year/plant mismatches, missing budgets and genuine-shortfall handling pass offline.
- node scripts/gcsp/fleet-plan.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --offline — emits the selected coverage, versioned evidence and numerical request/image budget report without outbound calls; fails until all required run inputs are qualified.
- Inspect the presentation metadata for synthetic/source labels, unsupported profiles and completeness; no screen changes means new screenshots are unnecessary.

---

### [FUCQ-59](https://ibm-consulting.atlassian.net/browse/FUCQ-59) · Collect distinct constructible configurations with resumable batches

```text
id: FUCQ-59
title: Collect distinct constructible configurations with resumable batches
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-20, implementation stories)
epic: FUCQ-20
priority: P3
priority_reason: from FUCQ-20
size: L
depends_on: FUCQ-58, FUCQ-39
```

## Goal

As a fleet curator, I want a bounded resumable collector so accepted records represent real resolved configurations and interruptions do not waste source requests.

## Acceptance criteria

- [ ] Discover the plan's real model/AG mapping and selectable code definitions through the selected source boundary. Generate seeded option candidates and sort/deduplicate request element codes before rule solving; separate options from accessories while preserving the complete successful element request semantics.
- [ ] Accept only constructible complete responses with consistent requested/resolved model/AG, market and date context. Retain complete selected elements and typed option/accessory sets. Detect source-added/removed/ignored requests; record solver changes and never mark an ignored requested feature as selected. Reject model/date substitutions and inconsistent or incomplete responses.
- [ ] Create a canonical semantic distinctness key from resolved model/derivative/body/powertrain and complete selected options, including paint/upholstery/equipment. Retain context-aware source keys separately. Normalise order, aliases and equivalent code forms so changed VINs, request seed, dates/timestamps, metadata/source versions and alternative requests resolving identically do not inflate the count; accessory-only variants do not pad the configuration target.
- [ ] Persist accepted/rejected/duplicate records and deterministic queue/checkpoints atomically. Resume after interruption without re-fetching valid cache entries, corrupting checkpoints or changing published identities; reject incompatible plan/source/tool versions rather than mix them silently.
- [ ] Enforce finite timeouts/retries, conservative configured concurrency, per-source caching/retention and the run's request/image budgets. Stop or back off on 401/403/429 and source failures; report actual per-operation counts, cache hits, failures, substitutions, resolved duplicates and coverage progress. Never rotate around limits.
- [ ] Collector commands are explicit offline/dry-run or live execution; importing a module, running CI, starting the demo and VIN lookup cannot launch bulk traffic. Under-target results retain a resumable checkpoint and an incomplete report, with no fabricated configurations.

## Files or areas

- scripts/gcsp/collect-fleet.mjs (proposed)
- scripts/gcsp/configuration-key.mjs (proposed)
- FUCQ-14 catalogue/source boundary
- server/test/gcsp-fleet-collector.test.js (proposed)

## Decided

Russell authorised child User Stories for independent FUCQ-14–20 on 1 November 2026 and directed that the HLD is canonical. Follow docs/design/high-level-design.drawio (06 Vehicle evidence providers and 05 Deployment and future integration) and docs/design/gcsp-high-level-design.md: one existing Node backend, versioned static corpus artifacts, separate mutable fleet/employee state. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. Supplied GCSP screenshots govern header/sidebar/palette; body direction is consumer Used Cars. These stories add no screen; validate presentation fields, source/unknown/error states and image fidelity through contracts rather than new UI screenshots. Any added screen requires separate desktop/narrow/keyboard acceptance and shared-component review. Propagate these obligations to every child. No Story Points are authored. Source/access/retention, selected-profile evidence and collection budgets expressly left open by the HLD remain run preconditions; a canonical design does not supply them. Evidence: docs/gcsp/synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/. Only three GB T5MJ/72HH/G61E configurations were proved; 48/48/49 selected elements include one SE000001 accessory, not 48/48/49 options. Complete sorted resolved selection, not a Cartesian product or changed VIN, determines a configuration. The target remains 10,000 genuinely distinct complete configurations, with multiple class-congruent configurations for every WBA/WBS/WBY/5UX/5YM. Primary US rows do not qualify GB/RHD profiles. Canonical deduplication is stricter than source-cache identity: keeping dates in the source key does not make repeated model/options novel. The collector reuses provider contracts without requiring FUCQ-17's sanctioned live runtime adapter; a selected bounded research/demo source remains explicit. Complete configuration means a complete resolved selection; technical values or image attributes outside proved source coverage may remain explicitly unknown/partial rather than fabricated.

Execution preconditions (retained here so Jira-to-inbox import preserves them): Real execution uses FUCQ-58's qualified source and numerical limits; default and CI execution use injected offline catalogue/solver responses.

Requested: 1 November 2026, by Russell (backlog FUCQ-20, implementation story authoring). Priority: P3; priority_reason: from FUCQ-20. Author size: L. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-58, FUCQ-39.

## Out of scope

VIN generation or registry implementation; New live runtime provider; Automatic production activation; Scheme inventory or stock-feed changes

## Validate

- node --test server/test/gcsp-fleet-collector.test.js — sorted codes, accessory separation, solver mutations/substitution, incomplete results, semantic/date aliases, finite retries/budgets, checkpoint interruption/resume and cache/version compatibility pass with injected transport.
- node --test server/test/brand.test.js server/test/api.test.js — existing retailer mapping/API contracts remain compatible; npm test passes after implementation.
- Instrument default import/dry-run/CI and demo lookup paths: zero source calls occur; inspect source/unknown/failure presentation fields without adding UI screenshots.

---

### [FUCQ-60](https://ibm-consulting.atlassian.net/browse/FUCQ-60) · Enrich resolved fleet configurations with matching facts and images

```text
id: FUCQ-60
title: Enrich resolved fleet configurations with matching facts and images
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-20, implementation stories)
epic: FUCQ-20
priority: P3
priority_reason: from FUCQ-20
size: M
depends_on: FUCQ-59, FUCQ-39, FUCQ-42
```

## Goal

As a demo consumer, I want configuration-specific specifications and honest imagery so each fictional vehicle has useful facts without unsupported equipment or appearance claims.

## Acceptance criteria

- [ ] Use each accepted configuration's same resolved model/AG, market, dates and complete selected elements to fetch technical data and resolve images through FUCQ-14/FUCQ-15 contracts. Reject mismatched substitutions before merging; preserve requested/resolved identity and per-source context.
- [ ] Map evidenced attribute meanings, units, paint/upholstery and selected versus merely available equipment; retain source status, source/retrieval dates, completeness and unknown values. Never translate missing dimensions to zero, model-tree 0000 to a real value or an unselected towbar definition into fitted equipment.
- [ ] Apply the declared representative-image coverage by model/body/paint/view and known fidelity; share identical assets by content hash where appropriate. Store source/role/view/dimensions/content type and verified/unknown fidelity. A full option request does not prove every option is depicted; missing/broken images keep valid facts usable and cannot silently substitute another model or paint.
- [ ] Enrichment reuses the collector's checkpoint/cache/budget accounting and finite recovery rules. Incomplete technical responses, denied image retention, unsupported views and expiry produce explicit partial/rejected outcomes under the plan; do not label unvalidated or unfinished configurations complete.
- [ ] Emit validated corpus records and coverage/completeness reports that distinguish observed catalogue facts from the future fictional VIN association, and prove that neither matching semantics nor the current-car presentation can infer availability, scheme points, eligibility or connected-use statistics from them.

## Files or areas

- scripts/gcsp/enrich-fleet.mjs (proposed)
- FUCQ-14 catalogue normalization and FUCQ-15 image manifest
- server/test/gcsp-fleet-enrichment.test.js (proposed)

## Decided

Russell authorised child User Stories for independent FUCQ-14–20 on 1 November 2026 and directed that the HLD is canonical. Follow docs/design/high-level-design.drawio (06 Vehicle evidence providers and 05 Deployment and future integration) and docs/design/gcsp-high-level-design.md: one existing Node backend, versioned static corpus artifacts, separate mutable fleet/employee state. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. Supplied GCSP screenshots govern header/sidebar/palette; body direction is consumer Used Cars. These stories add no screen; validate presentation fields, source/unknown/error states and image fidelity through contracts rather than new UI screenshots. Any added screen requires separate desktop/narrow/keyboard acceptance and shared-component review. Propagate these obligations to every child. No Story Points are authored. Source/access/retention, selected-profile evidence and collection budgets expressly left open by the HLD remain run preconditions; a canonical design does not supply them. Evidence: docs/gcsp/synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/. Only three GB T5MJ/72HH/G61E configurations were proved; 48/48/49 selected elements include one SE000001 accessory, not 48/48/49 options. Complete sorted resolved selection, not a Cartesian product or changed VIN, determines a configuration. The target remains 10,000 genuinely distinct complete configurations, with multiple class-congruent configurations for every WBA/WBS/WBY/5UX/5YM. Primary US rows do not qualify GB/RHD profiles. FUCQ-15 owns image semantics and asset registration; do not duplicate its adapter or build an arbitrary-URL proxy. This story introduces no consuming screen; future screens follow experience-quality.md and the supplied shell references. Complete configuration means a complete resolved selection; technical values or image attributes outside proved source coverage may remain explicitly unknown/partial rather than fabricated.

Execution preconditions (retained here so Jira-to-inbox import preserves them): FUCQ-58 selects permitted source retention and representative image coverage/view/dimension policy; unavailable image roles are explicit rather than silently required for every option.

Requested: 1 November 2026, by Russell (backlog FUCQ-20, implementation story authoring). Priority: P3; priority_reason: from FUCQ-20. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-59, FUCQ-39, FUCQ-42.

## Out of scope

New image provider framework; 360-degree viewer; Exact VIN appearance or installed-equipment guarantees; Employee or fleet transaction state

## Validate

- node --test server/test/gcsp-fleet-enrichment.test.js — matching identities/options, dates/units, accessory handling, selected towbar, 0000/unknowns, unsupported/broken/wrong-model-or-paint images and resumable enrichment pass offline.
- Run FUCQ-14/FUCQ-15 focused contract suites and npm test; source/missing/representative/fidelity response examples remain compatible.
- Inspect representative stored image assets against model/body/paint/view metadata and record known fidelity limits; this is asset evidence, not new-screen screenshot evidence.

---

### [FUCQ-61](https://ibm-consulting.atlassian.net/browse/FUCQ-61) · Collect and validate 10,000 genuinely distinct BMW configurations

```text
id: FUCQ-61
title: Collect and validate 10,000 genuinely distinct BMW configurations
kind: data
design_impact: no
requested: 2026-11-01, by Russell (backlog FUCQ-20, implementation stories)
epic: FUCQ-20
priority: P3
priority_reason: from FUCQ-20
size: L
depends_on: FUCQ-60
```

## Goal

As the demo owner, I want the actual 10,000-configuration corpus so fleet scale is supported by collected evidence rather than a theoretical generator.

## Acceptance criteria

- [ ] Execute the qualified resumable collection/enrichment plan to produce 10,000 genuinely distinct complete resolved configurations. Recompute the semantic distinctness key over the actual accepted corpus; neither multiple VINs, date/version aliases, request differences nor accessory-only changes may pad that target.
- [ ] Meet the declared model/body/powertrain/option distribution and multiple distinct compatible configurations for every WBA/WBS/WBY/5UX/5YM profile family. Report planned versus actual counts and explicit exclusions; unsupported GB/RHD mappings cannot be relabelled US fixtures to satisfy UK coverage.
- [ ] Produce the actual source-operation counts, failures, duplicate/substitution/rejection counts, elapsed collection time, budget use, field/image completeness and profile/evidence versions. Stop/backoff within limits and retain checkpoints; fewer than 10,000 remains incomplete with a quantified shortfall rather than a success flag.
- [ ] Validate all configuration records and source/asset references, artifact hashes, selected equipment and units before staging a release. Preserve permitted raw/source traces only under selected retention; do not retain keys, real VINs/plates or identifying URLs in artifacts or logs.
- [ ] Keep staged artifacts separate from the active runtime corpus. Interrupted collection, validation failure or expired access leaves the previous active dataset usable. A clean rebuild or documented cached replay of retained inputs produces the same canonical configuration identities; otherwise report any non-reproducible upstream change explicitly.

## Files or areas

- Versioned fleet artifacts at the HLD-agreed deployment location
- docs/gcsp/evidence/fucq-19/collection-report.json (proposed)
- docs/gcsp/fleet-collection-runbook.md (proposed)

## Decided

Russell authorised child User Stories for independent FUCQ-14–20 on 1 November 2026 and directed that the HLD is canonical. Follow docs/design/high-level-design.drawio (06 Vehicle evidence providers and 05 Deployment and future integration) and docs/design/gcsp-high-level-design.md: one existing Node backend, versioned static corpus artifacts, separate mutable fleet/employee state. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. Supplied GCSP screenshots govern header/sidebar/palette; body direction is consumer Used Cars. These stories add no screen; validate presentation fields, source/unknown/error states and image fidelity through contracts rather than new UI screenshots. Any added screen requires separate desktop/narrow/keyboard acceptance and shared-component review. Propagate these obligations to every child. No Story Points are authored. Source/access/retention, selected-profile evidence and collection budgets expressly left open by the HLD remain run preconditions; a canonical design does not supply them. Evidence: docs/gcsp/synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/. Only three GB T5MJ/72HH/G61E configurations were proved; 48/48/49 selected elements include one SE000001 accessory, not 48/48/49 options. Complete sorted resolved selection, not a Cartesian product or changed VIN, determines a configuration. The target remains 10,000 genuinely distinct complete configurations, with multiple class-congruent configurations for every WBA/WBS/WBY/5UX/5YM. Primary US rows do not qualify GB/RHD profiles. This story includes an expressly selected material source run, not just collector code. It cannot be completed by mocked tests or by counting 10,000 generated VINs. No arbitrary source allowance, duration or image quota is implied. Complete configuration means a complete resolved selection; technical values or image attributes outside proved source coverage may remain explicitly unknown/partial rather than fabricated.

Execution preconditions (retained here so Jira-to-inbox import preserves them): The qualified FUCQ-58 plan, selected source-use/retention basis, numeric request/image budgets, access material and artifact destination are present; run starts explicitly and is excluded from ordinary CI/demo startup.

Requested: 1 November 2026, by Russell (backlog FUCQ-20, implementation story authoring). Priority: P3; priority_reason: from FUCQ-20. Author size: L. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-60.

## Out of scope

Bypassing limits or buying source access; Publishing a partial corpus as target-complete; New runtime network dependency; Production deployment or scheme population

## Validate

- node scripts/gcsp/collect-fleet.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --execute — explicit selected-source run completes within recorded budgets; retain its redacted report and resumable checkpoints.
- node scripts/gcsp/verify-fleet.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --staged --require-distinct 10000 — implementation supplies a deterministic offline verifier; all records, semantic identities, profiles, references, counts and hashes reconcile. Record the actual versioned manifest path selected by the command in delivery evidence.
- Review actual planned/observed WMI/model/option and completeness distributions, distinct-count audit and representative image fidelity; no new application screen or screenshot evidence is claimed.

---

### [FUCQ-62](https://ibm-consulting.atlassian.net/browse/FUCQ-62) · Publish the fleet and load stable VIN mappings atomically

```text
id: FUCQ-62
title: Publish the fleet and load stable VIN mappings atomically
kind: data
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-20, implementation stories)
epic: FUCQ-20
priority: P3
priority_reason: from FUCQ-20
size: M
depends_on: FUCQ-61, FUCQ-53, FUCQ-54
```

## Goal

As a demo operator, I want an atomic versioned fleet release so every distinct configuration has a stable VIN and an invalid release cannot break the working demo.

## Acceptance criteria

- [ ] Reuse FUCQ-19 generation/registry/loader to produce at least 10,000 unique vehicle/VIN records, at least one per each of 10,000 distinct configurations. Record generator/profile/seed versions and immutable vehicleId/configurationId/datasetId mappings; additional vehicles do not affect the configuration count.
- [ ] Reconcile every VIN against the correct evidence-bearing market/era/WMI/descriptor/year/plant/serial/checksum profile and all registry-wide collisions, including previously published datasets. Existing mappings remain unchanged on reload, reordered input, resume, additions and reset; a later source snapshot never silently changes a published VIN's configuration.
- [ ] Publish a manifest with schema/dataset/source/catalogue versions, exact configuration/vehicle/VIN counts, WMI/model/option distribution, completeness, image fidelity coverage and every artifact checksum. All references are valid, and synthetic VIN/build associations remain distinct from observed source facts.
- [ ] Activate using FUCQ-54's atomic, idempotent loader with a previous-version recovery path. Corrupt hashes, duplicate identities, broken references, incompatible profile/schema versions, partial writes or a failed load leave the previous active version readable. Repeat load/reset does not reassign IDs.
- [ ] Use versioned static/indexed artifacts in the existing Node deployment; publish large payloads/images at the selected reproducible artifact location with a retrieval/restore runbook, not an additional microservice/database or a binary dump into Git. Dataset loading does not create released stock, points, holds or employee usage.

## Files or areas

- FUCQ-19 generator/immutable registry/loader integration
- docs/gcsp/evidence/fucq-19/publication-report.json (proposed)
- Fleet artifact manifest and recovery runbook

## Decided

Russell authorised child User Stories for independent FUCQ-14–20 on 1 November 2026 and directed that the HLD is canonical. Follow docs/design/high-level-design.drawio (06 Vehicle evidence providers and 05 Deployment and future integration) and docs/design/gcsp-high-level-design.md: one existing Node backend, versioned static corpus artifacts, separate mutable fleet/employee state. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. Supplied GCSP screenshots govern header/sidebar/palette; body direction is consumer Used Cars. These stories add no screen; validate presentation fields, source/unknown/error states and image fidelity through contracts rather than new UI screenshots. Any added screen requires separate desktop/narrow/keyboard acceptance and shared-component review. Propagate these obligations to every child. No Story Points are authored. Source/access/retention, selected-profile evidence and collection budgets expressly left open by the HLD remain run preconditions; a canonical design does not supply them. Evidence: docs/gcsp/synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/. Only three GB T5MJ/72HH/G61E configurations were proved; 48/48/49 selected elements include one SE000001 accessory, not 48/48/49 options. Complete sorted resolved selection, not a Cartesian product or changed VIN, determines a configuration. The target remains 10,000 genuinely distinct complete configurations, with multiple class-congruent configurations for every WBA/WBS/WBY/5UX/5YM. Primary US rows do not qualify GB/RHD profiles. Publication uses the existing canonical module/HTTP boundary, without changing the separate durable transaction repository. Every source-backed fact and fictional identity remains labelled; no new UI is added. Complete configuration means a complete resolved selection; technical values or image attributes outside proved source coverage may remain explicitly unknown/partial rather than fabricated.

Execution preconditions (retained here so Jira-to-inbox import preserves them): The complete validated FUCQ-61 staged corpus is available with permitted retention and deployment artifact packaging; FUCQ-19's generator and atomic loader are implemented. Reuse the FUCQ-54 publisher entry point; extend it with fleet-plan selection if needed rather than create another publisher or wire format.

Requested: 1 November 2026, by Russell (backlog FUCQ-20, implementation story authoring). Priority: P3; priority_reason: from FUCQ-20. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-61, FUCQ-53, FUCQ-54.

## Out of scope

A second generator, registry or adapter; Mutable fleet/employee-state seeding; Deployment to production; Real VIN forwarding or new database provisioning

## Validate

- node --test server/test/gcsp-fleet-publication.test.js — full reconciliation, cross-dataset collision, stable additions/reordering, bad hashes/references, atomic failed-load recovery and idempotent reload/reset pass offline.
- node server/scripts/publish-synthetic-vin-dataset.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --staged — records actual publication/load path, version, 10,000 distinct count and at least 10,000 VIN mappings; delivery evidence records the actual versioned manifest path.
- node scripts/gcsp/verify-fleet.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --active --require-distinct 10000 — compares active registry, configuration/VIN counts and all hashes/references; record the actual selected path and recovery/reload results.

---

### [FUCQ-63](https://ibm-consulting.atlassian.net/browse/FUCQ-63) · Prove full-fleet HTTP lookup and offline recovery through the adapter

```text
id: FUCQ-63
title: Prove full-fleet HTTP lookup and offline recovery through the adapter
kind: code
design_impact: yes
requested: 2026-11-01, by Russell (backlog FUCQ-20, implementation stories)
epic: FUCQ-20
priority: P3
priority_reason: from FUCQ-20
size: M
depends_on: FUCQ-62, FUCQ-55, FUCQ-56, FUCQ-57
```

## Goal

As a demo operator, I want measured lookup and recovery evidence on the real loaded corpus so the demonstration works offline at its intended scale.

## Acceptance criteria

- [ ] Exercise actual HTTP lookups through the consuming adapter for each WMI and representative derivatives, paint/upholstery, equipment such as towbar where selected, and partial/missing-image cases. Compare returned identity, source context, selected facts/units and image role/fidelity with the loaded manifest rather than accepting status 200 alone.
- [ ] Enumerate and reconcile all active registry/configuration/vehicle/VIN records. Run a bounded batch/concurrency correctness check against the 10,000-record dataset and report sample/all-record scope, count, environment, latency distribution, throughput and errors; add no unagreed latency SLA.
- [ ] Run the demonstration lookup path with source networking blocked/instrumented. Assert zero BMW, Driver's Guide and third-party decoder traffic for successful, invalid, unknown, partial, source-unavailable, identity-mismatch, timeout, fallback and provider-switch paths; presentation never retains a false live/official label.
- [ ] Verify process restart, idempotent reload/reset, interrupted/invalid attempted activation and rollback preserve the previous version and all published identity associations. The offline startup/run/restore instructions use pinned artifact/schema/profile versions.
- [ ] Record artifact hashes, actual commands, outcomes, counts and remaining completeness/fidelity limits in the evidence/runbook. The backend supplies truthful synthetic/source/unknown/error labels required by future screens; preserve retail stock mapping/API behaviour and do not claim browser evidence for a screen unchanged by this story.

## Files or areas

- server/test/gcsp-fleet-integration.test.js (proposed)
- scripts/gcsp/verify-fleet.mjs (proposed)
- FUCQ-19 actual HTTP adapter and transport instrumentation
- docs/gcsp/evidence/fucq-19/verification-report.json (proposed)
- docs/gcsp/fleet-collection-runbook.md (proposed)

## Decided

Russell authorised child User Stories for independent FUCQ-14–20 on 1 November 2026 and directed that the HLD is canonical. Follow docs/design/high-level-design.drawio (06 Vehicle evidence providers and 05 Deployment and future integration) and docs/design/gcsp-high-level-design.md: one existing Node backend, versioned static corpus artifacts, separate mutable fleet/employee state. Read docs/gcsp/README.md, demo-brief.md, experience-quality.md, screens/README.md and COMPONENTS.md. Supplied GCSP screenshots govern header/sidebar/palette; body direction is consumer Used Cars. These stories add no screen; validate presentation fields, source/unknown/error states and image fidelity through contracts rather than new UI screenshots. Any added screen requires separate desktop/narrow/keyboard acceptance and shared-component review. Propagate these obligations to every child. No Story Points are authored. Source/access/retention, selected-profile evidence and collection budgets expressly left open by the HLD remain run preconditions; a canonical design does not supply them. Evidence: docs/gcsp/synthetic-vin-fleet-proposal.md, synthetic-vin-rules.md, bmw-interface-research.md and evidence/fucq-4/. Only three GB T5MJ/72HH/G61E configurations were proved; 48/48/49 selected elements include one SE000001 accessory, not 48/48/49 options. Complete sorted resolved selection, not a Cartesian product or changed VIN, determines a configuration. The target remains 10,000 genuinely distinct complete configurations, with multiple class-congruent configurations for every WBA/WBS/WBY/5UX/5YM. Primary US rows do not qualify GB/RHD profiles. Full-corpus evidence is distinct from FUCQ-19's small five-WMI fixture proof. Tests cannot substitute for the actual loaded 10,000-configuration manifest. A differently shaped offline provider proves replaceability only, not a compatible production BMW contract. Complete configuration means a complete resolved selection; technical values or image attributes outside proved source coverage may remain explicitly unknown/partial rather than fabricated.

Execution preconditions (retained here so Jira-to-inbox import preserves them): The complete published 10,000-configuration dataset is loaded through FUCQ-19; actual HTTP service and consuming adapter are available.

Requested: 1 November 2026, by Russell (backlog FUCQ-20, implementation story authoring). Priority: P3; priority_reason: from FUCQ-20. Author size: M. No Story Points authored.

Prerequisites (native Blocks relationships): FUCQ-62, FUCQ-55, FUCQ-56, FUCQ-57.

## Out of scope

New UI or component work; Benchmarking unrelated retail performance; Real-provider integration; Fleet lifecycle, availability, allocation or connected telemetry

## Validate

- node --test server/test/gcsp-fleet-integration.test.js — actual in-process HTTP server/client adapter, each required WMI, error/fallback/switch egress guards and restart/load/recovery invariants pass with offline fixtures.
- node scripts/gcsp/verify-fleet.mjs --config server/data/gcsp/vehicle-evidence/fleet-plan.json --active --require-distinct 10000 --http --offline — delivery evidence supplies the actual path and configured local endpoint; reports all-record reconciliation, bounded measured HTTP scope and zero external-provider calls.
- node --test server/test/brand.test.js server/test/api.test.js and npm test — existing retail and application contracts pass after implementation; inspect normalised representative/missing/unknown presentation outcomes.

---

