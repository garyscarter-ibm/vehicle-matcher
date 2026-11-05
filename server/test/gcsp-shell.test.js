// GCSP shell (FUCQ-64 slice 1): landmarks, navigation, account states, entry contract,
// token isolation and the CSP rules for embeddable blocks.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GCSP_DIR = join(ROOT, 'blocks/gcsp');
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
  const shell = shellMod.portalShell({ navigation: items, active: 'a', breadcrumbs: ['Home', 'Alpha'] });
  document.body.append(shell.root);
  assert.ok(shell.root.querySelector('header.gcsp-header'));
  assert.equal(shell.root.querySelector('nav[aria-label="Portal"]')?.tagName, 'NAV');
  assert.equal(shell.root.querySelectorAll('main').length, 1);
  const skip = shell.root.querySelector('a.gcsp-skip');
  assert.equal(skip.textContent, 'Skip to content');
  assert.equal(skip.getAttribute('href'), `#${shell.main.id}`);
  assert.ok(shell.root.querySelector('header img[alt="BMW"]'));
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
  box.querySelector('.gcsp-account-retry').click();
  assert.equal(retries, 1);
  shell.destroy();
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

test('token isolation: gcsp-tokens.css declares --gcsp-* on .gcsp and --vm-* only under .gcsp .vm', () => {
  const css = stripCss(read('blocks/gcsp/shell/gcsp-tokens.css'));
  assert.ok(!/:root/.test(css), 'no :root');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  assert.deepEqual(blocks.map((b) => b[0]), ['.gcsp', '.gcsp .vm']);
  const props = (body) => [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
  assert.ok(props(blocks[0][1]).length > 20);
  assert.ok(props(blocks[0][1]).every((p) => p.startsWith('--gcsp-')), 'only --gcsp-* on .gcsp');
  assert.ok(props(blocks[1][1]).every((p) => p.startsWith('--vm-')), 'only --vm-* under .gcsp .vm');
  const required = ['surface', 'surface-page', 'surface-raised', 'text', 'text-muted', 'divider', 'accent', 'accent-strong', 'accent-soft', 'on-accent', 'focus', 'danger', 'warning', 'success', 'unavailable', 'header-height', 'sidebar-collapsed', 'sidebar-expanded', 'radius', 'motion'];
  for (const r of required) assert.ok(props(blocks[0][1]).includes(`--gcsp-${r}`), `--gcsp-${r}`);
});

test('every selector in the shell stylesheets starts with .gcsp, and retail tokens are not redefined', () => {
  for (const file of ['blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/shell/gcsp-tokens.css']) {
    const css = stripCss(read(file)).replace(/@import[^;]+;/g, '').replace(/@media[^{]*\{/g, '');
    const selectors = [...css.matchAll(/(?:^|[}\s])([^{}@]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
    assert.ok(selectors.length >= 2, file);
    const bad = selectors.filter((s) => !s.startsWith('.gcsp'));
    assert.deepEqual(bad, [], `${file}: selectors outside .gcsp`);
  }
  assert.match(read('blocks/gcsp/shell/gcsp-shell.css'), /^@import "\.\/gcsp-tokens\.css";/);
  assert.match(read('blocks/gcsp/shell/gcsp-shell.css'), /prefers-reduced-motion: reduce/);
});

test('CSP: no inline scripts, handler attributes, eval, new Function, string timers or innerHTML in GCSP files', () => {
  const files = [...walk(GCSP_DIR), join(ROOT, 'gcsp-employee.html')].filter((f) => /\.(js|html|css)$/.test(f));
  assert.ok(files.length >= 6);
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
  for (const f of walk(GCSP_DIR).filter((p) => p.endsWith('.js'))) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const s of line.match(/([`'"])(?:\\.|(?!\1).)*\1/g) || []) {
        if (s.includes('—')) offenders.push(`${rel(f)}:${i + 1}  ${s}`);
      }
    });
  }
  assert.ok(!read('gcsp-employee.html').includes('—'));
  assert.deepEqual(offenders, []);
});

test('the public launcher stays unavailable for employees', async () => {
  const { ENTRY_REGISTRY } = await import('../../blocks/demo-launcher/entry-context.js');
  assert.equal(ENTRY_REGISTRY.employeeAvailable, false);
});
