# FUCQ-4 adapter capability map

Refined 1 November 2026 from the [native-session interface investigation](bmw-interface-research.md). Russell authorised research and implementation-ready specifications; implementation was explicitly excluded from this session. At closeout he accepted the research and required FUCQ-13–17 to be independent backlog Epics, with no parent/child Epic hierarchy. Jira is authoritative. No duplicate stories were posted to `_dev/`, no claim/import was made and no dispatcher was started.

## Independent delivery capabilities and dependencies

| Epic | Outcome | Jira blockers | Readiness / external conditions |
|---|---|---|---|
| [FUCQ-13](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-13) | Dated catalogue/specification snapshot adapter and narrow common identity/provenance contract. | FUCQ-5 | Refined for implementation after HLD agreement. Observed sample is GB / T5MJ / 72HH, January 2027 catalogue context; no live access needed. |
| [FUCQ-14](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-14) | Registered representative configuration-image snapshot provider and missing/fidelity states. | FUCQ-5, FUCQ-13 | Refined after contract/design agreement; record permitted demo use of chosen assets. Research reference files are not automatically runtime assets. |
| [FUCQ-15](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-15) | VIN-linked handbook/illustration adapter, synthetic fixtures and explicitly selected BMW Driver's Guide provider. | FUCQ-5, FUCQ-13 | Technically repeatable native route proved. Default tests remain offline; record live activation/use/retention separately. No build-sheet claim or new public lookup endpoint. |
| [FUCQ-16](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-16) | Authorised live catalogue/specification provider behind the snapshot contract. | FUCQ-5, FUCQ-13 | **Access-gated:** sanctioned endpoint/credentials, permitted use/retention and limits required before implementation. Live completion requires an authorised positive smoke check. |
| [FUCQ-17](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-17) | Authorised live COSY manifest/image provider behind the image contract. | FUCQ-5, FUCQ-14 | **Access-gated:** sanctioned manifest access and display/retention conditions required before implementation. Complete snapshot configurations can supply input, so FUCQ-16 is not an unnecessary dependency. |

All five are independent **To Do** Epics, unclaimed, with default Medium priority and no story points assigned. Their existing detailed acceptance and validation remain refinement inputs for each capability's implementation stories. Actual Jira `Blocks` links encode the dependencies above; `Relates` links retain the FUCQ-4 research origin without a parent. Free-text external conditions remain explicit in each live capability and must be checked before starting it. These are refined specifications with stated gates, not a claim that every live integration can start immediately.

Russell accepted **FUCQ-4's research/refinement output on 1 November 2026** and authorised its closure after the handoff was committed and delivery tracking separated. Completion of FUCQ-4 does not claim delivery of FUCQ-13–19. FUCQ-5 must incorporate these findings and agree the canonical HLD before adapter wiring. The October 2024 eligibility baseline remains unchanged.

### Website-key follow-up

After Russell challenged the initial blanket ban, [fresh native tests](bmw-interface-research.md#follow-up-public-website-key-replay) returned 200 for catalogue, option-description and technical-data requests using the anonymous public configurator settings' application key; paired requests without it returned 401. The original “No website-key extraction” recommendation was too categorical. An unsupported website-key demo provider is technically viable for those requests and can be considered with a labelled snapshot fallback. This does not prove BMW support, intended external use, COSY coverage or reliability. Jira descriptions and their existing sanctioned-access gates were not changed by this follow-up; provider selection and any gate changes remain to be agreed. No new stories or implementation were added.

## Shared acceptance and current Jira gates

- Requested and resolved market/model/AG/date/options must agree before enrichment. Detect the observed G21 PHEV-link-to-petrol substitution. Never join a historical VIN, a January 2027 catalogue and October 2024 scheme eligibility by broad model name.
- Keep option definitions, available options, selected catalogue equipment and verified fitted equipment distinct. Unselected towbar definitions and model-tree `0000` values are negative tests, not data to infer from.
- Preserve source kind, dates, completeness, units and explicit unknown/unavailable states across providers. Snapshot mode is offline and labelled. A provider change cannot retain a misleading official/live label.
- Distinguish representative catalogue renders, VIN-linked illustrations and exact-car photos. Full option encoding does not prove every visual attribute. A missing render must not invent another model/paint or discard valid facts.
- Driver's Guide content is not a build sheet or connected telemetry. Separate HTTP and source application statuses; bound locale fallback and preserve identity. Keep full, partial and encrypted VINs and private URLs out of retained data/logs.
- The current live Jira capabilities require sanctioned backend credentials, bounded failures and provider-specific cache/retention rules. The follow-up above corrects the blanket website-key research prohibition without silently changing those gates. Do not hard-code or publish key values. No garage writes, public VIN endpoint, CAPTCHA automation or inferred GCSP points.
- All five specifications cite `experience-quality.md`, `COMPONENTS.md` and the absence of an agreed GCSP visual reference. They validate backend presentation contracts without introducing screens; later UI work requires its own agreed visual/browser evidence.

## Third-party disposition

Russell's added bimmer.work/M Decoder investigation was completed as refinement in the session, not deferred into a research story. No successful free-site decode was obtained. Outvin offers a documented authenticated route, but its vehicle-success schema, authorised successful data, account/fees and permitted demo/display/retention use remain unresolved. A truthful implementation-ready Outvin story cannot yet specify the field mapping or fixture rights. Retain it as a conditional provider candidate in the [research report](bmw-interface-research.md#6-requested-third-party-fallbacks) and SAN-012, then refine a separate capability if selected and those inputs exist. Do not replace those unknowns with a scraper or an invented schema.

## Authorised synthetic VIN fleet extension

Russell proposed collecting configurations, assigning plausible invented VINs, serving their static details from a stub API and consuming it through a replaceable adapter. He selected **10,000 genuinely distinct configurations**, then authorised two additional backlog Epics on 1 November 2026:

| Key | Bounded outcome | Dependencies |
|---|---|---|
| [FUCQ-18](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-18) | Working synthetic VIN registry/service/adapter and evidence-bearing plausible generator, proved with a small five-WMI fixture set. | FUCQ-5, FUCQ-13 |
| [FUCQ-19](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-19) | Collect, validate, publish and load 10,000 distinct complete resolved configurations, assign stable VINs and reconcile the service. | FUCQ-18, FUCQ-14; FUCQ-13 transitively |

The [refined capabilities](synthetic-vin-fleet-proposal.md) preserve the requested split. The [VIN rules research](synthetic-vin-rules.md) includes 145 BMW manufacturer reference rows, exact checksum/year/serial rules, plant corroboration and unresolved UK/RHD mappings. Official North American descriptors cannot silently identify GB configurations. All five requested WMIs are required; additional valid WMIs remain possible where models need them.

A native pilot proved three resolved configurations and matching OTD calls, including towbar equipment and the sorted-request requirement. It does not establish 10,000-config coverage or implement the fleet. The two new Epics are unassigned To Do, label `backlog`, default Medium, no points. Jira readback verified four Blocks links and two FUCQ-4 Relates links. FUCQ-18 precedes population.

FUCQ-13–17 retain their current descriptions and activation gates. This is the explicitly authorised extension; FUCQ-5 still agrees the canonical HLD before implementation. Synthetic identities remain separate from source-backed facts and scheme state; generated VINs never reach real providers. No implementation or bulk run was started.

## Verification and review

The repository's actual `jira_sync.py` section parser accepted all five original descriptions' Goal, Acceptance criteria, Files or areas, Decided, Out of scope and Validate sections. Titles are under 80 characters. Their original Story/parent relationship was superseded at Russell's closeout instruction: FUCQ-13–17 are standalone Epics, retain the descriptions and directed dependencies, and relate to the research through links. Their To Do status, Medium priority and unassigned state are preserved. No implementation code was changed and no application test result is claimed by this refinement.

The final closeout review corrected the native generation pilot's terminology: its 48/48/49 resolved selected elements comprise 47/47/48 configuration options plus one source-typed accessory. The successful request lists are preserved; the evidence no longer counts the accessory as a factory option. The closeout checks cover all eight evidence JSON files, both catalogue-image hashes, local links, whitespace and identifier/key exclusion.

Independent reviewer: requested Opus, selected `gpt-6.1-sol` / `high`, no fallback or descendants; effective runtime settings were not independently verified. The review found no blocking or major issue. One minor reference was corrected to `blocks/vehicle-matcher/modes/result-card.js`. It checked source/data boundaries, evidence values, image hashes and visual paint variation, experience obligations, privacy and access/design gates. Automated final checks cover JSON syntax, local links, story parsing, private-identifier/key patterns and whitespace.

A routine scaffolding metadata repair normalised legacy `team.protected: []` to the current `{paths: [], label: "protected data"}` shape. The previous form caused the offline guard to reject writes. The empty path set and all four enabled scaffolding pieces were preserved; the guard now passes. This is the only configuration change accompanying the research.
