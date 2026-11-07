"""Validate a parent-selected immutable proved prefix. Read-only; never grants itself traffic."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, json, pathlib
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda path: json.loads(pathlib.Path(path).read_text())
sha = lambda path: hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def counts(canonical, spent):
    return {'canonical': len(canonical['entries']), 'admittedSource': sum(any(origin['kind'] == 'admitted-source' for origin in row['origins']) for row in canonical['entries']), 'spent': len(spent['entries'])}

def validate_prefix(base_canonical, base_spent, canonical, spent):
    known = {row['configurationId']: row for row in canonical['entries']}
    assert len(known) == len(canonical['entries']), 'canonical index contains duplicate ids'
    assert len({row['requestDigest'] for row in spent['entries']}) == len(spent['entries']), 'spent index contains duplicate requests'
    for row in base_canonical['entries']:
        assert row['configurationId'] in known, 'canonical prefix id removed'
        current = known[row['configurationId']]
        assert all(origin in current['origins'] for origin in row['origins']), 'canonical prefix origin removed'
        assert {k: v for k, v in row.items() if k != 'origins'} == {k: v for k, v in current.items() if k != 'origins'}, 'canonical prefix identity changed'
    assert spent['entries'][:len(base_spent['entries'])] == base_spent['entries'], 'spent prefix changed'

def validate_strict_snapshot(index_pins, proof_pin):
    indexes = {}
    for name in ['canonical', 'spent']:
        pin = index_pins[name]; path = pathlib.Path(pin['path'])
        assert path.is_absolute() and sha(path) == pin['sha256'], 'selected index SHA mismatch'
        indexes[name] = read(path)
        assert digest(indexes[name]) == pin['digest'] and len(indexes[name]['entries']) == pin['entries'], 'selected index digest/count mismatch'
    path = pathlib.Path(proof_pin['path'])
    assert path.is_absolute() and sha(path) == proof_pin['sha256'], 'selected proof SHA mismatch'
    proof = read(path); summary = proof['retainedChecks']['summary']
    assert summary['tests'] == summary['pass'] == 5 and all(summary[k] == 0 for k in ['fail', 'skipped', 'cancelled']), 'strict retained proof required'
    assert proof['finalCanonicalIndexSha256'] == index_pins['canonical']['sha256'] and proof['finalSpentRequestIndexSha256'] == index_pins['spent']['sha256'], 'proof/index mismatch'
    assert sha(pathlib.Path(proof.get('retainedEvidenceDirectory', str(path.parent))) / 'collector-checkpoint.json') == proof['primarySha256'], 'selected primary SHA mismatch'
    assert sha(pathlib.Path(proof.get('retainedEvidenceDirectory', str(path.parent))) / 'receipt.json') == proof['receiptSha256'], 'selected receipt SHA mismatch'
    for cleanup in [proof['cleanup'], proof['retainedCleanup']]:
        assert all(cleanup[k] for k in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'code_identity_unchanged']), 'selected proof cleanup incomplete'
    actual = counts(indexes['canonical'], indexes['spent'])
    assert actual == {'canonical': proof['cumulativeCanonicalEntries'], 'admittedSource': proof['cumulativeAdmittedSourceConfigurations'], 'spent': proof['cumulativeSpentSolverRequests']}, 'selected proof count mismatch'
    return indexes['canonical'], indexes['spent']

def validate_release(series, path):
    release = read(path)
    assert release['schemaVersion'] == 'f70-optional-axis-parent-release.v1' and release['released'] is True, 'explicit parent release required'
    assert release['allocationId'] == series['id'] and release['grantId'] == series['phases']['suffix']['grantId'], 'release allocation mismatch'
    assert release['seriesPlanSha256'] == sha(BASE / 'series-plan.json'), 'release plan SHA mismatch'
    assert release['candidateManifestSha256'] == series['candidateManifestSha256'], 'release manifest SHA mismatch'
    assert release['codePins'] == series['codePins'], 'release code pins mismatch'
    assert release['qualificationDate'] == datetime.datetime.now(datetime.timezone.utc).date().isoformat() == '2026-11-07', 'same-day release required'
    assert release['finalGlobalUnionRequiredBeforeCumulativeCredit'] is True, 'global union obligation required'
    assert release['acknowledgedOriginalStoppedDiagnostic'] is True, 'preserve and acknowledge original stopped diagnostic'
    assert release['originalPhase'] == series['originalPhase'] and release['preserveOriginalPhaseDeadline'] is True, 'original clock cannot reset'
    assert datetime.datetime.now(datetime.timezone.utc) < datetime.datetime.fromisoformat(series['originalPhase']['deadlineAt']), 'original absolute phase deadline exhausted'
    overlap = release['concurrentDisjointLane']
    assert overlap['permitted'] is True and overlap['catalogueRangeKey'] == 'G42', 'declared disjoint G42 continuation required'
    assert not set(overlap['modelCodes']).intersection(entry['modelCode'] for entry in series['chunks']), 'overlap models are not disjoint'
    for relative, expected in {**series['codePins'], **series['sourcePins']}.items():
        assert sha(ROOT / relative) == expected, 'code/source pin mismatch: ' + relative
    canonical, spent = validate_strict_snapshot(release['indexPins'], release['strictProof'])
    base = {}
    for name, pin in series['preparedIndexPins'].items():
        assert sha(pin['path']) == pin['sha256'], 'prepared prefix SHA mismatch'
        base[name] = read(pin['path']); assert digest(base[name]) == pin['digest']
    validate_prefix(base['canonical'], base['spent'], canonical, spent)
    assert counts(canonical, spent) == release['baseline'], 'release baseline mismatch'
    # Keep the strict proved prefix separate from conservative no-replay exclusions.
    pin = series['conservativeExclusions']; excluded_path = pathlib.Path(pin['path'])
    assert release['conservativeExclusionsSha256'] == pin['sha256'] == sha(excluded_path), 'exact conservative exclusion acknowledgement required'
    excluded = read(excluded_path)
    assert excluded['schemaVersion'] == 'f70-interrupted-session-conservative-exclusions.v1'
    assert excluded['capacityCredit'] == 0 and excluded['observedAttemptsFromExclusionCount'] is False
    assert len(excluded['entries']) == pin['entries'] == 8
    template_path = ROOT / excluded['sourceTemplatePath']
    assert sha(template_path) == excluded['sourceTemplateSha256'], 'interrupted template SHA mismatch'
    template = read(template_path)
    expected = [{'candidateId': row['candidateId'], 'requestDigest': digest({'modelRegistration': template['modelRegistration'], 'request': row['request']}), 'outcome': 'conservatively-excluded-interrupted-session'} for row in template['candidates']]
    assert excluded['entries'] == expected, 'entire interrupted template required'
    receipt_path = pathlib.Path(excluded['sourceReceiptPath'])
    assert sha(receipt_path) == excluded['sourceReceiptSha256'], 'interrupted receipt SHA mismatch'
    receipt = read(receipt_path)
    assert receipt['allocationId'] == excluded['interruptedAllocationId'] and receipt['reason'] == 'source-failure'
    assert receipt['counts']['operations']['solve'] == excluded['actualChargedSolverAttempts'] == 2
    assert receipt['actualAttempts'] == excluded['actualChargedGETAttempts'] == 6
    assert not {row['requestDigest'] for row in spent['entries']}.intersection(row['requestDigest'] for row in excluded['entries']), 'conservative exclusion already in selected strict prefix'
    spent = {**spent, 'entries': spent['entries'] + excluded['entries']}
    assert counts(canonical, spent) == release['executionBaseline'] == series['executionBaseline'], 'execution baseline must separately include conservative exclusions'
    requested = [value for entry in series['chunks'] for value in entry['requestDigests']]
    assert len(set(requested)) == series['candidateAllowance'] == 2815 and not set(requested).intersection(row['requestDigest'] for row in spent['entries']), 'suffix request already spent'
    return release, canonical, spent
