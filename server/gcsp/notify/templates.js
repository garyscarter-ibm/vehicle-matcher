import { validInstant } from '../policy/file-provider.js';
import { isDisplayImage } from '../../../blocks/gcsp/kit/vehicle-image-assets.js';

const copy = (value) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\u2014/g, '-').trim() : '';
const escape = (value) => copy(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function safeOfferLink(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

const number = new Intl.NumberFormat('en-GB');
// Local on purpose: no shared server formatter exists yet. Zone matches the outbox viewer's demo-clock times.
const DEADLINE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', weekday: 'long', day: 'numeric', month: 'long' });
function deadlineWords(iso) {
  const part = Object.fromEntries(DEADLINE.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return `${part.hour}:${part.minute} on ${part.weekday} ${part.day} ${part.month}`;
}
const vehicleName = (quote) => {
  const display = quote?.facts?.display;
  const built = [display?.model, display?.derivative].map(copy).filter(Boolean).join(' ');
  return copy(display?.name) || built || copy(quote?.facts?.model ?? quote?.facts?.modelName ?? quote?.facts?.name) || 'Your scheme vehicle';
};
const monthlyPoints = (quote) => {
  const points = quote?.terms?.points ?? quote?.monthlyPoints;
  return Number.isFinite(points?.value) && points.value >= 0 && points.unit === 'points' ? `${number.format(points.value)} points a month` : '';
};

function vehicleImage(quote, alt) {
  const display = quote?.facts?.display;
  const images = (Array.isArray(display?.images) ? display.images : []).filter((image) => isDisplayImage(image?.src, image?.fidelity));
  const image = images.find((entry) => entry.src === display.photo) ?? images[0];
  return image ? { src: image.src, alt } : null;
}

// Transport-owned public bases keep image requests independent of private offer tokens.
export function withAbsoluteVehicleImage(message, base) {
  if (!message.vehicleImage || !base) return message;
  const src = new URL(message.vehicleImage.src.slice(1), base).href;
  return { ...message, vehicleImage: { ...message.vehicleImage, src },
    htmlBody: message.htmlBody.replaceAll(`src="${escape(message.vehicleImage.src)}"`, `src="${escape(src)}"`) };
}

// No token generation, URL logging, scripts or executable markup.
export function renderOfferMessage({ offer, quote, employee, offerLink, now }) {
  if (!offer || !employee || !safeOfferLink(offerLink) || !validInstant(now) || !validInstant(offer.expiresAt)) {
    throw new TypeError('Offer message inputs are unavailable.');
  }
  const given = copy(employee.name);
  const name = given || 'Scheme employee';
  const greeting = given ? `Hello ${given},` : 'Hello,';
  const vehicle = vehicleName(quote);
  const image = vehicleImage(quote, vehicle);
  const photo = image ? `<img src="${escape(image.src)}" alt="${escape(image.alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;margin:16px 0">` : '';
  const points = monthlyPoints(quote);
  const expired = Date.parse(offer.expiresAt) <= Date.parse(now) || offer.state === 'expired';
  const subject = expired ? 'Your vehicle offer has expired' : 'Your vehicle offer is ready to review';
  const status = expired ? 'This offer has expired. Open your employee account to check its current status.'
    : `Respond by ${deadlineWords(offer.expiresAt)}.`;
  const missing = quote?.facts ? '' : 'Full vehicle details are not available in this notification. Check the offer in your account.';
  const textBody = [greeting, '', subject, vehicle, points, status, missing, '', `Review your offer: ${offerLink}`].filter((line) => line !== '').join('\n\n');
  // Email clients need inline styles; colours and spacing follow the offer page's Density theme.
  const summary = `<div style="background:#fff;border:1px solid #dcdee1;padding:16px;margin:16px 0 24px">${points ? `<p style="margin:0 0 16px;font-size:20px;font-weight:bold">${escape(points)}</p>` : ''}<p style="margin:0;${points ? 'border-top:1px solid #dcdee1;padding-top:16px;' : ''}">${escape(status)}</p></div>`;
  const action = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0"><tr><td bgcolor="#037493"><a style="display:inline-block;padding:12px 24px;border:1px solid #037493;background:#037493;color:#fff;font-weight:bold;text-decoration:none" href="${escape(offerLink)}">View offer</a></td></tr></table>`;
  const htmlBody = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f5f6f6;color:#1f2328;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:600px;margin:0 auto;padding:24px;background:#fff;overflow-wrap:anywhere"><p style="font-size:14px;color:#4e545d">GCSP employee vehicle scheme</p><h1 style="font-size:26px;line-height:1.25">${subject}</h1><p>${escape(greeting)}</p>${photo}<h2 style="font-size:20px">${escape(vehicle)}</h2>${summary}${missing ? `<p>${escape(missing)}</p>` : ''}${action}<p style="font-size:12px;color:#4e545d">If you cannot use the button, copy this address:</p><p style="font-size:12px;word-break:break-all">${escape(offerLink)}</p></main></body></html>`;
  return { recipient: { employeeId: employee.employeeId, name, fictional: true }, subject, textBody, htmlBody, offerLink,
    ...(image ? { vehicleImage: image } : {}) };
}
