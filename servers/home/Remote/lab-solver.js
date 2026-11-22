/**
 * Darknet labyrinth solver: one process walks the maze (positions are per PID) with best-first search, pruning, and
 * a map shared with every other solver on the same labyrinth (port 27).
 *
 * Args: labHostname, result ("port:<n>" sends JSON {host, password|error} to port n; anything else is a file that gets
 * "SUCCESS" / "FAIL:<reason>"), gridW, gridH (labyrinth.ts sizes: cells at odd coordinates 1..grid-2), offsets (1 when
 * the labyrinth offsets start and end: Uber and later).
 *
 * Why (tools/lab-sim/strategies.mjs, the game's maze generator, 200-300 mazes):
 * - The maze is 4 perfect mazes (one path between any two cells) joined by 4 gaps, and the exit is the far corner or,
 *   with offsets, one of 9 cells near it. An opening whose unexplored region (flood fill through unknown cells, walled
 *   by known cells and the outer wall) holds no possible exit is skipped.
 * - Best-first: after every move, head for the opening with the lowest walk (over known cells) + distance to the exit,
 *   instead of finishing each branch depth-first. 60x40: 285 -> 194 moves on average, p90 644 -> 262.
 * - Shared map: every solver on this labyrinth (other hosts, a replacement for a slower one) merges what the others
 *   saw, and each heads for an opening no closer solver has claimed: 2 solvers 159 moves, 4 141.
 * The maze is the same for every process for the whole install (DarknetState.labyrinth); a map from an earlier maze
 * is detected by a wall mismatch and dropped (darknet.js also clears the port at startup).
 */
const MAP_PORT = 27;
const DIRS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const BIT = { north: 1, east: 2, south: 4, west: 8 };

/** @param {NS} ns */
export async function main(ns) {
    const host = String(ns.args[0]), result = String(ns.args[1]);
    let gridW = Number(ns.args[2]) || 61, gridH = Number(ns.args[3]) || 41;
    const offsets = Number(ns.args[4]) === 1;
    const me = ns.pid;
    const t0 = Date.now();
    let moves = 0, walls = 0;
    const finish = (ok, payload) => {
        // One line per solver to darknet.js's metrics (port 25): which part of a solve's time is moves, threads, waits
        try {
            const me_ = ns.self();
            ns.writePort(25, JSON.stringify({ t: Date.now(), type: "labsolve", lab: host, host: me_.server, threads: me_.threads,
                ok, why: ok ? "" : String(payload), ms: Date.now() - t0, moves, walls, cells: cells.size }));
        } catch {}
        if (result.startsWith("port:")) {
            const port = Number(result.slice(5));
            ns.writePort(port, JSON.stringify(ok ? { host, password: payload } : { host, error: payload }));
        } else ns.write(result, ok ? "SUCCESS" : "FAIL:" + payload, "w");
        dropClaim();
    };
    const key = (x, y) => x + "," + y;
    const cells = new Map(); // "x,y" -> open-side bits
    const bitsOf = (o) => (o.north ? 1 : 0) | (o.east ? 2 : 0) | (o.south ? 4 : 0) | (o.west ? 8 : 0);
    const parse = (data) => {
        const r = String(data ?? "").split("\n");
        return r.length >= 3 && r[1].length >= 3 ? { north: r[0][1] === " ", south: r[2][1] === " ", west: r[1][0] === " ", east: r[1][2] === " " } : null;
    };

    // ── Shared map (port 27: one JSON entry {lab, cells: {"x,y": bits}, claims: {pid: [cellKey, remaining, t]}}) ──
    const readShared = () => {
        try {
            const raw = ns.peek(MAP_PORT);
            if (raw === "NULL PORT DATA") return null;
            const s = JSON.parse(String(raw));
            return s && s.lab === host ? s : null;
        } catch {
            return null;
        }
    };
    const writeShared = (s) => {
        ns.clearPort(MAP_PORT);
        ns.writePort(MAP_PORT, JSON.stringify(s));
    };
    let claims = {};
    /** Merge our cells into the shared map and theirs into ours (no awaits: atomic). false if the shared map is from
     * another maze (a cell's walls differ): it's replaced by ours. */
    const sync = (claim) => {
        const s = readShared() ?? { lab: host, cells: {}, claims: {} };
        let conflict = false;
        for (const [k, b] of Object.entries(s.cells))
            if (cells.has(k) && cells.get(k) !== b) conflict = true;
        if (conflict) { s.cells = {}; s.claims = {}; }
        for (const [k, b] of Object.entries(s.cells)) if (!cells.has(k)) cells.set(k, b);
        for (const [k, b] of cells) s.cells[k] = b;
        const now = Date.now();
        for (const [p, c] of Object.entries(s.claims ?? {})) if (now - c[2] > 60_000) delete s.claims[p];
        if (claim) s.claims[me] = [claim[0], claim[1], now];
        else delete s.claims[me];
        claims = s.claims;
        writeShared(s);
        return !conflict;
    };
    function dropClaim() {
        try {
            const s = readShared();
            if (s?.claims?.[me]) { delete s.claims[me]; writeShared(s); }
        } catch {}
    }

    // ── Start ──
    let rep = null;
    for (let i = 0; i < 20 && !rep; i++) {
        try { rep = await ns.dnet.labreport(); } catch {}
        if (!rep || !rep.success) { rep = null; await ns.sleep(1000); }
    }
    if (!rep) return finish(false, "no_labreport");
    let pos = [rep.coords[0], rep.coords[1]];
    cells.set(key(pos[0], pos[1]), bitsOf(rep));
    sync(null);

    // Exit candidates: the far corner, or with offsets each of the 9 cells the game could have moved it to. Grown if
    // the maze turns out larger (the bonus labyrinth grows with The Thread); without any candidate left, no pruning.
    let prune = true;
    const candidates = () => {
        const out = [];
        for (const ox of offsets ? [0, 2, 4] : [0]) for (const oy of offsets ? [0, 2, 4] : [0]) out.push([gridW - 2 - ox, gridH - 2 - oy]);
        return out;
    };
    let cands = candidates();
    const isCand = (x, y) => cands.some(([a, b]) => a === x && b === y);
    const hDist = (x, y) => (prune ? Math.min(...cands.map(([a, b]) => Math.abs(a - x) + Math.abs(b - y))) : 0);
    const growGrid = (x, y) => {
        if (x + 2 > gridW || y + 2 > gridH) { gridW = Math.max(gridW, x + 2); gridH = Math.max(gridH, y + 2); cands = candidates(); }
    };
    growGrid(pos[0], pos[1]);
    // Can the exit lie beyond unknown cell (nx, ny)? Flood fill through unknown cells inside the outer wall.
    const regionHasExit = (nx, ny) => {
        if (!prune || isCand(nx, ny)) return true;
        const seen = new Set([key(nx, ny)]), q = [[nx, ny]];
        while (q.length) {
            const [cx, cy] = q.pop();
            for (const [dx, dy] of Object.values(DIRS)) {
                const ax = cx + 2 * dx, ay = cy + 2 * dy, k = key(ax, ay);
                if (ax < 1 || ay < 1 || ax > gridW - 2 || ay > gridH - 2 || seen.has(k) || cells.has(k)) continue;
                seen.add(k);
                if (isCand(ax, ay)) return true;
                q.push([ax, ay]);
            }
        }
        return false;
    };
    /** Best opening: BFS over known cells from pos; cost = walk + 1 + distance to the exit; skip openings a solver
     * closer to them has claimed. Returns {path: [dir...], target} or null. */
    const plan = () => {
        const start = key(pos[0], pos[1]);
        const dist = new Map([[start, 0]]), prev = new Map(), q = [pos];
        const theirs = new Map(Object.entries(claims).filter(([p]) => Number(p) !== me).map(([, c]) => [c[0], c[1]]));
        let best = null;
        for (let qi = 0; qi < q.length; qi++) {
            const [cx, cy] = q[qi], dc = dist.get(key(cx, cy)), b = cells.get(key(cx, cy));
            for (const [d, [dx, dy]] of Object.entries(DIRS)) {
                if (!(b & BIT[d])) continue;
                const nx = cx + 2 * dx, ny = cy + 2 * dy, k = key(nx, ny);
                if (cells.has(k)) {
                    if (!dist.has(k)) { dist.set(k, dc + 1); prev.set(k, [cx, cy, d]); q.push([nx, ny]); }
                    continue;
                }
                if ((theirs.get(k) ?? Infinity) <= dc + 1 || !regionHasExit(nx, ny)) continue;
                const cost = dc + 1 + hDist(nx, ny);
                if (!best || cost < best.cost) best = { cost, cx, cy, d, k };
            }
        }
        if (!best) return null;
        const path = [];
        for (let k = key(best.cx, best.cy); prev.has(k);) { const [px, py, d] = prev.get(k); path.push(d); k = key(px, py); }
        return { path: [...path.reverse(), best.d], target: best.k };
    };

    let misses = 0, route = null;
    for (let i = 0; i < 50000; i++) {
        if (!route || !route.path.length || cells.has(route.target)) {
            route = plan();
            if (!route && prune) { prune = false; route = plan(); } // e.g. a larger bonus maze than assumed
            if (!route) {
                // Every opening is claimed by a closer solver (or none is left): wait for news on the shared map
                if (Object.keys(claims).some((p) => Number(p) !== me)) { await ns.sleep(1000); sync(null); continue; }
                return finish(false, "exhausted");
            }
            sync([route.target, route.path.length]);
        }
        const dir = route.path[0];
        const r = await ns.dnet.authenticate(host, "go " + dir);
        if (r && r.success) return finish(true, r.data ?? r.message);
        const msg = (r && r.message) || "";
        const m = msg.match(/moved to (\d+),(\d+)/);
        if (m || /cannot go that way/i.test(msg)) misses = 0;
        if (m) {
            moves++;
            route.path.shift();
            pos = [parseInt(m[1], 10), parseInt(m[2], 10)];
            growGrid(pos[0], pos[1]);
            let seen = parse(r.data);
            if (!seen) { const lr = await ns.dnet.labreport(); seen = { north: lr.north, south: lr.south, east: lr.east, west: lr.west }; }
            const k = key(pos[0], pos[1]), b = bitsOf(seen);
            if (cells.has(k) && cells.get(k) !== b) { cells.clear(); route = null; } // our map was from another maze
            cells.set(k, b);
            if (!sync(route && route.path.length ? [route.target, route.path.length] : null)) route = null;
        } else if (/cannot go that way/i.test(msg)) {
            walls++;
            // Our map said open: from another maze. Start over from what we see here.
            cells.clear();
            const lr = await ns.dnet.labreport();
            if (lr && lr.success) { pos = [lr.coords[0], lr.coords[1]]; cells.set(key(pos[0], pos[1]), bitsOf(lr)); }
            route = null;
            sync(null);
        } else if (/charism|moxie|charming/i.test(msg)) return finish(false, "charisma");
        else if (++misses > 100) return finish(false, "unreachable"); // the labyrinth moved away from this host
        else await ns.sleep(200); // timeout (network instability): retry
    }
    finish(false, "max_iterations");
}
