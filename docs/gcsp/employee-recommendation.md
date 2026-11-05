# Read-only employee recommendations · FUCQ-29

This first employee consumer evaluates exact cars against the confirmed practical brief and the server-owned scheme context. It calls the existing `rankCars()` curves after the hard gates; shared evaluator extraction remains FUCQ-27/28 after 12 November. Saving a brief, claiming stock, allocating or creating an offer and sending mail belong to separate services.

## Authority and composition

The existing GCSP identity boundary resolves the employee, role, environment and current run after the shared access gate. The recommendation provider is an explicit trusted server dependency. It supplies permitted employee facts and stock, including exact `orderUuid`, `configurationId`, source versions and availability. An absent provider is unavailable. Unknown employee, scheme, grade or run never selects a fallback retail scenario. Caller IDs, prices, allowances, quotes, availability and profile/tuning flags cannot become authority.

All matrix decisions, allowance, monthly points and assumptions are obtained through the canonical `PolicyService`. The October 2024 source distinguishes FS&UK from RR&Production. Numeric points and practical charging requirements remain labelled demonstration assumptions. Cash top-up stays unused. A retained policy pin preserves the values and provenance required to explain an older evaluation.

The configured provider explicitly supplies its known essential requirements and a provenance-bearing driver-qualification fact. The demonstration may use a labelled synthetic qualification; missing or unconfirmed qualification is never inferred from sign-in. The request adds practical needs and cannot remove provider-known requirements.

The service reads an injected `now(context)` port so the later `DemoClock` can supply domain time. Required dates and release readiness are gates; a caller cannot extend an authoritative required date. Unknown equipment or decision-critical carrying/charging facts produce `needs-confirmation`, with no suitable assertion or preference score.

## HTTP contract

`POST /api/gcsp/recommendations` accepts the brief directly: `{ schemaVersion: 1, briefVersion, preferences, essentials, requiredBy? }`. Each preference carries its separate value/importance and confirmation/source fields; essentials carry their registered operator, unit and confirmation/source. No query parameters are supported. The existing boundary limits the body to 16 KiB, resolves the HttpOnly acting session after the shared access gate, requires an employee role and an exactly allowed command Origin, and sets `Cache-Control: no-store`.

Trusted composition supplies `buildServer({ gcspIdentity, gcspRecommendations: { provider, policy, time }, gcspAllowedOrigins })`. `provider.resolve(context)` supplies only that context's permitted employee facts and stock. `policy` is the shared PolicyService; `time.now(context)` is the DemoClock-compatible read. There is no implicit scenario provider or retail fallback. Custom registered GCSP routes cannot replace the built-in recommendation contract.

The response uses the shared `{ status, value?, contractVersion }` envelope. Successful computed decisions are HTTP 200; invalid brief/context is 400, session failures are 401, role/origin refusals are 403, stale runs are 409, and absent/unavailable source configuration is 503. Request identity headers provide no authority. The route is a POST only because it evaluates a structured private brief; it performs no business-state write.

## Evaluation and presentation

Every supplied exact car receives a decision before recommendation display limits. Eligibility, confirmed essentials, allowance versus monthly points and timing run first. Only suitable exact candidates enter preference ranking. The separate preference value and importance preserve indifference; comfort and sportiness can coexist. Inference and strategic steering do not replace confirmed facts or essentials.

Decisions retain brief, employee-facts, vehicle-facts, policy, terms and stock versions, their exact order/configuration identity, gate evidence, unknowns, reasons and trade-offs. No stock and no suitable stock are successful computed outcomes; a failed source is unavailable. Vehicle snapshots and typed employee terms are immutable. Stock carries no VIN and employee points never masquerade as pounds.

Inspection found the current ranker unconditionally reads a retail budget even with budget weight zero. A small trusted tuning switch disables that cash filter for this consumer. Retail defaults and scoring curves remain unchanged; request fields cannot set the switch. This bridge is temporary compatibility work, without extracting or copying the engine.

## Experience and design evidence

There is no new screen or component in this story. Contract examples cover useful, empty, unknown, forbidden, invalid and unavailable responses under the [experience contract](experience-quality.md). Future consumers follow the [shell/palette reference](screens/README.md), Used Cars body direction and [component catalogue](../../COMPONENTS.md).

The canonical diagram remains `docs/design/high-level-design.drawio`. No existing background draw.io tab was available during this build. Its status and rendered exports have not been updated or visually verified; older PNGs are not latest design proof. The textual HLD and this contract record the current implementation boundary.

## Validation and repeatable service trials

The [computed case record](evidence/fucq-29/README.md) contains nine actual service outputs with exact source hashes, input/provenance versions and the tested commit. It shows a suitable exact car, an unknown essential, a central allowance edit with a retained historical pin, changed importance/preferences, empty stock, source failure and a rejected downgrade. The HTTP tests use the actual memory repository and DemoIdentityAdapter, acting Paula sessions, the canonical PolicyService and injected source/time ports. They prove equivalent target-shaped provider normalisation, recomputation, identity/role/origin/access guards and unchanged repository state.

For repeatable non-UI trials, run the named employee and HTTP/isolation test modules from the repository root. Each HTTP fixture seeds an isolated run and fictional identities, issues the acting session through trusted presenter setup and closes its server/repository afterwards. The service has no new screen to click through; future employee consumers can use these contract cases as their reset/replay inputs. The seed's qualification, charging, monthly points and scoring calibration remain labelled demonstration assumptions for refinement.

Final integration at `60419c10` includes `gcsp-poc` documentation head `a281956` and executable base `d50f74f`. Scoped employee/policy/identity/engine/frozen-retail/snapshot/API checks passed 336/336. The explicitly authored `npm test` ran 576 checks: 574 passed, two real PostgreSQL checks skipped with `GCSP_DATABASE_URL` unset, zero failures. The passing default full stamp is `9c49b3023cae` (5 November 2026, 01:51:14 UTC); later documentation changes preserve its code identity. Runtime was Node 26.7.0 with one observed test worker. No production/provider deployment or PostgreSQL execution is claimed.
