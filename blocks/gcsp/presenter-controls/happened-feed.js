// FUCQ-366: the Basic console's "What happened" list in plain words, newest first. User agnostic: no employee is named.
import { el, button } from '../../vehicle-matcher/ui.js';
import { activityTimeline } from '../kit/activity-timeline.js';
import { sideDrawer } from '../kit/side-drawer.js';
import { friendlyTime } from '../kit/friendly-time.js';
import { loadingSkeleton } from '../kit/loading-skeleton.js';
import { messageDetail } from '../presenter/message-list.js';
import { releasedThisTick, currentEntry } from './basic-model.js';

const KEY = (runId) => `gcsp:presenter-feed:${runId}`;
const valid = (iso) => typeof iso === 'string' && Number.isFinite(Date.parse(iso));
const timeOf = (iso) => friendlyTime(iso) ?? 'Time not available';

/** Pure: activityTimeline events, newest first. history is [{ tickId, at, released, lapsed }]; messages are outbox rows. */
export function feedEvents({ controls, clockStart, history = [], messages = [], action } = {}) {
  const rows = []; // Logical order, earliest step first; a later index wins an equal time.
  const cars = history.some((h) => Number.isSafeInteger(h.released) && h.released > 0);
  const started = valid(clockStart) ? clockStart : controls?.lastTick == null && valid(controls?.now) ? controls.now : null;
  rows.push({ id: 'started', occurredAt: started, label: controls?.lastTick == null && !cars ? 'Scheme started, no cars on the scheme yet' : 'Scheme started' });
  for (const h of history) {
    // Every Advanced tick runs the release step; only ticks that brought cars earn a row.
    if (Number.isSafeInteger(h.released) && h.released > 0) rows.push({ id: `released-${h.tickId}`, occurredAt: h.at,
      label: `${h.released} ${h.released === 1 ? 'car' : 'cars'} released` });
    if (Number.isSafeInteger(h.lapsed) && h.lapsed > 0) rows.push({ id: `lapsed-${h.tickId}`, occurredAt: h.at, label: h.lapsed === 1 ? 'Hold lapsed' : `${h.lapsed} holds lapsed` });
  }
  for (const m of messages) {
    if (m?.messageKind !== 'offer' || !valid(m.time)) continue;
    rows.push({ id: `email-${m.jobId}`, occurredAt: m.time, action: action?.(m),
      label: m.state === 'sent' ? 'Offer email sent' : m.state === 'failed' ? 'Offer email not delivered' : 'Offer email waiting to send' });
  }
  const at = (e) => (valid(e.occurredAt) ? Date.parse(e.occurredAt) : -Infinity);
  return rows.map((e, i) => ({ e, i })).sort((a, b) => (at(b.e) - at(a.e)) || (b.i - a.i)).map(({ e }) => e);
}

function lapsedCount(tick) {
  const row = (Array.isArray(tick?.outcomes) ? tick.outcomes : []).find((r) => r?.handlerId === 'buddy-expiry' && r.outcome?.status === 'ok');
  return Array.isArray(row?.outcome?.value?.expired) ? row.outcome.value.expired.length : 0;
}

/** Appends section.gcsp-happened to parent. Returns { root, update(controls), destroy() }. */
export function mountHappenedFeed(parent, { adapter, storage } = {}) {
  const root = el('section', 'gcsp-happened'); root.hidden = true;
  const slot = el('div', 'gcsp-happened-slot'); slot.append(loadingSkeleton({ label: 'Loading what happened', layout: 'section', role: null })); root.append(slot);
  parent.append(root);
  let runId = null; let history = []; let messages = []; let failed = false; let clock = { runId: null, start: null, promise: null };
  let turn = 0; let destroyed = false; let drawer = null; let heading = null;
  const warning = el('p', 'gcsp-note', 'Captured emails could not be loaded.'); warning.hidden = true; root.append(warning);

  const save = () => { try { storage?.setItem(KEY(runId), JSON.stringify(history)); } catch { /* storage optional */ } };
  function load() {
    try {
      const rows = JSON.parse(storage?.getItem(KEY(runId)) ?? '[]');
      history = Array.isArray(rows) ? rows.filter((h) => h && typeof h.tickId === 'string') : [];
    } catch { history = []; }
  }
  function record(controls) {
    if (controls.runId !== runId) { runId = controls.runId; history = []; load(); }
    const tick = controls.lastTick;
    if (!tick || typeof tick.tickId !== 'string' || history.some((h) => h.tickId === tick.tickId)) return;
    history.push({ tickId: tick.tickId, at: valid(tick.now) ? tick.now : controls.now ?? null, released: releasedThisTick(controls), lapsed: lapsedCount(tick) });
    save();
  }
  function clockStart(controls) {
    if (clock.runId === controls.runId && clock.promise) return clock.promise;
    const mine = { runId: controls.runId, start: null, promise: null };
    mine.promise = Promise.resolve().then(() => adapter?.readScenarios?.()).then((reply) => {
      const list = reply?.status === 'ok' && Array.isArray(reply.value?.scenarios) ? reply.value.scenarios : [];
      mine.start = (currentEntry(controls, reply?.value) ?? list[0])?.clockStart ?? null;
      if (reply?.status !== 'ok' && clock === mine) clock = { runId: null, start: null, promise: null };
      return mine.start;
    }).catch(() => { if (clock === mine) clock = { runId: null, start: null, promise: null }; return null; });
    clock = mine; return mine.promise;
  }
  async function readMessages() {
    if (typeof adapter?.readOutbox !== 'function') return { rows: [], failed: false };
    try {
      const reply = await adapter.readOutbox();
      return reply?.status === 'ok' && Array.isArray(reply.value?.messages) ? { rows: reply.value.messages, failed: false } : { rows: [], failed: true };
    } catch { return { rows: [], failed: true }; }
  }

  function viewEmail(message) {
    const label = timeOf(message.time);
    const open = button({ label: 'View email', variant: 'ghost', onClick: () => {
      drawer?.close(false);
      const body = el('div', 'gcsp-happened-mail'); body.append(...messageDetail(message).nodes.slice(1));
      const current = () => [...root.querySelectorAll('button[data-job-id]')].find((node) => node.dataset.jobId === message.jobId) ?? heading;
      const mine = sideDrawer({ host: root, context: 'Captured email', title: message.subject || 'Email not created yet', body: [body], opener: current,
        onClose: () => { if (drawer === mine) drawer = null; } });
      drawer = mine;
    } });
    open.dataset.jobId = message.jobId; open.setAttribute('aria-label', `View email, ${label}`);
    return open;
  }
  function paint(controls, start) {
    const timeline = activityTimeline({ events: feedEvents({ controls, clockStart: start, history, messages, action: viewEmail }),
      heading: 'What happened', level: 2, note: null, formatTime: timeOf });
    heading = timeline.querySelector('.gcsp-timeline-heading'); heading.tabIndex = -1;
    slot.replaceChildren(timeline); warning.hidden = !failed;
  }

  return {
    root,
    async update(controls) {
      if (destroyed || !controls) return;
      root.hidden = false; record(controls);
      const mine = ++turn;
      const [start, outbox] = await Promise.all([clockStart(controls), readMessages()]);
      if (destroyed || mine !== turn) return;
      messages = outbox.rows; failed = outbox.failed;
      paint(controls, start);
    },
    destroy() { destroyed = true; drawer?.close(false); drawer = null; root.remove(); },
  };
}
