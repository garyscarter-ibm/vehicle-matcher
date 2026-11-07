import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { el, button, statusScreen } from '../../../blocks/vehicle-matcher/ui.js';
import { ENTRY_REGISTRY, resolveEntryContext, buildEntryUrl, rememberRetailLocation, retailReturnUrl } from '../../../blocks/demo-launcher/entry-context.js';
import { createRetailChrome, observeRetailNavigation } from '../../../blocks/demo-launcher/retail-chrome.js';
import { renderLauncher } from '../../../blocks/demo-launcher/launcher.js';

const origin = 'https://example.test/vehicle-matcher/';

// Execute the real extracted boot, resolver, gate, chrome and launcher in jsdom.
// Only the retail network mount is replaced; standalone keeps its actual inline boot.
export function bootAt(suffix = '', { remote = false, stored = null, standalone = false,
  employeeCapability = null, retailReturn = null } = {}) {
  const page = standalone ? 'block.html' : 'index.html';
  const html = readFileSync(new URL(`../../../${page}`, import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: `${remote ? origin : 'http://localhost:3000/vehicle-matcher/'}${page}${suffix}`, runScripts: 'outside-only' });
  const win = dom.window; const mounts = []; const ready = [];
  const globals = ['document', 'window', 'Image', 'Event', 'getComputedStyle', 'HTMLElement', 'customElements', 'CustomEvent', 'sessionStorage', 'AbortController'];
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globals.forEach((key) => { globalThis[key] = win[key]; });
  const close = win.close.bind(win);
  win.close = () => {
    win.document.getElementById('demo-root')?.demoEntryCleanup?.();
    close();
    previous.forEach((descriptor, key) => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  };
  win.decorate = (block) => { mounts.push(block); };
  win.ACCESS_KEY_STORAGE = 'vmAccessKey';
  Object.assign(win, { el, button, statusScreen, retailReturnUrl, ENTRY_REGISTRY, resolveEntryContext, buildEntryUrl, rememberRetailLocation, createRetailChrome, observeRetailNavigation, renderLauncher, employeeCapability });
  if (retailReturn) win.sessionStorage.setItem('vm-retail-return', retailReturn);
  if (stored) win.sessionStorage.setItem(win.ACCESS_KEY_STORAGE, stored);
  win.document.addEventListener('demo-entry-ready', (event) => ready.push(event.detail));
  const source = standalone ? html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    : readFileSync(new URL('../../../blocks/demo-launcher/boot.js', import.meta.url), 'utf8');
  const script = source.replace(/import[\s\S]*?from ['"][^'"]+['"];\s*/g, '').replace(/\bexport /g, '');
  win.eval(script + (standalone ? '' : '\nbootDemo({ employeeCapability });'));
  return { dom, win, mounts, ready };
}
