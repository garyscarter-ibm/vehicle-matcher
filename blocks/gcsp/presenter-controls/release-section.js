// FUCQ-365: Today's release on the console Basic body: a preloaded car grid, counters and the model-line breakdown.
import { el, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { friendlyTime } from '../kit/friendly-time.js';
import { releaseGrid } from '../kit/release-grid.js';
import { loadingSkeleton } from '../kit/loading-skeleton.js';

const COUNT_MS = 600;
const REDUCE = '(prefers-reduced-motion: reduce)';
const LABELS = ['Released', 'Model lines', 'Colours', 'On the scheme'];
const NONE = [0, 0, 0, 0];
let sequence = 0;

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');
export const tileLabel = (car) => {
  const model = text(car?.modelName); const colour = text(car?.colourName);
  return model ? (colour ? `${model}, ${colour}` : model) : text(car?.imageAlt) || 'Car';
};
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const shown = (value) => value.toLocaleString('en-GB');

/** Mounts Today's release at the end of `parent`. Returns { root, refresh() -> Promise, destroy() }.
 * Shows a skeleton until the first read lands. Reads adapter.readLatestRelease; anything but an ok reply shows the before-release state, with no error copy. */
export function mountReleaseSection(parent, { adapter, matchMedia } = {}) {
  const win = parent.ownerDocument.defaultView; const id = `gcsp-console-release-${++sequence}`;
  const root = el('section', 'gcsp-console-release'); root.setAttribute('aria-labelledby', `${id}-title`);
  const title = el('h2', '', "Today's release"); title.id = `${id}-title`;
  const line = el('p', 'gcsp-console-release-line');
  const head = el('div', 'gcsp-console-release-head'); head.append(title, line);
  const grid = releaseGrid({ label: 'Released cars', columns: 20, matchMedia });
  const empty = statusScreen({ title: 'No cars released yet', role: null, level: 3 });
  const body = el('div', 'gcsp-console-release-body'); const foot = el('div', 'gcsp-console-release-foot');
  root.append(head, body, foot); parent.append(root);

  const abort = new AbortController(); let disposed = false; let turn = 0; let shownKey = null; let first = true; let counting = 0; let totals = null;
  const reduced = () => { try { return Boolean((matchMedia ?? win?.matchMedia?.bind(win))?.(REDUCE)?.matches); } catch { return false; } };

  function paintFoot(values, lines) {
    counting += 1;
    totals = factList(LABELS.map((label, at) => ({ label, value: shown(values[at]) })), { className: 'gcsp-release-totals' });
    const breakdown = factList(lines.map((row) => ({ label: row.modelLine, value: row.count })), { className: 'gcsp-release-lines' });
    breakdown.setAttribute('aria-label', 'Cars released by model line');
    const heading = el('p', 'gcsp-release-lines-title', 'Cars released by model line'); heading.setAttribute('aria-hidden', 'true');
    const side = el('div', 'gcsp-release-lines-wrap'); side.append(heading, breakdown);
    foot.replaceChildren(totals, ...(lines.length ? [side] : []));
  }
  // Counts the painted counters up to `end` over COUNT_MS; paintFoot supersedes it.
  function countUp(end) {
    const run = counting; const nodes = [...totals.querySelectorAll('.vm-fact-value')]; const start = win.performance.now();
    const step = (now) => {
      if (disposed || run !== counting) return;
      const t = Math.min(1, (now - start) / COUNT_MS);
      nodes.forEach((node, at) => { node.textContent = shown(Math.round(end[at] * t)); });
      if (t < 1) win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
  }
  function paintBefore() {
    grid.clear(); shownKey = null; line.textContent = 'Waiting for 11:30am';
    body.replaceChildren(empty); paintFoot(NONE, []);
  }

  async function refresh() {
    const mine = ++turn; let reply;
    try { reply = await adapter?.readLatestRelease?.({ signal: abort.signal }); } catch { reply = null; }
    if (disposed || mine !== turn) return;
    const value = reply?.status === 'ok' ? reply.value : null; const release = value?.release;
    const initial = first; first = false;
    if (!value || !release) { paintBefore(); return; }
    const key = `${value.runId}:${release.trancheId ?? release.windowId}`;
    const final = [value.counts?.released, value.counts?.modelLines, value.counts?.colours, value.counts?.onScheme].map(count);
    const lines = (Array.isArray(value.modelLines) ? value.modelLines : []).filter((row) => text(row?.modelLine)).map((row) => ({ modelLine: row.modelLine, count: count(row.count) }));
    line.textContent = `Released ${friendlyTime(release.releasedAt) ?? 'today'}`;
    if (key === shownKey) { paintFoot(final, lines); return; }
    shownKey = key; body.replaceChildren(grid.root);
    const cars = (Array.isArray(value.cars) ? value.cars : []).map((car) => ({ id: car.id, imageSrc: car.imageSrc, label: tileLabel(car) }));
    const motion = !initial && !reduced() && Boolean(win?.requestAnimationFrame);
    paintFoot(motion ? NONE : final, lines);
    await grid.show(cars, { animate: !initial });
    if (!motion || disposed || mine !== turn) return;
    countUp(final);
  }

  function destroy() { disposed = true; counting += 1; abort.abort(); grid.destroy(); root.remove(); }
  body.replaceChildren(loadingSkeleton({ label: "Loading today's release", layout: 'section', role: null }));
  return { root, refresh, destroy };
}
