import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAccountHttpAdapter as createShellAccountAdapter } from '../../blocks/gcsp/shell/account-runtime.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';

let dom;
let employee;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gcsp.test/gcsp/greg' });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'Node']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  }
  employee = await import('../../blocks/gcsp/employee/gcsp-employee.js');
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());
const tick = () => new Promise((done) => setTimeout(done, 0));
const response = (value, status = 200) => ({ status, ok: status < 400, json: async () => value });
const liveAccount = () => {
  return { status: 'ok', value: { state: 'ready', account: { employeeId: 'employee-ada', name: 'Ada Longworth', roles: ['employee'], gradeId: 'G7',
    contact: { phone: '01632 960000', email: 'ada.longworth@gcsp-demo.com' } }, drivers: [], contracts: [], slots: [], actions: [] } };
};
const host = () => { const root = document.createElement('div'); document.body.append(root); return root; };

test('both employee account adapters preserve the server profile email for shared menu consumers', async () => {
  const fetch = async () => response(liveAccount());
  const shell = await createShellAccountAdapter({ fetch }).loadAccount();
  const account = await createAccountHttpAdapter({ fetchImpl: fetch }).loadAccount();
  for (const projected of [shell, account]) {
    assert.equal(projected.name, 'Ada Longworth'); assert.equal(projected.email, 'ada.longworth@gcsp-demo.com');
  }
});

test('employee shell forwards email and explicit preview sign-out opt-out', async () => {
  for (const signOut of [true, false]) {
    const root = host();
    const stop = employee.mountEmployee(root, { signOut,
      loadAccount: async () => ({ status: 'ready', name: 'Ada Longworth', email: 'ada.longworth@gcsp-demo.com' }) });
    await tick();
    assert.equal(root.querySelector('.gcsp-account-email').textContent, 'ada.longworth@gcsp-demo.com');
    assert.equal(Boolean(root.querySelector('.gcsp-account-signout')), signOut); stop();
  }
});

test('named employee custom element fixtures never offer live sign-out', async () => {
  employee.defineGcspEmployee();
  const element = document.createElement('gcsp-employee'); element.setAttribute('fixture', 'representative'); document.body.append(element);
  await new Promise((done) => setTimeout(done, 500));
  assert.ok(element.querySelector('.gcsp-account-name'));
  assert.equal(element.querySelector('.gcsp-account-signout'), null); element.remove();
});
