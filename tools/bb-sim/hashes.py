"""Bladeburner with hashes exchanged for rank/SP: python3 hashes.py <prefix> <hours> [seeds=2] [sleeve variant=sleevejs|none]
Hash income 50/s (tools/hacknet-sim, live BN12 mults, first hours after an install), installs every hour."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
I, D, F = ["Infiltrate Synthoids"], ["Diplomacy"], ["Field Analysis"]
C = lambda c: ["Take on contracts", c]
SLEEVES = {"sleevejs": [I, C("Retirement"), C("Bounty Hunter"), C("Tracking"), I, D, F, I], "none": []}
pre, hours = sys.argv[1], sys.argv[2]
seeds = int(sys.argv[3]) if len(sys.argv) > 3 else 2
sleeves = SLEEVES[sys.argv[4] if len(sys.argv) > 4 else "sleevejs"]
VARIANTS = {"nohash": ("0", "both"), "rank": ("50", "rank"), "sp": ("50", "sp"), "both": ("50", "both")}
jobs = [(f"{pre}_{v}_{s}", rate, on) for v, (rate, on) in VARIANTS.items() for s in range(1, seeds + 1)]
def run(j):
    env = dict(os.environ, SIM_PLAYER=f"{OUT}/live-player.json", SIM_SLEEVES_FILE=f"{OUT}/live-sleeves.json",
               SIM_SLEEVE_TASKS=json.dumps(sleeves), SIM_HASH_RATE=j[1], SIM_HASH_ON=j[2], SIM_INSTALL_H="1")
    subprocess.run([f"{HERE}/run.sh", j[0], hours, "100", "{}"], stdout=subprocess.DEVNULL, env=env)
with ThreadPoolExecutor(14) as ex: list(ex.map(run, jobs))
subprocess.run(["python3", f"{HERE}/report.py", *[j[0] for j in jobs]])
