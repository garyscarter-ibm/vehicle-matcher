"""Exact grant per cold/offline/recovery/cleanup phase; no implicit execution authority."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,resource,shutil,subprocess,time
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert len(sys.argv)==6 and sys.argv[2]=='--reviewed-plan-sha256' and sys.argv[4]=='--root-release'
phaseIdentity=sys.argv[1];match=re.fullmatch(r'(download|offline|recovery|cleanup)(?:-([1-9][0-9]*))?',phaseIdentity);assert match;phase=match.group(1);assert phaseIdentity==phase+'-2','Exact fresh suffix2 phase identity required'
reviewed=sys.argv[3];assert sha(BASE/'plan.json')==reviewed;plan=read(BASE/'plan.json');grantPath=pathlib.Path(sys.argv[5]);assert grantPath.is_absolute();grant=read(grantPath)
assert grant['authorized'] is True and grant['phase']==phase and grant.get('phaseIdentity',phase)==phaseIdentity and grant['planSha256']==reviewed and grant['releaseId']==plan['releaseId'] and grant['codePins']==plan['codePins']
assert grant['sourceRequests']==grant['nativeRequests']==grant['applicationPublicGETs']==0
assert grant['runtimeProjectionAllowed'] is True and grant['runtimeProjection']==plan['runtimeProjection']
assert grant['maxFetchOperations']==(124 if phase=='download' else 0)
assert grant['target']==plan['publicTarget']
if phase=='offline':assert grant['downloadReceiptPath']==str(pathlib.Path(plan['outputRoot'])/'download-2'/'receipt.json')
if phase=='recovery':assert grant['publicReceiptPath']==str(pathlib.Path(plan['outputRoot'])/'offline-2'/'receipt.json')
assert grant['runtimeTarget']==plan['runtimeTarget'] and isinstance(plan['runtimeTarget'],str) and re.fullmatch(r'[a-f0-9]{40}',plan['runtimeTarget'])
for relative,digest in plan['runtimeTargetPins'].items():
 shown=subprocess.run(['/usr/bin/git','show',plan['runtimeTarget']+':'+relative],cwd=ROOT,capture_output=True,check=True,timeout=10);assert hashlib.sha256(shown.stdout).hexdigest()==digest,relative
for relative,digest in plan['targetPins'].items():
 shown=subprocess.run(['/usr/bin/git','show',plan['publicTarget']+':'+relative],cwd=ROOT,capture_output=True,check=True,timeout=10);assert hashlib.sha256(shown.stdout).hexdigest()==digest,relative
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=reviewed
inputs={str(grantPath):sha(grantPath)}
for pin in [plan['descriptor'],plan['descriptorReceipt'],plan['offlineSummary'],plan['candidateReceipt'],plan['candidatePlan'],plan['proofPlan'],plan['registrationProposal']['proposal'],*plan['runtimePins'],*plan['originalProofReceipts']]:inputs[pin['path']]=pin['sha256']
for name in ['publishReceipt','downloadReceipt','publicReceipt','recoveryReceipt']:
 if name+'Path' in grant:
  p=pathlib.Path(grant[name+'Path']);assert p.is_absolute();inputs[str(p)]=grant[name+'Sha256']
for p,h in {**identity,**inputs}.items():assert sha(pathlib.Path(p))==h,p
assert sha(pathlib.Path(plan['registrationProposal']['path']))==plan['registrationProposal']['beforeSha256']
cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();outer=pathlib.Path(plan['outputRoot']);retained=pathlib.Path(plan['retainedRoot']);meta=pathlib.Path(plan['metadataRoot'])/phaseIdentity;destination=outer/phaseIdentity
assert cloud.is_dir() and cloud in outer.resolve().parents and retained.parent==outer and not meta.exists() and not destination.exists(),'Fresh phase identity required; preserve prior results'
meta.mkdir(parents=True,mode=0o700);control=(meta/'invocation.log').open('xb');remaining=[2*1024*1024]
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
seconds=60 if phase=='cleanup' else 300;policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':1024,'chunk_seconds':seconds,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=64*R.MIB,checkpoint=destination/'receipt.json');scratch.root=outer/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
command=['/opt/homebrew/bin/node','--max-old-space-size=512',str(BASE/'followthrough.mjs'),phase]
R.atomic_json(meta/'selection.json',{'scope':'scoped .12 '+phase,'changedPaths':[str(BASE),'root corrected releaseLimits and120second downloader external inputs'],'regression':'31exact publicassets; fresh offlineCLI; fiveactual historical observations on corrected runtime; four prior .11 recovery cases','affectedCallers':['fleet-artifacts CLI','createSyntheticRegistry','buildServer vehicle-evidence HTTP'],'integrationBoundaries':['anonymous immutableassets','restored current and previous256MiB corpus','corrected runtime module','local HTTP and consumer'],'selected':command if phase!='cleanup' else ['exact owned retained root cleanup'],'identity':identity,'inputs':inputs,'resources':plan['resources'],'excluded':plan['excluded'],'acceptance':False})
ledger=pathlib.Path(plan['metadataRoot'])/'retained-ownership.json';retainedInputs={};retainedIdentity=None
if phase=='download':assert not retained.exists() and not ledger.exists()
else:
 own=read(ledger);st=retained.lstat();assert retained.is_dir() and not retained.is_symlink() and [st.st_dev,st.st_ino]==own['identity'] and own['path']==str(retained) and own['planSha256']==reviewed
 retainedIdentity=tuple(own['identity'])
 for p in retained.rglob('*'):
  assert not p.is_symlink()
  if p.is_file():retainedInputs[str(p)]=sha(p)
reserved=entered=finished=False;result={};removedRetained=0
R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'dot12-'+phaseIdentity,'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'retainedRoot':str(retained),'retainedOwnership':str(ledger),'retainedPurpose':'Exact download inputs for offline and recovery; cleanup phase mandatory','compatibilityException':None,'state':'planned'})
def finish():
 global reserved,entered,finished
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned child group absence unproved'
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 for p,h in {**identity,**inputs}.items():assert sha(pathlib.Path(p))==h,p
 if phase!='cleanup':
  for p,h in retainedInputs.items():assert sha(pathlib.Path(p))==h,p
 own=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert own<128*R.MIB and own+result.get('peak_rss',0)<1024*R.MIB
 R.atomic_json(meta/'cleanup.json',{'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'runtimeDependencyLinkAbsent':not os.path.lexists(scratch.root/'runtime/server/node_modules'),'checkoutDependencyLinkTouched':False,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedRoot':str(retained),'retainedForNextGrantedPhase':phase!='cleanup','retainedRootAbsent':not os.path.lexists(retained),'removedRetainedBytes':removedRetained,'retainedLogicalBytes':sum(p.stat().st_size for p in retained.rglob('*') if p.is_file()) if retained.exists() else 0,'supervisorPeakRSSBytes':own,'aggregatePeakRSSUpperBoundBytes':own+result.get('peak_rss',0),'immutablePinsUnchanged':True,'compatibilityException':None,'leftovers':[]});finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,2048*R.MIB,1024*R.MIB,cloud,root=scratch.root);reserved=True;destination.mkdir(parents=True,mode=0o700);scratch.__enter__();entered=True
  if phase=='download':
   retained.mkdir(mode=0o700);st=retained.lstat();retainedIdentity=(st.st_dev,st.st_ino);R.atomic_json(ledger,{'owner':R.owner(),'path':str(retained),'identity':list(retainedIdentity),'planSha256':reviewed,'createdByPhase':phaseIdentity,'retainedFor':['offline','recovery'],'cleanupRequired':True})
  if phase=='cleanup':
   assert grant['deleteExactRetainedRoot'] is True
   opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(retained)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();started=time.monotonic();removedRetained=R.allocated_bytes(retained);shutil.rmtree(retained);assert not os.path.lexists(retained);result={'rc':0,'issue':None,'wall':time.monotonic()-started,'peak_rss':0};R.atomic_json(destination/'receipt.json',{'status':'exact-owned-cold-cache-store-removed','path':str(retained),'removedAllocatedBytes':removedRetained,'absent':True,'acceptance':False})
  else:
   result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':reviewed,'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(destination)},meta/'command.log',scratch,policy,64*R.MIB,896*R.MIB,seconds,host)
   assert sum(p.stat().st_size for p in retained.rglob('*') if p.is_file())<=plan['resources']['retainedBytesExpectedUpperBound']
  R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped .12 '+phase,'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (destination/'receipt.json').exists():compact.update(receipt=read(destination/'receipt.json'),receiptSha256=sha(destination/'receipt.json'))
R.atomic_json(BASE/(phaseIdentity+'-results.json'),compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot12-restored-'+phaseIdentity+'-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['excluded'],'acceptance':False})
if (meta/'command.log').exists():print((meta/'command.log').read_text()[-6000:])
print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
