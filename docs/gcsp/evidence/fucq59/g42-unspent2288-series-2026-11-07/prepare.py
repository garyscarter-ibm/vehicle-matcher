"""Freeze only original sessions61..346; no source traffic, no original-phase mutation."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,copy,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
old=ROOT/'docs/gcsp/evidence/fucq59/g42-remaining2768-series-2026-11-07';original=read(old/'series-plan.json');original_manifest=read(old/'candidate-manifest.json')
last=pathlib.Path(original['outputRoot'])/'sessions/session060'
review=pathlib.Path(sys.argv[1]) if len(sys.argv)==2 else pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-session60-parent-review.json')
assert review.is_file(),'exact independent session60 parent review required before freezing'
indexes={}
for key,name in [('canonical','final-canonical-index.json'),('spent','final-spent-request-index.json')]:
    path=last/name;value=read(path);indexes[key]={'path':str(path),'sha256':sha(path),'digest':digest(value),'entries':len(value['entries'])}
assert indexes['canonical']['entries']==2361 and indexes['spent']['entries']==3164
baseline={'canonical':2361,'admittedSource':2358,'spent':3164}
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/g42-unspent-typed-pool-20261107-once');metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-unspent2288')
assert not output.exists() and not (metadata/'ownership/durable-series-continuation.json').exists(),'preserve spent suffix'
(BASE/'templates').mkdir(exist_ok=True);chunks=[]
for number,prior in enumerate(original['chunks'][60:],1):
    entry=copy.deepcopy(prior);entry['originalSession']=prior['number'];entry['number']=number;entry['cohort']=(number-1)//4+1
    path=BASE/'templates'/('session%03d.json'%number);data=(ROOT/prior['templatePath']).read_bytes()
    if path.exists():assert path.read_bytes()==data
    else:path.write_bytes(data)
    entry['templatePath']=str(path.relative_to(ROOT));entry['templateSha256']=sha(path)
    entry['outputDirectory']=str(output/'sessions'/('session%03d'%number));entry['supervisorOutput']=str(metadata/('session%03d'%number));chunks.append(entry)
assert len(chunks)==286 and sum(e['candidates'] for e in chunks)==2288 and sum(e['maximumGets'] for e in chunks)==3432
used={e['requestDigest'] for e in read(last/'final-spent-request-index.json')['entries']};requests=[r for e in chunks for r in e['requestDigests']]
assert len(set(requests))==2288 and not used.intersection(requests)
manifest=copy.deepcopy(original_manifest);manifest.update(schemaVersion='g42-unspent2288-candidate-manifest.v1',id='g42-unspent-typed-pool-20261107-once',baseline=baseline,indexPins=indexes,chunks=chunks,requestDigests=requests,alreadySpentOriginalSessions=list(range(1,61)),parentSession60Review={'path':str(review),'sha256':sha(review)},trafficExecuted=False,capacityCredit=0)
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
series=copy.deepcopy(original);series.update(schemaVersion='g42-unspent2288-series-plan.v1',id=manifest['id'],status='prepared-unspent; separate exact suffix grant required',codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 candidateManifestSha256=sha(BASE/'candidate-manifest.json'),schemeContextGapsSha256=sha(BASE/'scheme-context-gaps.json'),indexPins=indexes,baseline=baseline,baseRefreshRequired=False,
 parentPilotAudit={'path':str(review),'sha256':sha(review),'scope':'independent session60 strict binding and actual two-file event corroboration; original failed check preserved'},
 candidateAllowance=2288,attemptAllowance=3432,decodedBytes=286*4194304,outputRoot=str(output),outputOwnershipManifest=str(metadata/'ownership/durable-series.json'),chunks=chunks,
 originalConsumedPhase={'path':str(old/'series-plan.json'),'sha256':sha(old/'series-plan.json'),'spentOriginalSessions':list(range(1,61)),'retainedFailure':str(old/'interruption-review.json'),'supplementaryActualEvents':str(old/'session060-supplementary-event-union.json'),'originalPhaseRemainsConsumed':True},
 phases={'continuation':{'grantId':'g42-unspent-typed-pool-20261107-once-continuation2288','sessions':list(range(1,287)),'originalSessions':list(range(61,347)),'solverCeiling':2288,'getCeiling':3432,'maximumWallSeconds':3400,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':True}})
series['forecast'].update(seconds=2000,retainedBytes=2300000000,basis='observed first60sessions plus286 exact remaining chunks;4GiB retained cap')
series['resources']['expectedRetainedBytes']=2300000000
own={str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py','.mjs']};own.add(str((BASE/'candidate-manifest.json').relative_to(ROOT)));own.add(str((BASE/'scheme-context-gaps.json').relative_to(ROOT)))
shared={p for p in original['codePins'] if not p.startswith(str(old.relative_to(ROOT))+'/')}
series['codePins']={p:sha(ROOT/p) for p in sorted(shared|own)}
source_paths=set(original['sourcePins'])|{str((old/n).relative_to(ROOT)) for n in ['series-plan.json','candidate-manifest.json','interruption-review.json','session060-supplementary-event-union.json']}
source_paths.update(str(p.relative_to(ROOT)) for p in (old/'session060-event-files').iterdir())
series['sourcePins']={p:sha(ROOT/p) for p in sorted(source_paths)}
series['commandAfterExactParentRelease']=['/usr/bin/python3','-I','-B',str(BASE/'run-series.py'),'continuation']
series['sourceGrantEnvironment']={'G42_UNSPENT2288_PHASE_GRANT':series['phases']['continuation']['grantId']}
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'codePins':len(series['codePins']),'sourcePins':len(series['sourcePins']),'parentReview':series['parentPilotAudit'],'unspentSolver':2288,'maximumGets':3432,'sourceGrant':False}))
