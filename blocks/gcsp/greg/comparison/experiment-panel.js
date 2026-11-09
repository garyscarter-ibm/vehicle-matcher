// Experiment mode of the route comparison: pick a stored experiment, rerun hold durations on the worker and watch the job. Results come only from loadAll/loadResult.
import { el, screenIntro, button, statusScreen } from '../../../vehicle-matcher/ui.js';
import { renderOptionList } from '../../../vehicle-matcher/modes/question-ui.js';
import { accessLapsedScreen } from '../../kit/run-restarted.js';
import { toStoredView, toJobView } from './experiment-view.js';
import { heading, processParts, experimentParts } from './result-parts.js';
import { createRerunForm } from './rerun-form.js';
import { createJobStrip } from './job-strip.js';
import { EXPERIMENTS, TITLE, REFUSED, UNAVAILABLE, experimentLabel } from './comparison-copy.js';
import * as words from './experiment-copy.js';

let sequence = 0;
const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const matches = (id, stored) => (id === 'process-only' ? stored.kind === 'process' : stored.kind === 'experiment' && stored.view.id === id);
function makeEntry(id, latest) {
  const parsed = latest ? attempt(() => toStoredView(latest), null) : null;
  return { id, label: experimentLabel(id), stored: latest, parsed: parsed && matches(id, parsed) ? parsed : null, resultId: latest?.resultId ?? null };
}
const stateOf = (e) => (!e.stored ? words.NO_STORED : e.parsed ? words.stateText(e.parsed.view.meta.made) : words.UNREADABLE);

/** mountExperimentPanel(root, { adapter, signal, pollMs }) -> teardown with refresh(). adapter: loadAll, loadResult, start, readJob. */
export function mountExperimentPanel(root, { adapter, signal, pollMs = 2000 } = {}) {
  const abort = new AbortController();
  const stop = () => abort.abort(); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  let disposed = false; let gen = 0; let detailsOpen = false; let timer = null; let token = 0; let watched = null;
  let entries = []; let selected = null; let job = null; let lastRun = null; let lost = false;
  const previous = new Set(); const fresh = new Map(); const optionNodes = new Map();
  const page = el('div', 'vm gcsp-comparison'); const status = el('p', 'gcsp-vh'); status.setAttribute('role', 'status');
  const body = el('div', 'gcsp-comparison-body'); const stage = el('div', 'gcsp-comparison-stage');
  const reload = button({ label: 'Reload', variant: 'ghost', onClick: () => load() });
  const strip = createJobStrip(); const form = createRerunForm({ run: startRun });
  page.append(status, body); root.replaceChildren(page);
  const dead = (mine) => disposed || abort.signal.aborted || (mine !== undefined && mine !== gen);
  const call = async (name, ...args) => { try { return (await adapter[name]?.(...args, { signal: abort.signal })) ?? { status: 'unavailable' }; } catch { return { status: 'unavailable' }; } };
  const entry = (id) => entries.find((e) => e.id === id);

  function resultNodes(e) {
    const view = e.parsed.view; const kind = fresh.get(e.id) === e.resultId ? 'new' : previous.has(e.id) ? 'previous' : 'stored';
    const stamp = heading(words.resultHeading(kind, view.meta.made)); stamp.tabIndex = -1; stamp.dataset.resultHeading = '';
    const open = (value) => { detailsOpen = value; };
    return [stamp, ...(e.parsed.kind === 'process' ? processParts(view, detailsOpen, open) : experimentParts(view, detailsOpen, open))];
  }
  function emptyNodes(e) {
    if (job?.active && job.experimentId === e.id) return [heading(words.NO_PREVIOUS), el('p', 'gcsp-note', words.NO_PREVIOUS_NOTE)];
    const section = el('section', 'gcsp-comparison-empty');
    section.append(heading(words.NO_RESULT_TITLE), el('p', 'gcsp-comparison-lead', words.NO_RESULT_NOTE)); return [section];
  }
  function drawStage() {
    const e = entry(selected); if (!e) { stage.replaceChildren(); return; }
    const nodes = [];
    if (EXPERIMENTS[e.id]) nodes.push(el('p', 'gcsp-note', EXPERIMENTS[e.id].summary));
    if (lastRun?.experimentId === e.id) nodes.push(el('p', 'gcsp-note gcsp-comparison-lastrun', words.lastRun(lastRun.finishedAt, lastRun.reason)));
    if (e.id === 'hold-sweep') nodes.push(form.root);
    nodes.push(...(e.parsed ? resultNodes(e) : e.stored ? [el('p', 'gcsp-note', words.UNREADABLE_NOTE)] : emptyNodes(e)));
    stage.replaceChildren(...nodes);
  }
  function buildPicker() {
    const id = `gcsp-comparison-picker-${++sequence}`; const wrap = el('div', 'gcsp-comparison-picker'); const label = el('p', 'gcsp-field-label', words.PICKER_LABEL); label.id = `${id}-label`;
    const control = renderOptionList({ id, options: entries.map((e) => ({ value: e.id, label: e.label, sub: stateOf(e) })) }, null, {
      value: selected, onValueChange(value) { selected = value; drawStage(); } });
    control.list.removeAttribute('aria-label'); control.list.setAttribute('aria-labelledby', label.id);
    optionNodes.clear();
    [...control.list.children].forEach((node, i) => { node.dataset.value = entries[i].id; optionNodes.set(entries[i].id, node); });
    wrap.append(label, control.list); return wrap;
  }
  const updateOption = (id) => { const sub = optionNodes.get(id)?.querySelector('.vm-option-sub'); if (sub) sub.textContent = stateOf(entry(id)); };

  function problem(state) {
    if (state.status === 'access-required') return { name: 'access-required', node: accessLapsedScreen(), text: 'Demo access needed.' };
    reload.textContent = state.status === 'refused' ? 'Reload' : 'Retry';
    return state.status === 'refused'
      ? { name: 'refused', node: statusScreen({ kicker: TITLE, title: 'You cannot open this comparison', message: REFUSED, role: 'alert' }), text: 'Access refused.' }
      : { name: 'unavailable', node: statusScreen({ kicker: TITLE, title: 'The comparison is unavailable', message: UNAVAILABLE, role: 'alert', actions: [reload] }), text: 'Comparison unavailable.' };
  }
  function clearTimer() { clearTimeout(timer); timer = null; token += 1; }
  function schedule(jobId, delay = pollMs) { clearTimer(); watched = jobId; const mine = token; timer = setTimeout(() => poll(jobId, mine), delay); timer?.unref?.(); } // unref: a poll never keeps a Node process alive
  function adopt(view) {
    const first = job?.jobId !== view.jobId;
    job = view; watched = view.jobId; previous.add(view.experimentId); fresh.delete(view.experimentId); form.setActive(true); strip.running(view);
    if (first) { lastRun = null; drawStage(); }
  }
  function release() { job = null; watched = null; clearTimer(); form.setActive(false); }

  async function poll(jobId, mine) {
    timer = null;
    const reply = await call('readJob', { jobId });
    if (dead() || token !== mine) return;
    const view = reply.status === 'ok' ? attempt(() => toJobView(reply.job), null) : null;
    if (view?.active) {
      if (lost) { strip.clearNotice(); lost = false; }
      adopt(view); schedule(jobId); return;
    }
    if (view) { lost = false; await finish(view); return; }
    if (reply.status === 'access-required') { release(); showScreen(problem(reply)); return; }
    lost = true; strip.notice({ lines: [words.LOST_CONTACT] });
    if (reply.status === 'unavailable') schedule(jobId); else { clearTimer(); watched = null; }
  }
  async function finish(view) {
    release(); strip.clearNotice();
    if (view.status === 'succeeded') { await readBack(view); return; }
    strip.finished(view);
    strip.notice({ title: view.status === 'failed' ? words.FAILED_TITLE(view.experimentId) : words.STOPPED_TITLE(view.experimentId),
      lines: [view.reason, entry(view.experimentId)?.parsed ? words.NO_RESULT_STORED : words.NO_RESULT_STORED_NONE] });
    drawStage();
  }
  async function readBack(view) {
    const mine = gen; const reply = view.resultId ? await call('loadResult', view.experimentId) : null;
    if (dead(mine)) return;
    const next = reply?.status === 'ready' && reply.stored?.resultId === view.resultId ? makeEntry(view.experimentId, reply.stored) : null;
    if (!next?.parsed) { strip.finished(view); strip.notice({ lines: [words.NOT_READ_BACK] }); drawStage(); return; }
    entries = entries.map((e) => (e.id === next.id ? next : e)); fresh.set(next.id, next.resultId); previous.delete(next.id);
    if (next.id === 'hold-sweep') form.setSource(next.parsed.view);
    strip.finished(view, words.STORED_READ_BACK); status.textContent = words.STORED_READ_BACK; updateOption(next.id); drawStage();
    if (selected === next.id) stage.querySelector('[data-result-heading]')?.focus();
  }
  async function startRun(payload) {
    const reply = await call('start', payload);
    if (dead()) return null;
    if (reply.status === 'started') {
      const view = attempt(() => toJobView(reply.job), null);
      strip.clearNotice(); lost = false;
      if (view) { adopt(view); schedule(view.jobId); strip.focus(); } else strip.notice({ lines: [words.NOT_TRACKED] });
    } else if (reply.status === 'conflict') {
      strip.notice({ lines: [reply.reason || words.CONFLICT] });
      if (reply.jobId) { form.setActive(true); schedule(reply.jobId, 0); }
    } else if (reply.status === 'access-required') { release(); showScreen(problem(reply)); }
    return reply;
  }
  function showScreen(next) { body.replaceChildren(next.node); page.dataset.state = next.name; page.removeAttribute('aria-busy'); status.textContent = next.text; }

  async function load() {
    const mine = ++gen; const keep = root.ownerDocument.activeElement === reload; release();
    if (page.dataset.state !== 'ready') { body.replaceChildren(statusScreen({ kicker: TITLE, title: words.LOADING })); page.dataset.state = 'loading'; }
    page.setAttribute('aria-busy', 'true'); status.textContent = `${words.LOADING}.`;
    const [list, latest] = await Promise.all([call('loadAll'), call('readJob', {})]);
    if (dead(mine)) return;
    if (list.status !== 'ready' || !list.experiments.length) { showScreen(problem(list.status === 'ready' ? { status: 'unavailable' } : list)); return; }
    entries = list.experiments.map(({ experimentId, latest: stored }) => makeEntry(experimentId, stored));
    previous.clear(); fresh.clear(); lastRun = null; lost = false; strip.reset();
    const last = latest.status === 'ok' ? attempt(() => toJobView(latest.job), null) : null;
    selected = (last?.active && entry(last.experimentId) ? last.experimentId : (entries.find((e) => e.parsed) ?? entry('process-only') ?? entries[0]).id);
    if (last && !last.active && last.reason && entry(last.experimentId)) lastRun = { experimentId: last.experimentId, finishedAt: last.finishedAt, reason: last.reason };
    const head = el('div', 'gcsp-comparison-head'); head.append(screenIntro({ title: TITLE, lede: words.LEDE, level: 2 }), reload); reload.textContent = 'Reload';
    form.setSource(entry('hold-sweep')?.parsed?.view ?? null);
    drawStage(); body.replaceChildren(head, strip.root, buildPicker(), stage);
    page.dataset.state = 'ready'; page.removeAttribute('aria-busy'); status.textContent = words.LOADED;
    if (last?.active) { adopt(last); schedule(last.jobId); }
    if (keep) reload.focus();
  }

  load();
  return Object.assign(() => { disposed = true; gen += 1; clearTimer(); abort.abort(); signal?.removeEventListener('abort', stop); root.replaceChildren(); }, { refresh: () => load() });
}
