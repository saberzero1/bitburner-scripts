// Fast-search black vs the game's real AI (bundled go-engine.js) on random boards, with optional playTwoMoves cheats.
// usage: node tools/go-fast/match.mjs <opponent> <games> <size> '<opts JSON>'
// opts: fastSearch options (playouts, ms, uct) plus cheat: "none" | "early:K" | "need:THRESHOLD:MAX", crime (crime_success mult)
// Time model (live-like): 0.16 s per AI move, our CPU, and timed-cheat waits (200 ms / success chance per cheat).
// Node power per game ~ black score x 8 (Illuminati 5x5) x streak mult (3 for a win at full streak, 0.5 for a loss).
import * as E from "../../servers/home/go-engine.js";
import { fastSearch } from "../../servers/home/go-fast.js";
const [opp = "Illuminati", games = "20", size = "5", optsJson = "{}"] = process.argv.slice(2);
const opts = JSON.parse(optsJson);
const KOMI = { Netburners: 1.5, "Slum Snakes": 3.5, "The Black Hand": 3.5, Tetrads: 5.5, Daedalus: 5.5, Illuminati: 7.5 };
const [cheatKind, cheatA, cheatB] = (opts.cheat ?? "none").split(":");
const crime = opts.crime ?? 1.6;
const cheatChance = (c) => Math.max(Math.min(0.6 * (0.7 - 0.02 * c) ** c * crime + 0.25, 1), 0);
const seed = () => 1 + Math.floor(Math.random() * 1e9);
const byOffline = {};
let wins = 0, cpu = 0, totalTime = 0, power = 0, cheatsTotal = 0;
for (let g = 0; g < Number(games); g++) {
  E.EnginePlayer.totalPlaytime = seed();
  const s = E.getNewBoardState(Number(size), opp, !opts.fullBoard);
  const offline = E.simpleBoardFromBoard(s.board).join("").split("#").length - 1;
  let cheats = 0, time = 0, turn = 0, twoMoves = 0;
  for (let ply = 0; ply < 200 && s.passCount < 2; ply++) {
    turn++;
    // repair:R: spend the first R turns repairing offline nodes (a cheat; uses the turn), centre-most first
    if (opts.repair && turn <= opts.repair) {
      let best = null;
      const n = s.board.length, c = (n - 1) / 2;
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++)
        if (!s.board[x][y] && (!best || Math.abs(x - c) + Math.abs(y - c) < best.d)) best = { x, y, d: Math.abs(x - c) + Math.abs(y - c) };
      if (best) {
        s.board[best.x][best.y] = { color: "Empty", chain: "", liberties: null, x: best.x, y: best.y };
        E.updateChains(s.board);
        s.previousPlayer = "Black";
        time += 0.2 / cheatChance(cheats);
        cheats++;
        const m = await E.getMove(s, "White", opp, false, seed());
        time += 0.16;
        if (m.type === "move" && E.makeMove(s, m.x, m.y, "White")) {} else E.passTurn(s, "White", false);
        continue;
      }
    }
    const pick = async () => {
      const rows = E.simpleBoardFromBoard(s.board);
      const legal = E.getAllValidMoves(s, "Black").map((p) => ({ x: p.x, y: p.y }));
      const t = performance.now();
      const r = await fastSearch(rows, KOMI[opp], legal, opts);
      const dt = performance.now() - t; cpu += dt; time += dt / 1000;
      return r;
    };
    let r = await pick();
    let cheat = false;
    if (r.move && cheatKind === "early") cheat = twoMoves < Number(cheatA);
    if (r.move && cheatKind === "need") cheat = r.winRate < Number(cheatA) && cheats < Number(cheatB);
    if (cheat) {
      // playTwoMoves: two stones in a row (search picks the second with black to move again)
      E.makeMove(s, r.move.x, r.move.y, "Black");
      s.previousPlayer = "White";
      const r2 = await pick();
      if (r2.move) E.makeMove(s, r2.move.x, r2.move.y, "Black");
      else s.previousPlayer = "Black";
      time += 0.2 / cheatChance(cheats);
      cheats++;
      twoMoves++;
    } else if (r.move) E.makeMove(s, r.move.x, r.move.y, "Black");
    else E.passTurn(s, "Black", false);
    if (s.passCount >= 2) break;
    const m = await E.getMove(s, "White", opp, false, seed());
    time += 0.16;
    if (m.type === "move" && E.makeMove(s, m.x, m.y, "White")) {} else E.passTurn(s, "White", false);
  }
  const sc = E.getScore(s); const won = sc.Black.sum > sc.White.sum;
  if (won) wins++;
  (byOffline[offline] ??= [0, 0])[0] += won ? 1 : 0;
  byOffline[offline][1]++;
  power += sc.Black.sum * (opp === "Illuminati" && Number(size) === 5 ? 8 : (KOMI[opp] + 0.5) * 0.25) * (won ? 3 : 0.5);
  totalTime += time; cheatsTotal += cheats;
}
const n = Number(games);
console.log(`${opp} ${size}x${size} ${optsJson}: won ${wins}/${n}, ${(totalTime / n).toFixed(1)}s/game (CPU ${(cpu / n / 1000).toFixed(2)}s), cheats/g ${(cheatsTotal / n).toFixed(1)}, power/h ${(power / totalTime * 3600).toFixed(0)}  by offline nodes: ${Object.entries(byOffline).map(([k, [w, t]]) => `${k}:${w}/${t}`).join(" ")}`);
