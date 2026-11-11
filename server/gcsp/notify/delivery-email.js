import { inputDigest, ok, result } from '../repository/index.js';

export const validDeliveryEmail = (value) => typeof value === 'string' && value === value.trim()
  && value.length <= 254 && /^[^\s<>@,;\u0000-\u001f\u007f]+@[^\s<>@,;\u0000-\u001f\u007f]+\.[^\s<>@,;\u0000-\u001f\u007f]+$/.test(value);
const invalid = () => result('invalid', { code: 'notification-email-invalid',
  reasons: [{ field: 'deliveryEmail', reason: 'Enter a valid email address, or clear it to stop email notifications.' }] });
const project = (employee) => ok({ deliveryEmail: employee.deliveryEmail ?? null, version: employee.deliveryEmailVersion ?? 0 });

// The session supplies the employee. Recipient selectors from the browser are never accepted.
export function createDeliveryEmailRoutes({ repository } = {}) {
  return ['GET', 'POST'].map((method) => ({ method, path: '/api/gcsp/manual/notification-email', role: 'employee',
    async handle({ context, body = {}, searchParams }) {
      if (searchParams.size || Object.keys(body).some((key) => !(method === 'POST'
        ? ['commandId', 'expectedVersion', 'deliveryEmail'] : []).includes(key))) return invalid();
      if (!repository) return result('unavailable', { retryable: true });
      if (!context.employeeId) return result('forbidden', {});
      const ref = { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } };
      if (method === 'GET') {
        const employee = await repository.read(context, ref);
        return employee.status === 'ok' ? project(employee.value) : employee;
      }
      if (typeof body.commandId !== 'string' || !body.commandId.trim() || body.commandId.length > 128
        || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0
        || body.deliveryEmail !== null && !validDeliveryEmail(body.deliveryEmail)) return invalid();
      return repository.transaction(context, {
        commandId: `notification-email:${inputDigest([context.employeeId, body.commandId])}`, inputDigest: inputDigest(body),
      }, async (tx) => {
        const employee = await tx.get(ref);
        if (employee.status !== 'ok') return employee;
        if ((employee.value.deliveryEmailVersion ?? 0) !== body.expectedVersion) return result('stale-version', { resource: 'notification-email' });
        const changed = await tx.compareAndSwap(ref, employee.value.version, {
          deliveryEmail: body.deliveryEmail, deliveryEmailVersion: body.expectedVersion + 1,
        });
        return changed.status === 'ok' ? project(changed.value) : changed;
      });
    },
  }));
}
