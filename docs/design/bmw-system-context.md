# BMW system context — 11 November 2026

[Editable draw.io share export](bmw-system-context.drawio) · [Overview PNG](bmw-system-context.png) · [Data adapters PNG](bmw-data-adapters.png) · [Action adapters PNG](bmw-action-adapters.png)

The three pages also appear as **10 BMW system context**, **11 BMW data adapters** and **12 BMW action adapters** in the [canonical high-level design](high-level-design.drawio). The smaller share export contains those same pages; maintain them in the canonical design and refresh the share export together. The existing twelve architecture pages are preserved.

This view supports a BMW integration discussion. It maps required capabilities to known system roles and candidate providers. It does not establish live BMW API availability, migration completion or production acceptance. Adapter labels describe logical boundaries; some bundle several existing ports. The data/action pages identify the current demonstration providers separately.

- **Known role** means the system or business responsibility has project evidence; its integration contract can still be unknown.
- **Candidate** means the mapping needs BMW confirmation. Entra, Graph/Exchange, a supported vehicle/build source and the Production endpoint remain candidates.
- **Optional** connected-use summaries have no concrete provider in the audited implementation and must not block the core journey.

GCSP unifies the GCSO ordering and former ISA handover experience over mainframe functions today. The agreed future integration target is AWS; completed Java backend migration is not established. The portal walkthrough references IVS stock, IVS-R approval handoff/employee availability, IVS-ZG/IVS-R channel changes and UVDM work requests following returns. These are referenced roles, with current contracts and ownership still to confirm. SAP HR is specifically an employee-existence gate; the source does not establish its authority for all grade/eligibility, account, driver or contract facts. The policy box names rule owners rather than an identified policy product.

Entra supplies identity and access capabilities. Microsoft email would use an approved transport such as Graph with Exchange Online, an authorised sender and appropriate `Mail.Send` permission. BMW must confirm its sanctioned route. The existing captured/Brevo demonstration transport is separate. No BMW tenant, mailbox or endpoint was configured for this diagram.

The first integration conversation should establish:

1. The supported GCSP stock/release feed, exact order/configuration identity and freshness contract; polling, batch and push remain options until confirmed.
2. The single authority for exclusive hold/release and employee order acknowledgement across manual and buddy channels.
3. Employee/current-car joins and authoritative, effective-dated scheme eligibility, points, allowances and terms.
4. The owners/contracts for approvals, documents, appointments/return and Production request/confirmation.
5. Approved identity/roles, mail sender/transport, vehicle data/media access and BMW hosting/operational arrangements.

Matching, forecasting, preferences and offer orchestration are our capabilities. Production planning receives Greg’s intentional requests; it is not an autonomous ordering loop. A future supply confirmation is separate from a released vehicle. Catalogue and handbook data do not prove stock availability or exact fitted equipment. The overview groups these sources for readability; the adapter map preserves their different roles. VSS is referenced for static VIN data; current supported access remains unverified, and live Driver’s Guide activation remains gated. Fleet/Used Cars/remarketing are potential downstream consumers rather than an invented direct export adapter; the known ISA → UVDM return/disposal role is recorded in A4. A runtime LLM is not required by the structured-input baseline.

Evidence used:

| Subject | Repository evidence |
| --- | --- |
| Current GCSP/GCSO/ISA roles | [Platform clarification](../gcsp/platform-context.md), supplied 2 November; [HLD agreement](../gcsp/hld-agreement-2026-11-04.md), Q14 |
| SAP HR and scheme context | [Portal walkthrough](../gcsp/background.md), “How GCSP works today”; [demo purpose and adapter boundary](../gcsp/demo-brief.md) |
| Current employee / role ports | [Manual context ports](../../server/gcsp/manual-context/ports.js), [identity adapter](../../server/gcsp/identity/login-adapter.js), [runtime composition](../../server/gcsp/runtime.js) |
| Policy and stock | [PolicyService](../../server/gcsp/policy/index.js), [stock/release contract](../gcsp/stock-release-contract.md), [run stock provider](../../server/gcsp/stock/run-stock.js) |
| Transactional actions | [Local stock](../../server/gcsp/adapters/manual-stock.js), [ordering](../../server/gcsp/adapters/synthetic-ordering.js), [status](../../server/gcsp/adapters/synthetic-ordering-status.js), [documents](../../server/gcsp/adapters/synthetic-ordering-documents.js), [appointments](../../server/gcsp/adapters/synthetic-appointments.js), [return outcomes](../../server/gcsp/adapters/synthetic-return-outcomes.js) |
| Vehicle data and connected-use limits | [BMW interface research](../gcsp/bmw-interface-research.md), [lookup adapter](../../server/gcsp/vehicle-evidence/lookup-adapter.js), [HLD provider boundaries](gcsp-high-level-design.md), [Sandeep questions](../gcsp/questions-for-sandeep.md), SAN-012 |
| Mail and Production | [Mail transport composition](../../server/gcsp/notify/config.js), [mail port](../../server/gcsp/notify/port.js), [email research and direction](../gcsp/demo-brief.md#email-adapter-and-microsoft-setup--checked-1-november), [synthetic Production](../../server/gcsp/supply/synthetic-production.js) |

Microsoft primary documentation was checked on 11 November 2026: [Microsoft Entra overview](https://learn.microsoft.com/en-us/entra/fundamentals/whatis), [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) and [Outlook mail API](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview?view=graph-rest-1.0). These confirm service roles, not BMW’s configuration. Native hosted research returned no content; Parallel retrieved the official documentation (`search_471d4396b7625473b8ac8dfcd1bfb756`, `extract_424a574fa60fdc268a4fc5c991f759a2`).

Validation is scoped to this documentation change: XML/page/connector integrity, preservation of existing pages, native draw.io rendering of all three new pages, and independent architecture/readability review. No application code changed, and application suites were not run. Rendering used isolated headless Chromium; the user’s browser tabs and focus were untouched. The launching session’s bounded resource manifests, selection and cleanup receipt are retained locally under `.claude/test-runs/bmw-system-context-20261111/`.

Independent reviewer: Charlie Dog, requested/selected `gpt-6.1-sol` / `high` (Opus); no fallback or descendants; effective runtime unverified.

Review findings were implemented and the corrected exports inspected: connector routes and labels, employee actor, SAP HR’s limited evidenced role, IVS/IVS-R/UVDM mappings and offline/live vehicle-provider boundaries. The final actor connector was moved clear of the boundary heading and re-inspected by the parent. Both supporting maps were independently found readable and unclipped. Use the overview for the conversation and zoom the tables when discussing individual contracts.

Cleanup receipt: all five manifest-owned temporary roots were removed and their absence verified; the final browser process group was absent. Maximum sampled temporary allocation was **150,272 bytes**. The compatibility exception was the active local headless-browser profile/working set, which was disposed of after rendering. No archives or large retained outputs, no owned cleanup leftovers. The local retained summary is `.claude/test-runs/bmw-system-context-20261111/final-validation.json`, with detailed ownership records under its sibling `ownership/` directory.
