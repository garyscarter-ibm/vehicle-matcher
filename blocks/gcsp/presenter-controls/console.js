import { el, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { tabs } from '../kit/tabs.js';
import { loadingSkeleton } from '../kit/loading-skeleton.js';
import { isRunRestarted, runRestartedScreen } from '../kit/run-restarted.js';
import { createPresenterHttpAdapter } from './http-adapter.js';
import { mountPresenterControls } from './controls.js';
import { mountReleaseSection } from './release-section.js';
import { mountHappenedFeed } from './happened-feed.js';
import { dayBar } from './day-bar.js';

export const PRESENTER_CONSOLE_MODE_KEY = 'gcsp:presenter-console-mode';
const ACTION_KEY = 'gcsp:presenter-action'; // Same signal the controller writes, so open portal tabs refresh.
const NO_SESSION = ['forbidden', 'missing-session', 'expired-session'];
const TITLE = 'Presenter console';
const PORTAL = () => new URL('../../../gcsp-account.html', import.meta.url).href;
const LOGO = () => new URL('../../../assets/brand-logos/bmwgroup-bmw-mini.svg', import.meta.url).href;
// Only sentences reach the screen: kebab-case codes and long text are dropped or cut.
const sentence = (value) => { const text = typeof value === 'string' ? value.trim() : ''; return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(text) ? '' : text.slice(0, 160); };
let sequence = 0;

// Moves the controller's own nodes into tab panels; returns null (nothing moved) if any piece is missing.
function regroup(controller) {
  const all = (selector) => [...controller.querySelectorAll(selector)];
  const buttons = all('button');
  const named = (label) => buttons.find((node) => node.textContent === label);
  const tick = buttons.find((node) => node.textContent === 'Tick' || node.textContent.startsWith('Tick ('));
  const picker = (legend) => all('fieldset.gcsp-presenter-picker').find((node) => node.querySelector('legend')?.textContent === legend);
  const fold = (label) => all('details.gcsp-presenter-fold').find((node) => [...node.children].find((c) => c.tagName === 'SUMMARY')?.textContent.startsWith(label));
  const actions = controller.querySelector('.gcsp-presenter-actions');
  const piece = {
    actions, tick, reset: named('Reset scenario'), toGreg: named('Reset and switch to Greg'), confirmation: controller.querySelector('.gcsp-presenter-confirmation'),
    proceed: named('Continue to workspace'), scenario: picker('Scenario'), availability: controller.querySelector('[id^="presenter-availability-"]'),
    next: named('Next release'), nextReason: controller.querySelector('[id^="presenter-release-"]'), toTarget: named('Tick to target'),
    target: controller.querySelector('.gcsp-presenter-group .gcsp-field'), times: controller.querySelector('datalist'),
    principal: picker('Acting principal'), switchPrincipal: named('Switch principal'), fresh: named('Issue selected principal again'),
    retry: named('Retry original action'), faults: fold('Faults'), lastTick: fold('Last tick'), refresh: named('Refresh readback'),
    facts: controller.querySelector('.gcsp-presenter-facts'), notice: controller.querySelector('.gcsp-run-restarted'),
  };
  const statuses = actions ? [...actions.children].filter((node) => node.matches('p.gcsp-note[role="status"]')) : [];
  if (Object.values(piece).some((node) => !node) || statuses.length !== 2) return null;
  const panel = (...nodes) => { const node = el('div', 'gcsp-presenter-group'); node.append(...nodes); return node; };
  const empty = el('p', 'gcsp-note gcsp-console-empty', 'No fault switches reported');
  piece.faults.open = true; piece.lastTick.open = true;
  const items = [
    { id: 'scenario', label: 'Scenario', panel: panel(piece.scenario, piece.availability, piece.reset, piece.toGreg, piece.confirmation, piece.proceed) },
    { id: 'clock', label: 'Clock', panel: panel(piece.tick, piece.next, piece.nextReason, piece.target, piece.times, piece.toTarget) },
    { id: 'people', label: 'People', panel: panel(piece.principal, piece.switchPrincipal, piece.fresh) },
    { id: 'faults', label: 'Faults', panel: panel(piece.faults, empty) },
    { id: 'last-tick', label: 'Last tick', panel: panel(piece.lastTick, piece.refresh) },
  ];
  const set = tabs({ label: 'Advanced controls', items });
  const recovery = el('div', 'gcsp-console-recovery'); recovery.append(piece.retry);
  actions.replaceChildren(...statuses, piece.notice, piece.facts, recovery, set.root);
  return { tabs: set, reset: piece.reset };
}

/** Standalone presenter console. Returns { root, basic, setMode(mode), destroy, ready }; `basic` is { update({ headline, sub, clock, primary: { label, disabled, reason } }), setStatus(text), release, startAgain }.
 * onRelease(ctx) / onStartAgain(ctx) replace the default handlers (ctx = { adapter, state, basic, setMode, commandId, tick, refresh }); onState(state, basic) runs after each controls read. */
export function mountPresenterConsole(host, { adapter = createPresenterHttpAdapter(), commandId = () => globalThis.crypto.randomUUID(), reload, navigate,
  storage, onRelease, onStartAgain, onState } = {}) {
  const win = host.ownerDocument.defaultView; const abort = new AbortController();
  const store = () => { try { return storage ?? win.sessionStorage; } catch { return null; } };
  let disposed = false; let busy = false; let loaded = false; let state; let mode = 'basic'; let controller = null; let group = null; let watcher = null; let watchTimer = null;
  let headlineSupplied = false; let loading = true; let applied = 0; let disabledSupplied; let reasonSupplied; let defaultDisabled = true; let defaultReason = '';
  const id = `gcsp-console-${++sequence}`;
  const root = el('div', 'gcsp-console'); if (!host.closest('.gcsp')) root.classList.add('gcsp');

  const logo = el('img'); logo.src = LOGO(); logo.alt = ''; logo.setAttribute('width', '88'); logo.setAttribute('height', '24');
  const brand = el('div', 'gcsp-console-brand'); brand.append(logo, el('span', '', 'Group Car Schemes'), el('strong', '', 'Presenter'));
  const clockSlot = el('div', 'gcsp-console-time'); clockSlot.setAttribute('aria-live', 'polite'); clockSlot.hidden = true;
  const dayText = el('span', 'gcsp-console-day'); const clock = el('span', 'gcsp-console-clock'); clockSlot.append(dayText, clock);
  const toggle = el('button', 'gcsp-console-mode', 'Advanced'); toggle.type = 'button'; toggle.setAttribute('aria-pressed', 'false');
  const head = el('header', 'gcsp-console-head'); head.append(brand, clockSlot, toggle);

  const headline = el('h1'); headline.id = `${id}-title`; const sub = el('p', 'gcsp-console-sub'); sub.hidden = true;
  const text = el('div', 'gcsp-console-text'); text.append(headline, sub);
  const screen = el('div', 'gcsp-console-screen');
  const release = button({ label: "Release tomorrow's cars", variant: 'primary', disabled: true, onClick: () => runRelease() });
  const startAgain = button({ label: 'Start again', variant: 'ghost', onClick: () => runStartAgain() });
  const link = el('a', 'gcsp-console-link', 'Open the portal'); link.href = PORTAL(); link.target = '_blank'; link.rel = 'noopener';
  const actions = el('div', 'gcsp-console-actions'); actions.append(release, startAgain, link);
  const reasonText = el('p', 'gcsp-console-reason'); reasonText.id = `${id}-reason`; reasonText.hidden = true;
  const status = el('p', 'gcsp-console-status'); status.setAttribute('role', 'status');
  const stage = el('section', 'gcsp-console-stage'); stage.setAttribute('aria-labelledby', headline.id);
  const skeleton = loadingSkeleton({ label: 'Loading the presenter console', layout: 'console' }); stage.dataset.loading = '';
  const week = dayBar();
  stage.append(skeleton, text, screen, actions, week.root, reasonText, status);
  const releaseSection = mountReleaseSection(stage, { adapter }); // After the Start again confirmation, before the feed.
  const feed = mountHappenedFeed(stage, { adapter, storage: store() });

  const advancedHost = el('div', 'gcsp-console-controls');
  const advancedNote = el('p', 'gcsp-note', 'Loading presenter controls');
  const advancedTitle = el('h2', 'gcsp-console-vh', 'Advanced controls');
  const advanced = el('section', 'gcsp-console-advanced'); advanced.hidden = true; advanced.append(advancedTitle, advancedNote, advancedHost);
  const main = el('main', 'gcsp-console-main'); main.append(stage, advanced);
  root.append(head, main); host.replaceChildren(root);

  // The skeleton stands in for the whole Basic body until a final headline exists, so no interim heading is ever painted.
  function endLoading() { if (!loading) return; loading = false; skeleton.remove(); delete stage.dataset.loading; }
  function fallbackHeading() { if (!headlineSupplied) headline.textContent = state?.currentScenario?.name || TITLE; }

  function paintPrimary() {
    const unavailable = disabledSupplied ?? defaultDisabled;
    release.disabled = busy || !loaded || unavailable;
    const why = loaded && unavailable ? (reasonSupplied ?? defaultReason) : '';
    reasonText.textContent = why; reasonText.hidden = !why;
    if (why) release.setAttribute('aria-describedby', reasonText.id); else release.removeAttribute('aria-describedby');
  }
  const basic = {
    update({ headline: title, sub: line, clock: time, week: days, primary } = {}) {
      const named = title !== undefined;
      if (named) { headlineSupplied = true; headline.textContent = title || TITLE; }
      if (line !== undefined) { sub.textContent = line || ''; sub.hidden = !line; }
      if (time !== undefined) {
        // "Day 2 · Tue 10 Nov, 11:30am" reads as a muted day and a bold clock, as in the mockup.
        const [day, at] = (time || '').includes(' · ') ? time.split(' · ') : ['', time || ''];
        dayText.textContent = day; dayText.hidden = !day; clock.textContent = at; clockSlot.hidden = !time;
      }
      if (days !== undefined) week.update(days ?? {});
      if (primary) {
        if (primary.label !== undefined) release.textContent = primary.label;
        if (primary.disabled !== undefined) disabledSupplied = Boolean(primary.disabled);
        if (primary.reason !== undefined) reasonSupplied = primary.reason || '';
        paintPrimary();
      }
      if (named) endLoading();
    },
    setStatus(value) { status.textContent = value ?? ''; },
    release, startAgain,
  };
  // tick(body, copy) runs the default release path with another tick body; refresh() re-reads the controls.
  const context = () => ({ adapter, state, basic, setMode, commandId, refresh: () => read(),
    tick: (body, copy) => defaultRelease({ adapter, state, basic, commandId }, body, copy) });
  const showScreen = (node) => { screen.replaceChildren(node); actions.hidden = true; week.root.hidden = true; reasonText.hidden = true; feed.root.hidden = true; releaseSection.root.hidden = true; };

  async function applyState(next) {
    state = next; loaded = true; screen.replaceChildren(); actions.hidden = false; releaseSection.root.hidden = false;
    const due = state.controls?.nextRelease;
    defaultDisabled = due?.status !== 'available';
    defaultReason = defaultDisabled ? `Release unavailable: ${sentence(due?.reason) || 'no release is due'}` : '';
    paintPrimary(); feed.update(state); if (!busy) releaseSection.refresh();
    // Only the latest read may fall back to the scenario name, and only once onState has settled.
    const mine = ++applied;
    return Promise.resolve(onState?.(state, basic)).catch(() => {}).then(() => { if (mine === applied && !disposed) { fallbackHeading(); endLoading(); } });
  }
  async function read() {
    let reply;
    try { reply = await adapter.readControls({ signal: abort.signal }); } catch { reply = { status: 'unavailable' }; }
    if (disposed) return;
    if (reply?.status === 'ok') { await applyState(reply.value); return; }
    loaded = false; paintPrimary(); if (!headlineSupplied && !headline.textContent) headline.textContent = TITLE; endLoading();
    if (isRunRestarted(reply)) showScreen(runRestartedScreen({ reload }));
    else if (NO_SESSION.includes(reply?.status)) showScreen(statusScreen({ title: 'Presenter controls unavailable', message: 'Reload this page to start a presenter session.' }));
    else showScreen(statusScreen({ title: 'Presenter controls unavailable', message: 'The controls could not be read.', actions: [button({ label: 'Retry', onClick: () => read() })] }));
    advancedNote.textContent = 'Presenter controls are not available.';
  }

  async function defaultRelease({ adapter: api, state: current, basic: view, commandId: next }, body = { mode: 'next-release' },
    copy = { pending: 'Releasing cars', done: 'Cars released', failed: 'Release not completed' }) {
    view.setStatus(copy.pending);
    let reply;
    try { reply = await api.tick({ commandId: next(), expectedClockVersion: current.clockVersion, ...body }, { signal: abort.signal }); } catch { reply = { status: 'unavailable' }; }
    if (disposed) return;
    if (isRunRestarted(reply)) { await read(); return; }
    if (reply?.status === 'ok') {
      view.setStatus(copy.done);
      const Event = win.CustomEvent;
      if (Event) host.dispatchEvent(new Event('gcsp:presenter-action', { bubbles: true, detail: { kind: 'tick' } }));
      try { win.localStorage.setItem(ACTION_KEY, JSON.stringify({ kind: 'tick', at: Date.now() })); } catch { /* storage blocked */ }
      controller?.refresh();
    } else view.setStatus(`${copy.failed}: ${sentence(reply?.reason) || 'Try again'}`);
    await read();
  }
  async function runRelease() {
    if (busy || disposed || !state) return;
    busy = true; paintPrimary(); releaseSection.setLoading();
    try { await (onRelease ?? defaultRelease)(context()); } finally {
      if (!disposed) releaseSection.refresh();
      busy = false; paintPrimary();
    }
  }
  function focusWhenReady(node) {
    const usable = () => node.isConnected && !node.disabled && !node.closest('[hidden]');
    if (usable()) { node.focus(); return; }
    stopWatching();
    watcher = new win.MutationObserver(() => { if (usable()) { stopWatching(); node.focus(); } });
    watcher.observe(advanced, { attributes: true, subtree: true, attributeFilter: ['hidden', 'disabled'] });
    watchTimer = setTimeout(() => { stopWatching(); group?.tabs.list.querySelector('[aria-selected="true"]')?.focus(); }, 3000);
  }
  function stopWatching() { watcher?.disconnect(); watcher = null; clearTimeout(watchTimer); watchTimer = null; }
  function defaultStartAgain() {
    setMode('advanced'); group?.tabs.select('scenario');
    const reset = group?.reset ?? controller?.root.querySelector('button:not([hidden])');
    if (reset) focusWhenReady(reset);
  }
  function runStartAgain() { if (!disposed) (onStartAgain ?? defaultStartAgain)(context()); }

  function mountAdvanced() {
    if (controller) return;
    controller = mountPresenterControls(advancedHost, { adapter, commandId, reload, ...(navigate ? { navigate } : {}),
      onReveal: () => {}, onEscape: () => {}, onAvailability: (visible) => { advancedNote.hidden = visible; } });
    group = regroup(controller.root); root.dataset.tabs = String(Boolean(group));
  }
  function setMode(next) {
    mode = next === 'advanced' ? 'advanced' : 'basic';
    try { store()?.setItem(PRESENTER_CONSOLE_MODE_KEY, mode); } catch { /* storage blocked */ }
    toggle.setAttribute('aria-pressed', String(mode === 'advanced'));
    stage.hidden = mode === 'advanced'; advanced.hidden = mode !== 'advanced';
    if (mode === 'advanced') mountAdvanced();
  }
  const onAction = () => { if (!busy) read(); };
  advancedHost.addEventListener('gcsp:presenter-action', onAction);
  toggle.addEventListener('click', () => setMode(mode === 'advanced' ? 'basic' : 'advanced'));

  let saved = 'basic'; try { saved = store()?.getItem(PRESENTER_CONSOLE_MODE_KEY) === 'advanced' ? 'advanced' : 'basic'; } catch { /* storage blocked */ }
  if (saved === 'advanced') setMode('advanced');
  const ready = read();
  const destroy = () => { disposed = true; abort.abort(); stopWatching(); releaseSection.destroy(); feed.destroy(); controller?.destroy(); advancedHost.removeEventListener('gcsp:presenter-action', onAction); root.remove(); };
  return { root, basic, setMode, destroy, ready };
}

export function startPresenterConsole(document = globalThis.document) {
  const host = document.querySelector('[data-presenter-console]');
  return host ? mountPresenterConsole(host) : null;
}
