"""Read-only frozen-input reconciliation. Writes finite metadata only; no candidate/source copy."""
import sys
sys.dont_write_bytecode=True
import collections,hashlib,json,pathlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4];REPO=pathlib.Path('/Users/usget/Claude/vehicle-matcher');CLOUD=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output');UNION=CLOUD/'global-union8051-20261107';PREVIOUS=CLOUD/'fleet-dot10-4666-20261107';OLD=ROOT/'docs/gcsp/evidence/fucq62/fleet-dot10-4666-plan/plan.json'
def sha(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def pin(p):
 p=pathlib.Path(p);return {'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)}
def tree(p):return [pin(f)|{'relativePath':str(f.relative_to(p))} for f in sorted(p.rglob('*')) if f.is_file()]
canonical=UNION/'final-canonical-index.json';spent=UNION/'final-spent-request-index.json';assert sha(canonical)=='27f64e520748836f9f88db39f15725e78daa535db9f253e1ae7b9772ad1f2991';assert sha(spent)=='6470ae663fe4d1275c600aff6264f58c58730530b53d847b2ed7053c0b8b1b13'
audit=REPO/'.claude/f58-63-overnight-20261106/f58/global-union8051-parent-audit.json';a=json.loads(audit.read_text());assert a['status']=='parent-proved' and a['errors']==[] and a['admittedSource']==8051 and a['sourceRequestsDuringAudit']==0
index=json.loads(canonical.read_text());assert len(index['entries'])==8054;assert len({e['configurationId'] for e in index['entries']})==8054;assert sum(any(o['kind']=='admitted-source' for o in e['origins']) for e in index['entries'])==8051;assert len(json.loads(spent.read_text())['entries'])==10543
baseline=PREVIOUS/'candidate';assert sha(baseline/'manifest.json')=='0bfe3139491826c5605c0a22918ec58c687b7922bd00650d9dddeaf40860399a';oldIds={json.loads(line)['configurationId'] for line in (baseline/'configurations.jsonl').open()};assert len(oldIds)==4667;assert oldIds<={e['configurationId'] for e in index['entries']}
novel={e['configurationId']:e for e in index['entries'] if e['configurationId'] not in oldIds and any(o['kind']=='admitted-source' for o in e['origins'])};excluded=[e for e in index['entries'] if e['configurationId'] not in oldIds and e['configurationId'] not in novel];assert len(novel)==3385 and len(excluded)==2
selected=collections.defaultdict(set)
for identity,entry in novel.items():
 origins=[o for o in entry['origins'] if o['kind']=='admitted-source'];assert len(origins)==1;p=pathlib.Path(origins[0]['path']);p=p if p.is_absolute() else REPO/p;selected[p].add(identity)
locations={};originPins=[]
for path,ids in sorted(selected.items()):
 h=hashlib.sha256();offset=0;found=set()
 with path.open('rb') as f:
  for number,line in enumerate(f,1):
   h.update(line);row=json.loads(line);identity=row.get('configurationId')
   if identity in ids:
    assert row.get('admission') is True and identity not in locations and line.endswith(b'\n');locations[identity]={'path':str(path),'line':number,'offset':offset,'bytes':len(line),'sha256':hashlib.sha256(line).hexdigest(),'configurationIdSha256':hashlib.sha256(identity.encode()).hexdigest()};found.add(identity)
   offset+=len(line)
 assert found==ids;originPins.append({'path':str(path),'bytes':offset,'sha256':h.hexdigest()})
assert len(locations)==3385
shards=[];current=[];size=0
for identity in sorted(locations):
 p=locations[identity]
 if current and size+p['bytes']>33554432:shards.append(current);current=[];size=0
 current.append(identity);size+=p['bytes']
if current:shards.append(current)
shardPins=[];combined=hashlib.sha256()
for i,ids in enumerate(shards,1):
 h=hashlib.sha256();size=0
 for identity in ids:
  p=locations[identity]
  with pathlib.Path(p['path']).open('rb') as f:f.seek(p['offset']);line=f.read(p['bytes'])
  assert hashlib.sha256(line).hexdigest()==p['sha256'];h.update(line);combined.update(line);size+=len(line);p['shard']=i
 origin=f'global-union3385-part{i:02d}-2026-11-07-11.jsonl';shardPins.append({'number':i,'origin':origin,'rows':len(ids),'bytes':size,'sha256':h.hexdigest(),'maxBytes':33554432,'configurationIdSetSha256':hashlib.sha256(('\n'.join(ids)+'\n').encode()).hexdigest(),'creationNotExecuted':True,'gitCopyPlanned':False})
ordinary=REPO/'server/data/gcsp/vehicle-evidence/fleet-source.v1';ordinaryPins=tree(ordinary);assert len(ordinaryPins)==52 and len(list((ordinary/'versions').iterdir()))==10;assert json.loads((ordinary/'active.json').read_text())['selected']['manifestDigest']=='28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884'
rollback=REPO/'.claude/f58-63-overnight-20261106/f62/dot10-external-build-ordinary-rollback.json';assert rollback.is_file()
history=PREVIOUS/'isolated-store';historyPins=tree(history);assert len(historyPins)==57 and len(list((history/'versions').iterdir()))==11
ordinaryReceipt=PREVIOUS/'followthrough/ordinary/receipt.json';assert sha(ordinaryReceipt)=='ab60798c7b826ae7a40c30a652ac933e0dba479c9f43fe42b8b38cd198b34615'
descriptor=ROOT/'docs/gcsp/evidence/fucq62/fleet-dot10-4666-release-plan/descriptor-proposal.json';d=json.loads(descriptor.read_text());assert d['releaseId']==sha(baseline/'manifest.json');sources=[]
for asset in d['assets']:
 if asset['role']=='source':
  path=REPO/'server/data/gcsp/vehicle-evidence/registered-sources'/asset['origin'];p=pin(path);assert p['sha256']==asset['sha256'] and p['bytes']==asset['bytes'];sources.append(p|{'origin':asset['origin']})
assert len(sources)==15
prod={}
for directory in ['server/gcsp','server/vehicle-evidence']:
 for p in sorted((ROOT/directory).rglob('*')):
  if p.is_file() and p.suffix in ['.js','.json','.sql']:prod[str(p.relative_to(ROOT))]=sha(p)
for name in ['server/index.js','scripts/gcsp/fleet-offline-guard.mjs','scripts/gcsp/verify-fleet.mjs','server/scripts/fleet-artifacts.mjs','_tools/test_resources.py']:prod[name]=sha(ROOT/name)
for p in sorted(BASE.iterdir()):
 if p.suffix in ['.py','.mjs']:prod[str(p.relative_to(ROOT))]=sha(p)
ordinaryBaseline={'root':str(ordinary),'manifestDigest':'28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884','pins':ordinaryPins,'fileCount':52,'versionCount':10,'versionDirectories':sorted(p.name for p in (ordinary/'versions').iterdir()),'treeSha256':hashlib.sha256(json.dumps([[p['relativePath'],p['bytes'],p['sha256']] for p in ordinaryPins],separators=(',',':')).encode()).hexdigest(),'ownership':'Read-only actual ordinary store. Preserve all files and publication-owner labels; never disposable.'}
plan={'schemaVersion':'fleet-external-additive-candidate-plan.v1','status':'prepared-unexecuted-exact-parent-grant-required','version':'2026-11-07.11','tag':'fleet-2026-11-07-11','executionWorktree':str(ROOT),'canonical':pin(canonical),'spent':pin(spent),'parentAudit':pin(audit),'artifactBoundary':pin(BASE/'artifact-boundary.json'),'ordinaryRollbackReceipt':pin(rollback),'sourceRequests':0,'publicNetworkRequests':0,'nativeDatabaseRequests':0,'baseline':{'manifestDigest':sha(baseline/'manifest.json'),'candidateDirectory':str(baseline),'files':[pin(baseline/name)|{'name':name} for name in ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl']],'candidateReceipt':pin(PREVIOUS/'candidate-receipt.json'),'descriptor':pin(descriptor),'isolatedHistoryStore':str(history),'isolatedHistoryPins':historyPins,'isolatedHistoryVersions':11,'unchangedConfigurations':4667,'ordinaryActivationReceipt':pin(ordinaryReceipt),'ordinaryBaseline':ordinaryBaseline},'novelRows':{'count':3385,'idSetSha256':hashlib.sha256(('\n'.join(sorted(locations))+'\n').encode()).hexdigest(),'originalLinePins':[locations[k] for k in sorted(locations)],'originFilePins':originPins,'combinedOriginalBytes':sum(p['bytes'] for p in locations.values()),'combinedOriginalBytesSha256':combined.hexdigest(),'shards':shardPins,'shardCount':len(shardPins)},'priorSources':sources,'excludedPriorObservations':[{'configurationIdSha256':hashlib.sha256(e['configurationId'].encode()).hexdigest(),'origins':e['origins']} for e in excluded],'technicalSupplement':json.loads(OLD.read_text())['technicalSupplement'],'codePins':prod,'expected':{'configurations':8052,'distinctConfigurations':8052,'sourceConfigurations':8051,'qualifyingCompleteDistinctSourceConfigurations':8051,'vinMappings':1,'images':2,'technicalSupplementAssociations':1,'novelConfigurations':3385,'references':8053,'strictV2SourceRegistrations':8050,'httpChunks':[1024]*7+[885]},'outputRoot':str(CLOUD/'fleet-dot11-8051-20261107'),'metadataRoot':str(REPO/'.claude/f58-63-overnight-20261106/f62/fleet-dot11-8051-candidate'),'limits':{'workers':1,'nodeHeapMiB':512,'hostRamMiB':1024,'processGroupRamMiB':896,'cloudScratchMiB':128,'chunkSeconds':240,'diskReservationMiB':768,'expectedCandidateRetainedMiB':256,'maximumCandidatePeakMiB':768,'sourceShardMaxBytes':33554432,'candidateJsonlMaxBytes':268435456,'maxRowBytes':1048576,'maxRows':100000,'location':'All candidate/staging/source shards directly OneDrive; zero Git source/configuration copies'},'knownFailures':{'dot10ConsumerFailed':1313,'candidateConsumerFailures':None,'acceptanceWaiver':False},'unrun':['source shard creation','candidate generation and validation','all8053 direct/consumer/HTTP actual new-corpus proof in8chunks','isolated additive publication and restart','exact descriptor build/registration','pack/localcheck/publicupload/check','coldrestore/offlineproofreuse/recovery','ordinary additive publication preserving52files/10versions plus external .10 baseline/history','CI/Render/live','nativeDB','fullsuite'],'acceptance':False}
(BASE/'plan.json').write_text(json.dumps(plan,indent=2)+'\n');(BASE/'parent-release.example.json').write_text(json.dumps({'authorized':False,'phase':'candidate','planSha256':sha(BASE/'plan.json'),'version':plan['version'],'codePins':prod,'sourceCalls':0,'ordinaryPublicationExecuted':False,'externalOnly':True},indent=2)+'\n')
print(json.dumps({'planSha256':sha(BASE/'plan.json'),'novelRows':3385,'originFiles':len(originPins),'shards':shardPins,'combinedBytes':plan['novelRows']['combinedOriginalBytes'],'codePins':len(prod),'ordinaryFiles':52,'ordinaryVersions':10,'executed':False}))
