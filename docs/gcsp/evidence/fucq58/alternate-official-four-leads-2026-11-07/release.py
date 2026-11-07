"""Pure pin and exact release checks, before any allocation or network."""
import sys
sys.dont_write_bytecode=True
import datetime,hashlib,json,os,pathlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text())
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def load_series():
    series=read(BASE/'series-plan.json')
    assert all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items()),'frozen-code-or-input-mismatch'
    assert all(sha(p)==h for p,h in series['runtimePins'].items()),'frozen-runtime-mismatch'
    return series
def phase_release(series,name):
    phase=series['phases'][name]
    assert os.environ.get('BMW_F58_FOUR_MODEL_PHASE_GRANT')==phase['grantId'],'exact-root-phase-grant-required'
    release=read(BASE/phase['releaseFile'])
    assert release['status']=='released-once' and release['phase']==name and release['allocationId']==series['id'] and release['planSha256']==sha(BASE/'series-plan.json'),'exact-root-phase-release-required'
    assert release['GET']==phase['getCeiling'] and release['contexts']==phase['contexts'] and release['settingsBootstrapGET']==len(phase['contexts']),'exact-root-phase-request-budget-required'
    assert series['qualificationDate']==datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),'source-date-mismatch'
    if name=='remaining':
        first=pathlib.Path(series['outputRoot'])/'u06/live-validation.json'
        assert release['reviewedFirstProofSha256']==sha(first),'actual-reviewed-first-proof-required'
        assert release['reviewedFirstReceiptSha256']==sha(pathlib.Path(series['outputRoot'])/'first-receipt.json'),'actual-reviewed-first-receipt-required'
        prior=read(pathlib.Path(series['outputRoot'])/'first-receipt.json')
        assert prior['reason']=='finite-first-exhausted' and prior['actualGets']==3 and len(prior['completedContexts'])==1 and prior['completedContexts'][0]['context']=='u06' and prior['completedContexts'][0]['proofSha256']==sha(first),'actual-complete-first-context-required'
    return phase,release
