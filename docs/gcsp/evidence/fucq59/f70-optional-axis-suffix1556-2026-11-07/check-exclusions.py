"""Zero-HTTP red/green check of strict-proof plus separate conservative exclusions."""
import sys
sys.dont_write_bytecode=True
import copy,importlib.util,json,os,pathlib,tempfile
BASE=pathlib.Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())
spec=importlib.util.spec_from_file_location('release_context',BASE/'release-context.py');V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)
series=read(BASE/'series-plan.json');release=read(BASE/'parent-release.example.json');release['released']=True
with tempfile.TemporaryDirectory(prefix='exclusion-contract-',dir=os.environ.get('TMPDIR')) as temporary:
 p=pathlib.Path(temporary)/'release.json';p.write_text(json.dumps(release));r,canonical,spent=V.validate_release(series,p)
 expected=read(pathlib.Path(release['indexPins']['spent']['path']))['entries']+read(pathlib.Path(series['conservativeExclusions']['path']))['entries']
 assert spent['entries']==expected,'interrupted138 entire eight candidates must be excluded separately from strict proof baseline'
 assert V.counts(canonical,spent)==release['executionBaseline'],'execution baseline must carry eight exclusions without crediting admission'
 assert read(pathlib.Path(release['indexPins']['spent']['path']))['entries']!=spent['entries'],'strict input remains immutable'
 for key in ['conservativeExclusionsSha256','executionBaseline']:
  changed=copy.deepcopy(release);changed[key]='invalid';p.write_text(json.dumps(changed))
  try:V.validate_release(series,p)
  except (AssertionError,TypeError,KeyError):pass
  else:raise AssertionError('explicit exclusion acknowledgement required: '+key)
print(json.dumps({'checks':5,'pass':5,'sourceTraffic':0}))
