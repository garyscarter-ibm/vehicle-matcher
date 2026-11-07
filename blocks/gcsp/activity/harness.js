// Design harness only: selection changes a supplied synthetic snapshot, never a saved search.
import { el, button } from '../../vehicle-matcher/ui.js';
import { mountEmployee, EMPLOYEE_NAVIGATION } from '../employee/gcsp-employee.js';
import { activityBody } from './activity-body.js';
import { activityFixtures } from './activity-fixtures.js';

const names = { 'never-checked': 'Not searched', searching: 'Searching', offer: 'Offer waiting', 'offer-declined': 'Offer declined',
  'offer-expired': 'Offer expired', 'paused-offer': 'Paused with offer', paused: 'Paused', 'source-delayed': 'Source delayed',
  'source-unavailable': 'Source unavailable', unavailable: 'Unavailable' };
const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
const initial = Object.hasOwn(names, requested) ? requested : 'offer';
const root = document.getElementById('gcsp-activity-preview');
if (root) mountEmployee(root, {
  view: 'activity',
  navigation: [...EMPLOYEE_NAVIGATION.map((item) => ({ ...item, available: false, unavailableReason: 'Not part of this activity preview' })),
    { key: 'activity', label: 'Buddy activity', available: true, icon: ['M4 5h16', 'M4 12h16', 'M4 19h16', 'M8 3v4', 'M8 10v4', 'M8 17v4'] }],
  loadAccount: async () => ({ status: 'ready', name: 'Paula (synthetic)', context: 'Choices, synthetic demonstration' }),
  renderBody(main) {
    const body = el('div', 'gcsp-activity-preview-body');
    const controls = el('div', 'vm gcsp-activity-preview-controls'); controls.setAttribute('aria-label', 'Design preview states');
    controls.setAttribute('role', 'group');
    const status = el('p', 'gcsp-activity-preview-status'); status.setAttribute('role', 'status');
    let selected = initial;
    const buttons = Object.entries(names).map(([name, label]) => {
      const control = button({ label, variant: 'ghost', onClick: () => show(name) });
      control.dataset.fixture = name; controls.append(control); return control;
    });
    function show(name, retry = false) {
      selected = name;
      body.firstElementChild?.destroy?.();
      body.replaceChildren(activityBody({ result: structuredClone(activityFixtures.snapshots[name]),
        offerDisplay: activityFixtures.offerExample, onRetry: () => show(selected, true) }));
      if (retry) body.querySelector('button')?.focus();
      buttons.forEach((control) => control.setAttribute('aria-pressed', String(control.dataset.fixture === selected)));
      status.textContent = retry ? 'Still unavailable.' : '';
    }
    main.replaceChildren(body, controls, status); show(initial);
    return () => { body.firstElementChild?.destroy?.(); body.remove(); controls.remove(); status.remove(); };
  },
});
