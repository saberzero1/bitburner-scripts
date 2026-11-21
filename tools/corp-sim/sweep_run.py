"""Run a sweep: python3 sweep_run.py <prefix> <specfile> [seeds=2] [hours=72] [mult=0.236 divmult=0.5 softcap=0.8]
Spec file lines: <tag> <JSON options>; each merged over {"investment-rounds": 4}."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
pre, spec = sys.argv[1], sys.argv[2]
seeds = int(sys.argv[3]) if len(sys.argv) > 3 else 2
hours = sys.argv[4] if len(sys.argv) > 4 else "72"
mult, divm, soft = (sys.argv[5:8] + ["0.236", "0.5", "0.8"][len(sys.argv[5:8]):])
jobs = []
for line in open(spec):
    if not line.strip() or line.startswith("#"): continue
    tag, js = line.split(None, 1)
    opts = {"investment-rounds": 4, **json.loads(js)}
    for s in range(1, seeds + 1):
        jobs.append((f"{pre}_{tag}-{s}", json.dumps(opts)))
def run(job):
    name, opts = job
    subprocess.run([f"{HERE}/run.sh", name, mult, divm, soft, hours, opts], stdout=subprocess.DEVNULL)
    return name
with ThreadPoolExecutor(14) as ex:
    for name in ex.map(run, jobs): print(name, "done", flush=True)
