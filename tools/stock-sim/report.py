"""python3 report.py <tag>... : net worth multiple over time and when 4S was bought"""
import json, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
hs = [1, 3, 6, 12, 24]
print(f"{'run':<26}{'capital':>9}" + "".join(f"{'x@'+str(h)+'h':>10}" for h in hs) + f"{'4S at':>8}")
for tag in sys.argv[1:]:
    r = json.load(open(f"{OUT}/{tag}.json")); sm = r["samples"]; c = r["capital"]
    row = f"{tag:<26}{c:>9.0e}"
    for h in hs:
        s = [x for x in sm if abs(x["h"] - h) < 0.09]
        row += f"{(s[0]['netWorth'] / c):>10.3g}" if s else f"{'-':>10}"
    t4 = next((x["h"] for x in sm if x["has4S"]), None)
    print(row + f"{('-' if t4 is None else f'{t4:.1f}h'):>8}" + (f"  ERROR {r['error']}" if r.get("error") else ""))
