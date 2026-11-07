"""Finite seven-bottle download and embedded Ruby inspection only; no package install or native execution."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess,resource
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==5 and sys.argv[1]=='--reviewed-plan-sha256' and sys.argv[3]=='--root-release'
reviewed=sys.argv[2];assert re.fullmatch(r'[a-f0-9]{64}',reviewed)
phase='seven-bottle-inspection'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert sha(BASE/'plan.json')==reviewed;plan=read(BASE/'plan.json');assert str(ROOT)==plan['executionRoot'];grantPath=pathlib.Path(sys.argv[4]);assert grantPath.is_absolute();grant=read(grantPath)
assert grant['authorized'] is True and grant['phase']==phase and grant['planSha256']==reviewed and grant['codePins']==plan['codePins'];assert grant['installAllowed'] is False and grant['nativeAllowed'] is False and grant['newRequestCeiling']==35 and grant['retainedArchiveCeilingBytes']==66864127 and grant['embeddedRubyExecutionAllowed'] is False
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=reviewed
assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
inputs={str(grantPath):sha(grantPath)}
for pin in plan['inputs']:
 p=pathlib.Path(pin['path']);assert p.is_absolute();assert sha(p)==pin['sha256'];inputs[str(p)]=pin['sha256']
assert pathlib.Path(plan['defaultPostgresCluster']['path']).exists()==plan['defaultPostgresCluster']['exists']
for path,expected in plan['kegs'].items():assert pathlib.Path(path).exists()==expected
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
policy=R.Policy({'chunk_scratch_mib':2,'chunk_ram_mib':256,'chunk_seconds':240,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=2*R.MIB,checkpoint=destination/'progress.json');scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
command=['/usr/bin/python3','-I',str(BASE/'inspect-bottles.py')]
selection={'scope':'scoped exact seven-bottle download and embedded Ruby inspection only','changedPaths':[str(BASE)],'regression':'record actual embedded build Ruby separately from current formula source hash; no Ruby execution','affectedCallers':['original native install first-bottle preflight'],'integrationBoundaries':['public exact GHCR bottle','whole bottle hash trust anchor; distinct embedded/current formula identities','read-only installed kegs/aliases'],'selected':command,'identity':identity,'inputs':inputs,'resources':plan['resources'],'excluded':plan['unrun'],'checkpoint':str(destination/'progress.json'),'acceptance':False};R.atomic_json(meta/'selection.json',selection)
reserved=entered=finished=False;outputIdentity=None;result={};R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'native-'+phase,'retainedOutput':str(destination),'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLinkTouched':False,'builtinsOnly':True,'state':'planned','sourceCalls':0,'maximumPublicRequests':35,'installationInvoked':False,'retainedArchiveNames':[a['archiveName'] for a in plan['packages']],'retainVerifiedArchives':True})
def finish():
 global reserved,entered,finished
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned group absence not proved; live/unknown fails'
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if outputIdentity is not None:
  st=output.lstat();assert output.is_dir() and not output.is_symlink() and (st.st_dev,st.st_ino)==outputIdentity
  for package in plan['packages']:
   for partial in [output/'archives'/(package['archiveName']+'.partial'),output/'embedded-ruby'/(package['name']+'.rb.pending')]:
    if os.path.lexists(partial):assert partial.is_file() and not partial.is_symlink();partial.unlink()
  for name in ['progress.pending','receipt.pending','failure.pending','alias-keg-state.pending']:
   pending=output/name
   if os.path.lexists(pending):assert pending.is_file() and not pending.is_symlink();pending.unlink()
  for package in plan['packages']:
   archive=output/'archives'/package['archiveName']
   if archive.exists():assert archive.is_file() and not archive.is_symlink() and archive.stat().st_size==package['downloadBytes'] and sha(archive)==package['bottleSha256']
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable code/input changed'
 assert all((os.readlink(p) if pathlib.Path(p).is_symlink() else None)==v for p,v in plan['aliases'].items()),'Read-only preflight alias changed'
 assert all(pathlib.Path(p).exists()==v for p,v in plan['kegs'].items()),'Read-only inspection keg state changed'
 assert pathlib.Path(plan['defaultPostgresCluster']['path']).exists()==plan['defaultPostgresCluster']['exists']
 ownPeak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert ownPeak<64*R.MIB;aggregate=result.get('peak_rss',0)+ownPeak;assert aggregate<256*R.MIB
 cleanup={'supervisorPeakRSSBytes':ownPeak,'aggregatePeakRSSUpperBoundBytes':aggregate,'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkTouched':False,'builtinsOnly':True,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(destination),'retainedLogicalBytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),'immutablePinsUnchanged':True,'outerInvocationLog':str(meta/'invocation.log'),'retainedVerifiedArchives':[{'path':str(destination/'archives'/a['archiveName']),'bytes':(destination/'archives'/a['archiveName']).stat().st_size,'sha256':sha(destination/'archives'/a['archiveName'])} for a in plan['packages'] if (destination/'archives'/a['archiveName']).is_file()],'partialsAbsent':not any(destination.rglob('*.partial')) and not any(destination.rglob('*.pending')),'compatibilityException':None,'leftovers':[]};R.atomic_json(meta/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,128*R.MIB,256*R.MIB,cloud,root=scratch.root);reserved=True;destination.mkdir(parents=True,mode=0o700);st=destination.lstat();outputIdentity=(st.st_dev,st.st_ino);R.atomic_json(meta/'output-identity.json',{'path':str(output),'device':st.st_dev,'inode':st.st_ino});scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':reviewed,'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(destination)},meta/'command.log',scratch,policy,2*R.MIB,192*R.MIB,240,host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped native preflight '+phase,'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (destination/'receipt.json').exists():compact.update(receipt=read(destination/'receipt.json'),receiptSha256=sha(destination/'receipt.json'))
if (destination/'failure.json').exists():compact.update(failure=read(destination/'failure.json'),failureSha256=sha(destination/'failure.json'))
R.atomic_json(BASE/'results.json',compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f63-native-'+phase+'-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['unrun'],'acceptance':False});print((meta/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
