import { el } from '../../vehicle-matcher/ui.js';
import { loadingSkeleton } from './loading-skeleton.js';

const CASCADE_MS = 1200; // The last tile's delay plus FADE_MS lands the whole grid in about this long.
const FADE_MS = 350;
const REDUCE = '(prefers-reduced-motion: reduce)';

// Resolves with the sources that loaded; every image settles or the timeout ends the wait.
function defaultPreload(srcs, timeoutMs) {
  return new Promise((resolve) => {
    const loaded = new Set(); let pending = srcs.length; let timer = null;
    const finish = () => { clearTimeout(timer); resolve(loaded); };
    if (!pending) { finish(); return; }
    timer = setTimeout(finish, timeoutMs);
    for (const src of srcs) {
      const image = new globalThis.Image();
      const settle = (ok) => { if (ok) loaded.add(src); pending -= 1; if (!pending) finish(); };
      image.addEventListener('load', () => settle(true)); image.addEventListener('error', () => settle(false));
      image.src = src;
    }
  });
}

/** Image tile grid for a release. tiles: { id, imageSrc, label }. Returns { root, show(tiles, { animate }) -> Promise, setLoading(), clear(), destroy() }.
 * show() preloads first, then cascades the tiles in (about 1.2s); `preload(srcs) -> Promise<Set>` and `matchMedia` are injectable. */
export function releaseGrid({ label = 'Released cars', columns = 20, preload, timeoutMs = 4000, matchMedia } = {}) {
  const root = el('div', 'gcsp-release-grid'); root.setAttribute('role', 'grid'); root.setAttribute('aria-label', label);
  root.style.setProperty('--gcsp-release-columns', String(columns));
  const tip = el('div', 'gcsp-release-tip'); tip.setAttribute('aria-hidden', 'true'); tip.hidden = true;
  let token = 0; let cells = []; let active = 0; let cancelRun = null;
  const view = () => root.ownerDocument.defaultView;
  const reduced = () => { const ask = matchMedia ?? view()?.matchMedia?.bind(view()); try { return Boolean(ask?.(REDUCE)?.matches); } catch { return false; } };
  const frame = (run) => { const win = view(); if (win?.requestAnimationFrame) win.requestAnimationFrame(() => run()); else setTimeout(run, 16); };
  const begin = () => { token += 1; cancelRun?.(); cancelRun = null; return token; };

  function setActive(index) {
    active = index;
    cells.forEach((cell, at) => { cell.tabIndex = at === index ? 0 : -1; });
  }
  function showTip(cell) {
    tip.textContent = cell.getAttribute('aria-label') ?? ''; tip.hidden = false;
    // Centred on the tile but kept inside the grid; the first row's tip sits below so it never covers the heading.
    const half = tip.offsetWidth / 2; const centre = cell.offsetLeft + cell.offsetWidth / 2;
    tip.style.setProperty('left', `${Math.max(half, Math.min(root.clientWidth - half, centre))}px`);
    tip.classList.toggle('is-below', cell.offsetTop === 0); tip.style.setProperty('top', `${cell.offsetTop + (cell.offsetTop === 0 ? cell.offsetHeight : 0)}px`);
  }
  function paint(tiles, loaded, motion) {
    const step = tiles.length > 1 ? (CASCADE_MS - FADE_MS) / (tiles.length - 1) : 0;
    cells = tiles.map((tile, at) => {
      const cell = el('div', `gcsp-release-tile ${motion ? 'is-queued' : 'is-in'}`); cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', tile.label); cell.tabIndex = -1; cell.dataset.tileId = String(tile.id);
      if (motion) cell.style.setProperty('--gcsp-release-delay', `${Math.round(at * step)}ms`);
      if (tile.imageSrc && loaded.has(tile.imageSrc)) {
        const image = el('img'); image.src = tile.imageSrc; image.alt = ''; cell.append(image);
        image.addEventListener('error', () => image.replaceWith(el('span', 'gcsp-release-tile-label', tile.label)));
      } else {
        // Not loaded by the deadline: show the label, and swap the image in if it arrives later.
        const text = el('span', 'gcsp-release-tile-label', tile.label); cell.append(text);
        if (tile.imageSrc) { const late = el('img'); late.alt = ''; late.addEventListener('load', () => text.replaceWith(late)); late.src = tile.imageSrc; }
      }
      return cell;
    });
    const rows = [];
    for (let from = 0; from < cells.length; from += columns) {
      const row = el('div', 'gcsp-release-row'); row.setAttribute('role', 'row'); row.append(...cells.slice(from, from + columns)); rows.push(row);
    }
    root.replaceChildren(...rows, tip); setActive(0);
  }

  function paintLoading(size) {
    root.setAttribute('aria-busy', 'true'); tip.hidden = true; cells = []; active = 0;
    root.replaceChildren(loadingSkeleton({ label: 'Loading released cars', layout: 'release-grid', role: null, items: size }));
  }
  function setLoading() { const size = cells.length || columns * 5; begin(); paintLoading(size); }

  async function show(tiles = [], { animate = true } = {}) {
    const hadFocus = root.contains(root.ownerDocument.activeElement); const run = begin(); paintLoading(tiles.length);
    const srcs = [...new Set(tiles.map((tile) => tile.imageSrc).filter(Boolean))];
    let loaded; try { loaded = new Set(await (preload ? preload(srcs) : defaultPreload(srcs, timeoutMs))); } catch { loaded = new Set(); }
    if (run !== token) return;
    const motion = animate && !reduced();
    tip.hidden = true; paint(tiles, loaded, motion); root.removeAttribute('aria-busy');
    if (hadFocus && root.ownerDocument.activeElement === root.ownerDocument.body) cells[0]?.focus();
    if (!motion) return;
    await new Promise((resolve) => {
      let timer = null; cancelRun = () => { clearTimeout(timer); resolve(); };
      frame(() => {
        if (run !== token) return;
        void root.offsetWidth; // Commit the queued style first, or the browser skips the transition.
        for (const cell of cells) { cell.classList.remove('is-queued'); cell.classList.add('is-in'); }
        timer = setTimeout(resolve, CASCADE_MS);
      });
    });
  }
  function clear() { begin(); root.removeAttribute('aria-busy'); tip.hidden = true; cells = []; active = 0; root.replaceChildren(tip); }
  function destroy() { begin(); root.remove(); }

  root.addEventListener('keydown', (event) => {
    const at = cells.indexOf(event.target.closest?.('[role="gridcell"]')); if (at < 0) return;
    const rowStart = at - (at % columns); const last = cells.length - 1; const ctrl = event.ctrlKey || event.metaKey;
    const to = { ArrowRight: Math.min(at + 1, last), ArrowLeft: Math.max(at - 1, 0), ArrowDown: Math.floor(at / columns) < Math.floor(last / columns) ? Math.min(at + columns, last) : at,
      ArrowUp: at - columns >= 0 ? at - columns : at, Home: ctrl ? 0 : rowStart, End: ctrl ? last : Math.min(rowStart + columns - 1, last) }[event.key];
    if (to === undefined) return;
    event.preventDefault(); setActive(to); cells[to].focus();
  });
  root.addEventListener('focusin', (event) => { const at = cells.indexOf(event.target.closest?.('[role="gridcell"]')); if (at >= 0) { if (at !== active) setActive(at); showTip(cells[at]); } });
  root.addEventListener('focusout', () => { tip.hidden = true; });
  root.addEventListener('mouseover', (event) => { const cell = event.target.closest?.('[role="gridcell"]'); if (cell) showTip(cell); });
  root.addEventListener('mouseleave', () => { tip.hidden = true; });
  return { root, show, setLoading, clear, destroy };
}
