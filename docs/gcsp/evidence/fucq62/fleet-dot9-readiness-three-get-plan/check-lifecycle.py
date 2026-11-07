"""Actual scratch-path regression only: no probe, grant, network or dependency link."""
import sys
sys.dont_write_bytecode=True
import ast,atexit,hashlib,importlib.util,json,os,pathlib,subprocess,uuid
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
source=(BASE/'supervise.py').read_text();tree=ast.parse(source)
attempt=next(n for n in tree.body if isinstance(n,ast.Try) and n.body and isinstance(n.body[0],ast.With))
nodes=attempt.body[0].body[:5]
# Extract only the real supervisor allocation prefix, never its probe or link operations.
assert [ast.unparse(n).split('(')[0] for n in nodes]==['host.acquire','reserved = True','destination.mkdir','scratch.__enter__','entered = True']
assert len(attempt.body[0].body)>5 and isinstance(attempt.body[0].body[5],ast.If)
cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir()
run=uuid.uuid4().hex;meta=ROOT/'.claude/test-runs'/('dot9-readiness-lifecycle-'+run)
assert not meta.exists();meta.mkdir(parents=True,mode=0o700)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':30,'log_mib':1});host=R.HostBudget(policy)
results=[]
for label,sequence,expected in [('legacy-order',[nodes[i] for i in [0,1,3,4,2]],'FileExistsError'),('fixed-supervisor-prefix',nodes,None)]:
 destination=cloud/'vehicle-matcher/.agent-output'/('dot9-readiness-lifecycle-'+run)/label
 assert not destination.exists()
 scratch=R.Scratch(meta/label,ROOT,policy,expected=64*R.MIB);scratch.root=destination/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud')
 state={'host':host,'scratch':scratch,'destination':destination,'R':R,'cloud':cloud,'reserved':False,'entered':False};finished=[False];receipt={}
 R.atomic_json(meta/(label+'-ownership.json'),{'owner':R.owner(),'root':str(destination),'scratchRoot':str(scratch.root),'manifest':str(scratch.manifest),'disposable':True,'state':'planned','processes':[],'network':False})
 def finish():
  if finished[0]:return
  if state['entered']:
   opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip()
   scratch.__exit__(None,None,None);state['entered']=False
  if scratch.root.parent.exists():scratch.root.parent.rmdir()
  if destination.exists():destination.rmdir()
  if destination.parent.exists() and not any(destination.parent.iterdir()):destination.parent.rmdir()
  if state['reserved']:host.release(scratch.token);state['reserved']=False
  assert not os.path.lexists(destination) and not os.path.lexists(scratch.root)
  assert scratch.token not in (R.read_json(host.path,{}) or {})
  receipt.update(scratchAbsent=True,destinationAbsent=True,reservationAbsent=True,allChildrenJoined=True,processGroups=[],removedScratchPeakBytes=scratch.record['peak'],compatibilityException=None,leftovers=[])
  R.atomic_json(meta/(label+'-cleanup.json'),receipt);finished[0]=True
 atexit.register(finish)
 error=None
 try:
  exec(compile(ast.Module(body=sequence,type_ignores=[]),str(BASE/'supervise.py'),'exec'),state)
  assert destination.is_dir() and scratch.root.is_dir()
 except FileExistsError:error='FileExistsError'
 finally:
  try:finish()
  finally:atexit.unregister(finish)
 assert error==expected,(label,error,expected)
 results.append({'case':label,'expectedError':expected,'actualError':error,'passed':True,'cleanup':receipt})
report={'scope':'scoped actual supervisor allocation-prefix regression; legacy reproduces and fixed path passes','supervisorSha256':hashlib.sha256(source.encode()).hexdigest(),'resourceHelperSha256':hashlib.sha256((ROOT/'_tools/test_resources.py').read_bytes()).hexdigest(),'selected':'two sequential allocation-prefix cases; no subprocess proof worker','excluded':['network/probe/deployment','source traffic','dependency links','full supervisor execution'],'cases':results,'metadataRoot':str(meta),'maximumReservationMiB':{'disk':64,'ram':512},'sourceCalls':0,'publicGETs':0,'nativeDatabase':False,'acceptance':False}
R.atomic_json(BASE/'lifecycle-checks.json',report);print(json.dumps(report))
