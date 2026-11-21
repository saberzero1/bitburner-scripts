/**
 * Fast IPvGO playout search for go.js. A compact board on typed arrays with light random playouts (no filling of
 * one's own eyes, simple ko), scored like the game (stones + empty regions bordered by one colour, regions larger than
 * n*n-3 count for nobody, komi to white), searched with UCT. About 50-100x more playouts per second than playouts
 * with the game's own AI (go-search.js), which cost more CPU than they won in node power (tools/go-sim gv_* runs).
 *
 * Cells: 0 empty, 1 black (us), 2 white, 3 wall (board edge or offline node "#").
 * Pure JS (no ns calls): costs no RAM. The search yields with `await yieldFn()` every ~15 ms.
 */
const EMPTY = 0, BLACK = 1, WHITE = 2, WALL = 3;
const YIELD_MS = 15;

/** Board from ns.go.getBoardState() rows ("X" black, "O" white, "." empty, "#" offline). rows[x][y] = column x. */
export function boardFromRows(rows) {
    const n = rows.length, W = n + 2;
    const cells = new Int8Array(W * W).fill(WALL);
    for (let x = 0; x < n; x++)
        for (let y = 0; y < n; y++) {
            const c = rows[x][y];
            cells[(x + 1) * W + (y + 1)] = c === "X" ? BLACK : c === "O" ? WHITE : c === "." ? EMPTY : WALL;
        }
    return { n, W, cells };
}

/** Reusable scratch for flood fills on one board size. */
function makeCtx(n) {
    const W = n + 2, size = W * W;
    return {
        n, W, size,
        dirs: [1, -1, W, -W],
        mark: new Int32Array(size), stamp: 1,
        stack: new Int32Array(size),
        group: new Int32Array(size),
    };
}

/** Does the group at p have a liberty? (flood fill) */
function hasLiberty(ctx, cells, p) {
    const color = cells[p], { mark, stack, dirs } = ctx;
    const s = ++ctx.stamp;
    let top = 0;
    stack[top++] = p;
    mark[p] = s;
    while (top) {
        const q = stack[--top];
        for (let d = 0; d < 4; d++) {
            const r = q + dirs[d], c = cells[r];
            if (c === EMPTY) return true;
            if (c === color && mark[r] !== s) {
                mark[r] = s;
                stack[top++] = r;
            }
        }
    }
    return false;
}

/** The group at p's only liberty, or -1 if it has two or more (0 if none). */
function soleLiberty(ctx, cells, p) {
    const color = cells[p], { mark, stack, dirs } = ctx;
    const s = ++ctx.stamp;
    let top = 0, lib = 0;
    stack[top++] = p;
    mark[p] = s;
    while (top) {
        const q = stack[--top];
        for (let d = 0; d < 4; d++) {
            const r = q + dirs[d], c = cells[r];
            if (c === EMPTY) {
                if (lib && lib !== r) return -1;
                lib = r;
            } else if (c === color && mark[r] !== s) {
                mark[r] = s;
                stack[top++] = r;
            }
        }
    }
    return lib;
}

/**
 * Tactical reply to the last move (playout policy): capture an enemy group it left in atari, else save our own group
 * it put in atari (by extending at its liberty if that gives 2+ liberties). Returns a point or 0.
 */
function tacticalMove(ctx, cells, last, toMove, ko, scratch) {
    if (!last) return 0;
    const { dirs } = ctx;
    const opp = 3 - toMove;
    // The last move's own group, and enemy groups next to it, in atari: capture
    for (const q of [last, last + 1, last - 1, last + ctx.W, last - ctx.W]) {
        if (cells[q] !== opp) continue;
        const lib = soleLiberty(ctx, cells, q);
        if (lib > 0 && lib !== ko) return lib;
    }
    // Our groups next to the last move in atari: extend if that escapes
    for (let d = 0; d < 4; d++) {
        const q = last + dirs[d];
        if (cells[q] !== toMove) continue;
        const lib = soleLiberty(ctx, cells, q);
        if (lib <= 0 || lib === ko) continue;
        scratch.set(cells);
        if (play(ctx, scratch, lib, toMove, ko) < 0) continue;
        if (soleLiberty(ctx, scratch, lib) === -1) return lib;
    }
    return 0;
}

/** Remove the group at p; returns stones removed. */
function removeGroup(ctx, cells, p) {
    const color = cells[p], { stack, dirs } = ctx;
    let top = 0, removed = 0;
    stack[top++] = p;
    cells[p] = EMPTY;
    while (top) {
        const q = stack[--top];
        removed++;
        for (let d = 0; d < 4; d++) {
            const r = q + dirs[d];
            if (cells[r] === color) {
                cells[r] = EMPTY;
                stack[top++] = r;
            }
        }
    }
    return removed;
}

/**
 * Play `color` at p. Returns -1 if illegal (occupied, suicide, ko), else the ko point created (0 if none).
 * Mutates cells on success.
 */
function play(ctx, cells, p, color, ko) {
    if (cells[p] !== EMPTY || p === ko) return -1;
    const opp = 3 - color, { dirs } = ctx;
    cells[p] = color;
    let captured = 0, capturedAt = 0;
    for (let d = 0; d < 4; d++) {
        const r = p + dirs[d];
        if (cells[r] === opp && !hasLiberty(ctx, cells, r)) {
            const k = removeGroup(ctx, cells, r);
            captured += k;
            capturedAt = r;
        }
    }
    if (!captured && !hasLiberty(ctx, cells, p)) {
        cells[p] = EMPTY;
        return -1; // suicide
    }
    // Simple ko: a single stone captured a single stone and is itself in atari with no friends
    if (captured === 1) {
        let lonely = true, libs = 0;
        for (let d = 0; d < 4; d++) {
            const c = cells[p + dirs[d]];
            if (c === color) lonely = false;
            else if (c === EMPTY) libs++;
        }
        if (lonely && libs === 1) return capturedAt;
    }
    return 0;
}

/** p is an eye of `color`: every neighbour is that colour or wall (and most diagonals, off the edge all of them). */
function isEye(ctx, cells, p, color) {
    const { dirs, W } = ctx;
    for (let d = 0; d < 4; d++) {
        const c = cells[p + dirs[d]];
        if (c !== color && c !== WALL) return false;
    }
    let bad = 0, edge = 0;
    for (const dd of [W + 1, W - 1, -W + 1, -W - 1]) {
        const c = cells[p + dd];
        if (c === WALL) edge = 1;
        else if (c !== color) bad++;
    }
    return bad + edge < 2;
}

/** Score like the game: black minus white (komi included). */
function scoreMargin(ctx, cells, komi) {
    const { size, dirs, mark, stack, n } = ctx;
    let black = 0, white = 0;
    const s = ++ctx.stamp;
    for (let p = 0; p < size; p++) {
        const c = cells[p];
        if (c === BLACK) black++;
        else if (c === WHITE) white++;
        else if (c === EMPTY && mark[p] !== s) {
            let top = 0, count = 0, seenB = false, seenW = false;
            stack[top++] = p;
            mark[p] = s;
            while (top) {
                const q = stack[--top];
                count++;
                for (let d = 0; d < 4; d++) {
                    const r = q + dirs[d], cr = cells[r];
                    if (cr === EMPTY && mark[r] !== s) {
                        mark[r] = s;
                        stack[top++] = r;
                    } else if (cr === BLACK) seenB = true;
                    else if (cr === WHITE) seenW = true;
                }
            }
            if (count > n * n - 3) continue;
            if (seenB && !seenW) black += count;
            else if (seenW && !seenB) white += count;
        }
    }
    return black - white - komi;
}

/** Random playout from (cells, toMove, ko) to two passes; returns the final margin. cells is consumed. */
function playout(ctx, cells, toMove, ko, komi, empties, last = 0, scratch = null) {
    let passes = 0;
    const maxPlies = ctx.n * ctx.n * 3;
    // Empty points list (refreshed after captures by rescanning cheaply)
    let m = 0;
    for (let p = 0; p < ctx.size; p++) if (cells[p] === EMPTY) empties[m++] = p;
    for (let ply = 0; ply < maxPlies && passes < 2; ply++) {
        let played = false;
        if (scratch && last) {
            const t = tacticalMove(ctx, cells, last, toMove, ko, scratch);
            if (t) {
                const r = play(ctx, cells, t, toMove, ko);
                if (r >= 0) {
                    ko = r;
                    last = t;
                    passes = 0;
                    m = 0;
                    for (let p = 0; p < ctx.size; p++) if (cells[p] === EMPTY) empties[m++] = p;
                    toMove = 3 - toMove;
                    continue;
                }
            }
        }
        // Try empties in random order (swap-remove picks)
        let k = m;
        while (k > 0) {
            const i = (Math.random() * k) | 0;
            const p = empties[i];
            empties[i] = empties[k - 1];
            empties[k - 1] = p;
            k--;
            if (cells[p] !== EMPTY) continue;
            if (isEye(ctx, cells, p, toMove)) continue;
            const r = play(ctx, cells, p, toMove, ko);
            if (r < 0) continue;
            ko = r;
            last = p;
            played = true;
            break;
        }
        if (played) {
            passes = 0;
            m = 0;
            for (let p = 0; p < ctx.size; p++) if (cells[p] === EMPTY) empties[m++] = p;
        } else {
            passes++;
            ko = 0;
            last = 0;
        }
        toMove = 3 - toMove;
    }
    return scoreMargin(ctx, cells, komi);
}

/** UCT node */
function newNode(move, toMove) {
    return { move, toMove, n: 0, w: 0, children: null, untried: null };
}

function legalMoves(ctx, cells, toMove, ko, scratch) {
    const moves = [];
    for (let p = 0; p < ctx.size; p++) {
        if (cells[p] !== EMPTY || p === ko) continue;
        if (isEye(ctx, cells, p, toMove)) continue;
        scratch.set(cells);
        if (play(ctx, scratch, p, toMove, ko) >= 0) moves.push(p);
    }
    return moves;
}

/**
 * Pick a move for black.
 * @param {string[]} rows ns.go.getBoardState()
 * @param {number} komi white's komi
 * @param {{x:number,y:number}[]|null} legal root moves allowed by the game (repeat rule), or null for all
 * @param {{playouts?: number, ms?: number, uct?: boolean, yieldFn?: () => Promise<void>, toMove?: number}} opts
 *   toMove 2 (white) values a position after one of our cheats that used our turn (value = black's win rate)
 * @returns {Promise<{move: {x:number,y:number}|null, winRate: number, playouts: number}>} null move = pass
 */
export async function fastSearch(rows, komi, legal, opts = {}) {
    const { playouts = 3000, ms = 0, uct = true, yieldFn = null, ko: rootKo = 0, tactics = true, toMove = BLACK } = opts;
    const board = boardFromRows(rows);
    const ctx = makeCtx(board.n);
    const { W } = ctx;
    const toP = (x, y) => (x + 1) * W + (y + 1);
    const fromP = (p) => ({ x: Math.floor(p / W) - 1, y: (p % W) - 1 });
    const scratch = new Int8Array(ctx.size), sim = new Int8Array(ctx.size), empties = new Int32Array(ctx.size);
    const allowed = legal ? new Set(legal.map((m) => toP(m.x, m.y))) : null;

    const root = newNode(-1, toMove);
    // Root moves: the game's legal moves (minus our own eyes), plus pass
    root.untried = legalMoves(ctx, board.cells, toMove, rootKo, scratch).filter((p) => !allowed || allowed.has(p));
    root.untried.push(0); // 0 = pass
    root.children = [];
    const C = 0.7;
    const start = performance.now();
    let lastYield = start, done = 0;
    while (ms ? performance.now() - start < ms : done < playouts) {
        // Selection / expansion
        sim.set(board.cells);
        let node = root, ko = rootKo, passes = 0, lastMove = 0;
        const path = [root];
        while (true) {
            if (node.untried && node.untried.length) {
                const i = (Math.random() * node.untried.length) | 0;
                const mv = node.untried[i];
                node.untried[i] = node.untried[node.untried.length - 1];
                node.untried.pop();
                const child = newNode(mv, 3 - node.toMove);
                node.children.push(child);
                if (mv) {
                    ko = play(ctx, sim, mv, node.toMove, ko);
                    passes = 0;
                    lastMove = mv;
                } else {
                    ko = 0;
                    passes++;
                }
                node = child;
                path.push(node);
                break;
            }
            if (!node.children || !node.children.length || !uct) break;
            // UCB1 from the mover's perspective (w counts black wins)
            let best = null, bestV = -Infinity;
            const lnN = Math.log(node.n + 1);
            for (const ch of node.children) {
                const rate = ch.n ? (node.toMove === BLACK ? ch.w / ch.n : 1 - ch.w / ch.n) : 1;
                const v = rate + C * Math.sqrt(lnN / (ch.n + 1));
                if (v > bestV) {
                    bestV = v;
                    best = ch;
                }
            }
            if (best.move) {
                const r = play(ctx, sim, best.move, node.toMove, ko);
                ko = r < 0 ? 0 : r;
                passes = 0;
                lastMove = best.move;
            } else {
                ko = 0;
                passes++;
            }
            node = best;
            path.push(node);
            if (passes >= 2) break;
            if (!node.untried) {
                node.untried = legalMoves(ctx, sim, node.toMove, ko, scratch);
                node.untried.push(0);
                node.children = [];
            }
        }
        // Simulation
        const margin = passes >= 2 ? scoreMargin(ctx, sim, komi)
            : playout(ctx, sim, node.toMove, ko, komi, empties, lastMove, tactics ? scratch : null);
        const win = margin > 0 ? 1 : 0;
        for (const nd of path) {
            nd.n++;
            nd.w += win;
        }
        done++;
        if (yieldFn && performance.now() - lastYield > YIELD_MS) {
            await yieldFn();
            lastYield = performance.now();
        }
    }
    // Most visited root child
    let best = null;
    for (const ch of root.children) if (!best || ch.n > best.n) best = ch;
    const value = root.w / Math.max(1, root.n); // black's win rate from this position (any side to move)
    const top = [...root.children].sort((a, b) => b.n - a.n).filter((c) => c.move).slice(0, opts.topK ?? 0).map((c) => fromP(c.move));
    if (!best) return { move: null, winRate: 0, value, playouts: done, top };
    return { move: best.move ? fromP(best.move) : null, winRate: best.w / Math.max(1, best.n), value, playouts: done, top };
}
