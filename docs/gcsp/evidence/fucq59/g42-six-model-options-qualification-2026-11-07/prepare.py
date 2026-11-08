"""Derive six finite options plans from one sealed actual diagnostic. Zero traffic."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,pathlib,re,subprocess,urllib.parse
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
DIAGNOSTIC=BASE.parent/'g42-safe-contract-diagnostic-2026-11-07'
ID='g42-six-model-options-20261107-once'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
read=lambda p:json.loads(p.read_text())
def put(path,value):
    if path.exists():assert sys.argv[1:]==['--refresh-unspent'] and not (BASE/'execution-once.json').exists() and not any(BASE.glob('*/execution-once.json')) and not any(BASE.glob('*/collector-checkpoint.json')),'frozen-or-spent-series-preserved'
    with path.open('w' if path.exists() else 'x') as stream:stream.write(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
doc=read(DIAGNOSTIC/'diagnostic.json');report=doc['report'];primary=read(DIAGNOSTIC/'collector-checkpoint.json')
assert digest(primary['content'])==primary['contentDigest'] and primary['content']['diagnosticObservation']['sha256']==sha(DIAGNOSTIC/'diagnostic.json')
assert doc['observation']['transportKind']=='live' and doc['observation']['observedAt'].startswith('2026-11-07') and report['observedAliases']==['2']
assert report['originalRefusal']=='source-inventory-line-key' and report['rejectedContract']['key']=='M_PERFORMANCE_LINE'
rows={r['path']:r for r in report['relationships']};nodes={n['modelKey']:n for n in report['modelNodes']}
contexts=[('2PMA','12CM','S0337','2PMA','12CM',1),('2PMB','22CM','S0337','2PMA','12CM',0),('2PPA','12CM','S033B','2PPA','12CM',3),('2PPB','22CM','S033B','2PPA','12CM',1),('2PBC','52FA','S033B','2PPA','12CM',2),('2PMC','52FA','S033B','2PPA','12CM',0)]
plans=[];basis=[];urls={}
for model,ag,line,default,default_ag,index in contexts:
    node=nodes[model];facts=node['facts'];assert facts['agModelCode']==ag and facts['modelCode']==model and not any(node[k] for k in ['missingFields','invalidFields','issues'])
    aliases=next(a['aliases'] for a in report['modelAliases'] if a['modelKey']==model);assert aliases==['2']
    path=f'/2/modelRanges/G42/lines/{line}'
    values={path+'/option':line,path+'/defaultModel/modelCode':default,path+'/defaultModel/agModelCode':default_ag,path+f'/includedTransmissionVariants/{index}/configuration/modelCode':model}
    assert all(rows[p].get('value')==v for p,v in values.items())
    element=path+f'/includedTransmissionVariants/{index}/configuration/elements/{line}';assert rows[element]['type']=='object'
    registration={'schemaVersion':'bmw-public-model-registration.v1','modelCode':facts['modelCode'],'agModelCode':facts['agModelCode'],'catalogueRangeKey':report['requestScope']['catalogueRangeKey'],'rawModelRange':facts['modelRange'],'aliases':aliases,'market':'GB','locale':'en-GB','steering':facts['steering'],'catalogueDate':report['requestScope']['treeEffectDate'],'orderDate':facts['orderDate'],'effectDate':facts['effectDate']}
    plan={'schemaVersion':'bmw-source-model-options-plan.v1','planId':f'g42-{model.lower()}-options-20261107','qualificationDate':'2026-11-07','source':{'id':'bmw-uk-public','kind':'public-bmw-uk','version':'f59-model-options-qualification-20261107.v1'},'modelRegistration':registration,
      'lineRegistration':{'lineKey':line,'defaultModel':{'modelCode':default,'agModelCode':default_ag},'includedIndex':index,'optionsQuery':{'kind':'trim','code':line}},
      'limits':{'maxAttempts':1,'retryDelayMs':0,'concurrency':1,'imageRequests':0,'sourceAttempts':4,'sourceBytes':4194304,'responseBytes':1048576,'operationTimeoutMs':10000,'deadlineMs':90000,'checkpointBytes':4194304,'cacheEntries':8,'cacheRetentionMs':86400000,'requestBudgets':{'page':1,'settings':1,'discover':1,'options':1}}}
    directory=BASE/model.lower();directory.mkdir(exist_ok=True);put(directory/'qualification-plan.json',plan);plans.append(plan)
    basis.append({'id':model.lower(),'fullModelPointer':node['pointer'],'fullModelFacts':facts,'completeAliases':aliases,'sameResponseRelationshipValues':values,'literalTrimPresence':{'path':element,'type':rows[element]['type']},'futureChecks':['fresh full model/AG/date/range/steering and complete aliases','exact default/included index and literal option','elements object count and unique matching variant','typed options definitions and privacy']})
    query=urllib.parse.urlencode({'gfs-policy':'none','cluster':'default','model-ranges':'G42','future-models':'true','closest-fallback':'true'})
    urls[model.lower()]={'page':f'https://configure.bmw.co.uk/en_GB/configure/G42/{model}','discover':f'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{registration["catalogueDate"]}/order-dates/{registration["orderDate"]}?{query}',
      'options':f'https://prod.ucp.bmw.cloud/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{registration["effectDate"]}/order-dates/{registration["orderDate"]}/applications/connext/models/{model}/options/languages/en?trim={line}'}
source_basis={'schemaVersion':'g42-six-model-options-source-basis.v1','diagnostic':str((DIAGNOSTIC/'diagnostic.json').relative_to(ROOT)),'diagnosticSha256':sha(DIAGNOSTIC/'diagnostic.json'),'primarySha256':sha(DIAGNOSTIC/'collector-checkpoint.json'),'rawTreeResponseSha256':doc['observation']['responseSha256'],'observedAt':doc['observation']['observedAt'],'contexts':basis,'boundary':'Actual returned full facts and same-response lines justify request inputs only. Fresh source must corroborate them before typed options; no construction, admitted configuration, inventory repair or capacity claim. M_PERFORMANCE_LINE is not used as a trim.'}
put(BASE/'source-basis.json',source_basis)
paths=set()
def imports(path):
    path=path.resolve();assert ROOT in path.parents
    relative=str(path.relative_to(ROOT))
    if relative in paths:return
    paths.add(relative)
    for target in re.findall(r'(?:from\s*|import\s*\(\s*)[\'\"](\.[^\'\"]+)[\'\"]',path.read_text()):
        imports(path.parent/target)
for name in ['scripts/gcsp/collect-fleet.mjs','server/test/gcsp-bmw-model-options-qualification.test.js']:imports(ROOT/name)
paths.update(['_tools/test_resources.py','docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py'])
paths.update(str((BASE/name).relative_to(ROOT)) for name in ['prepare.py','run-live.mjs','supervise.py','export-retained.py','prepared-check.test.mjs','validate-prepared.py','source-basis.json'])
paths.update(str((BASE/p['modelRegistration']['modelCode'].lower()/'qualification-plan.json').relative_to(ROOT)) for p in plans)
paths.update(str((DIAGNOSTIC/name).relative_to(ROOT)) for name in ['diagnostic.json','collector-checkpoint.json','receipt.json','execution-once.json'])
allocation={'schemaVersion':'g42-six-model-options-execution.v1','id':ID,'status':'prepared-unspent; no source grant','qualificationDate':'2026-11-07','baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 'contextIds':[c[0].lower() for c in contexts],'planDigest':digest(plans),'contextPlanDigests':{p['modelRegistration']['modelCode'].lower():digest(p) for p in plans},'contextUrls':urls,
 'codePins':{p:sha(ROOT/p) for p in sorted(paths)},'runtimePins':{str(pathlib.Path(p).resolve()):sha(pathlib.Path(p).resolve()) for p in ['/opt/homebrew/bin/node','/usr/bin/python3']},
 'runtimeVersions':{'node':subprocess.check_output(['/opt/homebrew/bin/node','--version'],text=True).strip(),'python':subprocess.check_output(['/usr/bin/python3','--version'],text=True).strip()},
 'publicGetCeiling':24,'requestSequencePerSession':['page','settings','discover','options'],'sessionDecodedBytes':4194304,'seriesDecodedBytes':25165824,'responseBytes':1048576,'sessionSourceSeconds':90,'sessionChildSeconds':105,'chunkSeconds':120,'seriesSeconds':600,
 'resources':{'workers':1,'scratchBytes':67108864,'hostRamBytes':536870912,'childRamBytes':469762048},'forecast':{'aggregateDecodedBytes':8388608,'retainedBytes':83886080,'childRamBytes':167772160,'sessionSourceSeconds':5,'seriesSeconds':40},
 'sourceBasisSha256':sha(BASE/'source-basis.json'),'retention':{'primaryPerSession':'<model>/collector-checkpoint.json','retainedFromFirstWrite':True,'exportBeforeScratchCleanup':True,'exporter':str(BASE/'export-retained.py'),'safeArtifacts':['tree.json','options.json','line-relationships.json'],'excluded':['raw response bodies','settings/bootstrap headers','secret-bearing URLs','browser/session credentials']},
 'supervisorOutput':'/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-six-model-options/live','sourceGrantEnvironment':{'BMW_G42_OPTIONS_SERIES_SOURCE_GRANT':ID},'commandAfterSeparateParentRelease':['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'live'],
 'stop':['first failed/incomplete context or source/access/privacy/shape refusal','code/input/runtime/date mismatch','budget/deadline/retention/cleanup failure'],'replay':'Series and each session have exclusive spent markers. No automatic replay or recovery GETs; retain completed/incomplete evidence. A new release/allocation is required after interruption.',
 'solverAllowance':0,'imageAllowance':0,'admissions':0,'sourceCapacityCredit':0,'productionInventoryBugFixed':False,'acceptance':False,'largeOutputExpected':False}
put(BASE/'execution-plan.json',allocation)
print(json.dumps({'executionPlanSha256':sha(BASE/'execution-plan.json'),'planDigest':allocation['planDigest'],'codePins':len(paths),'sourceGrant':False}))
