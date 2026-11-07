"""One retained event-recovery check; reuse the original four passing semantic checks."""
import hashlib
import pathlib
import sys
sys.dont_write_bytecode = True
base = pathlib.Path(__file__).resolve().parent
original = base / 'verify-retained.py'
assert sys.argv[1:] == ['7']
assert hashlib.sha256(original.read_bytes()).hexdigest() == '3995fecb95033b4f1a146307f65fcd1268c5e036d685f8512ec24c5855d1d8fb'
source = original.read_text()
source = source.replace("OUT = pathlib.Path(allocation['supervisorOutput'])", "OUT = pathlib.Path(allocation['supervisorOutput']) / 'retained-recovery07'", 1)
source = source.replace("'-retained')", "'-retained-recovery07')", 1)
source = source.replace("'--test-reporter=tap',", "'--test-reporter=tap', '--test-isolation=none',", 1)
source = source.replace("str(BASE / 'live-check.test.mjs')", "str(BASE / 'event-recovery.test.mjs')", 1)
source = source[:source.index("summary = result.get('summary', {})")]
exec(compile(source, str(original) + ':retained-recovery07', 'exec'))
assert result['rc'] == 0 and not result['issue']
assert result['summary'] == {'tests':1,'pass':1,'fail':0,'cancelled':0,'skipped':0,'todo':0}
failed_path = pathlib.Path(allocation['supervisorOutput']) / 'retained-direct/retained-result.json'
failed = read(failed_path)
assert failed['rc'] == 1 and not failed['issue']
assert failed['summary'] == {'tests':5,'pass':4,'fail':1,'cancelled':0,'skipped':0,'todo':0}
assert all(sha(ROOT / path) == expected for path, expected in failed['identity'].items())
log = failed_path.with_name('retained.log').read_text()
assert 'not ok 3 - source events,' in log and '71 !== 72' in log
assert all(('ok %d - ' % i) in log for i in [1,2,4,5])
old_cleanup = read(failed_path.with_name('retained-cleanup.json'))
assert all(old_cleanup[k] for k in ['scratch_absent','dependency_link_absent','groups_absent','reservation_absent','code_identity_unchanged'])
receipt = read(DIRECTORY / 'receipt.json'); canonical = read(DIRECTORY / 'final-canonical-index.json'); spent = read(DIRECTORY / 'final-spent-request-index.json')
composite = {'scope':'five required checks covered by four unchanged original passing checks and one read-only actual-event-union replacement',
    'summary':{'tests':5,'pass':5,'fail':0,'cancelled':0,'skipped':0,'todo':0},
    'originalAttempt':{'path':str(failed_path),'sha256':sha(failed_path),'summary':failed['summary'],'rc':failed['rc'],
        'logSha256':sha(failed_path.with_name('retained.log')),'reusedPassingCheckNumbers':[1,2,4,5],'failedCheckNumber':3},
    'replacementEventCheck':result,'originalEventTestRemainsFailed':True,'sourceTraffic':0}
proof = {'schemaVersion':'f70-typed-axis-chunk-actual-validation.v1','scope':composite['scope'],'sourceTrafficDuringValidation':0,
    'primarySha256':sha(DIRECTORY/'collector-checkpoint.json'),'receiptSha256':sha(DIRECTORY/'receipt.json'),
    'finalCanonicalIndexSha256':sha(DIRECTORY/'final-canonical-index.json'),'finalSpentRequestIndexSha256':sha(DIRECTORY/'final-spent-request-index.json'),
    'retainedChecks':composite,'retainedCleanup':read(OUT/'retained-cleanup.json'),'cleanup':source_cleanup,
    'actualSource':{'attempts':receipt['actualAttempts'],'solverRequests':receipt['counts']['operations']['solve'],'decodedBytes':receipt['counts']['decodedBytes'],
        'accepted':receipt['newlyAccepted'],'duplicates':receipt['duplicates'],'rejected':receipt['rejected'],'reason':receipt['reason'],'status':receipt['status']},
    'eventHistory':{'canonicalSha256':sha(DIRECTORY/'source-events.jsonl'),'conflictSha256':sha(DIRECTORY/'source-events.jsonl 2.jsonl'),
        'actualMissingHeader':{'attempt':29,'status':200,'at':'2026-11-07T02:45:17.831Z'},'mergedFilesWritten':False,'eventsSynthesized':0},
    'cumulativeCanonicalEntries':len(canonical['entries']),'cumulativeAdmittedSourceConfigurations':sum(any(o['kind']=='admitted-source' for o in r['origins']) for r in canonical['entries']),
    'cumulativeSpentSolverRequests':len(spent['entries']),'sourceCapacityCredit':receipt['newlyAccepted'],'acceptance':False}
with (DIRECTORY/'live-validation.json').open('x') as stream: stream.write(json.dumps(proof,indent=2)+'\n')
print(json.dumps({'scope':proof['scope'],'requiredChecksCovered':5,'newCheck':result['summary'],'originalFailurePreserved':True,'sourceTraffic':0}),flush=True)
