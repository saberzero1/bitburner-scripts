# Placement search for stanek.js.create.js --hacking: both hacking fragments (ids 0, 1) ringed by as many distinct
# boosters (ids 100-107) as fit, per grid size. usage: python3 tools/stanek-hacking-layouts.py fragdefs.json out.json [ids]
# (ids: the fragments to ring, default "0,1"; "18" = charisma alone, for --charisma before The Red Pill)
# (fragdefs.json: JSON of ns.stanek.fragmentDefinitions() with id, type, power, shape). Mirrors the game's Fragment.fullAt.
import json, random, sys, multiprocessing as mp
defs = {f['id']: f for f in json.load(open(sys.argv[1]))}
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
def placements(fid, W, H):
    s = defs[fid]['shape']; out = []
    for r in range(4):
        w, h = dims(s, r)
        for x in range(W - w + 1):
            for y in range(H - h + 1):
                cs = frozenset((x + cx, y + cy) for cy in range(h) for cx in range(w) if full(s, cx, cy, r))
                out.append((fid, x, y, r, cs))
    # dedupe identical cell sets (symmetric rotations)
    seen, uniq = set(), []
    for p in out:
        if p[4] not in seen: seen.add(p[4]); uniq.append(p)
    return uniq
def nbrs(cs): return {(x + dx, y + dy) for x, y in cs for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))} - cs
IDS = [int(i) for i in (sys.argv[3] if len(sys.argv) > 3 else "0,1").split(",")]
def search(size, budget=60000, seed=1):
    W, H = size; rnd = random.Random(seed)
    P0 = placements(IDS[0], W, H)
    P1 = placements(IDS[1], W, H) if len(IDS) > 1 else []
    B = [p for b in range(100, 108) for p in placements(b, W, H)]
    best = (-1, None)
    pairs = [(a, b) for a in P0 for b in P1 if not (a[4] & b[4])]
    singles = [(a, None) for a in P0]
    rnd.shuffle(pairs)
    work = pairs if pairs else singles
    trials = max(2, budget // max(1, len(work)))
    for a, b in work[:max(1, budget // trials)]:
        used0 = set(a[4] | (b[4] if b else set())); n0 = nbrs(a[4]); n1 = nbrs(b[4]) if b else set()
        for t in range(trials):
            u = set(used0); k0 = k1 = 0; placed = []
            while True:
                cands = []
                for c in B:
                    if c[4] & u: continue
                    t0, t1 = bool(c[4] & n0), bool(c[4] & n1)
                    if t0 or t1: cands.append((t0 + t1, -len(c[4] & (nbrs(a[4]) | n1)), c, t0, t1))
                if not cands: break
                top = max(x[0] for x in cands)
                pool = [x for x in cands if x[0] == top]
                if t > 0 and rnd.random() < 0.3: pool = cands  # explore
                _, _, c, t0, t1 = rnd.choice(pool)
                u |= c[4]; k0 += t0; k1 += t1; placed.append(c)
            key = (k0 + k1, min(k0, k1))
            if best[1] is None or key > best[0]: best = (key, (a, b, placed, k0, k1))
    key, (a, b, placed, k0, k1) = best
    frags = [a] + ([b] if b else []) + placed
    grid = [['.'] * W for _ in range(H)]
    for i, p in enumerate(frags):
        ch = 'H' if p[0] < 100 else chr(ord('a') + (i - 2) % 26)
        for x, y in p[4]: grid[y][x] = ch
    return {"width": W, "height": H, "k": [k0, k1] if b else [k0], "grid": [''.join(r) for r in grid],
            "fragments": [{"id": p[0], "x": p[1], "y": p[2], "rotation": p[3]} for p in frags]}
def _job(j): return search(*j)
if __name__ == "__main__":
    sizes = [(5,5),(6,5),(6,6),(7,6),(7,7),(8,7),(8,8),(9,8),(9,9),(10,9),(10,10),(11,10),(11,11),(12,11),(12,12),(13,12),(13,13)]
    # BUDGET / SEEDS env: more trials and several seeds per size, keeping the best (sum of boosters, then the weaker side)
    import os
    budget, seeds = int(os.environ.get("BUDGET", 60000)), int(os.environ.get("SEEDS", 1))
    jobs = [(sz, budget, sd) for sz in sizes for sd in range(1, seeds + 1)]
    # (each result is appended to <out>.partial as it finishes, so a long search keeps what it found if it's stopped)
    allres = []
    with mp.Pool(min(len(jobs), max(1, mp.cpu_count() - 2))) as pool, open(sys.argv[2] + ".partial", "a") as part:
        for r in pool.imap_unordered(_job, jobs):
            allres.append(r); part.write(json.dumps(r) + "\n"); part.flush()
            print("found", r['width'], 'x', r['height'], 'k', r['k'], flush=True)
    best = {}
    for r in allres:
        key, cur = (r['width'], r['height']), best.get((r['width'], r['height']))
        score = (sum(r['k']), min(r['k']))
        if not cur or score > (sum(cur['k']), min(cur['k'])): best[key] = r
    res = [best[sz] for sz in sizes]
    json.dump(res, open(sys.argv[2], 'w'))
    for r in res: print(r['width'], 'x', r['height'], 'k', r['k'], 'boosters', len(r['fragments']) - len(r['k']))
