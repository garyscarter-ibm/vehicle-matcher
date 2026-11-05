import { ok, result } from '../repository/index.js';

const absent = (resourceType) => result('not-found', { resourceType });

// Replace these read ports when authoritative integrations are available. The repository
// remains the only mutable store; identity's seeded employee and slot remain authority.
export function createRepositoryManualPorts({ repository, policy } = {}) {
  const employee = (context) => repository.read(context, { table: 'employees', key: {
    runId: context.runId, employeeId: context.employeeId,
  } });
  const records = async (context) => {
    const found = await employee(context);
    if (found.status !== 'ok') return found;
    if (!found.value.contract?.manualContext) return absent('hr-account');
    return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
      ...structuredClone(found.value.contract.manualContext), repositoryVersion: found.value.version });
  };
  const rules = async (_context, read) => policy.getAssumption('manual.context.v1', read);
  return {
    employeeContract: { async read(context) {
      const found = await records(context);
      if (found.status !== 'ok') return found;
      const slots = await repository.query(context, 'entitlement_slots', { employeeId: context.employeeId });
      if (slots.status !== 'ok') return slots;
      const { drivers, employeeFacts, ...value } = found.value;
      return ok({ ...value, slots: slots.value });
    } },
    driver: { async read(context) {
      const found = await records(context);
      return found.status === 'ok' ? ok({ runId: context.runId, environmentId: context.environmentId,
        employeeId: context.employeeId, recordSetId: found.value.recordSetId, source: found.value.source,
        drivers: found.value.drivers, employeeFacts: found.value.employeeFacts,
        repositoryVersion: found.value.repositoryVersion }) : found;
    } },
    schemeTerms: { async read(context, read) {
      const [configuration, allowance] = await Promise.all([rules(context, read), policy.getAllowance(context, read)]);
      if (configuration.status !== 'ok') return configuration;
      if (allowance.status !== 'ok') return allowance;
      return ok({ configuration: configuration.value, allowance: allowance.value, policyVersion: allowance.policyVersion });
    } },
    collectionRule: { async read(context, read) {
      const configuration = await rules(context, read);
      return configuration.status === 'ok' ? ok({ configuration: configuration.value,
        policyVersion: configuration.policyVersion }) : configuration;
    } },
    releasedStock: { async read(context) {
      const rows = await repository.query(context, 'stock');
      if (rows.status !== 'ok') return rows;
      const released = rows.value.filter((row) => ['released', 'held', 'allocated'].includes(row.state));
      if (released.some((row) => !Array.isArray(row.visibility?.companyIds) || !Array.isArray(row.visibility?.schemeIds)
        || row.visibility.employeeIds !== null && !Array.isArray(row.visibility.employeeIds))) return result('unavailable', {
        reason: 'Released-stock visibility is unconfirmed.', retryable: true,
      });
      const visible = released.filter((row) => row.visibility.companyIds.includes(context.companyId)
        && row.visibility.schemeIds.includes(context.schemeId)
        && (row.visibility.employeeIds === null || row.visibility.employeeIds.includes(context.employeeId)));
      return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
        sourceVersion: `stock:${rows.value.map((row) => `${row.orderUuid}:${row.version}`).sort().join('|')}`,
        // Exact stock, including unavailable records, is checked by the shared gates.
        stock: visible.map((row) => ({ orderUuid: row.orderUuid, orderNumber: row.orderNumber,
          configurationId: row.configurationId, snapshot: row.facts,
          availability: { ...row.release?.availability,
            state: row.state === 'released' && row.available === true && row.held !== true && row.allocated !== true
              ? row.release?.availability?.state : 'unavailable' } })) });
    } },
  };
}
