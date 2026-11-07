"""One bounded offline metadata proof; no public traffic or dependency-link mutation."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth30-unspent/preparation/attempt02')
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
group_path=BASE.parent/'g42-unspent1304-series-2026-11-07/group-proof.py'
spec=importlib.util.spec_from_file_location('groups',group_path);G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB);host=R.HostBudget(policy)
pool=R.read_json(BASE/'pool.json');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
paths=[BASE/'pool.json',BASE/'prepare.py',BASE/'prepared-check.test.mjs',BASE/'validate-prepared.py',ROOT/'_tools/test_resources.py',group_path]
paths += [ROOT/p for p in pool['sourcePins']]+[ROOT/c['templatePath']for c in pool['chunks']]
paths += [ROOT/p for p in ['scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/configuration-key.mjs','server/gcsp/repository/core.js','server/gcsp/repository/schema.js']]
paths += [pathlib.Path(pool['knownSpentBasis'][key]['path'])for key in ['parentGlobal4430Spent','actualPilot48Spent','parentAudit']]
identity={str(p.relative_to(ROOT))if ROOT in p.parents else str(p):sha(p)for p in paths}
command=['/opt/homebrew/bin/node','--test','--test-concurrency=1',str(BASE/'prepared-check.test.mjs')]
link=ROOT/'server/node_modules';link_before=link.lstat()if os.path.lexists(link)else None
link_identity=lambda: {'exists':os.path.lexists(link),'inode':link.lstat().st_ino if os.path.lexists(link)else None,'target':os.readlink(link)if link.is_symlink()else None}
before=link_identity()
R.atomic_json(OUT/'selected-checks.json',{'scope':'scoped actual30 finite unspent pool production registration and URL metadata','identity':identity,
 'changed_paths':[str(BASE.relative_to(ROOT)),str((BASE.parent/'scheme-breadth-remaining24-model-options-actual-2026-11-07').relative_to(ROOT))],
 'regression':'actual30 Cartesian partition, all48spent including16rejects, exact1371production plans/10940URLs,12proposedphase boundaries and zero sourcegrant',
 'callers':['production validateBmwBatchPlan/bmwBatchPlanRequestUrls','existing actual model/line option records'],
 'command':command,'exclusions':['public source traffic','collector execution','dependency-link changes','production inventory changes','full repository suite','acceptance or capacity proof'],
 'reason':'documentation/input preparation affects no production implementation; complete finite registration/URL boundary is meaningful scoped validation',
 'forecast':{'workers':1,'scratch_bytes':R.MIB,'ram_bytes':256*R.MIB,'seconds':15},
 'limits':{'workers':1,'scratch_bytes':64*R.MIB,'host_ram_bytes':512*R.MIB,'child_ram_bytes':448*R.MIB,'seconds':120},'dependencyLinkBefore':before})
entered=reserved=finished=False;result={}
def finalize():
 global entered,reserved,finished
 if finished:return
 groups=G.prove_groups_absent(R,scratch.record['groups'],OUT/'group-queries.json')
 if not groups:raise RuntimeError('owned-group-absence-unproved')
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
  if opened.returncode not in [0,1]or opened.stdout.strip():raise RuntimeError('owned-open-file-absence-unproved')
  scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 R.atomic_json(OUT/'cleanup.json',{'groups_absent':groups,'scratchRoot':str(scratch.root),'scratch_absent':not os.path.lexists(scratch.root),
  'reservation_absent':scratch.token not in(R.read_json(host.path,{})or{}),'removed_allocation_bytes':scratch.record['peak'],'manifest':str(scratch.manifest),
  'compatibility_exception':None,'dependencyLinkBefore':before,'dependencyLinkAfter':link_identity(),'dependencyLinkOwned':False,
  'dependencyLinkMutationByThisSupervisor':False,'concurrentSourceMayReplaceItsOwnLink':True,'leftovers':[]})
 finished=True
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','TZ':'UTC','LANG':'en_GB.UTF-8'},OUT/'check.log',scratch,policy,64*R.MIB,448*R.MIB,105,host)
  content=(OUT/'check.log').read_text();result['testCounts']={key:int(m.group(1))for key in ['tests','pass','fail','skipped']if(m:=re.search(r'(?:#|ℹ) '+key+r' (\d+)',content))}
  result['identity']=identity;result['identityUnchanged']=all(sha(ROOT/p)==h for p,h in identity.items())
  R.atomic_json(OUT/'result.json',result)
  if result['rc']or result['issue']:print(content[-12000:])
  else:(OUT/'check.log').unlink()
 finally:finalize()
print(json.dumps({'result':{k:v for k,v in result.items()if k!='identity'},'cleanup':R.read_json(OUT/'cleanup.json')}))
sys.exit(0 if result.get('rc')==0 and not result.get('issue')and result.get('identityUnchanged')else 1)
