// Run from the repository root with the native-PG HTTP projection directory as argv[2].
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const validatorPath = 'apps/gcsp-web/src/app/offers/offer.validation.ts';
const original = fs.readFileSync(validatorPath, 'utf8');
const source = original.replace(/^import \{[\s\S]*?\} from '\.\/offer.types';\s*/, '');
const code = stripTypeScriptTypes(source, { mode: 'strip' });
const { isOfferProjection } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const results = ['active', 'accepted', 'expired'].map(state => {
  const bytes = fs.readFileSync(path.join(process.argv[2], state + '.json'));
  const value = JSON.parse(bytes);
  assert.equal(value.state, state === 'active' ? 'pending' : state);
  assert.equal(isOfferProjection(value, { offerId: value.offerId, runId: value.runId }), true, state);
  return { state, acceptedByActualAngularValidator: true, sha256: sha256(bytes) };
});
console.log(JSON.stringify({ validatorPath, validatorSha256: sha256(original), results }, null, 2));
