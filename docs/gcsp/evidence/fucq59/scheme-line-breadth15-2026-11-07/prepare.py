"""Freeze literal leads and evidence-local protocol; zero source requests."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
prior=ROOT/'docs/gcsp/evidence/fucq59/scheme-line-breadth-preparation-2026-11-07';proposal=read(prior/'inventory-proposal.json')
diagnostic=ROOT/'docs/gcsp/evidence/fucq59/g42-safe-contract-diagnostic-2026-11-07'
paths=set(read(diagnostic/'execution-plan.json')['codePins'])
paths.update(str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.mjs','.py'])
paths.update(str((diagnostic/n).relative_to(ROOT)) for n in ['diagnostic.mjs','export-retained.py'])
paths.add('_tools/test_resources.py')
source_paths=[prior/'inventory-proposal.json',prior/'target-ledger.json',ROOT/proposal['sourceBasis']['path']]
source_paths += [prior/e['qualificationPlanPath'] for e in proposal['contexts']]
source_paths += [diagnostic/n for n in ['collector-checkpoint.json','collector-state.json','diagnostic.json','source-events.jsonl','receipt.json','qualification-plan.json']]
contexts=[]
for e in proposal['contexts']:
    path=prior/e['qualificationPlanPath'];assert sha(path)==e['qualificationPlanSha256']
    contexts.append({'id':e['id'],'phase':'first' if e['id']=='g21' else 'remaining','allocationId':'scheme-five-range-inventory15-20261107-once-'+e['id'],
      'qualificationPlanPath':str(path.relative_to(ROOT)),'qualificationPlanSha256':sha(path),'registration':e['registration'],'candidateTargetIndices':e['candidateTargetIndices']})
series={'schemaVersion':'scheme-five-range-inventory15-series.v1','id':'scheme-five-range-inventory15-20261107-once','qualificationDate':'2026-11-07','status':'prepared-unspent; no source grant',
 'codeCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 'codePins':{p:sha(ROOT/p) for p in sorted(paths)},'sourcePins':{str(p.relative_to(ROOT)):sha(p) for p in source_paths},
 'runtimePins':{str(p):sha(p) for p in [pathlib.Path('/opt/homebrew/bin/node').resolve(),pathlib.Path('/usr/bin/python3')]},
 'contexts':contexts,'phases':{
  'first':{'grantId':'scheme-five-range-inventory15-20261107-once-first3','contexts':['g21'],'getCeiling':3,'maximumWallSeconds':150,'exactParentReleaseRequired':True},
  'remaining':{'grantId':'scheme-five-range-inventory15-20261107-once-remaining12','contexts':['u11','u10','g26e','i20'],'getCeiling':12,'maximumWallSeconds':450,'exactParentReleaseRequired':True,'reviewedFirstProofSha256Environment':'BMW_BREADTH15_FIRST_PROOF_SHA256'}},
 'outputRoot':str(BASE/'actual'),'supervisorRoot':'/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth15',
 'resources':{**proposal['resources'],'retainedBudgetBytes':16*1048576},'forecast':proposal['forecast'],
 'sourceGrant':False,'publicGetCeiling':15,'options':0,'solver':0,'images':0,'retries':0,'sourceWrites':0,'admissions':0,'capacityCredit':0,'acceptance':False,
 'stop':'First incomplete source, pin, access, budget, export, retained proof or cleanup stops. Preserve actual primary and consumed phase. Never replay or substitute. Production refusal is retained independently and is not repaired.',
 'remaining':['31 scheme-line joins','20 targets lack exact retained page seed','3 existing lanes remain scheme-join incomplete','F44 dated gap remains','all original distribution and acceptance obligations']}
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'codePins':len(series['codePins']),'sourcePins':len(series['sourcePins']),'runtimePins':len(series['runtimePins']),'contexts':len(contexts),'sourceGrant':False}))
