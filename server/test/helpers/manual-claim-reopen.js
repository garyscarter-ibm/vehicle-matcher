import { createPostgresRepository } from '../../gcsp/repository/index.js';

// Invoked only by the configured-provider contract. Connection configuration is
// inherited privately from the test environment, never passed as an argument/log.
const [schema, runId, environmentId, holdId] = process.argv.slice(2);
const repository = createPostgresRepository({ schema, migrate: false });
const context = { runId, environmentId, principalId: 'contract-reopen', roles: [] };
try {
  if ((await repository.open()).status !== 'ok') throw new Error('unavailable');
  const hold = await repository.read(context, { table: 'holds', key: { runId, holdId } });
  if (hold.status !== 'ok') throw new Error('unavailable');
  const quote = await repository.read(context, { table: 'quotes', key: { runId, quoteId: hold.value.quoteId } });
  if (quote.status !== 'ok') throw new Error('unavailable');
  const draft = await repository.read(context, { table: 'event_receipts', key: {
    runId, consumerId: `manual:draft:${hold.value.employeeId}`, eventId: String(quote.value.draftVersion) } });
  const operations = await repository.query(context, 'pending_operations', { holdId });
  const claims = await repository.query(context, 'claims', { holdId });
  const stock = await repository.read(context, { table: 'stock', key: { runId, orderUuid: hold.value.orderUuid } });
  if ([draft, operations, claims, stock].some((outcome) => outcome.status !== 'ok')) throw new Error('unavailable');
  process.stdout.write(JSON.stringify({ hold: hold.value, quote: quote.value, draft: draft.value.outcome.value, operations: operations.value, claims: claims.value, stock: stock.value }));
} catch {
  process.stderr.write('Configured PostgreSQL process reopen proof unavailable.');
  process.exitCode = 1;
} finally { await repository.close(); }
