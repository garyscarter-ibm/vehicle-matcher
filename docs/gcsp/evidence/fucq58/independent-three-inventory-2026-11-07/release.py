"""Independent exact three-GET release, bound to preserved actual spent U06 evidence."""
import sys
sys.dont_write_bytecode=True
import datetime,hashlib,json,os,pathlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text())
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load_series():
    series=read(BASE/'series-plan.json')
    assert all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items()),'frozen-code-or-input-mismatch'
    assert all(sha(p)==h for p,h in series['externalPins'].items()),'frozen-external-spent-proof-mismatch'
    assert all(sha(p)==h for p,h in series['runtimePins'].items()),'frozen-runtime-mismatch'
    return series
def phase_release(series,name):
    phase=series['phases'][name]
    assert os.environ.get('BMW_F58_INDEPENDENT_PHASE_GRANT')==phase['grantId'],'exact-root-phase-grant-required'
    release=read(BASE/phase['releaseFile'])
    assert release['status']=='released-once' and release['phase']==name and release['allocationId']==series['id'] and release['planSha256']==sha(BASE/'series-plan.json'),'exact-root-phase-release-required'
    assert release['GET']==3 and release['contexts']==[name] and release['settingsBootstrapGET']==1,'exact-root-phase-request-budget-required'
    assert release['spentU06ProofSha256']==series['spentU06ProofSha256'],'exact-reviewed-spent-u06-proof-required'
    assert series['qualificationDate']==datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),'source-date-mismatch'
    return phase,release
