"""Summarize a darknet solver benchmark: python3 report.py <tag>"""
import json, os, sys, collections, statistics
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
rows = json.load(open(f"{OUT}/{sys.argv[1]}.json"))
by = collections.defaultdict(list)
for r in rows: by[(r["model"], r["difficulty"])].append(r)
diffs = sorted({r["difficulty"] for r in rows})
models = sorted({r["model"] for r in rows})
print(f"{'model':<22}" + "".join(f"{'d='+str(d):>18}" for d in diffs) + "   (success% / median attempts / max)")
for m in models:
    line = f"{m:<22}"
    for d in diffs:
        g = by.get((m, d), [])
        if not g: line += f"{'-':>18}"; continue
        ok = [x for x in g if x["success"]]
        med = statistics.median([x["attempts"] for x in ok]) if ok else float("nan")
        line += f"{len(ok)/len(g):>8.0%} {med:>4.0f} {max(x['attempts'] for x in g):>4}"
    errs = collections.Counter(x["error"] for x in by_m if x["error"]) if (by_m := [x for x in rows if x["model"] == m]) else {}
    print(line + ("   " + "; ".join(f"{k}x{v}" for k, v in errs.items()) if errs else ""))
