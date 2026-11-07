"""Prepared source-free proof chunks. Exact parent-reviewed packet and candidate required."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess,resource
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==8 and sys.argv[2]=='--reviewed-plan-sha256' and sys.argv[4]=='--candidate-receipt-sha256' and sys.argv[6]=='--root-release'
phase=sys.argv[1];assert phase in ['publish-restart','helper-regression','staged-semantic','http0','http1','http2','http3','http4','http5','http6','http7','http8','http9','rollback','summarize','descriptor']
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert sha(BASE/'plan.json')==sys.argv[3]
plan=read(BASE/'plan.json');candidate=read(pathlib.Path(plan['candidatePlan']['path']));candidate['baseline'].update(plan['proofBaseline']);output=pathlib.Path(candidate['outputRoot']);assert sha(output/'candidate-receipt.json')==sys.argv[5]==plan['candidateReceipt']['sha256'];receipt=read(output/'candidate-receipt.json')
assert str(ROOT)==plan['executionWorktree']
grantPath=pathlib.Path(sys.argv[7]);assert grantPath.is_absolute();grant=read(grantPath);assert grant['authorized'] is True and grant['phase']==phase and grant['planSha256']==sys.argv[3] and grant['candidateReceiptSha256']==sys.argv[5] and grant['manifestDigest']==plan['expectedManifestDigest'];assert grant['sourceCalls']==0 and grant['ordinaryPublicationExecuted'] is False and grant['publicRequests']==0 and grant['nativeDatabaseRequests']==0 and grant['codePins']==plan['codePins']
cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents and output.is_dir()
META=pathlib.Path(plan['metadataRoot'])/phase;assert not META.exists(),'Fresh phase identity required; no overwrite.'
META.mkdir(parents=True,mode=0o700);controlLog=(META/'invocation.log').open('xb');remaining=[2*1024*1024]
class ControlTee:
 def __init__(self,original):self.original=original
 def write(self,value):
  if remaining[0]>0:
   data=value.encode('utf8')[:remaining[0]];controlLog.write(data);controlLog.flush();remaining[0]-=len(data)
  try:self.original.write(value);self.original.flush()
  except BrokenPipeError:pass
  return len(value)
 def flush(self):self.original.flush();controlLog.flush()
sys.stdout=ControlTee(sys.stdout);sys.stderr=ControlTee(sys.stderr)
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
identity={p['path']:p['sha256'] for p in plan['codePins']};identity[str(BASE/'plan.json')]=sha(BASE/'plan.json');identity[str(ROOT/'_tools/test_resources.py')]=sha(ROOT/'_tools/test_resources.py')
inputs={p['path']:p['sha256'] for p in [plan['candidatePlan'],plan['proofBaselineReceipt'],*receipt['files'],*candidate['baseline']['isolatedHistoryPins'],candidate['canonical'],candidate['spent'],candidate['baseline']['ordinaryActivationReceipt'],*candidate['baseline']['ordinaryBaseline']['pins'],*plan['sourcePins'],candidate['technicalSupplement'],candidate['baseline']['descriptor']]};inputs[str(output/'candidate-receipt.json')]=sys.argv[5];inputs[str(grantPath)]=sha(grantPath)
def check_membership():
 for directory,pins in [(candidate['baseline']['isolatedHistoryStore'],candidate['baseline']['isolatedHistoryPins']),(candidate['baseline']['ordinaryBaseline']['root'],candidate['baseline']['ordinaryBaseline']['pins'])]:
  store=pathlib.Path(directory);entries=list(store.rglob('*'));assert not any(p.is_symlink() for p in entries);assert sorted(str(p.relative_to(store)) for p in entries if p.is_file())==sorted(p['relativePath'] for p in pins),'Baseline membership changed'
check_membership()
storeMembers=None
if phase=='publish-restart':assert not (output/'isolated-store').exists(),'Fresh isolated store only'
if phase!='publish-restart':
 assert (output/'isolated-store').is_dir()
 storeMembers=sorted(str(p.relative_to(output/'isolated-store')) for p in (output/'isolated-store').rglob('*') if p.is_file())
 inputs.update({str(p):sha(p) for p in (output/'isolated-store').rglob('*') if p.is_file()})
 inputs[str(output/'publish-restart-receipt.json')]=sha(output/'publish-restart-receipt.json')
if phase not in ['publish-restart','helper-regression']:inputs[str(output/'helper-regression-receipt.json')]=sha(output/'helper-regression-receipt.json')
if phase not in ['publish-restart','helper-regression','staged-semantic']:inputs[str(output/'staged-semantic-receipt.json')]=sha(output/'staged-semantic-receipt.json')
if phase in ['summarize','descriptor']:
 for name in [*[f'http-chunk{i}-receipt.json' for i in range(10)],'rollback-receipt.json']:inputs[str(output/name)]=sha(output/name)
if phase=='descriptor':inputs[str(output/'offline-proof-summary.json')]=sha(output/'offline-proof-summary.json')
assert grant['priorReceiptPins']==[{ 'path':path,'sha256':digest} for path,digest in sorted(inputs.items()) if (pathlib.Path(path).name.endswith('-receipt.json') or pathlib.Path(path).name=='offline-proof-summary.json') and path!=plan['candidateReceipt']['path']]
for path,digest in {**identity,**inputs}.items():assert sha(pathlib.Path(path))==digest
script='http-chunk.mjs' if phase.startswith('http') else phase+'.mjs'
command=['/opt/homebrew/bin/node','--max-old-space-size=512',str(BASE/script)]+([phase[-1]] if phase.startswith('http') else [])
seconds=300 if phase=='staged-semantic' else 240
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':1024,'chunk_seconds':seconds,'log_mib':1});scratch=R.Scratch(META,ROOT,policy,expected=64*R.MIB,checkpoint=META/'result.json');scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy)
disposable=output/'rollback-scratch';assert not disposable.exists()
diskMiB=1024 if phase in ['publish-restart','rollback'] else 64
selection={'scope':'scoped .12 offline '+phase,'command':command,'changedPaths':plan['changedPaths'],'regression':plan['regression'],'affectedCallers':plan['affectedCallers'],'integrationBoundaries':plan['integrationBoundaries'],'excluded':plan['excluded'],'workers':1,'resources':{'scratchMiB':64,'diskReservedMiB':diskMiB,'hostRamMiB':1024,'groupRamMiB':896,'seconds':seconds},'identity':identity,'inputs':inputs,'candidateManifestDigest':receipt['candidateManifestDigest'],'checkpoint':str(META/'result.json'),'acceptance':False}
R.atomic_json(META/'selection.json',selection)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir();existing=os.path.lexists(link);assert not existing or (link.is_dir() and not link.is_symlink())
reserved=entered=finished=False;link_identity=None;result={}
R.atomic_json(META/'ownership.json',{'owner':R.owner(),'runId':'fleet-dot12-proof-'+phase,'outputRoot':str(output),'retainedOutput':True,'ownedDisposableCloudRoot':str(disposable) if phase=='rollback' else None,'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLink':str(link),'dependencyTarget':str(vendor),'plannedPeakMiB':diskMiB,'ownedFreshIsolatedStore':str(output/'isolated-store') if phase=='publish-restart' else None,'state':'planned'})
def finish():
 global reserved,entered,finished,link_identity
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],META/'group-queries.json'),'Owned group absence not proved'
 if link_identity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==link_identity and link.resolve()==vendor;link.unlink();link_identity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 removed_cloud=0
 if phase=='rollback' and disposable.exists():
  assert not disposable.is_symlink() and disposable.parent==output
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(disposable)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();removed_cloud=R.allocated_bytes(disposable);shutil.rmtree(disposable)
 if phase=='publish-restart' and (result.get('rc')!=0 or result.get('issue')) and (output/'isolated-store').exists():
  failedStore=output/'isolated-store';assert failedStore.is_dir() and not failedStore.is_symlink();opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(failedStore)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();removed_cloud+=R.allocated_bytes(failedStore);shutil.rmtree(failedStore)
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'immutable code/input changed';check_membership()
 if storeMembers is not None:assert storeMembers==sorted(str(p.relative_to(output/'isolated-store')) for p in (output/'isolated-store').rglob('*') if p.is_file()),'Proof store membership changed'
 ownPeak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert ownPeak<128*R.MIB;aggregate=result.get('peak_rss',0)+ownPeak;assert aggregate<1024*R.MIB
 cleanup={'supervisorPeakRSSBytes':ownPeak,'aggregatePeakRSSUpperBoundBytes':aggregate,'scratch':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'ownedDependencyLinkAbsent':existing or not os.path.lexists(link),'existingDependencyPreserved':existing,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'removedCloudScratchBytes':removed_cloud,'cloudScratchAbsent':not disposable.exists(),'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'retainedAllocationBytes':R.allocated_bytes(output),'compatibilityException':None,'leftovers':[],'immutablePinsUnchanged':True,'outerInvocationLog':str(META/'invocation.log')};R.atomic_json(META/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,diskMiB*R.MIB,1024*R.MIB,cloud,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  if not existing:
   link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino);R.atomic_json(META/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','CANDIDATE_RECEIPT_SHA256':sys.argv[5]},META/'command.log',scratch,policy,64*R.MIB,896*R.MIB,seconds,host);R.atomic_json(META/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
name={'publish-restart':'publish-restart-receipt.json','helper-regression':'helper-regression-receipt.json','staged-semantic':'staged-semantic-receipt.json','http0':'http-chunk0-receipt.json','http1':'http-chunk1-receipt.json','http2':'http-chunk2-receipt.json','http3':'http-chunk3-receipt.json','http4':'http-chunk4-receipt.json','http5':'http-chunk5-receipt.json','http6':'http-chunk6-receipt.json','http7':'http-chunk7-receipt.json','http8':'http-chunk8-receipt.json','http9':'http-chunk9-receipt.json','rollback':'rollback-receipt.json','summarize':'offline-proof-summary.json','descriptor':'descriptor-proposal-receipt.json'}[phase]
compact={'scope':'scoped offline '+phase,'result':result,'cleanup':read(META/'cleanup.json'),'planSha256':sys.argv[3],'candidateReceiptSha256':sys.argv[5],'rootReleaseSha256':sha(grantPath),'selectionSha256':sha(META/'selection.json'),'acceptance':False}
if (output/name).exists():compact.update({'receipt':read(output/name),'receiptSha256':sha(output/name)})
R.atomic_json(BASE/(phase+'-results.json'),compact)
R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot12-'+phase+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','codeIdentity':identity,'inputIdentity':inputs,'boundaries':plan['integrationBoundaries'],'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['excluded'],'acceptance':False})
print((META/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
