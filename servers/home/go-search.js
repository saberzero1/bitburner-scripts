import * as Engine from "./go-engine.js";

/**
 * Monte Carlo move search for go.js, on the game's own IPvGO rules and AI (go-engine.js, bundled from bitburner-src
 * by tools/go-engine/build.mjs). Each legal move (and pass) is tried in playouts where white is the real AI of the
 * current opponent (random seeds, as the game seeds it from play time) and black plays the Illuminati policy; the move
 * that wins the most playouts is played. Candidates are narrowed by successive halving. tools/go-sim/search.sh: 16
 * playouts per move won 117/118 random 5x5 games against all six opponents, without cheats.
 *
 * Runs on the game's main thread: it yields (ns.sleep) every YIELD_MS so the game stays responsive.
 */
const YIELD_MS = 15;
const ROLLOUT_POLICY = "Illuminati";

const seed = () => 1 + Math.floor(Math.random() * 1e9);
const margin = (state) => {
    const score = Engine.getScore(state);
    return score.Black.sum - score.White.sum;
};

async function aiPly(state, color, faction) {
    const play = await Engine.getMove(state, color, faction, false, seed());
    if (play.type === "move" && play.x !== null && Engine.makeMove(state, play.x, play.y, color)) return state.passCount < 2;
    Engine.passTurn(state, color, false);
    return state.passCount < 2;
}

/**
 * @param {NS} ns
 * @param {string[]} board ns.go.getBoardState()
 * @param {string[][]} history ns.go.getMoveHistory() (most recent first; needed for the repeat rule)
 * @param {string} opponent ns.go.getOpponent()
 * @param {number} playouts playouts per candidate (before narrowing)
 * @returns {Promise<{x: number, y: number} | null>} the move to play, or null to pass
 */
export async function searchMove(ns, board, history, opponent, playouts = 16) {
    const root = Engine.getNewBoardStateFromSimpleBoard(board, undefined, opponent);
    root.previousPlayer = "White"; // our (black's) turn
    root.previousBoards = history.map((b) => b.join(""));
    const size = board.length;
    const maxPlies = size * size * 3;
    let lastYield = performance.now();
    const maybeYield = async () => {
        if (performance.now() - lastYield < YIELD_MS) return;
        await ns.sleep(0);
        lastYield = performance.now();
    };
    const playout = async (move) => {
        const state = Engine.getStateCopy(root);
        state.previousBoards = [...root.previousBoards]; // getStateCopy shares the history array
        if (move) Engine.makeMove(state, move.x, move.y, "Black");
        else Engine.passTurn(state, "Black", false);
        let color = "White";
        for (let ply = 0; ply < maxPlies && state.passCount < 2; ply++) {
            if (!(await aiPly(state, color, color === "White" ? opponent : ROLLOUT_POLICY))) break;
            color = color === "White" ? "Black" : "White";
            await maybeYield();
        }
        return margin(state);
    };

    let candidates = [...Engine.getAllValidMoves(root, "Black").map((p) => ({ x: p.x, y: p.y })), null].map((move) => ({
        move, wins: 0, n: 0, total: 0,
    }));
    if (candidates.length === 1) return null;
    // Successive halving: a few playouts each, keep the better half, repeat; spends `playouts` per starting candidate
    const budget = playouts * candidates.length;
    const rounds = Math.max(1, Math.ceil(Math.log2(candidates.length)));
    let spent = 0;
    for (let round = 0; round < rounds && candidates.length > 1; round++) {
        const per = Math.max(2, Math.floor(budget / rounds / candidates.length));
        for (const c of candidates) {
            for (let i = 0; i < per; i++) {
                const m = await playout(c.move);
                c.n++;
                c.total += m;
                if (m > 0) c.wins++;
                spent++;
            }
        }
        candidates.sort((a, b) => b.wins / b.n - a.wins / a.n || b.total / b.n - a.total / a.n);
        if (candidates[0].wins === candidates[0].n && spent >= budget / 2) break; // a certain win: stop early
        candidates = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)));
    }
    return candidates[0].move;
}
