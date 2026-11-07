"""Bounded pure-plan verification with outside ownership and teardown evidence."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
meta=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/trim-package260-plan')
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
paths=[*BASE.glob('*.py'),*BASE.glob('*.mjs'),BASE/'plan.json',BASE/'candidate-manifest.json',*BASE.glob('templates/*.json'),ROOT/'scripts/gcsp/bmw-public-registration.mjs',ROOT/'scripts/gcsp/configuration-key.mjs',ROOT/'server/gcsp/repository/core.js',ROOT/'server/gcsp/repository/schema.js']
identity={str(p):sha(p) for p in paths};command=['/opt/homebrew/bin/node','--max-old-space-size=128',str(BASE/'check-plan.mjs')]
R.atomic_json(meta/'selection.json',{'changedPaths':[str(BASE)],'regression':'exact unspent typed trim/package requests and honest conditional capacity forecast','affectedCallers':['validateBmwBatchPlan','bmwPublicRequestUrls','inputDigest'],
 'selectedCommand':command,'identity':identity,'selectedChecks':['candidate/index/template pins','real plan validator and exact URL','260uniqueunspent/pilot8/remaining252','zero capacity credit/no allocation'],
 'excluded':{'fullSuite':'data-only plan; no product code changes','sourceTraffic':'no release','liveConstructibility':'pilot remains unrun'},'resources':{'workers':1,'hostRamMiB':512,'childRamMiB':448,'scratchMiB':64,'seconds':120}})
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=64*R.MIB,checkpoint=meta/'result.json');host=R.HostBudget(policy);host._dead_owners=lambda:{}
entered=reserved=finished=False;result={}
def finalize():
 global entered,reserved,finished
 if finished:return
 assert all(R.group_has_live_members(g) is False for g in scratch.record['groups'])
 if entered:scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
 R.atomic_json(meta/'cleanup.json',{'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'compatibilityException':None,'leftovers':[],'codeIdentityUnchanged':True});finished=True
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','TZ':'UTC'},meta/'check.log',scratch,policy,64*R.MIB,448*R.MIB,120,host);R.atomic_json(meta/'result.json',result)
 finally:finalize()
assert result['rc']==0 and result['issue'] is None,(result,(meta/'check.log').read_text())
proof=read(meta/'check.log');(meta/'check.log').unlink()
summary={'schemaVersion':'f70-trim-package260-offline-validation.v1','scope':'scoped pure plan; no traffic','result':result,'proof':proof,'cleanup':read(meta/'cleanup.json'),'planSha256':sha(BASE/'plan.json'),'manifestSha256':sha(BASE/'candidate-manifest.json'),'selectedPlan':str(meta/'selection.json'),'selectedPlanSha256':sha(meta/'selection.json'),'sourceExecutionUnrun':True}
R.atomic_json(BASE/'validation.json',summary)
R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/f59-trim-package260-'+sha(BASE/'plan.json')[:16]+'.json'),{'identity':identity,'scope':'scoped','planSha256':sha(BASE/'plan.json'),'map':{'candidate-manifest.json':'check-plan exact request digests/unspent baseline/observed outcomes','templates/*.json':'real batch validator and exact query URLs','plan.json':'pilot and continuation bounds/no capacity/no allocation'},'timingSeconds':result['wall'],'coverage':'reviewed direct pure module calls; no full suite or source execution','excluded':['HTTP','actual solver','source binder rerun','publication']})
print(json.dumps(summary))
