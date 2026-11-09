import { el, screenIntro, button, statusScreen, factList } from '../../../vehicle-matcher/ui.js';
import { dataTable } from '../../kit/data-table.js';
import { rangeBar } from '../../kit/range-bar.js';
import { accessLapsedScreen } from '../../kit/run-restarted.js';
import { toComparisonView } from './comparison-view.js';
import * as copy from './comparison-copy.js';

const readView = (stored) => { try { return toComparisonView(stored); } catch { return null; } };
const heading = (text) => el('h3', 'gcsp-comparison-h3', text);

function measureBlock(m) {
  const block = el('article', 'gcsp-comparison-measure');
  const verdict = el('p', 'gcsp-comparison-verdict');
  verdict.append(el('span', 'gcsp-comparison-verdict-text', m.verdictText), el('span', 'gcsp-note', m.hint));
  block.dataset.verdict = m.verdict;
  block.append(heading(m.label), rangeBar({ label: copy.BAR_LABEL, rows: m.rows, scale: m.scale, format: m.format, level: 4 }),
    el('p', 'gcsp-comparison-difference', m.differenceText), verdict);
  return block;
}

function details(view, open, onToggle) {
  const node = el('details', 'gcsp-comparison-details'); node.open = open;
  node.addEventListener('toggle', () => onToggle(node.open));
  const p = view.provenance;
  node.append(el('summary', 'gcsp-comparison-summary', copy.DETAILS), dataTable({ caption: 'Assumptions used', emptyText: 'No assumptions were stored',
    columns: [{ key: 'key', label: 'Key' }, { key: 'value', label: 'Value' }, { key: 'unit', label: 'Unit' }, { key: 'status', label: 'Status' }, { key: 'basis', label: 'Basis' }],
    rows: view.assumptions }),
  factList([{ label: 'Seeds', value: p.seeds }, { label: 'Policy version', value: p.policyVersion }, { label: 'Policy hash', value: p.policyHash },
    { label: 'Generator version', value: p.generatorVersion }, { label: 'Code revision', value: p.codeRevision }, { label: 'Result id', value: p.resultId },
    { label: 'Made', value: p.made }, { label: 'Stored', value: p.stored }], { className: 'gcsp-comparison-facts' }));
  return node;
}

/** Greg's stored route comparison. mountGregComparison(root, { adapter, signal }) -> teardown with refresh(). adapter.load({ signal }) -> a state. */
export function mountGregComparison(root, { adapter, signal } = {}) {
  const abort = new AbortController();
  const stop = () => abort.abort(); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  let disposed = false; let gen = 0; let detailsOpen = false;
  const page = el('div', 'vm gcsp-comparison'); const status = el('p', 'gcsp-vh'); status.setAttribute('role', 'status');
  const body = el('div', 'gcsp-comparison-body');
  const reload = button({ label: 'Reload', variant: 'ghost', onClick: () => load() });
  page.append(status, body); root.replaceChildren(page);

  function ready(view) {
    const top = el('div', 'gcsp-comparison-head');
    top.append(screenIntro({ title: copy.TITLE, lede: copy.LEDE, level: 2 }), reload); reload.textContent = 'Reload';
    const m = view.meta;
    const parts = [top];
    if (view.oldPolicy) {
      const notice = el('div', 'gcsp-comparison-notice'); notice.setAttribute('role', 'status');
      notice.append(heading(copy.OLD_POLICY_TITLE), el('p', '', view.oldPolicy)); parts.push(notice);
    }
    parts.push(factList([{ label: 'Seeds', value: m.seeds }, { label: 'Policy version', value: m.policyVersion }, { label: 'Made', value: m.made },
      { label: 'Employees', value: m.employees }, { label: 'Code revision', value: m.codeRevision }].filter((f) => f.value != null), { className: 'gcsp-comparison-facts' }), el('p', 'gcsp-note gcsp-comparison-caveat', view.caveat));
    const grid = el('div', 'gcsp-comparison-measures'); grid.append(...view.measures.map(measureBlock));
    const leaves = el('section', 'gcsp-comparison-omits'); leaves.append(heading(copy.LEAVES_OUT));
    const list = el('ul', 'gcsp-comparison-list'); list.append(...view.limitations.map((t) => el('li', '', t))); leaves.append(list);
    parts.push(grid, leaves, details(view, detailsOpen, (open) => { detailsOpen = open; }));
    return parts;
  }
  function problem(title, message, role, retry) {
    reload.textContent = 'Retry';
    return statusScreen({ kicker: copy.TITLE, title, message, role, actions: retry ? [reload] : [] });
  }
  function empty() {
    const screen = statusScreen({ kicker: copy.TITLE, title: copy.EMPTY_TITLE, message: copy.EMPTY_LEAD, actions: [reload] }); reload.textContent = 'Reload';
    screen.querySelector('.vm-lede').append(el('code', 'gcsp-comparison-command', copy.EMPTY_COMMAND), copy.EMPTY_TAIL); return screen;
  }
  function draw(state, view) {
    if (view) return { name: 'ready', nodes: ready(view), text: 'Stored comparison loaded.' };
    if (state.status === 'empty') return { name: 'empty', nodes: [empty()], text: 'No stored comparison yet.' };
    if (state.status === 'refused') return { name: 'refused', nodes: [problem('You cannot open this comparison', copy.REFUSED, 'alert', false)], text: 'Access refused.' };
    if (state.status === 'access-required') return { name: 'access-required', nodes: [accessLapsedScreen()], text: 'Demo access needed.' };
    return { name: 'unavailable', nodes: [problem('The comparison is unavailable', copy.UNAVAILABLE, 'alert', true)], text: 'Comparison unavailable.' };
  }
  async function load() {
    const mine = ++gen; const keep = root.ownerDocument.activeElement === reload;
    if (page.dataset.state !== 'ready') {
      body.replaceChildren(statusScreen({ kicker: copy.TITLE, title: 'Loading the stored comparison' })); page.dataset.state = 'loading';
    }
    page.setAttribute('aria-busy', 'true'); status.textContent = 'Loading the stored comparison.';
    let state;
    try { state = (await adapter?.load?.({ signal: abort.signal })) ?? { status: 'unavailable' }; } catch { state = { status: 'unavailable' }; }
    if (disposed || abort.signal.aborted || mine !== gen) return;
    const view = state.status === 'ready' ? readView(state.stored) : null;
    const next = draw(state, view);
    body.replaceChildren(...next.nodes); page.dataset.state = next.name; page.removeAttribute('aria-busy'); status.textContent = next.text;
    if (keep) (body.contains(reload) ? reload : body.querySelector('h2'))?.focus();
  }

  load();
  return Object.assign(() => { disposed = true; gen += 1; abort.abort(); signal?.removeEventListener('abort', stop); root.replaceChildren(); }, { refresh: () => load() });
}
