"""Finite .9 live parity phases; preparation alone confers no network authority."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==10 and sys.argv[2]=='--code' and sys.argv[4]=='--deployment-id' and sys.argv[6]=='--reviewed-plan-sha256' and sys.argv[8]=='--root-release'
phase,code,deployment,reviewed=sys.argv[1],sys.argv[3],sys.argv[5],sys.argv[7];assert re.fullmatch(r'health|refs[0-4]',phase);assert re.fullmatch(r'[a-f0-9]{40}',code);assert re.fullmatch(r'[A-Za-z0-9_-]{1,128}',deployment)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert sha(BASE/'plan.json')==reviewed;plan=read(BASE/'plan.json');grantPath=pathlib.Path(sys.argv[9]);assert grantPath.is_absolute();grant=read(grantPath)
assert grant['authorized'] is True and grant['phase']==phase and grant['planSha256']==reviewed and grant['code']==code and grant['actualDeploymentId']==deployment and grant['deploymentSucceeded'] is True and grant['manifestDigest']==plan['manifestDigest'];assert grant['sourceCalls']==0 and grant['priorDiagnosticHealthGets']==5 and grant['newGetCeiling']==2427
assert ROOT==pathlib.Path('/Users/usget/Claude/vehicle-matcher'),'Ordinary loader parity must execute from root only after actual .9 activation'
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity.update({str(BASE/p['name']):p['sha256'] for p in plan['preparedScripts']});identity[str(BASE/'plan.json')]=reviewed
assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
# Each DTO dependency must be identical to the explicitly named deployment commit.
for path,digest in plan['codePins'].items():
 committed=subprocess.run(['git','show',code+':'+path],cwd=ROOT,capture_output=True,check=True);assert hashlib.sha256(committed.stdout).hexdigest()==digest
inputs={str(grantPath):sha(grantPath)}
for pin in [grant['deploymentEvidence'],*grant['priorReceipts']]:
 p=pathlib.Path(pin['path']);assert p.is_absolute();assert sha(p)==pin['sha256'];inputs[str(p)]=pin['sha256']
store=ROOT/plan['ordinaryStoreRelativePath'];pointer=read(store/'active.json');assert pointer['selected']['manifestDigest']==plan['manifestDigest'];selected=store/'versions'/pointer['selected']['directory'];assert sha(selected/'manifest.json')==plan['manifestDigest'];manifest=read(selected/'manifest.json');inputs[str(store/'active.json')]=sha(store/'active.json');inputs[str(selected/'manifest.json')]=plan['manifestDigest']
for name,digest in manifest['checksums'].items():assert sha(selected/name)==digest;inputs[str(selected/name)]=digest
output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents
meta=pathlib.Path(plan['metadataRoot'])/phase;destination=output/phase;assert not meta.exists() and not destination.exists(),'One attempt per phase: failed/uncertain requests cannot be replayed by this packet.'
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
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':180,'log_mib':1});scratch=R.Scratch(meta,ROOT,policy,expected=64*R.MIB,checkpoint=destination/'progress.json');scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
command=['/opt/homebrew/bin/node','--max-old-space-size=320',str(BASE/'probe.mjs'),'--code',code,'--deployment-id',deployment,'--phase',phase]
selection={'scope':'scoped .9 deployed parity '+phase,'changedPaths':[str(BASE)],'regression':'exact2426 ordinary local/deployed DTO parity after actual successful .9 deployment','affectedCallers':['createLocalVehicleEvidenceLookup','SyntheticRegistry','vehicle-evidence GET handler'],'integrationBoundaries':['actualdeployment/code','ordinaryactivated.9manifest','anonymousRenderGET','streamedJSONLreferences'],'selected':command,'identity':identity,'inputs':inputs,'resources':plan['resources'],'excluded':plan['unrun'],'checkpoint':str(destination/'progress.json'),'acceptance':False};R.atomic_json(meta/'selection.json',selection)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir();existing=os.path.lexists(link);assert not existing or (link.is_dir() and not link.is_symlink()),'Preserve another run dependency link'
reserved=entered=finished=False;linkIdentity=None;result={};R.atomic_json(meta/'ownership.json',{'owner':R.owner(),'runId':'dot9-live-'+phase,'retainedOutput':str(destination),'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLink':str(link) if not existing else None,'state':'planned','sourceCalls':0,'maximumNewGets':1 if phase=='health' else plan['chunks'][int(phase[4:])]['count']})
def finish():
 global reserved,entered,finished,linkIdentity
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],meta/'group-queries.json'),'Owned group absence not proved; live/unknown fails'
 if linkIdentity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==linkIdentity and link.resolve()==vendor;link.unlink();linkIdentity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable code/input changed'
 cleanup={'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'ownedDependencyLinkAbsent':existing or not os.path.lexists(link),'existingDependencyPreserved':existing,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(destination),'retainedLogicalBytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),'immutablePinsUnchanged':True,'outerInvocationLog':str(meta/'invocation.log'),'compatibilityException':None,'leftovers':[]};R.atomic_json(meta/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,64*R.MIB,512*R.MIB,cloud,root=scratch.root);reserved=True;scratch.__enter__();entered=True;destination.mkdir(parents=True,mode=0o700)
  if not existing:
   link.symlink_to(vendor,target_is_directory=True);st=link.lstat();linkIdentity=(st.st_dev,st.st_ino);R.atomic_json(meta/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':reviewed,'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(destination)},meta/'command.log',scratch,policy,64*R.MIB,448*R.MIB,180,host);R.atomic_json(meta/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped .9 deployed parity '+phase,'result':result,'cleanup':read(meta/'cleanup.json'),'planSha256':reviewed,'grantSha256':sha(grantPath),'acceptance':False}
if (destination/'receipt.json').exists():compact.update(receipt=read(destination/'receipt.json'),receiptSha256=sha(destination/'receipt.json'))
R.atomic_json(BASE/(phase+'-results.json'),compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot9-live-'+phase+'-'+reviewed[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['unrun'],'acceptance':False});print((meta/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
