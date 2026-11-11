// FUCQ-365: Today's release on the console Basic body: a preloaded car grid, counters and the model-line breakdown.
import { el, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { friendlyTime } from '../kit/friendly-time.js';
import { releaseGrid } from '../kit/release-grid.js';
import { loadingSkeleton } from '../kit/loading-skeleton.js';
import { countBars } from '../kit/count-bars.js';

const COUNT_MS = 600;
const REDUCE = '(prefers-reduced-motion: reduce)';
const LABELS = ['Latest release', 'Total released', 'Unallocated', 'Buddy Allocated', 'Manually Allocated'];
const NONE = LABELS.map(() => 0);
let sequence = 0;

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');
export const tileLabel = (car) => {
  const model = text(car?.modelName); const colour = text(car?.colourName);
  return model ? (colour ? `${model}, ${colour}` : model) : text(car?.imageAlt) || 'Car';
};
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const shown = (value) => value.toLocaleString('en-GB');

/** Mounts Today's release at the end of `parent`. Returns { root, setLoading(), refresh() -> Promise, destroy() }.
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
  // Charts sit in a closed disclosure, like What happened (Gary, 11 Nov); built from the release read only.
  const charts = el('details', 'gcsp-release-charts'); const chartsTitle = el('summary', 'gcsp-release-charts-summary', 'Latest release stats');
  const chartGrid = el('div', 'gcsp-release-charts-grid'); charts.append(chartsTitle, chartGrid); charts.hidden = true;
  root.append(head, body, foot, charts); parent.append(root);

  const abort = new AbortController(); let disposed = false; let turn = 0; let shownKey = null; let first = true; let counting = 0; let totals = null;
  const reduced = () => { try { return Boolean((matchMedia ?? win?.matchMedia?.bind(win))?.(REDUCE)?.matches); } catch { return false; } };

  function paintFoot(values) {
    counting += 1;
    totals = factList(LABELS.map((label, at) => ({ label, value: shown(values[at]) })), { className: 'gcsp-release-totals' });
    foot.replaceChildren(totals);
  }
  function paintCharts(lines, data) {
    charts.removeAttribute('aria-busy');
    const rows = (list) => (Array.isArray(list) ? list : []).filter((row) => text(row?.label)).map((row) => ({ label: row.label, count: count(row.count) }));
    const points = rows(data?.points).map((row) => ({ ...row, label: /^\d+$/.test(row.label) ? `${shown(Number(row.label))} points` : row.label }));
    chartGrid.replaceChildren(
      countBars({ label: 'Model line', rows: lines.map((row) => ({ label: row.modelLine, count: row.count })) }),
      countBars({ label: 'Colour', rows: rows(data?.colours), limit: 8, otherLabel: 'Other colours' }),
      countBars({ label: 'Points a month', rows: points }),
      countBars({ label: 'Fuel', rows: rows(data?.fuel) }));
    charts.hidden = !lines.length;
  }
  function setLoading() {
    if (disposed) return;
    turn += 1; counting += 1;
    charts.hidden = false; charts.setAttribute('aria-busy', 'true');
    chartGrid.replaceChildren(...['Model line', 'Colour', 'Points a month', 'Fuel'].map((label) => {
      const chart = el('div', ''); chart.append(el('h3', '', label), loadingSkeleton({ label: `Loading ${label.toLowerCase()}`, layout: 'section', role: null })); return chart;
    }));
    foot.replaceChildren(loadingSkeleton({ label: 'Loading release totals', layout: 'section', role: null }));
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
    body.replaceChildren(empty); paintFoot(NONE); paintCharts([], null);
  }

  async function refresh() {
    const mine = ++turn; let reply;
    try { reply = await adapter?.readLatestRelease?.({ signal: abort.signal }); } catch { reply = null; }
    if (disposed || mine !== turn) return;
    const value = reply?.status === 'ok' ? reply.value : null; const release = value?.release;
    const initial = first; first = false;
    if (!value || !release) { paintBefore(); return; }
    const key = `${value.runId}:${release.trancheId ?? release.windowId}`;
    const final = [value.counts?.released, value.counts?.totalReleased, value.counts?.onScheme, value.counts?.buddyAllocated, value.counts?.manuallyAllocated].map(count);
    const lines = (Array.isArray(value.modelLines) ? value.modelLines : []).filter((row) => text(row?.modelLine)).map((row) => ({ modelLine: row.modelLine, count: count(row.count) }));
    line.textContent = `Released ${friendlyTime(release.releasedAt) ?? 'today'}`;
    paintCharts(lines, value.charts);
    if (key === shownKey) { paintFoot(final); return; }
    shownKey = key; body.replaceChildren(grid.root);
    const cars = (Array.isArray(value.cars) ? value.cars : []).map((car) => ({ id: car.id, imageSrc: car.imageSrc, label: tileLabel(car) }));
    const motion = !initial && !reduced() && Boolean(win?.requestAnimationFrame);
    paintFoot(motion ? NONE : final);
    await grid.show(cars, { animate: !initial });
    if (!motion || disposed || mine !== turn) return;
    countUp(final);
  }

  function destroy() { disposed = true; counting += 1; abort.abort(); grid.destroy(); root.remove(); }
  body.replaceChildren(loadingSkeleton({ label: "Loading today's release", layout: 'section', role: null }));
  return { root, setLoading, refresh, destroy };
}
