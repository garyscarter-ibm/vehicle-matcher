"""Exact granted install/native phases; no execution authorized by preparation alone."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess,resource
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==6 and sys.argv[2]=='--reviewed-plan-sha256' and sys.argv[4]=='--root-release'
phaseIdentity=sys.argv[1];match=re.fullmatch(r'(install|native)(?:-([1-9][0-9]*))?',phaseIdentity);assert match;phase=match.group(1)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text());reviewed=sys.argv[3];assert sha(BASE/'plan.json')==reviewed;plan=read(BASE/'plan.json');grantPath=pathlib.Path(sys.argv[5]);assert grantPath.is_absolute();grant=read(grantPath);assert grant['authorized'] is True and grant['phase']==phase and grant['planSha256']==reviewed and grant.get('phaseIdentity',phase)==phaseIdentity and grant['codePins']==plan['codePins']
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=reviewed;inputs={str(grantPath):sha(grantPath)}
for pin in [plan['packageMetadata'],plan['selectionPriorReceipt'],*plan['storePins'],*plan['sourcePins']]:inputs[pin['path']]=pin['sha256']
if phase=='install':
 assert grant['acknowledgeInstalledKegsPreserved'] is True and grant['acknowledgeOptLinksMayChange'] is True and grant['approvedPackages']==plan['approvedPackages'];catalog=read(BASE/'package-metadata.json')['catalog'];inputs[catalog['path']]=catalog['sha256'];inputs.update({p['path']:p['sha256'] for p in plan['installerPins']});assert pathlib.Path('/usr/bin/sandbox-exec').is_file()
else:
 installed=pathlib.Path(grant['installReceiptPath']);assert installed.is_absolute();inputs[str(installed)]=grant['installReceiptSha256'];assert read(installed)['status']=='exact-pinned-postgresql16-bottles-installed'
for path,h in {**identity,**inputs}.items():assert sha(pathlib.Path(path))==h,path
output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents;destination=output/phaseIdentity;meta=pathlib.Path(plan['metadataRoot'])/phaseIdentity;assert not destination.exists() and not meta.exists(),'Fresh reviewed identity only; retain failed or partial installation and receipts'
meta.mkdir(parents=True,mode=0o700);control=(meta/'invocation.log').open('xb');remaining=[1048576]
class Tee:
 def __init__(self,original):self.original=original
 def write(self,value):
  if remaining[0]>0:
   data=value.encode('utf8')[:remaining[0]];control.write(data);control.flush();remaining[0]-=len(data)
  try:self.original.write(value);self.original.flush()
  except BrokenPipeError:pass
  return len(value)
 def flush(self):self.original.flush();control.flush()
sys.stdout=Tee(sys.stdout);sys.stderr=Tee(sys.stderr)
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
seconds=600 if phase=='install' else 240;scratchMiB=768 if phase=='install' else 192;diskMiB=2048 if phase=='install' else 256;policy=R.Policy({'chunk_scratch_mib':scratchMiB,'chunk_ram_mib':768,'chunk_seconds':seconds,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=scratchMiB*R.MIB,checkpoint=destination/'receipt.json')
if phase=='install':scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud')
host=R.HostBudget(policy);command=['/usr/bin/python3','-I',str(BASE/(phase+'.py'))];link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');existing=os.path.lexists(link);assert not existing or (link.is_dir() and not link.is_symlink()),'Do not appropriate another run link';assert phase=='install' or vendor.is_dir()
R.atomic_json(meta/'selection.json',{'scope':'scoped local native PostgreSQL '+phase,'changedPaths':[str(BASE)],'regression':'pinned native bottles, private192MiB cluster, exact retained.9 currentrun and3realallocated orderUUIDs; no memoryfallback','affectedCallers':['Homebrew local bottle installer','nativePostgresRepository','migrate','allocateSyntheticIdentities','publishStockOrders','proveCurrentOrderReferences'],'integrationBoundaries':['exactnativebottle/dylibs','ownedloopbackPG','3migrationledger','retained.9sourcebinding','nativecurrentrun/orderUUID/directconsumerHTTP'],'selected':command,'excluded':plan['excluded'],'identity':identity,'inputs':inputs,'resources':plan['resources'],'checkpoint':str(destination/'receipt.json'),'acceptance':False})
reserved=entered=finished=False;linkIdentity=None;result={};R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'f63-native-'+phaseIdentity,'retainedOutput':str(destination),'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLink':str(link) if phase=='native' and not existing else None,'installedKegs':'preserve all; never disposable','allNativeDescendants':'inherit supervisor owned process group','state':'planned','compatibilityException':None})
def finish():
 global reserved,entered,finished,linkIdentity
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned group live/unknown; cleanup cannot bypass'
 if linkIdentity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==linkIdentity and link.resolve()==vendor;link.unlink();linkIdentity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if phase=='install' and scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable native code/input changed'
 ownPeak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert ownPeak<96*R.MIB,'Supervisor exceeded reserved96MiB headroom';aggregate=result.get('peak_rss',0)+ownPeak;assert aggregate<768*R.MIB
 cleanup={'scratchAbsent':not os.path.lexists(scratch.root),'clusterSocketCacheAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'ownedDependencyLinkAbsent':existing or not os.path.lexists(link),'dependencyLinkChanged':phase=='native' and not existing,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'maxSampledOwnedGroupRSSBytes':result.get('peak_rss'),'supervisorPeakRSSBytes':ownPeak,'aggregatePeakRSSUpperBoundBytes':aggregate,'retainedOutput':str(destination),'retainedLogicalBytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),'installedKegsPreserved':True,'codeInputPinsUnchanged':True,'compatibilityException':None,'leftovers':[]};R.atomic_json(meta/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,diskMiB*R.MIB,768*R.MIB,cloud if phase=='install' else ROOT,root=scratch.root);reserved=True;destination.mkdir(parents=True,mode=0o700);scratch.__enter__();entered=True
  if phase=='native' and not existing:
   link.symlink_to(vendor,target_is_directory=True);st=link.lstat();linkIdentity=(st.st_dev,st.st_ino);R.atomic_json(meta/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','HOME':os.environ['HOME'],'GCSP_OFFLINE':'1','ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(destination)},meta/'command.log',scratch,policy,scratchMiB*R.MIB,672*R.MIB,seconds,host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped local native PostgreSQL '+phase,'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (destination/'receipt.json').exists():compact.update(receipt=read(destination/'receipt.json'),receiptSha256=sha(destination/'receipt.json'))
R.atomic_json(BASE/(phaseIdentity+'-results.json'),compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f63-native-'+phaseIdentity+'-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRSSBytes':result.get('peak_rss'),'excluded':plan['excluded'],'acceptance':False});print((meta/'command.log').read_text()[-3000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
