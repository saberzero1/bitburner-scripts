"""python3 report.py <tag>... : time to faction rep milestones, territory, respect, gang income"""
import json, os, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
def first(sm, f):
    return next((s["h"] for s in sm if f(s)), None)
print(f"{'run':<22}{'rep>1.875m':>11}{'rep>10m':>9}{'terr@24h':>9}{'terr end':>9}{'respect end':>12}{'gang $/s end':>13}{'upgrades':>9}{'player $ end':>13}")
for tag in sys.argv[1:]:
    r = json.load(open(f"{OUT}/{tag}.json")); sm = r["samples"]
    at = lambda h: min(sm, key=lambda s: abs(s["h"] - h))
    t = lambda v: "-" if v is None else f"{v:.1f}h"
    e = sm[-1]
    print(f"{tag:<22}{t(first(sm, lambda s: s.get('factionRep', 0) > 1.875e6)):>11}{t(first(sm, lambda s: s.get('factionRep', 0) > 1e7)):>9}{at(24)['territory']:>9.0%}{e['territory']:>9.0%}{e['respect']:>12.3g}{e['moneyGainRate']:>13.3g}{sum(m['upg'] for m in e['memberDetail']):>9}{e['playerMoney']:>13.3g}" + (f"  ERROR {r['error']}" if r.get("error") else ""))
