import { el, screenIntro, button, statusScreen, factList } from '../../../vehicle-matcher/ui.js';
import { renderRangeSlider } from '../../../vehicle-matcher/modes/question-ui.js';
import { labelledField, errorSummary } from '../../kit/form-controls.js';
import { dataTable } from '../../kit/data-table.js';
import { isRunRestarted, runRestartedNotice } from '../../kit/run-restarted.js';
import { metricTile } from '../../kit/metric-tile.js';
import { toPlanView, toChanges, staleView } from './plan-view.js';
import { quantityLabel } from './plan-copy.js';

let sequence = 0;
const UNAVAILABLE = 'The order plan could not be loaded. Try again in a moment.';
const note = (text, extra = '') => el('p', `gcsp-note${extra ? ` ${extra}` : ''}`, text);
const whole = (v) => /^\d+$/.test(String(v).trim()) && Number.isSafeInteger(Number(v));
const bullets = (items) => { const ul = el('ul', 'gcsp-plan-list'); for (const text of items) ul.append(el('li', '', text)); return ul; };
// Long-text tables scroll sideways inside their own region at narrow widths instead of squeezing words.
const wideTable = (region) => { region.classList.add('gcsp-plan-wide'); return region; };
const readView = (value) => { try { return toPlanView(value); } catch { return null; } };

/** Greg's order plan panel. mountGregOrderPlan(root, { adapter, signal, onSubmitted, commandId }) -> teardown with refresh(). */
export function mountGregOrderPlan(root, { adapter, signal, onSubmitted, commandId = () => globalThis.crypto.randomUUID() } = {}) {
  const abort = new AbortController();
  const stop = () => abort.abort(); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const base = `gcsp-plan-${++sequence}`;
  let disposed = false; let gen = 0; let busy = false;
  let current = null; let shown = null; let previewChanges = []; let stale = null; let pending = null; let submitOk = false;
  let heading; let staleHeading; let lockable = [];
  let draft = []; let fields = []; let meta = []; let sliders = []; let summary; let limitsHeading; let previewButton; let resetButton; let submitButton;
  const page = el('div', 'vm gcsp-plan');
  const top = el('div', 'gcsp-plan-top');
  const message = note('', 'gcsp-plan-message'); message.setAttribute('role', 'status');
  const submitHost = el('div', 'gcsp-plan-submit');
  const content = el('div', 'gcsp-plan-content');
  const editor = el('div', 'gcsp-plan-editor');
  page.append(top, message, submitHost, content, editor); root.replaceChildren(page);

  function sync() {
    for (const f of fields) f.input.disabled = busy;
    for (const s of sliders) s();
    for (const b of lockable) b.disabled = busy;
    if (previewButton) previewButton.disabled = busy;
    if (resetButton) resetButton.disabled = busy;
    if (submitButton) submitButton.disabled = busy || !submitOk;
    page.setAttribute('aria-busy', String(busy));
  }
  function setState(name, text) { page.dataset.state = name; if (text !== undefined) message.textContent = text; sync(); }
  const begin = (text) => { gen += 1; busy = true; message.textContent = text; sync(); return gen; };
  const gone = (mine) => disposed || abort.signal.aborted || mine !== gen;
  async function call(method, input) {
    try { return (await adapter?.[method]?.({ ...input, signal: abort.signal })) ?? { status: 'unavailable', message: UNAVAILABLE }; }
    catch { return { status: 'unavailable', message: UNAVAILABLE }; }
  }
  const locked = (node) => { lockable.push(node); node.disabled = busy; return node; };
  const nameOf = (view) => (stale ? 'stale' : view.kind === 'ready' ? (view.submission?.status ?? 'ready') : view.kind);

  // Editor: native whole-number inputs, a slider per derivative maximum, and the budget in pounds.
  function numberInput(suffix, label, value, onInput) {
    const input = el('input', ''); input.type = 'number'; input.min = '0'; input.step = '1'; input.value = value;
    const wrapped = labelledField({ id: `${base}-${suffix}`, label, control: input });
    const field = { input, wrapped }; fields.push(field);
    input.addEventListener('input', () => { wrapped.setError(''); onInput(input.value); if (shown?.preview) message.textContent = 'Limits changed. Preview again to see the effect.'; });
    return field;
  }
  function addSlider(line, row, maxField, baselineMax) {
    const host = el('div', 'gcsp-plan-slider');
    const range = { id: `${maxField.input.id}-slider`, label: `${row.label} maximum`, min: 0, max: Math.max(10, baselineMax * 2), step: 1, unit: ' vehicles' };
    const api = renderRangeSlider(host, range, {}, { single: true, value: Number(row.max), valueState: 'confirmed', ariaLabel: `${row.label} maximum slider`,
      onValueChange(value) { maxField.input.value = String(value); row.max = String(value); maxField.wrapped.setError(''); if (shown?.preview) message.textContent = 'Limits changed. Preview again to see the effect.'; } });
    const sliderSync = () => {
      const value = whole(row.max) ? Number(row.max) : null; const within = value !== null && value <= range.max;
      api.update({ value: within ? value : null, valueState: within ? 'confirmed' : 'unknown', disabled: busy || !within });
    };
    sliders.push(sliderSync); sliderSync(); line.append(host);
    return sliderSync;
  }
  function boundsGroup(group, gi) {
    const wrap = el('div', 'gcsp-plan-group'); wrap.setAttribute('role', 'group');
    const title = el('h4', 'gcsp-plan-h4', group.label); title.id = `${base}-g${gi}`; wrap.setAttribute('aria-labelledby', title.id); wrap.append(title);
    const baseline = current.limits.find((g) => g.key === group.key);
    group.rows.forEach((row, i) => {
      const line = el('div', 'gcsp-plan-limit'); line.setAttribute('role', 'group');
      const name = el('p', 'gcsp-plan-limit-name', row.label); name.id = `${base}-g${gi}-r${i}`; line.setAttribute('aria-labelledby', name.id);
      let slide;
      const min = numberInput(`g${gi}-r${i}-min`, 'Min', row.min, (v) => { row.min = v; });
      const max = numberInput(`g${gi}-r${i}-max`, 'Max', row.max, (v) => { row.max = v; slide?.(); });
      line.append(name, min.wrapped.root, max.wrapped.root);
      if (group.idField === 'derivativeId') slide = addSlider(line, row, max, Number(baseline?.rows[i]?.max) || 0);
      meta.push({ row, min, max }); wrap.append(line);
    });
    return wrap;
  }
  function budgetGroup(group, gi) {
    const wrap = el('div', 'gcsp-plan-group');
    const field = numberInput(`g${gi}-budget`, `${group.label} (pounds)`, group.pounds, (v) => { group.pounds = v; });
    meta.push({ budget: group, field }); wrap.append(field.wrapped.root);
    return wrap;
  }
  function buildEditor() {
    fields = []; meta = []; sliders = [];
    draft = current.limits.map((g) => (g.kind === 'budget' ? { ...g, pounds: String(g.pounds) }
      : { ...g, rows: g.rows.map((r) => ({ ...r, min: String(r.min), max: String(r.max) })) }));
    limitsHeading = el('h3', 'gcsp-plan-h3', 'Change limits'); limitsHeading.id = `${base}-limits`; limitsHeading.tabIndex = -1;
    summary = errorSummary({ id: `${base}-errors`, onSelect: (id) => (fields.find((f) => f.input.id === id)?.input ?? limitsHeading).focus() });
    previewButton = resetButton = null;
    if (!draft.length) { editor.replaceChildren(limitsHeading, note('No limits can be changed for this plan.')); return; }
    const actions = el('div', 'gcsp-plan-actions');
    previewButton = button({ label: 'Preview with these limits', variant: 'ghost', onClick: () => runPreview() });
    resetButton = button({ label: 'Reset limits', variant: 'ghost', onClick: () => { buildEditor(); resetButton.focus(); setState(page.dataset.state, 'Limits reset to the current plan.'); } });
    actions.append(previewButton, resetButton);
    editor.replaceChildren(limitsHeading, note('Change a limit, then preview the effect. Previewing saves and orders nothing.'), summary.root,
      ...draft.map((g, gi) => (g.kind === 'budget' ? budgetGroup(g, gi) : boundsGroup(g, gi))), actions);
    sync();
  }
  function validate() {
    const errors = []; for (const f of fields) f.wrapped.setError('');
    const bad = (field, text) => { field.wrapped.setError(text); errors.push({ id: field.input.id, message: text }); };
    for (const m of meta) {
      if (m.budget) { if (!whole(m.budget.pounds)) bad(m.field, 'Budget: enter a whole number of pounds, zero or more.'); continue; }
      const ok = { min: whole(m.row.min), max: whole(m.row.max) };
      for (const edge of ['min', 'max']) if (!ok[edge]) bad(m[edge], `${m.row.label} ${edge === 'min' ? 'minimum' : 'maximum'}: enter a whole number, zero or more.`);
      if (ok.min && ok.max && Number(m.row.min) > Number(m.row.max)) bad(m.max, `${m.row.label}: the minimum is higher than the maximum.`);
    }
    summary.update(errors); return errors.length === 0;
  }
  function showReasons(reply) {
    const reasons = reply.reasons?.length ? reply.reasons.map((r) => r.reason) : [reply.message];
    summary.update(reasons.map((text) => ({ id: limitsHeading.id, message: text }))); summary.focus();
    setState(page.dataset.state, reply.message);
  }

  // Sections of the plan view.
  function banner(kind, title, ...children) {
    const box = el('div', `gcsp-plan-banner is-${kind}`); const h = el('h3', 'gcsp-plan-h3', title); h.tabIndex = -1;
    box.append(h, ...children); return { box, h };
  }
  function banners(view) {
    const out = [];
    if (view.preview) {
      const { box } = banner('preview', 'Preview', note(view.previewMessage), locked(button({ label: 'Back to current plan', variant: 'ghost', onClick: backToCurrent })));
      out.push(box);
    }
    if (view.kind === 'infeasible') {
      const box = banner('danger', 'Limits that conflict').box; box.setAttribute('role', 'alert');
      box.append(bullets(view.conflicts.map((c) => `${c.label}: ${c.detail}`))); out.push(box);
    }
    const s = view.submission;
    if (s) {
      const done = s.status === 'replanned';
      out.push(banner('info', done ? 'Replanned after a Production response' : 'Requested from Production',
        note(done ? `Replanned after ${s.after ?? 'a Production response'}${s.afterAtLabel ? ` at ${s.afterAtLabel}` : ''}.`
          : `Requested${s.submittedAtLabel ? ` at ${s.submittedAtLabel}` : ''}. Production has not confirmed anything yet. See Order tracking.`)).box);
    }
    if (stale) {
      const made = banner('warning', stale.title, note(stale.message), bullets(stale.changed.map((c) => c.label)),
        locked(button({ label: stale.replanLabel, variant: 'primary', onClick: replan })));
      made.box.setAttribute('role', 'alert'); staleHeading = made.h; out.push(made.box);
    }
    return out;
  }
  function submitRow(view) {
    const reason = stale ? 'Replan before requesting.'
      : view.kind === 'infeasible' ? 'Change the limits to get a plan you can request.'
        : view.kind === 'no-demand' ? 'There is nothing to request yet.'
          : view.submission?.status === 'submitted' ? 'Already requested. Track it under Order tracking.'
            : !view.canSubmit ? 'The plan recommends no new order, so there is nothing to request.' : '';
    const text = note(reason || 'Nothing is ordered until Production confirms.', 'gcsp-plan-consequence'); text.id = `${base}-consequence`;
    submitOk = !reason;
    submitButton = button({ label: view.canSubmit ? `Request ${quantityLabel(view.orderQuantity)} from Production` : 'Request from Production',
      variant: 'primary', describedBy: text.id, onClick: () => runSubmit() });
    const row = el('div', 'gcsp-plan-submit-row'); row.append(submitButton, text); return [row];
  }
  function body(view) {
    const v = view.versions;
    const out = [factList([{ label: 'Forecast source', value: v.forecast.qualifier ? `${v.forecast.label} (${v.forecast.qualifier})` : v.forecast.label }, { label: 'Policy version', value: v.policy },
      { label: 'Plan for', value: v.asOfLabel }], { className: 'gcsp-plan-facts' })];
    if (v.forecast.note) out.push(note(v.forecast.note));
    if (view.kind === 'infeasible') return out;
    if (view.note) { out.push(note(view.note)); return out; }
    const d = view.differences;
    if (d) {
      out.push(dataTable({ caption: 'Differences from the current plan', emptyText: 'No quantity changes', columns: [{ key: 'name', label: 'Derivative' },
        { key: 'current', label: 'Current', numeric: true }, { key: 'preview', label: 'Preview', numeric: true }, { key: 'change', label: 'Change', numeric: true }],
      rows: d.lines.filter((l) => l.changed).map((l) => ({ name: l.name, current: l.current, preview: l.preview ?? 0, change: l.changeLabel })) }),
      dataTable({ caption: 'Outcome before and after', columns: [{ key: 'name', label: 'Measure' }, { key: 'before', label: 'Current', numeric: true }, { key: 'after', label: 'Preview', numeric: true }],
        rows: [['Acceptable coverage', d.coverage], ['Unmatched supply', d.risk], ['Spend', d.spend]].map(([name, p]) => ({ name, before: p.before, after: p.after })) }), note(d.summary));
    }
    out.push(dataTable({ caption: 'Proposed order', emptyText: 'No derivatives in this plan', columns: [{ key: 'model', label: 'Model' },
      { key: 'derivative', label: 'Derivative' }, { key: 'quantity', label: 'Quantity', numeric: true }],
    rows: [...view.lines].sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0)).map((l) => ({ model: l.model, derivative: l.derivative, quantity: l.quantity })) }),
    dataTable({ caption: 'Order totals by model', emptyText: 'No models in this plan', columns: [{ key: 'model', label: 'Model' }, { key: 'quantity', label: 'Quantity', numeric: true }],
      rows: view.models.map((m) => ({ model: m.model, quantity: m.quantity })) }));
    const tiles = el('div', 'gcsp-tile-row');
    tiles.append(metricTile({ label: 'Acceptable coverage before renewal', count: view.coverage?.short, note: view.coverage?.label, level: 'compact' }),
      metricTile({ label: 'Unallocated-stock risk', count: view.unallocatedRisk?.short, note: view.unallocatedRisk?.label, level: 'compact' }),
      metricTile({ label: 'Spend', count: view.spend, note: `${quantityLabel(view.orderQuantity)} in this order`, level: 'compact' }));
    out.push(tiles);
    if (view.unallocatedRisk?.sources.length) {
      out.push(dataTable({ caption: 'Unmatched supply by source', columns: [{ key: 'name', label: 'Source' }, { key: 'quantity', label: 'Vehicles', numeric: true }],
        rows: view.unallocatedRisk.sources.map((s) => ({ name: s.label, quantity: s.quantity })) }));
    }
    const unmet = el('section', 'gcsp-plan-section'); const uh = el('h3', 'gcsp-plan-h3', 'Unmet needs'); uh.id = `${base}-unmet`; unmet.setAttribute('aria-labelledby', uh.id);
    unmet.append(uh);
    if (!view.unmetNeeds.length) unmet.append(note('No unmet needs at this time'));
    for (const need of view.unmetNeeds) {
      const item = el('div', 'gcsp-plan-need'); item.append(el('p', 'gcsp-plan-need-name', need.label), bullets(need.reasons));
      if (need.blockedBy.length) item.append(note(`Held back by: ${need.blockedBy.join(', ')}`));
      unmet.append(item);
    }
    out.push(unmet,
      dataTable({ caption: 'Binding constraints', emptyText: 'No limit is holding this plan back', columns: [{ key: 'label', label: 'Constraint' }, { key: 'detail', label: 'Detail' }],
        rows: view.binding.map((c) => ({ label: c.label, detail: c.detail })) }),
      wideTable(dataTable({ caption: 'Alternative plans', emptyText: 'No alternative plan is available', columns: [{ key: 'label', label: 'Plan' }, { key: 'same', label: 'Compared' }, { key: 'summary', label: 'What it does' }],
        rows: view.alternatives.map((a) => ({ label: a.label, summary: a.summary, same: a.status !== 'feasible' ? 'Not possible' : a.sameAsRecommended ? 'Same as the recommendation' : 'Different' })) })));
    return out;
  }
  function draw(focus) {
    const view = shown; lockable = []; staleHeading = null;
    const intro = screenIntro({ kicker: view.preview ? 'Preview' : 'Next order', title: view.action, level: 2 });
    heading = intro.querySelector('h2'); heading.tabIndex = -1;
    top.replaceChildren(intro, ...banners(view)); submitHost.replaceChildren(...submitRow(view)); content.replaceChildren(...body(view));
    setState(nameOf(view)); if (focus) (staleHeading ?? heading).focus();
  }

  // Loading, previewing and submitting. A generation counter drops answers that a newer request has replaced.
  function failure(reply) {
    const refused = reply?.status === 'refused'; const restarted = isRunRestarted(reply);
    if (!refused && !restarted && current) { setState(page.dataset.state, reply?.message || UNAVAILABLE); return; }
    current = shown = null; stale = null; lockable = []; submitHost.replaceChildren(); content.replaceChildren(); editor.replaceChildren(); fields = []; sliders = [];
    const retry = refused || restarted ? [] : [locked(button({ label: 'Retry', variant: 'primary', onClick: () => load() }))];
    top.replaceChildren(restarted ? runRestartedNotice().root : statusScreen({ kicker: 'Next order', title: refused ? 'You cannot open this plan' : 'The order plan is unavailable',
      message: reply?.message || UNAVAILABLE, actions: retry, role: 'alert' }));
    if (restarted) setState('restarted', 'Demo restarted.'); else setState(refused ? 'refused' : 'unavailable', refused ? 'Access refused.' : 'Order plan unavailable.');
  }
  async function load(announce) {
    const mine = begin('Loading the order plan.');
    if (!current) {
      top.replaceChildren(screenIntro({ kicker: 'Next order', title: 'Loading the next order', level: 2 }));
      submitHost.replaceChildren(); content.replaceChildren(); editor.replaceChildren(); page.dataset.state = 'loading';
    }
    const reply = await call('readPlan', {});
    if (gone(mine)) return;
    busy = false;
    const view = reply.status === 'ready' ? readView(reply.value) : null;
    if (!view || view.preview) { failure(reply.status === 'ready' ? { status: 'unavailable', message: UNAVAILABLE } : reply); return; }
    current = shown = view; previewChanges = []; stale = null; buildEditor(); draw(Boolean(announce));
    message.textContent = announce || `Order plan updated for ${view.versions.asOfLabel ?? 'now'}.`;
  }
  async function previewWith(changes) {
    const mine = begin('Calculating the preview. Nothing is saved or ordered.');
    const reply = await call('previewPlan', { changes });
    if (gone(mine)) return;
    busy = false;
    if (reply.status === 'ready') {
      const view = readView(reply.value);
      if (!view?.preview) { setState(page.dataset.state, UNAVAILABLE); return; }
      shown = view; previewChanges = changes; stale = null; summary.update([]); draw(true);
      message.textContent = view.kind === 'infeasible' ? 'No plan meets these limits.' : 'Preview ready. Nothing is saved or ordered.';
    } else if (reply.status === 'invalid') { showReasons(reply); } else if (reply.status === 'replan-needed') { stale = staleView(reply); draw(true); } else { failure(reply); }
  }
  function runPreview() {
    if (busy || !current) return;
    if (!validate()) { summary.focus(); return; }
    const changes = toChanges(draft, current.limits);
    if (!changes.length) { setState(page.dataset.state, 'Change at least one limit before previewing.'); return; }
    return previewWith(changes);
  }
  function backToCurrent() {
    if (busy || !current) return;
    shown = current; previewChanges = []; stale = null; draw(true); message.textContent = 'Showing the current plan.';
  }
  function replan() { if (!busy) return shown?.preview ? previewWith(previewChanges) : load('Replanned with the latest inputs.'); }
  async function runSubmit() {
    if (busy || !submitOk || !shown?.canSubmit) return;
    const payload = shown.submit; const key = JSON.stringify(payload);
    if (pending?.key !== key) pending = { key, id: commandId() };
    const mine = begin('Sending the request to Production.');
    const reply = await call('submitPlan', { commandId: pending.id, planId: payload.planId, versions: payload.versions, changes: payload.changes });
    if (disposed || abort.signal.aborted) return;
    if (reply.status === 'ready') {
      onSubmitted?.(reply.value);
      if (mine === gen) await load(reply.value?.message || 'Requested. Production has not confirmed any of this yet.');
      return;
    }
    if (mine !== gen) return;
    busy = false;
    if (reply.status === 'replan-needed') { stale = staleView(reply); draw(true); setState('stale', stale.summary); } else if (reply.status === 'invalid') { showReasons(reply); } else if (reply.status === 'refused' || isRunRestarted(reply)) { failure(reply); } else {
      setState(page.dataset.state, `${reply.message || UNAVAILABLE} Your request is kept. Press the button again to retry safely.`);
    }
  }

  load();
  return Object.assign(() => { disposed = true; gen += 1; abort.abort(); signal?.removeEventListener('abort', stop); root.replaceChildren(); }, { refresh: () => load() });
}
