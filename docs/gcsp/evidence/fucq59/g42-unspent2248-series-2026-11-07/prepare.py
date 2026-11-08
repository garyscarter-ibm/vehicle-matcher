"""Freeze only original sessions66..346; no source traffic, no original-phase mutation."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,copy,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
old=ROOT/'docs/gcsp/evidence/fucq59/g42-remaining2768-series-2026-11-07';original=read(old/'series-plan.json');original_manifest=read(old/'candidate-manifest.json')
previous=ROOT/'docs/gcsp/evidence/fucq59/g42-unspent2288-series-2026-11-07'
previous_series=read(previous/'series-plan.json')
last=pathlib.Path(previous_series['outputRoot'])/'sessions/session005'
review=pathlib.Path(sys.argv[1]) if len(sys.argv)==2 else pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-unspent2288-first5-parent-audit.json')
assert review.is_file(),'exact independent session5 parent review required before freezing'
indexes={}
for key,name in [('canonical','final-canonical-index.json'),('spent','final-spent-request-index.json')]:
    path=last/name;value=read(path);indexes[key]={'path':str(path),'sha256':sha(path),'digest':digest(value),'entries':len(value['entries'])}
assert indexes['canonical']['entries']==2395 and indexes['spent']['entries']==3204
baseline={'canonical':2395,'admittedSource':2392,'spent':3204}
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/g42-unspent-typed-pool-2248-20261107-once');metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-unspent2248')
assert not output.exists() and not (metadata/'ownership/durable-series-continuation.json').exists(),'preserve spent suffix'
(BASE/'templates').mkdir(exist_ok=True);chunks=[]
for number,prior in enumerate(original['chunks'][65:],1):
    entry=copy.deepcopy(prior);entry['originalSession']=prior['number'];entry['number']=number;entry['cohort']=(number-1)//4+1
    path=BASE/'templates'/('session%03d.json'%number);data=(ROOT/prior['templatePath']).read_bytes()
    if path.exists():assert path.read_bytes()==data
    else:path.write_bytes(data)
    entry['templatePath']=str(path.relative_to(ROOT));entry['templateSha256']=sha(path)
    entry['outputDirectory']=str(output/'sessions'/('session%03d'%number));entry['supervisorOutput']=str(metadata/('session%03d'%number));chunks.append(entry)
assert len(chunks)==281 and sum(e['candidates'] for e in chunks)==2248 and sum(e['maximumGets'] for e in chunks)==3372
used={e['requestDigest'] for e in read(last/'final-spent-request-index.json')['entries']};requests=[r for e in chunks for r in e['requestDigests']]
assert len(set(requests))==2248 and not used.intersection(requests)
manifest=copy.deepcopy(original_manifest);manifest.update(schemaVersion='g42-unspent2248-candidate-manifest.v1',id='g42-unspent-typed-pool-2248-20261107-once',baseline=baseline,indexPins=indexes,chunks=chunks,requestDigests=requests,alreadySpentOriginalSessions=list(range(1,66)),parentSession5Review={'path':str(review),'sha256':sha(review)},trafficExecuted=False,capacityCredit=0)
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
series=copy.deepcopy(original);series.update(schemaVersion='g42-unspent2248-series-plan.v1',id=manifest['id'],status='prepared-unspent; separate exact suffix grant required',codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 candidateManifestSha256=sha(BASE/'candidate-manifest.json'),schemeContextGapsSha256=sha(BASE/'scheme-context-gaps.json'),indexPins=indexes,baseline=baseline,baseRefreshRequired=False,
 parentPilotAudit={'path':str(review),'sha256':sha(review),'scope':'independent five-session base strict binding and actual source/proof/cleanup; original supervisor cleanup assertion preserved'},
 candidateAllowance=2248,attemptAllowance=3372,decodedBytes=281*4194304,outputRoot=str(output),outputOwnershipManifest=str(metadata/'ownership/durable-series.json'),chunks=chunks,
 originalConsumedPhase={'path':str(previous/'series-plan.json'),'sha256':sha(previous/'series-plan.json'),'spentOriginalSessions':list(range(1,66)),'retainedFailure':str(previous/'interruption-review.json'),'originalPhaseRemainsConsumed':True},
 phases={'continuation':{'grantId':'g42-unspent-typed-pool-2248-20261107-once-continuation2248','sessions':list(range(1,282)),'originalSessions':list(range(66,347)),'solverCeiling':2248,'getCeiling':3372,'maximumWallSeconds':3400,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':True}})
series['forecast'].update(seconds=1950,retainedBytes=2300000000,basis='observed first65sessions plus281 exact remaining chunks;4GiB retained cap')
series['resources']['expectedRetainedBytes']=2300000000
own={str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py','.mjs']};own.add(str((BASE/'candidate-manifest.json').relative_to(ROOT)));own.add(str((BASE/'scheme-context-gaps.json').relative_to(ROOT)))
shared={p for p in original['codePins'] if not p.startswith(str(old.relative_to(ROOT))+'/')}
series['codePins']={p:sha(ROOT/p) for p in sorted(shared|own)}
source_paths=set(original['sourcePins'])|{str((old/n).relative_to(ROOT)) for n in ['series-plan.json','candidate-manifest.json','interruption-review.json','session060-supplementary-event-union.json']}
source_paths.update(str(p.relative_to(ROOT)) for p in (old/'session060-event-files').iterdir())
source_paths.update(str((previous/n).relative_to(ROOT)) for n in ['series-plan.json','candidate-manifest.json','interruption-review.json','interruption-error.txt'])
series['sourcePins']={p:sha(ROOT/p) for p in sorted(source_paths)}
series['commandAfterExactParentRelease']=['/usr/bin/python3','-I','-B',str(BASE/'run-series.py'),'continuation']
series['sourceGrantEnvironment']={'G42_UNSPENT2248_PHASE_GRANT':series['phases']['continuation']['grantId']}
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'codePins':len(series['codePins']),'sourcePins':len(series['sourcePins']),'parentReview':series['parentPilotAudit'],'unspentSolver':2248,'maximumGets':3372,'sourceGrant':False}))
