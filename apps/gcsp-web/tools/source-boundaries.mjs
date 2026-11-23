import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { hasInlineEvent } from './inline-events.mjs';

export function checkSource(path, source, root) {
  const assembledSource = resolve(path) === resolve(root, 'src/styles/node-gcsp.css');
  assert(!/\beval\s*\(|new\s+Function\s*\(|\b(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(source), `${path}: dynamic execution`);
  assert(!hasInlineEvent(path, source) && !(assembledSource && hasInlineEvent('assembled-source.html', source)), `${path}: inline event attribute`);
  assert(!/<script\b[^>]*>\s*\S/i.test(source), `${path}: inline script`);
  assert(!/\binnerHTML\b|bypassSecurityTrust|\blegacy\b.*import/i.test(source), `${path}: unsafe rendering`);
  assert(!/from\s*['"][^'"]*(?:blocks|server)\//.test(source), `${path}: controller/business import`);
  // This exact source assembly retains frozen comments and source tokens. Its inventory and selector closure
  // are checked by gcsp-angular-styles/ui-ratchet; app-authored sources keep the painted-copy/token rules.
  if (!assembledSource) {
    assert(!/[—]/.test(source), `${path}: on-screen em dash`);
    if (path.endsWith('.css')) assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(source), `${path}: use shared semantic colours`);
  }
}
