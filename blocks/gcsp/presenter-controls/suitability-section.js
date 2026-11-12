import { el, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { dataTable } from '../kit/data-table.js';
import { labelledField } from '../kit/form-controls.js';
import { loadingSkeleton } from '../kit/loading-skeleton.js';
import { friendlyTime } from '../kit/friendly-time.js';
import { fieldLabel, reasonText } from '../kit/plain-copy.js';

let sequence = 0;
const allocationOrder = (rule) => ({
  renewalDueThenFitThenSeededLottery: 'Earlier renewal date, then better fit, then a repeatable draw to break a tie.',
  fitThenRenewalDueThenSeededLottery: 'Better fit, then earlier renewal date, then a repeatable draw to break a tie.',
})[rule] ?? 'The allocation order is not available.';
const passed = (cell) => cell.gateStatus === 'eligible' && !cell.blockers?.length;
const scoreText = (cell) => cell.state === 'evaluated' && passed(cell) && cell.score !== null ? `${cell.score}/100` : '–';
const explanation = (entry, kind) => {
  if (entry.code === 'declined-unchanged') return 'This car was declined and the brief has not changed.';
  if (entry.code === 'renewal-deadline-unknown') return 'The renewal date is not confirmed, so this Buddy could not enter the allocation.';
  return reasonText(entry, kind).replace(/\bYour\b/g, 'The employee’s').replace(/\byour\b/g, 'the employee’s')
    .replace(/\bYou are\b/g, 'The employee is').replace(/\bYou have\b/g, 'The employee has').replace(/\bYou do not have\b/g, 'The employee does not have');
};
const checkLabel = (cell) => cell.state !== 'evaluated' ? 'Not evaluated'
  : cell.blockers?.length || cell.gateStatus === 'ineligible' ? 'Blocked'
    : cell.gateStatus === 'needs-confirmation' ? 'Needs confirmation' : cell.score === null ? 'Passed · unscored' : 'Passed checks';

/** A lazy disclosure after Allocation. All scores and outcomes come from the presenter projection. */
export function mountSuitabilitySection(parent, { adapter } = {}) {
  const id = `gcsp-suitability-${++sequence}`;
  const root = el('section', 'gcsp-suitability');
  const disclosure = el('details');
  const summary = el('summary', 'gcsp-suitability-summary');
  const title = el('h2', '', 'Car suitability'); title.id = `${id}-title`;
  summary.append(title, ' ', el('span', 'gcsp-suitability-summary-note', 'Why a Buddy did or didn’t match'));
  root.setAttribute('aria-labelledby', title.id);
  const content = el('div', 'gcsp-suitability-content');
  const tools = el('div', 'gcsp-suitability-tools');
  const select = el('select', 'gcsp-select');
  for (const [value, label] of [['all', 'All releases'], ['latest', 'Latest release']]) {
    const option = el('option', '', label); option.value = value; select.append(option);
  }
  const refreshButton = button({ label: 'Refresh suitability', variant: 'ghost', onClick: () => refresh() });
  tools.append(labelledField({ id: `${id}-release`, label: 'Released cars', control: select }).root, refreshButton);
  const live = el('p', 'gcsp-suitability-note');
  const body = el('div', 'gcsp-suitability-body');
  content.append(tools, live, body); disclosure.append(summary, content); root.append(disclosure); parent.append(root);
  let disposed = false; let generation = 0; let request = null; let runId = null; let page = 1; let buddyPage = 1;
  let value = null; let selected = null; let dirty = true; let pendingFocus = null; let clockVersion;

  function setLoading() {
    generation += 1; request?.abort.abort(); request = null; dirty = true;
    controlsDisabled(false);
    value = null; body.replaceChildren();
    if (disclosure.open) {
      body.setAttribute('aria-busy', 'true');
      body.append(loadingSkeleton({ label: 'Loading car suitability', layout: 'section' }));
    }
  }
  function controlsDisabled(disabled) { select.disabled = disabled; refreshButton.disabled = disabled; }
  function person(employeeId) { return [...value.buddies, ...(value.people ?? [])].find((row) => row.id === employeeId)?.name ?? 'another employee'; }
  function cellStatus(car, cell) {
    if (cell.state === 'evaluated' && passed(cell) && cell.outcome?.state === 'assigned') {
      return cell.outcome.employeeId === cell.employeeId ? 'Matched in this check' : `Matched to ${person(cell.outcome.employeeId)}`;
    }
    const blocker = cell.blockers?.[0];
    if (blocker) {
      const short = { 'charging-unavailable': 'No charging access', 'allowance-exceeded': 'Over allowance',
        'policy-exclude': 'Outside scheme', 'declined-unchanged': 'Declined unchanged', 'renewal-deadline-unknown': 'Renewal date unknown',
        'essential-unmet': `${fieldLabel(blocker.field)} requirement`, 'required-by': 'Too late', 'driver-ineligible': 'Driver not eligible' }[blocker.code];
      if (short) return `Blocked · ${short}`;
    }
    return checkLabel(cell);
  }
  function requirements(entries, kind) {
    const list = el('ul', 'gcsp-suitability-checks');
    for (const entry of entries ?? []) {
      const item = el('li', '', explanation(entry, kind));
      const required = entry.requirement;
      if (required?.value !== undefined) {
        const operator = { atLeast: 'at least', gte: 'at least', min: 'at least', eq: 'is', in: 'one of', lte: 'at most', atMost: 'at most' }[required.operator] ?? '';
        item.append(el('span', 'gcsp-suitability-note', ` ${fieldLabel(entry.field)} ${operator} ${[].concat(required.value).join(', ')}${required.unit && required.unit !== 'count' ? ` ${required.unit}` : ''}.`));
      }
      list.append(item);
    }
    return list;
  }
  function paintDetails(target) {
    target.replaceChildren();
    if (!selected) { target.append(el('p', 'gcsp-suitability-note', 'Select any cell to explain the Buddy’s decision.')); return; }
    const car = value.cars.find((row) => row.id === selected.car);
    const buddy = value.buddies.find((row) => row.id === selected.buddy);
    const cell = car?.cells.find((row) => row.employeeId === selected.buddy);
    if (!cell || !buddy) { selected = null; paintDetails(target); return; }
    const heading = el('h3', '', `${car.name} · ${buddy.name}`); heading.id = `${id}-detail-title`;
    target.setAttribute('aria-labelledby', heading.id);
    target.append(heading, el('p', 'gcsp-suitability-detail-score', `${scoreText(cell)} · ${checkLabel(cell)}`));
    if (cell.state !== 'evaluated') {
      target.append(el('p', '', 'No recorded evaluation for this car and Buddy. It may have been reserved already, outside this employee’s scheme, or released before this Buddy engaged. No fit score is available.'));
    } else {
      if (cell.outdated) target.append(el('p', 'gcsp-suitability-warning', 'Earlier result. The brief, permission, employee details or policy has changed since this check.'));
      if (passed(cell)) target.append(el('p', '', cell.score === null
        ? 'The required checks passed. This decision did not produce a numeric fit score.'
        : 'The required checks passed. Fit ranks preferences; passing does not guarantee an offer.'));
      target.append(requirements(cell.blockers, 'blockers'));
      if (cell.unknowns?.length) { target.append(el('h4', '', 'Information gaps'), requirements(cell.unknowns, 'unknowns')); }
      if (cell.reasons?.length) { target.append(el('h4', '', 'Recorded checks and preferences'), requirements(cell.reasons, 'reasons')); }
      const outcome = cell.outcome;
      target.append(el('h4', '', 'Allocation at this check'), el('p', '', outcome?.state === 'assigned'
        ? `This car was matched to ${person(outcome.employeeId)}.` : outcome?.state === 'assigned-other-car'
          ? 'This Buddy was matched to another car in this check.' : 'This check did not produce a match for this pair.'));
      target.append(el('p', 'gcsp-suitability-note', `Recorded order: ${allocationOrder(cell.recorded.allocationRule)}`));
      target.append(el('p', 'gcsp-suitability-note', `Checked ${friendlyTime(cell.recorded.evaluatedAt) ?? 'at an unknown time'} · Brief ${cell.recorded.briefVersion ?? 'unknown'} · Policy ${cell.recorded.policyVersion ?? 'unknown'}`));
    }
    const current = car.availability;
    target.append(el('h4', '', 'Car now'), el('p', '', current.state === 'available' ? 'Available on the scheme.'
      : ['reserved', 'allocated'].includes(current.state) ? `${current.state === 'reserved' ? 'Reserved for' : 'Allocated to'} ${current.employeeName}${current.route === 'manual' ? ' through a manual selection' : ' through Buddy'}.`
        : 'Currently unavailable.'));
  }
  function pager(axis, label) {
    const meta = value.paging[axis]; const nav = el('nav', 'gcsp-suitability-pager'); nav.setAttribute('aria-label', `${label} pages`);
    for (const [direction, amount] of [['Previous', -1], ['Next', 1]]) {
      const key = `${axis}-${direction}`;
      const action = button({ label: `${direction} ${label.toLowerCase()}`, variant: 'ghost',
        disabled: amount < 0 ? meta.page <= 1 : meta.page >= meta.pages,
        onClick: () => { if (axis === 'cars') page = meta.page + amount; else buddyPage = meta.page + amount;
          selected = null; pendingFocus = key; refresh(); } });
      action.dataset.pageAction = key;
      nav.append(action);
      if (amount < 0) nav.append(el('span', '', `${label}: ${meta.page} of ${meta.pages} · ${meta.total} total`));
    }
    return nav;
  }
  function paint() {
    body.removeAttribute('aria-busy'); body.replaceChildren();
    const pass = el('div', 'gcsp-suitability-pass');
    pass.append(el('h3', '', 'What counts as a pass?'), el('p', '', 'No minimum fit score is set. The required scheme, allowance, practical, charging, timing and current-car checks must pass.'),
      el('p', 'gcsp-suitability-note', `Allocation order: ${allocationOrder(value.policy.allocationRule)}`),
      el('p', 'gcsp-suitability-note', 'Fit is out of 100, not the chance of an offer. Blocked and unevaluated cars have no fit score to compare.'));
    body.append(pass);
    live.textContent = `${value.paging.cars.total} released cars · ${value.paging.buddies.total} engaged ${value.paging.buddies.total === 1 ? 'Buddy' : 'Buddies'} · Latest recorded check per pair`;
    if (!value.cars.length || !value.buddies.length) {
      body.append(statusScreen({ title: !value.cars.length ? 'No cars released yet' : 'No engaged Buddies', level: 3,
        message: !value.cars.length ? 'Release cars to see their recorded suitability.' : 'The matrix appears when an employee engages Buddy.', role: null })); return;
    }
    const table = dataTable({ caption: 'Released cars × engaged Buddies', captionHidden: true,
      columns: [{ key: 'car', label: 'Released car' }, ...value.buddies.map((buddy) => ({ key: buddy.id, label: buddy.name, detail: `Brief ${buddy.briefVersion}` }))],
      rows: value.cars.map((car) => ({ car: car.name })) });
    table.classList.add('gcsp-suitability-table');
    const details = el('section', 'gcsp-suitability-details'); details.id = `${id}-details`; details.setAttribute('aria-live', 'polite');
    const buttons = [];
    [...table.querySelectorAll('tbody tr')].forEach((row, index) => {
      const car = value.cars[index];
      row.firstChild.append(el('span', 'gcsp-suitability-car-note', [car.colour, car.orderNumber ? `Order ${car.orderNumber}` : null].filter(Boolean).join(' · ')));
      row.firstChild.append(el('span', 'gcsp-suitability-car-note', car.availability.state === 'available' ? 'Available' : car.availability.state === 'reserved' ? 'Reserved' : car.availability.state === 'allocated' ? 'Allocated' : 'Unavailable'));
      [...row.querySelectorAll('td')].forEach((td, at) => {
        const cell = car.cells[at]; const buddy = value.buddies[at];
        const action = button({ label: scoreText(cell), variant: 'ghost', onClick: () => {
          selected = { car: car.id, buddy: buddy.id };
          for (const item of buttons) item.button.setAttribute('aria-pressed', String(item.car === car.id && item.buddy === buddy.id));
          paintDetails(details);
        } });
        action.classList.add('gcsp-suitability-cell'); action.dataset.status = passed(cell) ? 'passed' : cell.state === 'evaluated' ? 'blocked' : 'unknown';
        action.setAttribute('aria-label', `${car.name}, order ${car.orderNumber ?? car.id}, ${buddy.name}: ${scoreText(cell)}, ${cellStatus(car, cell)}${cell.outdated ? ', earlier result' : ''}`);
        action.setAttribute('aria-controls', details.id);
        action.setAttribute('aria-pressed', String(selected?.car === car.id && selected?.buddy === buddy.id));
        action.append(el('span', 'gcsp-suitability-cell-note', cellStatus(car, cell)));
        if (cell.outdated) action.append(el('span', 'gcsp-suitability-cell-note', 'Earlier result'));
        td.replaceChildren(action); buttons.push({ button: action, car: car.id, buddy: buddy.id });
      });
    });
    paintDetails(details);
    const pages = el('div', 'gcsp-suitability-pages'); pages.append(pager('cars', 'Cars'), pager('buddies', 'Buddies'));
    body.append(table, pages, details);
    if (pendingFocus) {
      const next = [...body.querySelectorAll('[data-page-action]')].find((node) => node.dataset.pageAction === pendingFocus);
      (next?.disabled ? next.parentNode.querySelector('button:not(:disabled)') ?? table : next ?? table).focus(); pendingFocus = null;
    }
  }
  async function refresh() {
    if (disposed) return;
    if (!disclosure.open) { dirty = true; return; }
    if (request) return request.promise;
    const mine = ++generation; const abort = new AbortController();
    const entry = { abort }; request = entry; controlsDisabled(true);
    body.setAttribute('aria-busy', 'true'); live.setAttribute('role', 'status'); live.textContent = 'Loading car suitability';
    body.replaceChildren(loadingSkeleton({ label: 'Loading car suitability', layout: 'section' }));
    entry.promise = (async () => {
      let reply;
      try { reply = await adapter.readSuitability({ page, buddyPage, release: select.value, signal: abort.signal }); } catch { reply = { status: 'unavailable' }; }
      if (disposed || mine !== generation) return;
      request = null; controlsDisabled(false); body.removeAttribute('aria-busy');
      if (reply?.status !== 'ok' || runId && reply.value?.runId !== runId) {
        value = null; selected = null; dirty = true; live.textContent = '';
        body.replaceChildren(statusScreen({ title: 'Car suitability unavailable', message: 'Refresh the presenter readback or try again.', level: 3, role: null,
          actions: [button({ label: 'Retry suitability', onClick: () => refresh() })] })); return;
      }
      value = reply.value; runId = value.runId; page = value.paging.cars.page; buddyPage = value.paging.buddies.page;
      dirty = false; paint();
    })();
    return entry.promise;
  }
  function update(state, { refresh: read = true } = {}) {
    if (disposed) return;
    if (runId && state.runId !== runId) {
      selected = null; page = 1; buddyPage = 1; select.value = 'all'; disclosure.open = false; setLoading();
    } else if (clockVersion !== undefined && state.clockVersion !== undefined && state.clockVersion !== clockVersion) setLoading();
    runId = state.runId; clockVersion = state.clockVersion; dirty = true;
    if (read) return refresh();
  }
  select.addEventListener('change', () => { page = 1; buddyPage = 1; selected = null; refresh(); });
  disclosure.addEventListener('toggle', () => { if (disclosure.open && dirty) refresh(); });
  return { root, update, refresh, setLoading,
    destroy() { disposed = true; generation += 1; request?.abort.abort(); root.remove(); } };
}
