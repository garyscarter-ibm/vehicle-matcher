// Test-only supplied-decision projection. The capture host substitutes this external module;
// production/live pages and the original generated snapshot stay unchanged.
import { defineGcspBrief } from '../../../../blocks/gcsp/brief/gcsp-brief.js';

const response = await fetch('./docs/gcsp/evidence/fucq94/representative-snapshot.json');
if (!response.ok) throw Error('Supplied decision snapshot unavailable');
const snapshot = await response.json();
const preview = structuredClone(snapshot.preview);
preview.value.decisions = preview.value.decisions.filter((decision) => decision.gateStatus === 'needs-confirmation');
if (preview.value.decisions.length !== 1) throw Error('Expected one existing needs-confirmation decision');
preview.value.recommendations = [];
preview.value.eligibleCount = 0;
preview.value.state = 'no-viable-stock';
const expectedBrief = JSON.stringify(snapshot.edited.value.initial.brief);
document.querySelector('gcsp-brief').adapter = {
  loadAccount: async () => ({ status: 'ready', name: snapshot.edited.value.context.knownFacts.account.value.name, context: 'Choices, grade G7 · synthetic test' }),
  loadEditor: async () => structuredClone(snapshot.edited),
  transport: {
    preview: async (request) => JSON.stringify(request.brief) === expectedBrief ? structuredClone(preview) : { status: 'unavailable', reason: 'Supplied decisions do not evaluate edits.' },
    saveDraft: async () => ({ status: 'unavailable' }),
    confirm: async () => ({ status: 'unavailable' }),
  },
  initialEdited: true,
  notice: 'Test-only supplied decision: essential unknown',
  previewUnavailableReason: 'Reload to restore the supplied decision.',
  saveUnavailableReason: 'Saving is unavailable in this test-only preview.',
};
defineGcspBrief();
