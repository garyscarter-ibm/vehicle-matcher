"""Read-only finite catalogue for the corrected retained-input CLI proof."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as sg

CODE = '1e6e4a42911bc58e5bce3f3f88fbeb464c7c5fcf'
ORIGINAL_PLAN_SHA = '4736eb27feccd18d83c9f105d7a71d1130e1edd75006974c211fac208d1293a3'
INPUTS = ['docs/gcsp/models/choice-training-dataset.json',
          'docs/gcsp/models/choice-training-policy.json',
          'docs/gcsp/models/choice-training-policy-base.json']


def main():
    original = ROOT / 'docs/gcsp/models/fucq115-canonical-source-plan.json'
    assert hashlib.sha256(original.read_bytes()).hexdigest() == ORIGINAL_PLAN_SHA
    plan = json.loads(original.read_text())
    changes = []
    for path, row in plan['files'].items():
        if path.startswith('server/gcsp/predict/model/') or path == 'scripts/gcsp/train-choice-model.mjs':
            rc, text, err = sg.git(ROOT, ['show', CODE + ':' + path])
            assert rc == 0, err
            data = text.encode()
            digest = hashlib.sha256(data).hexdigest()
            if digest != row['sha256']:
                changes.append({'path': path, 'previousSHA256': row['sha256'], 'sha256': digest})
            row.update(sourceCommit=CODE, sha256=digest, bytes=len(data))
        current = ROOT / path
        row['current'] = 'absent' if not current.exists() else 'identical' if hashlib.sha256(current.read_bytes()).hexdigest() == row['sha256'] else 'different'
    for path in INPUTS:
        rc, text, err = sg.git(ROOT, ['show', CODE + ':' + path])
        assert rc == 0, err
        data = text.encode()
        plan['files'][path] = {'sourceCommit': CODE, 'sha256': hashlib.sha256(data).hexdigest(),
                               'bytes': len(data), 'current': 'identical', 'edges': []}
        assert (ROOT / path).read_bytes() == data
    assert len(changes) == 2
    plan.update(status='proposed-retained-input-resume', variant='retained-training-v1',
                purpose='Corrected default CLI once on actual committed data/current+original historical policies; no generator/adoption/publication replay.',
                previousReviewedSourcePlanSHA256=ORIGINAL_PLAN_SHA, modelCommit=CODE,
                changedSourceFiles=changes, retainedInputPaths=INPUTS,
                executionBoundary='Byte-exact single scratch mirror; only own baseline and CLI differ from reviewed73-file source. Three exact immutable committed inputs are added. No JS executed by this catalogue.',
                inactiveEdges=['Original canonical runtime/HTTP and generator CLI are retained in the reviewed source catalogue but not invoked in this variant.',
                               'PostgreSQL and corpus import edges remain inactive. No database open, corpus read or collection.'],
                remainingGates=['Actual model-reference publication/activation remains separate and unexecuted.', 'Full/native/browser/corpus/live/calibration gates unchanged.'])
    plan['files'] = dict(sorted(plan['files'].items()))
    output = ROOT / 'docs/gcsp/models/fucq115-retained-source-plan.json'
    output.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'path': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                      'files': len(plan['files']), 'bytes': sum(r['bytes'] for r in plan['files'].values()),
                      'changes': changes, 'allocation': 'none; no JavaScript imported'}))


if __name__ == '__main__':
    main()
