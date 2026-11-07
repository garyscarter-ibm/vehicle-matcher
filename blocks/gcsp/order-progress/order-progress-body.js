// Pure render of supplied producer envelopes. The host owns requests, saved commands and help; absent callbacks render no controls.
import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { mediaWell } from '../../vehicle-matcher/modes/result-card.js';
import { stageTracker } from '../kit/stage-tracker.js';
import { taskList } from '../kit/task-list.js';
import { activityTimeline } from '../kit/activity-timeline.js';
import { orderCopy as copy, sentence, slotText, withOwner, failureLine, itemStatus, itemOwner, itemTone, historyEvents } from './order-progress-copy.js';

let sequence = 0;
const stageStates = Object.freeze({ approved: 'done', pending: 'current', declined: 'declined', 'not-started': 'upcoming' });
const usable = (envelope) => envelope?.status === 'ok' && envelope.value && typeof envelope.value === 'object';
const fn = (value) => (typeof value === 'function' ? value : null);
const when = (prefix, slot) => (slotText(slot) ? `${prefix} ${slotText(slot)}` : prefix);
const add = (parent, ...nodes) => parent.append(...nodes.filter(Boolean));
const statement = (value) => el('p', 'gcsp-order-statement', value);
const failure = (what, envelope) => el('p', 'gcsp-order-failure', failureLine(what, envelope));
const ownerRows = (v) => [{ label: 'Owner', value: itemOwner[v.owner] ?? v.owner }, { label: 'Next step', value: v.nextStep }];

function trackerStages(value) {
  return (Array.isArray(value.stages) ? value.stages : []).map((row) => {
    const here = row.stage === value.currentStage;
    const blocked = here && value.blocked && row.state === 'pending';
    return { id: row.stage, label: sentence(row.stage), state: blocked ? 'blocked' : stageStates[row.state] || 'upcoming', at: row.at,
      owner: here ? withOwner(value.owner) : undefined, next: here ? value.nextStep : undefined, note: blocked ? value.blocked.reason : undefined };
  });
}

// Producer readItems lists orders (matched by order id, or the only one when stages are missing). A lone order or a not-open answer is accepted too.
function documentsOrder(envelope, orderUuid) {
  if (envelope?.status === 'not-open') return { closed: true };
  if (!usable(envelope)) return { failed: true };
  const v = envelope.value;
  if (Array.isArray(v.orders)) {
    const order = v.orders.find((o) => o.orderUuid === orderUuid) ?? (orderUuid === undefined && v.orders.length === 1 ? v.orders[0] : undefined);
    return order ? { order } : { closed: true };
  }
  if (Array.isArray(v.items)) return { order: v };
  return v.opened === false || v.state === 'not-open' ? { closed: true } : { failed: true };
}

function slotButtons(slots, c, make, onPick) {
  const list = el('ul', 'gcsp-order-slots');
  for (const slot of slots) {
    const item = el('li', 'gcsp-order-slot');
    item.append(fn(onPick) ? button({ label: make(slot), variant: 'ghost', disabled: c.pending, onClick: () => onPick(slot) }) : el('span', '', slotText(slot)));
    list.append(item);
  }
  return list;
}

function orderSection(c) {
  const { stages, car } = c.progress; const node = c.section(copy.order, 'stages');
  const head = el('div', 'gcsp-order-car');
  const media = mediaWell({ name: car?.name || copy.noCar, photo: car?.photo, line: car?.line || '' }, 'gcsp-order-media', { placeholder: copy.noImage });
  const details = el('div', 'gcsp-order-car-details');
  details.append(el(`h${c.sub}`, 'gcsp-order-car-name', car?.name || copy.noCar));
  const orderNumber = usable(stages) ? stages.value.source?.orderNumber : null;
  if (orderNumber) details.append(el('p', 'gcsp-order-number', `Order no. ${orderNumber}`));
  head.append(media.media, details); node.append(head);
  if (!usable(stages)) { node.append(failure('order progress', stages)); return node; }
  node.append(stageTracker({ heading: copy.steps, stages: trackerStages(stages.value), level: c.sub }));
  if (stages.value.outcome === 'declined') add(node, c.help(copy.help));
  return node;
}

function handoverSection(c) {
  const { appointment } = c.progress; const node = c.section(copy.handover, 'handover'); const a = appointment?.value;
  if (!usable(appointment)) { node.append(failure('handover details', appointment)); return node; }
  if (a.pending) { node.append(statement(copy.waiting), factList(ownerRows(a))); return node; }
  if (a.state === 'not-requested') {
    if (a.eligibility?.eligible === false) { node.append(statement(copy.handoverClosed)); return node; }
    const slots = Array.isArray(a.offeredSlots) ? a.offeredSlots : [];
    node.append(statement(slots.length ? copy.chooseHandover : a.blocked?.reason || copy.noSlots));
    if (slots.length) node.append(slotButtons(slots, c, (slot) => `Request ${slotText(slot)}`, c.on.onRequestAppointment && ((slot) => c.on.onRequestAppointment(slot.slotId))));
    return node;
  }
  const proposed = a.state === 'change-proposed';
  const line = a.state === 'scheduled' && a.booked === true ? when('Booked:', a.slot)
    : `${proposed ? when('New time proposed:', a.proposedSlot) : when('Requested', a.requestedSlot)}. ${copy.notBooked}`;
  node.append(statement(line), factList(ownerRows(a)));
  if (proposed) {
    const accept = c.on.onAcceptAppointment && button({ label: copy.accept, disabled: c.pending, onClick: () => c.on.onAcceptAppointment(a.proposalId) });
    add(node, c.actions(accept, c.help(copy.cantMakeIt)));
  }
  add(node, c.history(a, false));
  return node;
}

function documentsSection(c) {
  const { documents, stages } = c.progress; const node = c.section(copy.documents, 'documents');
  const found = documentsOrder(documents, usable(stages) ? stages.value.orderUuid : undefined);
  if (found.failed) { node.append(failure('documents and checks', documents)); return node; }
  if (found.closed) { node.append(statement(copy.documentsClosed)); return node; }
  const doc = found.order; const items = Array.isArray(doc.items) ? doc.items : []; const readiness = doc.readiness ?? {};
  const label = (id) => items.find((item) => item.itemId === id)?.label ?? id;
  const failed = readiness.failed ?? []; const todo = (readiness.blocking ?? []).filter((id) => !failed.includes(id));
  node.append(statement(readiness.ready === true ? copy.ready : ['Not ready for handover.', failed.length && `Needs attention: ${failed.map(label).join(', ')}.`,
    todo.length && `Still to do: ${todo.map(label).join(', ')}.`].filter(Boolean).join(' ')));
  const mine = (Array.isArray(doc.tasks) ? doc.tasks : []).map((task) => ({ id: task.itemId, label: task.label,
    status: itemStatus[task.status], tone: itemTone(task), due: task.status === 'complete' ? undefined : task.dueAt,
    reason: items.find((item) => item.itemId === task.itemId)?.reason ?? undefined, detail: task.actionable ? copy.synthetic : task.acknowledgement?.label,
    action: task.actionable && c.on.onCompleteTask ? { label: task.action, onSelect: c.on.onCompleteTask, disabled: c.pending } : undefined }));
  const others = items.filter((item) => item.owner !== 'employee').map((item) => ({ id: item.itemId, label: item.label, owner: itemOwner[item.owner] ?? item.owner,
    status: itemStatus[item.status], tone: itemTone(item), due: item.status === 'complete' ? undefined : item.dueAt, reason: item.reason ?? undefined }));
  node.append(taskList({ heading: copy.checklist, emptyText: copy.noTasks, level: c.sub, groups: [{ heading: copy.mine, items: mine }, { heading: copy.others, items: others }] }));
  return node;
}

function choiceGroup(choice, slots, c) {
  const group = el('div', 'gcsp-order-choice'); group.setAttribute('role', 'group');
  const title = el('p', 'gcsp-order-choice-label', choice.label); title.id = `gcsp-order-choice-${++sequence}`;
  group.setAttribute('aria-labelledby', title.id); group.append(title);
  if (!choice.available) { group.append(el('p', 'gcsp-order-choice-reason', choice.reason || 'Not available yet.')); return group; }
  const make = choice.id === 'same-visit' ? (slot) => `Request return at handover, ${slotText(slot)}` : (slot) => `Request return ${slotText(slot)}`;
  group.append(slotButtons(slots, c, make, c.on.onRequestReturn && ((slot) => c.on.onRequestReturn({ choice: choice.id, slotId: slot.slotId }))));
  return group;
}

function returnSection(c) {
  const { returnPlan } = c.progress; const r = returnPlan?.value;
  if (usable(returnPlan) && r.applicable !== true) return null;
  const node = c.section(copy.returnCar, 'return');
  if (!usable(returnPlan)) { node.append(failure('return plan', returnPlan)); return node; }
  const now = r.currentCar ?? {};
  node.append(factList([{ label: 'Current car', value: now.model }, { label: 'Configuration', value: typeof now.vehicle === 'object' ? now.vehicle?.configuration : now.vehicle }]),
    el('p', 'gcsp-order-note', copy.carStays));
  const proposed = r.state === 'return-requested' && r.appointment?.state === 'change-proposed';
  if (r.pending) node.append(statement(copy.waiting), factList(ownerRows(r)));
  else if (r.state === 'return-scheduled' && r.scheduled === true) node.append(statement(when('Return booked:', r.slot)), factList(ownerRows(r)));
  else if (r.state === 'return-requested') {
    node.append(statement(`${proposed ? when('New return time proposed:', r.proposedSlot) : when('Return requested', r.requestedSlot)}. ${copy.notBooked}`), factList(ownerRows(r)));
    if (proposed) add(node, c.actions(c.on.onAcceptReturn && button({ label: copy.accept, disabled: c.pending, onClick: () => c.on.onAcceptReturn(r.proposalId) })));
  } else if (r.state === 'not-planned') {
    const choices = Array.isArray(r.choices) ? r.choices : [];
    if (choices.some((choice) => choice.available)) node.append(statement(copy.chooseReturn));
    node.append(...choices.map((choice) => choiceGroup(choice, r.offeredSlots?.[choice.id] ?? [], c)));
  }
  add(node, c.history(r, true));
  return node;
}

export function orderProgressBody({ progress = {}, car, pending = false, message, onRetry, onCompleteTask, onRequestAppointment, onAcceptAppointment,
  onRequestReturn, onAcceptReturn, onHelp, mountHelp, level = 1 } = {}) {
  const root = el('div', 'vm gcsp-order-progress');
  const sub = Math.min(level + 2, 6);
  root.append(screenIntro({ title: copy.title, level, className: 'gcsp-order-intro' }));
  const text = message?.text || (pending ? copy.updating : '');
  if (text) { const live = el('p', `gcsp-order-message${message?.error ? ' is-error' : ''}`, text); live.setAttribute('role', message?.error ? 'alert' : 'status'); root.append(live); }
  if (progress.phase === 'loading') { root.append(statusScreen({ title: copy.loading })); return root; }
  if (progress.phase !== 'ready') {
    root.append(statusScreen({ title: copy.unavailableTitle, message: copy.unavailable, role: 'alert',
      actions: [button({ label: 'Retry', onClick: fn(onRetry) ? () => onRetry() : undefined, disabled: !fn(onRetry) })] }));
    return root;
  }
  const c = { progress: { ...progress, car }, pending, sub,
    on: { onCompleteTask: fn(onCompleteTask), onRequestAppointment: fn(onRequestAppointment), onAcceptAppointment: fn(onAcceptAppointment),
      onRequestReturn: fn(onRequestReturn), onAcceptReturn: fn(onAcceptReturn) },
    section(title, name) {
      const node = el('section', `gcsp-order-section gcsp-order-${name}`); const heading = el(`h${Math.min(level + 1, 6)}`, 'gcsp-order-section-title', title);
      heading.id = `gcsp-order-section-${++sequence}`; node.setAttribute('aria-labelledby', heading.id); node.append(heading); return node;
    },
    help(label) {
      if (fn(mountHelp)) { const host = el('div', 'gcsp-order-help'); mountHelp(host); return host; }
      return fn(onHelp) ? button({ label, variant: 'ghost', onClick: () => onHelp() }) : null;
    },
    actions(...nodes) { const row = el('div', 'gcsp-order-actions'); add(row, ...nodes); return row.children.length ? row : null; },
    history(value, forReturn) {
      const events = historyEvents(value.history, forReturn);
      return events.length > 1 ? activityTimeline({ events, heading: forReturn ? 'Return history' : 'Handover history', level: sub }) : null;
    } };
  root.append(el('p', 'gcsp-order-note', copy.timeNote));
  add(root, orderSection(c), handoverSection(c), documentsSection(c), returnSection(c));
  return root;
}
