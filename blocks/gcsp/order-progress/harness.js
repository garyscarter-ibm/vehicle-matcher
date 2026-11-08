// Design harness only: callbacks report locally and save nothing. The state picker reuses the activity preview styles.
import { el, button } from '../../vehicle-matcher/ui.js';
import { mountEmployee, EMPLOYEE_NAVIGATION } from '../employee/gcsp-employee.js';
import { mountHelp } from '../cases/gcsp-help.js';
import { fixtureAdapter } from '../cases/fixtures.js';
import { orderProgressBody } from './order-progress-body.js';
import { orderProgressFixtures, orderProgressFixtureNames } from './fixtures.js';
import { ORDER_PROGRESS_DESTINATION } from './gcsp-order-progress.js';

const labels = { 'waiting-hr': 'Waiting for HR', 'waiting-sales-manager': 'Waiting for sales manager', 'no-hr': 'No HR step', declined: 'Declined',
  'provider-unsupported': 'Update not supported', 'sent-to-ordering-no-slot': 'Choose handover time', 'appointment-requested': 'Handover requested',
  'appointment-change-proposed': 'New handover time', 'appointment-pending': 'Handover update pending', 'appointment-scheduled': 'Handover booked',
  'documents-waiting-for-you': 'Task waiting for you', 'documents-in-progress': 'Documents in progress', 'documents-overdue': 'Task overdue',
  'documents-failed': 'Check failed', 'ready-for-handover': 'Ready for handover', 'return-unavailable': 'Return not open yet',
  'return-not-planned': 'Choose return', 'return-requested': 'Return requested', 'return-change-proposed': 'New return time',
  'return-scheduled': 'Return booked', 'return-buddy-home': 'Buddy return from home', 'return-buddy-no-address': 'Buddy return, no address', 'new-order': 'New order, no return', loading: 'Loading', unavailable: 'Unavailable', 'partial-failure': 'Partly unavailable' };
const text = (name) => labels[name] ?? name.replace(/-/g, ' ');
const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
const initial = orderProgressFixtureNames.includes(requested) ? requested : 'appointment-requested';
const root = document.getElementById('gcsp-order-progress-preview');
if (root) mountEmployee(root, {
  view: ORDER_PROGRESS_DESTINATION.key,
  navigation: [...EMPLOYEE_NAVIGATION.map((item) => ({ ...item, available: false, unavailableReason: 'Not part of this order progress preview' })), ORDER_PROGRESS_DESTINATION],
  loadAccount: async () => ({ status: 'ready', name: 'Paula (synthetic)', context: 'Choices, synthetic demonstration' }),
  renderBody(main) {
    const fixtures = orderProgressFixtures(); const help = fixtureAdapter('request');
    const body = el('div', 'gcsp-order-preview-body');
    const controls = el('div', 'vm gcsp-activity-preview-controls'); controls.setAttribute('aria-label', 'Design preview states'); controls.setAttribute('role', 'group');
    const status = el('p', 'gcsp-order-preview-status'); status.setAttribute('role', 'status');
    let selected = initial; let helps = [];
    const stopHelps = () => helps.splice(0).forEach((stop) => stop?.());
    const buttons = orderProgressFixtureNames.map((name) => {
      const control = button({ label: text(name), variant: 'ghost', onClick: () => show(name) });
      control.dataset.fixture = name; controls.append(control); return control;
    });
    const report = (line) => () => { status.textContent = `Preview only. ${line}`; };
    function show(name, retry = false) {
      selected = name; stopHelps();
      body.replaceChildren(orderProgressBody({ progress: structuredClone(fixtures.states[name]), car: fixtures.car,
        onRetry: () => show(selected, true),
        onCompleteTask: (id) => { status.textContent = `Preview only. Would complete task ${id}.`; },
        onRequestAppointment: (slotId) => { status.textContent = `Preview only. Would request handover slot ${slotId}.`; },
        onAcceptAppointment: report('Would accept the new handover time.'),
        onRequestReturn: ({ choice, slotId }) => { status.textContent = `Preview only. Would request ${choice} return slot ${slotId}.`; },
        onAcceptReturn: report('Would accept the new return time.'),
        mountHelp: (node) => helps.push(mountHelp(node, { embedded: true, adapter: help, headingLevel: 3 })) }));
      if (retry) body.querySelector('button')?.focus();
      buttons.forEach((control) => control.setAttribute('aria-pressed', String(control.dataset.fixture === selected)));
      status.textContent = retry ? 'Still unavailable.' : '';
    }
    main.replaceChildren(body, controls, status); show(initial);
    return () => { stopHelps(); body.remove(); controls.remove(); status.remove(); };
  },
});
