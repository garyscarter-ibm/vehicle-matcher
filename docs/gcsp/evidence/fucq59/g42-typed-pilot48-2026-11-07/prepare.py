"""Prepare exact G42 typed pilot and remaining finite pool. No transport or resource allocation."""
import sys
sys.dont_write_bytecode=True
import hashlib,itertools,json,pathlib,re,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
SOURCE=BASE.parent/'g42-six-model-options-qualification-2026-11-07'
ID='g42-typed-pilot48-20261107-once'
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
assert not (BASE/'execution-once.json').exists() and not any(BASE.glob('*/collector-checkpoint.json')),'spent-preparation-preserved'
refresh=sys.argv[1:]==['--refresh-unspent']
def put(path,value):
    assert not path.exists() or refresh,'existing-preparation-requires-explicit-unspent-refresh'
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
axis=read(SOURCE/'typed-axes-index.json');assert len(axis['contexts'])==6
seed=read(BASE.parent/'f70-first8-solver-2026-11-07/collection-plan.json')
plans=[];provenance=[];remaining=[];shards=[];source_pins={}
for row in axis['contexts']:
    id=row['id'];directory=SOURCE/id;old=read(directory/'qualification-plan.json');primary=read(directory/'collector-checkpoint.json');options=read(directory/'options.json');receipt=read(directory/'receipt.json')
    assert digest(primary['content'])==primary['contentDigest'] and sha(directory/'collector-checkpoint.json')==row['primarySha256']==receipt['checkpointSha256']
    assert primary['content']['optionsObservation']['sha256']==sha(directory/'options.json')==row['optionsSha256']
    assert receipt['reason']=='source-options-qualified' and receipt['actualAttempts']==4 and primary['content']['counts']['operations']=={'page':1,'settings':1,'discover':1,'options':1}
    definitions=options['report']['candidates'][0]['definitions'];bycode={r['code']:r for r in definitions}
    pools={kind:sorted(r['code'] for r in definitions if r['optionType']==kind and r['option']==r['code'] and r['issues']==[]) for kind in ['paint','fabric','rim']}
    mandatory=old['lineRegistration']['optionsQuery']['code'];assert bycode[mandatory]['option']==mandatory and bycode[mandatory]['issues']==[]
    candidates=[]
    for codes in itertools.product(*pools.values()):
        request={'includedElements':sorted([*codes,mandatory]),'mandatoryElements':[mandatory]}
        candidates.append({'candidateId':'candidate-'+digest({'model':old['modelRegistration']['modelCode'],'request':request})[:24],'request':request})
    pilot_pool={kind:codes[:2] for kind,codes in pools.items()}
    selected=[c for c in candidates if all(any(code in pilot_pool[kind] for code in c['request']['includedElements']) for kind in pools)]
    assert len(selected)==8
    plan={key:seed[key] for key in ['schemaVersion','version','policyRead','captureVersion']}
    plan.update(planId=f'g42-{id}-typed-pilot8-20261107',seed='g42-actual-typed-pilot8',source={'id':'bmw-uk-public','kind':'public-bmw-uk','version':'f59-model-batch-20261107.v1'},context={k:old['modelRegistration'][k] for k in ['catalogueDate','market','locale','orderDate','effectDate']},models=[old['modelRegistration']['modelCode']],target=1,candidateCount=8,qualificationDate='2026-11-07',modelRegistration=old['modelRegistration'],lineRegistration=old['lineRegistration'],candidateDefinitionBasis={'path':str((directory/'options.json').relative_to(ROOT)),'artifactSha256':sha(directory/'options.json'),'role':'actual direct typed definitions; fresh model/line/definitions required before solver'},limits={**seed['limits'],'maxCandidates':8,'requestBudgets':{'page':1,'settings':1,'discover':1,'options':1,'solve':8},'sourceAttempts':12,'sourceBytes':4194304,'checkpointBytes':4194304},candidates=selected)
    put(BASE/id/'collection-plan.json',plan);plans.append(plan)
    selected_ids={c['candidateId'] for c in selected};rest=[c for c in candidates if c['candidateId'] not in selected_ids]
    remaining.append({'id':id,'modelRegistration':old['modelRegistration'],'lineRegistration':old['lineRegistration'],'candidates':rest})
    for offset in range(0,len(rest),8):shards.append({'id':f'{id}-{offset//8+1:03d}','model':id,'candidateIds':[c['candidateId'] for c in rest[offset:offset+8]],'solverCeiling':len(rest[offset:offset+8]),'freshBootstrapGets':4,'publicGetCeiling':4+len(rest[offset:offset+8])})
    provenance.append({'id':id,'modelRegistration':old['modelRegistration'],'lineRegistration':old['lineRegistration'],'primarySha256':row['primarySha256'],'optionsPath':row['optionsPath'],'optionsSha256':row['optionsSha256'],'typedPools':row['typedPools'],'pilotPools':pilot_pool,'allTypedRequests':len(candidates),'pilotRequests':8,'remainingRequests':len(rest),'mandatoryLineDefinition':row['mandatoryLineDefinition']})
    for name in ['collector-checkpoint.json','options.json','qualification-plan.json','receipt.json']:source_pins[str((directory/name).relative_to(ROOT))]=sha(directory/name)
source_pins[str((SOURCE/'typed-axes-index.json').relative_to(ROOT))]=sha(SOURCE/'typed-axes-index.json')
put(BASE/'candidate-provenance.json',{'schemaVersion':'g42-typed-pool-source-provenance.v1','contexts':provenance,'classification':'Only actual direct source optionType paint/fabric/rim; mandatory observed line option is retained with its actual package type. No prefix inference.','boundary':'Finite request inputs only. Constructibility, solver changes, canonical uniqueness and admission require fresh retained source responses and strict binding.'})
continuation={'schemaVersion':'g42-remaining-typed-pool.v1','status':'concrete finite unreleased inputs; no execution command or source grant','sourceBasis':str((SOURCE/'typed-axes-index.json').relative_to(ROOT)),'sourceBasisSha256':sha(SOURCE/'typed-axes-index.json'),'pilotExcludedCandidates':48,'remainingCandidates':sum(len(r['candidates']) for r in remaining),'contexts':remaining,'shards':shards,'candidateDigest':digest(remaining),'solverCeiling':sum(s['solverCeiling'] for s in shards),'freshBootstrapGets':4*len(shards),'publicGetCeiling':sum(s['publicGetCeiling'] for s in shards),'resources':{'workers':1,'hostRamBytes':536870912,'childRamBytes':469762048,'scratchBytesPerChunk':67108864,'sourceSecondsPerChunk':90,'childSecondsPerChunk':105,'chunkSeconds':120,'decodedBytesPerChunk':4194304,'responseBytes':1048576},'forecast':{'retainedBytes':1073741824,'seconds':4000,'sourceBytes':sum(s['publicGetCeiling'] for s in shards)*90000},'retainedBudgetBytes':4294967296,'retainedDestination':'/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/g42-remaining-typed-pool-20261107-once','largeOutputPolicy':'If released, write the first primary byte, cumulative indexes and retained safe artifacts directly to this OneDrive destination; no local staging/archive. Reserve shared-host output budget before source. OneDrive placement does not establish upload.','gates':['actual pilot source/retention/strict-binding/outcome review','fresh parent-audited cumulative canonical and spent indexes','exact per-shard plans/executables/pins plus independent source release','source failures stop, and no automatic request replay; smaller chunks if host headroom requires'],'sourceGrant':False,'newConfigurationsBeforeExecution':0,'acceptance':False}
assert continuation['remainingCandidates']==2768 and len(shards)==346 and continuation['publicGetCeiling']==4152
put(BASE/'remaining-candidates.json',continuation)
selection_path=BASE/'base-index-selection.json'
if not selection_path.exists():
    index_root=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f70-model-axis790-20261107-once/sessions/session004')
    put(selection_path,{'canonical':str(index_root/'final-canonical-index.json'),'spent':str(index_root/'final-spent-request-index.json'),'requiresRefreshBeforeRelease':True,'parentReviewReference':None,'parentReviewSha256':None})
selection=read(selection_path)
if not selection['requiresRefreshBeforeRelease']:
    assert selection['parentReviewReference'] and sha(pathlib.Path(selection['parentReviewReference']))==selection['parentReviewSha256'],'fresh-parent-index-review-required'
index_pins={}
for name,file in [('canonical','final-canonical-index.json'),('spent','final-spent-request-index.json')]:
    path=pathlib.Path(selection[name]);value=read(path);index_pins[name]={'path':str(path),'sha256':sha(path),'digest':digest(value),'entries':len(value['entries'])}
if selection['requiresRefreshBeforeRelease']:assert index_pins['canonical']['entries']==1168 and index_pins['spent']['entries']==1878
spent={r['requestDigest'] for r in read(pathlib.Path(index_pins['spent']['path']))['entries']};request_digests=[]
for row in [*remaining,*[{'modelRegistration':p['modelRegistration'],'candidates':p['candidates']} for p in plans]]:
    for candidate in row['candidates']:
        value=digest({'modelRegistration':row['modelRegistration'],'request':candidate['request']});assert value not in spent and value not in request_digests;request_digests.append(value)
paths=set()
def imports(path):
    path=path.resolve();assert ROOT in path.parents;relative=str(path.relative_to(ROOT))
    if relative in paths:return
    paths.add(relative)
    for target in re.findall(r'(?:from\s*|import\s*\(\s*)[\'\"](\.[^\'\"]+)[\'\"]',path.read_text()):imports(path.parent/target)
for name in ['scripts/gcsp/collect-fleet.mjs','server/test/gcsp-bmw-model-batch.test.js','server/gcsp/policy/index.js']:imports(ROOT/name)
paths.update(['_tools/test_resources.py','docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py','server/gcsp/policy/seed-v1.json','server/package-lock.json'])
paths.update(str((BASE/name).relative_to(ROOT)) for name in ['prepare.py','run-live.mjs','supervise.py','prepared-check.test.mjs','validate-prepared.py','candidate-provenance.json','remaining-candidates.json','base-index-selection.json'])
paths.update(str((BASE/p['modelRegistration']['modelCode'].lower()/'collection-plan.json').relative_to(ROOT)) for p in plans)
allocation={'schemaVersion':'g42-typed-pilot48-execution.v1','id':ID,'status':'prepared-unspent; no source grant; '+('cumulative base refresh required' if selection['requiresRefreshBeforeRelease'] else 'fresh audited cumulative base pinned'),'qualificationDate':'2026-11-07','baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'contextIds':[p['modelRegistration']['modelCode'].lower() for p in plans],'planDigest':digest(plans),'contextPlanDigests':{p['modelRegistration']['modelCode'].lower():digest(p) for p in plans},'contextUrls':{},'codePins':{p:sha(ROOT/p) for p in sorted(paths)},'sourcePins':source_pins,'runtimePins':{str(pathlib.Path(p).resolve()):sha(pathlib.Path(p).resolve()) for p in ['/opt/homebrew/bin/node','/usr/bin/python3']},'indexPins':index_pins,'baseRefreshRequired':selection['requiresRefreshBeforeRelease'],'baseRefreshReason':('Historical session004 preparation base requires refresh.' if selection['requiresRefreshBeforeRelease'] else 'Parent independently audited the complete F70 suffix cumulative session101 base; exact parent review hash is pinned in base-index-selection.json. Separate source release still required.'),'producerPins':{'projectorSha256':sha(ROOT/'scripts/gcsp/capture-bmw-selection.mjs'),'qualifierSha256':sha(ROOT/'scripts/gcsp/bmw-selection-binding.mjs'),'sessionSha256':sha(ROOT/'scripts/gcsp/collection-session.mjs'),'policyVersion':seed['policyRead']['policyVersion']},'snapshotVersion':'bmw-gb-g42-typed-pilot48-2026-11-07.v2','publicGetCeiling':72,'solverCeiling':48,'freshBootstrapGets':24,'sessionDecodedBytes':4194304,'seriesDecodedBytes':25165824,'responseBytes':1048576,'sessionSourceSeconds':90,'sessionChildSeconds':105,'chunkSeconds':120,'seriesSeconds':600,'resources':{'workers':1,'scratchBytes':67108864,'hostRamBytes':536870912,'childRamBytes':469762048},'forecast':{'retainedBytes':16777216,'seconds':60,'childRamBytes':268435456,'aggregateDecodedBytes':8388608},'dependencySource':'/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules','retention':{'primary':'<model>/collector-checkpoint.json','retainedFromFirstWrite':True,'exportBeforeScratchCleanup':True,'exporter':'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py','rawBodiesAndSettingsRetained':False},'supervisorOutput':'/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-typed-pilot48/live','sourceGrantEnvironment':{'BMW_G42_TYPED_PILOT_SOURCE_GRANT':ID},'commandAfterSeparateParentRelease':['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'live'],'stop':['first failed/incomplete context, source access/privacy/shape/binding refusal','code/input/runtime/date/index mismatch','budget/deadline/export/cleanup failure'],'replay':'exclusive series/context markers; no automatic request replay or recovery traffic','images':0,'sourceWrites':0,'retries':0,'sourceCapacityCreditBeforeExecution':0,'acceptance':False,'remainingPool':{'path':'remaining-candidates.json','sha256':sha(BASE/'remaining-candidates.json'),'candidates':2768,'shards':346,'separateRelease':True}}
# Use the actual registered URL builder to freeze exact endpoint encodings, without transport.
script="import {readFileSync} from 'node:fs';import {bmwBatchPlanRequestUrls} from './scripts/gcsp/bmw-public-registration.mjs';const ps=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(Object.fromEntries(ps.map(p=>[p.models[0].toLowerCase(),bmwBatchPlanRequestUrls(p,p.candidates[0].request)]))));"
allocation['contextUrls']=json.loads(subprocess.check_output(['/opt/homebrew/bin/node','--input-type=module','-e',script],input=json.dumps(plans),cwd=ROOT,text=True))
put(BASE/'execution-plan.json',allocation)
print(json.dumps({'planDigest':allocation['planDigest'],'executionPlanSha256':sha(BASE/'execution-plan.json'),'codePins':len(paths),'sourcePins':len(source_pins),'runtimePins':2,'pilot':48,'remaining':2768,'remainingShards':346,'sourceGrant':False,'baseRefreshRequired':allocation['baseRefreshRequired']}))
