"""python3 sweep.py <prefix> <hours> <capital> <4s 0|1> <spec file> [seeds=3]: run stock-sim variants in parallel"""
import json, os, subprocess, sys, statistics
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "out")
pre, hours, capital, has4s, spec = sys.argv[1:6]
seeds = int(sys.argv[6]) if len(sys.argv) > 6 else 3
variants = [(l.split(None, 1)[0], l.split(None, 1)[1].strip()) for l in open(spec) if l.strip() and not l.startswith("#")]
jobs = [(f"{pre}_{v}_{s}", a) for v, a in variants for s in range(1, seeds + 1)]
run = lambda j: subprocess.run([f"{HERE}/run.sh", j[0], hours, capital, has4s, j[1]], stdout=subprocess.DEVNULL)
with ThreadPoolExecutor(14) as ex: list(ex.map(run, jobs))
print(f"{'variant':<22}{'4S at (mean)':>13}{'x@12h (geo)':>12}{'x@24h (geo)':>12}")
geo = lambda xs: statistics.geometric_mean(xs) if xs and all(x > 0 for x in xs) else float('nan')
for v, _ in variants:
    t4, x12, x24 = [], [], []
    for s in range(1, seeds + 1):
        r = json.load(open(f"{OUT}/{pre}_{v}_{s}.json")); sm = r["samples"]; c = r["capital"]
        t = next((x["h"] for x in sm if x["has4S"]), None); t4.append(t if t is not None else float(hours))
        for h, arr in ((12, x12), (24, x24)):
            m = [x for x in sm if abs(x["h"] - h) < 0.09]
            if m: arr.append(m[0]["netWorth"] / c)
    print(f"{v:<22}{statistics.mean(t4):>12.1f}h{geo(x12):>12.3g}{geo(x24):>12.3g}")
