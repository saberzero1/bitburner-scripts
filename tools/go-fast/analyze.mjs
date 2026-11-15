// Analyse recorded Go games (match.mjs --dump, or go.js's /data/go-games.txt).
// usage: node tools/go-fast/analyze.mjs <records.jsonl> [deepPlayouts=30000] [maxGames=0 (all)] [shard=0/1]
// Per lost game: the win-estimate trajectory (our estimate at play time), the deep search's verdict on each of our moves
// (blunder = the deep search's best move beats the played one by >= 0.15), and board features vs won games.
import fs from "fs";
import { fastSearch } from "../../servers/home/go-fast.js";

const [file, deepArg = "30000", maxArg = "0", shardArg = "0/1"] = process.argv.slice(2);
const DEEP = Number(deepArg);
const [shard, shards] = shardArg.split("/").map(Number);
let games = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (Number(maxArg)) games = games.slice(0, Number(maxArg));
games = games.filter((_, i) => i % shards === shard);

const offline = (rows) => rows.join("").split("#").length - 1;
const place = (rows, m, ch) => rows.map((r, x) => (x === m.x ? r.slice(0, m.y) + ch + r.slice(m.y + 1) : r));
const legalOf = (rows) => {
    const out = [];
    for (let x = 0; x < rows.length; x++) for (let y = 0; y < rows.length; y++) if (rows[x][y] === ".") out.push({ x, y });
    return out;
};

const out = [];
for (const g of games) {
    const turns = [];
    for (const [i, t] of g.turns.entries()) {
        // Deep search from the position before our move (for a cheat turn, the two-move choice is checked move by move)
        const deep = await fastSearch(t.board, g.komi, legalOf(t.board), { playouts: DEEP });
        // Value of the move we played: deep search of the position after it, from the right side to move
        let after = t.board;
        if (t.move) after = place(after, t.move, "X");
        let playedValue;
        if (t.second) {
            const deep2 = await fastSearch(after, g.komi, legalOf(after), { playouts: DEEP });
            const afterBoth = place(after, t.second, "X");
            playedValue = (await fastSearch(afterBoth, g.komi, null, { playouts: DEEP, toMove: 2 })).value;
            turns.push({ i, cheat: true, est: t.winRate, deepBest: deep2.winRate, played: playedValue, bestMove: deep2.move, move: t.second });
            continue;
        }
        playedValue = t.move ? (await fastSearch(after, g.komi, null, { playouts: DEEP, toMove: 2 })).value : null;
        turns.push({ i, est: t.winRate, deepBest: deep.winRate, played: playedValue, bestMove: deep.move, move: t.move });
    }
    out.push({ won: g.won, opp: g.opp, offline: offline(g.turns[0]?.board ?? g.final), start: g.turns[0]?.board, score: g.score, turns });
}

// Summary
const lost = out.filter((g) => !g.won), won = out.filter((g) => g.won);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log(`games: ${out.length} (${lost.length} lost, ${won.length} won)`);
console.log(`offline nodes: lost ${mean(lost.map((g) => g.offline)).toFixed(1)}, won ${mean(won.map((g) => g.offline)).toFixed(1)}`);
const firstEst = (g) => g.turns[0]?.deepBest ?? NaN;
console.log(`deep win estimate before our first move: lost ${mean(lost.map(firstEst)).toFixed(2)}, won ${mean(won.map(firstEst)).toFixed(2)}`);
const blunders = [];
const turnOfCollapse = [];
for (const g of lost) {
    let collapse = null;
    for (const t of g.turns) {
        if (t.played !== null && t.deepBest - t.played >= 0.15) blunders.push({ g, t });
        if (collapse === null && t.played !== null && t.played < 0.3) collapse = t.i;
    }
    turnOfCollapse.push(collapse);
}
const hist = {};
for (const c of turnOfCollapse) hist[c ?? "never<0.3"] = (hist[c ?? "never<0.3"] ?? 0) + 1;
console.log(`turn where the deep estimate of our position first fell below 0.3 (lost games): ${JSON.stringify(hist)}`);
const lostAtStart = lost.filter((g) => firstEst(g) < 0.3).length;
console.log(`lost games already < 0.3 before our first move: ${lostAtStart}/${lost.length}`);
const bTurn = {};
for (const b of blunders) bTurn[b.t.i] = (bTurn[b.t.i] ?? 0) + 1;
console.log(`blunders (deep best beats played by >= 0.15): ${blunders.length} in ${new Set(blunders.map((b) => b.g)).size} lost games; by turn ${JSON.stringify(bTurn)}; on cheat turns ${blunders.filter((b) => b.t.cheat).length}`);
fs.writeFileSync(file.replace(/\.jsonl$/, `.analysis-${shard}.json`), JSON.stringify(out));
