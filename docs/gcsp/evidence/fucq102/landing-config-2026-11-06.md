# FUCQ-102 deployment landing URL — 6 November 2026

This implements the remaining original landing URL criterion. It does not change
the claimed acceptance criteria or establish full Story acceptance.

## Diagnosis and change

At base `b9eeb85b29b85611b3dfc33f613c653a48cf0410`, `mintOfferToken`
always emitted `/gcsp/offer`. Both the local Buddy producer and remote claim
confirmation called it without a deployment destination. The local HTTPS host
serves that alias, but a separately deployed static site needs its own origin
and page path. Existing notification rendering accepts relative paths and HTTPS
URLs and carries the outbox link unchanged; it needs no source change.

The trusted runtime now accepts `offerLandingUrl`, falling back to backend
`GCSP_OFFER_LANDING_URL` when omitted. Both producers receive the resolved value.
Unset configuration preserves the local `/gcsp/offer` default. Configure a full
HTTPS static-page URL, for example
`https://gcsp.example/gcsp-offer.html?brand=bmw`, for cross-browser email delivery.
An explicit runtime option takes precedence over the environment; a root-relative
configured path supports same-origin hosts. The default lives in one resolver.

Only the trusted constructor/runtime accepts this setting. Public offer/run
coordinates are encoded by the generator, and the random token remains solely
in its fragment with the existing environment/run/offer hash binding. Configured
query context is retained; credentials, fragments, non-HTTPS absolute URLs and
prepopulated token/offer/run selectors are refused. Invalid runtime configuration
returns `invalid-offer-landing-url` before opening storage. Existing outbox links,
pending authority, token scheme and deadlines are not rewritten.

The original runtime is local-synthetic. The remote lifecycle receives the same
configuration through `BuddyHoldService`, including confirmation after restart;
no new remote runtime adapter is introduced. Notification modules are read-only.

## Selected validation

```sh
node --test --test-reporter=tap --test-concurrency=1 \
  server/test/gcsp-offer-token-coordinate.test.js \
  server/test/gcsp-offer-access.test.js \
  server/test/gcsp-offer-access-producer.test.js \
  server/test/gcsp-buddy-remote.test.js
```

Selection covers changed URL generation/binding, both producer callers, pending
remote confirmation/restart, actual runtime default/environment/explicit override,
captured delivery and existing token/cookie/account access, state and timing parity.
It uses the existing targeted test-stamp runner on this base, not a full-suite stamp.
No browser, listener, network transport or native database is selected. Broader
runtime journeys, FUCQ-105 screen/mobile/keyboard and FUCQ-107 second allocation
are excluded from this backend increment. The existing full suite remains
1,590 tests: 1,569 pass, 16 fail, 5 skip; this selection does not waive that evidence.

One Node worker is supervised with 60 seconds, 512 MiB aggregate RAM, 128 MiB
scratch, 2 MiB logs and 5 GiB disk / 512 MiB RAM reserves. Prior current-backend
evidence used about 228 MiB and 2.4 seconds; the added producer cases and remote
boundary file are expected to remain within this finite allowance. The plan,
checkpoint and ownership manifests are retained outside owned scratch under
`.claude/test-runs/fucq102/landing-config-2028/`. Temporary dependency links point
only to the retained shared installations, are recorded before creation and
removed in `finally`. Every process is stopped/joined and exact scratch/link/group
absence and the final raw reservation registry are checked.

Backend only: no screen, component, copy or interaction layout changes. The
existing offer-page DTO, concise state copy and fragment-exchange contract are
preserved. The reference remains the agreed GCSP shell and Used Cars body in
`docs/gcsp/experience-quality.md`; new screenshots are unnecessary for this URL
composition increment.

## Result and cleanup

**95 tests, 95 passed, zero failed/cancelled/skipped/todo.** The targeted receipt
records base `b9eeb85b29b85611b3dfc33f613c653a48cf0410`, variant `default` and
tested dirty code key
`695696d301810952b4264f79373e110c891cb104c8ff13c24515fc0d93d6c48f`.
All selected source/input hashes were unchanged during execution and rechecked
after cleanup. [The compact result](landing-config-result.json) preserves those
hashes, selected command, exact original receipt/checkpoint locations and hashes,
resource readings and cleanup checks. Subsequent changes are documentation only.

The new cases prove root-relative and absolute configured page paths, retained
brand context, encoded run/offer identity, fragment custody and environment-bound
hash verification. Actual local production exchanges into matching account and
cookie access. Real runtime composition proves unset/default, environment input,
explicit override, captured delivery and early invalid-configuration refusal.
Remote claim intent remains pending without a link until a restarted producer
confirms and creates the configured link. Existing access/state/expiry/reset,
request-listener/origin guards and remote protocol checks also pass.

The single supervised chunk completed in 7.043 seconds (checkpoint 7.195 seconds),
with peak aggregate RSS 269,172,736 bytes and zero measured scratch-file bytes.
The existing runner retains a 16,425-byte TAP tail including complete aggregate
counts, not a complete transcript or line/branch coverage. Its SHA-256 is
`0a86b94473b6119e93343702a3cefab9ef997e05cc98a664fd61396010b13555`.
The supervisor joined the child; PID/group `57086`, supervisor PID `57007`, owned
scratch `/private/tmp/test-stamp-shard-dcd830414d534fc788f0020242bc9d12` and
both temporary dependency links were independently verified absent. The raw host
reservation registry was empty. Retained installs were preserved; no owned
leftovers, browser profiles, listener or native database were created.

The reviewed test-impact mapping is retained at
`.claude/test-runs/impact/fucq102-landing-config-695696d3.json`; it makes no
unobserved coverage claim. Personal raw plans/protocols stay ignored and local.

Original AC5 now has implementation and targeted backend evidence. Original
AC1–4 retain the current access evidence and passed again in this selection.
Live deployment configuration, actual hosted landing/reload, remote
transport/native database and full-suite acceptance remain unrun here. No failed
check from the existing broad suite is relabelled. No checkbox or Jira transition
changes; root retains integration, Jira and full acceptance.

Agents: retained Hugo, requested/selected `gpt-6.1-sol` / `high`, no fallback or
descendants. Rules: `AGENTS.md`, `docs/gcsp/build-rules.md` (Demo delivery and
scope control) and the experience contract; original ACs remain fixed.
