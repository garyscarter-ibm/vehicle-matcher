"""Read-only frozen milestone reconciliation; no source replay, test rerun or scratch."""
import collections
import datetime
import hashlib
import json
import os
import pathlib
import subprocess

ROOT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-035')
CONTROL = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58')
CLOUD = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output')
PACKET=ROOT/'docs/gcsp/evidence/fucq59/scheme-breadth30-phase02c-864-series-2026-11-07'
SERIES=json.loads((PACKET/'series-plan.json').read_text())
SOURCE=pathlib.Path(SERIES['outputRoot'])
source_receipt=json.loads((SOURCE/'phase02c-receipt.json').read_text())
assert source_receipt['reason']=='finite-phase02c-exhausted' and len(source_receipt['completedSessions'])==108 and source_receipt['aggregateSolverRequests']==864 and source_receipt['aggregateGets']==1296
cleanup_groups=set(); reservation_tokens=set()
errors, checks, cache = [], 0, {}
def read(path): return json.loads(pathlib.Path(path).read_text())
def sha(path):
    path = pathlib.Path(path)
    if path not in cache:
        h = hashlib.sha256()
        with path.open('rb') as stream:
            for part in iter(lambda: stream.read(65536), b''): h.update(part)
        cache[path] = h.hexdigest()
    return cache[path]
def check(name, passed):
    global checks
    checks += 1
    if not passed: errors.append(name)
def admitted(entries): return sum(any(o['kind'] == 'admitted-source' for o in e['origins']) for e in entries)
def write(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, sort_keys=True, indent=2); stream.write('\n')

check('exact released series',sha(PACKET/'series-plan.json')=='2a163c6592a3a6c9e31269d638017c118a0c294552744dc067842f7788b02793')
check('exact parent release',sha(PACKET/'parent-release.json')=='f3ba1aa90e57513265a5dcc0ada178d5971a783bece1dc814f9e3846a34f2635')
baseline = CLOUD/'scheme-breadth30-phase02-960-20261107-once/sessions/session011'
check('baseline canonical pin', sha(baseline/'final-canonical-index.json') == '4e851458f6a8b4fc644b8892a854e12ebf7b59d477229a26f23f5a9f9e14c4ce')
check('baseline spent pin', sha(baseline/'final-spent-request-index.json') == '01bb1fd4d8b5866e3f70eb19e14c36197c2735962cae533c12c5d706099e7299')
base_c, base_s = read(baseline/'final-canonical-index.json'), read(baseline/'final-spent-request-index.json')
for pinned_path, expected in {**SERIES['codePins'],**SERIES['sourcePins']}.items(): check('exact series input '+pinned_path,sha(ROOT/pinned_path)==expected)
for pinned_path, expected in SERIES['runtimePins'].items():check('exact runtime '+pinned_path,sha(pinned_path)==expected)
check('exact independent parent audit',sha(SERIES['parentPilotAudit']['path'])==SERIES['parentPilotAudit']['sha256'])
lane_specs = [('Breadth30','scheme-breadth30-phase02c-864-20261107-once',108,source_receipt['newlyAccepted'],source_receipt['rejected'],sha(SOURCE/'sessions/session108/final-canonical-index.json'),sha(SOURCE/'sessions/session108/final-spent-request-index.json'))]
lanes, totals, new_ids, new_signatures = [], collections.Counter(), [], []
for label, name, count, expected_additions, expected_rejects, final_c_sha, final_s_sha in lane_specs:
    directory = CLOUD/name/'sessions'
    prior_c = read(directory/'session001/prior-canonical-index.json')['entries']
    prior_s = read(directory/'session001/spent-request-index.json')['entries']
    prior_c_sha, prior_s_sha = sha(directory/'session001/prior-canonical-index.json'), sha(directory/'session001/spent-request-index.json')
    check('Breadth exact parent7583 baseline', prior_c_sha == SERIES['indexPins']['canonical']['sha256'] and prior_s_sha == SERIES['indexPins']['spent']['sha256'])
    lane_total, proof_pins = collections.Counter(), []
    for number in range(1, count+1):
        session = directory/f'session{number:03d}'
        proof_path = session/'live-validation.json'
        proof, receipt = read(proof_path), read(session/'receipt.json')
        primary = read(session/'collector-checkpoint.json')['content']
        accepted = [json.loads(line) for line in (session/'accepted.jsonl').read_text().splitlines() if line.strip()]
        current_c, current_s = read(session/'final-canonical-index.json')['entries'], read(session/'final-spent-request-index.json')['entries']
        tag = f'{label}-{number}'
        pins = proof['retainedChecks']['identity']
        for pinned_path, tested_hash in pins.items():
            actual_path = pathlib.Path(pinned_path) if pathlib.Path(pinned_path).is_absolute() else ROOT/pinned_path
            check(tag+' full exact tested identity '+pinned_path, sha(actual_path)==tested_hash)
        for filename in ['collector-checkpoint.json','receipt.json','accepted.jsonl','source-events.jsonl','reconciliation-event-evidence.json','prior-canonical-index.json','spent-request-index.json','final-canonical-index.json','final-spent-request-index.json']:
            path = session/filename
            check(tag+' exact tested '+filename, pins.get(str(path)) == sha(path))
        check(tag+' primary/receipt seals', sha(session/'collector-checkpoint.json') == proof['primarySha256'] == receipt['checkpointSha256'] and sha(session/'receipt.json') == proof['receiptSha256'])
        check(tag+' prior immutable chain', sha(session/'prior-canonical-index.json') == prior_c_sha and sha(session/'spent-request-index.json') == prior_s_sha)
        check(tag+' final proof pins', sha(session/'final-canonical-index.json') == proof['finalCanonicalIndexSha256'] and sha(session/'final-spent-request-index.json') == proof['finalSpentRequestIndexSha256'])
        strict = proof['retainedChecks']; summary = strict['summary']
        check(tag+' actual five strict checks', strict['rc'] == 0 and strict['issue'] is None and summary['tests'] == summary['pass'] == 5 and all(summary.get(k,0) == 0 for k in ['fail','cancelled','skipped','todo']))
        check(tag+' no new source or acceptance claim', proof['sourceTrafficDuringValidation'] == 0 and proof['acceptance'] is False and receipt['f61Acceptance'] is False)
        counts = primary['counts']; actual = proof['actualSource']
        check(tag+' accepted primary exact', primary['accepted'] == accepted and len(accepted) == receipt['newlyAccepted'] == actual['accepted'] == proof['sourceCapacityCredit'] and all(r['admission'] is True and r['sourceKind'] == 'dated-snapshot' for r in accepted))
        check(tag+' rejection/duplicate counts', len(primary['rejected']) == receipt['rejected'] == actual['rejected'] and len(primary['duplicates']) == receipt['duplicates'] == actual['duplicates'])
        check(tag+' real source complete', receipt['reason'] == 'queue-exhausted' and receipt['status'] in ['complete','incomplete'] and receipt['status'] == actual['status'] and counts == receipt['counts'] and counts['httpAttempts'] == counts['sourceCalls'] == receipt['actualAttempts'] == actual['attempts'] == 12 and counts['operations']['solve'] == actual['solverRequests'] == 8 and counts['decodedBytes'] == actual['decodedBytes'] and all(counts[k] == 0 for k in ['failures','timeouts','substitutions','cacheEvictions']) and all(receipt[k] == 0 for k in ['retries','sourceWrites','images','browser']))
        current_by_id, prior_by_id = {r['configurationId']:r for r in current_c}, {r['configurationId']:r for r in prior_c}
        ids = [r['configurationId'] for r in accepted]
        check(tag+' canonical uniqueness/preservation', len(current_by_id) == len(current_c) and all(current_by_id.get(k) == v for k,v in prior_by_id.items()))
        check(tag+' canonical delta exactly admitted', set(current_by_id)-set(prior_by_id) == set(ids) and len(ids) == len(set(ids)) and all(current_by_id[cid] == {'configurationId':cid,'origins':[{'path':str(session/'accepted.jsonl'),'kind':'admitted-source'}]} for cid in ids))
        check(tag+' spent prefix and delta', current_s[:len(prior_s)] == prior_s and len(current_s)-len(prior_s) == 8 and len({r['requestDigest'] for r in current_s}) == len(current_s))
        check(tag+' cumulative counts', len(current_c) == proof['cumulativeCanonicalEntries'] and admitted(current_c) == proof['cumulativeAdmittedSourceConfigurations'] and len(current_s) == proof['cumulativeSpentSolverRequests'])
        for key in ['cleanup','retainedCleanup']:
            clean = proof[key]
            check(tag+' '+key+' removed', all(clean[k] is True for k in ['scratch_absent','groups_absent','dependency_link_absent','reservation_absent','code_identity_unchanged']) and not os.path.lexists(clean['scratch_root']))
            manifest = read(clean['ownership_manifest'])
            check(tag+' '+key+' ownership', manifest['state'] == 'removed' and manifest['root'] == clean['scratch_root'])
            cleanup_groups.update(manifest['groups']); reservation_tokens.add(manifest['token'])
        event_manifest = read(session/'reconciliation-event-evidence.json')
        event_keys = {}
        for source in event_manifest['sources']:
            path = session/source['file']; raw_rows = path.read_text().splitlines()
            check(tag+' real event file '+source['file'], sha(path) == source['sha256'] and len(raw_rows) == source['rows'])
            for raw in raw_rows:
                row=json.loads(raw); key=(row['attempt'],row['phase'])
                check(tag+' identical event overlap', key not in event_keys or event_keys[key] == raw)
                event_keys[key]=raw
        events=[json.loads(raw) for raw in event_keys.values()]
        check(tag+' all source events inside original deadline',all(datetime.datetime.fromisoformat(r['startedAt'].replace('Z','+00:00'))<=datetime.datetime.fromisoformat(SERIES['phases']['phase02c']['originalAbsoluteDeadline']) and ('at'not in r or datetime.datetime.fromisoformat(r['at'].replace('Z','+00:00'))<=datetime.datetime.fromisoformat(SERIES['phases']['phase02c']['originalAbsoluteDeadline']))for r in events))
        check(tag+' all12 actual GETs observed', len(events)==24 and sorted(r['attempt'] for r in events if r['phase']=='started')==list(range(1,13)) and all(r['method']=='GET' for r in events) and sum(r['phase']=='headers-received' and r.get('status')==200 for r in events)==12)
        new_ids.extend(ids); new_signatures.extend(r['canonicalSignature'] for r in accepted)
        lane_total.update(incompleteSourceTargets=int(receipt['status']=='incomplete'), admitted=len(accepted), rejected=len(primary['rejected']), duplicates=len(primary['duplicates']), GET=12, solver=8, strictPass=5, decodedBytes=counts['decodedBytes'], removedScratchBytes=sum(proof[k]['removed_allocation_bytes'] for k in ['cleanup','retainedCleanup']))
        proof_pins.append({'session':number,'path':str(proof_path),'sha256':sha(proof_path)})
        prior_c, prior_s = current_c, current_s
        prior_c_sha, prior_s_sha = sha(session/'final-canonical-index.json'),sha(session/'final-spent-request-index.json')
    check(label+' exact final pins', prior_c_sha == final_c_sha and prior_s_sha == final_s_sha)
    check(label+' exact milestone additions/rejections', lane_total['admitted']==expected_additions and lane_total['rejected']==expected_rejects)
    lanes.append({'label':label,'directory':str(directory),'boundary':count,'totals':dict(lane_total),'proofPins':proof_pins,'canonical':prior_c,'spent':prior_s,'canonicalSha256':prior_c_sha,'spentSha256':prior_s_sha})
    totals.update(lane_total)
check('all actual novel IDs and signatures distinct',len(new_ids)==len(set(new_ids))==len(set(new_signatures))==source_receipt['newlyAccepted'])
union_c={r['configurationId']:r for r in base_c['entries']}
union_s={r['requestDigest']:r for r in base_s['entries']}
for lane in lanes:
    for row in lane['canonical']:
        key=row['configurationId']
        check('overlapping canonical origin unchanged',key not in union_c or union_c[key]==row)
        union_c.setdefault(key,row)
    for row in lane['spent']:
        key=row['requestDigest']
        check('overlapping spent identity unchanged',key not in union_s or union_s[key]==row)
        union_s.setdefault(key,row)
check('exact7583 plus actual breadth chain',len(union_c)==7586+source_receipt['newlyAccepted'] and admitted(union_c.values())==7583+source_receipt['newlyAccepted'] and len(union_s)==9847+864)
check('new union IDs equal exact actual864 continuation admissions',set(union_c)-{r['configurationId'] for r in base_c['entries']}==set(new_ids))
process=read(SOURCE/'phase02c-process-ownership.json');source_cleanup=read(SOURCE/'phase02c-cleanup.json');outer=read(read(SOURCE/'output-ownership.json')['ownerManifest'])
check('all source children joined',process['allChildrenJoined']and all(row['joined']for row in process['children']))
cleanup_groups.update(row['pid']for row in process['children']);reservation_tokens.add(outer['reservationToken'])
check('source phase roots/link absent',source_cleanup['sourceAndRetainedScratchAbsent']and not source_cleanup['scratchLeftovers']and not os.path.lexists(ROOT/'server/node_modules'))
ps=subprocess.run(['/bin/ps','-axo','pgid=,stat='],capture_output=True,text=True,timeout=10);check('independent group snapshot obtained',ps.returncode==0)
live_groups={int(parts[0])for line in ps.stdout.splitlines()if len(parts:=line.split())>=2 and not parts[1].startswith('Z')}
check('all owned source/proof/stage groups independently absent',not cleanup_groups.intersection(live_groups))
reservations=read(pathlib.Path.home()/'.cache/agent-scaffolding/test-resources/reservations.json')
check('all owned source/proof/series reservations independently absent',not reservation_tokens.intersection(reservations))
check('exact aggregate actual source counters',totals['GET']==1296 and totals['solver']==864 and totals['admitted']==source_receipt['newlyAccepted']and totals['rejected']==source_receipt['rejected']and totals['duplicates']==source_receipt['duplicates'])
report={'schemaVersion':'actual-breadth-phase02c-completion-audit.v1','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'failed'if errors else 'standalone breadth chain proved; independent parent audit and fresh F70 global union required','scope':'read-only exact tested-input, primary, event, chain and cleanup audit of108 actual remaining original133–240 breadth sessions; zero source or test replay','admittedSource':admitted(union_c.values()),'canonical':len(union_c),'spent':len(union_s),'newSince7583':source_receipt['newlyAccepted'],'remaining10000':10000-admitted(union_c.values()),'checks':checks,'errors':errors,'totals':dict(totals),'scratchCreated':False,'sourceAcceptance':False,'sourceRequestsDuringAudit':0,'testsReplayed':0,'priorParentAuditSha256':'5f7a5614f53828bd3b94a5ef5eafe52d4f6cc43306610dfe2fba43917d2139ad','sourceReceiptPin':{'path':str(SOURCE/'phase02c-receipt.json'),'sha256':sha(SOURCE/'phase02c-receipt.json')},'laneEvidence':[{k:v for k,v in lane.items()if k not in ['canonical','spent']}for lane in lanes],'independentCleanup':{'scratchRootsAbsent':len(reservation_tokens)-1,'groupsChecked':len(cleanup_groups),'allGroupsAbsent':not cleanup_groups.intersection(live_groups),'reservationTokensChecked':len(reservation_tokens),'allReservationsAbsent':not reservation_tokens.intersection(reservations),'dependencyLinkAbsent':not os.path.lexists(ROOT/'server/node_modules'),'compatibilityException':None,'leftovers':[]},'sourceRetainedLogicalBytes':source_cleanup['retainedLogicalBytes'],'currentF70ContinuationStillNeedsFreshUnionBeforeItsAdmissionsAreCounted':True}
marker=read(SOURCE/'phase02c-once.json');original=read(SERIES['interruption']['originalConsumedMarker']);phase=SERIES['phases']['phase02c']
check('original consumed marker unchanged',sha(SERIES['interruption']['originalConsumedMarker'])==SERIES['interruption']['originalConsumedMarkerSha256']and original['reservedAt']==phase['originalConsumedAt'])
check('original absolute1800deadline retained',datetime.datetime.fromisoformat(phase['originalAbsoluteDeadline'])==datetime.datetime.fromisoformat(original['reservedAt'])+datetime.timedelta(seconds=1800)and source_receipt['elapsedSeconds']<=1815)
report.update(originalAbsoluteDeadline=phase['originalAbsoluteDeadline'],originalGlobalPhaseElapsedSeconds=source_receipt['elapsedSeconds'],continuationElapsedSeconds=source_receipt['elapsedSeconds']-(datetime.datetime.fromisoformat(marker['reservedAt'])-datetime.datetime.fromisoformat(original['reservedAt'])).total_seconds(),originalAggregateActual={'GET':143+totals['GET'],'solver':95+totals['solver']},originalExcludedSession12WholeTemplate=8,originalFailedRawAdmissionsWithheld=5)
report.update(canonicalPin={'path':str(SOURCE/'sessions/session108/final-canonical-index.json'),'sha256':sha(SOURCE/'sessions/session108/final-canonical-index.json')},spentPin={'path':str(SOURCE/'sessions/session108/final-spent-request-index.json'),'sha256':sha(SOURCE/'sessions/session108/final-spent-request-index.json')},retainedLogicalBytes=source_cleanup['retainedLogicalBytes'],contextDistribution=dict(collections.Counter(r['model'] for r in source_receipt['completedSessions'])))
check('original cumulative actual ceilings retained',143+totals['GET']<=1440 and 95+totals['solver']<=960 and 191769861+source_cleanup['retainedLogicalBytes']<=4294967296 and source_cleanup['retainedLogicalBytes']<=3221225472)
report.update(checks=checks,status='failed'if errors else 'standalone breadth chain proved; independent parent audit and fresh F70 global union required')
write(CONTROL/'breadth30-phase02c-actual-completion-audit.json',report)
write(PACKET/'actual-completion-audit.json',report)
print(json.dumps({k:v for k,v in report.items() if k!='laneEvidence'}))
raise SystemExit(1 if errors else 0)
