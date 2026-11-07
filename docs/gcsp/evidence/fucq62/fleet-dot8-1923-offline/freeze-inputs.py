"""Freeze actual, already validated 790 source admissions; no source or ordinary writes."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,pathlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
PRIMARY=pathlib.Path('/Users/usget/Claude/vehicle-matcher')
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
store=PRIMARY/'server/data/gcsp/vehicle-evidence/fleet-source.v1';digest='86ec3769dd55631007974869264f6d8a25671d9cf041f715e107b1435c297f4f'
assert read(store/'active.json')['selected']['manifestDigest']==digest
baseline=store/'versions'/digest;assert sha(baseline/'manifest.json')==digest
old={json.loads(line)['configurationId'] for line in (baseline/'configurations.jsonl').read_text().splitlines()};assert len(old)==1134
model=ROOT/'docs/gcsp/evidence/fucq59/f70-model-axis790-plan-2026-11-07'
pilot=read(model/'actual-pilot/actual-pilot.json');suffix=read(model/'actual-suffix/actual-suffix.json')
auditPath=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/model-axis758-parent-audit.json')
assert sha(auditPath)=='0ea5e936f9a8a497eff1207488ad6bbe2800f5da03305c01fe9e6843e1a0b16d'
audit=read(auditPath);assert audit['verdict']=='passed' and not audit['failures']
series=pilot['actual']['completedSessions']+suffix['actual']['completedSessions'];assert len(series)==101
sourceRoot=pathlib.Path(audit['sourceRoot'])
records=[];new=set();inputs=[];line_pins=[]
def append(path,primary,proof,count,expected_primary,expected_proof):
 assert sha(primary)==expected_primary and sha(proof)==expected_proof
 lines=path.read_bytes().splitlines(keepends=True);assert len(lines)==count
 for n,line in enumerate(lines,1):
  assert line.endswith(b'\n');row=json.loads(line);assert row['admission'] is True and row['sourceKind']=='dated-snapshot' and row['catalogue']['schemaVersion']=='2'
  assert row['configurationId'] not in old|new;new.add(row['configurationId']);records.append(line)
  line_pins.append({'path':str(path),'line':n,'sha256':hashlib.sha256(line).hexdigest(),'configurationIdSha256':hashlib.sha256(row['configurationId'].encode()).hexdigest()})
 inputs.append({'path':str(path),'sha256':sha(path),'bytes':path.stat().st_size,'records':count,'primary':str(primary),'primarySha256':sha(primary),'proof':str(proof),'proofSha256':sha(proof)})
for session in series:
 p=sourceRoot/'sessions'/('session%03d'%session['session'])
 append(p/'accepted.jsonl',p/'collector-checkpoint.json',p/'live-validation.json',session['accepted'],session['primarySha256'],session['proofSha256'])
assert len(new)==790
source=ROOT/'server/data/gcsp/vehicle-evidence/registered-sources/f70-model-axis790-2026-11-07.jsonl';content=b''.join(records);assert len(content)<33554432
if source.exists():assert source.read_bytes()==content
else:source.write_bytes(content)
final=model/'actual-suffix/final-canonical-index.json';index=read(final);assert sha(final)==audit['finalPins']['canonicalSha256'] and len(index['entries'])==1926
spent=model/'actual-suffix/final-spent-request-index.json';assert sha(spent)==audit['finalPins']['spentSha256']
extras=[e for e in index['entries'] if e['configurationId'] not in old|new];assert len(extras)==2 and all(all(o['kind']=='retained-prior-observation' for o in e['origins']) for e in extras)
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/fleet-dot8-1923-20261107');assert output.parent.is_dir()
plan={'schemaVersion':'fleet-dot8-offline-plan.v1','runId':'f62-dot8-offline-20261107','version':'2026-11-07.8','tag':'fleet-2026-11-07-8','scope':'Offline existing F54 candidate/registry/release/pack; no public release, ordinary activation, Render/CI or source traffic',
'baseline':{'store':str(store),'directory':str(baseline),'manifestDigest':digest,'files':{str(p):sha(p) for p in [store/'active.json',store/'last-good.json',store/'identity-inventory.json',*[baseline/n for n in ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl']]]}},
'actualSeries':[{'path':str(p),'sha256':sha(p)} for p in [model/'actual-pilot/actual-pilot.json',model/'actual-suffix/actual-suffix.json',auditPath]],
'sourceInputs':inputs,'originalAcceptedLinePins':line_pins,'registeredSource':{'path':str(source),'origin':source.name,'sha256':sha(source),'bytes':source.stat().st_size,'records':790},
'novelConfigurationIdsSha256':hashlib.sha256(('\n'.join(sorted(new))+'\n').encode()).hexdigest(),
'finalCanonicalIndex':{'path':str(final),'sha256':sha(final),'entries':1926,'admittedSource':1923,'spent':2636,'excludedRetainedPriorObservationIdsSha256':sorted(hashlib.sha256(e['configurationId'].encode()).hexdigest() for e in extras)},
'expected':{'configurations':1924,'distinctConfigurations':1924,'images':2,'qualifyingCompleteDistinctSourceConfigurations':1923,'sourceConfigurations':1923,'vinMappings':1},
'outputRoot':str(output),'candidateDirectory':str(output/'candidate'),'resources':{'workers':1,'hostRamMiB':640,'childRamMiB':576,'scratchMiB':192,'secondsPerChunk':600,'expectedRetainedMiB':512,'expectedPeakAggregateMiB':704,'expectedDurationSeconds':100},
'selected':['freeze790 original accepted-line/primary/proof hashes; reuse strict actual validation','existing F54 writer:1924total/1923source/1VIN/2images; preserve1134lines and oldVIN/image/history bytes','existing isolated registry publish/idempotent/restart; existing fleet-release.v1 descriptor and pack','all1135direct+HTTP and offline recovery in bounded separately supervised chunks'],
'excluded':['full npm suite: unchanged engine boundaries69+11 reused','BMW/source traffic, provider calls, public downloads/uploads, ordinary publication','Render/CI/YAML anchors and old .6 release/tag','technical-fact mutation: four facts remain existing retained enrichment output; immutable catalogue unchanged','new UI layout: existing representative image presentation preserved']}
(BASE/'plan.json').write_text(json.dumps(plan,sort_keys=True,indent=2)+'\n');print(json.dumps({'records':len(new),'sourceSha256':sha(source),'sourceBytes':len(content),'planSha256':sha(BASE/'plan.json')}))
