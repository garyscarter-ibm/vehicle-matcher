"""Freeze a new, unspent allocation. Preparation makes no source requests."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent
ROOT=BASE.parents[4]
ID='g42-safe-contract-diagnostic-20261107-once'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def put(name,value):
    path=BASE/name
    if path.exists():
        assert sys.argv[1:]==['--refresh-unspent'] and not (BASE/'execution-once.json').exists() and not (BASE/'collector-checkpoint.json').exists(), 'frozen-or-spent-plan-preserved'
    with path.open('w' if path.exists() else 'x') as stream:stream.write(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
plan={'schemaVersion':'bmw-source-range-inventory-plan.v1','planId':'g42-safe-contract-diagnostic-20261107','qualificationDate':'2026-11-07',
 'source':{'id':'bmw-uk-public','kind':'public-bmw-uk','version':'f59-range-inventory-20261107.v1'},
 'inventoryRegistration':{'schemaVersion':'bmw-public-range-inventory-registration.v1','market':'GB','locale':'en-GB','catalogueRangeKey':'G42','pageModelCode':'2PMC','treeEffectDate':'2026-11-01','treeOrderDate':'2026-11-01'},
 'limits':{'maxAttempts':1,'retryDelayMs':0,'concurrency':1,'imageRequests':0,'sourceAttempts':3,'sourceBytes':4194304,'responseBytes':1048576,'operationTimeoutMs':10000,'deadlineMs':90000,'checkpointBytes':4194304,'cacheEntries':8,'cacheRetentionMs':86400000,'requestBudgets':{'page':1,'settings':1,'discover':1}}}
put('qualification-plan.json',plan)
paths=['scripts/gcsp/collection-session.mjs','scripts/gcsp/public-bmw-source.mjs','scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/configuration-key.mjs','scripts/gcsp/bmw-source-qualification.mjs','scripts/gcsp/settings-shape-report.mjs','server/gcsp/repository/core.js','server/gcsp/repository/schema.js','server/test/gcsp-bmw-range-inventory.test.js','_tools/test_resources.py','docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py']
paths += [str((BASE/name).relative_to(ROOT)) for name in ['diagnostic.mjs','diagnostic.test.mjs','run-live.mjs','supervise.py','export-retained.py','prepare.py','qualification-plan.json']]
allocation={'schemaVersion':'bmw-safe-contract-diagnostic-execution.v1','id':ID,'status':'prepared-unspent; no traffic grant',
 'qualificationDate':plan['qualificationDate'],'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 'planDigest':digest(plan),'codePins':{p:sha(ROOT/p) for p in paths},
 'runtimePins':{str(pathlib.Path(p).resolve()):sha(pathlib.Path(p).resolve()) for p in ['/opt/homebrew/bin/node','/usr/bin/python3']},
 'runtimeVersions':{'node':subprocess.check_output(['/opt/homebrew/bin/node','--version'],text=True).strip(),'python':subprocess.check_output(['/usr/bin/python3','--version'],text=True).strip()},
 'attempts':3,'requestSequence':['page','settings','discover'],
 'decodedBytes':4194304,'responseBytes':1048576,'projectionBytes':114688,'sealedProjectionBytes':131072,
 'sourceDeadlineSeconds':90,'supervisorChildSeconds':105,'supervisorChunkSeconds':120,
 'resources':{'workers':1,'scratchBytes':67108864,'hostRamBytes':536870912,'childRamBytes':469762048},
 'forecast':{'scratchBytes':1048576,'childRamBytes':134217728,'sourceSeconds':5,'retainedBytes':262144},
 'retention':{'primary':str(BASE/'collector-checkpoint.json'),'retainedFromFirstWrite':True,'exportBeforeScratchCleanup':True,'exporter':str(BASE/'export-retained.py'),
  'retained':['safe direct full model facts and complete aliases','bounded literal line/default/included/configuration relationships','first production-rejected safe literal key/path/type','exact registered public request provenance and response hashes'],
  'excluded':['raw bodies','settings and headers','secret-bearing URLs','unrelated fields and element payloads','VINs and personal identifiers']},
 'projectionLimits':{'aliasGroups':8,'modelsPerAlias':128,'modelRows':512,'linesPerAlias':128,'variantsPerLine':128,'relationshipRows':768,'safeLiteralKeyCharacters':96},
 'historicalSeedBasis':{'source':'Root-retained G42 contract inventory 2026-11-07','requestInputsOnly':True,'returnedFactsRemainUnqualified':True,'priorSpentAllocationPreserved':True},
 'supervisorOutput':'/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-safe-contract-diagnostic/live',
 'oneShotMarker':str(BASE/'execution-once.json'),'sourceGrantEnvironment':{'BMW_G42_DIAGNOSTIC_SOURCE_GRANT':ID},
 'commandAfterSeparateRootRelease':['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'live'],
 'optionsAllowance':0,'solverAllowance':0,'imagesAllowance':0,'admissions':0,'sourceCapacityCredit':0,'acceptance':False,
 'boundaries':['unchanged production grammar; deferred Medium Bug remains open','no options, solver, images, browser, source writes or publication','stop on privacy/shape/access/HTTP/resource/pin/retention failure; no retries','no source grant is conferred by preparation']}
put('execution-plan.json',allocation)
print(json.dumps({'executionPlanSha256':sha(BASE/'execution-plan.json'),'planDigest':allocation['planDigest'],'sourceGrant':False}))
