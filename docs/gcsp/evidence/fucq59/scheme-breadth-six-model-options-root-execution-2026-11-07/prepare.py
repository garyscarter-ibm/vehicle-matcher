"""Freeze six options contexts from retained full model nodes; no source traffic."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,re,subprocess,urllib.parse
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
POOL=BASE.parent/'scheme-line-breadth15-2026-11-07/qualification-pool/pool.json'
ID='scheme-breadth-six-model-options-root-20261107-once'
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def put(path,value):
    assert not (BASE/'execution-once.json').exists() and not any(BASE.glob('*/collector-checkpoint.json')),'preserve spent source'
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
pool=read(POOL);ids=pool['suggestedFirstSix'];assert len(ids)==6 and pool['proposedContexts']==30
plans=[];contexts=[];urls={};paths={str(POOL.relative_to(ROOT))}
for context in pool['contexts']:
    planpath=ROOT/context['qualificationPlanPath'];assert sha(planpath)==context['qualificationPlanSha256'];paths.add(str(planpath.relative_to(ROOT)))
    actual=context['actualBasis'];diagnostic=ROOT/actual['diagnosticPath'];assert sha(diagnostic)==actual['diagnosticSha256'];paths.add(str(diagnostic.relative_to(ROOT)))
    proof=diagnostic.parent/'live-validation.json';assert sha(proof)==actual['strictProofSha256'];paths.add(str(proof.relative_to(ROOT)))
    if context['id'] not in ids:continue
    p=read(planpath);put(BASE/context['id']/'qualification-plan.json',p);plans.append(p);contexts.append(context)
    model=p['modelRegistration'];line=p['lineRegistration']['optionsQuery'];query=urllib.parse.urlencode({'gfs-policy':'none','cluster':'default','model-ranges':model['catalogueRangeKey'],'future-models':'true','closest-fallback':'true'})
    urls[context['id']]={'page':f'https://configure.bmw.co.uk/en_GB/configure/{model["catalogueRangeKey"]}/{model["modelCode"]}',
      'discover':f'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{model["catalogueDate"]}/order-dates/{model["orderDate"]}?{query}',
      'options':f'https://prod.ucp.bmw.cloud/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{model["effectDate"]}/order-dates/{model["orderDate"]}/applications/connext/models/{model["modelCode"]}/options/languages/en?{line["kind"]}={line["code"]}'}
contexts=[next(c for c in contexts if c['id']==id) for id in ids]
plans=[read(BASE/id/'qualification-plan.json') for id in ids]
basis={'schemaVersion':'scheme-breadth-six-options-source-basis.v1','poolPath':str(POOL.relative_to(ROOT)),'poolSha256':sha(POOL),'contexts':contexts,'boundary':'Actual complete full model/AG/raw range/alias/date and literal line relationships justify request inputs only; fresh options must establish typed definitions. No scheme join, source construction, admission or capacity credit.'}
put(BASE/'source-basis.json',basis)
def imports(path):
    path=path.resolve();relative=str(path.relative_to(ROOT))
    if relative in paths:return
    paths.add(relative)
    for target in re.findall(r'(?:from\s*|import\s*\(\s*)[\'\"](\.[^\'\"]+)[\'\"]',path.read_text()):imports(path.parent/target)
imports(ROOT/'scripts/gcsp/collect-fleet.mjs')
paths.update(['_tools/test_resources.py','docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py']);paths.update(str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py','.mjs'])
paths.add(str((BASE/'source-basis.json').relative_to(ROOT)));paths.update(str((BASE/c/'qualification-plan.json').relative_to(ROOT)) for c in ids)
allocation={'schemaVersion':'scheme-breadth-six-model-options-root-execution.v1','id':ID,'status':'prepared-unspent; separate exact parent release required','qualificationDate':'2026-11-07','baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 'contextIds':ids,'planDigest':digest(plans),'contextPlanDigests':{c['id']:digest(p) for c,p in zip(contexts,plans)},'contextUrls':urls,
 'codePins':{p:sha(ROOT/p) for p in sorted(paths)},'runtimePins':{str(pathlib.Path(p).resolve()):sha(pathlib.Path(p).resolve()) for p in ['/opt/homebrew/bin/node','/usr/bin/python3']},
 'publicGetCeiling':24,'requestSequencePerSession':['page','settings','discover','options'],'sessionDecodedBytes':4194304,'seriesDecodedBytes':25165824,'responseBytes':1048576,'sessionSourceSeconds':90,'sessionChildSeconds':105,'chunkSeconds':120,'seriesSeconds':600,
 'resources':{'workers':1,'scratchBytes':67108864,'hostRamBytes':536870912,'childRamBytes':469762048},'forecast':{'aggregateDecodedBytes':8388608,'retainedBytes':83886080,'childRamBytes':167772160,'sessionSourceSeconds':5,'seriesSeconds':40},
 'sourceBasisSha256':sha(BASE/'source-basis.json'),'retention':{'primaryPerSession':'<range-model>/collector-checkpoint.json','retainedFromFirstWrite':True,'exportBeforeScratchCleanup':True,'exporter':str(BASE/'export-retained.py'),'safeArtifacts':['tree.json','options.json','line-relationships.json'],'excluded':['raw response bodies','settings/bootstrap headers','secret-bearing URLs','browser/session credentials']},
 'supervisorOutput':'/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth-six-model-options-root/live','sourceGrantEnvironment':{'BMW_BREADTH_OPTIONS_ROOT_SOURCE_GRANT':ID},'commandAfterSeparateParentRelease':['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'live'],
 'stop':['first failed/incomplete context or source/access/privacy/shape refusal','code/input/runtime/date mismatch','budget/deadline/retention/cleanup failure'],'replay':'Exclusive series/session markers; no replay or recovery GETs. Preserve actual prefix and obtain new exact allocation after interruption.',
 'solverAllowance':0,'imageAllowance':0,'admissions':0,'sourceCapacityCredit':0,'productionInventoryBugFixed':False,'acceptance':False,'largeOutputExpected':False}
put(BASE/'execution-plan.json',allocation)
print(json.dumps({'executionPlanSha256':sha(BASE/'execution-plan.json'),'planDigest':allocation['planDigest'],'codePins':len(paths),'sourceGrant':False}))
