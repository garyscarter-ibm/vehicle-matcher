import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { checkSource } from './source-boundaries.mjs';

const root = resolve('/fixture/gcsp-web');
const frozen = resolve(root, 'src/styles/node-gcsp.css');
test('only the exact assembled source sheet may retain source comments and literal source colours', () => {
  assert.doesNotThrow(() => checkSource(frozen, '/* Frozen BMW tokens — original source */ .gcsp { color: #ffffff; background: rgb(0,0,0); }', root));
  for (const path of ['src/styles/node-gcsp-copy.css', 'src/styles/node-gcsp.css.bak', 'src/styles.css', 'src/styles/other/node-gcsp.css', '../other/src/styles/node-gcsp.css']) {
    assert.throws(() => checkSource(resolve(root, path), '/* ordinary source — */ .gcsp {}', root), /on-screen em dash/, path);
    if (path.endsWith('.css')) assert.throws(() => checkSource(resolve(root, path), '.gcsp { color: #fff; }', root), /shared semantic colours/, path);
  }
});
test('the assembled source sheet keeps every dynamic execution and rendering boundary', () => {
  for (const [source, rule] of [
    ["eval('code')", 'dynamic execution'], ["new Function('code')", 'dynamic execution'], ["setTimeout('code', 1)", 'dynamic execution'],
    ['<button onclick="go()">Go</button>', 'inline event attribute'], ['<script>go()</script>', 'inline script'],
    ['node.innerHTML = value', 'unsafe rendering'], ['bypassSecurityTrustHtml(value)', 'unsafe rendering'],
    ["import { model } from '../server/gcsp/model'", 'controller/business import'],
  ]) assert.throws(() => checkSource(frozen, source, root), (error) => error.message.includes(rule), source);
});
test('ordinary Angular sources retain all existing boundaries', () => {
  const path = resolve(root, 'src/app/x.component.ts');
  assert.doesNotThrow(() => checkSource(path, '@Component({template: `<button (click)="open()">Open</button>`})', root));
  assert.throws(() => checkSource(path, "const only = 1; eval('x')", root), /dynamic execution/);
  assert.throws(() => checkSource(path, '@Component({template: `<img onerror="go()">`})', root), /inline event attribute/);
});
