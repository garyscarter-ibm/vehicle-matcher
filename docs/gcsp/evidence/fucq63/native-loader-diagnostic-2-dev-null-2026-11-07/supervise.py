"""Finite zero-request loader diagnostic; installation and persistent writes forbidden."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess,resource
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==5 and sys.argv[1]=='--reviewed-plan-sha256' and sys.argv[3]=='--root-release'
reviewed=sys.argv[2];assert re.fullmatch(r'[a-f0-9]{64}',reviewed)
phase='loader-diagnostic2-dev-null'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert sha(BASE/'plan.json')==reviewed;plan=read(BASE/'plan.json');assert str(ROOT)==plan['executionRoot'];grantPath=pathlib.Path(sys.argv[4]);assert grantPath.is_absolute();grant=read(grantPath)
assert grant['authorized'] is True and grant['phase']==phase and grant['planSha256']==reviewed and grant['codePins']==plan['codePins']
assert grant['deviceWriteException']=='/dev/null' and plan['diagnostic']['deviceWriteException']=='/dev/null'
assert grant['diagnosticAllowed'] is True and grant['installAllowed'] is False and grant['nativeAllowed'] is False and grant['newRequestCeiling']==0 and grant['allowReviewedLocalPackagePaths'] is True and grant['signedApiEnvelope']==plan['signedApiEnvelope'] and grant['embeddedRubyPins']==plan['reviewedEmbeddedRubyPins']
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=reviewed
assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
inputs={str(grantPath):sha(grantPath)}
for pin in plan['inputs']:
 p=pathlib.Path(pin['path']);assert p.is_absolute();assert sha(p)==pin['sha256'];inputs[str(p)]=pin['sha256']
assert pathlib.Path(plan['defaultPostgresCluster']['path']).exists()==plan['defaultPostgresCluster']['exists']
for path,expected in plan['exactKegsBefore'].items():assert pathlib.Path(path).exists()==expected
for path,target in plan['optLinksBefore'].items():assert (os.readlink(path) if pathlib.Path(path).is_symlink() else None)==target
output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents
meta=pathlib.Path(plan['metadataRoot']);destination=output;assert not meta.exists() and not destination.exists(),'One attempt per phase: failed/uncertain requests cannot be replayed by this packet.'
meta.mkdir(parents=True,mode=0o700);controlLog=(meta/'invocation.log').open('xb');remaining=[1024*1024]
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
policy=R.Policy({'chunk_scratch_mib':128,'chunk_ram_mib':384,'chunk_seconds':120,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=128*R.MIB,checkpoint=destination/'diagnostic-progress.json');scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
command=['/usr/bin/python3','-I',str(BASE/'diagnose.py')]
selection={'scope':'scoped seven retained-bottle loader diagnostic only','changedPaths':[str(BASE)],'regression':'Shell strips internal opt-out; Ruby must assign it after startup and prove exact loader/factory path','affectedCallers':['Homebrew FromBottleLoader','Formulary.factory'],'integrationBoundaries':['seven retained exact official bottles','owned signed API cache; source cache immutable','OS sandbox denies network and writes except owned scratch and exact /dev/null'],'selected':command,'identity':identity,'inputs':inputs,'resources':plan['resources'],'excluded':plan['unrun'],'checkpoint':str(destination/'diagnostic-progress.json'),'acceptance':False};R.atomic_json(meta/'selection.json',selection)
reserved=entered=finished=False;outputIdentity=None;result={};R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'native-'+phase,'retainedOutput':str(destination),'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLinkTouched':False,'pythonStandardLibraryOrchestration':True,'state':'planned','sourceCalls':0,'maximumPublicRequests':0,'installationPermitted':False,'installedKegs':'All keg state immutable; never scratch','retainedArchivesUnchanged':True})
def finish():
 global reserved,entered,finished
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned group absence not proved; live/unknown fails'
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if outputIdentity is not None:
  st=output.lstat();assert output.is_dir() and not output.is_symlink() and (st.st_dev,st.st_ino)==outputIdentity
  for name in ['diagnostic-progress.pending','receipt.pending','diagnostic-failure.pending','before-state.pending','after-state.pending']:
   pending=output/name
   if os.path.lexists(pending):assert pending.is_file() and not pending.is_symlink();pending.unlink()
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable code/input changed'
 # All installed state is immutable; the sandbox independently forbids prefix writes.
 for name,versions in plan['oldKegsBefore'].items():
  kegRoot=pathlib.Path('/opt/homebrew/Cellar',name);assert (sorted(x.name for x in kegRoot.iterdir()) if kegRoot.is_dir() else [])==versions,'Keg state changed'
 for path,target in plan['optLinksBefore'].items():assert (os.readlink(path) if pathlib.Path(path).is_symlink() else None)==target,'Opt link changed'
 assert pathlib.Path(plan['defaultPostgresCluster']['path']).exists()==plan['defaultPostgresCluster']['exists']
 ownPeak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert ownPeak<64*R.MIB;aggregate=result.get('peak_rss',0)+ownPeak;assert aggregate<384*R.MIB
 cleanup={'supervisorPeakRSSBytes':ownPeak,'aggregatePeakRSSUpperBoundBytes':aggregate,'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkTouched':False,'pythonStandardLibraryOrchestration':True,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(destination),'retainedLogicalBytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),'immutablePinsUnchanged':True,'outerInvocationLog':str(meta/'invocation.log'),'retainedArchivePinsUnchanged':True,'installedKegsPreserved':True,'optLinksBefore':plan['optLinksBefore'],'optLinksAfter':{p:os.readlink(p) if pathlib.Path(p).is_symlink() else None for p in plan['optLinksBefore']},'partialsAbsent':not any(destination.rglob('*.pending')),'compatibilityException':None,'leftovers':[]};R.atomic_json(meta/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,144*R.MIB,384*R.MIB,cloud,root=scratch.root);reserved=True;destination.mkdir(parents=True,mode=0o700);st=destination.lstat();outputIdentity=(st.st_dev,st.st_ino);R.atomic_json(meta/'output-identity.json',{'path':str(output),'device':st.st_dev,'inode':st.st_ino});scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':reviewed,'ROOT_RELEASE_PATH':str(grantPath),'HOME':os.environ['HOME'],'PHASE_OUTPUT':str(destination)},meta/'command.log',scratch,policy,128*R.MIB,320*R.MIB,120,host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped retained-bottle loader diagnostic '+phase,'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (destination/'receipt.json').exists():compact.update(receipt=read(destination/'receipt.json'),receiptSha256=sha(destination/'receipt.json'))
if (destination/'diagnostic-failure.json').exists():compact.update(failure=read(destination/'diagnostic-failure.json'),failureSha256=sha(destination/'diagnostic-failure.json'))
R.atomic_json(BASE/'results.json',compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f63-native-'+phase+'-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['unrun'],'acceptance':False});print((meta/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
