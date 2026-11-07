"""Offline integrity/context checks for the finite F70/F44 observation; no source calls."""
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
    if not condition: raise AssertionError(label)
    checks.append(label)

check('exact two eligibility targets', plan['targets'] == [{'schemeModelLine':'F70 Sports Hatch','range':'F70'}, {'schemeModelLine':'F44 Gran Coupe','range':'F44'}])
check('immutable plan identity', pre['planSha256'] == execution['planSha256'] == observed['planSha256'] == sha(base / 'plan.json'))
check('execution identity', observed['executionRecordSha256'] == sha(base / 'execution.json'))
check('offline preflight passed', pre['networkAttempts'] == 0 and pre['tests'] == {'passed':15,'failed':0,'skipped':0,'durationMs':10254.824541})
for name, expected in observed['fileSha256'].items():
    check('source ' + name, expected == pre['fileSha256'][name] == execution['fileSha256'][name] == sha(base / name))
for name, expected in plan['inputs'].items():
    check('input ' + name, expected == observed['inputs'][name] == execution['inputs'][name] == sha(root / name))
check('completed finite observation', observed['status'] == 'completed-discovery' and observed['stop'] is None and observed['attempts'] == 4)
check('requests serial categories and HTTP status', [r['category'] for r in observed['requests']] == ['page','settings','tree:F70','tree:F44'] and all(r['status'] == 200 for r in observed['requests']))
check('decoded accounting', observed['decodedBytes'] == 751670 == sum(r['decodedBytes'] for r in observed['requests']))
check('admitted byte and time limits', observed['decodedBytes'] <= plan['limits']['aggregateDecodedBytes'] and observed['elapsedMs'] < plan['limits']['wallMs'] and all(r['decodedBytes'] <= plan['limits']['responseDecodedBytes'] and r['elapsedMs'] < plan['limits']['requestTimeoutMs'] for r in observed['requests']))
f70, f44 = observed['observations']
check('F70 exact current catalogue candidate set', f70['requestedRange'] == 'F70' and f70['requestedRangeFound'] is True and f70['returnedRangeKeys'] == ['F70'] and len(f70['models']) == 6 and {m['modelCode'] for m in f70['models']} == {'1F7A','1F7B','1F7C','1F7D','1F7E','1F7F'})
ag = {'1F7A':'82GE','1F7B':'82GE','1F7C':'22GE','1F7D':'62GE','1F7E':'82GE','1F7F':'62GE'}
for model in f70['models']:
    check('full model path ' + model['modelCode'], model['paths'] == [['1','modelRanges','F70','models',model['modelCode']]])
    check('literal context ' + model['modelCode'], model['agModelCode'] == ag[model['modelCode']] and model['catalogueRangeKey'] == model['modelRangeField'] == 'F70' and model['steeringLiteral'] == 'RL' and model['orderDate'] == '2026-11-01' and model['modelEffectDate'] == '2027-01-05')
    check('unresolved boundaries ' + model['modelCode'], model['constructibility'] == 'unknown' and model['profileQualification'] == 'unqualified' and all(model[k] is None for k in ('derivative','body','powertrain','modelYear','productionEra','plant')))
check('F44 bounded empty result', f44['requestedRange'] == 'F44' and f44['requestedRangeFound'] is False and f44['returnedRangeKeys'] == [] and f44['models'] == [] and observed['requests'][3]['decodedBytes'] == 2 and f44['globalAvailability'] == 'unknown')
check('zero configuration/profile/write result', all(observed[k] == 0 for k in ('newConfigurations','profileActivations','writes')) and all(o['newConfigurations'] == o['profileActivations'] == 0 for o in observed['observations']))
for name in ('plan.json','preflight.json','execution.json','observation.json'):
    check('bounded retained artifact ' + name, (base / name).stat().st_size < 262144)
print(json.dumps({'scope':'offline artifact/source/context integrity only','checks':len(checks),'status':'passed','networkAttempts':0,'newConfigurations':0,'profileActivations':0,'artifactSha256':{p.name:sha(p) for p in sorted(base.iterdir()) if p.is_file() and p.name != 'validation.json'}},indent=2))
