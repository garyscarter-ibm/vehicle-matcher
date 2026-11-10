// Mockup behaviour only: simulated releases over real display images. No API calls.
(() => {
const CARS = window.MOCK_CARS;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((done) => setTimeout(done, reduced ? 0 : ms));

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let run = 1; let day = 0; let releases = 0; let stock = 0; let busy = false; let gridMode = 'tiles';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function draw(seed) {
  const next = rng(seed); const pool = [...CARS];
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(next() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const cars = pool.slice(0, 100);
  return { cars, next };
}

// Day 0 is Mon 9 Nov 2026. Releases are weekdays at 11:30am.
const dateOf = (offset) => new Date(Date.UTC(2026, 10, 9 + offset));
const label = (offset, time) => { const d = dateOf(offset); return `${DAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} Nov, ${time}`; };
const nextReleaseDay = (from) => { let d = from + 1; while ((dateOf(d).getUTCDay() + 6) % 7 > 4) d += 1; return d; };

function renderWeek() {
  const week = $('[data-week]'); week.replaceChildren();
  const monday = day - day % 7;
  for (let i = monday; i < monday + 7; i += 1) {
    const li = document.createElement('li'); li.textContent = `${DAYS[i - monday]} ${dateOf(i).getUTCDate()}`;
    if (i - monday > 4) li.classList.add('is-weekend');
    if (i < day) li.classList.add('is-done'); if (i === day) { li.classList.add('is-today'); li.setAttribute('aria-current', 'date'); }
    week.append(li);
  }
}
function setClock(text) { $('[data-clock]').textContent = text; $$('[data-pane="advanced"] .pc-clock').forEach((n) => { n.textContent = text; }); }
function setDay() { const t = `Day ${day + 1}`; $('[data-day]').textContent = t; $$('[data-pane="advanced"] .pc-day').forEach((n) => { n.textContent = t; }); }
function feed(time, text, link) {
  const li = document.createElement('li'); const t = document.createElement('time'); t.textContent = time;
  const s = document.createElement('span'); s.textContent = text; li.append(t, s);
  if (link) { const a = document.createElement('a'); a.href = '#'; a.textContent = link; li.append(a); }
  $('[data-feed]').prepend(li);
}
function releaseButton() {
  const target = nextReleaseDay(day); const btn = $('[data-release]');
  btn.textContent = target === day + 1 ? "Release tomorrow's cars" : `Release ${LONG[(dateOf(target).getUTCDay() + 6) % 7]}'s cars`;
  return target;
}
function countUp(node, to, ms = 600) {
  if (reduced) { node.textContent = String(to); return; }
  const from = Number(node.textContent) || 0; const start = performance.now();
  const step = (now) => { const p = Math.min(1, (now - start) / ms); node.textContent = String(Math.round(from + (to - from) * p)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

const PAINT = [[/white/i, '#f2f2f0'], [/black|sapphire|carbon/i, '#1b1c20'], [/grey|gray|dravit|oxide/i, '#7b7e82'], [/silver/i, '#c4c6c8'],
  [/blue|portimao|tanzanite|storm/i, '#2a4f86'], [/red|barbera/i, '#a3242a'], [/green|york|isle/i, '#3e5a48'], [/orange/i, '#d06a2a']];
const swatch = (paint) => (PAINT.find(([re]) => re.test(paint)) ?? [null, '#9a8f80'])[1];

function tile(car, i) {
  const node = document.createElement('div'); node.className = 'pc-tile'; node.setAttribute('role', 'gridcell');
  node.dataset.index = String(i); node.style.background = gridMode === 'dots' ? swatch(car.paint) : '';
  node.setAttribute('aria-label', `${car.model} ${car.derivative}, ${car.paint}`);
  const img = document.createElement('img'); img.src = car.img; img.alt = ''; img.loading = 'eager'; img.decoding = 'async';
  node.append(img); return node;
}

async function release() {
  if (busy) return; busy = true; const btn = $('[data-release]'); btn.disabled = true;
  const target = nextReleaseDay(day);
  $('[data-clock]').classList.add('is-moving'); await wait(350);
  day = target; releases += 1; setDay(); renderWeek(); setClock(label(day, '11:30am')); $('[data-clock]').classList.remove('is-moving');
  $('[data-headline]').textContent = 'Releasing cars'; $('[data-sub]').textContent = 'New stock is arriving on the scheme.';

  const { cars } = draw(run * 7919 + releases * 104729);
  const grid = $('[data-grid-host]'); grid.replaceChildren(); grid.dataset.mode = gridMode;
  const nodes = cars.map(tile); grid.append(...nodes);
  $('[data-release-title]').textContent = `${label(day, '11:30am').replace(', 11:30am', '')} release`;
  nodes.forEach((node, i) => setTimeout(() => node.classList.add('is-in'), reduced ? 0 : i * 9 + (i % 20) * 12));
  await wait(1300);

  const byLine = new Map(); cars.forEach((c) => byLine.set(c.model, (byLine.get(c.model) ?? 0) + 1));
  const paints = new Set(cars.map((c) => c.paint)).size; stock += cars.length;
  countUp($('[data-total="cars"]'), 100); countUp($('[data-total="lines"]'), byLine.size);
  countUp($('[data-total="paints"]'), paints); countUp($('[data-total="stock"]'), stock);
  const rows = [...byLine].sort((x, y) => y[1] - x[1]).map(([model, n]) => {
    const li = document.createElement('li'); const name = document.createElement('span'); name.textContent = model;
    const bar = document.createElement('span'); bar.className = 'pc-bar'; const fill = document.createElement('span'); bar.append(fill);
    const num = document.createElement('span'); num.className = 'pc-bar-n'; num.textContent = String(n);
    li.append(name, bar, num); requestAnimationFrame(() => { fill.style.width = `${n * 2}%`; }); return li;
  });
  $('[data-lines]').replaceChildren(...rows);
  $('[data-stats]').textContent = '100 cars, ready for the buddy to match';
  const stamp = (t) => `${label(day, t).split(', ')[0]}, ${t}`;
  feed(stamp('11:30am'), `100 cars released across ${byLine.size} model lines`);
  await wait(700);
  feed(stamp('11:31am'), 'Buddy run complete, offers sent to matched employees', 'View emails');
  $('[data-headline]').textContent = `${stock} cars on the scheme`;
  $('[data-sub]').textContent = `Latest release ${label(day, '11:30am')}. Matches show in each employee's portal.`;
  releaseButton(); btn.disabled = false; busy = false;
}

function restart() {
  run += 1; day = 0; releases = 0; stock = 0;
  setDay(); renderWeek(); setClock(label(0, '9:00am')); releaseButton();
  $('[data-grid-host]').replaceChildren(); $('[data-lines]').replaceChildren();
  $$('[data-total]').forEach((n) => { n.textContent = '0'; });
  $('[data-stats]').textContent = 'Waiting for 11:30am'; $('[data-release-title]').textContent = "Today's release";
  $('[data-feed]').replaceChildren(); feed('Mon 9 Nov, 9:00am', 'Scheme started, no cars on the scheme yet');
  $('[data-headline]').textContent = 'Ready for the next release';
  $('[data-sub]').textContent = 'Next release tomorrow, 11:30am.';
}

// Confirm dialog for Start again.
const dialog = $('[data-confirm]');
$('[data-restart]').addEventListener('click', () => { dialog.hidden = false; $('[data-confirm-yes]').focus(); });
$('[data-confirm-no]').addEventListener('click', () => { dialog.hidden = true; $('[data-restart]').focus(); });
$('[data-confirm-yes]').addEventListener('click', () => { dialog.hidden = true; restart(); $('[data-release]').focus(); });
dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('[data-confirm-no]').click(); });
$('[data-release]').addEventListener('click', release);

// Grid: hover/focus tooltip, arrow keys move between tiles.
const grid = $('[data-grid-host]'); let tip; let focusIndex = 0;
function showTip(node) {
  tip?.remove(); if (!node) return; tip = document.createElement('div'); tip.className = 'pc-tip'; tip.textContent = node.getAttribute('aria-label');
  const box = node.getBoundingClientRect(); const host = grid.getBoundingClientRect();
  tip.style.left = `${box.left - host.left + box.width / 2}px`; tip.style.top = `${box.top - host.top}px`; grid.append(tip);
}
grid.addEventListener('pointerover', (e) => showTip(e.target.closest('.pc-tile')));
grid.addEventListener('pointerleave', () => tip?.remove());
grid.addEventListener('keydown', (e) => {
  const tiles = $$('.pc-tile', grid); if (!tiles.length) return;
  const cols = gridMode === 'dots' ? 25 : 20; const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  if (move === undefined) return; e.preventDefault();
  tiles[focusIndex]?.classList.remove('is-focus'); focusIndex = Math.max(0, Math.min(tiles.length - 1, focusIndex + move));
  tiles[focusIndex].classList.add('is-focus'); showTip(tiles[focusIndex]);
});

// Review bar and mode toggles.
function show(view) {
  $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== view; });
  $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $$('[data-only]').forEach((n) => { n.hidden = n.dataset.only !== view; });
  if (view === 'portal') { const c = CARS.find((x) => x.line === 'G61'); $('[data-portal-img]').src = c.img; }
}
$$('[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
document.addEventListener('click', (e) => { const go = e.target.closest('[data-goto]'); if (go) { e.preventDefault(); show(go.dataset.goto); } });
$$('[data-grid]').forEach((b) => b.addEventListener('click', () => {
  gridMode = b.dataset.grid; $$('[data-grid]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const g = $('[data-grid-host]'); g.dataset.mode = gridMode;
  $$('.pc-tile', g).forEach((n, i) => { n.style.background = gridMode === 'dots' ? swatch(n.getAttribute('aria-label').split(', ').pop()) : ''; void i; });
}));
$$('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
  $$('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
}));

// Warm the image cache so the cascade shows cars, not empty frames; the build would use thumbnails.
CARS.forEach((car) => { const img = new Image(); img.src = car.img; });
renderWeek(); setDay();
})();
