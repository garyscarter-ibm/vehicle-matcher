"""Fresh first-bottle preflight only; no package install or native execution."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess,resource
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==5 and sys.argv[1]=='--reviewed-plan-sha256' and sys.argv[3]=='--root-release'
reviewed=sys.argv[2];assert re.fullmatch(r'[a-f0-9]{64}',reviewed)
phase='install-2-preflight'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert sha(BASE/'plan.json')==reviewed;plan=read(BASE/'plan.json');assert str(ROOT)==plan['executionRoot'];grantPath=pathlib.Path(sys.argv[4]);assert grantPath.is_absolute();grant=read(grantPath)
assert grant['authorized'] is True and grant['phase']==phase and grant['planSha256']==reviewed and grant['codePins']==plan['codePins'];assert grant['installAllowed'] is False and grant['nativeAllowed'] is False and grant['newRequestCeiling']==5
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=reviewed
assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
inputs={str(grantPath):sha(grantPath)}
for pin in plan['inputs']:
 p=pathlib.Path(pin['path']);assert p.is_absolute();assert sha(p)==pin['sha256'];inputs[str(p)]=pin['sha256']
for path,target in plan['aliases'].items():assert (os.readlink(path) if pathlib.Path(path).is_symlink() else None)==target
output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents
meta=pathlib.Path(plan['metadataRoot']);destination=output;assert not meta.exists() and not destination.exists(),'One attempt per phase: failed/uncertain requests cannot be replayed by this packet.'
meta.mkdir(parents=True,mode=0o700);controlLog=(meta/'invocation.log').open('xb');remaining=[2*1024*1024]
class Tee:
 def __init__(self,original):self.original=original
 def write(self,value):
  if remaining[0]>0:
   data=value.encode('utf8')[:remaining[0]];controlLog.write(data);controlLog.flush();remaining[0]-=len(data)
  try:self.original.write(value);self.original.flush()
  except BrokenPipeError:pass
  return len(value)
 def flush(self):self.original.flush();controlLog.flush()
sys.stdout=Tee(sys.stdout);sys.stderr=Tee(sys.stderr)
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
policy=R.Policy({'chunk_scratch_mib':2,'chunk_ram_mib':256,'chunk_seconds':60,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=2*R.MIB,checkpoint=destination/'progress.json');scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
command=['/usr/bin/python3','-I',str(BASE/'preflight.py')]
selection={'scope':'scoped fresh native install first-bottle preflight only','changedPaths':[str(BASE)],'regression':'retain exact download/integrity/member/stage diagnostics lost by original install wrapper','affectedCallers':['original native install first-bottle preflight'],'integrationBoundaries':['public exact GHCR bottle','embedded formula/current catalogue checksum','read-only installed kegs/aliases'],'selected':command,'identity':identity,'inputs':inputs,'resources':plan['resources'],'excluded':plan['unrun'],'checkpoint':str(destination/'progress.json'),'acceptance':False};R.atomic_json(meta/'selection.json',selection)
reserved=entered=finished=False;result={};R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'native-'+phase,'retainedOutput':str(destination),'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLinkTouched':False,'builtinsOnly':True,'state':'planned','sourceCalls':0,'maximumPublicRequests':5,'installationInvoked':False})
def finish():
 global reserved,entered,finished
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned group absence not proved; live/unknown fails'
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable code/input changed'
 assert all((os.readlink(p) if pathlib.Path(p).is_symlink() else None)==v for p,v in plan['aliases'].items()),'Read-only preflight alias changed'
 ownPeak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert ownPeak<64*R.MIB;aggregate=result.get('peak_rss',0)+ownPeak;assert aggregate<256*R.MIB
 cleanup={'supervisorPeakRSSBytes':ownPeak,'aggregatePeakRSSUpperBoundBytes':aggregate,'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkTouched':False,'builtinsOnly':True,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(destination),'retainedLogicalBytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),'immutablePinsUnchanged':True,'outerInvocationLog':str(meta/'invocation.log'),'compatibilityException':None,'leftovers':[]};R.atomic_json(meta/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,8*R.MIB,256*R.MIB,cloud,root=scratch.root);reserved=True;destination.mkdir(parents=True,mode=0o700);scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':reviewed,'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(destination)},meta/'command.log',scratch,policy,2*R.MIB,192*R.MIB,60,host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped native preflight '+phase,'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (destination/'receipt.json').exists():compact.update(receipt=read(destination/'receipt.json'),receiptSha256=sha(destination/'receipt.json'))
if (destination/'failure.json').exists():compact.update(failure=read(destination/'failure.json'),failureSha256=sha(destination/'failure.json'))
R.atomic_json(BASE/'results.json',compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f63-native-'+phase+'-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['unrun'],'acceptance':False});print((meta/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
