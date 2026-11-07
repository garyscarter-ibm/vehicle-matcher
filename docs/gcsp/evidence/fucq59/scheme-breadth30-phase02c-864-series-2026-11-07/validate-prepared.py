"""One bounded four-check preparation chunk; unchanged strict protocol proofs are not replayed."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth30-phase02c-864/preparation/attempt01')
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1});scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB);host=R.HostBudget(policy)
A=R.read_json(BASE/'series-plan.json');names=[str(BASE/'series-plan.json')]+[str(ROOT/p)for p in {**A['codePins'],**A['sourcePins']}]+[v['path']for v in A['indexPins'].values()]
identity={n:hashlib.sha256(pathlib.Path(n).read_bytes()).hexdigest()for n in names};command=['/usr/bin/python3','-I','-B',str(BASE/'focused-check.py')]
R.atomic_json(OUT/'selected-checks.json',{'changedPaths':[str(BASE.relative_to(ROOT))],'scope':'scoped four changed count/base/refusal/clock-contract checks only','command':command,'regression':'108 original templates/864 unspent requests, local strict11, original clock/ceiling, no-grant and first freeze','callers':['unchanged evidence-local runtime','production templates already validated in phase02'],'excluded':['public source','copied strict5/protocol replay','full suite','transport repair','application/F61 acceptance'],'forecast':{'scratchBytes':10*R.MIB,'ramBytes':384*R.MIB,'seconds':3},'limits':{'workers':1,'scratchBytes':64*R.MIB,'ramBytes':512*R.MIB,'seconds':120}})
entered=reserved=finished=False;owned_link=None;result={}
def finalize():
 global entered,reserved,finished,owned_link
 if finished:return
 groups=G.prove_groups_absent(R,scratch.record['groups'],OUT/'group-queries.json');assert groups,'owned group absence unproved'
 if owned_link is not None:
  link=ROOT/'server/node_modules';assert link.is_symlink()and link.lstat().st_ino==owned_link;link.unlink();owned_link=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1]and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 R.atomic_json(OUT/'cleanup.json',{'scratchRoot':str(scratch.root),'manifest':str(scratch.manifest),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':groups,'reservationAbsent':scratch.token not in(R.read_json(host.path,{})or{}),'dependencyLinkAbsent':not os.path.lexists(ROOT/'server/node_modules'),'removedAllocationBytes':scratch.record['peak'],'compatibilityException':None,'leftovers':[]});finished=True
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  link=ROOT/'server/node_modules';assert not os.path.lexists(link);link.symlink_to('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules',target_is_directory=True);owned_link=link.lstat().st_ino
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','TZ':'UTC','LANG':'en_GB.UTF-8'},OUT/'check.log',scratch,policy,64*R.MIB,448*R.MIB,105,host)
  content=(OUT/'check.log').read_text();result.update(identity=identity,identityUnchanged=all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h for p,h in identity.items()),testCounts={'tests':4,'pass':4 if result['rc']==0 else 0,'fail':0 if result['rc']==0 else 1,'skipped':0},observedCoverage=[],coverageBoundary='focused Python subprocess contracts; unchanged strict protocol and actual clock regression reused by exact normalized AST, no replay')
  R.atomic_json(OUT/'result.json',result)
  if result['rc']or result['issue']:print(content[-12000:])
  else:(OUT/'check.log').unlink()
 finally:finalize()
print(json.dumps({'result':{k:v for k,v in result.items()if k!='identity'},'cleanup':R.read_json(OUT/'cleanup.json')}))
raise SystemExit(0 if result.get('rc')==0 and not result.get('issue')and result.get('identityUnchanged')else 1)
