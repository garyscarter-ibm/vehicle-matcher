#!/usr/bin/env node
// Replay actual Java responses through the unchanged strict Angular consumers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');

const [typescriptPath, ...logs] = process.argv.slice(2);
if (!typescriptPath || !logs.length) throw new Error('Usage: proof.cjs TYPESCRIPT_MODULE JAVA_LOG...');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'apps/gcsp-web/src/app/offers/offer.validation.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const ts = require(path.resolve(typescriptPath));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const consumer = new Module(sourcePath, module);
consumer.filename = sourcePath;
consumer.paths = module.paths;
consumer._compile(compiled.outputText, sourcePath);
const { parseOfferDecisionReceipt, parseOfferFailure } = consumer.exports;
const cases = [];
let accept, decline;
for (const log of logs) {
  for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
    const match = line.match(/^F466_(BROWSER_RECEIPT|ACCEPT_RECEIPT|DECLINE_RECEIPT|DECLINED_RECEIPT|CASE|REMOTE_PENDING) (\{.*\})$/);
    if (!match) continue;
    const row = JSON.parse(match[2]);
    if (match[1] === 'BROWSER_RECEIPT') accept = row;
    else if (match[1] === 'DECLINE_RECEIPT') decline = row;
    else if (match[1] === 'ACCEPT_RECEIPT') cases.push({ ...accept, receipt: row, case: 'accepted' });
    else if (match[1] === 'DECLINED_RECEIPT') cases.push({ ...decline, receipt: row, case: 'declined' });
    else cases.push({ ...row, case: row.case ?? 'remote-pending' });
  }
}
const verified = [];
for (const row of cases) {
  const pending = row.case === 'remote-pending';
  const parse = (value, expected = row.input) => pending
    ? parseOfferFailure(value, expected)
    : parseOfferDecisionReceipt(value, expected, row.employeeId);
  const parsed = parse(row.receipt);
  assert.ok(parsed, `${row.case}: strict Angular consumer rejected actual response`);
  if (pending) {
    assert.equal(parsed.status, 'pending');
    // OfferClient.pendingIdentityMatches: apply the actual context/command coordinates.
    assert.ok(parsed.runId === undefined || parsed.runId === row.input.runId);
    for (const key of ['offerId', 'decisionId', 'commandId']) {
      assert.ok(parsed[key] === undefined || parsed[key] === row.input[key]);
    }
  } else {
    assert.equal(parsed.state, row.input.decision === 'accept' ? 'accepted' : 'declined');
    assert.equal(parse(row.receipt, { ...row.input, runId: 'other-run' }), null);
    assert.equal(parse(row.receipt, { ...row.input, commandId: 'other-command' }), null);
    assert.equal(parse({ ...row.receipt, browserReceiptFacts: {} }), null);
  }
  verified.push({ case: row.case, state: parsed.state ?? parsed.status,
    orderingState: parsed.selection?.operationState ?? null, identityMatched: true });
}
for (const name of ['accepted', 'declined', 'pending', 'refused', 'reconciled', 'remote-pending', 'retained-policy']) {
  assert.ok(verified.some(row => row.case === name), `missing actual response: ${name}`);
}
console.log(JSON.stringify({ status: 'PASS', consumer: path.relative(root, sourcePath),
  consumerSha256: crypto.createHash('sha256').update(source).digest('hex'), cases: verified }, null, 2));
