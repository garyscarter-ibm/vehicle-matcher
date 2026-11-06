import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../gcsp/policy/index.js';

const policyRead = { runId: 'f59-offline', asOf: '2026-11-06T00:00:00.000Z' };

test('configuration identity uses the target padded Base64 and excludes context and accessory variants', async () => {
  const { createConfigurationKey } = await import('../../scripts/gcsp/configuration-key.mjs');
  const key = await createConfigurationKey({ policyService: new PolicyService(), policyRead });
  const first = key({ vgModelCode: 't5mj', agModelCode: '72HH',
    factoryOptionCodes: ['S0488', 'p0300', 'S0337', 'S03AC', 'FKSFU', 'S0488'],
    selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 1 }] });
  assert.equal(first.decodedIdentity, 'T5MJ:FKSFU,P0300,S0337,S03AC,S0488');
  assert.equal(first.configurationId, 'VDVNSjpGS1NGVSxQMDMwMCxTMDMzNyxTMDNBQyxTMDQ4OA==');
  const alias = key({ vgModelCode: ' T5MJ ', factoryOptionCodes: ['337', 'FKSFU', 'P0300', 'S03AC', 'S0488'],
    aliases: { '337': 'S0337' }, catalogueDate: '2030-01-01', requestSeed: 'other', sourceVersion: 'other' });
  assert.equal(alias.configurationId, first.configurationId);
  assert.deepEqual(first.canonicalIdentity.factoryOptionCodes, ['FKSFU', 'P0300', 'S0337', 'S03AC', 'S0488']);
});

test('identity refuses missing policy, empty factory selection and accessory pollution', async () => {
  const { createConfigurationKey } = await import('../../scripts/gcsp/configuration-key.mjs');
  await assert.rejects(createConfigurationKey({}), { code: 'signature-policy-unavailable' });
  const key = await createConfigurationKey({ policyService: new PolicyService(), policyRead });
  assert.throws(() => key({ vgModelCode: 'T5MJ', factoryOptionCodes: [] }), { code: 'invalid-factory-selection' });
  assert.throws(() => key({ vgModelCode: 'T5MJ', factoryOptionCodes: ['SE000001'] }), { code: 'accessory-in-factory-selection' });
  assert.throws(() => key({ vgModelCode: 'T5MJ', factoryOptionCodes: ['S0337'], aliases: { S0337: '0337', '0337': 'S0337' } }), { code: 'invalid-alias' });
});
