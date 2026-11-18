// FUCQ-467 controlled substitute and native Angular scenarios. This is proof tooling, never a product endpoint.
import { createServer } from 'node:https';

const sqlText = (value) => "'" + value.replaceAll("'", "''") + "'";
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };

export async function startRemoteDecisionServer(tls, { pg, database }) {
  const operations = new Map();
  const next = new Map();
  let reconciliation = 'LOOKUP';
  const rows = (sql) => JSON.parse(pg(['-d', database, '-Atc', sql]));
  const snapshot = (body) => rows(`SELECT json_build_object(
    'intentCount',(SELECT count(*) FROM gcsp_app.pending_operations WHERE operation_id=${sqlText(body.operationId)}),
    'receiptCount',(SELECT count(*) FROM gcsp_app.command_receipts WHERE command_id=${sqlText('offer-decision:' + body.payload.offerId + ':' + body.payload.commandId)}),
    'holdState',(SELECT state FROM gcsp_app.custody_holds WHERE hold_id=${sqlText(body.holdId)}),
    'offerState',(SELECT state FROM gcsp_app.buddy_offers WHERE offer_id=${sqlText(body.payload.offerId)}),
    'decisions',(SELECT count(*) FROM gcsp_app.offer_decisions WHERE offer_id=${sqlText(body.payload.offerId)}),
    'orders',(SELECT count(*) FROM gcsp_app.selection_orders WHERE employee_id=${sqlText(body.employeeId)}))`);
  const server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
    try {
      const url = new URL(req.url, 'https://127.0.0.1');
      let body;
      if (req.method === 'POST' && url.pathname === '/execute') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString());
        requireCheck(req.headers['idempotency-key'] === body.operationId, 'Remote idempotency identity mismatch');
        let operation = operations.get(body.operationId);
        if (!operation) { operation = { operationId: body.operationId, runId: body.runId, orderUuid: body.orderUuid, type: body.operationType, posts: 0, gets: 0, effects: 0 }; operations.set(body.operationId, operation); }
        operation.posts++;
        if (body.operationType.startsWith('offer-')) {
          operation.beforeIo ??= snapshot(body);
          requireCheck(operation.beforeIo.intentCount === 1 && operation.beforeIo.receiptCount === 1
            && operation.beforeIo.decisions === 0 && operation.beforeIo.orders === 0, 'Decision intent/receipt must commit before remote I/O');
          requireCheck(body.operationType === 'offer-selection'
            ? operation.beforeIo.holdState === 'selection-pending' && operation.beforeIo.offerState === 'decision-pending'
            : operation.beforeIo.holdState === 'release-pending' && operation.beforeIo.offerState === 'release-pending',
          'Durable custody must already match the authorized decision intent');
        }
        const mode = next.get(body.operationType) ?? 'APPLY'; next.delete(body.operationType);
        if (mode === 'REJECT') operation.rejected = true;
        if (['APPLY', 'APPLY_THEN_DROP'].includes(mode)) operation.effects = 1;
        if (mode === 'APPLY_THEN_DROP') { req.socket.destroy(); return; }
        body = { status: mode === 'REJECT' ? 'rejected' : 'confirmed', operationId: mode === 'MISMATCH' ? 'other-' + body.operationId : body.operationId, runId: body.runId, orderUuid: body.orderUuid };
      } else if (req.method === 'GET' && url.pathname === '/reconcile') {
        const id = url.searchParams.get('operationId');
        const operation = operations.get(id); if (operation) operation.gets++;
        body = { status: operation?.rejected ? 'rejected' : operation?.effects ? 'confirmed' : 'not-found', operationId: id, runId: url.searchParams.get('runId'), orderUuid: url.searchParams.get('orderUuid') };
        if (reconciliation === 'MISMATCH') body.runId = 'other-' + body.runId;
      } else { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    } catch (error) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://127.0.0.1:${server.address().port}`;
  return { origin, next: (type, mode) => next.set(type, mode), reconcile: (mode) => { reconciliation = mode; },
    operation: (id) => structuredClone(operations.get(id)),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

export async function remoteDecisionScenarios(d) {
  const { cdp, ctx, prepared, restartApi, remote, scenario, newPage, closePage, signInAs,
    pageEvidence, requireApi, direct, prepareOffer, pg, database } = d;
  const state = (offerId) => JSON.parse(pg(['-d', database, '-Atc', `SELECT json_build_object(
    'decisions',(SELECT count(*) FROM gcsp_app.offer_decisions WHERE offer_id=${sqlText(offerId)}),
    'orders',(SELECT count(*) FROM gcsp_app.selection_orders WHERE employee_id=(SELECT employee_id FROM gcsp_app.buddy_offers WHERE offer_id=${sqlText(offerId)})),
    'holdState',(SELECT h.state FROM gcsp_app.custody_holds h JOIN gcsp_app.buddy_offers o USING(environment_id,run_id,hold_id) WHERE o.offer_id=${sqlText(offerId)}))`]));
  const receipt = (offerId, commandId) => pg(['-d', database, '-Atc', `SELECT result::text FROM gcsp_app.command_receipts WHERE command_id=${sqlText('offer-decision:' + offerId + ':' + commandId)}`]);
  const reload = async (page, offer) => { await page.send('Page.navigate', { url: offer.link }); await page.waitFor(`document.querySelector('.offer-page gcsp-screen-intro') && !document.querySelector('[data-offer-action="confirm"]')`, 15000, 'current offer reload'); await page.settle(); };
  const decide = async (page, decision) => {
    await page.waitFor(`document.querySelector('[data-offer-action="${decision}"]')`, 15000, 'decision action');
    await page.eval(`document.querySelector('[data-offer-action="${decision}"]').click()`);
    if (decision === 'accept') {
      await page.waitFor(`document.querySelector('input[id$="-mileage"]')`, 10000, 'accept declarations');
      await page.eval(`(() => { const e=document.querySelector('input[id$="-mileage"]');e.value='45000';e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('[role="dialog"] input[type="checkbox"],dialog input[type="checkbox"]').forEach(e=>{if(!e.checked)e.click();});})()`);
    } else {
      await page.waitFor(`document.querySelector('input[type="radio"][value="body-style"]')`, 10000, 'reviewed decline reason');
      await page.eval(`document.querySelector('input[type="radio"][value="body-style"]').click()`);
    }
    await page.waitFor(`!document.querySelector('[data-offer-action="confirm"]').disabled`, 5000, 'confirmed decision');
    await page.eval(`document.querySelector('[data-offer-action="confirm"]').click()`);
    await page.waitFor(`!document.querySelector('[data-offer-action="confirm"]')`, 15000, 'remote decision response');
    await page.settle();
    const result = page.log.findLast(e => e.method === 'POST' && e.url.endsWith('/decision'));
    requireCheck(result?.status === 202 && result.decisionInput?.decision === decision, 'Native browser must receive remote pending receipt');
    return { result };
  };
  if (process.env.PROOF_REMOTE_CASE !== 'decline-refused') await scenario('remote-accept-refusal-loss-restart', 'Native accept preserves refused and uncertain intent, then reconciles once after restart', async (s) => {
    const offer = prepared; const page = await newPage(cdp);
    try {
      await signInAs(page, 'sub-employee', offer.link);
      remote.next('offer-selection', 'REJECT');
      const rejected = (await decide(page, 'accept')).result;
      s.observations.refused = await pageEvidence(page, 'remote-accept-refused');
      await reload(page, offer);
      s.checks.refusedAcceptKeepsOffer = (await state(offer.offerId)).holdState === 'active';
      s.observations.retryAvailable = await pageEvidence(page, 'remote-accept-retry');
      remote.next('offer-selection', 'APPLY_THEN_DROP'); remote.reconcile('MISMATCH');
      const uncertain = (await decide(page, 'accept')).result;
      const original = receipt(offer.offerId, uncertain.decisionInput.commandId);
      const projection = await requireApi(ctx, 'GET', `/offers/${encodeURIComponent(offer.offerId)}`, offer.employee);
      const operation = JSON.parse(original).operationId;
      const pendingReplay = await direct(ctx, 'POST', `/offers/${encodeURIComponent(offer.offerId)}/decision`, offer.employee, uncertain.decisionInput);
      requireCheck(operation && pendingReplay.status === 202 && pendingReplay.json?.operationId === operation && projection.reason === 'decision-pending', 'Original command must retain its durable pending identity');
      await reload(page, offer);
      s.checks.pendingTruthful = (await page.main()).toLowerCase().includes('checking your decision') && (await state(offer.offerId)).holdState === 'selection-pending';
      s.observations.pending = await pageEvidence(page, 'remote-accept-pending');
      remote.reconcile('LOOKUP'); await restartApi(); await reload(page, offer);
      await page.waitFor(`/offer accepted/i.test(document.querySelector('#gcsp-main')?.innerText??'')`, 15000, 'accepted after reconciliation');
      const final = state(offer.offerId); const wire = remote.operation(operation);
      s.checks.finalizesOnce = final.decisions === 1 && final.orders === 1 && final.holdState === 'allocated' && wire.posts === 1 && wire.effects === 1;
      s.checks.originalReceiptStable = receipt(offer.offerId, uncertain.decisionInput.commandId) === original;
      const replay = await direct(ctx, 'POST', `/offers/${encodeURIComponent(offer.offerId)}/decision`, offer.employee, uncertain.decisionInput);
      s.checks.originalCommandReplay = replay.status === 202 && replay.json?.operationId === operation && remote.operation(operation).posts === 1;
      s.checks.refusedCommandDistinct = rejected.decisionInput.commandId !== uncertain.decisionInput.commandId;
      s.observations.final = await pageEvidence(page, 'remote-accept-confirmed'); s.observations.wire = wire; s.observations.network = page.api();
    } finally { await closePage(cdp, page); }
  });
  const declines = process.env.PROOF_REMOTE_CASE === 'decline-refused'
    ? [['remote-decline-refused', 'sub-alex', 'employee-alex', 'REJECT']]
    : [['remote-decline-loss-restart', 'sub-alex', 'employee-alex', 'APPLY_THEN_DROP']];
  for (const [id, subject, employee, mode] of declines) {
    await scenario(id, 'Native decline retains custody until a matching confirmed remote release', async (s) => {
      const offer = await prepareOffer(ctx, subject, employee); const page = await newPage(cdp);
      try {
        await signInAs(page, subject, offer.link); remote.next('offer-decline-release', mode); remote.reconcile('MISMATCH');
        const native = (await decide(page, 'decline')).result;
        const original = receipt(offer.offerId, native.decisionInput.commandId);
        const projection = await requireApi(ctx, 'GET', `/offers/${encodeURIComponent(offer.offerId)}`, offer.employee);
        const operation = JSON.parse(original).operationId;
        const pendingReplay = await direct(ctx, 'POST', `/offers/${encodeURIComponent(offer.offerId)}/decision`, offer.employee, native.decisionInput);
        requireCheck(operation && pendingReplay.status === 202 && pendingReplay.json?.operationId === operation && projection.reason === 'release-pending', 'Original release command must retain its operation identity');
        await reload(page, offer);
        s.checks.pendingTruthful = (await page.main()).toLowerCase().includes('checking your decision') && state(offer.offerId).holdState === 'release-pending';
        s.observations.pending = await pageEvidence(page, id + '-pending');
        remote.reconcile('LOOKUP'); await restartApi(); await reload(page, offer);
        const final = state(offer.offerId); const wire = remote.operation(operation);
        s.checks.truthfulFinal = mode === 'REJECT' ? final.decisions === 0 && final.holdState === 'release-pending' && wire.effects === 0
          : final.decisions === 1 && final.holdState === 'released' && wire.effects === 1 && (await page.main()).toLowerCase().includes('offer declined');
        s.checks.noOrderOrDuplicateExecute = final.orders === 0 && wire.posts === 1;
        s.checks.originalReceiptStable = receipt(offer.offerId, native.decisionInput.commandId) === original;
        s.observations.final = await pageEvidence(page, id + '-final'); s.observations.wire = wire; s.observations.network = page.api();
      } finally { await closePage(cdp, page); }
    });
  }
}
