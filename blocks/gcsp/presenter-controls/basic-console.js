// FUCQ-362: wires basic-model into the console's Basic body: friendly time, the journey-driven Release and Start again.
import { el, button } from '../../vehicle-matcher/ui.js';
import { isRunRestarted } from '../kit/run-restarted.js';
import { createPresenterHttpAdapter } from './http-adapter.js';
import { basicModel, currentEntry, startAgainBody } from './basic-model.js';

const CONFIRM = 'Day 1, cars cleared. Preferences kept.';
const sentence = (value) => { const text = typeof value === 'string' ? value.trim() : ''; return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(text) ? '' : text.slice(0, 160); };
const MOVE = { pending: 'Moving on a day', done: 'Moved on a day', failed: 'Not moved on' };
const RELEASE = { pending: 'Releasing cars', done: 'Cars released', failed: 'Release not completed' };
let sequence = 0;

/** Options for mountPresenterConsole: { adapter, onState, onRelease, onStartAgain }. Reads only the presenter adapter. */
export function basicConsoleOptions({ adapter = createPresenterHttpAdapter() } = {}) {
  let catalogue = null; let catalogueRun = null; let model = null; let reads = 0; let panel = null; let pendingReset = null; let resetting = false; let latest = null;

  async function onState(state, basic) {
    const turn = ++reads;
    if (catalogueRun !== state.runId) {
      const reply = await Promise.resolve(adapter.readScenarios?.()).catch(() => null);
      if (turn !== reads) return;
      catalogue = reply?.status === 'ok' ? reply.value : null; catalogueRun = catalogue ? state.runId : null;
    }
    const listed = await Promise.resolve(adapter.listOrders?.()).catch(() => null);
    if (turn !== reads) return;
    const orders = listed?.status === 'ok' && Array.isArray(listed.value?.orders) ? listed.value.orders.length : null;
    model = basicModel({ controls: state, scenario: currentEntry(state, catalogue), orders });
    basic.update({ headline: model.headline, sub: model.sub, clock: model.clock, week: { now: state.now, start: currentEntry(state, catalogue)?.clockStart },
      primary: { label: model.release.label, disabled: model.release.disabled, reason: model.release.reason } });
    basic.release.dataset.phase = model.phase;
  }

  // A busy (disabled) button drops focus; restore it a task later, once the console re-enables Release.
  function keepFocus(ctx, wanted) {
    if (!wanted) return;
    setTimeout(() => { const target = ctx.basic.release.disabled ? ctx.basic.startAgain : ctx.basic.release; if (target.isConnected && !target.disabled) target.focus(); });
  }

  async function onRelease(ctx) {
    if (!model?.release.body || model.release.disabled) return;
    const { mode, to } = model.release.body; const doc = ctx.basic.release.ownerDocument;
    const held = doc.activeElement === ctx.basic.release;
    await ctx.tick({ mode, to }, model.phase === 'accepted' ? MOVE : RELEASE);
    keepFocus(ctx, held || doc.activeElement === doc.body);
  }

  function confirmation(ctx) {
    if (panel) return panel;
    const id = `gcsp-console-confirm-${++sequence}`;
    const root = el('div', 'gcsp-console-confirm'); root.id = id; root.hidden = true; root.setAttribute('role', 'group');
    root.setAttribute('aria-labelledby', `${id}-title`); root.setAttribute('aria-describedby', `${id}-text`);
    const title = el('strong', '', 'Start again?'); title.id = `${id}-title`;
    const text = el('span', 'gcsp-console-confirm-note', CONFIRM); text.id = `${id}-text`;
    const copy = el('span', 'gcsp-console-confirm-copy'); copy.append(title, ' ', text);
    // The panel is built once, so its buttons read the newest context: an old one holds a stale run id.
    const hide = () => { root.hidden = true; latest.basic.startAgain.hidden = false; latest.basic.startAgain.setAttribute('aria-expanded', 'false'); };
    const close = () => { hide(); latest.basic.startAgain.disabled = false; latest.basic.startAgain.focus(); };
    const yes = button({ label: 'Confirm', variant: 'ghost', describedBy: text.id, onClick: () => { hide(); const now = latest; reset(now).finally(() => { now.basic.startAgain.disabled = false; }); } });
    const no = button({ label: 'Cancel', variant: 'ghost', onClick: close });
    root.append(copy, yes, no);
    root.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    const slot = el('div', 'gcsp-console-restart'); ctx.basic.startAgain.before(slot); slot.append(ctx.basic.startAgain, root);
    ctx.basic.startAgain.setAttribute('aria-controls', id); ctx.basic.startAgain.setAttribute('aria-expanded', 'false');
    panel = { root, yes };
    return panel;
  }

  // A lost or retryable reply keeps the original command, so pressing again retries it exactly.
  async function reset(ctx) {
    if (resetting) return;
    const planned = pendingReset ?? startAgainBody({ controls: ctx.state, catalogue });
    if (!planned.body) { ctx.basic.setStatus(planned.reason); return; }
    pendingReset = planned.body.commandId ? planned : { body: { commandId: ctx.commandId(), ...planned.body } };
    resetting = true; ctx.basic.setStatus('Starting again'); ctx.basic.release.disabled = true;
    let reply;
    try { reply = await adapter.reset(pendingReset.body); } catch { reply = { status: 'unavailable', lostResponse: true }; }
    resetting = false;
    if (reply?.status === 'ok') {
      pendingReset = null; catalogueRun = null;
      const stopped = reply.value?.startState && reply.value.startState.status !== 'ok';
      ctx.basic.setStatus(stopped ? `Started again, but the run did not finish setting up: ${sentence(reply.value.startState.reason) || 'Try again'}` : 'Started again on day 1');
    } else if (reply?.lostResponse || reply?.retryable) {
      ctx.basic.setStatus('Start again not confirmed. Press Start again to retry.');
    } else {
      pendingReset = null;
      ctx.basic.setStatus(isRunRestarted(reply) ? 'The run changed elsewhere. Showing the latest.' : `Start again not completed: ${sentence(reply?.reason) || 'Try again'}`);
    }
    await ctx.refresh();
    keepFocus(ctx, true);
  }

  function onStartAgain(ctx) {
    if (resetting) return;
    latest = ctx; const { root, yes } = confirmation(ctx);
    root.hidden = false; ctx.basic.startAgain.hidden = true; ctx.basic.startAgain.disabled = true; ctx.basic.startAgain.setAttribute('aria-expanded', 'true'); yes.focus();
  }

  return { adapter, onState, onRelease, onStartAgain };
}
