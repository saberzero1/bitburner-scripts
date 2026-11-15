"""python3 sweep.py <prefix> <hours> <stats> <spec file>: run bb-sim variants in parallel (live multipliers)"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
pre, hours, stats, spec = sys.argv[1:5]
jobs = [(f"{pre}_{l.split(None,1)[0]}", l.split(None, 1)[1].strip()) for l in open(spec) if l.strip() and not l.startswith("#")]
env = dict(os.environ, SIM_PLAYER=os.path.join(HERE, "out", "live-player.json"))
run = lambda j: subprocess.run([f"{HERE}/run.sh", j[0], hours, stats, j[1]], stdout=subprocess.DEVNULL, env=env)
with ThreadPoolExecutor(14) as ex: list(ex.map(run, jobs))
subprocess.run(["python3", f"{HERE}/report.py", *[j[0] for j in jobs]])
