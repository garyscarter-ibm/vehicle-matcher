// Greg demand and supply dashboard: mountGregDashboard(root, ctx) and <gcsp-greg-dashboard>. Figures come only from an
// adapter or a named fixture; location is never read. See docs/gcsp/greg-dashboard-contract.md.
import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { portalShell } from '../shell/portal-shell.js';
import { isRunRestarted, runRestartedScreen } from '../kit/run-restarted.js';
import { metricTile } from '../kit/metric-tile.js';
import { dataTable } from '../kit/data-table.js';
import { toDashboardView } from './demand-view.js';
import { fixtureAdapter } from './fixtures.js';
import { mountGregPublish } from './publish/panel.js';
import { mountGregOrderPlan } from './plan/panel.js';
import { mountGregComparison } from './comparison/panel.js';

const NOT_BUILT = 'Not available in this demo';
const item = (key, label, icon, available = false) => Object.freeze({
  key, label, icon: Object.freeze(icon), available, ...(available ? {} : { unavailableReason: NOT_BUILT }),
});

export const GREG_NAVIGATION = Object.freeze([
  item('dashboard', 'Demand and supply', ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M21 20H3'], true),
  item('publish', 'Publish stock', ['M12 16V4', 'M7 9l5-5 5 5', 'M5 20h14']),
  item('tracking', 'Order tracking', ['M3 7h11v9H3z', 'M14 10h4l3 3v3h-7', 'M7 19a1.5 1.5 0 1 0 0-.01', 'M17 19a1.5 1.5 0 1 0 0-.01']),
  item('next-order', 'Next order', ['M5 4h14v16H5z', 'M9 9h6', 'M9 13h6']),
]);

const ACCOUNT = Object.freeze({ status: 'ready', name: 'Greg', initials: 'GR', context: 'Scheme ordering lead, synthetic demo run' });
const FAILED_LOAD = { status: 'unavailable', message: 'The demand figures could not be loaded. Try again in a moment.' };
const REGIONS = Object.freeze([
  ['publish', 'publish', 'Publishing', 'Publishing controls are not built in this demo yet.'],
  ['orderTracking', 'order-tracking', 'Order tracking', 'Order tracking is not built in this demo yet.'],
  ['prediction', 'prediction', 'Prediction', 'The prediction panel is not built in this demo yet.'],
  ['routeComparison', 'route-comparison', 'Route comparison', 'Route comparison is not built in this demo yet.'],
  ['caseQueue', 'case-queue', 'Case queue', 'The scheme team case queue is not built in this demo yet.'],
]);
let uid = 0;

function note(text, role) {
  const p = el('p', 'gcsp-note', text);
  if (role) p.setAttribute('role', role);
  return p;
}

function section(name, title, className = '') {
  const node = el('section', `gcsp-greg-section${className ? ` ${className}` : ''}`);
  const heading = el('h2', 'gcsp-greg-h2', title);
  heading.id = `gcsp-greg-${name}-${++uid}`;
  node.dataset.section = name;
  node.setAttribute('aria-labelledby', heading.id);
  node.append(heading);
  return node;
}

const countTable = (caption, nameLabel, countLabel, list, emptyText) => dataTable({
  caption, emptyText,
  columns: [{ key: 'name', label: nameLabel }, { key: 'count', label: countLabel, numeric: true }],
  rows: list.map((row) => ({ name: row.label, count: row.count })),
});

function headlineSection(view) {
  const node = section('headline', 'At a glance');
  const row = el('div', 'gcsp-greg-headline');
  row.append(...view.headline.map((h) => metricTile({ label: h.label, count: h.count, level: 'headline' })));
  node.append(row);
  return node;
}

function demandSection(view) {
  const { demand } = view;
  const node = section('demand', 'Demand');
  node.append(note('What employees have saved and confirmed they need, one latest brief each. Each table groups the same briefs a different way.'));
  const tables = el('div', 'gcsp-greg-tables');
  tables.append(
    countTable('By model line', 'Model line', 'Briefs', demand.byModelLine, 'No briefs in this group yet'),
    countTable('By body style', 'Body style', 'Briefs', demand.byBody, 'No briefs in this group yet'),
    countTable('By fuel type', 'Fuel type', 'Briefs', demand.byFuel, 'No briefs in this group yet'),
  );
  const essentials = dataTable({
    caption: 'By essential requirement', emptyText: 'No essential requirements saved yet',
    columns: [{ key: 'name', label: 'Requirement' }, { key: 'state', label: 'State' }, { key: 'count', label: 'Briefs', numeric: true }],
    rows: demand.essentials.map((row) => ({ name: row.label, state: row.stateLabel, count: row.count })),
  });
  node.append(tables, essentials);
  return node;
}

// During a stock-source outage "no stock released" would be untrue, so the gate says the source is down.
const gateLabel = (view, row) => row.code !== 'no-released-stock' || !view.stock.sourceUnavailable ? row.label
  : view.stock.sourceStale ? 'Stock data too old to use' : 'Stock source unavailable';
function unmetSection(view) {
  const node = section('unmet', 'Unmet needs');
  node.append(note(view.meta.overlapNote), dataTable({
    caption: 'Briefs with no suitable car, by gate', emptyText: 'No unmet needs at this time',
    columns: [{ key: 'name', label: 'Gate' }, { key: 'effect', label: 'Effect' }, { key: 'count', label: 'Briefs', numeric: true }],
    rows: view.demand.unmetByGate.map((row) => ({ name: gateLabel(view, row), effect: row.severityLabel, count: row.count })),
  }));
  return node;
}

function offersSection(view) {
  const { offers } = view;
  const node = section('offers', 'Offers');
  node.append(note('Recorded outcomes of offers made. They are not predictions and not a measure of satisfaction.'));
  const tiles = el('div', 'gcsp-greg-tiles');
  tiles.append(...[offers.made, offers.accepted, offers.declined, offers.expired, offers.selected]
    .map((o) => metricTile({ label: o.label, count: o.count, level: 'standard' })));
  node.append(tiles, countTable('Declined offers, by reason', 'Reason', 'Declined', offers.declinedByReason, 'No declines with a recorded reason yet'));
  return node;
}

const stockCopy = Object.freeze({ sourceUnavailable: 'Stock source unavailable. Figures may be out of date.',
  sourceStale: 'Stock data too old to use. Figures may be out of date.', notChecked: "Couldn't check for new stock" });
function stockSection(view) {
  const node = section('stock', 'Stock');
  if (view.stock.sourceUnavailable) node.append(note(view.stock.sourceStale ? stockCopy.sourceStale : stockCopy.sourceUnavailable, 'status'));
  node.append(note('Released stock is open to employees. Held stock is reserved for an offer. Allocated stock is taken by a selection.'), dataTable({
    caption: 'Stock by model line', emptyText: view.stock.sourceUnavailable ? stockCopy.notChecked : 'No stock has been released yet',
    columns: [{ key: 'name', label: 'Model line' }, { key: 'released', label: 'Released', numeric: true },
      { key: 'held', label: 'Held', numeric: true }, { key: 'allocated', label: 'Allocated', numeric: true }],
    rows: view.stock.rows.map((row) => ({ name: row.label, released: row.released, held: row.held, allocated: row.allocated })),
  }));
  return node;
}

function noBriefsBody(view) {
  return [
    statusScreen({ kicker: 'Demand', title: 'No briefs yet',
      message: 'No employee has confirmed a brief yet, so there is no demand to show. Stock figures are still current.' }),
    stockSection(view),
  ];
}

function figuresBody(view) {
  const lower = el('div', 'gcsp-greg-grid');
  lower.append(unmetSection(view), stockSection(view));
  return [headlineSection(view), demandSection(view), lower, offersSection(view)];
}

function reservedRegions() {
  const host = el('div', 'gcsp-greg-regions');
  const regions = {};
  for (const [key, data, title, text] of REGIONS) {
    const node = section(data, title, 'gcsp-greg-region');
    node.dataset.region = data;
    node.append(note(text));
    host.append(node);
    regions[key] = node;
  }
  return { host, regions };
}

/**
 * Mount the dashboard in root. ctx: { loadDemand({ signal }) -> state, signal, onUnavailable(reason) }.
 * State: { status: 'ready', projection } | { status: 'conflict' | 'unavailable' | 'refused', message }.
 * Optional: orderPlanAdapter mounts the order plan panel (teardown.orderPlan.refresh()); comparisonAdapter mounts the route comparison (teardown.comparison.refresh()). Returns a teardown function with refresh() and regions { publish, orderTracking, prediction, routeComparison, caseQueue }.
 */
export function mountGregDashboard(root, ctx = {}) {
  const abort = new AbortController();
  const onExternalAbort = () => abort.abort();
  ctx.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (ctx.signal?.aborted) abort.abort();

  let done = false;
  let run = 0;
  let showing = false;
  const shell = portalShell({
    title: 'Group Car Schemes Portal', account: ACCOUNT, navigation: GREG_NAVIGATION, active: 'dashboard', breadcrumbs: ['Demand and supply'],
  });
  const page = el('div', 'vm gcsp-greg');
  const intro = screenIntro({ kicker: 'Scheme ordering', title: 'Demand and supply', level: 1, className: 'gcsp-intro',
    lede: 'What employees have saved and confirmed they need, set against released stock and the outcomes of offers.' });
  const bar = el('div', 'gcsp-greg-bar');
  const meta = el('div', 'gcsp-greg-meta');
  const refresh = button({ label: 'Refresh', variant: 'ghost', onClick: () => load() });
  bar.append(meta, refresh);
  const status = note('', 'status');
  status.classList.add('gcsp-greg-status');
  const body = el('div', 'gcsp-greg-body');
  const reserved = reservedRegions();
  page.append(intro, bar, status, body, reserved.host);
  shell.main.append(page);
  shell.setAccount(ACCOUNT);
  root.replaceChildren(shell.root);

  const retry = () => button({ label: 'Retry', variant: 'primary', onClick: () => load() });

  function drawMeta(m) {
    if (!m) { meta.replaceChildren(note('No figures loaded.')); return; }
    meta.replaceChildren(
      factList([
        { label: 'Figures for', value: m.asOfLabel },
        { label: m.policyVersions.length === 1 ? 'Policy version' : 'Policy versions', value: m.policyVersionsLabel },
        { label: m.briefVersions.length === 1 ? 'Brief version' : 'Brief versions', value: m.briefVersionsLabel },
        { label: 'Basis', value: m.basisLabel },
        { label: 'Figures version', value: m.projectionVersionShort },
      ], { className: 'gcsp-greg-facts' }),
      note(m.basisNote), note(m.privacyNote),
    );
  }

  function draw(state, view) {
    showing = state.status === 'ready';
    reserved.host.hidden = state.status === 'refused' || isRunRestarted(state);
    body.removeAttribute('aria-busy');
    drawMeta(view?.meta);
    if (view) {
      status.textContent = `Figures updated for ${view.meta.asOfText}.`;
      body.replaceChildren(...(view.flags.noBriefs ? noBriefsBody(view) : figuresBody(view)));
    } else if (isRunRestarted(state)) {
      status.textContent = 'Demo restarted.';
      body.replaceChildren(runRestartedScreen());
    } else if (state.status === 'refused') {
      status.textContent = 'Access refused.';
      body.replaceChildren(statusScreen({ kicker: 'Demand and supply', title: 'You cannot open this dashboard',
        message: state.message || 'Only the scheme ordering lead can open this dashboard.', role: 'alert' }));
    } else if (state.status === 'conflict') {
      status.textContent = 'The figures changed while loading.';
      body.replaceChildren(statusScreen({ kicker: 'Demand and supply', title: 'The figures changed while loading',
        message: state.message || 'The figures changed while they were loading. Use Refresh to load the latest.' }));
    } else {
      status.textContent = 'Figures unavailable.';
      body.replaceChildren(statusScreen({ kicker: 'Demand and supply', title: 'The demand figures are unavailable',
        message: state.message || FAILED_LOAD.message, actions: [retry()], role: 'alert' }));
    }
  }

  async function load() {
    const mine = ++run;
    const focusWasInBody = body.contains(root.ownerDocument.activeElement);
    if (showing) {
      body.setAttribute('aria-busy', 'true');
      status.textContent = 'Refreshing the figures.';
    } else {
      status.textContent = 'Loading the demand figures.';
      body.replaceChildren();
      body.setAttribute('aria-busy', 'true');
      drawMeta(null);
    }
    let state;
    let reason = null;
    if (typeof ctx.loadDemand !== 'function') {
      state = FAILED_LOAD;
      reason = 'no-adapter';
    } else {
      try {
        state = await ctx.loadDemand({ signal: abort.signal });
      } catch {
        state = FAILED_LOAD;
      }
      if (!state?.status) state = FAILED_LOAD;
      if (state.status === 'unavailable') reason = 'source-unavailable';
    }
    if (abort.signal.aborted || done || mine !== run) return;
    let view = null;
    if (state.status === 'ready') {
      try {
        view = toDashboardView(state.projection);
      } catch {
        state = FAILED_LOAD;
        reason = 'malformed-projection';
      }
    }
    if (reason) ctx.onUnavailable?.(reason);
    draw(state, view);
    if (focusWasInBody) refresh.focus();
  }

  const publishAdapter = ctx.publishAdapter || ctx.publish;
  const publishTeardown = publishAdapter ? mountGregPublish(reserved.regions.publish, { adapter: publishAdapter, signal: abort.signal }) : null;
  if (publishTeardown) {
    reserved.regions.publish.removeAttribute('aria-labelledby');
    reserved.regions.publish.setAttribute('aria-label', 'Preview and publish policy');
  }
  const planAdapter = ctx.orderPlanAdapter || ctx.orderPlan;
  const planTeardown = planAdapter ? mountGregOrderPlan(reserved.regions.prediction, { adapter: planAdapter, signal: abort.signal, onSubmitted: ctx.onOrderPlanSubmitted }) : null;
  if (planTeardown) {
    reserved.regions.prediction.removeAttribute('aria-labelledby');
    reserved.regions.prediction.setAttribute('aria-label', 'Next order plan');
  }
  const comparisonAdapter = ctx.comparisonAdapter || ctx.comparison;
  const comparisonTeardown = comparisonAdapter ? mountGregComparison(reserved.regions.routeComparison, { adapter: comparisonAdapter, signal: abort.signal }) : null;
  if (comparisonTeardown) {
    reserved.regions.routeComparison.removeAttribute('aria-labelledby');
    reserved.regions.routeComparison.setAttribute('aria-label', 'Route comparison');
  }
  const published = () => { load(); planTeardown?.refresh(); };
  root.addEventListener('gcsp:policy-published', published);
  load();

  function teardown() {
    if (done) return;
    done = true;
    abort.abort();
    ctx.signal?.removeEventListener('abort', onExternalAbort);
    publishTeardown?.();
    planTeardown?.();
    comparisonTeardown?.();
    root.removeEventListener('gcsp:policy-published', published);
    shell.destroy();
    root.replaceChildren();
  }
  teardown.refresh = load;
  teardown.regions = reserved.regions;
  teardown.orderPlan = planTeardown;
  teardown.comparison = comparisonTeardown;
  return teardown;
}

export class GcspGregDashboardElement extends HTMLElement {
  static get observedAttributes() { return ['fixture']; }

  constructor() {
    super();
    this._adapter = null;
    this._teardown = null;
  }

  get adapter() { return this._adapter; }

  set adapter(value) {
    this._adapter = value || null;
    if (this.isConnected) this._mount();
  }

  connectedCallback() { this._mount(); }

  disconnectedCallback() { this._unmount(); }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) this._mount();
  }

  _unmount() {
    this._teardown?.();
    this._teardown = null;
  }

  _emit(type, detail) {
    const Ev = this.ownerDocument.defaultView?.CustomEvent || CustomEvent;
    this.dispatchEvent(new Ev(type, { detail, bubbles: true, composed: true }));
  }

  _mount() {
    this._unmount();
    const fixtureName = this.getAttribute('fixture');
    const adapter = this._adapter || (fixtureName ? fixtureAdapter(fixtureName) : null);
    this._teardown = mountGregDashboard(this, {
      publishAdapter: this._adapter?.publish,
      orderPlanAdapter: this._adapter?.orderPlan,
      comparisonAdapter: this._adapter?.comparison,
      loadDemand: adapter ? (options) => adapter.loadDemand(options) : undefined,
      onUnavailable: (reason) => {
        this._emit('gcsp:unavailable', { reason: reason === 'no-adapter' && fixtureName ? 'unknown-fixture' : reason });
      },
    });
    this._emit('gcsp:ready', { view: 'dashboard' });
  }

  /** The mount nodes reserved for later stories, or null before mounting. */
  get regions() { return this._teardown?.regions ?? null; }

  /** Re-run loadDemand, as the Refresh button does. */
  refresh() { return this._teardown?.refresh(); }
}

/** Register <gcsp-greg-dashboard> once; safe to call again. */
export function defineGcspGregDashboard(registry = globalThis.customElements) {
  if (!registry) return null;
  const existing = registry.get('gcsp-greg-dashboard');
  if (existing) return existing;
  registry.define('gcsp-greg-dashboard', GcspGregDashboardElement);
  return GcspGregDashboardElement;
}
