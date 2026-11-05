import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bootAt } from './helpers/launcher-dom.js';
import { experienceChoice, brandSelector, BRAND_LABELS } from '../../blocks/demo-launcher/components.js';
import { ENTRY_REGISTRY } from '../../blocks/demo-launcher/entry-context.js';

const usedLink = (win) => [...win.document.querySelectorAll('.demo-experience-choice a')].find((link) => link.textContent.includes('Used cars'));

test('shared launcher exposes semantic choices, all six labelled brands and a working no-brand retail picker route', () => {
  const { dom, win } = bootAt();
  try {
    assert.equal(win.document.querySelectorAll('main').length, 1);
    assert.equal(win.document.querySelectorAll('h1').length, 1);
    assert.deepEqual([...win.document.querySelectorAll('article h2')].map((node) => node.textContent), ['Employee cars', 'Used cars']);
    const select = win.document.querySelector('select');
    assert.equal(win.document.querySelector('label').htmlFor, select.id);
    assert.deepEqual([...select.options].map((node) => node.value), ['', ...ENTRY_REGISTRY.retailBrands]);
    assert.match(win.document.querySelector('main').textContent, /Employee cars supports BMW/);
    const link = new URL(usedLink(win).href);
    assert.equal(link.searchParams.get('experience'), 'used-cars');
    assert.equal(link.searchParams.has('brand'), false);
    assert.match(win.document.querySelector('article').textContent, /Currently unavailable/);
    assert.equal(win.document.querySelector('a[href*="employee-cars"]'), null);
  } finally { dom.window.close(); }
});

test('native brand changes preserve retail query/hash/API and keep employee BMW switching explicit', () => {
  const { dom, win } = bootAt('?experience=launcher&mode=podium&scope=national&retailer=92&api=http%3A%2F%2Flocalhost%3A8788#m=answers');
  try {
    const select = win.document.querySelector('select');
    select.focus();
    for (const brand of ENTRY_REGISTRY.retailBrands) {
      select.value = brand;
      select.dispatchEvent(new win.Event('change', { bubbles: true }));
      assert.equal(win.document.activeElement, select);
      assert.match(win.document.querySelector('.demo-launcher-selection').textContent, new RegExp(BRAND_LABELS[brand]));
      const link = new URL(usedLink(win).href);
      for (const [key, value] of [['brand', brand], ['mode', 'podium'], ['scope', 'national'], ['retailer', '92'], ['api', 'http://localhost:8788']]) assert.equal(link.searchParams.get(key), value);
      assert.equal(link.hash, '#m=answers');
      assert.equal(link.pathname, '/vehicle-matcher/index.html');
      assert.equal(win.document.querySelector('a[href*="employee-cars"]'), null);
      if (brand !== 'bmw') assert.match(win.document.querySelector('article').textContent, /supports BMW/);
    }
    assert.equal(select.value, 'ferrari');
    const choose = [...win.document.querySelectorAll('button')].find((node) => node.textContent === 'Choose BMW');
    assert.ok(choose);
    choose.click();
    assert.equal(select.value, 'bmw');
    assert.equal(new URL(usedLink(win).href).searchParams.get('brand'), 'bmw');
    const disabled = win.document.querySelector('button:disabled');
    assert.equal(disabled.textContent, 'Employee cars unavailable');
    assert.match(win.document.getElementById(disabled.getAttribute('aria-describedby')).textContent, /not available right now/);
  } finally { dom.window.close(); }
});

test('direct unsupported employee brand stays selected with an explicit Choose BMW even while unavailable', () => {
  const { dom, win } = bootAt('?experience=employee-cars&brand=mini');
  try {
    assert.equal(win.document.querySelector('select').value, 'mini');
    assert.equal(new URL(usedLink(win).href).searchParams.get('brand'), 'mini');
    assert.match(win.document.querySelector('article').textContent, /Choose BMW/);
    assert.match(win.document.querySelector('article').textContent, /currently unavailable/);
  } finally { dom.window.close(); }
});

test('direct unavailable and unsupported employee recovery never restores buyer context', () => {
  for (const brand of ['bmw', 'mini']) {
    const { dom, win } = bootAt(`?experience=employee-cars&brand=${brand}&mode=swipe&scope=national&retailer=96&retailerName=Buyer&answers=private&api=http%3A%2F%2Flocalhost%3A8788#m=buyer-answers`);
    try {
      const verify = (selected) => {
        const links = [...win.document.querySelectorAll('main a[href]')];
        assert.ok(links.length >= 2);
        for (const link of links) {
          const url = new URL(link.href);
          assert.deepEqual([...url.searchParams.keys()].sort(), ['api', 'brand', 'experience']);
          assert.equal(url.searchParams.get('brand'), selected);
          assert.equal(url.searchParams.get('api'), 'http://localhost:8788');
          assert.equal(url.hash, '');
          assert.equal(url.pathname, '/vehicle-matcher/index.html');
        }
      };
      verify(brand);
      if (brand === 'mini') {
        [...win.document.querySelectorAll('button')].find((node) => node.textContent === 'Choose BMW').click();
        verify('bmw');
        assert.equal(win.document.querySelector('a[href*="employee-cars"]'), null);
      }
    } finally { dom.window.close(); }
  }
});

test('launcher consumes the shared GCSP primitive layer while retained retail stays outside it', () => {
  const launcher = bootAt();
  try {
    assert.ok(launcher.win.document.querySelector('main.vm').closest('.gcsp'));
    const css = readFileSync(new URL('../../blocks/demo-launcher/launcher.css', import.meta.url), 'utf8');
    const employee = readFileSync(new URL('../../blocks/gcsp/employee/gcsp-employee.css', import.meta.url), 'utf8');
    const kit = readFileSync(new URL('../../blocks/vehicle-matcher/gcsp-kit.css', import.meta.url), 'utf8');
    assert.match(css, /@import "\.\.\/vehicle-matcher\/gcsp-kit\.css"/);
    assert.match(employee, /@import "\.\.\/\.\.\/vehicle-matcher\/gcsp-kit\.css"/);
    assert.match(kit, /@import "\.\.\/gcsp\/shell\/gcsp-tokens\.css"/);
    assert.match(kit, /\.gcsp \.vm-title \{ font-weight: 600; text-transform: none;/);
    assert.doesNotMatch(employee, /\.gcsp \.vm-title \{/);
    const cfg = JSON.parse(readFileSync(new URL('./ui-ratchet.json', import.meta.url), 'utf8'));
    assert.ok(cfg.stylesheets.some((sheet) => sheet.path === 'blocks/vehicle-matcher/gcsp-kit.css'));
  } finally { launcher.dom.window.close(); }
  const retail = bootAt('?brand=mini');
  try { assert.equal(retail.win.document.querySelector('.demo-shell').closest('.gcsp'), null); }
  finally { retail.dom.window.close(); }
});

test('employee dispatch fails closed for absent, flag-only and disabled capability registrations', () => {
  for (const employeeCapability of [null, true, { enabled: true }, { enabled: 'true', mount() { assert.fail('must not mount'); } }, { enabled: false, mount() { assert.fail('must not mount'); } }]) {
    const { dom, win, mounts } = bootAt('?experience=employee-cars&brand=bmw', { employeeCapability });
    try {
      assert.equal(win.document.getElementById('demo-root').entryContext.state, 'employee-unavailable');
      assert.equal(mounts.length, 0);
      assert.equal(win.document.querySelector('a[href*="employee-cars"]'), null);
      assert.ok(usedLink(win));
    } finally { dom.window.close(); }
  }
});

test('registered enabled employee entry mounts its real callback with safe resolver context', () => {
  const calls = [];
  const employeeCapability = { enabled: true, mount(root, context) {
    calls.push(context);
    root.textContent = 'Registered employee destination';
  } };
  const { dom, win, mounts, ready } = bootAt('?experience=employee-cars&brand=bmw&mode=swipe&retailer=96&api=http%3A%2F%2Flocalhost%3A8788#m=buyer', { employeeCapability });
  try {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].state, 'employee');
    assert.equal(calls[0].brand, 'bmw');
    assert.equal(JSON.stringify(calls).includes('buyer'), false);
    assert.equal(JSON.stringify(calls).includes('retailer'), false);
    assert.equal(mounts.length, 0);
    assert.equal(ready.length, 1);
    assert.equal(win.document.querySelector('.demo-launcher'), null);
    assert.match(win.document.getElementById('demo-root').textContent, /Registered employee destination/);
  } finally { dom.window.close(); }
  const launcher = bootAt('?experience=launcher&brand=mini', { employeeCapability });
  try {
    assert.equal(launcher.win.document.querySelector('a[href*="employee-cars"]'), null);
    [...launcher.win.document.querySelectorAll('button')].find((node) => node.textContent === 'Choose BMW').click();
    const link = launcher.win.document.querySelector('a[href*="employee-cars"]');
    assert.match(link.textContent, /Explore Employee cars/);
    assert.equal(new URL(link.href).searchParams.get('brand'), 'bmw');
  } finally { launcher.dom.window.close(); }
});

test('shared choice handles long titles, loading and broken imagery without losing labels or reasons', () => {
  const { dom, win } = bootAt();
  try {
    const title = 'Employee cars with a very long but meaningful destination name';
    const choice = experienceChoice({ title, description: 'A readable destination.', image: '/missing.jpg',
      action: { label: 'Loading employee experience', disabled: true }, reason: 'Please wait for your account.', status: 'Loading' });
    win.document.querySelector('main').append(choice);
    const image = choice.querySelector('img');
    image.dispatchEvent(new win.Event('error'));
    assert.equal(choice.querySelector('img'), null);
    assert.equal(choice.querySelector('h2').textContent, title);
    assert.match(choice.textContent, /images coming soon/);
    assert.equal(choice.querySelector('[role="status"]').textContent, 'Loading');
    assert.equal(win.document.getElementById(choice.querySelector('button').getAttribute('aria-describedby')).textContent, 'Please wait for your account.');
    const selector = brandSelector({ value: 'motorrad' });
    selector.querySelector('img').dispatchEvent(new win.Event('error'));
    assert.equal(selector.querySelector('select').selectedOptions[0].textContent, 'BMW Motorrad');
    assert.match(selector.textContent, /BMW Motorrad/);
  } finally { dom.window.close(); }
});

test('launcher pages and modules follow external-script CSP and are explicitly ratcheted', () => {
  for (const page of ['index.html', 'components.html']) {
    const source = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<script\b[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i);
    assert.doesNotMatch(source, /\son\w+\s*=/i);
  }
  const dir = new URL('../../blocks/demo-launcher/', import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\b|\son\w+\s*=\s*["']|set(?:Timeout|Interval)\s*\(\s*["']/);
  }
  const cfg = JSON.parse(readFileSync(new URL('./ui-ratchet.json', import.meta.url), 'utf8'));
  assert.ok(cfg.roots.includes('blocks/demo-launcher/'));
  for (const name of ['launcher.css', 'entry-host.css']) assert.ok(cfg.stylesheets.some((sheet) => sheet.path === `blocks/demo-launcher/${name}`));
  const css = readFileSync(new URL('../../blocks/demo-launcher/launcher.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
