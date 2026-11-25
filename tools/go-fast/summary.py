"""Combine analyze.mjs shards: python3 tools/go-fast/summary.py tools/go-fast/out/losses-ill"""
import json, glob, sys, collections, statistics
games = [g for f in sorted(glob.glob(sys.argv[1] + ".analysis-*.json")) for g in json.load(open(f))]
lost = [g for g in games if not g["won"]]; won = [g for g in games if g["won"]]
m = lambda a: statistics.mean(a) if a else float("nan")
print(f"games {len(games)}: {len(lost)} lost, {len(won)} won")
print(f"offline nodes: lost {m([g['offline'] for g in lost]):.2f}, won {m([g['offline'] for g in won]):.2f}")
first = lambda g: g["turns"][0]["deepBest"] if g["turns"] else float("nan")
print(f"deep estimate before our first move: lost {m([first(g) for g in lost]):.2f}, won {m([first(g) for g in won]):.2f}")
print("lost games by starting estimate:", collections.Counter(f"{min(int(first(g)*10),9)/10:.1f}" for g in lost))
col = collections.Counter(); bl = collections.Counter(); blcheat = 0; nbl = 0; drops = []
for g in lost:
    c = None
    for t in g["turns"]:
        if t["played"] is None: continue
        if t["deepBest"] - t["played"] >= 0.15:
            bl[t["i"]] += 1; nbl += 1; blcheat += bool(t.get("cheat"))
        if c is None and t["played"] < 0.3: c = t["i"]
    col[c] += 1
    # biggest single drop of the estimate along the game (played value vs previous played value)
    vals = [t["played"] for t in g["turns"] if t["played"] is not None]
    drops.append(max([a - b for a, b in zip(vals, vals[1:])], default=0))
print("turn the deep estimate first fell below 0.3:", dict(sorted(col.items(), key=lambda kv: (kv[0] is None, kv[0] or 0))))
print(f"blunders (deep best beats played by >= 0.15): {nbl} in lost games, by turn {dict(sorted(bl.items()))}, on cheat turns {blcheat}")
wbl = sum(1 for g in won for t in g["turns"] if t["played"] is not None and t["deepBest"] - t["played"] >= 0.15)
print(f"same blunder rate in won games: {wbl / max(1, len(won)):.2f}/game vs lost {nbl / max(1, len(lost)):.2f}/game")
print(f"largest single drop between our moves (opponent's reply), lost games: median {statistics.median(drops):.2f}")
