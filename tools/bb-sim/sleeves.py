"""Compare sleeve Bladeburner assignments: python3 sleeves.py <prefix> <hours> [seeds=2]"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
I, D, F = ["Infiltrate Synthoids"], ["Diplomacy"], ["Field Analysis"]
C = lambda c: ["Take on contracts", c]
VARIANTS = {
    "none": [],
    "sleevejs": [I, C("Retirement"), C("Bounty Hunter"), C("Tracking"), I, D, F, I],
    "infil8": [I] * 8,
    "c3_infil5": [I, C("Retirement"), C("Bounty Hunter"), C("Tracking"), I, I, I, I],
    "c3_infil4_dip1": [I, C("Retirement"), C("Bounty Hunter"), C("Tracking"), I, I, D, I],
}
pre, hours = sys.argv[1], sys.argv[2]
seeds = int(sys.argv[3]) if len(sys.argv) > 3 else 2
jobs = [(f"{pre}_{v}_{s}", tasks) for v, tasks in VARIANTS.items() for s in range(1, seeds + 1)]
def run(j):
    env = dict(os.environ, SIM_PLAYER=f"{OUT}/live-player.json", SIM_SLEEVES_FILE=f"{OUT}/live-sleeves.json", SIM_SLEEVE_TASKS=json.dumps(j[1]))
    subprocess.run([f"{HERE}/run.sh", j[0], hours, "100", "{}"], stdout=subprocess.DEVNULL, env=env)
with ThreadPoolExecutor(14) as ex: list(ex.map(run, jobs))
subprocess.run(["python3", f"{HERE}/report.py", *[j[0] for j in jobs]])
