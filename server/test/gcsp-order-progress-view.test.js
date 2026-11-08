import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const fixtureFile = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const approvalShapes = fixtureFile('gcsp-lifecycle-approval-outcomes.json');
const documentShapes = fixtureFile('gcsp-lifecycle-documents-outcomes.json');
const appointmentShapes = fixtureFile('gcsp-lifecycle-appointment-outcomes.json');
const returnShapes = fixtureFile('gcsp-lifecycle-return-plan-outcomes.json');

let dom; let orderProgressBody; let fixtures; let approvalExamples; let names;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
  ({ orderProgressBody } = await import('../../blocks/gcsp/order-progress/order-progress-body.js'));
  const mod = await import('../../blocks/gcsp/order-progress/fixtures.js');
  ({ approvalExamples } = mod); names = mod.orderProgressFixtureNames; fixtures = mod.orderProgressFixtures();
});
after(() => dom?.window.close());
beforeEach(() => document.body.replaceChildren());

const log = () => ({ calls: [], fn(name) { return (...args) => { this.calls.push([name, ...args]); }; } });
function callbacks(spy) {
  return { onRetry: spy.fn('retry'), onCompleteTask: spy.fn('task'), onRequestAppointment: spy.fn('request'), onAcceptAppointment: spy.fn('accept'),
    onRequestReturn: spy.fn('request-return'), onAcceptReturn: spy.fn('accept-return'), onHelp: spy.fn('help') };
}
const view = (name, extra = {}) => { const node = orderProgressBody({ progress: structuredClone(fixtures.states[name]), car: fixtures.car, ...extra }); document.body.append(node); return node; };
const section = (node, name) => node.querySelector(`.gcsp-order-${name}`);
const buttons = (node) => [...node.querySelectorAll('button')].map((b) => b.textContent);
const sorted = (o) => Object.keys(o).sort();

test('every fixture state renders with one h1, labelled sections, no em dash and no markup injection', () => {
  assert.equal(names.length, 26);
  for (const name of names) {
    const node = view(name, callbacks(log()));
    assert.equal(node.querySelectorAll('h1').length, 1, name);
    assert.doesNotMatch(node.textContent, /—/, name);
    assert.doesNotMatch(node.textContent, /undefined|null|Invalid Date|NaN/, name);
    for (const s of node.querySelectorAll('section.gcsp-order-section')) assert.equal(document.getElementById(s.getAttribute('aria-labelledby')).tagName, 'H2', name);
    document.body.replaceChildren();
  }
});

test('fixtures are the producer shapes: key lists equal the producer fixtures and the approval envelopes are equal', () => {
  assert.deepEqual(approvalExamples.pending(), approvalShapes.pending);
  assert.deepEqual(approvalExamples.declined(), approvalShapes.declined);
  assert.deepEqual(approvalExamples['sent-to-ordering'](), approvalShapes['sent-to-ordering']);
  assert.deepEqual(approvalExamples.unsupported(), approvalShapes.unsupported);
  const optionalItem = new Set([...Object.keys(documentShapes.optionalItemKeys), 'acknowledgement']);
  for (const name of names) {
    const p = fixtures.states[name]; if (p.phase !== 'ready') continue;
    assert.deepEqual(sorted(p.stages.value), sorted(approvalShapes.pending.value), name);
    const order = p.documents.value?.orders?.[0];
    if (order) {
      assert.deepEqual(sorted(order), [...documentShapes.orderKeys].sort(), name);
      for (const item of order.items) assert.deepEqual(sorted(item).filter((k) => !optionalItem.has(k)), [...documentShapes.itemKeys].sort(), name);
      for (const task of order.tasks) assert.deepEqual(sorted(task), [...documentShapes.taskKeys].sort(), name);
      assert.deepEqual(sorted(order.readiness), [...documentShapes.readinessKeys].sort(), name);
    }
    const a = p.appointment.value;
    if (a) {
      assert.deepEqual(sorted(a), [...appointmentShapes.readModelKeys].sort(), name);
      for (const h of a.history) assert.deepEqual(sorted(h), [...appointmentShapes.historyKeys].sort(), name);
      for (const s of a.offeredSlots) assert.deepEqual(sorted(s), [...appointmentShapes.slotKeys].sort(), name);
      assert.equal(appointmentShapes.enums.state.includes(a.state), true, name);
    }
    const r = p.returnPlan.value;
    if (r) {
      assert.deepEqual(sorted(r), [...returnShapes.readModelKeys].sort(), name);
      if (r.applicable) {
        assert.deepEqual(sorted(r.currentCar), [...returnShapes.currentCarKeys].sort(), name);
        assert.deepEqual(sorted(r.returnMileage), [...returnShapes.returnMileageKeys].sort(), name);
        assert.deepEqual(sorted(r.location), [...returnShapes.locationKeys].sort(), name);
        assert.deepEqual(sorted(r.handover), [...returnShapes.handoverKeys].sort(), name);
        assert.deepEqual(sorted(r.appointment), [...returnShapes.appointmentKeys].sort(), name);
        assert.deepEqual(sorted(r.offeredSlots), [...returnShapes.offeredSlotsKeys].sort(), name);
        for (const c of r.choices) assert.deepEqual(sorted(c), [...returnShapes.choiceKeys].sort(), name);
        for (const h of r.history) assert.deepEqual(sorted(h), [...returnShapes.historyKeys].sort(), name);
      } else assert.deepEqual([r.applicable, r.state, r.scheduled], [returnShapes.newOrder.applicable, returnShapes.newOrder.state, returnShapes.newOrder.scheduled], name);
    }
  }
});

test('HR approval appears only when the server stage list contains it, and stage names are the server names in sentence case', () => {
  const withHr = view('waiting-sales-manager');
  const list = fixtures.states['waiting-sales-manager'].stages.value.stages.map((s) => s.stage);
  const labels = (node) => [...node.querySelectorAll('.gcsp-stage-label')].map((n) => n.textContent);
  assert.deepEqual(labels(withHr), list.map((s) => s[0].toUpperCase() + s.slice(1)));
  assert.ok(labels(withHr).includes('HR approval'));
  document.body.replaceChildren();
  const without = view('no-hr');
  assert.deepEqual(labels(without), ['Selection received', 'Sales-manager approval', 'Sent to ordering']);
  assert.doesNotMatch(without.textContent, /HR/);
});

test('current stage carries aria-current, its owner and its next step; the order and car are named', () => {
  const node = view('waiting-sales-manager');
  const current = node.querySelectorAll('[aria-current="step"]'); assert.equal(current.length, 1);
  assert.match(current[0].textContent, /Sales-manager approval/); assert.match(current[0].textContent, /With the sales manager/); assert.match(current[0].textContent, /Next: Sales-manager decision/);
  assert.match(node.textContent, /Fictional BMW i4 eDrive40 M Sport/); assert.match(node.textContent, /Order no\. 1000001/);
  assert.match(node.textContent, /No image for this car yet/);
  assert.match(view('waiting-hr').querySelector('[aria-current="step"]').textContent, /With HR/);
});

test('missing car details are named, not invented', () => {
  const node = orderProgressBody({ progress: structuredClone(fixtures.states['waiting-hr']) });
  assert.match(node.textContent, /Car details not supplied/); assert.match(node.textContent, /Order no\. 1000001/);
});

test('declined shows the declined stage, the next step and a help entry', () => {
  const spy = log(); const node = view('declined', callbacks(spy));
  const row = [...node.querySelectorAll('.gcsp-stage')].find((r) => r.classList.contains('is-declined'));
  assert.match(row.textContent, /Sales-manager approval/); assert.match(row.textContent, /Declined/); assert.match(row.textContent, /Next: Scheme team reviews the decline/);
  assert.equal(node.querySelector('[aria-current="step"]'), null);
  const help = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Get help'); help.click(); assert.deepEqual(spy.calls, [['help']]);
  document.body.replaceChildren();
  const mounted = []; const hosted = view('declined', { mountHelp: (host) => mounted.push(host) });
  assert.equal(mounted.length, 1); assert.ok(hosted.contains(mounted[0])); assert.equal(buttons(hosted).includes('Get help'), false);
});

test('an unsupported live provider reads as not updated, with the reason, and not as done', () => {
  const node = view('provider-unsupported');
  const row = node.querySelector('[aria-current="step"]');
  assert.match(row.textContent, /HR approval/); assert.match(row.textContent, /Not updated/); assert.match(row.textContent, /not connected in this demonstration/);
  assert.doesNotMatch(row.textContent, /Done/);
});

test('handover: not eligible says it opens once sent to ordering and offers no control', () => {
  const node = view('waiting-sales-manager', callbacks(log()));
  assert.match(section(node, 'handover').textContent, /open once your order is sent to ordering/); assert.equal(section(node, 'handover').querySelector('button'), null);
});

test('handover: offered slots are one button each and request the exact slot', () => {
  const spy = log(); const node = view('sent-to-ordering-no-slot', callbacks(spy));
  const handover = section(node, 'handover'); const slots = [...handover.querySelectorAll('button')];
  const offered = fixtures.states['sent-to-ordering-no-slot'].appointment.value.offeredSlots;
  assert.equal(slots.length, offered.length); assert.match(slots[0].textContent, /^Request 8 Nov 2026, 09:00$/);
  slots[1].click(); assert.deepEqual(spy.calls, [['request', offered[1].slotId]]);
  assert.doesNotMatch(handover.textContent, /Booked/);
});

test('handover: requested and proposed are never booked; scheduled is', () => {
  const requested = section(view('appointment-requested'), 'handover');
  assert.match(requested.textContent, /Requested 8 Nov 2026, 09:00\. Not booked yet\./); assert.doesNotMatch(requested.textContent, /Booked/);
  assert.match(requested.textContent, /Waiting for the retailer/);
  document.body.replaceChildren();
  const proposed = section(view('appointment-change-proposed'), 'handover');
  assert.match(proposed.textContent, /New time proposed: 8 Nov 2026, 13:00\. Not booked yet\./); assert.doesNotMatch(proposed.textContent, /Booked:/);
  document.body.replaceChildren();
  const scheduled = section(view('appointment-scheduled'), 'handover');
  assert.match(scheduled.textContent, /Booked: 8 Nov 2026, 09:00/);
});

test('handover: a proposed change can be accepted or sent to help, and nothing else is invented', () => {
  const spy = log(); const handover = section(view('appointment-change-proposed', callbacks(spy)), 'handover');
  assert.deepEqual(buttons(handover), ['Accept new time', "Can't make it? Get help"]);
  const [accept, help] = handover.querySelectorAll('button'); accept.click(); help.click();
  assert.deepEqual(spy.calls, [['accept', 'proposal-1'], ['help']]);
  assert.doesNotMatch(handover.textContent, /decline|refuse|reject|cancel/i);
});

test('handover: an uncertain write waits, with no actions', () => {
  const handover = section(view('appointment-pending', callbacks(log())), 'handover');
  assert.match(handover.textContent, /Waiting for confirmation of your last update/); assert.equal(handover.querySelector('button'), null);
  assert.doesNotMatch(handover.textContent, /Booked/);
});

test('documents: employee tasks come first with their action; others show owner and due time', () => {
  const spy = log(); const docs = section(view('documents-waiting-for-you', callbacks(spy)), 'documents');
  const groups = [...docs.querySelectorAll('.gcsp-task-group-heading')].map((h) => h.textContent);
  assert.deepEqual(groups, ['Your tasks', 'Being handled by others']);
  const [mine, ...others] = docs.querySelectorAll('.gcsp-task');
  assert.match(mine.textContent, /Vehicle agreement/); assert.match(mine.textContent, /Synthetic acknowledgement, not a signature/);
  const go = mine.querySelector('button'); assert.equal(go.textContent, 'Acknowledge the agreement'); go.click();
  assert.deepEqual(spy.calls, [['task', 'agreement-acknowledgement']]);
  assert.match(others[0].textContent, /Scheme team/); assert.match(others[0].textContent, /Due 6 Nov 2026, 15:00/);
  assert.match(others[1].textContent, /Retailer/); assert.equal(docs.querySelectorAll('.gcsp-task button').length, 1);
  assert.match(docs.textContent, /Not ready for handover/);
});

test('documents: completed acknowledgement keeps the server label and offers no action', () => {
  const docs = section(view('documents-in-progress', callbacks(log())), 'documents');
  assert.equal(docs.querySelector('button'), null); assert.match(docs.textContent, /Synthetic acknowledgement\. Not a signature\./);
  assert.match(docs.textContent, /Still to do: Vehicle preparation, Delivery to the retailer/);
});

test('documents: overdue and failed are distinct in text and class', () => {
  const overdue = section(view('documents-overdue'), 'documents');
  const late = overdue.querySelector('.gcsp-task.is-overdue'); assert.match(late.textContent, /Overdue/); assert.equal(overdue.querySelector('.gcsp-task.is-failed'), null);
  document.body.replaceChildren();
  const failed = section(view('documents-failed'), 'documents');
  const broken = failed.querySelector('.gcsp-task.is-failed'); assert.match(broken.textContent, /Failed: The synthetic provider reported this step as failed\./);
  assert.doesNotMatch(broken.textContent, /Overdue/); assert.equal(failed.querySelector('.gcsp-task.is-overdue'), null);
  assert.match(failed.textContent, /Needs attention: Driving licence check/);
});

test('documents: ready reads Ready for handover; closed says documents open once sent to ordering', () => {
  assert.match(section(view('ready-for-handover'), 'documents').textContent, /Ready for handover/);
  assert.doesNotMatch(section(view('ready-for-handover'), 'documents').textContent, /Not ready/);
  document.body.replaceChildren();
  assert.match(section(view('waiting-hr'), 'documents').textContent, /open once your order is sent to ordering/);
});

test('documents: accepts a lone order and a not-open status as well as the producer list', () => {
  const p = structuredClone(fixtures.states['documents-waiting-for-you']);
  const alone = { ...p, documents: { status: 'ok', value: p.documents.value.orders[0] } };
  assert.match(section(orderProgressBody({ progress: alone }), 'documents').textContent, /Vehicle agreement/);
  assert.match(section(orderProgressBody({ progress: { ...p, documents: { status: 'not-open', reason: 'opening-stage-not-reached' } } }), 'documents').textContent, /open once/);
});

test('return plan is its own section, shows the current car unchanged in every state, and a new order has none', () => {
  const states = ['return-unavailable', 'return-not-planned', 'return-requested', 'return-change-proposed', 'return-scheduled'];
  for (const name of states) {
    const node = view(name, callbacks(log()));
    const plan = section(node, 'return'); assert.ok(plan, name);
    assert.equal(plan.closest('.gcsp-order-handover'), null, name);
    assert.match(plan.querySelector('h2').textContent, /Returning your current car/);
    assert.match(plan.textContent, /Fictional BMW 320i Touring/, name); assert.match(plan.textContent, /G21 320i M Sport Touring/, name);
    assert.match(plan.textContent, /stays yours until it is returned/, name);
    assert.doesNotMatch(section(node, 'handover').textContent, /return|Fictional BMW 320i/i, name);
    document.body.replaceChildren();
  }
  assert.equal(section(view('new-order'), 'return'), null);
  assert.doesNotMatch(view('new-order').textContent, /Returning your current car/);
});

test('FUCQ-194: the return place is her home address on the buddy route, "Not supplied" without one, and the chosen place on the manual route', () => {
  const fact = (name, label) => [...section(view(name), 'return').querySelectorAll('.vm-fact')].find((row) => row.querySelector('dt').textContent === label);
  const home = fact('return-buddy-home', 'Collection from your home address');
  assert.ok(home); assert.equal(home.querySelector('dd').textContent, '1 Fictional Way, Example Town, ZZ1 1ZZ'); document.body.replaceChildren();
  const none = fact('return-buddy-no-address', 'Collection from your home address');
  assert.equal(none.querySelector('dd').textContent, 'Not supplied'); assert.ok(none.querySelector('dd').classList.contains('is-missing')); document.body.replaceChildren();
  assert.equal(fact('return-not-planned', 'Return place').querySelector('dd').textContent, 'Fictional BMW retailer'); document.body.replaceChildren();
  assert.equal(fact('return-not-planned', 'Collection from your home address'), undefined, 'the manual route never claims a home collection');
  document.body.replaceChildren();
});

test('return plan: choices call back with the exact choice and slot; unavailable choices show why', () => {
  const spy = log(); const plan = section(view('return-not-planned', callbacks(spy)), 'return');
  const all = [...plan.querySelectorAll('button')]; assert.equal(all.length, 4);
  const r = fixtures.states['return-not-planned'].returnPlan.value;
  all[0].click(); all[2].click();
  assert.deepEqual(spy.calls, [['request-return', { choice: 'same-visit', slotId: r.offeredSlots['same-visit'][0].slotId }],
    ['request-return', { choice: 'separate', slotId: r.offeredSlots.separate[1].slotId }]]);
  assert.deepEqual([...plan.querySelectorAll('[role="group"]')].map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent),
    ['Return it when the new car is handed over', 'Return it on a separate day']);
  document.body.replaceChildren();
  const blocked = section(view('return-unavailable', callbacks(log())), 'return');
  assert.equal(blocked.querySelector('button'), null); assert.equal(blocked.querySelectorAll('.gcsp-order-choice-reason').length, 2);
  assert.match(blocked.textContent, /Confirm your new car's handover first/);
});

test('return plan: requested and proposed are not booked, scheduled is, and accept uses the proposal id', () => {
  const requested = section(view('return-requested'), 'return');
  assert.match(requested.textContent, /Return requested 12 Nov 2026, 09:00\. Not booked yet\./); assert.doesNotMatch(requested.textContent, /Return booked/);
  document.body.replaceChildren();
  const spy = log(); const proposed = section(view('return-change-proposed', callbacks(spy)), 'return');
  assert.match(proposed.textContent, /New return time proposed: 12 Nov 2026, 13:00\. Not booked yet\./); assert.doesNotMatch(proposed.textContent, /Return booked/);
  proposed.querySelector('button').click(); assert.deepEqual(spy.calls, [['accept-return', 'return-proposal-1']]);
  document.body.replaceChildren();
  const scheduled = section(view('return-scheduled'), 'return');
  assert.match(scheduled.textContent, /Return booked: 12 Nov 2026, 09:00/); assert.match(scheduled.textContent, /Keep driving your current car/);
});

test('a section that fails keeps its own line and the other sections still render', () => {
  const node = view('partial-failure', callbacks(log()));
  assert.match(section(node, 'documents').textContent, /Documents and checks unavailable\. Try again shortly\./);
  assert.match(section(node, 'stages').textContent, /Sales-manager approval/); assert.match(section(node, 'handover').textContent, /open once your order is sent to ordering/);
  document.body.replaceChildren();
  const p = structuredClone(fixtures.states['appointment-scheduled']);
  p.stages = { status: 'forbidden', reason: 'x' }; p.appointment = { status: 'not-found' }; p.returnPlan = { status: 'unavailable' };
  const failed = orderProgressBody({ progress: p, car: fixtures.car });
  assert.match(section(failed, 'stages').textContent, /Order progress is not available to you\./);
  assert.match(section(failed, 'stages').textContent, /Fictional BMW i4/);
  assert.match(section(failed, 'handover').textContent, /No handover details found for this order\./);
  assert.match(section(failed, 'return').textContent, /Return plan unavailable/);
  assert.match(section(failed, 'documents').textContent, /Vehicle agreement/);
});

test('loading is a status screen; unavailable gives a keyboard-native retry that calls back', () => {
  const loading = view('loading'); assert.match(loading.querySelector('[role="status"]').textContent, /Loading your order/); assert.equal(loading.querySelector('section'), null);
  document.body.replaceChildren();
  const spy = log(); const node = view('unavailable', { onRetry: spy.fn('retry') });
  assert.equal(node.querySelector('[role="alert"]').querySelector('h2').textContent, 'Order progress unavailable');
  const retry = node.querySelector('button'); assert.equal(retry.type, 'button'); retry.focus(); retry.click();
  assert.equal(document.activeElement, retry); assert.deepEqual(spy.calls, [['retry']]);
  document.body.replaceChildren();
  assert.equal(view('unavailable').querySelector('button').disabled, true);
});

test('without callbacks no control renders, but the facts, times and slots do', () => {
  for (const name of ['declined', 'sent-to-ordering-no-slot', 'appointment-change-proposed', 'documents-waiting-for-you', 'return-not-planned', 'return-change-proposed']) {
    const node = view(name); assert.equal(node.querySelectorAll('button, a[href]').length, 0, name); document.body.replaceChildren();
  }
  assert.match(view('sent-to-ordering-no-slot').textContent, /8 Nov 2026, 09:00/);
});

test('pending disables every action and says the order is updating', () => {
  const node = view('appointment-change-proposed', { ...callbacks(log()), pending: true });
  const all = [...node.querySelectorAll('button')]; assert.ok(all.length >= 2);
  const blocked = all.filter((b) => b.disabled).map((b) => b.textContent);
  assert.ok(blocked.includes('Accept new time')); assert.ok(blocked.includes('Acknowledge the agreement'));
  assert.match(node.querySelector('[role="status"]').textContent, /Updating your order\./);
});

test('messages render in a live region, and an error is an alert with the not-done wording', () => {
  const ok = view('appointment-scheduled', { message: { text: 'Request saved.' } });
  assert.equal(ok.querySelector('.gcsp-order-message').getAttribute('role'), 'status'); assert.equal(ok.querySelector('.gcsp-order-message').textContent, 'Request saved.');
  document.body.replaceChildren();
  const bad = view('appointment-scheduled', { message: { text: 'Not done. Live updates are not connected in this demonstration.', error: true } });
  assert.equal(bad.querySelector('.gcsp-order-message').getAttribute('role'), 'alert'); assert.match(bad.querySelector('[role="alert"]').textContent, /^Not done\. /);
  assert.equal(view('appointment-scheduled').querySelector('.gcsp-order-message'), null);
});

test('no claim that the platform progresses on its own, and the states use plain wording', () => {
  for (const name of names) { const text = view(name, callbacks(log())).textContent; assert.doesNotMatch(text, /overnight|automatically|in the background/i, name); document.body.replaceChildren(); }
});
