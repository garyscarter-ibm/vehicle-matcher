import { demoTime } from '../kit/activity-timeline.js';

export const orderCopy = Object.freeze({
  title: 'Order progress',
  timeNote: 'All times are demo time (UTC).',
  loading: 'Loading your order',
  unavailableTitle: 'Order progress unavailable',
  unavailable: 'Your order could not be loaded. Try again.',
  order: 'Your order',
  noCar: 'Car details not supplied',
  noImage: 'No image for this car yet',
  steps: 'Steps',
  handover: 'Handover',
  documents: 'Documents and checks',
  checklist: 'Checklist',
  returnCar: 'Returning your current car',
  mine: 'Your tasks',
  others: 'Being handled by others',
  noTasks: 'No documents or checks are listed yet.',
  synthetic: 'Synthetic acknowledgement, not a signature',
  ready: 'Ready for handover',
  documentsClosed: 'Documents and checks open once your order is sent to ordering.',
  handoverClosed: 'Handover times open once your order is sent to ordering.',
  chooseHandover: 'Choose a handover time.',
  noSlots: 'No handover times are available yet.',
  waiting: 'Waiting for confirmation of your last update.',
  notBooked: 'Not booked yet.',
  accept: 'Accept new time',
  help: 'Get help',
  cantMakeIt: "Can't make it? Get help",
  updating: 'Updating your order.',
  carStays: 'Your current car stays yours until it is returned.',
  homeAddress: 'Collection from your home address',
  returnPlace: 'Return place',
  chooseReturn: 'Choose when to return your current car.',
});

export const sentence = (text) => (typeof text === 'string' && text ? text[0].toUpperCase() + text.slice(1) : '');
export const notDone = (reason) => `Not done. ${reason}`;
const valid = (instant) => typeof instant === 'string' && Number.isFinite(Date.parse(instant));
export const slotText = (slot) => (valid(slot?.start) ? demoTime(slot.start) : null);

const ownerNames = Object.freeze({ employee: 'you', retailer: 'retailer', 'scheme-team': 'scheme team' });
const bare = new Set(['HR', 'ordering', 'you']);
/** "With HR", "With the sales manager": the server's owner wording, with an article where it needs one. */
export function withOwner(owner) {
  const name = ownerNames[owner] ?? owner;
  return typeof name === 'string' && name ? `With ${bare.has(name) ? name : `the ${name}`}` : null;
}

/** One short failure line per section, from the envelope status only. */
export function failureLine(what, envelope) {
  if (envelope?.status === 'forbidden') return `${sentence(what)} is not available to you.`;
  if (envelope?.status === 'not-found') return `No ${what} found for this order.`;
  return `${sentence(what)} unavailable. Try again shortly.`;
}

export const itemStatus = Object.freeze({ 'not-started': 'Not started', 'waiting-for-employee': 'Waiting for you',
  'in-progress': 'In progress', complete: 'Complete', failed: 'Failed' });
export const itemOwner = Object.freeze({ employee: 'You', 'scheme-team': 'Scheme team', retailer: 'Retailer' });
export function itemTone(item) {
  if (item.status === 'failed') return 'failed';
  if (item.status === 'complete') return 'done';
  if (item.overdue === true) return 'overdue';
  return item.status === 'in-progress' ? 'in-progress' : 'todo';
}

const historyLabels = Object.freeze({ requested: 'Requested', 'change-proposed': 'New time proposed', scheduled: 'Booked' });
const returnLabels = Object.freeze({ requested: 'Return requested', 'change-proposed': 'New return time proposed', scheduled: 'Return booked' });
/** Dated history rows from the server's own history; the return plan reads its appointmentState. */
export function historyEvents(history, forReturn = false) {
  const labels = forReturn ? returnLabels : historyLabels;
  return (Array.isArray(history) ? history : []).map((row, index) => ({ id: `${row.appointmentState ?? row.state}-${index}`, occurredAt: row.at,
    label: labels[row.appointmentState ?? row.state] || 'Update recorded' }));
}
