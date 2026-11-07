"""Prepared external .11 candidate only. Exact parent grant required; all ordinary history read-only."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess,resource
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
def check_history_membership(plan):
 for directory,pins in [(plan['baseline']['isolatedHistoryStore'],plan['baseline']['isolatedHistoryPins']),(plan['baseline']['ordinaryBaseline']['root'],plan['baseline']['ordinaryBaseline']['pins'])]:
  root=pathlib.Path(directory);entries=list(root.rglob('*'));assert not any(p.is_symlink() for p in entries);assert sorted(str(p.relative_to(root)) for p in entries if p.is_file())==sorted(p['relativePath'] for p in pins),'History membership changed'
assert len(sys.argv)==5 and sys.argv[1]=='--reviewed-plan-sha256' and sys.argv[3]=='--root-release';assert sha(BASE/'plan.json')==sys.argv[2];plan=read(BASE/'plan.json');grantPath=pathlib.Path(sys.argv[4]);assert grantPath.is_absolute();grant=read(grantPath);assert str(ROOT)==plan['executionWorktree'];assert grant['authorized'] is True and grant['phase']=='candidate-2' and grant['planSha256']==sys.argv[2] and grant['version']==plan['version'];assert grant['externalOnly'] is True and grant['codePins']==plan['codePins'];assert grant['sourceCalls']==0 and grant['ordinaryPublicationExecuted'] is False;assert grant['noShardGeneration'] is True and grant['compatibilityExceptionAcknowledged'] is True and grant['localBuildWorkingSetMaxMiB']==768
identity={str(ROOT/p):h for p,h in plan['codePins'].items()};identity[str(BASE/'plan.json')]=sys.argv[2];assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
inputs={p['path']:p['sha256'] for p in [plan['canonical'],plan['spent'],plan['parentAudit'],plan['ordinaryRollbackReceipt'],plan['artifactBoundary'],*plan['priorSources'],*plan['baseline']['files'],plan['baseline']['candidateReceipt'],plan['baseline']['descriptor'],*plan['baseline']['isolatedHistoryPins'],plan['baseline']['ordinaryActivationReceipt'],*plan['baseline']['ordinaryBaseline']['pins'],*plan['novelRows']['originFilePins'],plan['technicalSupplement'],plan['originalPlan'],*plan['reusedSourceShards'],*plan['failureEvidence']]};inputs[str(grantPath)]=sha(grantPath);assert all(sha(pathlib.Path(p))==h for p,h in inputs.items());check_history_membership(plan)
output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents and not output.exists();metadata=pathlib.Path(plan['metadataRoot']);assert not metadata.exists(),'Fresh reviewed phase only; preserve prior attempts.'
metadata.mkdir(parents=True,mode=0o700);controlLog=(metadata/'invocation.log').open('xb');remaining=[2*1024*1024]
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
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R);spec=importlib.util.spec_from_file_location('group_proof',BASE/'group-proof.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
policy=R.Policy({'chunk_scratch_mib':768,'chunk_ram_mib':1024,'chunk_seconds':240,'log_mib':1,'local_scratch_reason':'Tool-required active build working data: unchanged production writer/indexer requires a stable local working set; bounded768MiB, completed artifacts exported directly OneDrive, teardown required'});scratch=R.Scratch(metadata,ROOT,policy,expected=768*R.MIB,checkpoint=output/'candidate-receipt.json');host=R.HostBudget(policy);command=['/opt/homebrew/bin/node','--max-old-space-size=512',str(BASE/'prepare-candidate-2.mjs')]
selection={'scope':'scoped external .11 offline candidate, unrun until exact grant','changedPaths':[str(BASE)],'regression':'3385 exact original-byte admissions over byte-preserved external .10; bounded local active build working data; completed files external','affectedCallers':['writeCorpusCandidate','validateCorpusDirectory','indexJsonl','strict pinned tool sourceRegistrations'],'integrationBoundaries':['8054 canonical /10543 spent /8051 admitted','all4667 prior recordbytes,VIN/images/supplement','frozen isolated11versions; actual ordinary10versions','768MiB local active build working set compatibility exception;256MiB code-owned JSONL limit'],'command':command,'identity':identity,'inputs':inputs,'limits':plan['limits'],'ordinaryBaseline':plan['baseline']['ordinaryBaseline'],'excluded':plan['unrun'][2:],'checkpoint':str(output/'candidate-receipt.json'),'acceptance':False};R.atomic_json(metadata/'selection.json',selection)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir();existing=os.path.lexists(link);assert not existing or (link.is_dir() and not link.is_symlink())
reserved=entered=finished=False;linkIdentity=None;result={};R.atomic_json(metadata/'ownership.json',{'owner':R.owner(),'runId':'fleet-dot11-8051-candidate2','outputRoot':str(output),'retainedCandidateAndSourceShards':True,'expectedRetainedMiB':160,'peakDiskMiB':1024,'externalSources':[{'path':s['path'],'sha256':s['sha256'],'retained':True} for s in plan['reusedSourceShards']], 'compatibilityException':plan['compatibilityException'],'gitSourceCopies':False,'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'ordinaryStoreMutation':False,'state':'planned'})
def finish():
 global reserved,entered,finished,linkIdentity
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],metadata/'group-queries.json'),'Owned group absence not proved'
 if linkIdentity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==linkIdentity and link.resolve()==vendor;link.unlink();linkIdentity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 # The shared system temporary directory is never removed.
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable code/input changed';check_history_membership(plan)
 retainedSources=[{'path':s['path'],'exists':pathlib.Path(s['path']).is_file(),'sha256':sha(pathlib.Path(s['path']))} for s in plan['reusedSourceShards']]
 ownPeak=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss;assert ownPeak<128*R.MIB;aggregate=result.get('peak_rss',0)+ownPeak;assert aggregate<1024*R.MIB
 cleanup={'supervisorPeakRSSBytes':ownPeak,'aggregatePeakRSSUpperBoundBytes':aggregate,'scratch':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'ownedDependencyLinkAbsent':existing or not os.path.lexists(link),'existingDependencyPreserved':existing,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'retainedAllocationBytes':R.allocated_bytes(output),'retainedExternalSources':retainedSources,'gitSourceCopiesCreated':False,'compatibilityException':plan['compatibilityException'],'measuredLocalWorkingSetPeakBytes':scratch.record['peak'],'leftovers':[],'immutablePinsUnchanged':True,'ordinaryBaselineResolved':True,'ordinaryStoreMutation':False,'outerInvocationLog':str(metadata/'invocation.log')};R.atomic_json(metadata/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,1024*R.MIB,1024*R.MIB,cloud,root=scratch.root);reserved=True;output.mkdir(parents=True,mode=0o700);scratch.__enter__();entered=True
  if not existing:
   link.symlink_to(vendor,target_is_directory=True);st=link.lstat();linkIdentity=(st.st_dev,st.st_ino);R.atomic_json(metadata/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':sys.argv[2],'ROOT_RELEASE_PATH':str(grantPath),'PHASE_OUTPUT':str(output)},metadata/'command.log',scratch,policy,768*R.MIB,896*R.MIB,240,host);R.atomic_json(metadata/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped .11 external offline candidate','result':result,'cleanup':read(metadata/'cleanup.json'),'selectionSha256':sha(metadata/'selection.json'),'planSha256':sys.argv[2],'rootReleaseSha256':sha(grantPath),'acceptance':False}
if (output/'candidate-receipt.json').exists():compact.update(receipt=read(output/'candidate-receipt.json'),receiptSha256=sha(output/'candidate-receipt.json'))
R.atomic_json(BASE/'candidate-results.json',compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot11-candidate2-'+sys.argv[2][:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'ordinaryBaselineResolved':True,'excluded':[name for name in plan['unrun'] if name not in ['source shard creation','registered source copies','candidate generation','candidate validation']],'acceptance':False});print((metadata/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
