# FUCQ-103 keyboard row selection — source-only proposal, 6 November 2026

**One candidate selected; unrun. F103 remains In Review, full acceptance incomplete.** Replace only the existing happy-path automated row setup with keyboard type-ahead of the target option's unique visible label, followed by Tab. Continue the existing keyboard 1200 edit, Preview and intentional Publish. This is a proposed scenario input, not a passing result, new acceptance criterion, product repair or execution grant.

## Remaining original evidence gap

The [desktop report](current-presenter-1727.md) and [320px report](current-presenter-narrow-1725.md) already support actual Tab access/visible focus, exact keyboard editing, Preview/Publish, held terms, Greg refresh and ordinary employee uptake. The narrow run also supplies changed fit/demand, stale rejection and non-Greg refusal. Reuse those observations and the retained service/HTTP/kit evidence rather than replaying them to obtain another broad result.

The particular missing observation is **a keyboard-driven change of the native published-points row reaching the corresponding exact points input**. Both happy paths used `selectOption(row.id)` as disclosed automated setup. The JSDOM row-retention check assigns `select.value` and dispatches `change`; it proves application response to selection, not browser keyboard selection. This is a residual limit on the original general keyboard-operability criterion, not evidence that the developed product is inoperable.

## Source and retained-input basis

| Inspected source/record | What it establishes |
| --- | --- |
| `blocks/gcsp/greg/publish/panel.js:119–126` | Creates an ordinary single native `select`, in policy price-field order, with a label and one `change` listener calling `selectPrice`. No custom combobox or panel key handler is present. |
| `blocks/gcsp/greg/publish/panel.js:10–11,59–66` | Defines visible option text; selection projects the row's retained value, metadata and slider into the same exact input. |
| `blocks/gcsp/shell/portal-shell.js:222–231` | The shell key handler acts on Escape; it supplies no row-selection key mapping. This does not prove operating-system/browser behavior. |
| `server/test/gcsp-greg-publish-render.test.js:51–58` | Row retention is driven by assigned values and synthetic change events; it is not native-key proof. Read only; not rerun. |
| Retained `continuation-1725/browser-runner.mjs:420–453` | Existing `tabTo` records actual active element and focus styling. `desktopHappyPath` then uses `selectOption` before existing `Meta+A`, keyboard typing, Tab/Enter Preview and Publish. The proposed replacement belongs only at that row-setup step. |
| Saved narrow `output/results.json`, first retained policy projection | 147 price options; initial `.001`; target index 14, `price:price.choices-fs-uk.015`, value 1100. The exact visible label below occurs once. These are saved inputs, not a new policy read. |

Exact target label: `choices-fs-uk · eligibilityModelKey: G21 Touring|320i`.

The panel and shell bytes currently match across shared `gcsp-poc`, the F103 worktree and the read-only F100 worktree used by the retained browser scenario:

- panel SHA256: `2cf184fa428bce237114ee0b71fe61c778f996338090596ccb580951543016ec`;
- shell SHA256: `3ab99dadb1c5b58e038474339b2759c7cbcb118cbdff79cbb44e050b7a2ad64e`;
- retained narrow runner SHA256: `5dbda91a016c68aad4f1b4b3bcb04e13750b21c8a4d83bb94b5d3e7f142b2990`.

Local runner/input base: shared `.claude/test-runs/fucq103/current-presenter-1718/continuation-1725/`; saved projection is in `journey-narrow320-2adc9d69fc694a9c979042fb1c597b94/output/results.json`. No retained runner, input, output or receipt was edited.

## One proposed input replacement

Use the existing initial `tabTo(page, select)`. Read the options to verify that the projected target label occurs exactly once and that the initial row differs from the target. Then replace the `selectOption` call and its setup-only report with the following **unexecuted scenario sketch**:

```js
const targetLabel = 'choices-fs-uk · eligibilityModelKey: G21 Touring|320i';
await page.keyboard.type(targetLabel, { delay: 20 });
await page.keyboard.press('Tab');
assert.equal(await select.inputValue(), row.id);
assert.equal(await points(page).inputValue(), String(row.value));
```

The proposed input uses the retained runner's existing keyboard API and the actual visible label rather than a numeric option index. Type-ahead plus Tab is the sole candidate; it has not been established to work in the retained macOS/headless Chrome configuration. In particular, native handling of the common prefix, spaces and middle dot is unknown here. Source inspection cannot turn that platform behavior into a pass.

If selected for separately authorised execution, use only the existing 320×900 initial happy-path steps through published readback. Retain the existing next `tabTo(page, points(page))`, keyboard `Meta+A`/`1200`, Preview and Publish actions. Stop before `actualEmployee` and omit `narrowRemaining`; reuse their existing consumer/adverse evidence. Observe the selected row ID, projected 1100 value and visible focus before editing; the preview difference must still identify this row at 1200 before publication. Keep the original row-selection failure and successful service/consumer evidence separate. This candidate would add only evidence for this particular row interaction, not complete every keyboard interaction or narrow-table scrolling.

Use no mouse selection, `selectOption`, assigned `.value` or dispatched synthetic event for the row change under observation. If the proposed input does not establish the expected selection, record that inability and stop that candidate; this proposal contains no fallback sequence or automatic retry. Nothing in this document makes this exact sequence a closure gate.

## Preserved disposition and boundaries

The historical desktop Home/14×ArrowDown/Enter failure and narrow Space/ArrowDown/Enter failure remain unchanged. Narrow before/after was `.015`, expected `.016`; the final assertion made that overall run INCOMPLETE/exit 1. Neither sequence establishes a confirmed product fault. The desktop scoped-pass receipt remains SHA256 `5619f2950bd5f8d5bf636d702bbcd279d122acc0e6556426779f264f13ecfc0d`; narrow incomplete receipt remains `b6314533bfb01d2dc32c32ea08eb82105b99245c83a59a661fcc8f2d8a07fdc3`.

The required npm result stays **1569 passed / 16 failed / 5 skipped, exit 1**. F144/F146 remain independent unrepaired backlog defects. The six original ACs, Result and shared In Review disposition are unchanged. No Done, suite-pass claim, new feature/AC, native F96/actual-producer gate or defect repair is introduced.

Read for this source-only selection: current `AGENTS.md`; `docs/gcsp/build-rules.md` (Demo delivery and scope control); `docs/gcsp/experience-quality.md`; agreed shell/body direction in `docs/gcsp/screens/README.md`; and `COMPONENTS.md`. The candidate changes no component or visual treatment. Equal collaborator authority, actual-severity triage and the child-422 diagnostic rule continue to apply.

Only this proposal document was created. No test, browser, app/runtime, service, scratch, reservation, product source, scenario runner, claim, agent, Jira state or product-map state was created or changed by this continuation.
