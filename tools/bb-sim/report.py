"""python3 report.py <tag>... : Black Ops progress and rank over time"""
import json, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
print(f"{'run':<24}{'all done':>9}{'blackops@24h':>13}{'blackops@48h':>13}{'rank@24h':>10}{'rank end':>10}{'end h':>7}")
for tag in sys.argv[1:]:
    r = json.load(open(f"{OUT}/{tag}.json")); sm = r["samples"]
    at = lambda h: min(sm, key=lambda s: abs(s["h"] - h))
    e = sm[-1]; fin = r["finishedHours"]
    print(f"{tag:<24}{('-' if fin is None else f'{fin:.1f}h'):>9}{at(24)['blackOps']:>13}{at(48)['blackOps']:>13}{at(24)['rank']:>10.0f}{e['rank']:>10.0f}{e['h']:>7.1f}" + (f"  ERROR {r['error']}" if r.get("error") else ""))
