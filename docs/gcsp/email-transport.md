# Brevo email handoff for FUCQ-88

Recorded 5 November 2026 at Russell's request, using the existing StanleyPi setup notes and Deckhead implementation. This is implementation background for [FUCQ-98](https://ibm-consulting.atlassian.net/browse/FUCQ-98), with the boundaries for FUCQ-93 and FUCQ-97 below. It does not start a poller, provision a sender or send email.

**Resumed by Russell, 5 November 2026:** "Yes resume it, I just gave the Brevo details in another session" (Codex chat `01a1ac41-5c78-7ff1-a49a-b7abdfc17ac3`). This explicitly supersedes Gary's earlier pause in Jira comment `132470`; the story's `paused:` line is removed. Implementation can proceed using this handoff. Verify the configured sender/API key, approved demo-recipient mapping and public offer URL before the story's deliberate real-send check. The captured outbox remains available throughout.

**Jira reconciled, 5 November 2026:** Atlassian reauthentication restored access. FUCQ-98 comment `132509` records Russell's resumption, and its description now permits implementation using this handoff while retaining configuration checks before real-send validation. Read-back confirmed the decision and unchanged acceptance/validation sections. Preserve the committed resumption if a stale import still carries the older pause. No new collaborator approval is needed.

## Real email test authorised — 5 November 2026

Russell explicitly authorised one deliberate real email test to his IBM address in the active dispatcher chat. The exact approved recipient is retained in the private local recipient-approval record, outside source control. Verify the existing key/account and sender first; send only to that approved address, with no automatic retries or additional recipients. A clearly labelled transport test without an offer link is permitted while the actual offer producer is unavailable. Such a test proves only provider acceptance; FUCQ-98 still requires the actual public offer, inbox receipt and link/access validation before completion. Never invent an offer or token to clear that gate.

**Observed test outcome, 5 November at 16:06 UTC:** Russell authorised one macOS Keychain prompt after background lookup failed. That one lookup succeeded, but Brevo account verification returned HTTP 401. The provider body was discarded, so the cause was unknown; this did not establish that the key was invalid. The run stopped after one GET: zero POSTs, zero emails, no sender or inbox/link validation. The prompt allowance is consumed; the already approved recipient/test authority remains recorded. This observation does not establish the state of Render secrets. Sanitised evidence is retained on the FUCQ-98 branch; no credential is recorded here.

## Existing evidence

**Replacement key check, 5 November at 17:27 UTC:** Russell reported the app-specific key saved under macOS Keychain service `gcsp-brevo-api-key`, account `vehicle-matcher`. One private lookup succeeded, but one `GET /v3/account` returned HTTP 401 again. No POST, email, sender/webhook check, repeated lookup or network retry occurred. At that point authentication was unverified; this status alone did not identify the cause. No credential or raw provider response was retained. Jira comment `132554` records the outcome and this new GCSP credential reference, which is separate from Deckhead's older item. The actual Render secret remains unverified; configure `GCSP_BREVO_API_KEY` on the **`bmw-matcher-api` backend service**, never the frontend site.

The sanitised local receipt for that earlier refusal is `.claude/test-runs/receipts/fucq98-new-key-account-20261105T172720Z/result.json`. Its supervisor removed its empty owned scratch root, joined the credential process, verified its group absent and released the host reservation. No compatibility exception or owned cleanup leftovers.

**IP approved; account authentication verified, 5 November at 17:41 UTC:** Russell confirmed that he had authorised the calling IP in Brevo and requested one retry. One private lookup of the same `gcsp-brevo-api-key` / `vehicle-matcher` Keychain item and one `GET /v3/account` succeeded with **HTTP 200**. No key replacement, POST, email, sender/webhook check or automatic retry occurred. Jira comment `132560` records this success. This clears the local account-authentication check. The earlier 401 response bodies are unavailable, so their exact provider diagnoses remain unknown; success after IP approval supports Russell's explanation.

The sanitised success receipt is `.claude/test-runs/receipts/fucq98-ip-approved-account-20261105T174100Z/result.json`. The supervisor removed `/private/tmp/test-stamp-shard-7dc85e5df60c4c248294b66c6554b34e` (0 allocated bytes), joined the credential process, verified its group absent and released the host reservation. No compatibility exception or owned leftovers. This configuration-only check changes no application or screen; application tests were not rerun. Independent wording review: Michigan J. Frog, requested/selected `gpt-6.1-sol` / `high` (Opus), no fallback or descendants.

The implementing dispatcher retains the story. Sender permissions/identity, Render configuration, real sending, inbox receipt and actual offer-link validation remain outstanding. This check does not start or resume a poller.

| Source inspected | Reusable evidence |
|---|---|
| `/Users/usget/Claude/StanleyPi/CLAUDE.md`, section 6, "Email authentication" (notes dated 28 August 2026) | Records Brevo as the authorised sender for `russellgowers.com`, with SPF, DKIM and DMARC configured. This is dated setup evidence, not a live account/DNS/deliverability check. Preserve the existing DNS records; this story needs no DNS changes. |
| `/Users/usget/Claude/deckhead/harness/mailer.mjs`, `buildBrevoPayload`, `sendMail`, `verifyCredential`, `publicOrigin` | Dependency-free transactional HTTP requests, both message bodies, a bounded timeout, credential verification without sending, and an explicitly configured public URL. |
| `/Users/usget/Claude/deckhead/harness/README.md`, "Email" | Documents the existing sender/key/public-address settings and distinguishes key validation from an actual delivery check. |
| `/Users/usget/Claude/deckhead/harness/run-with-mail.sh` | Existing local-development keychain pattern, service `brevo-key`, account `deckhead`. Reads a key directly into the backend process without printing it. Do not run it just to inspect a credential. |

Deckhead source revision: `29346ec9ba001949fc6630a71c1e0ffc85443f37`; these three source files were clean when inspected. The paths are provenance, not dependencies on those checkouts being present. The method is reproduced here for another machine's poller.

## IP authorisation and authentication recovery

Brevo's [IP security documentation](https://developers.brevo.com/docs/ip-security) confirms that an unauthorised calling IP can be blocked even with a valid key. The [authorisation procedure](https://help.brevo.com/hc/en-us/articles/5740111683858-Authorize-and-block-IP-addresses-for-API-and-SMTP-security), checked 5 November 2026, allows a recognised blocked IP to be approved from the notification email or **Settings > Security > Authorized IPs**.

Do not treat HTTP 401 alone as terminal evidence of an invalid credential or require key replacement. Retain the existing key and captured job, stop the current attempt, and distinguish IP authorisation, key status/permissions and network errors using fixed safe classifications. Keep raw provider bodies and account details out of logs. After a collaborator confirms the relevant IP is authorised, make one bounded authentication-only check before proceeding with the separately approved send validation; do not blindly loop on authentication failures.

Approval for this Mac does not verify the production caller. For Render's **`bmw-matcher-api` backend**, inspect **Connect > Outbound** and reconcile its actual outbound addresses/ranges with Brevo's authorised list before production validation. [Render's outbound IP documentation](https://render.com/docs/outbound-ip-addresses) describes this service-specific view. The frontend site is not the sending environment. The Render secret and its IP authorisation have not been checked in this session.

## Required transport method

Use Brevo's transactional HTTP API for FUCQ-98's one real adapter. Use built-in `fetch`, as Deckhead does; no SMTP relay, mail SDK or additional runtime dependency is needed. Keep it behind the existing `MailTransport.send({ context, job, message, now })` port in `server/gcsp/notify/port.js`.

Send `POST https://api.brevo.com/v3/smtp/email` with backend-only `api-key`, `Content-Type: application/json` and `Accept: application/json` headers. Map the existing rendered GCSP message rather than copying Deckhead's invitation/password-reset content:

```json
{
  "sender": { "email": "<configured verified sender>", "name": "<configured sender name>" },
  "to": [{ "email": "<server-resolved allow-listed demo address>" }],
  "subject": "<message.subject>",
  "textContent": "<message.textBody>",
  "htmlContent": "<message.htmlBody>",
  "headers": { "idempotencyKey": "<durably stored UUID for this environment/run/job>" }
}
```

Resolve `job.recipientId` through a backend-owned mapping from fictional employee IDs to explicit demo addresses. Refuse an unmapped or non-allow-listed address before making any provider request. Neither a browser request nor a fictional employee fixture supplies a deliverable address. Preserve the offer facts, escaped HTML and plain-text alternative from the existing renderer.

Use a bounded network timeout. Brevo's documented success is HTTP 201 with `messageId`; retain that ID durably against the job. Provider acceptance is not proof of inbox delivery. Do not copy Deckhead's recipient/subject/provider-body logging or assume its broader success-status handling is the GCSP contract. Map errors to fixed safe codes; keep API keys, raw provider responses, recipient addresses and token-bearing offer URLs out of logs and public responses.

The offer producer/landing-page stories retain ownership of tokens, link authorization and current offer state. A real inbox needs an absolute public application URL, including any GitHub Pages project path. Use a configured frontend base URL and the existing offer link; do not derive it from the request Host header, send localhost links or mint a second token in the mail adapter. Preserve FUCQ-102's run binding and access boundary.

## GCSP integration that the poller must preserve

- **FUCQ-93:** `server/gcsp/notify/index.js` already dispatches committed jobs through an injected transport. Retain repository/run scope, retry policy from `notify.delivery.v1`, DemoClock scheduling, reset/stale-job refusal and the rule that delivery never changes stock, holds or allocation priority. Keep the captured transport as the unconfigured default.
- **Capture with real sending:** `CapturedTransport.send` currently stores the message and marks the job sent in the same transaction. The dispatcher currently does not persist arbitrary provider acknowledgement fields. FUCQ-98 must integrate capture and provider-ID persistence deliberately: retain the rendered message for the viewer even on real-send failure, and mark real sending successful only after provider acknowledgement. Calling the current captured transport first and then Brevo would mark a failed external send as sent. A plain replacement transport would lose capture. Use the existing repository, not a second message store; update `shared-contracts.md` if the persisted acknowledgement shape changes.
- **Retry safety:** allocate and durably retain one UUID provider idempotency key for the environment/run/job before the first attempt. The existing `offer:<offerId>:notification:offer:1` job key is not itself a UUID. Reuse the stored UUID across concurrent dispatchers, timeouts and restart. Persist a confirmed provider acknowledgement and reuse it rather than resending. Brevo's current guide documents a 30-minute key window, measured by provider time, not DemoClock. A `duplicate_parameter` response is not itself a recovered message ID or proof of delivery. Do not blindly replay an ambiguously acknowledged send outside that window; keep an explicit safe failed/unconfirmed outcome rather than risk a second email. Exercise these cases with a stubbed provider.
- **FUCQ-97:** the presenter viewer continues to work without Brevo. Preserve its presenter-only access, sandboxed HTML, plain-text view and current-run filtering. Any acknowledgement/status projection changes belong in the existing presentation contract and require the relevant viewer checks; existing capture evidence does not prove external delivery.
- **FUCQ-109:** its critical-path proof continues to use captured notifications. Brevo setup must not become a new dependency of the end-to-end demonstration or the 1,000-employee simulation.

Read `docs/gcsp/README.md`, `demo-brief.md`, `build-rules.md`, `experience-quality.md`, `shared-contracts.md`, `captured-outbox.md` and `presenter-outbox-contract.md`. Pass these paths and the relevant story criteria to every child. Existing shell/sidebar/palette references are `docs/gcsp/screens/README.md`; application components follow `COMPONENTS.md`. There is no new settings screen in this handoff. If real sending changes a visible status or message, follow the experience contract for that affected surface and narrow-screen email/offer behavior.

## Backend configuration and remaining setup

These are **proposed FUCQ-98 names**, not settings already implemented in GCSP. The implementer documents the final names in the backend README:

| Proposed setting | Purpose |
|---|---|
| `GCSP_MAIL_TRANSPORT` | Explicit `brevo` opt-in; absent configuration retains capture only. A partial/invalid Brevo configuration must not claim real delivery. |
| `GCSP_BREVO_API_KEY` | Brevo API key supplied privately as a Render backend secret. |
| `GCSP_MAIL_FROM`, `GCSP_MAIL_FROM_NAME` | Sender accepted by the existing Brevo account and the display name. Verify the actual address/account before use; the domain notes alone are insufficient. |
| `GCSP_MAIL_RECIPIENTS` | Backend-only mapping of demo employee IDs to approved test addresses; its values are the recipient allow-list. |
| `GCSP_PUBLIC_BASE_URL` | Reachable public frontend base, preserving the deployed project path and compatible with the existing offer routes. |

No new PAT is needed to document or implement this HTTP method. The send credential is a **Brevo API key**, not a GitHub PAT, IBM inference key or Microsoft token. The existing local keychain helper establishes a retrieval pattern, not the presence or validity of a key for the GCSP Render process. Do not extract Deckhead's settings database or copy credentials into source, stories, chat, ordinary config files or shell arguments. A collaborator can privately configure an existing suitable key in Render; generate a new Brevo key only if the existing one is unavailable, revoked or unsuitable.

Before enabling real sends, verify the configured key with backend-only `GET https://api.brevo.com/v3/account` using the same `api-key` header. This request sends no mail, but its response can contain account details: retain only a safe result. An authentication refusal and a network timeout are different outcomes. Then verify the chosen sender in that account, the explicit demo recipient mapping and the public offer URL. No current Brevo account, sender status, credit balance, keychain item or Render secret was checked for this handoff.

FUCQ-98's existing sender-setup boundary remains: provisioning a sender/domain/tenant is outside the implementation story. Once configured, its existing acceptance requires one deliberate real send to an approved demo inbox, the provider ID in the result and actual inbox/link verification. Ask for the specific missing setup at that point; do not request a PAT speculatively or claim that the sender precondition has cleared from these notes alone.

## Selected validation

For the later implementation, start with `node --test server/test/gcsp-mail-transport.test.js` (the proposed FUCQ-98 deliverable), then the affected FUCQ-93 dispatcher and FUCQ-97 route/viewer checks. Cover payload mapping, 201/message ID, safe refusal/error/timeout outcomes, allow-list enforcement before network access, capture during success and failure, stable-key retry/restart/concurrency, ambiguous acknowledgement beyond the provider window, canonical absolute offer links, stale-run handling and secret/token-free diagnostics. Preserve the story's remaining required validation and apply the repository's test-resource rules before running it. No live sends from automated tests.

This documentation change runs story-format, link/reference, mirror-consistency and whitespace checks only. Runtime source, templates, screens and dependencies are unchanged, so application suites and browser captures are excluded. No test worker, scratch directory, archive, credential operation or external send is needed.

## Primary API references

Checked 5 November 2026: [send a transactional email](https://developers.brevo.com/reference/send-transac-email), [retrieve account](https://developers.brevo.com/reference/get-account), [email idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails). These verify the API method and current provider window, not the state of Russell's account.

Agent allocation: the required capacity check returned `can_start=0`; the parent completed discovery and documentation without spawning agents or creating scratch.

Handoff verification, 5 November: the story-format check passed; all 97 local Markdown references across the five changed documents/story files resolved; the local handoff and precondition matched the story mirror; the five existing acceptance criteria, dependency and pause were retained. FUCQ-98's Jira description read-back matched the update. Related notes were recorded on FUCQ-88 (comment `132477`), FUCQ-93 (`132478`) and FUCQ-97 (`132479`), without changing their statuses. No runtime validation or live delivery is claimed.
