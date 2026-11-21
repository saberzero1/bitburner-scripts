"""Summarize darknet depth-progress runs: python3 cross-report.py <tag> [<tag> ...]"""
import json, os, sys, statistics
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
for tag in sys.argv[1:]:
    try:
        d = json.load(open(f"{OUT}/cross-{tag}.json"))
    except FileNotFoundError:
        print(f"{tag}: no output (see out/cross-{tag}.log)")
        continue
    rs = d["results"]
    done = [r["labAt"] for r in rs if r["labAt"] is not None]
    segs = sorted({int(k) for r in rs for k in r["segReached"]})
    seg_txt = " ".join(
        f"s{s}:{statistics.median([r['segReached'][str(s)] for r in rs if str(s) in r['segReached']]):.1f}h({sum(str(s) in r['segReached'] for r in rs)})"
        for s in segs)
    print(f"{tag:<18} {d['policy']:<10} anchors={d['anchors']:<8} lab reached {len(done)}/{len(rs)}"
          f" median {statistics.median(done) if done else float('nan'):.2f}h | {seg_txt} |"
          f" migr {sum(r['migrations'] for r in rs)/len(rs):.0f} cross {sum(r['crossings'] for r in rs)/len(rs):.1f}"
          f" kills {sum(r['probeKills'] for r in rs)/len(rs):.0f}")
