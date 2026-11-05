// Harness only: ?fixture= picks a named fixture. The element itself never reads location.
import { defineGcspOutbox } from './gcsp-outbox.js';
import { FIXTURE_NAMES } from './fixtures.js';

const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
const host = document.querySelector('gcsp-outbox');
if (host && FIXTURE_NAMES.includes(requested)) host.setAttribute('fixture', requested);
defineGcspOutbox();
