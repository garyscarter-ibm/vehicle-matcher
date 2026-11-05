import { validInstant } from '../policy/file-provider.js';

const copy = (value) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\u2014/g, '-').trim() : '';
const escape = (value) => copy(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function safeOfferLink(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

// No token generation, URL logging, scripts, remote assets or executable markup.
export function renderOfferMessage({ offer, quote, employee, offerLink, now }) {
  if (!offer || !employee || !safeOfferLink(offerLink) || !validInstant(now) || !validInstant(offer.expiresAt)) {
    throw new TypeError('Offer message inputs are unavailable.');
  }
  const name = copy(employee.name) || 'Scheme employee (fictional)';
  const vehicle = copy(quote?.facts?.model ?? quote?.facts?.modelName ?? quote?.facts?.name) || 'Your scheme vehicle';
  const expired = Date.parse(offer.expiresAt) <= Date.parse(now) || offer.state === 'expired';
  const subject = expired ? 'Your vehicle offer has expired' : 'Your vehicle offer is ready to review';
  const status = expired ? 'This offer has expired. Open your employee account to check its current status.'
    : `Your offer is available until ${offer.expiresAt}. Open the offer to review the vehicle and make your decision.`;
  const missing = quote?.facts ? '' : 'Full vehicle details are not available in this notification. Check the offer in your account.';
  const textBody = [`Hello ${name},`, '', subject, vehicle, status, missing, '', `Review your offer: ${offerLink}`, '',
    'This is a captured demonstration message for a fictional employee. No email has been sent.'].filter((line) => line !== '').join('\n\n');
  const htmlBody = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f4f5f5;color:#202526;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:600px;margin:0 auto;padding:24px;background:#fff;overflow-wrap:anywhere"><p>GCSP employee vehicle scheme</p><h1 style="font-size:26px;line-height:1.25">${subject}</h1><p>Hello ${escape(name)},</p><h2 style="font-size:20px">${escape(vehicle)}</h2><p>${escape(status)}</p>${missing ? `<p>${escape(missing)}</p>` : ''}<p><a style="color:#00636b;text-decoration:underline" href="${escape(offerLink)}">Review your vehicle offer and its current status</a></p><p>If you cannot use the link, copy this address:</p><p>${escape(offerLink)}</p><hr><p>This is a captured demonstration message for a fictional employee. No email has been sent.</p></main></body></html>`;
  return { recipient: { employeeId: employee.employeeId, name, fictional: true }, subject, textBody, htmlBody, offerLink };
}
