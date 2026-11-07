import { defineGcspCaseQueue } from './gcsp-case-queue.js';
import { queueFixtureAdapter, QUEUE_FIXTURE_NAMES } from './queue-fixtures.js';
const host = document.querySelector('gcsp-case-queue');
const requested = new URLSearchParams(globalThis.location?.search ?? '').get('fixture');
if (host && QUEUE_FIXTURE_NAMES.includes(requested)) host.adapter = queueFixtureAdapter(requested);
defineGcspCaseQueue();
