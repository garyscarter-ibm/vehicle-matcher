"""Scoped offline selector checks only; never source replay or dependency-link access."""
import sys
sys.dont_write_bytecode=True
import atexit,datetime,hashlib,importlib.util,json,os,pathlib,re,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text())
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
A=read(BASE/'execution-plan.json');OUT=pathlib.Path(A['controlRoot'])/'prepared-check'
assert not os.path.lexists(ROOT/'server/node_modules'),'active-source-dependency-link-must-first-be-absent'
assert not pathlib.Path(A['outputRoot']).exists(),'source-output-must-remain-unspent'
identity={p:sha(ROOT/p)for p in{**A['codePins'],**A['inputPins']}}
assert identity=={**A['codePins'],**A['inputPins']}
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
policy=R.Policy({'chunk_scratch_mib':16,'chunk_ram_mib':256,'chunk_seconds':45,'log_mib':1})
scratch=R.Scratch(OUT,ROOT,policy,expected=16*R.MIB,checkpoint=OUT/'result.json')
host=R.HostBudget(policy);host._dead_owners=lambda:{}
command=[A['runtime']['path'],'--test',str(BASE/'selector.test.mjs')]
plan={'id':A['id']+'-prepared-check','changedPaths':[str(BASE.relative_to(ROOT))+'/'],'regression':'finite literal-link projection and absent-grant refusal before allocation/network','affectedCallers':['evidence-only selector runner','owned one-time supervisor'],'boundaries':['direct literal link matching','privacy/output limits','grant-before-allocation'],'selectedCommand':command,'excluded':'production collection protocol and strict proof replays, full suite, UI, SQL, source network and profile qualification; unchanged consumers outside evidence-only packet','expectedPeakScratchBytes':16*R.MIB,'RAMBytes':256*R.MIB,'maximumSeconds':45,'identity':identity}
R.atomic_json(OUT/'plan.json',plan)
entered=reserved=finished=False;result={}
def finalize():
 global entered,reserved,finished
 if finished:return
 groups=all(R.group_has_live_members(pid)is False for pid in scratch.record['groups'])
 if not groups:raise RuntimeError('prepared-check-owned-group-remains')
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
  if opened.returncode not in[0,1]or opened.stdout.strip():raise RuntimeError('prepared-check-scratch-open-file-unproved')
  scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 R.atomic_json(OUT/'cleanup.json',{'scratchRoot':str(scratch.root),'manifest':str(scratch.manifest),'scratchAbsent':not os.path.lexists(scratch.root),'groups':scratch.record['groups'],'groupsAbsent':groups,'reservationToken':scratch.token,'reservationAbsent':scratch.token not in(R.read_json(host.path,{})or{}),'removedAllocationBytes':scratch.record['peak'],'dependencyLinkAbsent':not os.path.lexists(ROOT/'server/node_modules'),'identityUnchanged':all(sha(ROOT/p)==h for p,h in identity.items()),'sourceOutputAbsent':not pathlib.Path(A['outputRoot']).exists(),'compatibilityException':None,'leftovers':[]})
 finished=True
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,16*R.MIB,256*R.MIB,ROOT,root=scratch.root);reserved=True
  scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,scratch.env({'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','TZ':'UTC'}),OUT/'scoped.log',scratch,policy,16*R.MIB,224*R.MIB,30,host)
 finally:finalize()
log=(OUT/'scoped.log').read_text();summary={key:int(value)for key,value in re.findall(r'^(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)$',log,re.M)}
cleanup=read(OUT/'cleanup.json');passed=result.get('rc')==0 and result.get('issue')is None and summary.get('tests')==summary.get('pass')==4 and all(summary.get(k,0)==0 for k in['fail','cancelled','skipped','todo'])and all(cleanup[k]for k in['scratchAbsent','groupsAbsent','reservationAbsent','dependencyLinkAbsent','identityUnchanged','sourceOutputAbsent'])
report={'schemaVersion':'missing20-selector-scoped-prepared-proof.v1','status':'scoped-pass'if passed else'failed','time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'planSha256':sha(BASE/'execution-plan.json'),'identity':identity,'runtime':A['runtime'],'selectedCommand':command,'summary':summary,'process':result,'cleanup':cleanup,'sourceRequests':0,'sourceGrant':False,'admissions':0,'capacityCredit':0,'acceptance':False}
R.atomic_json(OUT/'result.json',report)
R.atomic_json(BASE/'prepared-validation.json',report)
impact=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('missing20-selector-'+sha(BASE/'execution-plan.json')[:16]+'.json')
R.atomic_json(impact,{'schemaVersion':'scoped-test-impact.v1','codeIdentity':identity,'planSha256':sha(BASE/'execution-plan.json'),'fileFunctionToTest':{'selector.mjs#projectSelector':['literal exact-origin facts/offsets','poisoned/encoded/query routes','byte/lead/occurrence caps'],'run-live.mjs#entrypoint':['no-grant refusal before allocation/network'],'supervise.py#entrypoint':['no-grant refusal before allocation/network']},'fixtureEdges':['small synthetic HTML literal links; no real data copied'],'configSubprocessEdges':['Node test spawns evidence runner and Python supervisor with absent grant'],'knownBoundaries':plan['excluded'],'measuredSeconds':result.get('wall'),'evidence':str(BASE/'prepared-validation.json'),'status':report['status']})
if passed:(OUT/'scoped.log').unlink()
print(json.dumps({'status':report['status'],'summary':summary,'cleanup':cleanup,'proofSha256':sha(BASE/'prepared-validation.json'),'impact':str(impact)}))
raise SystemExit(0 if passed else 1)
