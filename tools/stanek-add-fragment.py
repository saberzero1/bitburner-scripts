# Add one more fragment to stanek.js.create.js's hacking layouts without touching them: the best free spot for it, counting
# the layout's boosters it touches (a booster boosts every adjacent fragment, so these cost the hacking pair nothing) plus
# new boosters placed greedily in still-free cells touching it.
# usage: python3 tools/stanek-add-fragment.py fragdefs.json servers/home/stanek.js.create.js 18 out.json
import json, re, sys, random
defs = {f['id']: f for f in json.load(open(sys.argv[1]))}
src = open(sys.argv[2]).read()
EXTRA = int(sys.argv[3])
block = src[src.index('const hackingLayouts = ['):]
block = block[:block.index('\n];')]
layouts = [{'height': int(m.group(1)), 'width': int(m.group(2)), 'boosters': int(m.group(3)), 'fragments': json.loads(m.group(4))}
           for m in re.finditer(r'\{ height: (\d+), width: (\d+), boosters: (\d+), fragments: (\[.*?\]) \}', block)]

def dims(shape, r): return (len(shape[0]), len(shape)) if r % 2 == 0 else (len(shape), len(shape[0]))
def full(shape, x, y, r):
    w, h = dims(shape, r)
    if not (0 <= x < w and 0 <= y < h): return False
    sx, sy, mx, my = 0, 0, 1, 1
    if r == 1: sx, sy, mx, my = w - 1, 0, -1, 1
    elif r == 2: sx, sy, mx, my = w - 1, h - 1, -1, -1
    elif r == 3: sx, sy, mx, my = 0, h - 1, 1, -1
    qx, qy = sx + mx * x, sy + my * y
    if r % 2 == 1: qx, qy = qy, qx
    return bool(shape[qy][qx])
def cells(fid, x, y, r):
    s = defs[fid]['shape']; w, h = dims(s, r)
    return frozenset((x + cx, y + cy) for cy in range(h) for cx in range(w) if full(s, cx, cy, r))
def placements(fid, W, H):
    s = defs[fid]['shape']; out, seen = [], set()
    for r in range(4):
        w, h = dims(s, r)
        for x in range(W - w + 1):
            for y in range(H - h + 1):
                cs = cells(fid, x, y, r)
                if cs not in seen: seen.add(cs); out.append((fid, x, y, r, cs))
    return out
def nbrs(cs): return {(x + dx, y + dy) for x, y in cs for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))} - cs

out = []
for L in layouts:
    W, H = L['width'], L['height']
    placed = [(f['id'], cells(f['id'], f['x'], f['y'], f['rotation'])) for f in L['fragments']]
    used = set().union(*[c for _, c in placed])
    boosters = [c for fid, c in placed if fid >= 100]
    B = [p for b in range(100, 108) for p in placements(b, W, H)]
    best = None
    rnd = random.Random(1)
    for e in placements(EXTRA, W, H):
        if e[4] & used: continue
        n = nbrs(e[4])
        shared = sum(1 for c in boosters if c & n)
        for t in range(30):  # greedy new boosters touching it, randomised
            u = used | e[4]; added = []
            while True:
                cands = [c for c in B if not (c[4] & u) and (c[4] & n)]
                if not cands: break
                c = rnd.choice(cands) if t else min(cands, key=lambda c: len(c[4]))
                u |= c[4]; added.append(c)
            score = shared + len(added)
            if not best or score > best[0]: best = (score, shared, e, added)
    if not best:
        out.append({**L, 'extra': None}); print(f"{W}x{H}: no room"); continue
    score, shared, e, added = best
    frags = L['fragments'] + [{'id': e[0], 'x': e[1], 'y': e[2], 'rotation': e[3]}] + \
            [{'id': c[0], 'x': c[1], 'y': c[2], 'rotation': c[3]} for c in added]
    out.append({**L, 'fragments': frags, 'extra': {'boosters': score, 'shared': shared, 'new': len(added)}})
    print(f"{W}x{H}: hacking boosters {L['boosters']} unchanged; fragment {EXTRA} touches {score} ({shared} shared, {len(added)} new)")
json.dump(out, open(sys.argv[4], 'w'))
