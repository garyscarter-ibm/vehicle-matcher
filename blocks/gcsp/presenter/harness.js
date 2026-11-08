// ?fixture= picks a named fixture; otherwise the live outbox route is used. The element never reads location.
import { defineGcspOutbox } from './gcsp-outbox.js';
import { FIXTURE_NAMES } from './fixtures.js';
import { createOutboxHttpAdapter } from './http-adapter.js';

const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
defineGcspOutbox();
const host = document.querySelector('gcsp-outbox');
if (host && FIXTURE_NAMES.includes(requested)) host.setAttribute('fixture', requested);
else if (host) host.adapter = createOutboxHttpAdapter({ base: '' });
