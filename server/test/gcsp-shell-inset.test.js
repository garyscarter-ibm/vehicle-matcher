// FUCQ-284: the shell owns one content inset, a crumb-only location label and the presenter strip alignment.
// Static pins on the stylesheets; the browser proof is docs/gcsp/evidence/fucq-284/browser-check.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const css = (path) => readFileSync(join(ROOT, path), 'utf8');
const shell = css('blocks/gcsp/shell/gcsp-shell.css');
const inset = css('blocks/gcsp/shell/shell-inset.css');
const rule = (source, selector) => source.split('\n').find((line) => line.startsWith(selector)) ?? '';

test('the shell imports the inset sheet; .gcsp-content pads from the token at every width', () => {
  assert.match(shell, /@import "\.\/shell-inset\.css";/);
  assert.match(inset, /^\.gcsp-content \{[^}]*padding: var\(--gcsp-space-5\) var\(--gcsp-content-inset\) var\(--gcsp-space-8\);/m);
  assert.match(shell, /\.gcsp-content \{ padding: var\(--gcsp-space-4\) var\(--gcsp-content-inset\) var\(--gcsp-space-6\); \}/);
  assert.doesNotMatch(shell, /\.gcsp-content \{[^}]*padding: \d+px \d+px/, 'no literal horizontal padding on .gcsp-content');
});

test('the token is defined on .gcsp-content for wide, middle and narrow widths', () => {
  assert.match(inset, /^\.gcsp-content \{ --gcsp-content-inset: var\(--gcsp-space-6\);/m);
  assert.match(inset, /@media \(min-width: 900px\) \{ \.gcsp-content \{ --gcsp-content-inset: var\(--gcsp-space-12\); \} \}/);
  assert.match(inset, /@media \(max-width: 600px\) \{ \.gcsp-content \{ --gcsp-content-inset: var\(--gcsp-space-4\); \} \}/);
});

test('page roots under .gcsp-main add no horizontal inset or centring; nested .vm is untouched', () => {
  const line = rule(inset, '.gcsp .gcsp-main > .vm');
  assert.match(line, /\.gcsp \.gcsp-main > :not\(\[class\]\) > \.vm/, 'activity wraps its root in a bare div');
  assert.match(line, /padding-inline: 0; margin-inline: 0;/);
  assert.doesNotMatch(inset, /\.gcsp-main \.vm[\s,{]/, 'no descendant .vm rule: cards keep their own padding');
});

test('a kicker right before the page h1 is hidden; the shell crumb is the only location label', () => {
  assert.match(inset, /\.gcsp \.gcsp-main \.vm-kicker:has\(\+ h1\) \{ display: none; \}/);
});

test('the shell content no longer styles a presenter strip; the flyout owns it', () => {
  assert.doesNotMatch(inset, /gcsp-presenter-region/);
});
