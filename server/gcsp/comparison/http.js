import { result } from '../repository/index.js';
import { EXPERIMENT_IDS } from './experiments.js';
import { parseExperimentRequest } from './requests.js';
import { readLatestComparisonResult, readLatestComparisonResults } from './results.js';

/** Ok for Greg or the presenter; any other role gets the presenter check's refusal. */
export async function requireGregOrPresenter(identity, context) {
  const greg = await identity.requireRole(context, 'greg');
  return greg.status === 'ok' ? greg : identity.requireRole(context, 'presenter');
}

// Greg and presenter may read the stored result; every other role is refused here, not by the route.
export function createComparisonResultService({ repository, policy, clock, identity } = {}) {
  return {
    async readLatest(context) {
      const allowed = await requireGregOrPresenter(identity, context);
      if (allowed.status !== 'ok') return allowed;
      const time = await clock.now(context);
      if (time.status !== 'ok') return time;
      try {
        return await readLatestComparisonResult(repository, context, policy, { asOf: time.value.now });
      } catch {
        return result('unavailable', { reason: 'The stored comparison result is unavailable.', retryable: true });
      }
    },

    // One experiment's latest result, or the latest of every experiment when none is named.
    async readStored(context, { experimentId } = {}) {
      const allowed = await requireGregOrPresenter(identity, context);
      if (allowed.status !== 'ok') return allowed;
      const time = await clock.now(context);
      if (time.status !== 'ok') return time;
      try {
        const asOf = time.value.now;
        return experimentId === undefined ? await readLatestComparisonResults(repository, context, policy, { asOf })
          : await readLatestComparisonResult(repository, context, policy, { asOf, experimentId });
      } catch {
        return result('unavailable', { reason: 'The stored comparison result is unavailable.', retryable: true });
      }
    },
  };
}

export function createComparisonResultRoutes(service) {
  return [{ method: 'GET', path: '/api/gcsp/comparison/process/latest',
    async handle({ context, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'The latest stored result takes no query.' }] });
      if (typeof service?.readLatest !== 'function') return result('unavailable', {
        reason: 'The comparison result service has not been configured.', retryable: true });
      return service.readLatest(context);
    } }];
}

const notConfigured = (what) => result('unavailable', { reason: `The comparison ${what} service has not been configured.`, retryable: true });
// Names every query field the route does not take.
const unsupported = (searchParams, allowed) => {
  const extra = [...new Set([...searchParams.keys()].filter((name) => !allowed.includes(name)))];
  return extra.length ? result('invalid', { code: 'unsupported-query', reasons: extra.map((field) => ({
    field, reason: allowed.length ? `Only ${allowed.join(', ')} can be given here.` : 'This route takes no query.' })) }) : null;
};
const one = (searchParams, name) => {
  const values = searchParams.getAll(name);
  return values.length === 0 ? { absent: true } : values.length === 1 && values[0] !== '' ? { value: values[0] } : { bad: true };
};

/** Browser routes to start and watch a comparison job and read the stored results (Greg or presenter only). */
export function createComparisonJobRoutes(jobService, resultService) {
  return [
    { method: 'POST', path: '/api/gcsp/comparison/jobs',
      async handle({ context, body, identity }) {
        if (typeof jobService?.start !== 'function') return notConfigured('job');
        const allowed = await requireGregOrPresenter(identity, context);
        if (allowed.status !== 'ok') return allowed;
        const parsed = parseExperimentRequest(body);
        return parsed.status === 'ok' ? jobService.start(context, parsed.value) : parsed;
      } },
    { method: 'GET', path: '/api/gcsp/comparison/jobs/latest',
      async handle({ context, searchParams }) {
        const refused = unsupported(searchParams, ['jobId']);
        if (refused) return refused;
        const jobId = one(searchParams, 'jobId');
        if (jobId.bad) return result('invalid', { code: 'invalid-query', reasons: [{ field: 'jobId', reason: 'Give one job id.' }] });
        if (typeof jobService?.read !== 'function') return notConfigured('job');
        return jobService.read(context, jobId.absent ? {} : { jobId: jobId.value });
      } },
    { method: 'GET', path: '/api/gcsp/comparison/results/latest',
      async handle({ context, searchParams }) {
        const refused = unsupported(searchParams, ['experimentId']);
        if (refused) return refused;
        const id = one(searchParams, 'experimentId');
        if (id.bad || (id.value !== undefined && !EXPERIMENT_IDS.includes(id.value))) {
          return result('invalid', { code: 'invalid-experiment', reasons: [{ field: 'experimentId', key: null,
            reason: 'Choose one of the known comparison experiments.' }] });
        }
        if (typeof resultService?.readStored !== 'function') return notConfigured('result');
        return resultService.readStored(context, id.absent ? {} : { experimentId: id.value });
      } },
  ];
}
