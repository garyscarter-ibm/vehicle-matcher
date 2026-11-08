import { el, screenIntro, button, factList } from '../../vehicle-matcher/ui.js';

export const caseStatus = (value) => ({ open: 'Open', 'in-progress': 'In progress', 'remedy-proposed': 'Remedy proposed',
  resolved: 'Resolved', closed: 'Closed' }[value] ?? value ?? 'Not supplied');
export const preferenceLabel = (path) => String(path ?? '').replace(/^preferences\./, '').replace(/\.value$/, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
export const shown = (value) => value == null ? 'Not supplied' : Array.isArray(value) ? value.join(', ')
  : typeof value === 'object' ? JSON.stringify(value) : String(value);
const words = (value) => String(value ?? '').replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
// Readable labels for server keys; unknown keys stay visible rather than hidden.
export const roleLabel = (value) => value == null ? 'Not supplied'
  : ({ 'scheme-team': 'Scheme team', employee: 'Employee', system: 'Automatic check' }[value] ?? words(value));
export const triggerLabel = (t) => !t?.type ? 'Not supplied' : ({ 'employee-request': 'Help request',
  'renewal-deadline': 'Renewal deadline approaching' }[t.type] ?? ({ 'approval-declined': 'Order approval declined',
  'appointment-no-show': 'Missed handover appointment' }[t.eventType] ?? words(t.eventType ?? t.type)));
export function clockTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString().replace('T', ' ').replace(/\.000Z$/, ' UTC').replace(/Z$/, ' UTC') : 'Not supplied';
}
const facts = (rows) => factList(rows.map(([label, value]) => ({ label, value: shown(value) })), { className: 'gcsp-case-facts' });
export const carNameText = (name) => typeof name === 'string' && name.trim() ? name : 'Car details not supplied';
// Employees see 'You' and the named owner, not principal ids.
const actorLabel = (h, c, audience) => h.actorRole === 'system' ? 'Automatic check' : audience !== 'employee' ? h.actorId
  : h.actorId === c.employeeId || h.actorRole === 'employee' ? 'You' : h.actorRole === 'scheme-team' ? c.owner?.name ?? roleLabel(h.actorRole) : roleLabel(h.actorRole);
export const caseNotice = 'Remedies need the scheme team’s decision. No specific next car or greater priority is guaranteed.';

export function renderCaseContent(c, { onReviewRelaxation, pending = false, headingLevel = 2, audience = 'employee' } = {}) {
  const root = el('article', 'gcsp-case-detail');
  root.dataset.caseId = c.caseId;
  root.append(screenIntro({ kicker: 'Renewal case', title: caseStatus(c.status), level: headingLevel }), facts([
    ['Case reference', c.caseId], ['Owner', c.owner?.name ?? c.owner?.role], ['Owner role', roleLabel(c.owner?.role)],
    ['Reason', c.reason], ['Latest update', c.history?.at(-1)?.reason ?? c.reason],
    ['Opened from', triggerLabel(c.trigger)], ['Next action', c.nextAction], ['Due, demo clock (UTC)', clockTime(c.dueAt)],
    ['Renewal deadline (calendar date)', c.renewalDeadline ?? 'Needs confirmation'],
  ]));
  if (c.fictional) root.append(el('p', 'gcsp-note', 'Synthetic demonstration case.'));
  const remedy = c.remedy;
  if (remedy) {
    const section = el('section', 'gcsp-case-remedy');
    section.append(screenIntro({ title: ['resolved', 'closed'].includes(c.status) ? 'Recorded remedy' : 'Proposed remedy', level: Math.min(6, headingLevel + 1) }));
    if (remedy.type === 'preference-relaxation') {
      const applicable = c.relaxation?.applicable === true && c.relaxation.currentBriefVersion === remedy.expectedBriefVersion;
      section.append(facts(audience === 'scheme-team'
        ? [['Preference', preferenceLabel(remedy.path)], ['Proposed value', remedy.value], ['Expected brief version', remedy.expectedBriefVersion]]
        : [['Preference', preferenceLabel(remedy.path)], ['Current value', c.relaxation?.before],
          ['Proposed value', remedy.value], ['Current brief version', c.relaxation?.currentBriefVersion]]));
      if (audience === 'scheme-team') section.append(el('p', 'gcsp-note', remedy.confirmationState === 'employee-confirmed'
        ? 'Employee confirmation is recorded. Review the case before resolving it.'
        : 'The employee confirms this preference through their brief. Confirmation is checked before this case can be resolved.'));
      else if (c.relaxation?.confirmed === true || remedy.confirmationState === 'employee-confirmed') section.append(el('p', 'gcsp-note', 'You confirmed this preference change. The scheme team will review the case.'));
      else {
        section.append(el('p', 'gcsp-note', applicable ? 'Waiting for your confirmation. Only this preference value will change.'
          : 'This proposal no longer matches your current brief. Ask the scheme team to review it.'));
        if (onReviewRelaxation) section.append(button({ label: `Review ${preferenceLabel(remedy.path).toLowerCase()} change`,
          disabled: pending || !applicable, variant: 'ghost', onClick: () => onReviewRelaxation(c) }));
      }
    } else if (remedy.type === 'manual-decision') section.append(facts([['Scheme-team decision', remedy.decision]]));
    else if (remedy.type === 'later-release') section.append(facts([['Reviewed release, demo clock (UTC)', clockTime(remedy.releaseAt)], ['Source', remedy.source]]));
    else if (remedy.type === 'contract-extension') section.append(facts([['Proposed contract end (calendar date)', remedy.until]]));
    else if (remedy.type === 'alternative-car') section.append(facts([[['resolved', 'closed'].includes(c.status) ? 'Recorded car' : 'Proposed car', carNameText(remedy.carName)],
      ...(audience === 'scheme-team' ? [['Exact car reference', remedy.orderUuid]] : [])]));
    root.append(section);
  }
  const history = el('details', 'gcsp-case-history');
  history.append(el('summary', '', 'Dated case history'));
  const list = el('ol', 'gcsp-case-events');
  for (const h of c.history ?? []) {
    const row = el('li', 'gcsp-case-event');
    row.append(facts([['Demo clock (UTC)', clockTime(h.at)], ['Actor', actorLabel(h, c, audience)], ['Role', roleLabel(h.actorRole)],
      ['Status', caseStatus(h.status)], ['Reason', h.reason], ['Next action', h.nextAction], ['Due, demo clock (UTC)', clockTime(h.dueAt)]]));
    list.append(row);
  }
  history.append(list); root.append(history);
  return root;
}
