// Mockup behaviour only: simulated releases over real display images. No API calls.
(() => {
const CARS = window.MOCK_CARS;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((done) => setTimeout(done, reduced ? 0 : ms));

// Paula's grade and scheme allow these lines; her brief (an estate) is met by the two Tourings.
const ELIGIBLE = new Set(['G61', 'G21', 'U11', 'G26']);
const SUITS = new Set(['G61', 'G21']);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const REASONS = {
  G61: ['Estate body, as Paula asked', 'Fits her grade and scheme', 'Electric, on her company charging plan'],
  G21: ['Estate body, as Paula asked', 'Largest boot she can have', 'Fits her grade and scheme'],
  U11: ['Five seats and a high driving position', 'Fits her grade and scheme', 'Closest boot size to an estate'],
};

let run = 1; let day = 0; let releases = 0; let busy = false; let winner = null; let gridMode = 'tiles';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function draw(seed) {
  const next = rng(seed); const pool = [...CARS];
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(next() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const cars = pool.slice(0, 100);
  // The scenario guarantees at least three cars that suit Paula, from different lines where possible.
  const suiting = cars.filter((car) => SUITS.has(car.line));
  for (const line of SUITS) if (suiting.length < 3 && !suiting.some((car) => car.line === line)) {
    const extra = pool.slice(100).find((car) => car.line === line); if (extra) { cars[cars.length - 1 - suiting.length] = extra; suiting.push(extra); }
  }
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
function funnel(step, n) { const li = $(`[data-step="${step}"]`); li.classList.add('is-on'); countUp($('.pc-funnel-n', li), n); }

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
  if (winner) feed(`${label(day, '1:30pm').split(', ')[0]}, 1:30pm`, `Paula's hold on the ${winner.model} lapsed`);
  // Clock moves to the release time.
  $('[data-clock]').classList.add('is-moving'); await wait(350);
  day = target; releases += 1; setDay(); renderWeek(); setClock(label(day, '11:30am')); $('[data-clock]').classList.remove('is-moving');
  $('[data-headline]').textContent = 'Cars are arriving'; $('[data-sub]').textContent = 'The buddy is looking through them for Paula.';

  const { cars } = draw(run * 7919 + releases * 104729);
  const grid = $('[data-grid-host]'); grid.replaceChildren(); grid.classList.remove('is-narrowing'); grid.dataset.mode = gridMode;
  $$('.pc-funnel li').forEach((li) => { li.classList.remove('is-on'); $('.pc-funnel-n', li).textContent = '0'; });
  $('[data-winner]').hidden = true;
  const nodes = cars.map(tile); grid.append(...nodes);
  $('[data-release-title]').textContent = `${label(day, '11:30am').replace(', 11:30am', '')} release`;
  const lines = new Set(cars.map((c) => c.model)).size; const paints = new Set(cars.map((c) => c.paint)).size;
  nodes.forEach((node, i) => setTimeout(() => node.classList.add('is-in'), reduced ? 0 : i * 9 + (i % 20) * 12));
  await wait(1300);
  $('[data-stats]').textContent = `100 cars · ${lines} model lines · ${paints} colours`;
  const stamp = (t) => `${label(day, t).split(', ')[0]}, ${t}`;
  funnel('released', 100); feed(stamp('11:30am'), '100 cars released');
  await wait(900);

  grid.classList.add('is-narrowing');
  const eligible = cars.map((c, i) => ELIGIBLE.has(c.line) ? i : -1).filter((i) => i >= 0);
  nodes.forEach((n, i) => { if (!ELIGIBLE.has(cars[i].line)) n.classList.add('is-out'); });
  funnel('eligible', eligible.length); await wait(900);
  const suitable = eligible.filter((i) => SUITS.has(cars[i].line));
  eligible.forEach((i) => { if (!SUITS.has(cars[i].line)) nodes[i].classList.add('is-out'); });
  funnel('suitable', suitable.length); await wait(900);

  const pick = suitable[Math.floor(rng(run * 31 + releases)() * suitable.length)];
  suitable.forEach((i) => { if (i !== pick) nodes[i].classList.add('is-out'); });
  grid.classList.remove('is-narrowing'); nodes[pick].classList.add('is-offered'); funnel('offered', 1); await wait(500);

  winner = cars[pick];
  $('[data-winner-img]').src = winner.img; $('[data-winner-name]').textContent = `${winner.model} ${winner.derivative}`;
  $('[data-winner-paint]').textContent = winner.paint; $('[data-winner-hold]').textContent = '1:30pm';
  $('[data-winner-reasons]').replaceChildren(...(REASONS[winner.line] ?? []).map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  $('[data-winner]').hidden = false;
  feed(stamp('11:30am'), `Buddy matched Paula with the ${winner.model}, held for 2 hours`);
  feed(stamp('11:31am'), 'Offer email sent to paula.mason@gcsp-demo.com', 'View email');
  $('[data-headline]').textContent = 'Paula has an offer';
  $('[data-sub]').textContent = `${winner.model} ${winner.derivative}, held until 1:30pm. Over to Paula's portal.`;
  $('[data-portal-img]').src = winner.img; $('[data-portal-name]').textContent = `${winner.model} ${winner.derivative}`;
  $('[data-portal-paint]').textContent = winner.paint;
  releaseButton(); btn.disabled = false; busy = false;
}

function restart() {
  run += 1; day = 0; releases = 0; winner = null;
  setDay(); renderWeek(); setClock(label(0, '9:00am')); releaseButton();
  $('[data-grid-host]').replaceChildren(); $('[data-winner]').hidden = true;
  $$('.pc-funnel li').forEach((li) => { li.classList.remove('is-on'); $('.pc-funnel-n', li).textContent = '0'; });
  $('[data-stats]').textContent = 'Waiting for 11:30am'; $('[data-release-title]').textContent = "Today's release";
  $('[data-feed]').replaceChildren(); feed('Mon 9 Nov, 9:00am', "Paula's preferences confirmed");
  $('[data-headline]').textContent = 'Paula is ready for her buddy';
  $('[data-sub]').textContent = 'Preferences saved. Next release tomorrow, 11:30am.';
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
  if (view === 'portal' && !winner) { const c = CARS.find((x) => x.line === 'G61'); $('[data-portal-img]').src = c.img; }
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
