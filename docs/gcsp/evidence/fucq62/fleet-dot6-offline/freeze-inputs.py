"""Freeze only already admitted actual rows; no source calls or application writes."""
import sys
sys.dont_write_bytecode = True
import hashlib,json,pathlib
BASE=pathlib.Path(__file__).resolve().parent
ROOT=BASE.parents[4]
PRIMARY=pathlib.Path('/Users/usget/Claude/vehicle-matcher')
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,value):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')
actual_path=ROOT/'docs/gcsp/evidence/fucq59/f70-typed-axis1024-series-2026-11-07/actual-series.json'
assert sha(actual_path)=='137d2eb6029058be379e8a8397961ee72c795c0e3a13b61c1d0b2f849d916c2d'
actual=read(actual_path)
store=PRIMARY/'server/data/gcsp/vehicle-evidence/fleet-source.v1'
pointer=read(store/'active.json');digest='7f4396b8fcddf14eb0d7386a47cbc41f58e1385d8ee30a0bda95f292c016e431'
assert pointer['selected']['manifestDigest']==digest
baseline=store/'versions'/digest
manifest=read(baseline/'manifest.json');assert sha(baseline/'manifest.json')==digest
old={json.loads(line)['configurationId'] for line in (baseline/'configurations.jsonl').read_text().splitlines()}
assert len(old)==480 and manifest['counts']['sourceConfigurations']==479
records=[];new=set();inputs=[]
for chunk in actual['chunks']:
 directory=pathlib.Path(chunk['directory']);proof=directory/'live-validation.json';primary=directory/'collector-checkpoint.json'
 assert sha(proof)==chunk['proofSha256'] and sha(primary)==chunk['primarySha256']
 path=directory/'accepted.jsonl';lines=path.read_bytes().splitlines(keepends=True)
 assert len(lines)==chunk['accepted']
 for line in lines:
  assert line.endswith(b'\n');row=json.loads(line)
  assert row['admission'] is True and row['sourceKind']=='dated-snapshot' and row['catalogue']['schemaVersion']=='2'
  assert row['configurationId'] not in old|new;new.add(row['configurationId']);records.append(line)
 inputs.append({'path':str(path),'sha256':sha(path),'bytes':path.stat().st_size,'records':len(lines),'primarySha256':sha(primary),'proofSha256':sha(proof)})
assert len(new)==390
source=ROOT/'server/data/gcsp/vehicle-evidence/registered-sources/f70-typed-axis390-2026-11-07.jsonl'
content=b''.join(records);assert len(content)<=33554432
if source.exists():assert source.read_bytes()==content
else:source.write_bytes(content)
final_path=pathlib.Path(actual['chunks'][-1]['directory'])/'final-canonical-index.json'
index=read(final_path);assert len(index['entries'])==872
extras=[e for e in index['entries'] if e['configurationId'] not in old|new]
assert len(old|new)==870 and len(extras)==2 and all(all(o['kind']=='retained-prior-observation' for o in e['origins']) for e in extras)
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/fleet-dot6-offline-20261107')
assert output.parent.is_dir()
plan={'schemaVersion':'fleet-dot6-offline-plan.v1','version':'2026-11-07.6','scope':'Offline candidate and descriptor inputs through existing F54 publisher; no application publication, upload, traffic or ordinary activation',
 'baseline':{'store':str(store),'directory':str(baseline),'manifestDigest':digest,'files':{str(p):sha(p) for p in [store/'active.json',store/'last-good.json',store/'identity-inventory.json',*[baseline/n for n in ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl']]]}},
 'actualSeries':{'path':str(actual_path),'sha256':sha(actual_path),'all32StrictProofsReused':True,'sourceTraffic':0},
 'sourceInputs':inputs,'registeredSource':{'path':str(source),'origin':source.name,'sha256':sha(source),'bytes':source.stat().st_size,'records':390},
 'novelConfigurationIdsSha256':hashlib.sha256(('\n'.join(sorted(new))+'\n').encode()).hexdigest(),
 'finalCanonicalIndex':{'path':str(final_path),'sha256':sha(final_path),'entries':872,'excludedRetainedPriorObservationIdsSha256':sorted(hashlib.sha256(e['configurationId'].encode()).hexdigest() for e in extras)},
 'expected':{'configurations':870,'distinctConfigurations':870,'images':1,'qualifyingCompleteDistinctSourceConfigurations':869,'sourceConfigurations':869,'vinMappings':1},
 'outputRoot':str(output),'candidateDirectory':str(output/'candidate'),'sourceShardsMaximumBytes':33554432,
 'resources':{'workers':1,'hostRamMiB':512,'childRamMiB':448,'scratchMiB':64,'secondsPerChunk':120,'expectedRetainedMiB':20,'expectedDurationSeconds':40},
 'selectedChecks':['exact actual accepted rows versus published479 source configurations;32 strict proofs reused','existing F54 writeCorpusCandidate and validateCorpusDirectory for870 total/869 source/1 VIN/1 image','old480 configuration lines, VIN/image bytes and ordinary history/file pins unchanged','descriptor inputs pin candidate files, previous .5 descriptor and all10 source shards'],
 'excluded':{'fullSuite':'only admission anchor/evidence changes','all481ApplicationAudit':'unchanged .5 evidence reused; no runtime change','ordinaryActivation':'root owned','publicUpload':'root owned','sourceRequests':'no allocation'}}
write(BASE/'plan.json',plan)
print(json.dumps({'sourceSha256':sha(source),'sourceBytes':source.stat().st_size,'records':390,'planSha256':sha(BASE/'plan.json')}))
