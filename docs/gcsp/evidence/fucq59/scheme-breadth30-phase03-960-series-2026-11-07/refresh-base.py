"""One unreleased base refresh from exact parent actual-prefix evidence. Zero source/test replay."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,os
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
assert len(sys.argv)==3,'exact parent audit path andSHA required'
auditpath=pathlib.Path(sys.argv[1]).resolve();assert sha(auditpath)==sys.argv[2];audit=read(auditpath);assert audit['errors']==[]and audit['checks']>0
series=read(BASE/'series-plan.json');manifest=read(BASE/'candidate-manifest.json')
assert series['baseRefreshRequired']is True and series['sourceGrant']is False
assert not os.path.lexists(series['outputRoot'])and not(BASE/'parent-release.json').exists(),'Preserve released/spent allocation'
assert not pathlib.Path(series['outputOwnershipManifest']).with_name('durable-series-phase03.json').exists()
assert all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items())
indexes={}
for key,auditkey in[('canonical','canonicalPin'),('spent','spentPin')]:
 pin=audit[auditkey];assert sha(pin['path'])==pin['sha256'];value=read(pin['path']);indexes[key]={**pin,'digest':digest(value),'entries':len(value['entries'])}
canonical=read(indexes['canonical']['path']);spent=read(indexes['spent']['path']);admitted=sum(any(o['kind']=='admitted-source'for o in r['origins'])for r in canonical['entries'])
assert admitted==audit['admittedSource']and len(canonical['entries'])==audit['canonical']and len(spent['entries'])==audit['spent']
assert admitted>=series['baseline']['admittedSource']and len(spent['entries'])>=series['baseline']['spent']
used={r['requestDigest']for r in spent['entries']};assert len(used)==len(spent['entries'])and not used.intersection(manifest['requestDigests'])
receiptpath=pathlib.Path(series['refreshBeforeRelease']['currentPhase02cReceipt']);receipt=read(receiptpath);completed=receipt['completedSessions'];assert completed,'Actual current strict prefix required, never full-phase completion'
last=receiptpath.parent/'sessions'/('session%03d'%completed[-1]['session']);proof=read(last/'live-validation.json');assert proof['retainedChecks']['summary']['tests']==proof['retainedChecks']['summary']['pass']==5
assert sha(last/'final-canonical-index.json')==proof['finalCanonicalIndexSha256']and sha(last/'final-spent-request-index.json')==proof['finalSpentRequestIndexSha256']
byconfiguration={r['configurationId']:r for r in canonical['entries']};byrequest={r['requestDigest']:r for r in spent['entries']}
for row in read(last/'final-canonical-index.json')['entries']:assert row['configurationId']in byconfiguration and all(o in byconfiguration[row['configurationId']]['origins']for o in row['origins'])
for row in read(last/'final-spent-request-index.json')['entries']:assert byrequest.get(row['requestDigest'])==row
history=BASE/'base-history';assert not history.exists();history.mkdir()
for name in['series-plan.json','candidate-manifest.json']:(history/name).write_bytes((BASE/name).read_bytes())
baseline={'canonical':len(canonical['entries']),'admittedSource':admitted,'spent':len(spent['entries'])};manifest.update(indexPins=indexes,baseline=baseline,freshParentAudit={'path':str(auditpath),'sha256':sys.argv[2]})
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
series.update(indexPins=indexes,baseline=baseline,baseRefreshRequired=False,candidateManifestSha256=sha(BASE/'candidate-manifest.json'),parentPilotAudit={'path':str(auditpath),'sha256':sys.argv[2],'scope':'exact independent actual source-prefix union; full prior phase completion is not a BUILD gate'})
series['codePins'][str((BASE/'candidate-manifest.json').relative_to(ROOT))]=sha(BASE/'candidate-manifest.json')
series['refreshBeforeRelease'].update(required=False,auditPath=str(auditpath),auditSha256=sys.argv[2],actualPrefixReceiptSha256=sha(receiptpath),actualStrictPrefixSessions=len(completed),sourceGrant=False)
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'baseline':baseline,'requestsStillUnspent':960,'sourceGrant':False,'requiresExactParentRelease':True}))
