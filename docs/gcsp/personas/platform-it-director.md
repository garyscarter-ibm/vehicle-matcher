# P03: Platform IT director

**Status:** Provisional v0.1, 31 October 2026. Discovery input for FUCQ-2.

The IT leader accountable for the platform supporting the employee car scheme. Russell supplied this role boundary. Account-corpus leadership records, correspondence and modernisation proposals provide supporting context; they do not establish a complete responsibility matrix or personal KPI scorecard. [E2](sources.md#e2-it-leadership-role) [E10](sources.md#e10-project-direction)

**Job statement — authored summary:** When the business wants to improve the car scheme, help me judge the employee and operational value, delivery cost and platform impact, so I can support useful change without compromising service or creating avoidable long-term work.

## Context supported by evidence

- The account plan records IT leadership across Sales, Aftersales and Finance. Correspondence shows scrutiny of additional effort and cost, selective approval of risk-mitigation work, and monitoring of transition spend before authorising more. [E2](sources.md#e2-it-leadership-role) [E3](sources.md#e3-cost-and-delivery-decisions)
- GCSO/ISA modernisation proposals aim to consolidate applications, improve security and maintainability, follow BMW frontend standards, and move towards stable APIs and a modern cloud backend. These are programme intentions, not proof that every target capability is live. [E4](sources.md#e4-modernisation-direction)
- Release-readiness records identify dependencies on business role confirmation, outstanding order approvals, business communications and verification after deployment. A planned go-live date is not confirmation of release. [E5](sources.md#e5-delivery-and-operational-dependencies)
- Sandeep is currently working on the backend and is the project's contact for understanding it. The authoritative live interfaces and ownership boundaries have not yet been established for this POC. [E10](sources.md#e10-project-direction)

## Motivations to validate

- **Useful progress:** improvements should make a demonstrable difference to employee experience or scheme operations.
- **Controlled investment:** understand the value of additional effort and the ongoing cost of running and changing the service. This hypothesis has direct support from the recorded cost decisions.
- **Dependable service:** preserve correct ordering, approval and integration behaviour as the platform changes.
- **Maintainability:** build on the modernisation direction and reduce duplication rather than accumulate another service to support.
- **Accountability:** have clear ownership, release evidence and operational responsibilities when something fails.

These are role-level interpretations of decisions and programme context. They are not claims about the source contact's personality or a formally agreed scorecard.

## Frictions and constraints

Business ambition can exceed the delivery budget or the readiness of shared systems. Frontend changes depend on correct employee, scheme, stock and order information; a polished demonstration does not establish that these integrations work. Legacy and modern components may coexist during the programme, while service ownership and data boundaries need explicit agreement. [E4](sources.md#e4-modernisation-direction)

Working concern to validate: a recommendation capability that duplicates rules, requires a separate operating model or obscures who owns a decision may cost more to maintain than its visible benefit suggests. The IT leader needs to distinguish a useful demonstration from evidence of production readiness.

## What success could mean

Candidate platform measures, with no verified targets:

| Outcome | Possible measure |
|---|---|
| Dependable employee service | Availability during relevant business windows, successful order completion and recovery time. |
| Controlled cost | Delivery spend against agreed scope; ongoing support and platform costs. |
| Safer releases | Release-related incidents, failed changes and integration defects. |
| Maintainable delivery | Time and effort to make a scheme change; duplicated rules or integrations needing support. |
| Demonstrable business value | Scheme-team effort and employee outcomes, jointly owned with the business. |
| Appropriate governance | Security and operational acceptance evidence; clear ownership of rules and data. |

No source reviewed establishes numerical SLAs, cost-reduction commitments or personal bonus measures. The account corpus also contains IBM commercial objectives; those are not BMW IT KPIs.

## Discussion scenario

For discussion only: the business presents an employee recommendation concept while backend modernisation is underway. Explore what evidence the director needs to judge its value, scope, ownership and route into the platform. This does not select an architecture, technology or integration scope for the POC.

## Validation needed

- Confirm the platform owner's actual measures, priorities and decision rights. See [SAN-003](../questions-for-sandeep.md#san-003-success-measures-and-baselines); Sandeep may need to refer this to the platform owner.
- Establish current service boundaries, systems of record and interface readiness. See [SAN-004](../questions-for-sandeep.md#san-004-current-platform-boundaries).
- Confirm how business policy, technical operation and supplier delivery responsibilities are divided. See [SAN-002](../questions-for-sandeep.md#san-002-ordering-role-and-decision-rights).
