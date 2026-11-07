"""Finite local pack only after actual descriptor review, separate registration and exact parent grant."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,resource,shutil,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert len(sys.argv)==7 and sys.argv[1]=='--plan' and sys.argv[3]=='--reviewed-plan-sha256' and sys.argv[5]=='--root-release'
planPath=pathlib.Path(sys.argv[2]);grantPath=pathlib.Path(sys.argv[6]);reviewed=sys.argv[4];assert planPath.is_absolute() and grantPath.is_absolute() and sha(planPath)==reviewed
plan=read(planPath);grant=read(grantPath);assert plan['executionRoot']==str(ROOT) and grant['authorized'] is True and grant['phase']=='pack' and grant['planSha256']==reviewed and grant['releaseId']==plan['releaseId'] and grant['codePins']==plan['codePins'];assert grant['sourceCalls']==grant['publicRequests']==grant['nativeDatabaseRequests']==0 and grant['ordinaryPublicationExecuted'] is False
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(planPath)]=reviewed;inputs={str(grantPath):sha(grantPath)}
for pin in [plan['descriptor'],plan['descriptorReceipt'],plan['offlineSummary'],plan['candidateReceipt'],plan['candidatePlan'],plan['proofPlan'],*plan['sourcePins'],*plan['storePins'],*plan['ordinaryPins'],*plan['baselineHistoryPins']]:inputs[pin['path']]=pin['sha256']
for p,h in {**identity,**inputs}.items():assert sha(pathlib.Path(p))==h,p
assert sha(pathlib.Path(plan['registrationProposal']['path']))==plan['registrationProposal']['afterSha256']
store=pathlib.Path(plan['isolatedStore']);storeMembers=sorted(str(p) for p in store.rglob('*') if p.is_file());assert storeMembers==sorted(pin['path'] for pin in plan['storePins']) and not any(p.is_symlink() for p in store.rglob('*'))
cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();output=pathlib.Path(plan['outputRoot']);meta=pathlib.Path(plan['metadataRoot']);assert cloud.is_dir() and cloud in output.resolve().parents and not meta.exists() and not output.exists(),'One exact attempt; do not replay or overwrite prior phases'
meta.mkdir(parents=True,mode=0o700);control=(meta/'invocation.log').open('xb');remaining=[2*1024*1024]
class Tee:
 def __init__(self,original):self.original=original
 def write(self,value):
  data=value.encode('utf8')[:remaining[0]];control.write(data);control.flush();remaining[0]-=len(data)
  try:self.original.write(value);self.original.flush()
  except BrokenPipeError:pass
  return len(value)
 def flush(self):self.original.flush();control.flush()
sys.stdout=Tee(sys.stdout);sys.stderr=Tee(sys.stderr)
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
policy=R.Policy({'chunk_scratch_mib':256,'chunk_ram_mib':1024,'chunk_seconds':240,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=256*R.MIB,checkpoint=output/'receipt.json');scratch.root=output.parent/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
command=['/opt/homebrew/bin/node','--max-old-space-size=512',str(BASE/'package.mjs')];R.atomic_json(meta/'selection.json',{'scope':'scoped exact .12 raw-asset pack only','changedPaths':[str(BASE),plan['registrationProposal']['path']],'regression':'Existing packer streams31exact assets,20source shards and current/prior controls without network','affectedCallers':['packFleetRelease','durableCopy'],'integrationBoundaries':['actual10002proof/descriptor','separately reviewed code-owned registration','frozen ordinary .9 and external .11 histories'],'selected':command,'identity':identity,'inputs':inputs,'resources':plan['resources'],'excluded':plan['excluded'],'acceptance':False})
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir();existing=os.path.lexists(link);assert not existing or (link.is_dir() and not link.is_symlink())
reserved=entered=finished=False;linkIdentity=None;outputIdentity=None;result={};R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'fleet-dot12-exact-pack','scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'retainedOutput':str(output),'dependencyLink':str(link) if not existing else None,'sourceStagingDisposable':True,'compatibilityException':None,'ordinaryStoreMutation':False,'state':'planned'})
def finish():
 global reserved,entered,finished,linkIdentity
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned child group absence unproved'
 if linkIdentity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==linkIdentity and link.resolve()==vendor;link.unlink();linkIdentity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 removedFailedPack=0
 if outputIdentity is not None and (result.get('rc')!=0 or result.get('issue')) and (output/'pack').exists():
  st=output.lstat();assert not output.is_symlink() and (st.st_dev,st.st_ino)==outputIdentity;pack=output/'pack';assert pack.is_dir() and not pack.is_symlink();opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(pack)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();removedFailedPack=R.allocated_bytes(pack);shutil.rmtree(pack)
 if reserved:host.release(scratch.token);reserved=False
 for p,h in {**identity,**inputs}.items():assert sha(pathlib.Path(p))==h,p
 assert storeMembers==sorted(str(p) for p in store.rglob('*') if p.is_file())
 own=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert own<128*R.MIB;aggregate=own+result.get('peak_rss',0);assert aggregate<1024*R.MIB
 R.atomic_json(meta/'cleanup.json',{'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'ownedDependencyLinkAbsent':existing or not os.path.lexists(link),'existingDependencyPreserved':existing,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'removedFailedPackBytes':removedFailedPack,'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'supervisorPeakRSSBytes':own,'aggregatePeakRSSUpperBoundBytes':aggregate,'immutablePinsUnchanged':True,'compatibilityException':None,'leftovers':[]});finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,1024*R.MIB,1024*R.MIB,cloud,root=scratch.root);reserved=True;output.mkdir(parents=True,mode=0o700);st=output.lstat();outputIdentity=(st.st_dev,st.st_ino);R.atomic_json(meta/'output-identity.json',{'path':str(output),'device':st.st_dev,'inode':st.st_ino});scratch.__enter__();entered=True
  if not existing:link.symlink_to(vendor,target_is_directory=True);st=link.lstat();linkIdentity=(st.st_dev,st.st_ino);R.atomic_json(meta/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','FOLLOWTHROUGH_PLAN':str(planPath),'REVIEWED_PLAN_SHA256':reviewed,'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(output)},meta/'command.log',scratch,policy,256*R.MIB,896*R.MIB,240,host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped .12 exact pack only','result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (output/'receipt.json').exists():compact.update(receipt=read(output/'receipt.json'),receiptSha256=sha(output/'receipt.json'))
R.atomic_json(BASE/'package-results.json',compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot12-pack-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['excluded'],'acceptance':False});print((meta/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
