# FUCQ-437 entry and navigation delivery

Source work began on 16 November 2026 on `dev/DEV-2026-11-13-005`, claimed at
`5d1b8bcdf`. The implemented visual baseline remains
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`.

## Original contract and current evidence

1. Direct entry, refresh, role landing, sign-in return and new offer links reach the
   intended authorized state. **Open:** source changes and authored tests do not
   prove hosted refresh, real OIDC or actual emailed-link return.
2. Unknown frontend routes and unavailable/invalid API responses produce distinct
   useful outcomes; shared entry links preserve brand/context. **Open:** source
   review identified the wildcard page's auth-state precedence and a launcher
   deployment topology gap. No successful runtime or rendered proof is claimed.

The original validation remains replaying direct URLs, refresh and email return on
the static host, plus unknown/API failures and shared launcher/retail navigation.
Legacy GCSP aliases are unnecessary. Separate FUCQ-513 remains outside this work.

## Bounded implementation plan

| Slice | Author and exact ownership | Boundary |
| --- | --- | --- |
| `route-state` | Sally Carrera 2: `apps/gcsp-web/src/app/routes.ts`, `auth/route-policy.ts` and spec, `auth/route.guards.ts` and spec, `pages/state-page.component.ts` and spec | Existing AuthPort/OIDC roles, safe protected/root return context, explicit route failure presentation; reuse shared status/button components. |
| `static-launcher` | Sally Carrera 3: `scripts/build-gcsp-static.mjs`, only the independent migration static site's routing in `render.gcsp.yaml`, allocated `blocks/demo-launcher/{entry-context,employee-entry,boot,launcher}.js` and five allocated launcher/static server specs | Comparison route/cache parity, truthful Angular handoff, preserve retail context and existing live services. |
| `integration` | Speedy Gonzales 2: review, named-path source checkpoint, this delivery record, own Story and own map object | Original affected-boundary validation, followed by original hosted/OIDC/email/rendered evidence when available. |

No new component, policy, provider, business feature or validation framework is
allocated. Existing product-map associations already include FUCQ-437; its 301
foreign Story objects, their order and outer fields are preserved.

## Source findings and open topology

- Existing Angular routes, guards, AuthPort/OIDC and offer route supply the agreed
  interfaces. Comparison/presenter/outbox behavior is retained.
- The wildcard state page currently allows loading/unavailable/denied auth state to
  hide the distinct not-found outcome. Retry after a thrown context initialization
  also needs to retain the intended protected route.
- The static manifest/Render fixed routes omit `/gcsp/comparison`.
- The existing launcher service publishes the shared launcher, whereas
  `gcsp-angular-dev` publishes the separate Angular artifact. A same-origin
  `/gcsp/` link from the former would therefore misrepresent deployed availability.
  No configured frontend origin has yet been verified. The parent dispatcher is
  resolving the exact public handoff/configuration boundary.
- A broad `/gcsp/*` rewrite would mask missing scripts/media with HTML. Existing
  source does not establish an exclusion/regex mechanism. Unknown direct routes
  and dynamic offer refresh remain original work until a supported host contract
  and its evidence exist.

## Validation and resources

This phase permits source inspection and authored tests only. Test, lint, typecheck,
build, package installation/copy, browser, service, database and network proof are
**UNRUN**. No test scratch, reservation or runtime was allocated. No OneDrive
location was accessed.

After source review, the lead sends an exact frozen selection and pins to the
dispatcher. Reuse matching existing OIDC/context/offer evidence; select changed
route/state and launcher/static regressions. Do not rerun full comparison, Java,
provider or retail suites without changed-boundary justification. Original real
OIDC, actual email, hosted refresh and rendered/browser evidence remain separate.

Any later released finite run retains the parent-owned resource envelope: 768 MiB
disk, 1,280 MiB aggregate RSS, 2,048 MiB inclusive allocation, one worker, 384 MiB
Node heap, 480 seconds work/600 seconds total, 5 GiB reserve and 2 MiB whole local
retained output, with exact local ownership/reservation/finalizer and cleanup proof.
No runtime release is implied by recording this envelope.

## Attribution and delivery learning

Speedy Gonzales 2 leads and reviews; Sally Carrera 2 authors Angular route/state
source; Sally Carrera 3 authors static/launcher source. Both implementers requested
and selected `gpt-6.1-sol` / `medium`, without fallback. Their own title tools
confirmed their names and both reported actual overlapping source starts. No
validator or executed-test credit is assigned in this source-only phase.

For dispatcher log issue `DL-20261116-GCC-003`, retain the demonstrated difference
between a source-level entry link and a usable deployed handoff. The existing
two-host topology was discovered before publishing a false same-origin link;
source mitigation and hosted verification are distinct remaining outcomes.
