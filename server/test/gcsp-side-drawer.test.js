import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sideDrawer } from '../../blocks/gcsp/kit/side-drawer.js';

test('sideDrawer contains outside focus, excludes hidden disclosure controls, and restores pre-existing inert and scroll state', () => {
  const dom = new JSDOM('<body style="overflow:auto"><aside inert><button>Existing inert</button></aside><main><button id="opener">Open</button><div id="host"></div></main></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  const doc = dom.window.document; const opener = doc.querySelector('#opener');
  const body = doc.createElement('div'); body.innerHTML = '<button hidden>Hidden</button><details><summary>Document</summary><a href="#inside">Closed link</a></details><input id="inside">';
  const footer = doc.createElement('button'); footer.textContent = 'Keep reviewing';
  let drawer;
  try {
    drawer = sideDrawer({ host: doc.querySelector('#host'), title: 'Review', body: [body], footer: [footer], opener });
    assert.equal(opener.hasAttribute('inert'), true); assert.equal(doc.body.style.overflow, 'hidden');
    opener.focus(); assert.equal(doc.activeElement, drawer.panel.querySelector('h2'));
    footer.focus(); doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(doc.activeElement, drawer.panel.querySelector('button'));
    drawer.panel.querySelector('button').focus(); doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(doc.activeElement, footer);
    drawer.setDismissible(false); doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    drawer.root.querySelector('.gcsp-side-drawer-backdrop').click(); assert.equal(drawer.root.isConnected, true);
    drawer.setDismissible(true); drawer.close(); assert.equal(doc.activeElement, opener);
    assert.equal(opener.hasAttribute('inert'), false); assert.equal(doc.querySelector('aside').hasAttribute('inert'), true); assert.equal(doc.body.style.overflow, 'auto');
  } finally { drawer?.close(false); dom.window.close(); globalThis.document = previous; }
});
