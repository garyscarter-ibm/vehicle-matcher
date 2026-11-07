"""Read-only source audit; writes compact receipts, never runs source or tests."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, importlib.util, json, os, pathlib, subprocess
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    temp = p.with_name(p.name + '.tmp')
    temp.write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')
    temp.replace(p)
series = read(BASE / 'series-plan.json')
assert sha(BASE / 'series-plan.json') == '96ec8dc874241bfe9b2a2928d226d88a4b9cbb073a8ebddb05ac12c5efa694c2'
assert all(sha(ROOT / p) == h for p, h in series['codePins'].items())
output = pathlib.Path(series['outputRoot'])
assert output.is_dir()
manifests = [(p, read(p)) for p in sorted(output.glob('supervisor/**/ownership/*.json'))]
assert len(manifests) == 66
assert all(d['state'] == 'removed' and not os.path.lexists(d['root']) for p, d in manifests)
launchers = ['series', 'resume', 'resume08', 'resume10', 'resume15']
processes = [(name, read(output / (name + '-process-ownership.json'))) for name in launchers]
assert all(d['allChildrenJoined'] and all(c['joined'] for c in d['children']) for name, d in processes)
groups = set(g for p, d in manifests for g in d.get('groups', []))
stage_count = sum(len(d['children']) for name, d in processes)
groups.update(c['pid'] for name, d in processes for c in d['children'])
assert stage_count == 127 and len(groups) == 193
snapshot = subprocess.run(['/bin/ps', '-axo', 'pid=,pgid=,stat='], capture_output=True, text=True, timeout=5)
assert snapshot.returncode == 0 and not snapshot.stderr and snapshot.stdout.strip()
rows = [line.split() for line in snapshot.stdout.splitlines()]
assert all(len(r) == 3 and r[0].isascii() and r[0].isdigit() and r[1].isascii() and r[1].isdigit() and r[2] for r in rows)
live = [(int(pid), int(pgid), state) for pid, pgid, state in rows if int(pgid) in groups and not state.startswith('Z')]
assert not live, live
assert not os.path.lexists(ROOT / 'server/node_modules')
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
host = R.HostBudget(R.Policy({'chunk_scratch_mib':64, 'chunk_ram_mib':512, 'chunk_seconds':120, 'log_mib':1}))
reservations = read(host.path)
owner_base = pathlib.Path(series['outputOwnershipManifest'])
owner_names = ['f70-typed-axis1024-output-ownership.json'] + ['f70-typed-axis1024-' + n + '-output-ownership.json' for n in launchers[1:]]
owners = [(owner_base.with_name(n), read(owner_base.with_name(n))) for n in owner_names]
tokens = [d['token'] for p, d in manifests] + [d['reservationToken'] for p, d in owners]
assert not set(tokens).intersection(reservations)
results = []
for entry in series['chunks']:
    directory = pathlib.Path(entry['outputDirectory'])
    proof = read(directory / 'live-validation.json'); receipt = read(directory / 'receipt.json')
    assert proof['retainedChecks']['summary'] == {'tests':5,'pass':5,'fail':0,'cancelled':0,'skipped':0,'todo':0}
    assert proof['sourceTrafficDuringValidation'] == 0
    assert receipt['reason'] == 'queue-exhausted' and receipt['processedCandidates'] == 32 and receipt['actualAttempts'] == 36
    assert sha(directory / 'collector-checkpoint.json') == proof['primarySha256'] == receipt['checkpointSha256']
    assert sha(directory / 'final-canonical-index.json') == proof['finalCanonicalIndexSha256']
    assert sha(directory / 'final-spent-request-index.json') == proof['finalSpentRequestIndexSha256']
    results.append({'chunk':entry['number'], 'directory':str(directory), 'primarySha256':proof['primarySha256'],
        'proofSha256':sha(directory / 'live-validation.json'), 'receiptSha256':sha(directory / 'receipt.json'),
        'finalCanonicalIndexSha256':proof['finalCanonicalIndexSha256'], 'finalSpentRequestIndexSha256':proof['finalSpentRequestIndexSha256'],
        'accepted':receipt['newlyAccepted'], 'duplicates':receipt['duplicates'], 'rejected':receipt['rejected'],
        'gets':receipt['actualAttempts'], 'decodedBytes':receipt['counts']['decodedBytes'],
        'retainedShardBytes':sum(p.stat().st_size for p in directory.rglob('*') if p.is_file())})
assert (sum(r['accepted'] for r in results),sum(r['duplicates'] for r in results),sum(r['rejected'] for r in results)) == (390,374,260)
supervisor_results = [(p,read(p)) for p in output.glob('supervisor/**/*result.json')]
audit = {'schemaVersion':'typed-axis1024-final-filesystem-audit.v1', 'auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope':'read-only final filesystem/process/index audit; zero HTTP and no test rerun',
    'allStageChildrenJoined':True, 'stageChildren':stage_count, 'scratchManifests':len(manifests), 'groupsObservedAbsent':sorted(groups),
    'psSnapshotRows':len(rows), 'psSnapshotSha256':hashlib.sha256(snapshot.stdout.encode()).hexdigest(),
    'allScratchAbsent':True, 'dependencyLinkAbsent':True, 'all71OwnedReservationTokensAbsent':len(tokens)==71,
    'removedScratchPeakBytes':sum(d.get('peak',0) for p,d in manifests),
    'maxSampledSourceOrCheckRssBytes':max(d.get('peak_rss',0) for p,d in supervisor_results),
    'maxRetainedSourceShardBytes':max(r['retainedShardBytes'] for r in results),
    'retainedLogicalBytesBeforeAudit':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),
    'retainedOutput':str(output), 'compatibilityException':None, 'leftovers':[], 'cloudUploadVerified':False,
    'ownershipManifestPins':{str(p):sha(p) for p,d in manifests+owners},
    'processOwnershipPins':{str(output/(n+'-process-ownership.json')):sha(output/(n+'-process-ownership.json')) for n in launchers}}
write(output / 'final-filesystem-audit.json',audit)
final=read(output/'chunks/chunk32/live-validation.json')
summary={'schemaVersion':'typed-axis1024-actual-series.v1', 'seriesPlanSha256':sha(BASE/'series-plan.json'),
    'candidateManifestSha256':sha(BASE/'candidate-manifest.json'), 'frozenCodePinsUnchanged':len(series['codePins']),
    'allocationId':series['id'], 'outputRoot':str(output), 'sourceRequests':1024, 'actualGets':sum(r['gets'] for r in results),
    'decodedBytes':sum(r['decodedBytes'] for r in results), 'accepted':390,'duplicates':374,'rejected':260,
    'finalAdmitted':final['cumulativeAdmittedSourceConfigurations'], 'finalCanonicalEntries':final['cumulativeCanonicalEntries'],
    'finalSpentRequests':final['cumulativeSpentSolverRequests'], 'elapsedSinceOriginalReservationSeconds':read(output/'resume15-receipt.json')['elapsedSinceOriginalReservationSeconds'],
    'validation':{'scope':'scoped', 'requiredChecksCovered':160, 'completeFiveCheckResults':31,
        'chunk07':'four original semantic passes plus one actual-event-union replacement; original event failure retained', 'skips':0,'sourceTrafficDuringValidation':0,
        'fullSuiteRun':False},
    'recoveryHistory':[
        {'chunk':3,'original':'isolated Node runner exited rc7 after first TAP test; no summary; underlying cause unresolved', 'recovery':'same five checks passed with --test-isolation=none; no source replay'},
        {'chunk':7,'original':'canonical event history missing actual attempt29 HTTP200 header, retained in untouched OneDrive conflict file; original4/5 failure preserved','recovery':'four original semantic passes reused and one actual-event-union check passed; no synthesized or merged events'},
        {'chunk':9,'original':'canonical-only cumulative index reconciliation missed actual start retained in conflict log','recovery':'read-only actual-event union reconciliation; all five strict checks passed; actual4 admissions/28 rejections'},
        {'chunk':14,'original':'five checks passed; outer finalizer process snapshot uncertain; original false receipt retained','recovery':'independent group absence/input hash audit; five passes reused without source or test rerun', 'auditSha256':sha(output/'cleanup-recovery14.json')}],
    'sourceEventPersistenceDefect':{'severity':'Medium','status':'open; parent native Jira linkage pending; distinct from other OneDrive validation issue',
        'diagnosis':'OneDrive conflict split append event history across canonical and actual conflict copies. Strict canonical-only proof stopped. Retained actual rows matched exact starts/headers/solver observations; union replacement recovers evidence, not persistence.'},
    'finalFilesystemAudit':{'path':str(output/'final-filesystem-audit.json'),'sha256':sha(output/'final-filesystem-audit.json'),
        'removedScratchPeakBytes':audit['removedScratchPeakBytes'],'maxSampledRssBytes':audit['maxSampledSourceOrCheckRssBytes'],
        'maxRetainedSourceShardBytes':audit['maxRetainedSourceShardBytes'],'leftovers':[],'compatibilityException':None},
    'actualReceipts':{str(output/(n+'-receipt.json')):sha(output/(n+'-receipt.json')) for n in launchers},
    'chunks':results,'acceptance':False,'activeCorpusWritten':False,'publicationWritten':False,'remaining':series['remaining']}
write(BASE/'actual-series.json',summary)
impact={'schemaVersion':'test-impact.v1','scope':'scoped actual retained series; no full suite', 'seriesPlanSha256':sha(BASE/'series-plan.json'),
    'actualSummarySha256':sha(BASE/'actual-series.json'),'identity':'74 frozen original code pins plus per-attempt amended wrapper pins',
    'map':[
        {'files':['collector-checkpoint.json','execution-plan.json','collection-plan.json'],'test':'primary, standalone safe artifacts and every frozen pin agree'},
        {'files':['scripts/gcsp/bmw-selection-binding.mjs','server/gcsp/policy/index.js'],'test':'every actual admitted record pass strict source binding and registered catalogue construction'},
        {'files':['scripts/gcsp/bmw-public-registration.mjs','actual-event-history.mjs'],'test':'source events, exact candidate URLs and counters account for the declared successful GETs'},
        {'files':['scripts/gcsp/configuration-key.mjs','reconcile-retained-sync.py'],'test':'every resolved canonical selection is novel and both cumulative indexes extend exact inputs'},
        {'files':['accepted.jsonl','execution-once.json','checkpoint-export.json'],'test':'exported rows, spent marker and source privacy remain intact'}],
    'coverageContexts':[str(p) for p in sorted(output.glob('supervisor/**/*coverage.json'))],
    'timingResults':[{'path':str(p),'wallSeconds':d.get('wall'),'peakRssBytes':d.get('peak_rss')} for p,d in supervisor_results],
    'boundaries':['actual retained files and source observation binders','policy file provider','pure offline Node checks; no HTTP'],
    'excluded':['full application suite','live publication','ordinary application activation','10k/model/profile/year/plant/five-WMI acceptance'],
    'exclusionReason':'Evidence-only summary and retained source proofs; no product code change. Existing source series checks reused with exact file identities.'}
write(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/f59-axis1024-actual-96ec8dc874241bfe.json'),impact)
print(json.dumps({'actualSummarySha256':sha(BASE/'actual-series.json'),'auditSha256':sha(output/'final-filesystem-audit.json'),'removedScratchPeakBytes':audit['removedScratchPeakBytes'],'maxRssBytes':audit['maxSampledSourceOrCheckRssBytes'],'maxShardBytes':audit['maxRetainedSourceShardBytes'],'groupsAbsent':len(groups)}))
