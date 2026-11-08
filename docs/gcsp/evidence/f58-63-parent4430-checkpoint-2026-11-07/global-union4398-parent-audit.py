"""Read-only frozen milestone reconciliation; no source replay, test rerun or scratch."""
import collections
import datetime
import hashlib
import json
import os
import pathlib

ROOT = pathlib.Path('/Users/usget/Claude/vehicle-matcher')
CONTROL = ROOT / '.claude/f58-63-overnight-20261106/f58'
CLOUD = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output')
DEST = CLOUD / 'global-union4398-20261107'
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

baseline = CLOUD / 'global-union3854-20261107'
check('baseline canonical pin', sha(baseline/'final-canonical-index.json') == '03085775a0525fe33ac4f9d0fb9c4eb70739d58544991db29449510efa57b3f0')
check('baseline spent pin', sha(baseline/'final-spent-request-index.json') == '879d06da124460d41ac956312b7c868f8477167b6024455b53bc7b22d05b6259')
base_c, base_s = read(baseline/'final-canonical-index.json'), read(baseline/'final-spent-request-index.json')
lane_specs = [('F70', 'f70-optional-axis-suffix5535-20261107-once', 200, 544, 184, 'c09a9d5e61735e8eaf631d0d8bbfee0a27a4d17ccd623697840a6f7400f718cc', 'bd89bf51ca3383e60fe2b746a4f141693ad057ee9f3315b5149df3b2f89030b3')]
lanes, totals, new_ids, new_signatures = [], collections.Counter(), [], []
for label, name, count, expected_additions, expected_rejects, final_c_sha, final_s_sha in lane_specs:
    directory = CLOUD/name/'sessions'
    prior_c = read(directory/'session110/prior-canonical-index.json')['entries']
    prior_s = read(directory/'session110/spent-request-index.json')['entries']
    prior_c_sha, prior_s_sha = sha(directory/'session110/prior-canonical-index.json'), sha(directory/'session110/spent-request-index.json')
    check('F70 exact audited109 boundary', prior_c_sha == 'c2c13e91a8bbeedcab61898b14a58a83fc735d8a83647e5fd12d63e726f8c7be' and prior_s_sha == 'be82e486608cdc0dd4350e942d5410187ff962c534f3d9bb9fcaface54565e2d')
    lane_total, proof_pins = collections.Counter(), []
    for number in range(110, count+1):
        session = directory/f'session{number:03d}'
        proof, receipt = read(session/'live-validation.json'), read(session/'receipt.json')
        primary = read(session/'collector-checkpoint.json')['content']
        accepted = [json.loads(line) for line in (session/'accepted.jsonl').read_text().splitlines() if line.strip()]
        current_c, current_s = read(session/'final-canonical-index.json')['entries'], read(session/'final-spent-request-index.json')['entries']
        tag = f'{label}-{number}'
        pins = proof['retainedChecks']['identity']
        for pinned_path, tested_hash in pins.items():
            actual_path = pathlib.Path(pinned_path) if pathlib.Path(pinned_path).is_absolute() else ROOT/'.claude/worktrees/DEV-2026-11-04-032'/pinned_path
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
        check(tag+' rejection/duplicate counts', len(primary['rejected']) == receipt['rejected'] == actual['rejected'] and len(primary['duplicates']) == receipt['duplicates'] == actual['duplicates'] == 0)
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
        check(tag+' all12 actual GETs observed', len(events)==24 and sorted(r['attempt'] for r in events if r['phase']=='started')==list(range(1,13)) and all(r['method']=='GET' for r in events) and sum(r['phase']=='headers-received' and r.get('status')==200 for r in events)==12)
        new_ids.extend(ids); new_signatures.extend(r['canonicalSignature'] for r in accepted)
        lane_total.update(incompleteSourceTargets=int(receipt['status']=='incomplete'), admitted=len(accepted), rejected=len(primary['rejected']), GET=12, solver=8, strictPass=5, removedScratchBytes=sum(proof[k]['removed_allocation_bytes'] for k in ['cleanup','retainedCleanup']))
        proof_pins.append({'session':number,'path':str(session/'live-validation.json'),'sha256':sha(session/'live-validation.json')})
        prior_c, prior_s = current_c, current_s
        prior_c_sha, prior_s_sha = sha(session/'final-canonical-index.json'),sha(session/'final-spent-request-index.json')
    check(label+' exact final pins', prior_c_sha == final_c_sha and prior_s_sha == final_s_sha)
    check(label+' exact milestone additions/rejections', lane_total['admitted']==expected_additions and lane_total['rejected']==expected_rejects)
    lanes.append({'label':label,'directory':str(directory),'boundary':count,'totals':dict(lane_total),'proofPins':proof_pins,'canonical':prior_c,'spent':prior_s,'canonicalSha256':prior_c_sha,'spentSha256':prior_s_sha})
    totals.update(lane_total)
check('all544 novel IDs and signatures distinct',len(new_ids)==len(set(new_ids))==len(set(new_signatures))==544)
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
check('union4401canonical/4398admitted/5780spent',len(union_c)==4401 and admitted(union_c.values())==4398 and len(union_s)==5780)
check('new union IDs equal exact544 admissions',set(union_c)-{r['configurationId'] for r in base_c['entries']}==set(new_ids))
report={'schemaVersion':'actual-global-union.v1','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'failed' if errors else 'proved','scope':'scoped read-only exact testedinput/primary/event/chain/cleanup audit; audited3854 baseline plus exact F70sessions110through200; zero source/test replay','admittedSource':4398,'canonical':4401,'spent':5780,'newSince3854':544,'remaining10000':5602,'checks':checks,'errors':errors,'totals':dict(totals),'scratchCreated':False,'sourceAcceptance':False,'priorG42session118':'Included in proved3854baseline with original4/5 failure preserved; combined actualevidence audit remains pinned','originalFailuresPreserved':True,'initialParentAudit':str(CONTROL/'global-union3848-parent-audit-original-status-expectation.json'),'priorParentAuditSha256':'24773169e1693e3df0f20b20a534285a4d52c2e756407a6a41cd2f50352aaee3','parentCorrection':'F70 bounded queueexhausted sessions truthfully retain incomplete target status when some candidates rejected; all actual rows/8spent/12GET accounted and strictchecks passed; acceptance unchanged','laneEvidence':[{k:v for k,v in lane.items() if k not in ['canonical','spent']} for lane in lanes]}
if not errors:
    ownership={'owner':os.getpid(),'outputRoot':str(DEST),'purpose':'immutable aggregate canonical/spent indexes only, no copiedsourceinputs','expectedBytes':4*1024*1024,'forecastRAMMiB':128,'forecastSeconds':30,'scratchCreated':False,'disposable':False}
    write(CONTROL/'global-union4398-ownership.json',ownership)
    DEST.mkdir(mode=0o700)
    canonical={**base_c,'basis':'parent proved3854 plus independently auditedF70sessions110through200; exactunion no source replay','entries':sorted(union_c.values(),key=lambda r:r['configurationId'])}
    spent={**base_s,'basis':'parent exact shared-prefix+independent extension union; no spent replay','entries':list(union_s.values())}
    write(DEST/'final-canonical-index.json',canonical);write(DEST/'final-spent-request-index.json',spent)
    report.update(canonicalPin={'path':str(DEST/'final-canonical-index.json'),'sha256':sha(DEST/'final-canonical-index.json')},spentPin={'path':str(DEST/'final-spent-request-index.json'),'sha256':sha(DEST/'final-spent-request-index.json')},retainedLogicalBytes=sum(p.stat().st_size for p in DEST.iterdir()))
write(CONTROL/'global-union4398-parent-audit.json',report)
print(json.dumps({k:v for k,v in report.items() if k!='laneEvidence'}))
raise SystemExit(1 if errors else 0)
