import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasInlineEvent } from './inline-events.mjs';

test('TypeScript identifiers that start with "on" are not inline event attributes', () => {
  for (const source of [
    'const only = (value: Record<string, unknown>, keys: readonly string[]): boolean => true;',
    'let onlyKeys = 1; const one = 2; var onboarding= 3;',
    'export class Store { online = signal(false); onChange = () => {}; }',
    "@Component({ selector: 'x', template: `<button (click)=\"go()\">Go</button>` })\nconst only = 1;",
  ]) assert.equal(hasInlineEvent('src/app/x.store.ts', source), false, source);
});

test('inline event attributes in .html files are rejected', () => {
  assert.equal(hasInlineEvent('src/app/x.component.html', '<button onclick="go()">Go</button>'), true);
  assert.equal(hasInlineEvent('src/index.html', '<body ONLOAD = "boot()">'), true);
  assert.equal(hasInlineEvent('src/app/x.component.html', '<button (click)="go()">Go</button>'), false);
});

test('inline event attributes in inline template strings are rejected', () => {
  for (const source of [
    "@Component({ selector: 'x', template: `<button onclick=\"go()\">Go</button>` })",
    "@Component({ selector: 'x', template: '<a href=\"#\" onmouseover=\"go()\">Go</a>' })",
    '@Component({ selector: "x", template: "<img src=\\"a.png\\" onerror=\\"go()\\">" })',
  ]) assert.equal(hasInlineEvent('src/app/x.component.ts', source), true, source);
});

test('inline event attributes in SVG artwork are rejected', () => {
  assert.equal(hasInlineEvent('src/assets/logo.svg', '<svg onload="go()"></svg>'), true);
});
