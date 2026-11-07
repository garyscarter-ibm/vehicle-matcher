import pathlib, subprocess, sys
# Deliberately no export/finalizer here: SIGKILL must leave the primary deliverable intact.
raise SystemExit(subprocess.call(["/opt/homebrew/bin/node", str(pathlib.Path(__file__).with_name("proof-child.mjs")), "write", sys.argv[1]]))
