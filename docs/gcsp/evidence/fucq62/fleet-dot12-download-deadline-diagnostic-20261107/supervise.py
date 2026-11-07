"""Exact reviewed finite diagnostic; existence grants no execution or network authority."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,resource,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert len(sys.argv)==5 and sys.argv[1]=='--reviewed-plan-sha256' and sys.argv[3]=='--root-release';reviewed=sys.argv[2];assert sha(BASE/'plan.json')==reviewed;plan=read(BASE/'plan.json');grantPath=pathlib.Path(sys.argv[4]);assert grantPath.is_absolute();grant=read(grantPath)
assert grant['authorized'] is True and grant['phase']==plan['phase'] and grant['planSha256']==reviewed and grant['codePins']==plan['codePins'];assert grant['publicGETs']==plan.get('network',{}).get('maximumGETsIncludingRedirect',0) and grant['sourceRequests']==grant['nativeRequests']==0
if plan['phase']=='fifth-asset':assert grant['asset']==plan['fifthAsset']
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=reviewed;inputs={str(grantPath):sha(grantPath)}
for pin in [plan['productionSource'],plan['approvalSource'],plan['descriptor'],*plan['actualFailureInputs']]:inputs[pin['path']]=pin['sha256']
for p,h in {**identity,**inputs}.items():assert sha(pathlib.Path(p))==h,p
output=pathlib.Path(plan['outputRoot']);meta=pathlib.Path(plan['metadataRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents and not meta.exists() and not output.exists(),'One exact attempt; no overwrite/retry'
meta.mkdir(parents=True,mode=0o700);control=(meta/'invocation.log').open('xb');remaining=[1048576]
class Tee:
 def __init__(self,original):self.original=original
 def write(self,value):
  b=value.encode('utf8')[:remaining[0]];control.write(b);control.flush();remaining[0]-=len(b)
  try:self.original.write(value);self.original.flush()
  except BrokenPipeError:pass
  return len(value)
 def flush(self):self.original.flush();control.flush()
sys.stdout=Tee(sys.stdout);sys.stderr=Tee(sys.stderr)
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
limits=plan['resources'];policy=R.Policy({'chunk_scratch_mib':limits['cloudScratchMiB'],'chunk_ram_mib':limits['hostRamMiB'],'chunk_seconds':limits['seconds'],'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=limits['cloudScratchMiB']*R.MIB,checkpoint=output/'receipt.json');scratch.root=output.parent/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
command=['/opt/homebrew/bin/node','--max-old-space-size='+str(limits['nodeHeapMiB']),str(BASE/('diagnose.mjs' if plan['phase']=='fifth-asset' else 'virtual.mjs'))];R.atomic_json(meta/'selection.json',{'scope':'scoped '+plan['phase'],'selection':plan['selection'],'selected':command,'identity':identity,'inputs':inputs,'resources':limits,'network':plan.get('network',{'maximumGETsIncludingRedirect':0}),'acceptance':False});R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':plan['phase'],'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'retainedOutput':str(output),'retainedBinary':False,'compatibilityException':None,'state':'planned'})
reserved=entered=finished=False;result={}
def finish():
 global reserved,entered,finished
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned child group absence unproved'
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 for p,h in {**identity,**inputs}.items():assert sha(pathlib.Path(p))==h,p
 own=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert own<limits['supervisorHeadroomMiB']*R.MIB and own+result.get('peak_rss',0)<limits['hostRamMiB']*R.MIB
 R.atomic_json(meta/'cleanup.json',{'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'supervisorPeakRSSBytes':own,'aggregatePeakRSSUpperBoundBytes':own+result.get('peak_rss',0),'immutablePinsUnchanged':True,'retainedBinary':False,'dependencyLinksTouched':False,'compatibilityException':None,'leftovers':[]});finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,limits['diskReservationMiB']*R.MIB,limits['hostRamMiB']*R.MIB,cloud,root=scratch.root);reserved=True;output.mkdir(parents=True,mode=0o700);scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','REVIEWED_PLAN_SHA256':reviewed,'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(output)},meta/'command.log',scratch,policy,limits['cloudScratchMiB']*R.MIB,limits['groupRamMiB']*R.MIB,limits['seconds'],host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped '+plan['phase'],'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (output/'receipt.json').exists():compact.update(receipt=read(output/'receipt.json'),receiptSha256=sha(output/'receipt.json'))
R.atomic_json(BASE/'results.json',compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-'+plan['phase']+'-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'acceptance':False});print((meta/'command.log').read_text()[-4000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
