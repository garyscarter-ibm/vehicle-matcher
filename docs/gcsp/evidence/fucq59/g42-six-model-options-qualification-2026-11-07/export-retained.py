"""Reuse the checkpoint exporter, then export only sealed model/options artifacts."""
import sys
sys.dont_write_bytecode=True
import hashlib,importlib.util,json,os,pathlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
spec=importlib.util.spec_from_file_location('checkpoint_exporter',ROOT/'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py')
E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
def export(directory):
    directory=pathlib.Path(directory);primary=directory/'collector-checkpoint.json'
    if not primary.exists():return {'status':'no-primary','primaryPreserved':True}
    result=E.export(directory);state=json.loads(primary.read_text())['content']
    for field,name in [('contextObservation','tree.json'),('optionsObservation','options.json'),('trimRelationships','line-relationships.json')]:
        artifact=state.get(field)
        if artifact is None:continue
        data=E.encoded(artifact if field=='trimRelationships' else artifact['document'])
        if field!='trimRelationships' and (len(data)!=artifact['bytes'] or hashlib.sha256(data).hexdigest()!=artifact['sha256']):raise ValueError('safe-artifact-integrity')
        path=directory/name
        try:
            with path.open('xb') as stream:os.fchmod(stream.fileno(),0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
        except FileExistsError:
            if path.is_symlink() or path.read_bytes()!=data:raise ValueError('safe-artifact-export-conflict')
    return result
if __name__=='__main__':print(json.dumps(export(sys.argv[1])))
