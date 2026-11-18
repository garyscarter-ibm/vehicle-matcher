// FUCQ-466 proof only: a local offer is accepted before its separate remote ordering outcome.
import { createServer } from 'node:https';

const sqlText = (value) => "'" + value.replaceAll("'", "''") + "'";
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };
const mainText = "(document.querySelector('#gcsp-main')??document.body).innerText";

function savedState(pg, database, operationId) {
  return JSON.parse(pg(['-d', database, '-Atc', `SELECT json_build_object(
    'offerId',o.offer_id,'offerState',o.state,'holdId',h.hold_id,'holdState',h.state,
    'operationId',s.operation_id,'operationState',p.state,'outcome',p.outcome,
    'orderUuid',s.order_uuid,'orderReference',s.order_reference,
    'decisions',(SELECT count(*) FROM gcsp_app.offer_decisions d WHERE d.environment_id=o.environment_id AND d.run_id=o.run_id AND d.offer_id=o.offer_id),
    'selections',(SELECT count(*) FROM gcsp_app.selection_orders x WHERE x.environment_id=s.environment_id AND x.run_id=s.run_id AND x.employee_id=s.employee_id))
    FROM gcsp_app.selection_orders s JOIN gcsp_app.pending_operations p USING(environment_id,run_id,operation_id)
    JOIN gcsp_app.custody_holds h ON h.environment_id=s.environment_id AND h.run_id=s.run_id AND h.hold_id=s.hold_id
    JOIN gcsp_app.buddy_offers o ON o.environment_id=h.environment_id AND o.run_id=h.run_id AND o.hold_id=h.hold_id
    WHERE s.operation_id=${sqlText(operationId)}`]));
}

export async function startRemoteOrderingServer(tls, { pg, database, outcome }) {
  requireCheck(['pending', 'refused'].includes(outcome), 'Unknown downstream ordering proof case');
  const operations = new Map(); const calls = []; const failures = [];
  const server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
    try {
      const url = new URL(req.url, 'https://127.0.0.1'); let body;
      if (req.method === 'POST' && url.pathname === '/execute') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; requireCheck(size <= 65536, 'Ordering request too large'); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks).toString());
        requireCheck(req.headers['idempotency-key'] === body.idempotencyKey, 'Ordering idempotency header differs');
        const beforeIo = savedState(pg, database, body.operationId);
        const previous = operations.get(body.operationId);
        requireCheck(!previous, 'Ordering execute must happen once');
        operations.set(body.operationId, { request: body, beforeIo });
        requireCheck(beforeIo.offerState === 'accepted' && beforeIo.holdState === 'allocated'
          && beforeIo.decisions === 1 && beforeIo.selections === 1 && beforeIo.operationState === 'pending'
          && beforeIo.outcome?.phase === 'submitting',
        'Local accepted decision, allocated custody and one durable ordering intent must precede provider I/O');
        body = { status: outcome === 'pending' ? 'unknown' : 'rejected', operationId: body.operationId,
          runId: body.runId, orderUuid: body.orderUuid, fictional: true };
      } else if (req.method === 'GET' && url.pathname === '/reconcile') {
        const operationId = url.searchParams.get('operationId');
        body = { status: operations.has(operationId) ? outcome === 'pending' ? 'unknown' : 'rejected' : 'not-found',
          operationId, runId: url.searchParams.get('runId'), orderUuid: url.searchParams.get('orderUuid'), fictional: true };
      } else { res.writeHead(404).end(); return; }
      calls.push({ method: req.method, ...body });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    } catch (error) {
      failures.push(error.message); res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `https://127.0.0.1:${server.address().port}`,
    evidence: () => structuredClone({ outcome, calls, failures, operations: [...operations.values()] }),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

export async function orderingDecisionScenarios(d) {
  const { cdp, ctx, prepared, restartApi, remoteOrdering, scenario, newPage, closePage, signInAs,
    pageEvidence, direct, pg, database, outcome } = d;
  const expectedState = outcome === 'pending' ? 'handoff-pending' : 'handoff-failed';
  const message = outcome === 'pending' ? 'Sending your selection to ordering.' : 'Nothing has been ordered.';
  await scenario(`ordering-${outcome}`, `Accepted local offer preserves actual downstream ordering ${outcome} through current reads and restart`, async (s) => {
    const page = await newPage(cdp);
    try {
      await signInAs(page, 'sub-employee', prepared.link);
      await page.waitFor(`document.querySelector('[data-offer-action="accept"]')`, 15000, 'owned local offer');
      await page.eval(`document.querySelector('[data-offer-action="accept"]').click()`);
      await page.waitFor(`document.querySelector('[data-offer-action="confirm"]')`, 5000, 'accept review');
      await page.eval(`(() => { const e=document.querySelector('input[id$="-mileage"]');if(e){e.value='45000';e.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelectorAll('[role="dialog"] input[type="checkbox"],dialog input[type="checkbox"]').forEach(e=>{if(!e.checked)e.click();});})()`);
      await page.waitFor(`!document.querySelector('[data-offer-action="confirm"]').disabled`, 5000, 'explicit declarations');
      await page.eval(`document.querySelector('[data-offer-action="confirm"]').click()`);
      await page.waitFor(`${mainText}.includes(${JSON.stringify(message)}) && !document.querySelector('[data-offer-action="confirm"]')`, 15000, 'actual downstream receipt rendered');
      await page.settle();
      const native = page.log.findLast(e => e.method === 'POST' && e.url.endsWith('/decision'));
      requireCheck(native?.status === 200 && native.decisionInput?.runId === 'run-1'
        && native.decisionInput?.expectedQuoteVersion === 1, 'Native canonical Angular command must be accepted');
      s.checks.nativeLocalDecisionAccepted = true;
      s.observations.immediate = await pageEvidence(page, `ordering-${outcome}-receipt`);
      const replay = await direct(ctx, 'POST', `/offers/${encodeURIComponent(prepared.offerId)}/decision`, prepared.employee, native.decisionInput);
      const receipt = replay.json?.value; const operationId = receipt?.operationId;
      requireCheck(replay.status === 200 && receipt?.state === 'accepted' && receipt.selection?.operationState === expectedState,
        'Accepted replay must preserve actual downstream outcome');
      const persisted = savedState(pg, database, operationId);
      const provider = remoteOrdering.evidence(); const wire = provider.operations[0];
      s.checks.acceptedAllocatedOnce = persisted.offerId === prepared.offerId && persisted.offerState === 'accepted'
        && persisted.holdState === 'allocated' && persisted.decisions === 1 && persisted.selections === 1;
      s.checks.actualProviderOutcome = provider.failures.length === 0 && provider.operations.length === 1
        && provider.calls.filter(c => c.method === 'POST').length === 1
        && persisted.operationState === (outcome === 'pending' ? 'pending' : 'refused')
        && persisted.outcome?.status === (outcome === 'pending' ? 'unknown' : 'rejected');
      s.checks.exactOperationIdentity = wire?.request.operationId === operationId && wire.request.runId === 'run-1'
        && wire.request.orderUuid === persisted.orderUuid && receipt.selection.order === null
        && receipt.selection.orderReference === persisted.orderReference;
      s.checks.failureIsTruthful = outcome === 'pending' ? receipt.selection.failure === null
        : receipt.selection.failure?.reason === 'remote-ordering-rejected';
      s.checks.noRegainedDecisionAuthority = !await page.eval(`!!document.querySelector('[data-offer-action="accept"],[data-offer-action="decline"]')`);
      const beforeReads = JSON.stringify(provider.calls);
      const current = await direct(ctx, 'GET', `/offers/${encodeURIComponent(prepared.offerId)}`, prepared.employee);
      s.checks.currentReadUsesActualState = current.status === 200 && current.json?.value?.state === 'accepted'
        && current.json.value.selection?.selectionState === expectedState;
      await page.eval(`document.querySelector('[data-offer-action="check"]').click()`);
      await page.waitFor(`${mainText}.includes(${JSON.stringify(message)})`, 10000, 'checked downstream state');
      await page.settle();
      s.observations.current = await pageEvidence(page, `ordering-${outcome}-current`);
      await restartApi(); await page.send('Page.navigate', { url: prepared.link });
      await page.waitFor(`${mainText}.includes(${JSON.stringify(message)})`, 30000, 'same saved downstream state after ordinary restart');
      s.observations.restart = await pageEvidence(page, `ordering-${outcome}-restart`);
      const afterRestart = await direct(ctx, 'GET', `/offers/${encodeURIComponent(prepared.offerId)}`, prepared.employee);
      const replayAfterRestart = await direct(ctx, 'POST', `/offers/${encodeURIComponent(prepared.offerId)}/decision`, prepared.employee, native.decisionInput);
      s.checks.restartPreservesExactOutcome = JSON.stringify(replayAfterRestart.json?.value) === JSON.stringify(receipt)
        && afterRestart.json?.value?.selection?.selectionState === expectedState
        && JSON.stringify(savedState(pg, database, operationId)) === JSON.stringify(persisted);
      s.checks.readsReplayRestartDoNotCallProvider = JSON.stringify(remoteOrdering.evidence().calls) === beforeReads;
      s.checks.recordIdentified = (await page.main()).includes(prepared.projection.quote.facts.display.name);
      s.observations.persisted = persisted; s.observations.receipt = receipt;
      s.observations.provider = remoteOrdering.evidence(); s.observations.network = page.api();
    } catch (error) {
      s.observations.failure = await pageEvidence(page, `ordering-${outcome}-failure`);
      s.observations.provider = remoteOrdering.evidence(); s.observations.network = page.api(); throw error;
    } finally { await closePage(cdp, page); }
  });
}
