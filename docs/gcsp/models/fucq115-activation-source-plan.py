"""Read-only finite catalogue for existing-artifact canonical activation."""
from pathlib import Path
import hashlib
import json
import sys
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as sg
PREVIOUS_SHA = '6a7f276a99307aba3af2b07498859bb3a8659025099f087fa89fc741b134a797'
ARTIFACT_COMMIT = 'e3f1e0bbe874d6fbc48e65de80c03261f410abf6'
ARTIFACT_PATH = 'docs/gcsp/models/artifacts/2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d.json'
ARTIFACT_SHA = 'a2ee4271a91a2a02182fa9d5797acd7723a9bc776207aad19f5190cb223ddd86'
def main():
    previous = ROOT / 'docs/gcsp/models/fucq115-retained-source-plan.json'
    assert hashlib.sha256(previous.read_bytes()).hexdigest() == PREVIOUS_SHA
    plan = json.loads(previous.read_text())
    rc, text, err = sg.git(ROOT, ['show', ARTIFACT_COMMIT + ':' + ARTIFACT_PATH])
    assert rc == 0, err
    data = text.encode()
    assert hashlib.sha256(data).hexdigest() == ARTIFACT_SHA
    assert (ROOT / ARTIFACT_PATH).read_bytes() == data
    assert len(plan['files']) == 76
    plan['files'][ARTIFACT_PATH] = {'sourceCommit': ARTIFACT_COMMIT, 'sha256': ARTIFACT_SHA,
                                  'bytes': len(data), 'current': 'identical', 'edges': []}
    plan.update(status='proposed-retained-artifact-activation', variant='retained-artifact-activation-v1',
        purpose='Re-establish actual canonical dated history; schedule/read existing artifact reference only. No generation, training, evaluation rerun or settings change.',
        previousReviewedSourcePlanSHA256=PREVIOUS_SHA, artifactCommit=ARTIFACT_COMMIT,
        changedSourceFiles=[], addedInputPaths=[ARTIFACT_PATH],
        executionBoundary='The reviewed76-file graph is byte-identical. One immutable artifact is added; fresh ordinary memory runtime/cookies/clock/canonical policy authority only.',
        inactiveEdges=['Generator CLI, actual99/29 baseline and training CLI remain catalogued but are not called. No dataset projection/training/metrics recomputation.',
                       'PostgreSQL/corpus edges remain inactive; no database, browser, listener, network or corpus collection.'],
        remainingGates=['Actual activation remains unexecuted until exact source/harness review and grant.',
                        'Fresh scoped/full integration remains dispatcher lane. Live/native/corpus/calibration gates unchanged.'])
    plan['retainedInputPaths'] = [*plan['retainedInputPaths'], ARTIFACT_PATH]
    plan['files'] = dict(sorted(plan['files'].items()))
    output = ROOT / 'docs/gcsp/models/fucq115-activation-source-plan.json'
    output.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'path': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'files': len(plan['files']), 'bytes': sum(row['bytes'] for row in plan['files'].values()),
        'changedSourceFiles': [], 'addedInputPaths': [ARTIFACT_PATH], 'allocation': 'none; no JavaScript imported'}))
if __name__ == '__main__':
    main()
