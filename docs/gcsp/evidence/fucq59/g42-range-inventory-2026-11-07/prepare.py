"""Freeze exactly three G42 inventory GETs. Preparation never invokes source transport."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
CODE_COMMIT = 'f6273b88c5992788c548d1a4816002f36295ed00'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
digest = lambda value: hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def put(name,value):
    with (BASE/name).open('x') as stream: stream.write(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
assert len(CODE_COMMIT)==40 and all(x in '0123456789abcdef' for x in CODE_COMMIT)
plan={'schemaVersion':'bmw-source-range-inventory-plan.v1','planId':'g42-range-inventory-20261107','qualificationDate':'2026-11-07',
    'source':{'id':'bmw-uk-public','version':'f59-range-inventory-20261107.v1','kind':'public-bmw-uk'},
    'inventoryRegistration':{'schemaVersion':'bmw-public-range-inventory-registration.v1','market':'GB','locale':'en-GB',
        'catalogueRangeKey':'G42','pageModelCode':'2PMC','treeEffectDate':'2026-11-01','treeOrderDate':'2026-11-01'},
    'limits':{'maxAttempts':1,'retryDelayMs':0,'concurrency':1,'imageRequests':0,'sourceAttempts':3,'sourceBytes':4194304,
        'responseBytes':1048576,'operationTimeoutMs':10000,'deadlineMs':90000,'checkpointBytes':4194304,
        'cacheEntries':8,'cacheRetentionMs':86400000,'requestBudgets':{'page':1,'settings':1,'discover':1}}}
put('qualification-plan.json',plan)
provenance={'schemaVersion':'bmw-range-inventory-seed-provenance.v1','source':'Parent-supplied official BMW UK configurator page link in a historical Parallel extract',
    'historicalExtractAcquiredDate':'2026-10-18','pageUrl':'https://configure.bmw.co.uk/en_GB/configure/G42/2PMC',
    'currentSourceVerified':False,'originalExtractIndependentlyFetched':False,
    'requestScope':plan['inventoryRegistration'],'queryDatesBasis':'Explicit request inputs retained from the existing corpus query window, reviewed by the parent; not returned-model dates.',
    'unknownReturnedFacts':['agModelCode','rawModelRange','aliases','steering','modelOrderDate','modelEffectDate','lineRelationships'],
    'boundary':'Historical seed is a request lead only. Direct actual facts, including any future model effect date, must come from the new response. No guessed AG or construction capability.'}
put('seed-provenance.json',provenance)
retention={'schemaVersion':'bmw-range-inventory-retained-deliverables.v1','primary':str(BASE/'collector-checkpoint.json'),'disposable':False,
    'retainOnInterruption':True,'exportBeforeScratchCleanup':True,'exporter':str(ROOT/'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py'),
    'embeddedArtifacts':['inventoryObservation'],'boundary':'Primary retained from first write; child join and existing primary exporter plus safe inventory export precede scratch cleanup.'}
put('retained-deliverables.json',retention)
paths=['scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/collection-session.mjs','scripts/gcsp/public-bmw-source.mjs','scripts/gcsp/configuration-key.mjs',
    'scripts/gcsp/bmw-source-qualification.mjs','scripts/gcsp/settings-shape-report.mjs','server/gcsp/repository/core.js','server/gcsp/repository/schema.js',
    '_tools/test_resources.py','docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py','server/test/gcsp-bmw-range-inventory.test.js']
pins={path:sha(ROOT/path) for path in paths}
for name in ['prepare.py','run-live.mjs','supervise.py','prepared-check.test.mjs','inventory-source.mjs','inventory-source.test.mjs','qualification-plan.json','retained-deliverables.json','seed-provenance.json']:
    pins[str((BASE/name).relative_to(ROOT))]=sha(BASE/name)
allocation={'schemaVersion':'bmw-range-inventory-execution-plan.v1','id':'g42-range-inventory-20261107-once','status':'prepared-unspent; no traffic grant',
    'codeCommit':CODE_COMMIT,'sourceVersion':plan['source']['version'],'planDigest':digest(plan),'codePins':pins,'preparerSha256':sha(pathlib.Path(__file__)),
    'historicalSeedBasis':provenance,'attempts':3,'requestSequence':['page','settings','discover'],'optionsAllowance':0,'solverAllowance':0,'candidateAllowance':0,
    'decodedBytes':4194304,'responseBytes':1048576,'operationProjectionBytes':131072,
    'projection':'Direct full model/AG/raw-range/steering/model dates, complete observed aliases and bounded actual line/default/included pointers. Request dates and page seed never become returned facts.',
    'forecast':{'decodedBytes':1048576,'retainedBytes':2097152,'childRamBytes':134217728,'sourceSeconds':5},
    'sourceDeadlineSeconds':90,'supervisorChildSeconds':105,'supervisorChunkSeconds':120,
    'resources':{'workers':1,'retries':0,'scratchBytes':67108864,'hostRamBytes':536870912,'childRamBytes':469762048},
    'scratchRoot':'/tmp/vehicle-matcher-f58-63-20261106/f58/g42-range-inventory',
    'supervisorOutput':'/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-range-inventory',
    'retainedPrimary':retention['primary'],'retainedDeliverables':retention,'oneShotMarker':str(BASE/'execution-once.json'),
    'sourceCapacityCredit':0,'acceptance':False,'sourceGrantEnvironment':{'BMW_RANGE_INVENTORY_SOURCE_GRANT':'g42-range-inventory-20261107-once'},
    'commandAfterSeparateRelease':['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'live'],
    'stop':['HTTP/access/rate/shape/privacy failure','finite response/traversal/output/resource ceiling','identity mismatch','checkpoint export or cleanup failure'],
    'laterWork':'Review actual full model facts, complete aliases and source line relationships, then prepare existing strict options qualification under a separate release. This allocation admits zero configurations.'}
put('execution-plan.json',allocation)
put('execution-reservation.json',{'status':'prepared-unspent-no-traffic-grant','allocationId':allocation['id'],'planDigest':allocation['planDigest'],
    'executionPlanSha256':sha(BASE/'execution-plan.json'),'exclusiveMarkerCreatedOnlyByLiveRunner':allocation['oneShotMarker']})
print(json.dumps({'allocationSha256':sha(BASE/'execution-plan.json'),'planDigest':allocation['planDigest'],'sourceGrant':False}))
