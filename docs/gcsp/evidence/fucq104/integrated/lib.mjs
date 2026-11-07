// CDP driver helpers: keyboard-only interaction, read-only evaluation, owned Chrome lifecycle.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);

export async function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); s.on('error', rej); });
}

export async function launchChrome(scratch) {
  const profile = await mkdtemp(join(scratch, 'profile-'));
  const port = await freePort();
  const child = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--lang=en-GB', '--disable-gpu', 'about:blank'],
  { detached: true, stdio: 'ignore', env: { ...process.env, TMPDIR: scratch } });
  child.unref();
  let list;
  for (let i = 0; i < 60 && !list; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const rows = await r.json(); list = rows.find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!list) throw new Error('Chrome did not expose a page target');
  return { pid: child.pid, port, profile, wsUrl: list.webSocketDebuggerUrl };
}

export async function stopChrome(chrome) {
  if (!chrome) return;
  try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* gone */ }
  await sleep(800);
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* gone */ }
  if (chrome.profile && chrome.profile.startsWith('/') && chrome.profile.includes('/profile-')) await rm(chrome.profile, { recursive: true, force: true });
}

export class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.listeners = []; }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await withTimeout(new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); }), 10000, 'ws open');
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? rej(new Error(`${msg.error.message}`)) : res(msg.result); }
      else if (msg.method) for (const l of this.listeners) l(msg);
    };
  }
  on(fn) { this.listeners.push(fn); }
  send(method, params = {}, ms = 15000) {
    const id = ++this.id;
    return withTimeout(new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }), ms, method);
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const KEYS = {
  Tab: { code: 'Tab', vk: 9 }, Enter: { code: 'Enter', vk: 13, text: '\r' }, ' ': { code: 'Space', vk: 32, text: ' ' },
  Escape: { code: 'Escape', vk: 27 }, ArrowDown: { code: 'ArrowDown', vk: 40 }, ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, Backspace: { code: 'Backspace', vk: 8 },
  End: { code: 'End', vk: 35 }, Home: { code: 'Home', vk: 36 },
};

export class Page {
  constructor(cdp) { this.cdp = cdp; }
  async key(key, { shift = false } = {}) {
    const k = KEYS[key]; const modifiers = shift ? 8 : 0;
    const base = { key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
    await this.cdp.send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text } : {}) });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(40);
  }
  async type(text) {
    for (const ch of text) {
      if (ch === ' ') { await this.key(' '); continue; }
      const upper = ch.toUpperCase(); const punct = { '-': [189, 'Minus', 0], '.': [190, 'Period', 0], ':': [186, 'Semicolon', 8], '/': [191, 'Slash', 0] }[ch];
      const vk = punct ? punct[0] : upper.charCodeAt(0);
      const code = punct ? punct[1] : /[a-z]/i.test(ch) ? `Key${upper}` : /[0-9]/.test(ch) ? `Digit${ch}` : '';
      const shifted = /[A-Z]/.test(ch) ? 8 : punct ? punct[2] : 0;
      const base = { key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: ch, unmodifiedText: ch, modifiers: shifted };
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(25);
    }
  }
  // READ-ONLY evaluation.
  async read(expr) {
    const r = await this.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  active() { return this.read(`(() => {
    const a = document.activeElement; if (!a || a === document.body) return { tag: 'body', name: '' };
    const lab = (a.labels && a.labels[0]?.textContent) || a.getAttribute('aria-label') || '';
    const legend = a.closest('fieldset')?.querySelector('legend')?.textContent || '';
    const cs = getComputedStyle(a);
    return { tag: a.tagName.toLowerCase(), type: a.type || '', id: a.id || '', name: (lab || a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      legend: legend.trim(), role: a.getAttribute('role') || '', checked: a.checked ?? null, value: a.value ?? '', disabled: !!a.disabled,
      focusVisible: a.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, boxShadow: cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 60) : '',
      rect: (() => { const r = a.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() };
  })()`); }
  async tabTo(match, { max = 400, shift = false, order = null } = {}) {
    for (let i = 0; i <= max; i++) {
      const d = await this.active();
      if (match(d)) return d;
      if (i === max) break;
      await this.key('Tab', { shift });
      if (order) { const n = await this.active(); order.push(`${n.tag}${n.type ? '[' + n.type + ']' : ''}:${n.legend ? n.legend + '/' : ''}${n.name}`); }
    }
    throw new Error('tabTo: target not reached within ' + max + ' Tab presses; last=' + JSON.stringify(await this.active()));
  }
  async shot(path, { fullPage = false } = {}) {
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000);
    await writeFile(path, Buffer.from(r.data, 'base64'));
  }
  async setViewport(width, height) {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await sleep(400);
  }
  async waitFor(expr, ms = 15000, what = expr) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await this.read(expr)) return true; } catch { /* retry */ } await sleep(200); }
    throw new Error('waitFor timeout: ' + what);
  }
}
