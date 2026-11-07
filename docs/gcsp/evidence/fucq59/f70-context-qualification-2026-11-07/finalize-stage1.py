"""Consolidate six immutable context receipts without further source access."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, json, os, pathlib

BASE = pathlib.Path(__file__).resolve().parent
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
manifest = read(BASE / 'stage1-plan.json')
assert digest(manifest) == 'ce14282252e10dbadedb6f7afcc69ba142947215c5b390fc485e124dd365725b'
rows = []
for frozen in manifest['contexts']:
    directory = BASE / frozen['context']
    validation = read(directory / 'live-validation.json'); receipt = read(directory / 'receipt.json')
    assert validation['planDigest'] == frozen['planDigest'] == receipt['planDigest']
    assert validation['attempts'] == receipt['actualAttempts'] == 3
    assert validation['reason'] == receipt['reason'] == 'source-trim-unknown'
    assert validation['primarySha256'] == sha(directory / 'collector-checkpoint.json')
    assert validation['treeSha256'] == sha(directory / 'tree.json')
    assert validation['sourceEventsSha256'] == sha(directory / 'source-events.jsonl')
    cleanup = validation['cleanup']; result = validation['supervisorResult']
    assert all(cleanup[k] for k in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'primaryExists', 'code_identity_unchanged'])
    assert cleanup['checkpointExport']['status'] == 'exported' and not cleanup['retainedWriterMetadata']
    assert not os.path.lexists(read(directory / 'execution-plan.json')['scratchRoot'])
    assert cleanup['compatibility_exception'] is None and not validation['disposableLeftovers']
    assert result['rc'] == 0 and result['issue'] is None
    rows.append({'context': frozen['context'], 'modelCode': frozen['modelCode'], 'agModelCode': frozen['agModelCode'],
        'reason': receipt['reason'], 'attempts': 3, 'decodedBytes': receipt['counts']['decodedBytes'], 'sourceElapsedMs': receipt['elapsedMs'],
        'peakChildRssBytes': result['peak_rss'], 'sourcePlanDigest': frozen['planDigest'], 'primarySha256': validation['primarySha256'],
        'treeSha256': validation['treeSha256'], 'validationSha256': sha(directory / 'live-validation.json'),
        'missingFields': validation['missingFields'], 'cleanupVerified': True})
assert len(rows) == 6 and sum(row['attempts'] for row in rows) == 18
summary = {'schemaVersion': 'f70-context-stage1-final-receipt.v1', 'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'status': 'finite qualification-only stage completed; all trim fields unknown; options and solver unallocated',
    'sourceCapabilityCommit': '03f04ec812b0e8c6aa97850c2595173b6fa850d5', 'preparedCommit': '7fdccb66491157c05fed98ea034b45a493adf265',
    'stage1ManifestDigest': digest(manifest), 'stage1ManifestSha256': sha(BASE / 'stage1-plan.json'),
    'verifierSha256': sha(BASE / 'verify-live.py'), 'contexts': rows, 'actualGetRequests': 18,
    'decodedBytes': sum(row['decodedBytes'] for row in rows), 'sourceElapsedMs': sum(row['sourceElapsedMs'] for row in rows),
    'peakChildRssBytes': max(row['peakChildRssBytes'] for row in rows), 'optionsRequests': 0, 'solverRequests': 0,
    'retries': 0, 'newConfigurations': 0, 'sourceCapacityCredit': 0, 'priorAdmittedConfigurationsUnchanged': 340,
    'allCleanupVerified': True, 'removedLiveScratchBytes': 0, 'remainingReleasedRequests': 0,
    'reservedButUnallocated': {'options': 6, 'solver': 48}, 'compatibilityException': None, 'disposableLeftovers': [],
    'retainedBytesAtMeasurement': sum(p.stat().st_size for p in BASE.rglob('*') if p.is_file()),
    'retention': 'Direct safe model projections and primary/export/event receipts only; no raw page/settings/tree response bodies or bootstrap headers retained.',
    'bounds': 'Six serial three-GET chunks; each512MiB host448MiB child64MiB scratch,90s source105s child120s supervisor; no resource ceiling reached.',
    'remaining': ['direct source-qualified trim or independently qualified exact options route', 'typed option definitions',
       'fresh finite candidate lists and separately reviewed source allocation', 'original configuration/profile/year/plant/five-WMI acceptance'],
    'acceptance': False}
target = BASE / 'final-stage1-receipt.json'; assert not target.exists()
with target.open('x') as stream: stream.write(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: summary[key] for key in ['status', 'actualGetRequests', 'decodedBytes', 'sourceElapsedMs', 'peakChildRssBytes', 'retainedBytesAtMeasurement', 'allCleanupVerified']}))
