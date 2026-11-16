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
- The wildcard state page now gives the distinct not-found outcome priority over
  auth state. Safe root query/hash survives sign-in and role landing; thrown
  initialization preserves the return candidate. Retry handles ordinary void and
  signed-out results. Same-root recovery reloads navigation and re-evaluates the
  existing landing guard. Lead source review found no blocker; runtime is UNRUN.
- `/gcsp/comparison` is now in the static fixed route, exact Render rewrite and
  no-store header contracts (source checkpoint `118b0098f`).
- The existing launcher service publishes the shared launcher, whereas
  `gcsp-angular-dev` publishes the separate Angular artifact. A same-origin
  `/gcsp/` link from the former would therefore misrepresent deployed availability.
  No configured frontend origin has yet been verified. The parent dispatcher
  authorized an explicit public frontend URL capability option with useful
  unavailability when absent, within the allocated source. Actual public caller
  wiring remains open if it requires an unallocated file.
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

The Angular source slice authors 31 expanded cases: six route-policy, nine guard
and sixteen state-presentation cases. The refresh test mounts the actual shell;
lazy account/comparison checks use constructor identity. Proposed selection:

```sh
npm test -- --include=src/app/auth/route-policy.spec.ts --include=src/app/auth/route.guards.spec.ts --include=src/app/pages/state-page.component.spec.ts
```

Run from `apps/gcsp-web` only under a later explicit resource release. This command
has not executed. Unchanged ContextClient source already maps malformed/network
API outcomes to unavailable; source inspection is not credited as a passing test.

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
