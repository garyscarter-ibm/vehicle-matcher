import { describe, expect, it } from 'vitest';
import { accountSnapshot, savedDraft } from './account.test-data';
import { deriveManualChoices, initialManualChoices, sameChoices } from './account-choices.model';
import { JourneyIntent, ManualChoices } from './account.types';

const intent: JourneyIntent = { mode: 'replacement', oldContractId: 'current:employee-paula', schemeId: 'choices-fs-uk', slotId: 'slot-paula' };
const complete = (): ManualChoices => ({ ...intent, driverId: 'driver:employee-paula', contractOptionId: 'six-month-8000',
  requestedCollectionDate: '2026-11-12', collectionLocationId: 'demo-collection-centre', brand: 'bmw',
  contact: { phone: '01632 960000', email: 'paula.mason@gcsp-demo.com' }, expectedReturnMileage: 0, specialRequirements: '' });

describe('native account manual choices', () => {
  it('preserves saved fields and zero mileage without manufacturing missing selections', () => {
    const account = accountSnapshot(); const initial = initialManualChoices(account, intent, savedDraft());
    expect(initial.driverId).toBe(''); expect(initial.contact?.email).toBe(account.account?.contact?.email);
    expect(initialManualChoices(account, intent, savedDraft({ choices: complete() }))).toEqual(complete());
  });
  it('matches the frozen populated choices, allowance and bounded collection window', () => {
    const model = deriveManualChoices(accountSnapshot(), complete());
    expect(model.valid).toBe(true); expect(model.allowance).toBe(1300);
    expect([model.minDate, model.maxDate]).toEqual(['2026-11-12', '2026-12-01']);
    expect(model.locations.map((option) => option.id)).toEqual(['demo-collection-centre']);
  });
  it('retains dependencies and filters a site that cannot apply to a nominated driver', () => {
    const model = deriveManualChoices(accountSnapshot(), { ...complete(), driverId: 'nominated:employee-paula', contractOptionId: 'twelve-month-12000' });
    expect(model.contracts.find((option) => option.id === 'twelve-month-12000')?.disabled).toBe(true);
    expect(model.errors['contractOptionId']).toBeTruthy();
    expect(deriveManualChoices(accountSnapshot(), { ...complete(), driverId: 'nominated:employee-paula' }).locations).toHaveLength(1);
  });
  it('requires sourced eligibility and a licence valid on the requested date', () => {
    const account = accountSnapshot(); const driver = account.drivers![0];
    const unknown = { ...account, drivers: [{ ...driver, eligible: { status: 'unknown' } }] };
    expect(deriveManualChoices(unknown, complete()).errors['driverId']).toContain('confirmation');
    const expired = { ...account, drivers: [{ ...driver, licence: { ...driver.licence, validUntil: '2026-11-11' } }] };
    expect(deriveManualChoices(expired, complete()).errors['driverId']).toContain('not valid');
  });
  it('does not borrow allowance from another company or accept unknown facts', () => {
    const account = accountSnapshot();
    expect(deriveManualChoices({ ...account, allowance: { ...account.allowance, companyId: 'other' } }, complete()).errors['allowance']).toBeTruthy();
    expect(deriveManualChoices({ ...account, allowance: { ...account.allowance, status: 'unknown' } }, complete()).allowance).toBeNull();
    expect(deriveManualChoices({ ...account, allowance: { ...account.allowance, monthlyPoints: 0 } }, complete()).allowance).toBe(0);
  });
  it('takes limits only from the projected policy and rejects missing policy', () => {
    const account = accountSnapshot();
    const changed = { ...account, assumptions: [{ key: 'manual.context.v1', value: { minimumLeadDays: 8, maximumLeadDays: 9, maximumReturnMileage: 10, maximumSpecialRequirements: 2 } }] };
    const model = deriveManualChoices(changed, { ...complete(), expectedReturnMileage: 11, specialRequirements: 'long' });
    expect(model.minDate).toBe('2026-11-13'); expect(model.maxDate).toBe('2026-11-14');
    expect(model.errors['requestedCollectionDate']).toBeTruthy(); expect(model.errors['expectedReturnMileage']).toBeTruthy(); expect(model.errors['specialRequirements']).toBeTruthy();
    expect(deriveManualChoices({ ...account, assumptions: [] }, complete()).errors['context']).toBeTruthy();
  });
  it('rejects impossible calendar dates and action/context drift', () => {
    expect(deriveManualChoices(accountSnapshot(), { ...complete(), requestedCollectionDate: '2026-02-30' }).valid).toBe(false);
    expect(deriveManualChoices({ ...accountSnapshot(), actions: [] }, complete()).errors['context']).toBeTruthy();
  });
  it('compares readback structurally despite property order', () => {
    expect(sameChoices({ a: 0, b: { c: '' } }, { b: { c: '' }, a: 0 })).toBe(true);
    expect(sameChoices(complete(), { ...complete(), expectedReturnMileage: null })).toBe(false);
  });
});
