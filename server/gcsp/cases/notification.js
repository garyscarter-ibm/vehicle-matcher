import { validInstant } from '../policy/file-provider.js';
const copy = (v) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\u2014/g, '-').trim() : '';
const escape = (v) => copy(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export function renderCaseMessage({ update, employee }) {
  if (!update || !employee || update.employeeId !== employee.employeeId || !update.caseId || !update.owner?.role
    || !validInstant(update.dueAt) || !validInstant(update.occurredAt) || !copy(update.nextAction)) throw new TypeError('Case message facts unavailable.');
  const name = copy(employee.name) || 'Scheme employee (fictional)';
  const subject = 'Your renewal case has been updated';
  const content = [`Hello ${name},`, subject, `Status: ${copy(update.status)}. Owner: ${copy(update.owner.name)}.`,
    copy(update.reason), `Next action: ${copy(update.nextAction)}`, `Due on the demonstration clock: ${update.dueAt}`,
    'This case gives no automatic allocation priority. Review your employee account for the current case status.',
    'This is a captured demonstration message for a fictional employee. No email has been sent.'];
  return { recipient: { employeeId: employee.employeeId,name,fictional:true },subject,caseId:update.caseId,caseVersion:update.caseVersion,
    textBody:content.join('\n\n'),htmlBody:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body><main><h1>${subject}</h1>${content.filter((v) => v!==subject).map((v) => `<p>${escape(v)}</p>`).join('')}</main></body></html>` };
}
