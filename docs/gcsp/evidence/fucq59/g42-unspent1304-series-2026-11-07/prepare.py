"""Freeze original184..346 only, preserving the consumed118-session suffix and its failed proof."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,copy,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
old=ROOT/'docs/gcsp/evidence/fucq59/g42-remaining2768-series-2026-11-07';original=read(old/'series-plan.json');original_manifest=read(old/'candidate-manifest.json')
previous=ROOT/'docs/gcsp/evidence/fucq59/g42-unspent2248-series-2026-11-07';previous_series=read(previous/'series-plan.json');last=pathlib.Path(previous_series['outputRoot'])/'sessions/session118'
review=pathlib.Path(sys.argv[1]) if len(sys.argv)==2 else pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-unspent2248-first118-parent-audit.json')
assert review.is_file(),'exact independent118actual parent review required before freezing'
indexes={}
for key,name in [('canonical','final-canonical-index.json'),('spent','final-spent-request-index.json')]:
 path=last/name;value=read(path);indexes[key]={'path':str(path),'sha256':sha(path),'digest':digest(value),'entries':len(value['entries'])}
assert indexes['canonical']['entries']==3171 and indexes['spent']['entries']==4148
assert sum(any(o['kind']=='admitted-source' for o in r['origins']) for r in read(last/'final-canonical-index.json')['entries'])==3168
baseline={'canonical':3171,'admittedSource':3168,'spent':4148}
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/g42-unspent-typed-pool-1304-20261107-once');metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-unspent1304')
assert not output.exists() and not (metadata/'ownership/durable-series-continuation.json').exists(),'preserve spent suffix'
(BASE/'templates').mkdir(exist_ok=True);chunks=[]
for number,prior in enumerate(original['chunks'][183:],1):
 entry=copy.deepcopy(prior);entry['originalSession']=prior['number'];entry['number']=number;entry['cohort']=(number-1)//4+1
 path=BASE/'templates'/('session%03d.json'%number);data=(ROOT/prior['templatePath']).read_bytes()
 if path.exists():assert path.read_bytes()==data
 else:path.write_bytes(data)
 entry['templatePath']=str(path.relative_to(ROOT));entry['templateSha256']=sha(path);entry['outputDirectory']=str(output/'sessions'/('session%03d'%number));entry['supervisorOutput']=str(metadata/('session%03d'%number));chunks.append(entry)
assert len(chunks)==163 and sum(e['candidates'] for e in chunks)==1304 and sum(e['maximumGets'] for e in chunks)==1956
used={e['requestDigest'] for e in read(last/'final-spent-request-index.json')['entries']};requests=[r for e in chunks for r in e['requestDigests']];assert len(set(requests))==1304 and not used.intersection(requests)
manifest=copy.deepcopy(original_manifest);manifest.update(schemaVersion='g42-unspent1304-candidate-manifest.v1',id='g42-unspent-typed-pool-1304-20261107-once',baseline=baseline,indexPins=indexes,chunks=chunks,requestDigests=requests,alreadySpentOriginalSessions=list(range(1,184)),parentSession118Review={'path':str(review),'sha256':sha(review)},trafficExecuted=False,capacityCredit=0)
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
series=copy.deepcopy(original);series.update(schemaVersion='g42-unspent1304-series-plan.v1',id=manifest['id'],status='prepared-unspent; separate exact suffix grant required',codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),candidateManifestSha256=sha(BASE/'candidate-manifest.json'),schemeContextGapsSha256=sha(BASE/'scheme-context-gaps.json'),indexPins=indexes,baseline=baseline,baseRefreshRequired=False,parentPilotAudit={'path':str(review),'sha256':sha(review),'scope':'independent118actual spent/index audit with117strict5/5 and118original4/5 plus exactactualeventunion; original failure preserved'},candidateAllowance=1304,attemptAllowance=1956,decodedBytes=163*4194304,outputRoot=str(output),outputOwnershipManifest=str(metadata/'ownership/durable-series.json'),chunks=chunks,originalConsumedPhase={'path':str(previous/'series-plan.json'),'sha256':sha(previous/'series-plan.json'),'spentOriginalSessions':list(range(1,184)),'retainedFailure':str(previous/'interruption-review.json'),'supplementaryActualEventUnion':str(previous/'session118-supplementary-event-union.json'),'originalPhaseRemainsConsumed':True},phases={'continuation':{'grantId':'g42-unspent-typed-pool-1304-20261107-once-continuation1304','sessions':list(range(1,164)),'originalSessions':list(range(184,347)),'solverCeiling':1304,'getCeiling':1956,'maximumWallSeconds':2200,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':True}})
series['forecast'].update(seconds=1200,retainedBytes=1500000000,basis='observed first183originalsessions plus163exactremainingchunks;4GiBcap; cumulative indexes grow')
series['resources']['expectedRetainedBytes']=1500000000
own={str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py','.mjs']};own.update(str((BASE/n).relative_to(ROOT)) for n in ['candidate-manifest.json','scheme-context-gaps.json'])
shared={p for p in original['codePins'] if not p.startswith(str(old.relative_to(ROOT))+'/')};series['codePins']={p:sha(ROOT/p) for p in sorted(shared|own)}
source_paths=set(previous_series['sourcePins']);source_paths.update(str((previous/n).relative_to(ROOT)) for n in ['series-plan.json','candidate-manifest.json','interruption-review.json','session118-supplementary-event-union.json'])
series['sourcePins']={p:sha(ROOT/p) for p in sorted(source_paths)}
series['commandAfterExactParentRelease']=['/usr/bin/python3','-I','-B',str(BASE/'run-series.py'),'continuation'];series['sourceGrantEnvironment']={'G42_UNSPENT1304_PHASE_GRANT':series['phases']['continuation']['grantId']}
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'codePins':len(series['codePins']),'sourcePins':len(series['sourcePins']),'parentReview':series['parentPilotAudit'],'unspentSolver':1304,'maximumGets':1956,'sourceGrant':False}))
