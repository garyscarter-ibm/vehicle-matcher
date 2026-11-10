// FUCQ-362: wires basic-model into the console's Basic body: friendly time, the journey-driven Release and Start again.
import { el, button } from '../../vehicle-matcher/ui.js';
import { isRunRestarted } from '../kit/run-restarted.js';
import { createPresenterHttpAdapter } from './http-adapter.js';
import { basicModel, currentEntry, startAgainBody } from './basic-model.js';

const CONFIRM = 'The scheme goes back to day 1 and released cars are cleared. Employees keep their saved preferences. The next release brings a new set of cars.';
const sentence = (value) => { const text = typeof value === 'string' ? value.trim() : ''; return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(text) ? '' : text.slice(0, 160); };
const MOVE = { pending: 'Moving on a day', done: 'Moved on a day', failed: 'Not moved on' };
const RELEASE = { pending: 'Releasing cars', done: 'Cars released', failed: 'Release not completed' };
let sequence = 0;

/** Options for mountPresenterConsole: { adapter, onState, onRelease, onStartAgain }. Reads only the presenter adapter. */
export function basicConsoleOptions({ adapter = createPresenterHttpAdapter() } = {}) {
  let catalogue = null; let catalogueRun = null; let model = null; let reads = 0; let panel = null; let pendingReset = null; let resetting = false;

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
    basic.update({ headline: model.headline, sub: model.sub, clock: model.clock,
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
    const root = el('section', 'gcsp-console-confirm'); root.hidden = true; root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-labelledby', `${id}-title`); root.setAttribute('aria-describedby', `${id}-text`);
    const title = el('h2', '', 'Start again?'); title.id = `${id}-title`;
    const text = el('p', 'gcsp-console-sub', CONFIRM); text.id = `${id}-text`;
    const close = () => { root.hidden = true; ctx.basic.startAgain.disabled = false; ctx.basic.startAgain.focus(); };
    const yes = button({ label: 'Start again', onClick: () => { root.hidden = true; reset(ctx).finally(() => { ctx.basic.startAgain.disabled = false; }); } });
    const no = button({ label: 'Cancel', variant: 'ghost', onClick: close });
    const row = el('div', 'gcsp-console-actions'); row.append(yes, no);
    root.append(title, text, row);
    root.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    ctx.basic.startAgain.closest('.gcsp-console-actions').after(root);
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
    const { root, yes } = confirmation(ctx);
    root.hidden = false; ctx.basic.startAgain.disabled = true; yes.focus();
  }

  return { adapter, onState, onRelease, onStartAgain };
}
