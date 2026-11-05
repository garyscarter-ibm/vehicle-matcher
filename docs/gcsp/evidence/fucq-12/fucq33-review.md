# FUCQ-33 shared launcher review

Story DEV-2026-11-04-007, 5 November 2026. This record will retain the early representative design, final rendered review, validation and repeatable trial for the shared launcher. Employee integration remains FUCQ-35; default absence of registration is a tested unavailable state.

## Design reference and component plan

Follow the supplied shell/palette references in `docs/gcsp/screens/README.md` and the approved employee body at `docs/gcsp/evidence/fucq-6/README.md`, revision a7fc178 (Gary, 5 November). The lead inspected its representative desktop capture and canonical HLD launcher/migration/deployment exports. Match its readable hierarchy, neutral/teal surfaces, spacing and image treatment. The launcher has no employee shell or account facts.

Reuse el, screenIntro, button, mediaWell and semantic VM/GCSP tokens. Add experienceChoice and brandSelector as consumed shared primitives because existing result cards own exact-car decisions and question controls own answers. Catalogue, single gallery, styles and tests accompany consumers; checked external launcher modules replace inline index rendering. Preserve all six retail brands, mounts and context, plus the FUCQ-31 kit and FUCQ-97 outbox additions.

## Planned trial

Serve with `npm run serve` plus `npm run server`, open `/` for the launcher. Select a brand and open Used cars; use `?experience=used-cars` for the retained picker and legacy `?brand=mini` for its shell. Explicit `?experience=launcher&brand=mini` must show MINI without changing it for employee coverage. Employee defaults unavailable until a real enabled mount is registered. Reset by reloading the initial URL.

Review desktop and 320px, all brands, no brand, unsupported and unavailable recovery, keyboard/focus, reduced motion, failed imagery/logos, loading and long names; inspect actual supported routing and context. Browser receipts identify source hashes and isolated owned processes. Final screenshots and findings follow below.

## Early rendered review

The representative design was rendered and reviewed before the second implementation slice, at source commit `bc2e358b245fc6a78f3814ebf4cdf78b37899fa4`. The lead directly inspected `fucq33-early-default-desktop.png` and `fucq33-early-mini-narrow-320.png`; all four captures and the measurements remain in `fucq33-early-browser.json` as historical evidence. The two destination cards balance at desktop and stack at 320px, both labels remain visible, all imagery loads, and no horizontal overflow, browser error or failed request was observed.

Two decisions followed this review. Keep the explicit Choose BMW step, including when employee integration is unavailable: it changes the visible selection only after the visitor acts, and then exposes the disabled employee action with an explanation. Refine the initial retail-blue/BMW typography to the approved GCSP body language: system typography, normal-case headings, neutral surfaces and teal actions. Extract the consumed GCSP primitive styling into the shared kit so launcher and employee body share the same source.

Source review also found that rebuilding recovery links from the raw employee URL could reintroduce retail fields stripped by the entry resolver. The second slice uses the resolver's canonical safe location and adds a direct-entry regression; this preserves the existing routing boundary.
