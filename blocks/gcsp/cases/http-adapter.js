const failure = (code) => ({ status: 'unavailable', code, reason: 'Renewal help could not be reached. Try again.', retryable: true });

export function createCaseHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  async function request(path, options = {}, input) {
    let response;
    try {
      response = await fetchImpl(`${base}/api/gcsp/${path}`, { method: input ? 'POST' : 'GET', credentials: 'include',
        signal: options.signal, headers: { Accept: 'application/json', ...(input ? { 'Content-Type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return failure('case-transport-unavailable');
    }
    let envelope;
    try { envelope = await response.json(); } catch { return failure('case-response-invalid'); }
    if (!envelope || typeof envelope.status !== 'string' || envelope.status === 'ok' && (!response.ok || !envelope.value
      || path === 'help' && envelope.value.opensCase !== false
      || path === 'cases' && (input ? !envelope.value.case?.caseId : !Array.isArray(envelope.value.cases))
      || path === 'brief/change-after-decline' && !Number.isSafeInteger(envelope.value.brief?.briefVersion))) return failure('case-response-invalid');
    return envelope;
  }
  return {
    readHelp: (options) => request('help', options),
    readCases: (options) => request('cases', options),
    requestHelp: ({ commandId, reason }, options) => request('cases', options, { commandId, reason }),
    changeAfterDecline: ({ commandId, decisionId, expectedBriefVersion, change }, options) => request('brief/change-after-decline', options,
      { commandId, decisionId, expectedBriefVersion, change: { path: change.path, value: change.value } }),
  };
}
