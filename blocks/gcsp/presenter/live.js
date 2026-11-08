// Live outbox page: the HTTP adapter reads the current run's captured emails with the presenter cookie.
import { defineGcspOutbox } from './gcsp-outbox.js';
import { createOutboxHttpAdapter } from './http-adapter.js';

const host = globalThis.document?.querySelector('gcsp-outbox[data-live]');
if (host) { defineGcspOutbox(); host.adapter = createOutboxHttpAdapter(); }
