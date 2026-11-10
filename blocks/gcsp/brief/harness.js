import { defineGcspBrief } from './gcsp-brief.js';

const element = document.querySelector('gcsp-brief');
try {
  const response = await fetch('./docs/gcsp/evidence/fucq94/representative-snapshot.json');
  if (!response.ok) throw Error('Snapshot unavailable');
  const snapshot = await response.json();
  const accepted = new URLSearchParams(globalThis.location?.search || '').get('state') === 'accepted';
  const expected = JSON.stringify(snapshot.edited.value.initial.brief);
  element.adapter = {
    loadAccount: async () => ({ status: 'ready', name: snapshot.edited.value.context.knownFacts.account.value.name, context: 'Choices, grade G7' }),
    // ?state=accepted previews the read-only page shown after a buddy accept.
    loadEditor: async () => { const editor = structuredClone(snapshot.edited);
      if (accepted) editor.value.selection = { state: 'accepted', briefVersion: editor.value.initial.briefVersion }; return editor; },
    transport: {
      preview: async (request) => JSON.stringify(request.brief) === expected ? structuredClone(snapshot.preview) : { status: 'unavailable', reason: 'Generated snapshot does not evaluate edits.' },
      saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }),
    },
    initialEdited: true,
    notice: 'Preview',
    previewUnavailableReason: 'Reload to restore this view.',
    saveUnavailableReason: 'Saving is unavailable in this preview.',
  };
} catch {
  element.adapter = { loadAccount: async () => ({ status: 'unavailable', message: 'The generated brief snapshot could not be loaded.' }) };
}
defineGcspBrief();
