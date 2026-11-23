import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
const pattern = JSON.parse(fs.readFileSync(new URL('./ui-ratchet.json', import.meta.url), 'utf8')).patterns['angular-source-kit'].re;
const matches = source => [...source.matchAll(new RegExp(pattern, 'g'))].length;
const cases = [
  ['real directive before class', '<button gcspButton class="vm-btn vm-btn-primary">', 0],
  ['real directive after class', '<button class="vm-btn vm-btn-primary" gcspButton>', 0],
  ['real anchor directive', '<a class="vm-btn vm-btn-ghost" gcspButton>', 0],
  ['real directive with value', '<button class="vm-btn" gcspButton="">', 0],
  ['real directive after quoted value', '<button title="a > b" gcspButton class="vm-btn">', 0],
  ['title before class', '<button title="gcspButton" class="vm-btn vm-btn-primary">', 1],
  ['title after class', '<button class="vm-btn vm-btn-primary" title="gcspButton">', 1],
  ['single quoted title', "<button class='vm-btn' title='gcspButton'>", 1],
  ['directive-looking quoted words', '<button class="vm-btn" title=" gcspButton = enabled">', 1],
  ['quoted handler value', '<button class="vm-btn" (click)="gcspButton()">', 1],
  ['unquoted title', '<button title=gcspButton class="vm-btn">', 1],
  ['spaced unquoted title', '<button title= gcspButton class="vm-btn">', 1],
  ['data attribute before class', '<button data-gcspButton class="vm-btn">', 1],
  ['data attribute after class', '<button class="vm-btn" data-gcspButton>', 1],
  ['data attribute value', '<button class="vm-btn" data-label="gcspButton">', 1],
  ['attribute suffix', '<button gcspButtonish class="vm-btn">', 1],
  ['attribute prefix', '<button othergcspButton class="vm-btn">', 1],
  ['handwritten source button', '<button class="vm-btn vm-btn-primary">', 1],
  ['handwritten source anchor', '<a class="vm-btn vm-btn-ghost">', 1],
  ['other source root', '<section class="gcsp-bell">', 1],
  ['other root cannot use directive exemption', '<button gcspButton class="gcsp-bell">', 1],
  ['tracker root', '<section class="gcsp-stage-tracker">', 1],
  ['activity root', '<ul class="gcsp-activity-timeline">', 1],
];
for (const [name, source, count] of cases) test(name, () => assert.equal(matches(source), count, source));

const sourceRoots = ['vm-btn', 'gcsp-bell', 'gcsp-stage-tracker', 'gcsp-stage-list', 'gcsp-task-list', 'gcsp-slot-picker', 'gcsp-activity-timeline', 'gcsp-range-bar', 'gcsp-release-grid', 'gcsp-help-tip', 'gcsp-star-rating', 'gcsp-understanding', 'gcsp-buddy-status'];
const sourceTags = ['button', 'a', 'div', 'section', 'ul', 'figure', 'details'];
for (const tag of sourceTags) for (const root of sourceRoots) {
  test(`original matrix ${tag}.${root}`, () => assert.equal(matches(`<${tag} class="${root}">`), 1));
  test(`directive only exempts canonical button matrix ${tag}.${root}`, () => assert.equal(matches(`<${tag} gcspButton class="${root}">`), root === 'vm-btn' && ['button', 'a'].includes(tag) ? 0 : 1));
}
