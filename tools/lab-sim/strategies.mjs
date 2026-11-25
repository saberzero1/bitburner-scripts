// Labyrinth solver strategies on the game's own maze generator (ported from bitburner-src DarkNet/effects/labyrinth.ts:
// generateMaze/mazeMaker/getRandomOffset), node only (no jest/engine): `node tools/lab-sim/strategies.mjs [mazes] [w] [h]`.
// A move = one authenticate call (a wall bump costs one too). Walls of the cell moved into come with each response.
const WALL = 1, PATH = 0;
const N = [0, -1], E = [1, 0], S = [0, 1], W = [-1, 0];
function mazeMaker(sw, sh) {
    const w = sw % 2 === 0 ? sw + 1 : sw, h = sh % 2 === 0 ? sh + 1 : sh;
    const m = Array.from({ length: h }, () => Array(w).fill(WALL));
    const st = [[1, 1]];
    while (st.length) {
        const [x, y] = st.pop();
        const nb = [N, E, S, W].map(([dx, dy]) => [x + dx * 2, y + dy * 2]).filter(([a, b]) => a > 0 && a < w && b > 0 && b < h && m[b][a] === WALL);
        if (nb.length) {
            st.push([x, y]);
            const [a, b] = nb[Math.floor(Math.random() * nb.length)];
            m[(y + b) / 2][(x + a) / 2] = PATH;
            m[b][a] = PATH;
            st.push([a, b]);
        }
    }
    return m;
}
function generateMaze(width, height) {
    const hw = Math.ceil(width / 2), hh = Math.ceil(height / 2);
    const [m1, m2, m3, m4] = [0, 0, 0, 0].map(() => mazeMaker(hw, hh));
    const top = m1.map((r, y) => r.slice(0, -1).concat(m2[y])), bot = m3.map((r, y) => r.slice(0, -1).concat(m4[y]));
    const m = top.slice(0, -1).concat(bot);
    const sw = m1[0].length - 1, sh = m1.length - 1;
    m[Math.floor((Math.random() * hh) / 4) * 2 + 1][sw] = PATH;
    m[sh][Math.floor((Math.random() * hw) / 4) * 2 + 1] = PATH;
    m[m.length - (Math.floor((Math.random() * hh) / 4) * 2 + 1) - 1][sw] = PATH;
    m[sh][m[0].length - (Math.floor((Math.random() * hw) / 4) * 2 + 1) - 1] = PATH;
    return m;
}
const offset = (len, on) => (on ? Math.floor(Math.random() * Math.min(3, len / 4)) * 2 : 0);

const DIRS = { north: N, east: E, south: S, west: W };
const key = (x, y) => x * 10000 + y;

/** One solver run. know: shared map {open: Map(cellKey -> {north,...}), } (mutated). Returns moves. */
function solve(maze, start, end, cands, strat, know = { open: new Map() }) {
    const H = maze.length, Wd = maze[0].length;
    const wallsAt = (x, y) => ({ north: maze[y - 1][x] === PATH, south: maze[y + 1][x] === PATH, west: maze[y][x - 1] === PATH, east: maze[y][x + 1] === PATH });
    let [x, y] = start, moves = 0;
    know.open.set(key(x, y), wallsAt(x, y));
    const visitedLocal = new Set([key(x, y)]);
    const stack = [];
    const aim = [Wd - 2, H - 2];
    const h = (cx, cy) => Math.min(...cands.map(([a, b]) => Math.abs(a - cx) + Math.abs(b - cy)));
    const known = (cx, cy) => know.open.has(key(cx, cy));
    // Can an exit candidate still lie beyond (nx, ny), entered from a known cell? Flood fill over cells not known yet,
    // through edges not known to be walls (only known cells' walls are known), never entering known cells.
    const regionHasExit = (nx, ny) => {
        if (cands.some(([a, b]) => a === nx && b === ny)) return true;
        const seen = new Set([key(nx, ny)]), q = [[nx, ny]];
        while (q.length) {
            const [cx, cy] = q.pop();
            for (const [dx, dy] of [N, E, S, W]) {
                const ax = cx + 2 * dx, ay = cy + 2 * dy;
                if (ax < 1 || ay < 1 || ax > Wd - 2 || ay > H - 2) continue;
                const k = key(ax, ay);
                if (seen.has(k) || known(ax, ay)) continue; // known cells: their open sides are already frontiers of their own
                seen.add(k);
                if (cands.some(([a, b]) => a === ax && b === ay)) return true;
                q.push([ax, ay]);
            }
        }
        return false;
    };
    const step = (d) => { moves++; x += 2 * DIRS[d][0]; y += 2 * DIRS[d][1]; know.open.set(key(x, y), wallsAt(x, y)); };
    const isEnd = () => x === end[0] && y === end[1];
    if (isEnd()) return 0;
    if (strat.kind === "dfs") {
        const rev = { north: "south", south: "north", east: "west", west: "east" };
        for (let i = 0; i < 1e6; i++) {
            const open = know.open.get(key(x, y));
            const score = (d) => (aim[0] - x) * DIRS[d][0] + (aim[1] - y) * DIRS[d][1];
            const order = Object.keys(DIRS).sort((a, b) => score(b) - score(a));
            const dir = order.find((d) => {
                const nx = x + 2 * DIRS[d][0], ny = y + 2 * DIRS[d][1];
                if (!open[d] || visitedLocal.has(key(nx, ny))) return false;
                return !strat.prune || regionHasExit(nx, ny);
            });
            if (dir) { stack.push(dir); step(dir); visitedLocal.add(key(x, y)); }
            else { if (!stack.length) return Infinity; step(rev[stack.pop()]); }
            if (isEnd()) return moves;
        }
    }
    // Best-first: frontier = (known cell, open side to an unknown cell, region may hold the exit); pick the one minimising
    // walk distance (BFS over known cells) + weight x heuristic distance to the exit; walk there, step through.
    for (let i = 0; i < 1e5; i++) {
        const dist = new Map([[key(x, y), 0]]), prev = new Map(), q = [[x, y]];
        let best = null;
        for (let qi = 0; qi < q.length; qi++) {
            const [cx, cy] = q[qi], dc = dist.get(key(cx, cy)), open = know.open.get(key(cx, cy));
            for (const d of Object.keys(DIRS)) {
                if (!open[d]) continue;
                const nx = cx + 2 * DIRS[d][0], ny = cy + 2 * DIRS[d][1], k = key(nx, ny);
                if (known(nx, ny)) { if (!dist.has(k)) { dist.set(k, dc + 1); prev.set(k, [cx, cy, d]); q.push([nx, ny]); } continue; }
                if (strat.prune && !regionHasExit(nx, ny)) continue;
                const cost = dc + 1 + strat.w * h(nx, ny);
                if (!best || cost < best.cost) best = { cost, cx, cy, d };
            }
        }
        if (!best) return Infinity;
        // walk to (best.cx, best.cy) along prev, then step d
        const path = [];
        for (let k = key(best.cx, best.cy); prev.has(k);) { const [px, py, d] = prev.get(k); path.push(d); k = key(px, py); }
        for (const d of path.reverse()) step(d);
        step(best.d);
        if (isEnd()) return moves;
    }
    return Infinity;
}

const mazes = Number(process.argv[2] ?? 500), MW = Number(process.argv[3] ?? 60), MH = Number(process.argv[4] ?? 40), off = MW >= 60;
const strategies = {
    "dfs (current)": { kind: "dfs" },
    "dfs + prune": { kind: "dfs", prune: true },
    "best-first w1 + prune": { kind: "bf", w: 1, prune: true },
    "best-first w2 + prune": { kind: "bf", w: 2, prune: true },
    "best-first w0.5 + prune": { kind: "bf", w: 0.5, prune: true },
};
const res = Object.fromEntries(Object.keys(strategies).map((k) => [k, []]));
const relay = { solo: [], relay25: [], relay50: [], relay75: [] };
for (let i = 0; i < mazes; i++) {
    const m = generateMaze(MW, MH);
    const end = [m[0].length - 2 - offset(m.length, off), m.length - 2 - offset(m.length, off)];
    // Exit candidates the solver can assume: every offset the game could pick
    const cands = [];
    for (const ox of off ? [0, 2, 4] : [0]) for (const oy of off ? [0, 2, 4] : [0]) cands.push([m[0].length - 2 - ox, m.length - 2 - oy]);
    const start = () => [1 + offset(m.length, off), 1 + offset(m.length, off)];
    const s0 = start();
    for (const [name, st] of Object.entries(strategies)) res[name].push(solve(m, s0, end, off ? cands : [end], st));
    // Shared map: a first solver (best strategy) stops after a fraction of its moves; a fresh one (new PID: new start)
    // continues with its map. Total moves of the second (the first's were already spent).
    const best = { kind: "bf", w: 1, prune: true };
    const full = solve(m, s0, end, off ? cands : [end], best);
    relay.solo.push(full);
    for (const [name, frac] of [["relay25", 0.25], ["relay50", 0.5], ["relay75", 0.75]]) {
        // replay the first solver for frac of its moves by running with a move cap: approximate by a solver whose map is
        // the cells it knew after that many moves
        const know = { open: new Map() };
        solveCapped(m, s0, end, off ? cands : [end], best, know, Math.floor(full * frac));
        relay[name].push(solve(m, start(), end, off ? cands : [end], best, know));
    }
}
function solveCapped(m, s0, end, cands, st, know, cap) {
    // run the solver but stop recording knowledge after `cap` moves (by re-running with a tiny wrapper)
    const orig = know.open, capped = new Map();
    let n = 0;
    const proxy = { open: { set(k, v) { if (n++ <= cap + 1) capped.set(k, v); orig.set(k, v); return this; }, get: (k) => orig.get(k), has: (k) => orig.has(k) } };
    solve(m, s0, end, cands, st, proxy);
    know.open = capped;
}
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return `mean ${(a.reduce((t, v) => t + v, 0) / a.length).toFixed(0).padStart(5)}  median ${String(s[Math.floor(s.length / 2)]).padStart(5)}  p90 ${String(s[Math.floor(s.length * 0.9)]).padStart(5)}`; };
console.log(`${mazes} mazes ${MW}x${MH}${off ? " (start/end offsets)" : ""}`);
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(26), stat(v));
console.log("shared map (second solver's moves after the first stopped at 25/50/75% of its solo moves):");
for (const [k, v] of Object.entries(relay)) console.log(" ", k.padEnd(10), stat(v));

// Parallel solvers (separate PIDs, e.g. on different labyrinth neighbours) sharing one map: each round every solver makes
// one move; each heads for its own best frontier (best-first + prune), frontiers claimed by another solver are skipped.
// Rounds until any solver reaches the exit (equal move speeds).
function parallel(maze, starts, end, cands) {
    const H = maze.length, Wd = maze[0].length, open = new Map();
    const wallsAt = (x, y) => ({ north: maze[y - 1][x] === PATH, south: maze[y + 1][x] === PATH, west: maze[y][x - 1] === PATH, east: maze[y][x + 1] === PATH });
    const h = (cx, cy) => Math.min(...cands.map(([a, b]) => Math.abs(a - cx) + Math.abs(b - cy)));
    const SV = starts.map(([x, y]) => { open.set(key(x, y), wallsAt(x, y)); return { x, y, path: [], target: null }; });
    const regionHasExit = (nx, ny, reach) => {
        if (cands.some(([a, b]) => a === nx && b === ny)) return true;
        const seen = new Set([key(nx, ny)]), q = [[nx, ny]];
        while (q.length) {
            const [cx, cy] = q.pop();
            for (const [dx, dy] of [N, E, S_, W]) {
                const ax = cx + 2 * dx, ay = cy + 2 * dy, k = key(ax, ay);
                if (ax < 1 || ay < 1 || ax > Wd - 2 || ay > H - 2 || seen.has(k) || reach.has(k)) continue;
                seen.add(k);
                if (cands.some(([a, b]) => a === ax && b === ay)) return true;
                q.push([ax, ay]);
            }
        }
        return false;
    };
    const plan = (s) => {
        const dist = new Map([[key(s.x, s.y), 0]]), prev = new Map(), q = [[s.x, s.y]];
        let best = null;
        // a frontier another solver is heading for is theirs only if they'll get there first
        const claimed = new Map(SV.filter((o) => o !== s && o.target).map((o) => [o.target, o.path.length]));
        for (let qi = 0; qi < q.length; qi++) {
            const [cx, cy] = q[qi], dc = dist.get(key(cx, cy)), o = open.get(key(cx, cy));
            for (const d of Object.keys(DIRS)) {
                if (!o[d]) continue;
                const nx = cx + 2 * DIRS[d][0], ny = cy + 2 * DIRS[d][1], k = key(nx, ny);
                if (open.has(k)) { if (!dist.has(k)) { dist.set(k, dc + 1); prev.set(k, [cx, cy, d]); q.push([nx, ny]); } continue; }
                if ((claimed.get(k) ?? Infinity) <= dc + 1 || !regionHasExit(nx, ny, open)) continue;
                const cost = dc + 1 + h(nx, ny);
                if (!best || cost < best.cost) best = { cost, cx, cy, d, k };
            }
        }
        if (!best) { s.path = []; s.target = null; return; }
        const path = [];
        for (let k = key(best.cx, best.cy); prev.has(k);) { const [px, py, d] = prev.get(k); path.push(d); k = key(px, py); }
        s.path = [...path.reverse(), best.d];
        s.target = best.k;
    };
    for (let round = 1; round < 1e5; round++) {
        for (const s of SV) {
            if (!s.path.length || (s.target && open.has(s.target))) plan(s); // done, or another solver explored it
            const d = s.path.shift();
            if (!d) continue;
            s.x += 2 * DIRS[d][0]; s.y += 2 * DIRS[d][1];
            open.set(key(s.x, s.y), wallsAt(s.x, s.y));
            if (s.x === end[0] && s.y === end[1]) return round;
            if (!s.path.length) s.target = null;
        }
    }
    return Infinity;
}
const S_ = S;
const par = { 1: [], 2: [], 3: [], 4: [] };
for (let i = 0; i < mazes; i++) {
    const m = generateMaze(MW, MH);
    const end = [m[0].length - 2 - offset(m.length, off), m.length - 2 - offset(m.length, off)];
    const cands = [];
    for (const ox of off ? [0, 2, 4] : [0]) for (const oy of off ? [0, 2, 4] : [0]) cands.push([m[0].length - 2 - ox, m.length - 2 - oy]);
    for (const k of [1, 2, 3, 4]) par[k].push(parallel(m, Array.from({ length: k }, () => [1 + offset(m.length, off), 1 + offset(m.length, off)]), end, off ? cands : [end]));
}
console.log("parallel solvers sharing the map (rounds = moves per solver until one exits):");
for (const [k, v] of Object.entries(par)) console.log(`  ${k} solver(s)`.padEnd(14), stat(v));
