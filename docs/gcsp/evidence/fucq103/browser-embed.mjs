// Proof host only: every view uses the delivered same-origin HTTP adapter.
import { defineGcspBrief } from '../../../../blocks/gcsp/brief/gcsp-brief.js';
import { createBriefRuntimeAdapter } from '../../../../blocks/gcsp/brief/runtime.js';
import { defineGcspGregDashboard } from '../../../../blocks/gcsp/greg/gcsp-greg.js';
import { createGregHttpAdapter } from '../../../../blocks/gcsp/greg/http-adapter.js';
import { defineGcspGregPublish } from '../../../../blocks/gcsp/greg/publish/element.js';

// Define first so adapter assignment uses the element setter before connection.
defineGcspBrief(); defineGcspGregDashboard(); defineGcspGregPublish();
const host = document.querySelector('[data-proof-host]');
host.addEventListener('gcsp:ready', () => { host.dataset.ready = 'true'; });
const mode = new URL(location.href).searchParams.get('view');
if (mode === 'brief') {
  const element = document.createElement('gcsp-brief');
  element.adapter = { ...createBriefRuntimeAdapter(), notice: 'Synthetic persisted scenario' };
  host.append(element);
} else if (mode === 'dashboard') {
  const element = document.createElement('gcsp-greg-dashboard');
  element.adapter = createGregHttpAdapter();
  host.append(element);
} else {
  for (let index = 0; index < (mode === 'two' ? 2 : 1); index += 1) {
    const element = document.createElement('gcsp-greg-publish');
    element.adapter = createGregHttpAdapter().publish;
    host.append(element);
  }
}
