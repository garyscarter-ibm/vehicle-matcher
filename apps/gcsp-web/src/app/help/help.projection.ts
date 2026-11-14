import { parseCaseHelp, parseCaseList, projectCase } from '../cases/case.projection';
import type { CaseDisplay, CaseHelp, CaseRead, CaseRefusal, CaseScope } from '../cases/case.types';

export interface HelpProjection {
  readonly state: 'ready' | 'empty' | 'not-loaded' | 'invalid-response' | 'scope-mismatch' | 'refused';
  readonly help: CaseHelp | null; readonly cases: readonly CaseDisplay[];
  readonly failure: CaseRefusal | null; readonly notice: { readonly title: string; readonly text: string } | null;
}

export function caseReadNotice(read: CaseRead<unknown>): HelpProjection['notice'] {
  if (read.state === 'ready' || read.state === 'not-loaded') return null;
  if (read.state === 'scope-mismatch') return { title: 'Reopen your current session', text: 'These cases do not match the current account or run.' };
  if (read.state === 'invalid-response') return { title: 'Renewal help is unavailable', text: 'The case response could not be read. Refresh before trying again.' };
  const r = read.state === 'refused' ? read.refusal : null;
  if (r === null) return null;
  const title = r.code === 'outcome-uncertain' ? 'Check the current case'
    : r.status === 'unauthenticated' ? 'Sign in to continue'
      : r.status === 'forbidden' ? 'You cannot open these cases'
        : r.status === 'invalid' ? 'Review your request'
          : r.status === 'not-found' ? 'Case not found'
            : r.status === 'stale-version' || r.status === 'conflict' ? 'The case or your preferences have changed' : 'Renewal help is unavailable';
  return { title, text: r.reason };
}

/** Compose current employee reads only. Failure in either read clears the private displayed case set. */
export function projectHelp(input: { readonly scope: CaseScope; readonly help: unknown; readonly cases: unknown }): HelpProjection {
  const help = parseCaseHelp(input.help, input.scope);
  const cases = parseCaseList(input.cases, input.scope);
  // Prefer a definite refusal/scope loss over a concurrently incomplete read.
  const failures = [help, cases].filter((r) => r.state !== 'ready');
  const failed = failures.find((r) => r.state === 'refused' || r.state === 'scope-mismatch') ?? failures[0];
  if (failed) return { state: failed.state, help: null, cases: [],
    failure: failed.state === 'refused' ? failed.refusal : null, notice: caseReadNotice(failed) };
  if (help.state !== 'ready' || cases.state !== 'ready') return { state: 'not-loaded', help: null, cases: [], failure: null, notice: null };
  const displayed = cases.value.cases.map((row) => projectCase(row, input.scope)).filter((row): row is CaseDisplay => row !== null);
  return { state: displayed.length ? 'ready' : 'empty', help: help.value, cases: displayed, failure: null, notice: null };
}
