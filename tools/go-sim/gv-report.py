"""Summarize go.js runs per tag prefix: python3 gv-report.py <prefix>"""
import json, glob, os, sys
for f in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", sys.argv[1] + "*.json"))):
    r = json.load(open(f)); g = [x for x in r["games"] if "error" not in x]
    if len(g) < 2: print(os.path.basename(f), "no games"); continue
    g = g[1:]
    sec = sum(x["ms"] for x in g) / 1000
    cpu = (g[-1].get("searchMs", 0) - r["games"][0].get("searchMs", 0)) / 1000
    print(f"{os.path.basename(f)[:-5]:<26} {len(g):>3} games  won {sum(x['won'] for x in g)/len(g):>4.0%}  {sec/len(g):>5.1f}s/game (search {cpu/len(g):>4.1f}s)"
          f"  power/h {sum(x['power'] for x in g)/sec*3600:>7.0f}  cheats/g {sum((x.get('cheats') or 0) for x in g)/len(g):.1f}")
