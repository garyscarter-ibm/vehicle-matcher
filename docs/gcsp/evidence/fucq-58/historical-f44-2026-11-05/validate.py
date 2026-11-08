"""Offline integrity and stopped-result checks; no source calls or raw-body access."""
import hashlib
import json
from pathlib import Path

base = Path(__file__).resolve().parent
root = base.parents[4]
load = lambda name: json.loads((base / name).read_text())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
plan, pre, execution, observed = [load(name) for name in ('plan.json', 'preflight.json', 'execution.json', 'observation.json')]
checks = []


def check(label, condition):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


check('exact historical target', plan['targets'] == [{'schemeModelLine': 'F44 Gran Coupe', 'range': 'F44'}])
check('immutable plan identity', pre['planSha256'] == execution['planSha256'] == observed['planSha256'] == sha(base / 'plan.json'))
check('exclusive execution identity', observed['executionRecordSha256'] == sha(base / 'execution.json'))
check('same admitted run', plan['run'] == execution['run'] == observed['run'])
check('offline preflight passed', pre['status'] == 'passed' and pre['networkAttempts'] == 0 and pre['tests'] == {'passed': 16, 'failed': 0, 'skipped': 0, 'durationMs': 10231.879334})
check('pinned source set', set(observed['fileSha256']) == {'discover.mjs', 'catalogue.mjs', 'catalogue.test.mjs'})
for name, expected in observed['fileSha256'].items():
    check('source ' + name, expected == pre['fileSha256'][name] == execution['fileSha256'][name] == sha(base / name))
check('same input set', plan['inputs'] == execution['inputs'] == observed['inputs'])
for name, expected in plan['inputs'].items():
    path = (root / name).resolve()
    check('contained input ' + name, not Path(name).is_absolute() and '..' not in Path(name).parts and path.is_relative_to(root))
    check('input ' + name, expected == sha(path))
context = {'country': 'gb', 'locale': 'en_GB', 'requestOrderDate': '2024-10-01', 'requestEffectDate': '2024-10-01', 'futureModels': False, 'closestFallback': False}
check('selected request context retained', plan['context'] == observed['requestedContext'] == context)
check('date basis remains eligibility only', plan['dateSelection']['sourceEffectiveDate'] == '2024-10-01' and plan['dateSelection']['orderDateStatus'] == 'eligibility-anchored request probe, not observed catalogue order date' and plan['dateSelection']['effectDateStatus'] == 'selected request probe, unverified until response')
check('historical HTTP failure retained', observed['status'] == 'stopped' and observed['stop'] == 'source-http-failure')
check('three serial admitted attempts', observed['attempts'] == execution['requestsAdmitted'] == plan['limits']['httpAttempts'] == 3 and execution['concurrency'] == plan['limits']['concurrency'] == 1)
check('no retry or backoff', execution['retries'] == plan['limits']['retries'] == plan['limits']['backoffMs'] == 0)
requests = observed['requests']
check('exact request categories', [r['category'] for r in requests] == ['page', 'settings', 'tree:F44'] and [r['attempt'] for r in requests] == [1, 2, 3])
check('exact HTTP statuses', [r['status'] for r in requests] == [200, 200, 400])
check('failed response body not consumed', requests[2]['decodedBytes'] == 0 and requests[2]['failure'] == 'source-http-failure' and set(requests[2]) == {'category', 'attempt', 'status', 'decodedBytes', 'elapsedMs', 'failure'})
check('decoded accounting covers consumed bodies', observed['decodedBytes'] == 638409 == sum(r['decodedBytes'] for r in requests) and [r['decodedBytes'] for r in requests] == [17763, 620646, 0])
check('client accounting', observed['elapsedMs'] == 397 and all(r['elapsedMs'] >= 0 for r in requests))
check('admitted byte and time limits', observed['decodedBytes'] <= plan['limits']['aggregateDecodedBytes'] and observed['elapsedMs'] < plan['limits']['wallMs'] and all(r['elapsedMs'] < plan['limits']['requestTimeoutMs'] for r in requests) and all(r['decodedBytes'] <= plan['limits']['bootstrapResponseDecodedBytes'] for r in requests[:2]) and requests[2]['decodedBytes'] <= plan['limits']['responseDecodedBytes'])
check('no catalogue model/date inference', observed['observations'] == [])
check('zero configuration/profile/write result', all(observed[k] == 0 for k in ('newConfigurations', 'profileActivations', 'writes')) and observed['readOnly'] is execution['readOnly'] is plan['readOnly'] is True)
check('no downstream allocation', all(plan['limits'][k] == 0 for k in ('solverGets', 'otdGets', 'manifestGets', 'imageGets', 'cacheEntries')) and all(v == 0 for v in plan['nonActions'].values()))
check('source qualification unchanged', observed['source'] == 'public-bmw-uk-configurator' and observed['providerStatus'] == 'unsupported-public-website')
check('bounded retained observation fields', set(observed) == {'version', 'run', 'observedAt', 'source', 'providerStatus', 'requestedContext', 'readOnly', 'writes', 'attempts', 'decodedBytes', 'requests', 'observations', 'status', 'stop', 'newConfigurations', 'profileActivations', 'elapsedMs', 'planSha256', 'fileSha256', 'inputs', 'executionRecordSha256', 'authority', 'interpretation'})
for name in ('plan.json', 'preflight.json', 'execution.json', 'observation.json'):
    check('bounded retained artifact ' + name, (base / name).stat().st_size < plan['limits']['outputBytes'])
print(json.dumps({'scope': 'offline artifact/source/date/stopped-result integrity only', 'checks': len(checks), 'status': 'passed', 'networkAttempts': 0, 'observedSourceStatus': 'stopped', 'observedHttpStatus': 400, 'newConfigurations': 0, 'profileActivations': 0, 'artifactSha256': {p.name: sha(p) for p in sorted(base.iterdir()) if p.is_file() and p.name != 'validation.json'}}, indent=2))
