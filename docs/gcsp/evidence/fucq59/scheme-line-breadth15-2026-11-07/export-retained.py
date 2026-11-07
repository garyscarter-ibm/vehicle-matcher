"""Export safe diagnostic after the owned source child has stopped and joined."""
import sys
sys.dont_write_bytecode=True
import hashlib, importlib.util, json, pathlib, os
BASE=pathlib.Path(__file__).resolve().parent
ROOT=BASE.parents[4]
spec=importlib.util.spec_from_file_location('checkpoint_exporter',ROOT/'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py')
E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
def export(directory):
    directory=pathlib.Path(directory);summary=E.export(directory)
    state=json.loads((directory/'collector-checkpoint.json').read_text())['content']
    artifact=state.get('diagnosticObservation')
    if artifact:
        data=E.encoded(artifact['document'])
        if len(data)!=artifact['bytes'] or hashlib.sha256(data).hexdigest()!=artifact['sha256'] or len(data)>131072:
            raise ValueError('diagnostic-export-integrity')
        path=directory/'diagnostic.json'
        try:
            with path.open('xb') as stream:
                os.fchmod(stream.fileno(),0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
        except FileExistsError:
            if path.is_symlink() or path.read_bytes()!=data: raise ValueError('diagnostic-export-conflict')
    return summary
if __name__=='__main__': print(json.dumps(export(sys.argv[1])))
