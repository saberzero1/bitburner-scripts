"""Summarise past BitNode runs from autopilot's log (log.autopilot.txt on home).
usage: python3 tools/run-timeline/history.py <log.autopilot.txt> [bn prefix, default 12.]
Per run: wall-clock length, playtime length reported at completion, win condition, and the installs in between
(time since the previous install, augmentations bought, NeuroFlux levels)."""
import re, sys
from datetime import datetime

path = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else "12."

def hours(text):
    unit = {"d": 24, "h": 1, "m": 1 / 60, "s": 1 / 3600}
    return sum(float(n) * unit[u] for n, u in re.findall(r"([\d.]+)\s*([dhms])", text))

runs, installs, last_bn = [], [], None
for line in open(path, encoding="utf8"):
    line = line.strip()
    m = re.match(r"(\S+)\s+Invoking ascend\.js at (.*?)\s+since last aug to install: (\d+) of (\d+) remaining augmentations(?: \+ (\d+) levels of NeuroFlux)?", line)
    if m:
        t, d, n, rem, nf = m.groups()
        installs.append((t, hours(d), int(n), int(rem), int(nf or 0)))
        continue
    m = re.match(r"(\S+)\s+BN (\S+) completed at (.*?) \((.*?)\)", line)
    if m:
        t, bn, d, how = m.groups()
        if bn == last_bn:
            continue  # repeated while the destroy is retried
        last_bn = bn
        runs.append(dict(t=t, bn=bn, hours=hours(d), how=how, installs=installs))
        installs = []

print(f"{'BN':7} {'ended':19} {'run h':>7} {'#inst':>5} {'mean gap h':>10} {'last gap h':>10} {'augs':>5} {'NF':>4}  win")
for i, r in enumerate(runs):
    if not r["bn"].startswith(prefix):
        continue
    ins = r["installs"]
    gaps = [g for _, g, _, _, _ in ins]
    # the segment after the last install (until completion)
    start = runs[i - 1]["t"] if i else None
    last = (datetime.fromisoformat(r["t"]) - datetime.fromisoformat(ins[-1][0])).total_seconds() / 3600 if ins else float("nan")
    augs = sum(n for _, _, n, _, _ in ins)
    nf = sum(x for *_, x in ins)
    mean = sum(gaps) / len(gaps) if gaps else float("nan")
    print(f"{r['bn']:7} {r['t']:19} {r['hours']:7.1f} {len(ins):5} {mean:10.2f} {last:10.2f} {augs:5} {nf:4}  {r['how']}")

# Where the time goes: each run's installs ordered by length, with how many augmentations were still left to buy.
print("\nLongest stretches between installs (h), with augmentations remaining before that install:")
for r in runs:
    if not r["bn"].startswith(prefix) or r["hours"] > 500:
        continue
    ins = r["installs"]
    top = sorted(ins, key=lambda x: -x[1])[:3]
    share = sum(g for _, g, *_ in top[:1]) / max(r["hours"], 1e-9)
    print(f"{r['bn']:7} {r['hours']:6.1f}h  longest {share:4.0%}: " + ", ".join(f"{g:.1f}h@{rem}" for _, g, _, rem, _ in top))

# Later levels are harder (requirements grow ~2%/level, multipliers shrink) but carry more NeuroFlux, so judge each
# run against the median of its neighbouring levels instead of against the whole history.
import statistics
bn12 = [r for r in runs if r["bn"].startswith(prefix) and r["hours"] < 500]
print("\nRun length vs the median of the 5 levels on either side (ratio > 1.5 = unusually slow):")
for i, r in enumerate(bn12):
    near = [x["hours"] for x in bn12[max(0, i - 5): i] + bn12[i + 1: i + 6]]
    med = statistics.median(near)
    flag = "  <-- slow" if r["hours"] > 1.5 * med else ""
    print(f"{r['bn']:7} {r['hours']:6.1f}h  neighbours {med:5.1f}h  x{r['hours'] / med:4.2f}{flag}")
