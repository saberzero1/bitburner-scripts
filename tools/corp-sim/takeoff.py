import json, glob, os, sys
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
def first(sm, f):
    for s in sm:
        if f(s): return s["h"]
    return None
def fmt(x):
    if x is None: return "-"
    if abs(x) >= 1e15: return f"{x:.1e}"
    for u, d in (("t", 1e12), ("b", 1e9), ("m", 1e6), ("k", 1e3)):
        if abs(x) >= d: return f"{x/d:.1f}{u}"
    return f"{x:.0f}"
for pre in sys.argv[1:]:
    print(f"\n=== {pre} ===")
    print(f"{'rounds':<7}{'owned':>7}{'raised':>9}{'profit>$100m/s':>16}{'>$10b/s':>9}{'>$1t/s':>8}{'div@12h':>10}{'div@24h':>10}{'div@48h':>10}{'div@72h':>10}")
    for f in sorted(glob.glob(f"{S}/{pre}_r*.json")):
        r = json.load(open(f)); sm = r["samples"]
        raised = sum(float(e.split("$")[-1].rstrip("b")) * 1e9 for e in r["events"] if "Accepting" in e)
        own = sm[-1]["owned"] / sm[-1]["total"]
        t = lambda th: first(sm, lambda s: s["profit"] > th)
        div = lambda h: next((s["dividends"] for s in sm if abs(s["h"] - h) < 0.1), None)
        ts = lambda v: "-" if v is None else f"{v:.1f}h"
        print(f"{f.split('_r')[-1][:-5]:<7}{own:>7.0%}{fmt(raised):>9}{ts(t(1e8)):>16}{ts(t(1e10)):>9}{ts(t(1e12)):>8}" + "".join(f"{fmt(div(h)):>10}" for h in (12, 24, 48, 72)))
