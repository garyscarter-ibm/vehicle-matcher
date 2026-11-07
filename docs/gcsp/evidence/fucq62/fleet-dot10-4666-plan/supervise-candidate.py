"""Prepared .10 candidate only. Exact finite parent grant required; actual .9 ordinary baseline pinned read-only."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess
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
assert len(sys.argv)==5 and sys.argv[1]=='--reviewed-plan-sha256' and sys.argv[3]=='--root-release';assert sha(BASE/'plan.json')==sys.argv[2];plan=read(BASE/'plan.json');grantPath=pathlib.Path(sys.argv[4]);assert grantPath.is_absolute();grant=read(grantPath);assert str(ROOT)==plan['executionWorktree'];assert grant['authorized'] is True and grant['phase']=='candidate' and grant['planSha256']==sys.argv[2] and grant['version']==plan['version'];assert grant['sourceRegistrationAfterSha256']==plan['sourceRegistrationProposal']['afterSha256'];assert grant['sourceCalls']==0 and grant['ordinaryPublicationExecuted'] is False
identity={str(ROOT/p['path']):p['sha256'] for p in plan['productionCodePins']};identity.update({str(BASE/p['name']):p['sha256'] for p in plan['preparedScripts']});identity[str(BASE/'plan.json')]=sys.argv[2];identity[str(ROOT/plan['sourceRegistrationProposal']['path'])]=plan['sourceRegistrationProposal']['afterSha256'];assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
inputs={p['path']:p['sha256'] for p in [plan['canonical'],plan['spent'],*plan['baseline']['files'],plan['baseline']['candidateReceipt'],plan['baseline']['descriptor'],*plan['baseline']['isolatedHistoryPins'],plan['baseline']['ordinaryActivationReceipt'],*plan['baseline']['ordinaryBaseline']['pins'],*plan['novelRows']['originFilePins'],plan['technicalSupplement']]};inputs[str(grantPath)]=sha(grantPath);assert all(sha(pathlib.Path(p))==h for p,h in inputs.items());check_history_membership(plan)
output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents and not output.exists();metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot10-4666-candidate');assert not metadata.exists(),'Fresh reviewed phase only; preserve prior attempts.'
for s in plan['novelRows']['shards']:assert not os.path.lexists(ROOT/s['registeredSourceRelativePath'])
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
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':768,'chunk_seconds':180,'log_mib':1});scratch=R.Scratch(metadata,ROOT,policy,expected=64*R.MIB,checkpoint=output/'candidate-receipt.json');scratch.root=output/'.scratch'/('test-stamp-shard-'+scratch.token);scratch.record.update(root=str(scratch.root),location='cloud');host=R.HostBudget(policy);command=['/opt/homebrew/bin/node','--max-old-space-size=384',str(BASE/'prepare-candidate.mjs')]
selection={'scope':'scoped .10 offline candidate only, unrun until exact release','changedPaths':[str(BASE),plan['sourceRegistrationProposal']['path'],*[s['registeredSourceRelativePath'] for s in plan['novelRows']['shards']]],'regression':'2242 novel retained admissions in2bounded original-byte shards over byte-preserved .9 with1exact supplement','affectedCallers':['writeCorpusCandidate','validateCorpusDirectory','indexJsonl','registeredCatalogueSources'],'integrationBoundaries':['4669canonical/exact6140spent','all2425priorrecordbytes,VIN/images/supplement','frozenisolatedhistory10versions;actualordinary52files/10versions;2distinctpublicationowners','code-owned128MiB offline tool limit; future production anchor separate'],'command':command,'identity':identity,'inputs':inputs,'limits':plan['limits'],'ordinaryBaseline':plan['baseline']['ordinaryBaseline'],'excluded':[name for name in plan['unrun'] if name not in ['source shard creation','registered source copies','candidate generation','candidate validation']],'checkpoint':str(output/'candidate-receipt.json'),'acceptance':False};R.atomic_json(metadata/'selection.json',selection)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir();existing=os.path.lexists(link);assert not existing or (link.is_dir() and not link.is_symlink())
reserved=entered=finished=False;linkIdentity=None;result={};R.atomic_json(metadata/'ownership.json',{'owner':R.owner(),'runId':'fleet-dot10-4666-candidate','outputRoot':str(output),'retainedCandidateAndSourceShards':True,'expectedRetainedMiB':160,'peakDiskMiB':384,'registeredSources':[{'path':str(ROOT/s['registeredSourceRelativePath']),'sha256':s['sha256'],'retained':True} for s in plan['novelRows']['shards']],'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'ordinaryStoreMutation':False,'state':'planned'})
def finish():
 global reserved,entered,finished,linkIdentity
 if finished:return
 assert G.prove_groups_absent(R,scratch.record['groups'],metadata/'group-queries.json'),'Owned group absence not proved'
 if linkIdentity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==linkIdentity and link.resolve()==vendor;link.unlink();linkIdentity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if scratch.root.parent.exists() and not any(scratch.root.parent.iterdir()):scratch.root.parent.rmdir()
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'Immutable code/input changed';check_history_membership(plan)
 retainedSources=[{'path':str(ROOT/s['registeredSourceRelativePath']),'exists':(ROOT/s['registeredSourceRelativePath']).is_file(),'sha256':sha(ROOT/s['registeredSourceRelativePath']) if (ROOT/s['registeredSourceRelativePath']).is_file() else None} for s in plan['novelRows']['shards']]
 cleanup={'scratch':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'ownedDependencyLinkAbsent':existing or not os.path.lexists(link),'existingDependencyPreserved':existing,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'retainedAllocationBytes':R.allocated_bytes(output),'retainedRegisteredSources':retainedSources,'compatibilityException':None,'leftovers':[],'immutablePinsUnchanged':True,'ordinaryBaselineResolved':True,'ordinaryStoreMutation':False,'outerInvocationLog':str(metadata/'invocation.log')};R.atomic_json(metadata/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,384*R.MIB,768*R.MIB,cloud,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  if not existing:
   link.symlink_to(vendor,target_is_directory=True);st=link.lstat();linkIdentity=(st.st_dev,st.st_ino);R.atomic_json(metadata/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','REVIEWED_PLAN_SHA256':sys.argv[2],'ROOT_RELEASE_PATH':str(grantPath)},metadata/'command.log',scratch,policy,64*R.MIB,672*R.MIB,180,host);R.atomic_json(metadata/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped .10 offline candidate','result':result,'cleanup':read(metadata/'cleanup.json'),'selectionSha256':sha(metadata/'selection.json'),'planSha256':sys.argv[2],'rootReleaseSha256':sha(grantPath),'acceptance':False}
if (output/'candidate-receipt.json').exists():compact.update(receipt=read(output/'candidate-receipt.json'),receiptSha256=sha(output/'candidate-receipt.json'))
R.atomic_json(BASE/'candidate-results.json',compact);R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot10-candidate-'+sys.argv[2][:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'ordinaryBaselineResolved':True,'excluded':[name for name in plan['unrun'] if name not in ['source shard creation','registered source copies','candidate generation','candidate validation']],'acceptance':False});print((metadata/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
