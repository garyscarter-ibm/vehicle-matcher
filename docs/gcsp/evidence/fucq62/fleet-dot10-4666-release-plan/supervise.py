"""Prepared exact-release chunks. No phase is authorized by the existence of this supervisor."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==6 and sys.argv[2]=='--reviewed-plan-sha256' and sys.argv[4]=='--root-release'
phaseIdentity=sys.argv[1]
import re
match=re.fullmatch(r'(pack|local-check|check|publish)(?:-([1-9][0-9]*))?',phaseIdentity);assert match
phase=match.group(1)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert sha(BASE/'plan.json')==sys.argv[3];plan=read(BASE/'plan.json');grantPath=pathlib.Path(sys.argv[5]);assert grantPath.is_absolute();grant=read(grantPath);assert grant['authorized'] is True and grant['phase']==phase and grant['planSha256']==sys.argv[3] and grant['releaseId']==plan['releaseId'];assert grant.get('phaseIdentity',phase)==phaseIdentity
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=sys.argv[3]
assert grant['codePins']==plan['codePins'];assert all(sha(pathlib.Path(p))==h for p,h in identity.items());assert sha(ROOT/'server/gcsp/vehicle-evidence/fleet-releases.json')==plan['registrationProposal']['afterSha256']
output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents
meta=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot10-4666-release')/phaseIdentity;destination=output/phaseIdentity;assert not meta.exists() and not destination.exists(),'Fresh phase only; preserve actual prior attempts. Resume requires a newly reviewed plan/phase identity.'
# Retained outer control log includes finalizer traceback, independently of terminal truncation.
meta.mkdir(parents=True,mode=0o700);controlLog=(meta/'invocation.log').open('xb');remaining=[2*1024*1024]
class ControlTee:
 def __init__(self,original):self.original=original
 def write(self,value):
  if remaining[0]>0:
   kept=value.encode('utf8')[:remaining[0]];controlLog.write(kept);controlLog.flush();remaining[0]-=len(kept)
  try:self.original.write(value);self.original.flush()
  except BrokenPipeError:pass
  return len(value)
 def flush(self):self.original.flush();controlLog.flush()
sys.stdout=ControlTee(sys.stdout);sys.stderr=ControlTee(sys.stderr)
inputs={str(grantPath):sha(grantPath)}
for pin in [plan['offlineSummary'],plan['candidateReceipt'],plan['previousDescriptor'],plan['descriptorReceipt']]:inputs[pin['path']]=pin['sha256']
for p in pathlib.Path(plan['isolatedStore']).rglob('*'):
 if p.is_file():inputs[str(p)]=sha(p)
for asset in read(BASE/'descriptor-proposal.json')['assets']:
 p=pathlib.Path(plan['sourceRoot'])/asset['origin'] if asset['role']=='source' else pathlib.Path(plan['isolatedStore'])/asset['path'][6:];inputs[str(p)]=asset['sha256']
if phase!='pack':
 for a in read(BASE/'descriptor-proposal.json')['assets']:inputs[str(output/'pack'/'pack'/plan['releaseId']/a['path'])]=a['sha256']
inputs.update({p['path']:p['sha256'] for p in plan['ordinaryPins']})
for path,digest in inputs.items():assert sha(pathlib.Path(path))==digest
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
seconds=600 if phase=='publish' else 180;diskMiB=384 if phase=='pack' else 64
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':768,'chunk_seconds':seconds,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=(64)*R.MIB,checkpoint=destination/'receipt.json');scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
script='package.mjs' if phase=='pack' else 'public.mjs';command=['/opt/homebrew/bin/node','--max-old-space-size=384',str(BASE/script)]+([] if phase in ['pack'] else [phase])
R.atomic_json(meta/'selection.json',{'scope':'scoped dot10 '+phase,'changedPaths':[str(BASE),'server/gcsp/vehicle-evidence/fleet-releases.json'],'regression':'exact26assets and committed descriptor/source anchor; no public restore/ordinary scope','affectedCallers':['packFleetRelease','GitHub release API'],'integrationBoundaries':['exactcommitteddescriptor/sourceanchor','GitHubmetadata/upload','26immutableassets','unchangedpreviousrelease'],'selected':command,'excluded':plan['excluded'],'identity':identity,'inputs':inputs,'resources':plan['resources'],'seconds':seconds,'checkpoint':str(destination/'receipt.json'),'acceptance':False})
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir();existing=os.path.lexists(link);assert not existing or (link.is_dir() and not link.is_symlink()),'Do not appropriate another run dependency link'
reserved=entered=finished=False;linkIdentity=None;result={}
R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'dot10-release-'+phase,'retainedOutput':str(destination),'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLink':str(link) if not existing else None,'ordinaryStoreMutable':False,'state':'planned'})
def finish():
 global reserved,entered,finished,linkIdentity
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned group absence not proved; live/unknown cannot bypass cleanup.'
 if linkIdentity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==linkIdentity and link.resolve()==vendor;link.unlink();linkIdentity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable code/input changed'
 cleanup={'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'ownedDependencyLinkAbsent':existing or not os.path.lexists(link),'existingDependencyPreserved':existing,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(destination),'retainedLogicalBytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),'codeInputPinsUnchanged':True,'groupQueryReceipt':str(meta/'group-queries.json'),'outerInvocationLog':str(meta/'invocation.log'),'ordinaryStoreMutated':False,'compatibilityException':None,'leftovers':[]};R.atomic_json(meta/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,diskMiB*R.MIB,768*R.MIB,cloud,root=scratch.root);reserved=True;destination.mkdir(parents=True,mode=0o700);scratch.__enter__();entered=True
  if not existing:
   link.symlink_to(vendor,target_is_directory=True);st=link.lstat();linkIdentity=(st.st_dev,st.st_ino);R.atomic_json(meta/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','HOME':os.environ['HOME'],'GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':sys.argv[3],'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(destination)},meta/'command.log',scratch,policy,(64)*R.MIB,672*R.MIB,seconds,host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped dot10 '+phase,'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':sys.argv[3],'grantSha256':sha(grantPath),'acceptance':False}
if (destination/'receipt.json').exists():compact.update(receipt=read(destination/'receipt.json'),receiptSha256=sha(destination/'receipt.json'))
R.atomic_json(BASE/(phaseIdentity+'-results.json'),compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot10-release-'+phaseIdentity+'-'+sys.argv[3][:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['excluded'],'acceptance':False});print((meta/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
