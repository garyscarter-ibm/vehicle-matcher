"""Replace an unreleased prepared base with one exact parent-audited global union. Zero source traffic."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,os
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
assert len(sys.argv)==3,'exact parent audit path and SHA256 required'
auditpath=pathlib.Path(sys.argv[1]).resolve();assert sha(auditpath)==sys.argv[2];audit=read(auditpath)
assert audit['errors']==[]and audit['checks']>0
series=read(BASE/'series-plan.json');manifest=read(BASE/'candidate-manifest.json')
assert series['baseRefreshRequired']is True and series['sourceGrant']is False
assert not os.path.lexists(series['outputRoot'])and not (BASE/'parent-release.json').exists(),'preserve released/spent allocation'
assert not pathlib.Path(series['outputOwnershipManifest']).with_name('durable-series-phase01.json').exists()
assert all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items())
indexes={}
for key,auditkey in [('canonical','canonicalPin'),('spent','spentPin')]:
 pin=audit[auditkey];path=pathlib.Path(pin['path']);assert sha(path)==pin['sha256'];value=read(path)
 indexes[key]={'path':str(path),'sha256':pin['sha256'],'digest':digest(value),'entries':len(value['entries'])}
canonical=read(pathlib.Path(indexes['canonical']['path']));spent=read(pathlib.Path(indexes['spent']['path']))
admitted=sum(any(o['kind']=='admitted-source'for o in row['origins'])for row in canonical['entries'])
assert admitted==audit['admittedSource']and len(canonical['entries'])==audit['canonical']and len(spent['entries'])==audit['spent']
assert admitted>=series['baseline']['admittedSource']and len(spent['entries'])>=series['baseline']['spent']
used={r['requestDigest']for r in spent['entries']};assert len(used)==len(spent['entries'])and not used.intersection(manifest['requestDigests']),'prepared requests now spent; replan unspent exact suffix instead'
required=series['refreshBeforeRelease']['requiredG42Final'];receipt=read(pathlib.Path(required['receipt']))
assert receipt['reason']=='finite-continuation-exhausted'and len(receipt['completedSessions'])==required['completedSessions']and receipt['aggregateSolverRequests']==required['solverRequests'],'original1304final accounting required; interruption needs a separately reviewed exact packet'
g42spent=read(pathlib.Path(required['spent']));byrequest={r['requestDigest']:r for r in spent['entries']}
assert all(byrequest.get(row['requestDigest'])==row for row in g42spent['entries']),'final1304spentprefix absent or changed in parent union'
g42canonical=read(pathlib.Path(required['canonical']));byconfiguration={row['configurationId']:row for row in canonical['entries']}
assert all(row['configurationId']in byconfiguration and all(origin in byconfiguration[row['configurationId']]['origins']for origin in row['origins'])for row in g42canonical['entries']),'final1304canonical origins absent from parent union'
# Preserve the prior prepared evidence. A second refresh or reset is never implicit.
history=BASE/'base-history';assert not history.exists();history.mkdir()
for name in ['series-plan.json','candidate-manifest.json']:(history/name).write_bytes((BASE/name).read_bytes())
baseline={'canonical':len(canonical['entries']),'admittedSource':admitted,'spent':len(spent['entries'])}
manifest.update(indexPins=indexes,baseline=baseline,freshParentAudit={'path':str(auditpath),'sha256':sys.argv[2]})
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
series.update(indexPins=indexes,baseline=baseline,baseRefreshRequired=False,candidateManifestSha256=sha(BASE/'candidate-manifest.json'),parentPilotAudit={'path':str(auditpath),'sha256':sys.argv[2],'scope':'exact independent final-active-source global union before separate phase release'})
series['codePins'][str((BASE/'candidate-manifest.json').relative_to(ROOT))]=sha(BASE/'candidate-manifest.json')
series['refreshBeforeRelease'].update(required=False,auditPath=str(auditpath),auditSha256=sys.argv[2],sourceGrant=False)
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'baseline':baseline,'requestsStillUnspent':960,'sourceGrant':False,'requiresExactParentRelease':True}))
