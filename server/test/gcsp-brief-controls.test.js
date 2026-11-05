import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom } from './dom-harness.js';
import { renderRangeSlider, renderOptionList } from '../../blocks/vehicle-matcher/modes/question-ui.js';

let dom;
before(() => { dom = installDom(); });
after(() => dom.window.close());
beforeEach(() => resetDom());
const q = { id: 'comfort', label: 'Comfort', min: 0, max: 100, step: 1, default: 50 };
const choices = { id: 'body', label: 'Body style', options: [
  { value: 'estate', label: 'Estate' }, { value: 'coupe', label: 'Coupe', disabled: true },
  { value: 'saloon', label: 'Saloon' }, { value: 'suv', label: 'SUV' },
] };
const key = (node, value) => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));

test('single-slider update keeps the focused node, projects state and disability, and emits no edit', () => {
  const root = document.createElement('div'); document.body.append(root);
  const edits = [];
  const control = renderRangeSlider(root, q, null, { single: true, value: 70, valueState: 'unconfirmed', onValueChange: (v) => edits.push(v) });
  const input = root.querySelector('input'); input.focus();
  assert.equal(typeof control?.update, 'function', 'consumer needs a controlled projection handle');
  control.update({ value: 85, valueState: 'confirmed' });
  assert.equal(root.querySelector('input'), input);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, '85');
  assert.equal(input.getAttribute('aria-valuetext'), '85');
  control.update({ value: null, valueState: 'unknown', disabled: true });
  assert.equal(input.value, '85', 'unknown projection does not choose a default position');
  assert.equal(input.disabled, true);
  assert.equal(root.querySelector('output').textContent, 'Not supplied');
  assert.deepEqual(edits, []);
  control.update({ value: 0, valueState: 'confirmed', disabled: false });
  assert.equal(input.getAttribute('aria-valuetext'), '0');
  input.value = '4'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(edits, [4]);
});

test('legacy single slider retains starting answer mutation and later callback order after projected updates', () => {
  const root = document.createElement('div'); const answers = {}; const changes = [];
  const control = renderRangeSlider(root, q, answers, { single: true, onChange: () => changes.push(answers.comfort) });
  assert.equal(answers.comfort, 50);
  assert.deepEqual(changes, []);
  assert.equal(typeof control?.update, 'function');
  control.update({ value: 10, valueState: 'confirmed' });
  assert.equal(answers.comfort, 50, 'presentation update is not an answer write');
  const input = root.querySelector('input'); input.value = '20';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(answers.comfort, 20); assert.deepEqual(changes, [20]);
});

test('option update retains its Set and button identities, clears explicitly, and never emits callbacks', () => {
  const edits = []; const input = ['search'];
  const result = renderOptionList({ id: 'consent', label: 'Buddy permission', multi: true, options: [
    { value: 'search', label: 'Search' }, { value: 'hold', label: 'Hold' },
  ] }, null, { value: input, onValueChange: (v) => edits.push(v) });
  document.body.append(result.list);
  const selected = result.selected; const buttons = [...result.list.querySelectorAll('button')]; buttons[0].focus();
  assert.equal(typeof result.update, 'function');
  result.update({ value: ['hold'], disabled: false });
  assert.equal(result.selected, selected); assert.deepEqual([...selected], ['hold']);
  assert.equal(result.list.querySelector('button'), buttons[0]); assert.equal(document.activeElement, buttons[0]);
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-checked')), ['false', 'true']);
  result.update({ value: [] }); assert.equal(selected.size, 0);
  result.update({ disabled: true }); assert.ok(buttons.every((b) => b.disabled));
  assert.deepEqual(edits, []); assert.deepEqual(input, ['search']);
});

test('actual single-choice radio groups rove with arrows and Home/End while skipping disabled options', () => {
  const edits = [];
  const { list } = renderOptionList(choices, null, { value: 'estate', onValueChange: (v) => edits.push(v) });
  document.body.append(list); const buttons = [...list.querySelectorAll('button')];
  assert.deepEqual(buttons.map((b) => b.tabIndex), [0, -1, -1, -1]);
  buttons[0].focus(); key(buttons[0], 'ArrowRight');
  assert.equal(document.activeElement, buttons[2]); assert.deepEqual(edits, ['saloon']);
  key(buttons[2], 'End'); assert.equal(document.activeElement, buttons[3]);
  key(buttons[3], 'ArrowDown'); assert.equal(document.activeElement, buttons[0]);
  key(buttons[0], 'ArrowLeft'); assert.equal(document.activeElement, buttons[3]);
  key(buttons[3], 'Home'); assert.equal(document.activeElement, buttons[0]);
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-checked')), ['true', 'false', 'false', 'false']);
  assert.deepEqual(edits, ['saloon', 'suv', 'estate', 'suv', 'estate']);
});

test('legacy single-choice radio input preserves answer writes and onChange before onPick', () => {
  const answers = { body: 'estate' }; const events = [];
  const { list, update } = renderOptionList(choices, answers, { onChange: () => events.push(`change:${answers.body}`), onPick: () => events.push('pick') });
  document.body.append(list); const buttons = [...list.querySelectorAll('button')]; buttons[0].focus();
  key(buttons[0], 'ArrowRight');
  assert.equal(answers.body, 'saloon'); assert.deepEqual(events, ['change:saloon', 'pick']);
  update({ value: null }); assert.equal(answers.body, 'saloon');
  assert.ok(buttons.every((b) => b.getAttribute('aria-checked') === 'false'));
  assert.equal(document.activeElement, buttons[2]);
  assert.deepEqual(events, ['change:saloon', 'pick']);
});

test('multiselect retains separate tab stops and existing any/max answer mutations without radio arrow effects', () => {
  const answers = { equipment: ['any'] }; const events = [];
  const { list, selected, update } = renderOptionList({ id: 'equipment', multi: true, max: 1, options: [
    { value: 'any', label: 'Any' }, { value: 'towbar', label: 'Towbar' }, { value: 'sunroof', label: 'Sunroof' },
  ] }, answers, { onChange: () => events.push([...answers.equipment]), onPick: () => assert.fail('multi never picks') });
  document.body.append(list); const buttons = [...list.querySelectorAll('button')]; buttons[1].focus();
  key(buttons[1], 'ArrowRight'); assert.equal(document.activeElement, buttons[1]); assert.deepEqual(answers.equipment, ['any']);
  assert.ok(buttons.every((b) => b.tabIndex === 0));
  buttons[1].click(); buttons[2].click(); assert.deepEqual(answers.equipment, ['towbar']);
  update({ value: [] }); assert.equal(selected.size, 0); assert.deepEqual(answers.equipment, ['towbar']);
  buttons[2].click(); assert.deepEqual(answers.equipment, ['sunroof']);
  assert.deepEqual(events, [['towbar'], ['sunroof']]);
});
