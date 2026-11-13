# Questions for GC: deployment and path to live

## Dispositions from migration refinement — 13 November 2026

These were the original questions, not a current unanswered checklist. [Current decisions](../design/migration-decisions-2026-11-13.md) and [replacement contracts](migration-replacement-contracts-2026-11-13.md) now settle:

| Question | Agreed disposition / remaining evidence |
| --- | --- |
| GC-001 | One Render blueprint; separate static Angular 21 and Java 21/Quarkus 3.x API artifacts. Gary creates dev from `gcsp-poc-dev` with its own database and performs final merge into `gcsp-poc`. Actual hosted settings/capacity still need proof; minimize cost, no paid tier/domain selected. |
| GC-002 | Preserve retail and its supported shared launcher/brand handoffs. Angular owns GCSP routing and public deployment API/OIDC config. No legacy GCSP URL/API compatibility required. |
| GC-003 | Java owns runtime jobs and PostgreSQL state/receipts/recovery. Preserve explicit clock/tick and notification-dispatch semantics; no unattended scheduler is newly agreed. New state/links survive ordinary restarts. |
| GC-004 | Reuse existing ports/semantic contracts in Java; startup-selected local/remote providers, no silent synthetic fallback. FUCQ-467 completes remote decisions; FUCQ-481 proves full substitution. No Node business execution for deployed GCSP. |
| GC-005 | Configured backend mail adapter must deliver to an agreed test recipient in both connected proofs; capture alone is insufficient. New links require OIDC sign-in and employee ownership. Actual sender/configuration/access still need validation. |
| GC-006 | Angular 21, Java 21, Quarkus 3.x and OIDC bearer JWT confirmed. Real test-provider browser login first; BMW service/SSO activation follows with access/contracts and further supplied standards. |
| GC-007 | Whole hosted dev review at the end; no interim human checkpoints. Preserve business/visual outcomes and normal app/SQL recovery. Gary's merge triggers immediate replacement; downtime allowed and no retained-deployment rollback rehearsal. |
| GC-008 | No new comparable-human-team delivery evidence was supplied by this refinement. Existing evidence limits remain. |

The original observations/questions below remain dated source context. Their final “all open” statement describes that earlier record only.

Prepared 1 November 2026 for Russell's discussion with Gary Carter on Tuesday 3 November. No message has been sent to Gary. Russell owns the human presentation practicalities; these questions concern technical deployment and later integration.

## Observed deployment

- Frontend supplied by Russell: [GitHub Pages demo](https://garyscarter-ibm.github.io/vehicle-matcher/?brand=bmw&scope=national).
- Its deployed inline script identifies `https://bmw-matcher-api.onrender.com` as the remote API. Direct browser navigation to [the health endpoint](https://bmw-matcher-api.onrender.com/health) returned `{"ok":true}` on 1 November.
- [.github/workflows/pages.yml](../../.github/workflows/pages.yml) deploys the frontend from `main` and names the same API host. `index.html` also defines that remote default; `block.html` uses the deployment rewrite or an API override.
- [render.yaml](../../render.yaml) declares a Node backend on Render, with `server/` as its root, `/health` as its health check and a free-plan configuration. The live plan, deployed revision, dashboard owner and auto-deploy branch remain unverified.
- Current `gcsp-poc` discovery documents and collaboration settings are local changes. They need sharing before Gary's separate clone can use them. Demo credentials are not recorded here.

## Open questions

### GC-001: Deployment ownership and branch configuration

Who controls GitHub Pages and the Render service? Which exact branch/revision is Render deploying, how are deployments triggered, and is the running plan the one declared in the blueprint? What is the intended release route for `gcsp-poc`?

### GC-002: Shared launcher and environment routing

How should FUCQ-13 sit in front of the current launcher while retaining the brand switcher, current used-car modes and deep links? How will the employee and used-car experiences select the right API/environment without breaking existing demo links or duplicating configuration?

### GC-003: State and background work

Where should employee briefs, exact-vehicle holds, accepted allocations and Greg's jobs live? How will the employee page, Greg's page and an offer opened in another browser share that state, including after a process restart? What runs expiry, release processing and escalation when no browser is open?

### GC-004: Adapter and service boundaries

Which existing server and matching modules should be reused, and where should employee-scheme services and replaceable data/operation adapters sit? How will fixture-backed and BMW-backed implementations share contracts and decision logic while keeping retail stock and scheme availability distinct?

### GC-005: Email integration

Which available Microsoft or Brevo route is practical for the demo? Who owns sender setup and deployment secrets, and what stable landing-page URL will the message use? Keep transport configuration behind the mail adapter and independent of matching or allocation priority.

### GC-006: Later BMW hosting and integration

What frontend host/design conventions and deployment pipeline would BMW require? What would need to change for identity/roles, authorised vehicle operations, durable state and operational ownership? Establish how reusable blocks and services fit the target host instead of assuming this demo can be deployed unchanged.

### GC-007: Technical release and recovery checks

Which checks will establish a compatible frontend/backend release, working deep links and current offer state, preservation of existing brands/modes, and a recoverable prior version? What needs to be true before an employee-scheme release can become the public demo entry point?

### GC-008: Credible delivery comparison

Do we have comparable human-team delivery data, or can someone independently estimate selected stories before implementation using the same acceptance criteria and starting assets? Agree how human effort, elapsed time, review/rework and reuse will be captured alongside story points. See [delivery evidence](delivery-evidence.md).

All questions remain open. These notes select no hosting change, production integration or priority policy.
