"""Freeze only the original unspent sessions240–693. No HTTP or traffic grant."""
import sys
sys.dont_write_bytecode = True
import copy,datetime,hashlib,json,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent; ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text()); sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def put(p,v):
    with p.open('x') as f:f.write(json.dumps(v,indent=2)+'\n')
assert not (BASE/'series-plan.json').exists()
old_base=ROOT/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix5535-2026-11-07'; old=read(old_base/'series-plan.json'); previous=pathlib.Path(old['outputRoot'])
stopped=read(previous/'stopped-prefix-validation.json'); assert stopped['reconciledSessions']==239 and stopped['actualSource']['solver']==1912 and stopped['actualSource']['gets']==2868
assert stopped['strictChecks']['tests']==stopped['strictChecks']['pass']==1195 and stopped['strictChecks']['fail']==stopped['strictChecks']['skipped']==0
assert stopped['originalSeriesExit']==1 and stopped['originalsUnchanged'] and stopped['sourceTrafficDuringReconciliation']==0
assert all(stopped['cleanup'][k] for k in ['allChildrenJoined','allOwnedRootsAbsent','allOwnedTokensAbsent','allOwnedGroupsExplicitlyAbsent','dependencyLinkAbsent','seriesReservationAbsent'])
identifier='f70-optional-axis-suffix3623-20261107-once'; output=previous.parent/identifier; supervisor=ROOT/'.claude/f58-63-overnight-20261106/f58/f70-optional-axis-suffix3623'
assert not output.exists() and not (BASE/'parent-release.json').exists()
chunks=copy.deepcopy(old['chunks'][239:]); assert len(chunks)==454
for number,entry in enumerate(chunks,1):
    original_number=entry['number']; original_cohort=entry['cohort']; entry.update(number=number,originalSuffixNumber=original_number,originalCohort=original_cohort,cohort=(number-1)//4+1)
    entry.update(outputDirectory=str(output/'sessions'/('session%03d'%number)),supervisorOutput=str(supervisor/('session%03d'%number)))
assert sum(e['candidates'] for e in chunks)==3623 and sum(e['maximumGets'] for e in chunks)==5439
index_pins={}
for name,filename in [('canonical','final-canonical-index.json'),('spent','final-spent-request-index.json')]:
    p=previous/'sessions/session239'/filename; value=read(p); index_pins[name]={'path':str(p),'sha256':sha(p),'digest':digest(value),'entries':len(value['entries'])}
proof=previous/'session239-reconciled-validation.json'; baseline=stopped['localCumulative']; assert baseline=={'admittedSource':3817,'canonical':3820,'spent':5100}
paths=[p for p in old['codePins'] if not p.startswith('docs/gcsp/evidence/fucq59/f70-optional-axis-suffix5535-2026-11-07/')]
paths += [str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py','.mjs'] or p.name=='README.md']
code_pins={p:sha(ROOT/p) for p in sorted(set(paths))}; source_pins=dict(old['sourcePins'])
for p in [old_base/'series-plan.json',previous/'suffix-once.json',previous/'suffix-receipt.json',previous/'suffix-cleanup.json',previous/'suffix-process-ownership.json',previous/'stopped-prefix-validation.json',proof,previous/'sessions/session239/collector-checkpoint.json',previous/'sessions/session239/receipt.json',previous/'sessions/session239/final-canonical-index.json',previous/'sessions/session239/final-spent-request-index.json',previous/'session239-retained-result.json',previous/'session239-retained-cleanup.json']:
    source_pins[str(p.relative_to(ROOT)) if ROOT in p.parents else str(p)]=sha(p)
marker=read(previous/'suffix-once.json'); started=datetime.datetime.fromisoformat(marker['reservedAt']); deadline=started+datetime.timedelta(seconds=old['phases']['suffix']['maximumWallSeconds'])
original_phase={'allocationId':old['id'],'markerPath':str(previous/'suffix-once.json'),'markerSha256':sha(previous/'suffix-once.json'),'reservedAt':marker['reservedAt'],'maximumWallSeconds':21600,'deadlineAt':deadline.isoformat(),'stoppedReceiptPath':str(previous/'suffix-receipt.json'),'stoppedReceiptSha256':sha(previous/'suffix-receipt.json'),'consumedSessions':239,'consumedSolverCandidates':1912,'consumedGets':2868}
assert datetime.datetime.now(datetime.timezone.utc)<deadline
retained_prior=sum(p.stat().st_size for p in previous.rglob('*') if p.is_file()); remaining_retained=12*1024**3-retained_prior; assert remaining_retained>6*1024**3
phase={'grantId':identifier+'-suffix3623','sessions':list(range(1,455)),'solverCeiling':3623,'getCeiling':5439,'maximumWallSeconds':21600,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':False,'originalAbsoluteDeadlineRequired':True}
series={'schemaVersion':'f70-optional-axis-suffix3623-series-plan.v1','id':identifier,'status':'prepared-unspent; explicit parent release and exact grant required','codeCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'codePins':code_pins,'sourcePins':source_pins,'candidateManifestPath':old['candidateManifestPath'],'candidateManifestSha256':old['candidateManifestSha256'],'preparedIndexPins':index_pins,'preparedStrictProof':{'path':str(proof),'sha256':sha(proof)},'preparedBaseline':baseline,'candidateAllowance':3623,'attemptAllowance':5439,'chunks':chunks,'phases':{'suffix':phase},'originalPhase':original_phase,'outputRoot':str(output),'outputOwnershipManifest':str(supervisor/'ownership/durable-series.json'),'producerPins':old['producerPins'],'resources':{**old['resources'],'expectedRetainedBytes':6*1024**3,'retainedBudgetBytes':remaining_retained,'priorStoppedRetainedBytes':retained_prior,'combinedOriginalAndContinuationRetainedCeilingBytes':12*1024**3,'peakIncludingRetainedBudgetBytes':remaining_retained+64*1024**2},'reviewedHelpers':{'actualEventHistorySource':'unchanged F70 suffix5535 URL-aware helper','groupProofSource':'DEV-2026-11-04-035/g42-unspent1304-series-2026-11-07','actualEventHistorySha256':sha(BASE/'actual-event-history.mjs'),'groupProofSha256':sha(BASE/'group-proof.py')},'retries':0,'automaticRedirects':0,'browser':0,'images':0,'sourceWrites':0,'trafficExecuted':False,'sourceTrafficGranted':False,'capacityCredit':0,'acceptance':False,'noAutomaticContinuation':True,'finalGlobalUnionRequiredBeforeCumulativeCredit':True,'remaining':old['remaining']}
put(BASE/'series-plan.json',series)
example={'schemaVersion':'f70-optional-axis-parent-release.v1','released':False,'allocationId':identifier,'grantId':phase['grantId'],'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':series['candidateManifestSha256'],'codePins':code_pins,'qualificationDate':'2026-11-07','indexPins':index_pins,'strictProof':series['preparedStrictProof'],'baseline':baseline,'acknowledgedOriginalStoppedDiagnostic':True,'originalPhase':original_phase,'preserveOriginalPhaseDeadline':True,'concurrentDisjointLane':{'permitted':True,'catalogueRangeKey':'G42','modelCodes':['2PMA','2PMB','2PPA','2PPB','2PMC','2PBC']},'finalGlobalUnionRequiredBeforeCumulativeCredit':True}
put(BASE/'parent-release.example.json',example)
print(json.dumps({'prepared':True,'sessions':454,'candidates':3623,'maximumGets':5439,'seriesPlanSha256':sha(BASE/'series-plan.json'),'originalDeadlineAt':deadline.isoformat(),'retainedCeilingBytes':remaining_retained,'sourceTraffic':0}))
