"""Summarize sweep runs: tools/corp-sim/out/<prefix>_<tag>-<seed>.json -> takeoff time per tag."""
import json, glob, os, sys, re, statistics
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
pre = sys.argv[1]
TH = [1e8, 1e10, 1e12]
rows = {}
for f in sorted(glob.glob(f"{OUT}/{pre}_*.json")):
    tag, seed = re.match(rf"{pre}_(.*)-(\w+)\.json", os.path.basename(f)).groups()
    try: r = json.load(open(f))
    except Exception: continue
    sm = r["samples"]
    t = [next((s["h"] for s in sm if s["profit"] > th), None) for th in TH]
    rows.setdefault(tag, []).append(t)
print(f"{'setting':<14}{'n':>3}" + "".join(f"{'>'+f'{th:.0e}'+'/s':>14}" for th in TH) + "   (hours, mean of seeds; '>72' = not reached)")
def cell(vals):
    got = [v for v in vals if v is not None]
    if not got: return ">72"
    m = statistics.mean(got)
    return f"{m:.1f}" + ("" if len(got) == len(vals) else f" ({len(got)}/{len(vals)})")
for tag, ts in sorted(rows.items(), key=lambda kv: statistics.mean([x[2] if x[2] is not None else 99 for x in kv[1]])):
    print(f"{tag:<14}{len(ts):>3}" + "".join(f"{cell([x[i] for x in ts]):>14}" for i in range(3)))
