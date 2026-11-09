# GCSP review tickets, 9 Nov 2026

Raised by the dispatcher from the FUCQ-247 performance review (docs/gcsp/performance-review-2026-11-09.md) and the
FUCQ-248 UI and UX review (docs/gcsp/ux-review-2026-11-09.md). One ticket per recommendation, deduplicated across
the two reviews. Fixes are Bugs; anything that would change agreed direction is a separate Story labelled
`proposal` and `needs-review`, for collaborator review and prioritisation before build. Nothing here is built yet.

Merged or skipped: UX finding 19 and performance R2-4 (Greg's Next order 503) are FUCQ-265, already being fixed.
UX finding 20 and performance R2-2 (stored comparison for the demo) are one ticket. Performance R1-5 and R2-3 (tick
blocks, readback size) are one ticket. Performance R1-2 (compression) is folded into R1-3, because Render already
serves Brotli.

| Ticket | Source | Type | Priority | Summary |
|---|---|---|---|---|
| FUCQ-265 | UX 19, perf R2-4 | Bug | Highest (Critical) | Greg's Next order never loads in Decline then change |
| FUCQ-267 | UX 1 | Bug | High | Internal codes, ids and raw timestamps on Paula's screens |
| FUCQ-268 | UX 2 | Bug | High | Brief shows "0%" fit badges and "Body style: 0% fit." as a reason the car suits her |
| FUCQ-269 | UX 3 | Bug | High | After Decline, the change question is below the fold and focus is at the bottom |
| FUCQ-270 | UX 4 | Bug | High | The offer page dead-ends after the change and after acceptance |
| FUCQ-271 | UX 5 | Bug | Medium | The acceptance screen shows two progress lists that disagree |
| FUCQ-272 | UX 6 | Bug | Medium | Reset leaves the presenter on a blank page with focus lost |
| FUCQ-273 | UX 6p | Story | Low | Proposal: Reset leaves the presenter on a blank page with focus lost |
| FUCQ-274 | UX 7p | Story | Low | Proposal: The open presenter strip is a 1,250 px wall that hides the page |
| FUCQ-275 | UX 8 | Bug | Medium | On a phone the offer is 3,800 px long and Accept is at the very bottom |
| FUCQ-276 | UX 8p | Story | Low | Proposal: On a phone the offer is 3,800 px long and Accept is at the very bottom |
| FUCQ-277 | UX 9 | Bug | Medium | "Not supplied" and internal prose crowd every card |
| FUCQ-278 | UX 10 | Bug | High | In Main successful journey every manual reservation fails with the wrong reason |
| FUCQ-279 | UX 11 | Bug | Medium | Car names and image fallbacks differ from screen to screen |
| FUCQ-280 | UX 12 | Bug | Medium | Focus on arrival is inconsistent, and the arrival ring looks like a stray box |
| FUCQ-281 | UX 13p | Story | Low | Proposal: Review and order review: five actions and two clocks |
| FUCQ-282 | UX 14 | Bug | Medium | Setup: two-step save and system-voice messages |
| FUCQ-283 | UX 14p | Story | Low | Proposal: Setup: two-step save and system-voice messages |
| FUCQ-284 | UX 15 | Bug | Medium | The page shell shifts between screens |
| FUCQ-285 | UX 16 | Bug | Medium | Live regions announce too much |
| FUCQ-286 | UX 17 | Bug | Medium | Heading levels skip |
| FUCQ-287 | UX 18 | Bug | Medium | The bare host address shows raw JSON |
| FUCQ-288 | UX 20 | Bug | High | The route comparison shows a terminal command instead of a result |
| FUCQ-289 | UX 21 | Bug | High | Greg's policy panel is a wall of source notes and internal keys |
| FUCQ-290 | UX 22 | Bug | High | Next order: the request lands upward, then the plan contradicts it |
| FUCQ-291 | UX 23 | Bug | High | The offer email reads as a system message |
| FUCQ-292 | UX 24 | Bug | High | Pages don't update after the presenter acts |
| FUCQ-293 | UX 25 | Bug | Medium | Greg's dashboard opens on four "fewer than 5" boxes and runs 7,600 px |
| FUCQ-294 | UX 25p | Story | Low | Proposal: Greg's dashboard opens on four "fewer than 5" boxes and runs 7,600 px |
| FUCQ-295 | UX 26 | Bug | Medium | The route comparison has no headline answer |
| FUCQ-296 | UX 26p | Story | Low | Proposal: The route comparison has no headline answer |
| FUCQ-297 | UX 27 | Bug | Medium | Renewal cases: a form stack for Greg, a hidden button for Paula |
| FUCQ-298 | UX 27p | Story | Low | Proposal: Renewal cases: a form stack for Greg, a hidden button for Paula |
| FUCQ-299 | UX 28 | Bug | Medium | Order progress: a stale next step and a wall of return buttons |
| FUCQ-300 | UX 29 | Bug | Medium | After an uncertain handoff is refused, the page still says "Offer accepted" |
| FUCQ-301 | UX 30 | Bug | Medium | The hosted /gcsp-greg.html is the fixture harness |
| FUCQ-302 | perf R1-1 | Bug | High | Memory repository deep-copies the whole demo state on every API call, so every click waits 0.2 to 2.4 s |
| FUCQ-303 | perf R1-3 | Story | Medium | Make GCSP static assets cacheable (ETag and no-cache) and compress them on the local host |
| FUCQ-304 | perf R1-4 | Story | Medium | Gallery fetches the 960 KB manual stock twice for 6 cards, mostly repeated copies |
| FUCQ-305 | perf R1-5 | Story | Medium | Tick, Reset and Next release block the event loop for up to 2.7 s, and the controls readback grows to 160 KB |
| FUCQ-306 | perf R1-6 | Story | Low | Presenter strip re-mounts and re-reads on every screen change |
| FUCQ-307 | perf R1-7 | Story | Low | Trim each GCSP page's CSS and JS graph and lazy-load per screen |
| FUCQ-308 | perf R1-8 | Task | Low | Re-measure GCSP memory on Node 20 before any change to the Render plan |
| FUCQ-309 | perf R2-1 | Bug | Medium | Default 1,000-employee comparison runs out of worker heap in 3 of 3 runs after about 3 minutes |
