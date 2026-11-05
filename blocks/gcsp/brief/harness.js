import { defineGcspBrief } from './gcsp-brief.js';

const element = document.querySelector('gcsp-brief');
try {
  const response = await fetch('./docs/gcsp/evidence/fucq94/representative-snapshot.json');
  if (!response.ok) throw Error('Snapshot unavailable');
  const snapshot = await response.json();
  const expected = JSON.stringify(snapshot.edited.value.initial.brief);
  element.adapter = {
    loadAccount: async () => ({ status: 'ready', name: snapshot.edited.value.context.knownFacts.account.value.name, context: 'Choices, grade G7 · synthetic' }),
    loadEditor: async () => structuredClone(snapshot.edited),
    transport: {
      preview: async (request) => JSON.stringify(request.brief) === expected ? structuredClone(snapshot.preview) : { status: 'unavailable', reason: 'Generated snapshot does not evaluate edits.' },
      saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }),
    },
    initialEdited: true,
    notice: 'Synthetic preview',
    previewUnavailableReason: 'Reload to restore the example.',
    saveUnavailableReason: 'Saving is unavailable in this preview.',
  };
} catch {
  element.adapter = { loadAccount: async () => ({ status: 'unavailable', message: 'The generated brief snapshot could not be loaded.' }) };
}
defineGcspBrief();
