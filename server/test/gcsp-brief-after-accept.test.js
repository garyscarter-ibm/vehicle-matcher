import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, walkPaulasPath } from './helpers/gcsp-journey.js';

test('brief editor after Paula accepts opens her saved brief read-only, not a refusal', async (t) => {
  const f = await launch(t);
  const run = await walkPaulasPath(t, f, 'path');
  const editor = await f.api('/api/gcsp/brief/editor', { session: run.sessions.paula });
  const current = await f.api('/api/gcsp/brief', { session: run.sessions.paula });
  assert.equal(editor.status, 200, JSON.stringify(editor.json));
  assert.equal(editor.json.status, 'ok');
  assert.equal(editor.json.value.provenance.initial, 'approved-brief');
  assert.equal(editor.json.value.initial.briefVersion, current.json.value.brief.briefVersion);
  assert.equal(editor.json.value.selection.state, 'accepted');
});
