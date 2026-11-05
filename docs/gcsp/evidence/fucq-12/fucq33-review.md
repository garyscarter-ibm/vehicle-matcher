# FUCQ-33 shared launcher review

Story DEV-2026-11-04-007, 5 November 2026. This record will retain the early representative design, final rendered review, validation and repeatable trial for the shared launcher. Employee integration remains FUCQ-35; default absence of registration is a tested unavailable state.

## Design reference and component plan

Follow the supplied shell/palette references in `docs/gcsp/screens/README.md` and the approved employee body at `docs/gcsp/evidence/fucq-6/README.md`, revision a7fc178 (Gary, 5 November). The lead inspected its representative desktop capture and canonical HLD launcher/migration/deployment exports. Match its readable hierarchy, neutral/teal surfaces, spacing and image treatment. The launcher has no employee shell or account facts.

Reuse el, screenIntro, button, mediaWell and semantic VM/GCSP tokens. Add experienceChoice and brandSelector as consumed shared primitives because existing result cards own exact-car decisions and question controls own answers. Catalogue, single gallery, styles and tests accompany consumers; checked external launcher modules replace inline index rendering. Preserve all six retail brands, mounts and context, plus the FUCQ-31 kit and FUCQ-97 outbox additions.

## Planned trial

Serve with `npm run serve` plus `npm run server`, open `/` for the launcher. Select a brand and open Used cars; use `?experience=used-cars` for the retained picker and legacy `?brand=mini` for its shell. Explicit `?experience=launcher&brand=mini` must show MINI without changing it for employee coverage. Employee defaults unavailable until a real enabled mount is registered. Reset by reloading the initial URL.

Review desktop and 320px, all brands, no brand, unsupported and unavailable recovery, keyboard/focus, reduced motion, failed imagery/logos, loading and long names; inspect actual supported routing and context. Browser receipts identify source hashes and isolated owned processes. Final screenshots and findings follow below.
