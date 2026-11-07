import { ok, result } from '../repository/index.js';
import { unavailable } from './terms.js';

// F66 remains the only manual allocation authority. It repeats live eligibility/driver/licence checks on allocate.
export function createManualOrderConversion({ claims, manual } = {}) {
  const conversion = {
    async prepare(context, input) {
      if (typeof manual?.revalidateHeldSelection !== 'function') return unavailable('held-selection-validation-unavailable');
      const [held, draft, account, eligibility] = await Promise.all([claims.readClaim(context), manual.readDraft(context),
        manual.readAccount(context), manual.revalidateHeldSelection(context, input.holdId)]);
      if (held.status !== 'ok') return held;
      if (draft.status !== 'ok') return draft;
      if (account.status !== 'ok') return account;
      if (eligibility.status !== 'ok') return eligibility;
      const decision = eligibility.value.decisions?.find((row) => row.orderUuid === held.value.hold.orderUuid);
      if (decision?.gateStatus !== 'eligible') return result('conflict', { reason: 'selection-no-longer-eligible' });
      if (account.value.contextVersion !== held.value.quote.eligibility.contextVersion)
        return result('conflict', { reason: 'context-review-required' });
      if (draft.value.requiresRefresh || !draft.value.choices?.driverId || !draft.value.choices?.contractOptionId || !draft.value.choices?.contact || draft.value.draftVersion !== input.expectedDraftVersion)
        return result('conflict', { reason: 'draft-review-required' });
      if (held.value.hold.holdId !== input.holdId || held.value.hold.phase !== 'order-review')
        return result('conflict', { reason: 'order-review-required' });
      const driver = account.value.drivers?.find((d) => d.driverId === draft.value.choices.driverId);
      if (!driver) return unavailable('driver-unavailable');
      return ok({ draft: draft.value, employee: account.value.account, driver,
        oldContract: draft.value.currentContract, versions: account.value.versions });
    },
    allocate(context, input) { return claims.allocate(context, input); },
  };
  if (typeof claims?.convertSelection === 'function') {
    conversion.convertSelection = (context, input, options) => claims.convertSelection(context, input, options);
  }
  return conversion;
}
