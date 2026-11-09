// GCSP shell (FUCQ-64 slice 1): landmarks, navigation, account states, entry contract,
// token isolation and the CSP rules for embeddable blocks.
import { test, before, beforeEach } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GCSP_DIR = join(ROOT, 'blocks/gcsp');
const livePages = () => readdirSync(ROOT).filter((file) => /^gcsp-[a-z-]+-live\.html$/.test(file));
let shellMod;
let emp;

// Own jsdom setup: dom-harness.js pulls in the whole server, which this suite doesn't need.
function installDom() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name] ?? globalThis[name], configurable: true, writable: true });
  }
}
const resetDom = () => document.body.replaceChildren();

before(async () => {
  installDom();
  shellMod = await import('../../blocks/gcsp/shell/portal-shell.js');
  emp = await import('../../blocks/gcsp/employee/gcsp-employee.js');
});
beforeEach(() => resetDom());

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const host = () => {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
};
const items = [
  { key: 'a', label: 'Alpha', icon: ['M1 1'], available: true },
  { key: 'b', label: 'Beta', icon: ['M2 2'], available: false, unavailableReason: 'Not available in this demo' },
];

test('shell exposes banner, Portal nav, main and a skip link to main', () => {
  const shell = shellMod.portalShell({ navigation: items, active: 'a', breadcrumbs: ['Home', 'Alpha'], presenterControls: false });
  document.body.append(shell.root);
  assert.ok(shell.root.querySelector('header.gcsp-header'));
  assert.equal(shell.root.querySelector('nav[aria-label="Portal"]')?.tagName, 'NAV');
  assert.equal(shell.root.querySelectorAll('main').length, 1);
  const skip = shell.root.querySelector('a.gcsp-skip');
  assert.equal(skip.textContent, 'Skip to content');
  assert.equal(skip.getAttribute('href'), `#${shell.main.id}`);
  const logo = shell.root.querySelector('header img[alt="BMW GROUP, BMW and MINI"]');
  assert.ok(logo);
  assert.ok(logo.src.endsWith('/assets/brand-logos/bmwgroup-bmw-mini.svg'));
  const crumbs = shell.root.querySelector('nav[aria-label="Breadcrumb"] ol');
  assert.equal(crumbs.children.length, 2);
  assert.equal(crumbs.lastElementChild.getAttribute('aria-current'), 'page');
  shell.setBreadcrumbs([]);
  assert.equal(shell.root.querySelector('nav[aria-label="Breadcrumb"]'), null);
  shell.destroy();
});

test('active item carries aria-current and setActive moves it; unavailable items never become current', () => {
  const calls = [];
  const shell = shellMod.portalShell({ navigation: items, active: 'a', onNavigate: (k) => calls.push(k) });
  document.body.append(shell.root);
  const btn = (k) => shell.root.querySelector(`.gcsp-nav-btn[data-key="${k}"]`);
  assert.equal(btn('a').getAttribute('aria-current'), 'page');
  shell.setActive('b');
  assert.equal(btn('a').getAttribute('aria-current'), null);
  assert.equal(btn('b').getAttribute('aria-current'), null);
  shell.setActive('a');
  assert.equal(btn('a').getAttribute('aria-current'), 'page');
  shell.destroy();
});

test('unavailable navigation is an honest disabled button: no link, explained, does not navigate', () => {
  const calls = [];
  const nav = shellMod.accountNavigation({ items, active: 'a', onNavigate: (k) => calls.push(k) });
  document.body.append(nav.root);
  assert.equal(nav.root.querySelectorAll('a').length, 0);
  assert.equal(nav.root.querySelectorAll('[href]').length, 0);
  const b = nav.root.querySelector('[data-key="b"]');
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.type, 'button');
  assert.equal(b.getAttribute('aria-disabled'), 'true');
  const reason = document.getElementById(b.getAttribute('aria-describedby'));
  assert.match(reason.textContent, /Not available in this demo/);
  b.click();
  assert.deepEqual(calls, []);
  nav.root.querySelector('[data-key="a"]').click();
  assert.deepEqual(calls, ['a']);
  assert.equal(nav.root.querySelector('[data-key="a"]').textContent.trim(), 'Alpha');
  nav.destroy();
});

test('label toggle flips aria-expanded and its own name', () => {
  const toggles = [];
  const nav = shellMod.accountNavigation({ items, onToggle: (v) => toggles.push(v) });
  document.body.append(nav.root);
  const t = nav.root.querySelector('.gcsp-nav-toggle');
  assert.equal(t.getAttribute('aria-expanded'), 'false');
  assert.equal(t.textContent, 'Show labels');
  t.click();
  assert.equal(t.getAttribute('aria-expanded'), 'true');
  assert.equal(t.textContent, 'Hide labels');
  assert.equal(nav.root.dataset.expanded, 'true');
  t.click();
  assert.deepEqual(toggles, [true, false]);
  nav.destroy();
});

test('narrow menu disclosure wires aria-expanded and aria-controls', () => {
  const shell = shellMod.portalShell({ navigation: items });
  document.body.append(shell.root);
  const toggle = shell.root.querySelector('.gcsp-menu-toggle');
  assert.equal(toggle.getAttribute('aria-controls'), shell.root.querySelector('nav[aria-label="Portal"]').id);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  shell.root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  shell.destroy();
});

test('account control: loading, ready, unavailable with Retry, long name keeps its full name', () => {
  let retries = 0;
  const shell = shellMod.portalShell({ navigation: items, account: { status: 'loading' }, onRetryAccount: () => { retries += 1; } });
  document.body.append(shell.root);
  const box = shell.root.querySelector('.gcsp-account');
  assert.equal(box.getAttribute('aria-busy'), 'true');
  assert.equal(box.getAttribute('aria-label'), 'Loading your account');
  const long = 'Bartholomew Featherstonehaugh-Cholmondeley-Wolverstone III';
  shell.setAccount({ status: 'ready', name: long, context: 'Choices, grade G7' });
  assert.equal(box.getAttribute('aria-busy'), 'false');
  assert.equal(box.getAttribute('aria-label'), `Account: ${long}`);
  assert.equal(box.querySelector('.gcsp-account-name').textContent, long);
  assert.equal(box.querySelector('.gcsp-avatar').textContent, 'BI');
  assert.match(box.textContent, /Choices, grade G7/);
  shell.setAccount({ status: 'unavailable', message: 'Your account could not be loaded.' });
  assert.match(box.textContent, /could not be loaded/);
  assert.equal(box.querySelector('.gcsp-account-unavailable [aria-hidden]').textContent, 'Account unavailable');
  assert.equal(box.querySelector('.gcsp-account-unavailable').title, 'Your account could not be loaded.');
  box.querySelector('.gcsp-account-retry').click();
  assert.equal(retries, 1);
  shell.destroy();
});

test('FUCQ-201: a restarted account state keeps the header quiet, with no unavailable label or Retry', () => {
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    const shell = shellMod.portalShell({ navigation: items, account: { status: 'loading' } });
    shell.setAccount({ status });
    const box = shell.root.querySelector('.gcsp-account');
    assert.equal(box.dataset.status, 'restarted'); assert.equal(box.textContent, '');
    assert.equal(box.hasAttribute('aria-label'), false); assert.equal(box.getAttribute('aria-busy'), 'false');
    shell.setAccount({ status: 'ready', name: 'New Person' });
    assert.equal(box.getAttribute('aria-label'), 'Account: New Person');
    shell.destroy();
  }
});

test('shell destroy removes its DOM and listeners', () => {
  let retries = 0;
  const shell = shellMod.portalShell({ navigation: items, account: { status: 'unavailable' }, onRetryAccount: () => { retries += 1; } });
  document.body.append(shell.root);
  const retry = shell.root.querySelector('.gcsp-account-retry');
  shell.destroy();
  assert.equal(document.querySelector('.gcsp'), null);
  retry.click();
  assert.equal(retries, 0);
});

test('ready account disclosure preserves full context, closes with Escape and resets on account changes', () => {
  const name = 'Bartholomew Featherstonehaugh-Cholmondeley-Wolverstone III';
  const shell = shellMod.portalShell({ account: { status: 'ready', name, context: 'Choices, grade G7' } });
  document.body.append(shell.root);
  const details = shell.root.querySelector('.gcsp-account-details');
  const summary = details.querySelector('summary');
  assert.equal(summary.getAttribute('aria-label'), `Account details for ${name}`);
  assert.equal(details.open, false);
  assert.equal(summary.querySelector('.gcsp-account-context'), null, 'scheme context lives in the disclosure');
  summary.click();
  assert.equal(details.open, true);
  assert.equal(details.querySelector('.gcsp-account-panel').textContent, `${name}Choices, grade G7`);
  summary.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(details.open, false);
  assert.equal(document.activeElement, summary);
  summary.click();
  shell.setAccount({ status: 'loading' });
  assert.equal(shell.root.querySelector('.gcsp-account-details'), null);
  shell.setAccount({ status: 'ready', name: 'New Person' });
  assert.equal(shell.root.querySelector('.gcsp-account-details').open, false);
  assert.equal(shell.root.querySelector('.gcsp-account-context'), null);
  assert.equal(shell.root.querySelector('.gcsp-account-detail-name').textContent, 'New Person');
  shell.destroy();
});

test('EMPLOYEE_NAVIGATION is frozen, with cars the only available destination', () => {
  assert.ok(Object.isFrozen(emp.EMPLOYEE_NAVIGATION));
  assert.deepEqual(emp.EMPLOYEE_NAVIGATION.map((i) => i.key), ['cars', 'order', 'history', 'drivers', 'help']);
  assert.deepEqual(emp.EMPLOYEE_NAVIGATION.filter((i) => i.available).map((i) => i.key), ['cars']);
});

test('mountEmployee shows loading then ready, and teardown empties root and aborts the load', async () => {
  const root = host();
  let seen;
  const teardown = emp.mountEmployee(root, {
    brand: 'bmw',
    view: 'cars',
    loadAccount: ({ signal }) => {
      seen = signal;
      return new Promise(() => {});
    },
  });
  assert.equal(root.querySelector('.gcsp-account').getAttribute('aria-busy'), 'true');
  assert.equal(seen.aborted, false);
  teardown();
  assert.equal(seen.aborted, true);
  assert.equal(root.childNodes.length, 0);

  const root2 = host();
  const t2 = emp.mountEmployee(root2, { loadAccount: async () => ({ status: 'ready', name: 'Test Person', context: 'ctx' }) });
  await tick();
  assert.equal(root2.querySelector('.gcsp-account').getAttribute('aria-label'), 'Account: Test Person');
  assert.equal(root2.querySelector('main h1').textContent, 'Your cars');
  t2();
});

test('renderBody receives main, view and account, and its cleanup runs on teardown', async () => {
  const root = host();
  const log = [];
  const teardown = emp.mountEmployee(root, {
    loadAccount: async () => ({ status: 'ready', name: 'Test Person' }),
    renderBody: (main, { view, account }) => {
      log.push(`render:${view}:${account.status}`);
      return () => log.push('cleanup');
    },
  });
  await tick();
  assert.deepEqual(log, ['render:cars:ready']);
  teardown();
  assert.equal(log.at(-1), 'cleanup');
});

test('missing adapter shows the account as unavailable and Retry reloads', async () => {
  const root = host();
  const reasons = [];
  const teardown = emp.mountEmployee(root, { onUnavailable: (r) => reasons.push(r) });
  await tick();
  const box = root.querySelector('.gcsp-account');
  assert.equal(box.getAttribute('aria-label'), 'Account unavailable');
  assert.deepEqual(reasons, ['no-adapter']);
  teardown();

  let calls = 0;
  const root2 = host();
  const t2 = emp.mountEmployee(root2, {
    loadAccount: async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { status: 'ready', name: 'Test Person' };
    },
  });
  await tick();
  root2.querySelector('.gcsp-account-retry').click();
  await tick();
  assert.equal(calls, 2);
  assert.equal(root2.querySelector('.gcsp-account').getAttribute('aria-label'), 'Account: Test Person');
  t2();
});

test('a brand other than bmw renders an honest unavailable state', () => {
  const root = host();
  const reasons = [];
  const teardown = emp.mountEmployee(root, { brand: 'mini', onUnavailable: (r) => reasons.push(r) });
  assert.match(root.textContent, /BMW only/);
  assert.equal(root.querySelector('nav'), null);
  assert.deepEqual(reasons, ['brand-not-supported']);
  teardown();
  assert.equal(root.childNodes.length, 0);
});

test('defineGcspEmployee is idempotent', () => {
  const registry = window.customElements;
  const first = emp.defineGcspEmployee(registry);
  assert.doesNotThrow(() => emp.defineGcspEmployee(registry));
  assert.equal(emp.defineGcspEmployee(registry), first);
  assert.equal(registry.get('gcsp-employee'), emp.GcspEmployeeElement);
});

test('element mounts on connect, emits ready, and tears down on disconnect', async () => {
  emp.defineGcspEmployee(window.customElements);
  const el = document.createElement('gcsp-employee');
  const events = [];
  el.addEventListener('gcsp:ready', (e) => events.push([e.detail, e.bubbles, e.composed, e.cancelable]));
  el.adapter = {
    loadAccount: async () => ({ status: 'ready', name: 'Test Person' }),
    renderBody: (main, { view }) => { main.textContent = `body:${view}`; },
  };
  document.body.append(el);
  await tick();
  assert.deepEqual(events, [[{ view: 'cars', brand: 'bmw' }, true, true, false]]);
  assert.equal(el.querySelector('main').textContent, 'body:cars');
  el.querySelector('[data-key="order"]').click();
  assert.equal(el.getAttribute('view'), null);
  el.remove();
  assert.equal(el.childNodes.length, 0);
});

test('gcsp:navigate carries {from,to}, is cancelable, and switches the view only when not prevented', async () => {
  emp.defineGcspEmployee(window.customElements);
  const nav = [
    { key: 'cars', label: 'Your cars', icon: ['M1 1'], available: true },
    { key: 'extra', label: 'Extra', icon: ['M2 2'], available: true },
  ];
  const el = document.createElement('gcsp-employee');
  el.adapter = { navigation: nav, loadAccount: async () => ({ status: 'ready', name: 'Test Person' }) };
  document.body.append(el);
  await tick();
  const seen = [];
  let prevent = true;
  el.addEventListener('gcsp:navigate', (e) => {
    seen.push([e.detail, e.cancelable]);
    if (prevent) e.preventDefault();
  });
  const go = () => el.querySelector('[data-key="extra"]').click();
  go();
  assert.deepEqual(seen, [[{ from: 'cars', to: 'extra' }, true]]);
  assert.equal(el.getAttribute('view'), null);
  assert.equal(el.querySelector('[data-key="cars"]').getAttribute('aria-current'), 'page');
  prevent = false;
  go();
  assert.equal(el.getAttribute('view'), 'extra');
  assert.equal(el.querySelector('[data-key="extra"]').getAttribute('aria-current'), 'page');
  assert.equal(el.querySelector('nav[aria-label="Breadcrumb"] [aria-current="page"]').textContent, 'Extra');
  assert.equal(el.querySelector('main h1').textContent, 'Extra');
  el.remove();
});

test('element with fixture representative loads the synthetic account; unknown fixture is unavailable', async () => {
  emp.defineGcspEmployee(window.customElements);
  const good = document.createElement('gcsp-employee');
  good.setAttribute('fixture', 'representative');
  document.body.append(good);
  assert.equal(good.querySelector('.gcsp-account').getAttribute('aria-busy'), 'true');
  await tick(450);
  assert.match(good.querySelector('.gcsp-account').getAttribute('aria-label'), /^Account: .*synthetic/);
  good.remove();
  assert.equal(good.childNodes.length, 0);

  const bad = document.createElement('gcsp-employee');
  const reasons = [];
  bad.addEventListener('gcsp:unavailable', (e) => reasons.push(e.detail.reason));
  bad.setAttribute('fixture', 'nonsense');
  document.body.append(bad);
  await tick();
  assert.equal(bad.querySelector('.gcsp-account').getAttribute('aria-label'), 'Account unavailable');
  assert.deepEqual(reasons, ['unknown-fixture']);
  bad.remove();

  const other = document.createElement('gcsp-employee');
  const r2 = [];
  other.addEventListener('gcsp:unavailable', (e) => r2.push(e.detail.reason));
  other.setAttribute('brand', 'ford');
  document.body.append(other);
  assert.deepEqual(r2, ['brand-not-supported']);
  other.remove();
});

// ---------- source scans ----------
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p) => p.slice(ROOT.length);
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('default Density tokens stay on .gcsp, with --vm-* only under .gcsp .vm', () => {
  const local = read('blocks/gcsp/shell/gcsp-tokens.css');
  assert.match(local, /^@import "\.\/density-theme\.css";/, 'all GCSP consumers load Density by default');
  const css = stripCss(read('blocks/gcsp/shell/density-theme.css') + '\n' + read('blocks/gcsp/shell/density-typography.css') + '\n' + local).replace(/@import[^;]+;/g, '');
  assert.ok(!/:root/.test(css), 'no :root');
  assert.ok(!/density-reference/.test(css), 'no opt-in class required');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const props = (body) => [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
  const semantic = blocks.filter(([selector]) => selector === '.gcsp').flatMap(([, body]) => props(body));
  assert.ok(semantic.length > 20);
  assert.ok(semantic.every((p) => p.startsWith('--gcsp-') || p.startsWith('--ds-')), 'GCSP/source tokens only');
  const vm = blocks.find(([selector]) => selector === '.gcsp .vm');
  assert.ok(props(vm[1]).every((p) => p.startsWith('--vm-')), 'only --vm-* under .gcsp .vm');
  const required = ['font', 'font-heading', 'font-heading-weight', 'surface', 'surface-page', 'surface-raised', 'text', 'text-muted', 'divider', 'accent', 'accent-strong', 'accent-soft', 'on-accent', 'focus', 'danger', 'warning', 'success', 'unavailable', 'header-height', 'sidebar-collapsed', 'sidebar-expanded', 'radius', 'motion'];
  for (const r of required) assert.ok(semantic.includes(`--gcsp-${r}`), `--gcsp-${r}`);
});

test('Density heading font assets match the verified BMW downloads and declare their actual weight', () => {
  const manifest = JSON.parse(read('docs/gcsp/density/evidence/font-provenance.json'));
  assert.equal(manifest.family, 'BMWGroupTNCondensedPro-Medium');
  const css = read('blocks/gcsp/shell/fonts/density-fonts.css');
  assert.match(css, /font-weight:\s*500;/);
  assert.match(css, /font-display:\s*swap;/);
  for (const asset of manifest.files) {
    const bytes = readFileSync(join(ROOT, asset.file));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.ok(css.includes(asset.file.split('/').at(-1)), asset.file);
  }
});

test('portal branding retains the verified local Density artwork without external dependencies', () => {
  const asset = JSON.parse(read('docs/gcsp/density/evidence/shell-logo-provenance.json'));
  const bytes = readFileSync(join(ROOT, asset.file));
  assert.equal(bytes.length, asset.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  assert.equal(asset.sources.length, 2);
  assert.ok(!/<script|<foreignObject|\son\w+=|(?:href|src)=["'](?:https?:|javascript:)/i.test(bytes.toString()), 'standalone image only');
});

test('Density typography tokens and aliases retain the pinned source values without missing dependencies', () => {
  const snapshot = JSON.parse(read('docs/gcsp/density/tokens.json'));
  const css = read('blocks/gcsp/shell/density-typography.css');
  assert.match(read('blocks/gcsp/shell/density-theme.css'), /^@import "\.\/density-typography\.css";/);
  assert.match(css, /^@import "\.\/fonts\/density-fonts\.css";/);
  const declarations = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  const resolve = (value) => value.replace(/var\((--[\w-]+)\)/g, (_, key) => {
    assert.ok(declarations[key], `typography dependency ${key}`);
    return resolve(declarations[key]);
  });
  for (const [key, value] of Object.entries(declarations)) {
    if (key.startsWith('--ds-')) assert.equal(value, snapshot.tokens[key], key);
    else assert.equal(resolve(value), snapshot.resolvedGcspAliases[key], key);
  }
  for (const suffix of ['font', 'font-heading', 'font-code', 'font-weight', 'font-strong-weight', 'font-button-weight', 'font-input-weight', 'font-table-header-weight']) {
    assert.ok(declarations[`--gcsp-${suffix}`], suffix);
  }
});

test('every selector in the shell stylesheets starts with .gcsp, and retail tokens are not redefined', () => {
  for (const file of ['blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/shell/gcsp-tokens.css', 'blocks/gcsp/shell/density-theme.css', 'blocks/gcsp/shell/density-typography.css', 'blocks/gcsp/employee/gcsp-employee.css']) {
    const css = stripCss(read(file)).replace(/@import[^;]+;/g, '').replace(/@media[^{]*\{/g, '');
    const selectors = [...css.matchAll(/(?:^|[}\s])([^{}@]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
    assert.ok(selectors.length >= 1, file);
    const bad = selectors.filter((s) => !s.startsWith('.gcsp'));
    assert.deepEqual(bad, [], `${file}: selectors outside .gcsp`);
  }
  assert.match(read('blocks/gcsp/shell/gcsp-shell.css'), /^@import "\.\/gcsp-tokens\.css";/);
  assert.match(read('blocks/gcsp/shell/gcsp-shell.css'), /prefers-reduced-motion: reduce/);
});

test('CSP: no inline scripts, handler attributes, eval, new Function, string timers or innerHTML in GCSP files', () => {
  const files = [...walk(GCSP_DIR), join(ROOT, 'gcsp-employee.html'), join(ROOT, 'gcsp-activity.html'), join(ROOT, 'gcsp-order-progress.html'), join(ROOT, 'gcsp-account.html'), join(ROOT, 'gcsp-presenter.html'), join(ROOT, 'gcsp-manual-setup.html'), join(ROOT, 'gcsp-brief.html'), ...livePages().map((file) => join(ROOT, file)), join(ROOT, 'components.html'), join(ROOT, 'blocks/vehicle-matcher/component-gallery.js'), join(ROOT, 'blocks/vehicle-matcher/ui.js'), join(ROOT, 'blocks/vehicle-matcher/modes/question-ui.js'), join(ROOT, 'blocks/vehicle-matcher/modes/preview-feed.js'), join(ROOT, 'blocks/vehicle-matcher/modes/result-card.js'), join(ROOT, 'blocks/vehicle-matcher/decision-card.css'), join(ROOT, 'blocks/vehicle-matcher/employee-card-fixture.js')].filter((f) => /\.(js|html|css)$/.test(f));
  assert.ok(files.length >= 10);
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const code = f.endsWith('.js') ? src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1') : src;
    if (f.endsWith('.html')) {
      for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (m[2].trim()) offenders.push(`${rel(f)}: inline script body`);
        if (!/\bsrc=/.test(m[1])) offenders.push(`${rel(f)}: script without src`);
      }
      if (/\son[a-z]+\s*=/i.test(src)) offenders.push(`${rel(f)}: inline event handler attribute`);
      if (/javascript:/i.test(src)) offenders.push(`${rel(f)}: javascript: URL`);
    }
    if (f.endsWith('.js')) {
      if (/\beval\s*\(/.test(code)) offenders.push(`${rel(f)}: eval`);
      if (/new\s+Function\b/.test(code)) offenders.push(`${rel(f)}: new Function`);
      if (/\bset(Timeout|Interval)\s*\(\s*(['"`])/.test(code)) offenders.push(`${rel(f)}: string timer`);
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/.test(code)) offenders.push(`${rel(f)}: HTML string injection`);
      if (/\.setAttribute\(\s*['"]on[a-z]+['"]/.test(code)) offenders.push(`${rel(f)}: handler attribute set from JS`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no em dash in any string literal under blocks/gcsp/, and none in the harness page', () => {
  const offenders = [];
  for (const f of [...walk(GCSP_DIR), join(ROOT, 'blocks/vehicle-matcher/ui.js'), join(ROOT, 'blocks/vehicle-matcher/component-gallery.js')].filter((p) => p.endsWith('.js'))) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const s of line.match(/([`'"])(?:\\.|(?!\1).)*\1/g) || []) {
        if (s.includes('—')) offenders.push(`${rel(f)}:${i + 1}  ${s}`);
      }
    });
  }
  assert.ok(!read('gcsp-employee.html').includes('—'));
  assert.ok(!read('gcsp-brief.html').includes('—'));
  for (const file of livePages()) assert.ok(!read(file).includes('—'));
  assert.deepEqual(offenders, []);
});

test('GCSP side stripes stay absent except the supplied reference navigation marker', () => {
  const offenders = [];
  for (const f of walk(GCSP_DIR).filter((p) => p.endsWith('.css'))) {
    for (const rule of stripCss(readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const navigation = rel(f) === 'blocks/gcsp/shell/gcsp-shell.css'
        && rule[1].split(',').every((selector) => ['.gcsp-nav-btn', '.gcsp-nav-toggle'].includes(selector.trim()));
      for (const m of rule[2].matchAll(/border-(left|right)(?:-width)?\s*:\s*([^;}]+)/g)) {
        const width = m[2].match(/(\d+(?:\.\d+)?)px/);
        const marker = navigation && m[1] === 'left' && Number(width?.[1]) <= 3;
        if (width && Number(width[1]) > 1 && !marker) offenders.push(`${rel(f)}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the public launcher stays unavailable for employees', async () => {
  const { ENTRY_REGISTRY } = await import('../../blocks/demo-launcher/entry-context.js');
  assert.equal(ENTRY_REGISTRY.employeeAvailable, false);
});

// ---------- slice 2: kit primitives, representative body, fixtures, gallery ----------
test('kit primitives: screenIntro, button, statusScreen, factList', async () => {
  const ui = await import('../../blocks/vehicle-matcher/ui.js');
  const intro = ui.screenIntro({ kicker: 'K', title: 'T', lede: 'L', level: 1, className: 'x' });
  assert.equal(intro.className, 'x');
  assert.equal(intro.querySelector('h1.vm-title').textContent, 'T');
  assert.equal(intro.querySelector('.vm-kicker').textContent, 'K');
  assert.equal(intro.querySelector('.vm-lede').textContent, 'L');
  assert.equal(ui.screenIntro({ title: 'Only' }).children.length, 1);

  let clicks = 0;
  const primary = ui.button({ label: 'Go', onClick: () => { clicks += 1; } });
  assert.equal(primary.tagName, 'BUTTON');
  assert.equal(primary.type, 'button');
  assert.ok(primary.classList.contains('vm-btn-primary'));
  primary.click();
  assert.equal(clicks, 1);
  const ghost = ui.button({ label: 'Alt', variant: 'ghost', href: '#x' });
  assert.equal(ghost.tagName, 'A');
  assert.ok(ghost.classList.contains('vm-btn-ghost'));
  const off = ui.button({ label: 'No', disabled: true, describedBy: 'why', href: '#x', onClick: () => { clicks += 1; } });
  assert.equal(off.tagName, 'BUTTON');
  assert.equal(off.disabled, true);
  assert.equal(off.getAttribute('aria-describedby'), 'why');

  const status = ui.statusScreen({ kicker: 'K', title: 'Oops', message: 'M', actions: [primary] });
  assert.equal(status.getAttribute('role'), 'status');
  assert.ok(status.classList.contains('vm-status'));
  assert.equal(status.querySelector('h2').textContent, 'Oops');
  assert.equal(ui.statusScreen({ title: 'E', role: 'alert' }).getAttribute('role'), 'alert');

  const facts = ui.factList([
    { label: 'A', value: 'one' },
    { label: 'B', value: 1100, unit: 'points a month' },
    { label: 'C', value: null },
    { label: 'D', value: undefined, missingLabel: 'Unknown' },
  ], { className: 'extra' });
  assert.equal(facts.tagName, 'DL');
  assert.ok(facts.classList.contains('extra'));
  const values = [...facts.querySelectorAll('dd')].map((d) => d.textContent);
  assert.deepEqual(values, ['one', '1,100 points a month', 'Not supplied', 'Unknown']);
  assert.equal(facts.querySelectorAll('dd.is-missing').length, 2);
  assert.doesNotMatch(facts.textContent, /undefined|null/);
});

test('mediaWell placeholder: retail default unchanged, custom text for GCSP', async () => {
  const { mediaWell } = await import('../../blocks/vehicle-matcher/modes/result-card.js');
  const car = { name: 'N', line: 'L', photo: '' };
  assert.equal(mediaWell(car).media.querySelector('.vm-card-soon').textContent, 'Images coming soon');
  assert.equal(mediaWell(car, 'x', { placeholder: 'No image for this car yet' }).media.querySelector('.vm-card-soon').textContent, 'No image for this car yet');
  assert.ok(mediaWell({ ...car, photo: 'a.jpg' }).media.classList.contains('has-photo'));
});

async function mountFixture(name, wait = 450) {
  emp.defineGcspEmployee(window.customElements);
  const node = document.createElement('gcsp-employee');
  node.setAttribute('fixture', name);
  document.body.append(node);
  await tick(wait);
  return node;
}
const cardsOf = (node) => [...node.querySelectorAll('.gcsp-card')];

test('fixture names are explicit and every named fixture is known', async () => {
  const { FIXTURE_NAMES, fixtureAdapter } = await import('../../blocks/gcsp/employee/fixtures.js');
  assert.deepEqual([...FIXTURE_NAMES], ['representative', 'representative-loading', 'representative-unavailable', 'representative-no-images']);
  for (const n of FIXTURE_NAMES) assert.ok(fixtureAdapter(n), n);
  assert.equal(fixtureAdapter('nope'), null);
});

test('representative body: landmarks, one h1, VIN only on the current car, order numbers on stock', async () => {
  const node = await mountFixture('representative');
  assert.equal(node.querySelectorAll('h1').length, 1);
  assert.equal(node.querySelectorAll('main').length, 1);
  assert.ok(node.querySelector('main section.gcsp-feature h2'));
  assert.match(node.querySelector('.gcsp-feature').textContent, /VIN \(synthetic\)/);
  assert.match(node.querySelector('.gcsp-feature').textContent, /ZZSYNTHETIC/);
  assert.match(node.querySelector('.gcsp-feature').textContent, /ends in 27 days/);
  assert.match(node.querySelector('.gcsp-feature').textContent, /6 months, 8,500 miles/);
  const cards = cardsOf(node);
  assert.equal(cards.length, 3);
  for (const c of cards) {
    assert.match(c.textContent, /Order no\. \d{7}/);
    assert.doesNotMatch(c.textContent, /\bVIN\b|ZZSYNTHETIC/);
  }
  const heads = [...node.querySelectorAll('main h1, main h2, main h3')].map((h) => h.tagName);
  assert.equal(heads[0], 'H1');
  assert.ok(heads.every((t, i) => i === 0 || Number(t[1]) <= Number(heads[i - 1][1]) + 1), heads.join());
  assert.match(node.querySelector('.gcsp-synthetic').textContent, /Synthetic example data/);
  node.remove();
});

test('points carry units and are never shown as pounds', async () => {
  const node = await mountFixture('representative');
  const text = node.querySelector('main').textContent;
  assert.doesNotMatch(text, /£/);
  assert.match(text, /1,300 points a month/);
  assert.match(text, /no cash top-up/);
  for (const c of cardsOf(node)) assert.match(c.querySelector('.gcsp-points').textContent, /[\d,]+ points a month/);
  node.remove();
});

test('over-allowance card cannot be selected and says why; selecting updates summary and aria-pressed', async () => {
  const node = await mountFixture('representative');
  const cards = cardsOf(node);
  const over = cards[2].querySelector('.gcsp-pick');
  assert.equal(over.disabled, true);
  assert.match(cards[2].textContent, /100 points over your allowance/);
  assert.match(document.getElementById(over.getAttribute('aria-describedby')).textContent, /Over your allowance by 100 points/);
  assert.ok(cards[2].querySelector('.gcsp-status.is-over svg'), 'icon as well as text and colour');

  const first = cards[0].querySelector('.gcsp-pick');
  assert.equal(first.getAttribute('aria-pressed'), 'false');
  first.click();
  assert.equal(first.getAttribute('aria-pressed'), 'true');
  const live = node.querySelector('.gcsp-summary-live');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.match(live.textContent, /BMW 320i M Sport Touring/);
  assert.match(live.textContent, /1,100 points a month/);
  assert.match(live.textContent, /1,300 points a month/);
  assert.match(live.textContent, /Points left\s*200 points a month/);
  assert.match(node.querySelector('.gcsp-allowance').textContent, /200 points left each month/);
  cards[1].querySelector('.gcsp-pick').click();
  assert.equal(first.getAttribute('aria-pressed'), 'false');
  over.click();
  assert.equal(over.getAttribute('aria-pressed'), 'false');
  cards[1].querySelector('.gcsp-pick').click();
  assert.equal(cards[1].querySelector('.gcsp-pick').getAttribute('aria-pressed'), 'false');
  assert.match(live.textContent, /No car selected/);
  node.remove();
});

test('Reserve is disabled with a visible reason, and Choose a replacement moves focus to the selection heading', async () => {
  const node = await mountFixture('representative');
  cardsOf(node)[0].querySelector('.gcsp-pick').click();
  const reserve = [...node.querySelectorAll('.gcsp-summary .vm-btn')].find((b) => b.textContent === 'Reserve this car');
  assert.equal(reserve.disabled, true);
  assert.match(document.getElementById(reserve.getAttribute('aria-describedby')).textContent, /Reserving is not part of this preview/);
  const choose = node.querySelector('.gcsp-feature .vm-btn-primary');
  assert.equal(choose.textContent, 'Choose a replacement');
  choose.click();
  const heading = node.querySelector('.gcsp-selection-heading');
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.equal(document.activeElement, heading);
  assert.equal(node.querySelector('.gcsp-selection').getAttribute('aria-labelledby'), heading.id);
  node.remove();
});

test('missing image shows the placeholder and a missing fact says Not supplied', async () => {
  const node = await mountFixture('representative');
  const cards = cardsOf(node);
  assert.equal(cards[1].querySelector('img.vm-card-photo'), null);
  assert.equal(cards[1].querySelector('.vm-card-soon').textContent, 'No image for this car yet');
  assert.ok(cards[0].querySelector('img.vm-card-photo'));
  assert.equal(cards[1].querySelector('.vm-card-line'), null, 'no image caption without an image');
  assert.equal(cards[0].querySelector('.vm-card-line').textContent, 'BMW brand image, not this model');
  assert.match(cards[1].querySelector('.vm-fact-value.is-missing').textContent, /^Not supplied$/);
  assert.match(node.querySelector('.gcsp-details').textContent, /Licence numberNot supplied/);
  assert.match(cards[1].querySelector('.gcsp-card-name').textContent, /Technology Plus and Comfort Pack/);
  assert.doesNotMatch(node.textContent, /undefined|null/);
  node.remove();
});

test('named fixtures render their states', async () => {
  const noImages = await mountFixture('representative-no-images');
  assert.equal(noImages.querySelectorAll('img.vm-card-photo').length, 0);
  assert.equal(noImages.querySelectorAll('.vm-card-soon').length, 4);
  assert.equal(cardsOf(noImages).length, 3);
  noImages.remove();

  const loading = await mountFixture('representative-loading', 450);
  assert.equal(loading.querySelector('.gcsp-account').getAttribute('aria-busy'), 'true');
  assert.equal(loading.querySelector('.gcsp-rep'), null);
  assert.match(loading.querySelector('main [role="status"]').textContent, /Loading your account/);
  loading.remove();
  assert.equal(loading.childNodes.length, 0);

  const bad = await mountFixture('representative-unavailable', 400);
  assert.equal(bad.querySelector('.gcsp-account').getAttribute('aria-label'), 'Account unavailable');
  assert.equal(bad.querySelector('.gcsp-card'), null);
  const status = bad.querySelector('main .vm-status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.match(status.textContent, /not available right now/);
  assert.match(status.textContent, /Retry/);
  assert.equal(bad.querySelectorAll('h1').length, 1);
  bad.remove();
});

test('loading fixture still respects abort', async () => {
  const { fixtureAdapter } = await import('../../blocks/gcsp/employee/fixtures.js');
  const controller = new AbortController();
  const pending = fixtureAdapter('representative-loading').loadAccount({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('countdown wording comes from the injected date', async () => {
  const { countdown } = await import('../../blocks/gcsp/employee/representative-body.js');
  assert.equal(countdown('2026-11-05', '2026-12-02'), 'ends in 27 days');
  assert.equal(countdown('2026-12-01', '2026-12-02'), 'ends in 1 day');
  assert.equal(countdown('2026-12-02', '2026-12-02'), 'ends today');
  assert.equal(countdown('2026-12-05', '2026-12-02'), 'ended 3 days ago');
});

test('fixture points equal the keyed seed-v1.json entries, with key and version recorded', async () => {
  const seed = JSON.parse(read('server/gcsp/policy/seed-v1.json'));
  const byKey = new Map([...seed.allowances, ...seed.pricePlans].map((e) => [e.key, e]));
  const { representativeData } = await import('../../blocks/gcsp/employee/fixtures.js');
  const data = representativeData();
  const entries = [data.allowance, data.currentCar.points, ...data.stock.map((c) => c.points)];
  assert.equal(entries.length, 5);
  for (const e of entries) {
    const entry = byKey.get(e.policyKey);
    assert.ok(entry, e.policyKey);
    assert.equal(e.value, entry.value, e.policyKey);
    assert.equal(e.value, entry.monthlyPoints, e.policyKey);
    assert.equal(e.policyVersion, seed.policyVersion);
    assert.match(e.status, /synthetic/);
  }
  assert.ok(data.stock.every((c) => !('vin' in c) && c.orderUuid && c.configurationId && /^\d{7}$/.test(c.orderNumber)));
});

test('harness page loads the harness module and the body stylesheet; the element never reads location', () => {
  const html = read('gcsp-employee.html');
  assert.match(html, /blocks\/gcsp\/employee\/harness\.js/);
  assert.match(html, /blocks\/gcsp\/employee\/gcsp-employee\.css/);
  const harness = read('blocks/gcsp/employee/harness.js');
  assert.match(harness, /FIXTURE_NAMES\.includes/);
  // Page hosts only: the offer entry captures and scrubs the email-link fragment (bc8a941a); the presenter page opens Help (112fdfe2).
  const liveHosts = ['activity/live.js', 'order-progress/live.js', 'offer/entry.js', 'offer/http-adapter.js',
    'presenter-controls/workspace.js'].map((file) => join(GCSP_DIR, file));
  for (const f of walk(GCSP_DIR).filter((p) => p.endsWith('.js') && !p.endsWith('harness.js') && !liveHosts.includes(p))) {
    assert.doesNotMatch(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1'), /\b(?:window|globalThis)\s*\.\s*(?:location|history)\b|\b(?:location|history)\.(?:href|search|pathname|hash|pushState|replaceState|back|forward|go)\b/, rel(f));
  }
});

test('the activity live host navigates only to the fixed Brief page without URL-selected state', () => {
  const host = read('blocks/gcsp/activity/live.js');
  assert.deepEqual([...host.matchAll(/^import .*? from '([^']+)';$/gm)].map((match) => match[1]), [
    '../shell/account-runtime.js', './activity-http.js', '../cases/http-adapter.js', './gcsp-activity.js',
  ]);
  assert.match(host, /globalThis\.location\.assign\('\/gcsp-brief-live\.html'\)/);
  assert.equal((host.match(/\blocation\b/g) || []).length, 1);
  assert.doesNotMatch(host, /URLSearchParams|location\.(?:search|hash)|\bhistory\./);
});

test('the order progress pages load the custom element through external modules only and navigate to fixed pages', () => {
  const live = read('gcsp-order-progress-live.html');
  assert.match(live, /<gcsp-order-progress[^>]+data-live/);
  assert.deepEqual([...live.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1].trim()), ['type="module" src="./blocks/gcsp/order-progress/live.js"']);
  assert.match(live, /blocks\/gcsp\/order-progress\/gcsp-order-progress\.css/);
  const harness = read('gcsp-order-progress.html');
  assert.deepEqual([...harness.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1].trim()), ['type="module" src="./blocks/gcsp/order-progress/harness.js"']);
  assert.match(harness, /id="gcsp-order-progress-preview"/);
  const host = read('blocks/gcsp/order-progress/live.js');
  assert.deepEqual([...host.matchAll(/^import .*? from '([^']+)';$/gm)].map((match) => match[1]), [
    '../shell/account-runtime.js', './order-progress-http.js', '../cases/http-adapter.js', '../account/http-adapter.js', './order-car.js', './gcsp-order-progress.js',
  ]);
  assert.deepEqual([...host.matchAll(/location\.assign\(([^)]*)\)/g)].map((m) => m[1]), ['page']);
  assert.deepEqual([...host.matchAll(/'(\/gcsp-[a-z-]+\.html)'/g)].map((m) => m[1]), ['/gcsp-brief-live.html', '/gcsp-activity-live.html']);
  assert.doesNotMatch(host, /URLSearchParams|location\.(?:search|hash)|\bhistory\./);
  assert.equal(read('blocks/gcsp/order-progress/register.js').includes('defineGcspOrderProgress()'), true);
  assert.match(read('server/gcsp/host.js'), /'\/gcsp-order-progress-live\.html'/);
});

test('the single gallery shows the GCSP section with primitives and shell states', async () => {
  const { mountComponentGallery } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const root = document.createElement('div');
  document.body.append(root);
  mountComponentGallery(root);
  const section = root.querySelector('.vm-gallery-gcsp-section');
  assert.ok(section);
  assert.ok(section.querySelector('.gcsp'), 'GCSP examples sit in a .gcsp container');
  assert.equal(root.querySelectorAll('.gcsp').length >= 1, true);
  assert.equal(section.querySelectorAll('.gcsp-header').length, 4);
  const states = [...section.querySelectorAll('.gcsp-account')].map((a) => a.dataset.status);
  assert.deepEqual(states, ['loading', 'ready', 'ready', 'unavailable']);
  assert.equal(section.querySelectorAll('.gcsp-account-details[open]').length, 1);
  assert.ok(section.querySelector('.vm-btn-primary:disabled'));
  assert.ok(section.querySelector('.vm-btn-ghost'));
  assert.ok(section.querySelector('.vm-status[role="status"]'));
  assert.ok(section.querySelector('.vm-fact-value.is-missing'));
  assert.equal(section.querySelector('.vm-card-soon').textContent, 'No image for this car yet');
  assert.equal(section.querySelectorAll('nav.gcsp-nav').length >= 5, true);
  assert.equal(section.querySelectorAll('.gcsp-nav[data-expanded="true"]').length >= 1, true);
  assert.ok(section.querySelector('.gcsp-nav-btn[aria-disabled="true"]'));
  assert.doesNotMatch(section.textContent, /undefined|null/);
  assert.ok(read('components.html').includes('blocks/gcsp/shell/gcsp-shell.css'));
  assert.ok(read('components.html').includes('blocks/gcsp/employee/gcsp-employee.css'));
  assert.equal(statSync(join(ROOT, 'components.html')).isFile(), true);
});


test('shell presenter region mounts an injected CONTROL adapter and tears it down', async () => {
  let signal;
  const adapter = { readControls: async (options) => { signal = options.signal; return { status: 'forbidden' }; } };
  const shell = shellMod.portalShell({ presenterControls: { adapter } }); document.body.append(shell.root); await tick();
  assert.ok(shell.presenterRegion); assert.equal(shell.presenterRegion.querySelector('details').hidden, true);
  shell.destroy(); assert.equal(signal.aborted, true);
  const offline = shellMod.portalShell({ presenterControls: false }); assert.equal(offline.presenterRegion.children.length, 0); offline.destroy();
});
