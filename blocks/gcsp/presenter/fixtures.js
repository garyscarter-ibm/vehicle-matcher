// SYNTHETIC fixtures for the presenter outbox: fictional recipients and links, no real mail or person.
// Shapes follow the route projection and the renderOfferMessage output; the strings are static.

export const FIXTURE_NAMES = Object.freeze(['messages', 'empty', 'retrying', 'failed', 'unavailable', 'refused', 'loading']);

const NOTE = 'This is a captured demonstration message for a fictional employee. No email has been sent.';

function offerHtml({ subject, name, vehicle, status, link }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f4f5f5;color:#202526;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:600px;margin:0 auto;padding:24px;background:#fff;overflow-wrap:anywhere"><p>GCSP employee vehicle scheme</p><h1 style="font-size:26px;line-height:1.25">${subject}</h1><p>Hello ${name},</p><h2 style="font-size:20px">${vehicle}</h2><p>${status}</p><p><a style="color:#00636b;text-decoration:underline" href="${link}">Review your vehicle offer and its current status</a></p><p>If you cannot use the link, copy this address:</p><p>${link}</p><hr><p>${NOTE}</p></main></body></html>`;
}

function offerMessage({ jobId, employeeId, name, vehicle, time, link = '/gcsp/offer', expiresAt = '2026-11-05T11:00:00.000Z' }) {
  const subject = 'Your vehicle offer is ready to review';
  const status = `Your offer is available until ${expiresAt}. Open the offer to review the vehicle and make your decision.`;
  return {
    jobId, messageKind: 'offer', state: 'sent', attempts: 1, error: null, nextAttemptAt: null, time,
    recipient: { employeeId, name },
    subject,
    textBody: [`Hello ${name},`, subject, vehicle, status, `Review your offer: ${link}`, NOTE].join('\n\n'),
    htmlBody: offerHtml({ subject, name, vehicle, status, link }),
    offerLink: link,
  };
}

const unrendered = (fields) => ({
  messageKind: 'offer', subject: null, textBody: null, htmlBody: null, offerLink: null, ...fields,
});

/** Fresh fixture messages, newest first as the server returns them. */
export function fixtureMessages() {
  return [
    offerMessage({ jobId: 'job-004', employeeId: 'employee-paula', name: 'Paula (fictional)', vehicle: 'BMW 320i Touring', time: '2026-11-05T09:20:00.000Z' }),
    unrendered({ jobId: 'job-003', state: 'retrying', attempts: 2, error: 'transport-unavailable', nextAttemptAt: '2026-11-05T09:17:00.000Z',
      time: '2026-11-05T09:15:00.000Z', recipient: { employeeId: 'employee-alex', name: 'Alex Morgan-Whitfield (fictional)' } }),
    unrendered({ jobId: 'job-002', state: 'failed', attempts: 3, error: 'offer-expired', nextAttemptAt: null,
      time: '2026-11-05T09:10:00.000Z', recipient: { employeeId: 'employee-sam', name: 'Sam (fictional)' } }),
    offerMessage({ jobId: 'job-001', employeeId: 'employee-bartholomew', name: 'Bartholomew Featherstonehaugh-Cholmondeley-Wolverstone III (fictional)',
      vehicle: 'BMW 330e M Sport Pro Edition Touring with Technology Plus and Comfort Pack', time: '2026-11-05T09:05:00.000Z' }),
  ];
}

function never(signal) {
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

/** Adapter for the named fixture, or null when the name is unknown. */
export function fixtureAdapter(name) {
  const serve = (state) => ({ loadMessages: async () => state });
  const all = fixtureMessages();
  if (name === 'messages') return serve({ status: 'ready', messages: all });
  if (name === 'empty') return serve({ status: 'empty' });
  if (name === 'retrying') return serve({ status: 'ready', messages: all.filter((m) => m.state === 'retrying') });
  if (name === 'failed') return serve({ status: 'ready', messages: all.filter((m) => m.state === 'failed') });
  if (name === 'unavailable') return serve({ status: 'unavailable', message: 'The captured emails could not be loaded. Try again in a moment.' });
  if (name === 'refused') return serve({ status: 'refused', message: 'Only the presenter can open the outbox. Switch back to the presenter session and try again.' });
  if (name === 'loading') return { loadMessages: ({ signal } = {}) => never(signal) };
  return null;
}
