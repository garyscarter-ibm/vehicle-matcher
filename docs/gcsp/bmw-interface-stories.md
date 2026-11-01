# FUCQ-4 adapter story map

Refined 1 November 2026 from the [native-session interface investigation](bmw-interface-research.md). Russell authorised research and ready-to-build stories, including the adapter work identified by refinement; implementation was explicitly excluded from this session. Jira is the authoritative story source. No duplicate stories were posted to `_dev/`, no claim/import was made and no dispatcher was started.

## Children and dependencies

| Story | Outcome | Jira blockers | Readiness / external conditions |
|---|---|---|---|
| [FUCQ-13](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-13) | Dated catalogue/specification snapshot adapter and narrow common identity/provenance contract. | FUCQ-5 | Refined for implementation after HLD agreement. Observed sample is GB / T5MJ / 72HH, January 2027 catalogue context; no live access needed. |
| [FUCQ-14](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-14) | Registered representative configuration-image snapshot provider and missing/fidelity states. | FUCQ-5, FUCQ-13 | Refined after contract/design agreement; record permitted demo use of chosen assets. Research reference files are not automatically runtime assets. |
| [FUCQ-15](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-15) | VIN-linked handbook/illustration adapter, synthetic fixtures and explicitly selected BMW Driver's Guide provider. | FUCQ-5, FUCQ-13 | Technically repeatable native route proved. Default tests remain offline; record live activation/use/retention separately. No build-sheet claim or new public lookup endpoint. |
| [FUCQ-16](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-16) | Authorised live catalogue/specification provider behind the snapshot contract. | FUCQ-5, FUCQ-13 | **Access-gated:** sanctioned endpoint/credentials, permitted use/retention and limits required before implementation. Live completion requires an authorised positive smoke check. |
| [FUCQ-17](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-17) | Authorised live COSY manifest/image provider behind the image contract. | FUCQ-5, FUCQ-14 | **Access-gated:** sanctioned manifest access and display/retention conditions required before implementation. Complete snapshot configurations can supply input, so FUCQ-16 is not an unnecessary dependency. |

All five are **To Do**, unclaimed, with default Medium priority and no story points assigned. The claiming session estimates complexity. Actual Jira `Blocks` links encode the dependencies above; free-text external conditions remain explicit in each live story and must be checked before starting it. These are refined specifications with stated gates, not a claim that every live integration can start immediately.

FUCQ-4 remains **In Progress**. Its research/refinement output is complete; these implementation children are unbuilt. Owner acceptance and the configured merge/status workflow remain intact. FUCQ-5 must incorporate these findings and agree the canonical HLD before adapter wiring. No change was made to its design or to the demonstration's October 2024 eligibility baseline.

## Acceptance decisions carried into Jira

- Requested and resolved market/model/AG/date/options must agree before enrichment. Detect the observed G21 PHEV-link-to-petrol substitution. Never join a historical VIN, a January 2027 catalogue and October 2024 scheme eligibility by broad model name.
- Keep option definitions, available options, selected catalogue equipment and verified fitted equipment distinct. Unselected towbar definitions and model-tree `0000` values are negative tests, not data to infer from.
- Preserve source kind, dates, completeness, units and explicit unknown/unavailable states across providers. Snapshot mode is offline and labelled. A provider change cannot retain a misleading official/live label.
- Distinguish representative catalogue renders, VIN-linked illustrations and exact-car photos. Full option encoding does not prove every visual attribute. A missing render must not invent another model/paint or discard valid facts.
- Driver's Guide content is not a build sheet or connected telemetry. Separate HTTP and source application statuses; bound locale fallback and preserve identity. Keep full, partial and encrypted VINs and private URLs out of retained data/logs.
- Live catalogue/image providers use sanctioned backend credentials, bounded failures and provider-specific cache/retention rules. No website-key extraction, garage writes, public VIN endpoint, CAPTCHA automation or inferred GCSP points.
- All stories cite `experience-quality.md`, `COMPONENTS.md` and the absence of an agreed GCSP visual reference. They validate backend presentation contracts without introducing screens; later UI work requires its own agreed visual/browser evidence.

## Third-party disposition

Russell's added bimmer.work/M Decoder investigation was completed as refinement in the session, not deferred into a research story. No successful free-site decode was obtained. Outvin offers a documented authenticated route, but its vehicle-success schema, authorised successful data, account/fees and permitted demo/display/retention use remain unresolved. A truthful implementation-ready Outvin story cannot yet specify the field mapping or fixture rights. Retain it as a conditional provider candidate in the [research report](bmw-interface-research.md#6-requested-third-party-fallbacks) and SAN-012, then refine a child when those inputs exist. Do not replace those unknowns with a scraper or an invented schema.

## Verification and review

The repository's actual `jira_sync.py` section parser accepted all five descriptions' Goal, Acceptance criteria, Files or areas, Decided, Out of scope and Validate sections. Titles are under 80 characters. Jira readback confirmed parent FUCQ-4, labels, To Do status and all nine dependency links. No implementation code was changed and no application test result is claimed by this refinement.

Independent reviewer: requested Opus, selected `gpt-6.1-sol` / `high`, no fallback or descendants; effective runtime settings were not independently verified. The review found no blocking or major issue. One minor reference was corrected to `blocks/vehicle-matcher/modes/result-card.js`. It checked source/data boundaries, evidence values, image hashes and visual paint variation, experience obligations, privacy and access/design gates. Automated final checks cover JSON syntax, local links, story parsing, private-identifier/key patterns and whitespace.

A routine scaffolding metadata repair normalised legacy `team.protected: []` to the current `{paths: [], label: "protected data"}` shape. The previous form caused the offline guard to reject writes. The empty path set and all four enabled scaffolding pieces were preserved; the guard now passes. This is the only configuration change accompanying the research.
