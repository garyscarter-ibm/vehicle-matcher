"""Offline, bounded reconciliation of the exact released actual chain; no source transport."""
import sys
sys.dont_write_bytecode = True
import copy, datetime, hashlib, json, os, pathlib
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda path: json.loads(path.read_text())
sha = lambda value: hashlib.sha256(value).hexdigest()
digest = lambda value: sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode())
lines = lambda path: [json.loads(line) for line in path.read_text().splitlines()]
put = lambda path, value: path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
plan = read(BASE/'collection-plan.json'); prep = read(BASE/'preparation.json'); grant = read(BASE/'root-grant.json'); contract = read(BASE/'execution-contract.json')
assert sha((BASE/'root-grant.json').read_bytes()) == 'ecfb1c92e531568352668ea5e9da1201347f16652520c25608aeed1d6d3ce084'
assert sha((BASE/'execution-contract.json').read_bytes()) == grant['contractSha256']
assert digest(plan) == contract['planDigest']
for path, expected in contract['codePins'].items(): assert sha((ROOT/path).read_bytes()) == expected
for path, expected in contract['inputPins'].items(): assert sha((pathlib.Path(grant['inputsRoot'])/path).read_bytes()) == expected
with open(contract['nodePath'], 'rb') as stream:
    h = hashlib.sha256()
    for block in iter(lambda: stream.read(1048576), b''): h.update(block)
assert h.hexdigest() == contract['nodeSha256']
states = {}; receipts = {}; cleanups = {}; started = []; phase_rows = []
for phase in ('a','b'):
    directory = BASE/('phase-'+phase); raw = (directory/'collector-checkpoint.json').read_bytes(); envelope = json.loads(raw); state = envelope['content']
    receipt = read(directory/'supervisor-receipt.json'); cleanup = read(BASE/'supervisor'/(phase.upper()+'-cleanup.json'))
    assert raw == (directory/'collector-state.json').read_bytes() == (pathlib.Path(grant['retainedRoot'])/('phase-'+phase)/'collector-checkpoint.json').read_bytes()
    assert digest(state) == envelope['contentDigest'] and sha(raw) == receipt['checkpointSha256']
    assert receipt['proofReady'] and receipt['actualSourceRequests'] == 5 and not receipt['cleanupIssues']
    assert all(cleanup[k] for k in ['scratchAbsent','groupsAbsent','reservationAbsent','ownedDependencyLinkRemoved','primaryPreserved'])
    assert not cleanup['dependencyLinkPresent'] and not cleanup['cleanupIssues'] and cleanup['exportFailure'] is None
    assert state['halted'] is None and state['counts']['httpAttempts'] == 5
    assert all(state['counts'][k] == 0 for k in ['failures','timeouts','substitutions','cacheEvictions'])
    assert not list(directory.glob('collector-checkpoint.json.writer-*')) and not (directory/'checkpoint-export-failure.json').exists()
    for name, capture in state['batchEvidence'].items():
        raw_capture = (directory/(name+'.json')).read_bytes(); assert sha(raw_capture) == capture['sha256'] and len(raw_capture) == capture['bytes'] and json.loads(raw_capture) == capture['document']
    for capture in state['sourceCaptures']:
        raw_capture = (directory/'solver'/(capture['candidateId']+'.json')).read_bytes(); assert sha(raw_capture) == capture['solver']['sha256'] and len(raw_capture) == capture['solver']['bytes']
    events = lines(directory/'source-events.jsonl'); phase_started = [row for row in events if row['phase']=='started']; headers=[row for row in events if row['phase']=='headers']
    assert len(phase_started)==len(headers)==5 and all(row['status']==200 for row in headers)
    started += phase_started; states[phase]=state; receipts[phase]=receipt; cleanups[phase]=cleanup
    phase_rows.append({'phase':phase.upper(),'checkpointSha256':sha(raw),'cursor':state['cursor'],'allocationCounts':state['counts'],'cumulativeCounts':receipt['cumulativeCounts'],'exitCode':receipt['resourceResult']['rc'],'sourceWallSeconds':receipt['resourceResult']['wall'],'peakChildRssBytes':receipt['resourceResult']['peak_rss'],'cleanup':cleanup})
a,b = states['a'],states['b']; assert a['cursor']==1 and b['cursor']==2
for field in ('records','accepted','rejected','duplicates','sourceCaptures'): assert b[field][:len(a[field])]==a[field]
for name in ('tree','options'):
    assert a['batchEvidence'][name]['document']['report']==b['activeBatchEvidence'][name]['document']['report']
    assert a['batchEvidence'][name]['document']['observation']['responseSha256']==b['activeBatchEvidence'][name]['document']['observation']['responseSha256']
assert len(started)==10 and all(sum(row['url']==candidate['solverUrl'] for row in started)==1 for candidate in prep['candidates'])
assert receipts['b']['phaseReceipt']['replayCalls']==0 and receipts['b']['cumulativeCounts']['httpAttempts']==10
assert receipts['b']['cumulativeCounts']['operations']=={'page':2,'settings':2,'discover':2,'options':2,'solve':2}
assert receipts['b']['cumulativeCounts']['decodedBytes']<=4194304
assert not os.path.lexists(ROOT/'server/node_modules')
prior = read(ROOT/prep['priorIndex']['path']); spent = read(ROOT/prep['priorIndex']['requestIndexPath']); original_spent=digest(spent)
prior_ids={row['configurationId'] for row in prior['entries']}; prior_admitted={row['configurationId'] for row in prior['entries'] if any(origin['kind']=='admitted-source' for origin in row['origins'])}; assert len(prior_admitted)==340
qualified=lines(BASE/'qualified-captures.jsonl'); binding=read(BASE/'binding-verification.json'); assert len(qualified)==len(binding['checks'])==2 and binding['actualSourceRequests']==0
outcomes=[]
for candidate in plan['candidates']:
    row=next(row for row in qualified if row['candidateId']==candidate['candidateId']); configuration=row['configurationId']; accepted=next((x for x in b['accepted'] if x['configurationId']==configuration),None)
    outcome='accepted' if accepted else 'duplicate'; request_digest=digest({'modelRegistration':plan['modelRegistration'],'request':candidate['request']})
    assert all(x['requestDigest']!=request_digest for x in spent['entries'])
    assert (configuration not in prior_ids)==bool(accepted)
    outcomes.append({'candidateId':candidate['candidateId'],'request':candidate['request'],'requestDigest':request_digest,'configurationId':configuration,'outcome':outcome,'novelAgainstPrior340Admitted':configuration not in prior_admitted,'novelAgainstAll343PriorIds':configuration not in prior_ids,'solverRetainedSha256':row['sourceEvidence']['solver'],'bindingDigest':row['catalogueRequest']['bindingDigest'],'accessoryQuantities':'unknown','verifiedFitted':'unknown'})
    spent['entries'].append({'candidateId':candidate['candidateId'],'requestDigest':request_digest,'outcome':'actual-continuation-'+outcome})
for row in b['accepted']:
    assert row['admission'] is True and row['configurationId'] not in prior_ids
    prior['entries'].append({'configurationId':row['configurationId'],'origins':[{'path':str((BASE/'phase-b/accepted.jsonl').relative_to(ROOT)),'kind':'admitted-source'}]})
prior['entries'].sort(key=lambda row:row['configurationId'])
assert len({row['requestDigest'] for row in spent['entries']})==len(spent['entries'])==407
admitted=sum(any(origin['kind']=='admitted-source' for origin in row['origins']) for row in prior['entries']); assert admitted==341
put(BASE/'final-canonical-index.json',prior);put(BASE/'final-spent-request-index.json',spent)
(BASE/'outcomes.jsonl').write_text(''.join(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n' for row in outcomes))
verifier=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f59-live-verification')
verification_result=read(verifier/'verified-result.json');verification_cleanup=read(verifier/'verified-cleanup.json');assert verification_result['rc']==0 and verification_result['issue'] is None and verification_cleanup['scratch_absent'] and verification_cleanup['dependency_link_absent']
receipt={'schemaVersion':'f59-actual-continuation-final-receipt.v1','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'actual two-process interruption/continuation proof; finite target2 not met; fullStory acceptance incomplete','grantSha256':sha((BASE/'root-grant.json').read_bytes()),'contractSha256':grant['contractSha256'],'phases':phase_rows,'totals':{'actualGets':10,'bootstrapGets':8,'solverGets':2,'retries':0,'decodedBytes':receipts['b']['cumulativeCounts']['decodedBytes'],'newAccepted':len(b['accepted']),'duplicates':len(b['duplicates']),'rejected':len(b['rejected']),'priorAdmittedSourceConfigurations':340,'cumulativeAdmittedSourceConfigurations':admitted,'priorSpentSolverRequests':405,'cumulativeSpentSolverRequests':407},'outcomes':outcomes,'priorSpentIndexDigest':original_spent,'finalCanonicalIndexDigest':digest(prior),'finalSpentIndexDigest':digest(spent),'checks':{'predecessorByteUnchanged':True,'exportByteExact':True,'priorOutcomesPreserved':True,'freshBootstrapReportsAndRawResponseHashesMatch':True,'candidate0SolverNotRepeated':True,'candidate1SolverExactlyOnce':True,'completedRestartCalls':0,'strictBindersQualified':2,'registeredAdapterPartial':2,'codeInputNodePinsUnchanged':True,'allCleanupVerified':True},'offlineVerifier':{'resourceResult':verification_result,'cleanup':verification_cleanup,'initialHarnessFailure':'Adapter options were initially passed full envelope; strict closed options refused invalid-input. Corrected verifier to exact five contract option fields; no production or source change.'},'target':{'expectedNewDistinct':2,'actualNewDistinct':1,'met':False,'reason':'queue-exhausted after one prior canonical duplicate'},'knownLimitations':['FUCQ-152 Medium remains deferred/unfixed; exactly one successor operationally selected','cross-allocation bootstrap reuse remains unproved; both allocations perform fresh bootstrap','one dated T5MJ/72HH/G61E GB/RL context; no physical/VIN/WMI/profile/plant inference','accessory quantities, measurements, availability and verified fitting remain unknown','no publication/default-store/application or fullF59/F61 acceptance inferred'],'compatibilityException':None,'disposableLeftovers':[],'acceptance':False}
put(BASE/'final-receipt.json',receipt)
print(json.dumps({'actualGets':10,'decodedBytes':receipt['totals']['decodedBytes'],'newAccepted':1,'duplicates':1,'cumulativeAdmitted':341,'spent':407,'cleanup':'verified'}))
