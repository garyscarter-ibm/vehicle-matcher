# FUCQ-35 source checkpoint

5 November 2026. Emmet (they/them), requested and selected `gpt-6.1-sol` / `medium`, no fallback or descendants; effective runtime not independently confirmed. Run: `fucq35-20261105-launcher-entry`.

Source ready for parent review and resource-admitted validation. No tests, builds, browser, installation, server startup or network sends were launched by this implementer. No commit or push. FUCQ-7 remains an integration/acceptance dependency; this checkpoint does not mark the story built.

## Component plan

Reuse `el`, `button`, `statusScreen`, the existing `.demo-entry-host`/launcher-header composition classes, and the real account element's existing shell/body. Existing launcher choices and brand selector retain ownership of disabled and unsupported-brand presentation. No component, catalogue, gallery, stylesheet or ratchet extension is needed.

## Changed paths and boundaries

- `blocks/demo-launcher/demo-launcher.js`: explicitly register the enabled real capability at the public entry; library defaults remain unavailable.
- `blocks/demo-launcher/employee-entry.js`: lazy-load the real account custom element and HTTP adapter, assign its adapter before attach, load existing shell/account styles, and remove the mounted element/styles on abort. The fetch wrapper preserves cookie credentials and only adds the existing demo gate header. Only the exact demo-gate Unauthorized envelope triggers password retry; employee session failures retain the account adapter's semantics. It never creates or switches an employee session.
- `blocks/demo-launcher/boot.js`: adjacent recovery navigation, focused loading/load-error/Retry states, route cleanup and stale-promise handling. History observation changes destinations without remounting retail on answer/hash updates. Rejected demo credentials abort the old account before requesting the password again.
- `blocks/demo-launcher/entry-context.js`: employee API context reuses the existing retail public API normalizer, stripping credentials/query/hash and rejecting unsafe protocols. Identity/buyer inputs do not cross the employee boundary.
- `server/test/helpers/launcher-dom.js`: expose the actual primitive/resolver imports and browser globals to the extracted real boot source; align its access-key storage constant with product code.
- `server/test/launcher-employee-entry.test.js`: focused regression source, including the actual account custom element and HTTP adapter with finite synthetic transport envelopes. Synthetic HTTP envelopes establish contract coverage only, not functioning product runtime or identity provisioning.

## Selected future checks

Parent-selected first scoped command:

```sh
node --test --test-concurrency=1 server/test/launcher-employee-entry.test.js server/test/launcher-context.test.js server/test/launcher-navigation.test.js server/test/launcher-render.test.js
```

Entry tests map boot/capability/serializer to loader rejection and retry, lazy/disabled/unsupported routing, direct/remount/history navigation, cancellation, one custom-element mount, cookie transport and demo versus employee rejection. Existing context/navigation/render tests protect all supported retail contexts, return serialization, gate, history wrapper semantics and shared primitives. There are no fixture/config/subprocess inputs beyond jsdom, source reads and the explicit finite test envelopes; no server is started by the new entry tests.

Render/API/ratchet checks, background desktop/narrow/keyboard inspection, actual product runtime session/adapter proof and final full-suite integration remain parent-owned gates. No broad validation was launched. Parent owns affected-selector plan review, the shared impact identity map, HostBudget admission and future scratch manifest/finalizer.

## Cleanup

No test scratch, browser profiles, server processes, installs or child agents were created. Nothing requires test teardown or removal; only the named source/test files and this receipt are retained. No compatibility allocation exception was used. Protected account/employee/runtime/server/component/HLD/scaffolding files were not modified.
