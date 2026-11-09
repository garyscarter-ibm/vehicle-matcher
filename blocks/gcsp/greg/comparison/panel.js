import { el, screenIntro, button, statusScreen } from '../../../vehicle-matcher/ui.js';
import { accessLapsedScreen } from '../../kit/run-restarted.js';
import { toComparisonView } from './comparison-view.js';
import { processParts } from './result-parts.js';
import { mountExperimentPanel } from './experiment-panel.js';
import * as copy from './comparison-copy.js';

const readView = (stored) => { try { return toComparisonView(stored); } catch { return null; } };

/** Greg's stored route comparison. mountGregComparison(root, { adapter, signal, pollMs }) -> teardown with refresh(). adapter.load({ signal }) -> a state; an adapter with loadAll runs the experiment panel. */
export function mountGregComparison(root, { adapter, signal, pollMs = 2000 } = {}) {
  if (typeof adapter?.loadAll === 'function') return mountExperimentPanel(root, { adapter, signal, pollMs });
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
    return [top, ...processParts(view, detailsOpen, (open) => { detailsOpen = open; })];
  }
  function problem(title, message, role, retry) {
    reload.textContent = 'Retry';
    return statusScreen({ kicker: copy.TITLE, title, message, role, actions: retry ? [reload] : [] });
  }
  function empty() {
    const screen = statusScreen({ kicker: copy.TITLE, title: copy.EMPTY_TITLE, message: copy.EMPTY_NOTE, actions: [reload] }); reload.textContent = 'Reload'; return screen;
  }
  function draw(state, view) {
    if (view) return { name: 'ready', nodes: ready(view), text: 'Stored comparison loaded.' };
    if (state.status === 'empty') return { name: 'empty', nodes: [empty()], text: 'No stored comparison yet.' };
    if (state.status === 'refused') return { name: 'refused', nodes: [problem('You cannot open this comparison', copy.REFUSED, 'alert', false)], text: 'Access refused.' };
    if (state.status === 'access-required') return { name: 'access-required', nodes: [accessLapsedScreen()], text: 'Access needed.' };
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
