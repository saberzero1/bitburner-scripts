"""Summarise run-logger.js output (/data/run-timeline.txt on home).
usage: python3 tools/run-timeline/timeline.py <run-timeline.txt> [every hours, default 1]
For each run: an hourly row of what could gate the finish (hacking level vs the World Daemon requirement, Daedalus
reputation, next Black Operation, augmentations left), and every gap where the game was closed or frozen."""
import json, sys

path = sys.argv[1]
every = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
snaps = [json.loads(l) for l in open(path, encoding="utf8") if l.strip()]

runs = []
for s in snaps:
    key = (s["bn"], round(s["t"] / 3.6e6 - s["sinceNodeH"], 2))  # BitNode and its start time identify a run
    if not runs or runs[-1][0] != key:
        runs.append((key, []))
    runs[-1][1].append(s)

def m(x):
    return "-" if x is None else f"{x:.3g}"

for (bn, _), rows in runs:
    gaps = [r["gapH"] for r in rows if r.get("gapH")]
    print(f"\n== BN {bn}: {rows[-1]['sinceNodeH']:.1f}h logged, {len(rows)} snapshots, gaps {sum(gaps):.1f}h ({len(gaps)})")
    print(f"{'h':>6} {'augH':>5} {'inst':>4} {'NF':>4} {'hack':>6} {'req':>6} {'money':>8} {'$/s':>8} {'daedalus':>8} {'bb rank':>8} next black op        augs left  gap")
    next_at = 0
    for r in rows:
        if r["sinceNodeH"] < next_at and not r.get("gapH") and r is not rows[-1]:
            continue
        next_at = r["sinceNodeH"] + every
        p, bb, a = r.get("player") or {}, r.get("bladeburner") or {}, r.get("augs") or {}
        nxt = (bb.get("next") or {}).get("name", "") if bb else ""
        print(f"{r['sinceNodeH']:6.1f} {r['sinceAugH']:5.1f} {r['installed']:4} {r['nf']:4} {m(p.get('hack')):>6} {m(r.get('daemonReq')):>6} "
              f"{m(p.get('money')):>8} {m(r.get('income')):>8} {m(r.get('daedalus')):>8} {m(bb.get('rank')):>8} {nxt[:20]:20} "
              f"{a.get('unpurchased', '-'):>9}  {r.get('gapH', '')}")
