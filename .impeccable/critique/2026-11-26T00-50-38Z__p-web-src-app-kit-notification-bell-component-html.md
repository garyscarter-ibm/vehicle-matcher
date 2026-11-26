---
target: FUCQ-566 responsive notification panel and note
total_score: 31
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 0
timestamp: 2026-11-26T00-50-38Z
slug: p-web-src-app-kit-notification-bell-component-html
---
Method: dual-agent (A: /root/scooby_doo/imhotep · B: /root/scooby_doo/foxy)

# FUCQ-566 notification disclosure critique

Target: `apps/gcsp-web/src/app/kit/notification-bell.component.html`. Final product source `c20879e04a2faf3d1bf479d7d9f04d3a76adc4da`; metadata refresh `67e86a3be` changes no relevant product/test path. Assessment A finished before Assessment B findings entered synthesis. This is the inherited F375 positioning repair, not a migration parity acceptance review.

## Design specificity and overall impression

The actual vehicle thumbnail, exact car description, reservation deadline and single “View your offer” action place the disclosure clearly within the employee car journey. Existing teal, white, grey, typography and kit spacing remain coherent with GCSP. The fix restores a complete mobile notification while preserving its established desktop relationship with the bell. No in-scope actionable design issue remains.

## Design health

| # | Heuristic | Score | Assessment |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Badge, waiting treatment and explicit empty state provide feedback. |
| 2 | Match with real world | 4 | Named car, reservation and deadline use employee language. |
| 3 | User control and freedom | 3 | Toggle, Escape, outside dismissal and account coordination retained. |
| 4 | Consistency and standards | 4 | Existing tokens, typography and disclosure conventions preserved. |
| 5 | Error prevention | 3 | One action opens the offer without committing a decision. |
| 6 | Recognition rather than recall | 4 | Thumbnail, exact car and deadline sit beside the action. |
| 7 | Flexibility and efficiency | 3 | Direct access and native keyboard interaction suit this disclosure. |
| 8 | Aesthetic and minimalist design | 4 | Clear title, compact content and one dominant action. |
| 9 | Error recovery | 3 | Plain unavailable copy and rereads retained; error state inspected in source. |
| 10 | Help and documentation | n/a | No separate help task applies to this single navigation disclosure. |
| | **Total** | **31/36** | **Good; scoped to the notification surface.** |

## What works

- At 375/390px, balanced eight-pixel panel margins restore the complete heading, loaded thumbnail, exact car description and 44px-high primary action. The note wraps naturally inside the viewport.
- At 1280px, the normal and realistic long account-name captures preserve the established bell/disclosure placement and readable empty state.
- The seven-line CSS change reuses spacing tokens, preserves component behavior and confines the altered containing block to the header below 600px.

## Cognitive load and emotional journey

Low cognitive load: zero of eight checklist failures. Single focus, chunking, grouping, hierarchy, one decision at a time, minimal choices, recognition and progressive disclosure all hold. The active notification offers one primary action; no notification decision presents more than four choices. The badge creates anticipation, the specific reserved car and deadline provide reassurance and urgency, and the clear action ends the sequence with a next step. The corrected viewport removes the impression of a broken alert. The persistent badge and reopenable panel support the transient note.

## Priority issues and detector evidence

No P0–P3 repair is requested; no in-scope actionable finding remains. Assessment B ran the markup detector once: exit2, one `broken-image` warning at component HTML line13 on the dynamic `[src]="row.image!.src"` binding. This is a static false positive for the observed state: the image is guarded by `@if(row.image?.src)`, actual captures show the BMW thumbnail, and the registered browser assertion verifies complete/naturalWidth>0. This does not prove every possible nonempty image URL loads.

## Persona checks

- Distracted mobile user: at 375/390px the complete offer and prominent action are visible without horizontal recovery.
- Keyboard/accessibility-dependent user: visible bell focus ring; source and registered tests retain native button/link, expanded state, associated heading, polite announcement, Escape and deliberate focus behavior. No independent screen-reader session was performed.
- Long-content stress user: Alexandra Cartwright-Llewellyn ellipsizes within the existing account treatment without moving the note/panel offscreen; empty state remains meaningful.

## Minor observations and review limits

The note is intentionally lighter than the panel, and disclosure overlap of underlying page content is expected. Neither warrants expanding this positioning repair. Assessment A inspected eight final captures and both historical 375px failures; Assessment B inspected the six final responsive panel/note captures and empty desktop state. The lead also critically inspected actual 375/390/1280 panel and 375 note captures. The registered actual Angular/Java/OIDC/nativePostgreSQL composition passed 6/6; 45 focused Angular and 135 ratchet tests passed, including the root's independent committed-source rerun.

No separate live browser/server was started or mutable detector script injected during critique, to preserve the single final composition run. No user-visible overlay or browser-console detector result is claimed. The evidence is actual rendered captures, source and registered behavior checks. No additional human decision, redesign or approval gate is required. No follow-up question is necessary for this bounded repair.
