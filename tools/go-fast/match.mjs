// Fast-search black vs the game's real AI (bundled go-engine.js) on random boards, with optional playTwoMoves cheats.
// usage: node tools/go-fast/match.mjs <opponent> <games> <size> '<opts JSON>'
// opts: fastSearch options (playouts, ms, uct) plus cheat: "none" | "early:K" | "need:THRESHOLD:MAX", crime (crime_success mult)
// Time model (live-like): 0.16 s per AI move, our CPU, and timed-cheat waits (200 ms / success chance per cheat).
// Node power per game ~ black score x 8 (Illuminati 5x5) x streak mult (3 for a win at full streak, 0.5 for a loss).
import * as E from "../../servers/home/go-engine.js";
import { fastSearch } from "../../servers/home/go-fast.js";
import fs from "fs";
const [opp = "Illuminati", games = "20", size = "5", optsJson = "{}"] = process.argv.slice(2);
const opts = JSON.parse(optsJson);
const KOMI = { Netburners: 1.5, "Slum Snakes": 3.5, "The Black Hand": 3.5, Tetrads: 5.5, Daedalus: 5.5, Illuminati: 7.5 };
const [cheatKind, cheatA, cheatB] = (opts.cheat ?? "none").split(":");
const crime = opts.crime ?? 1.6;
const cheatChance = (c) => Math.max(Math.min(0.6 * (0.7 - 0.02 * c) ** c * crime + 0.25, 1), 0);
const seed = () => 1 + Math.floor(Math.random() * 1e9);
const byOffline = {};
const kindCount = {};
let streak = 8; // start at a full streak
let wins = 0, cpu = 0, totalTime = 0, power = 0, cheatsTotal = 0;
for (let g = 0; g < Number(games); g++) {
  E.EnginePlayer.totalPlaytime = seed();
  const s = E.getNewBoardState(Number(size), opp, !opts.fullBoard);
  const offline = E.simpleBoardFromBoard(s.board).join("").split("#").length - 1;
  let cheats = 0, time = 0, turn = 0, twoMoves = 0;
  const gameLog = []; // our turns: {board (before our move), move, second (cheat), winRate}
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
      // critical: [fromTurn, toTurn, playouts] spends more playouts on those turns (1-based, our moves)
      const crit = opts.critical;
      const o = crit && turn >= crit[0] && turn <= crit[1] ? { ...opts, playouts: crit[2] } : opts;
      let r = await fastSearch(rows, KOMI[opp], legal, { ...o, topK: opts.replyCheck ? opts.replyCheck[2] : 0 });
      // replyCheck: [fromTurn, toTurn, topK, samples, playouts]: re-rank the top candidates by the real AI's replies
      const rc = opts.replyCheck;
      if (rc && turn >= rc[0] && turn <= rc[1] && r.top.length > 1) {
        let best = null;
        for (const c of r.top) {
          let total = 0;
          for (let k = 0; k < rc[3]; k++) {
            const st = E.getStateCopy(s);
            st.previousBoards = [...s.previousBoards];
            E.makeMove(st, c.x, c.y, "Black");
            const m = await E.getMove(st, "White", opp, false, seed());
            if (m.type === "move") E.makeMove(st, m.x, m.y, "White"); else E.passTurn(st, "White", false);
            const v = await fastSearch(E.simpleBoardFromBoard(st.board), KOMI[opp], E.getAllValidMoves(st, "Black").map((p) => ({ x: p.x, y: p.y })), { ...opts, playouts: rc[4] });
            total += v.value;
          }
          if (!best || total > best.total) best = { c, total };
        }
        r = { ...r, move: best.c, winRate: best.total / rc[3] };
      }
      const dt = performance.now() - t; cpu += dt; time += dt / 1000;
      return r;
    };
    let r = await pick();
    const boardBefore = E.simpleBoardFromBoard(s.board);
    let cheat = false;
    if (r.move && cheatKind === "early") cheat = twoMoves < Number(cheatA);
    // best:K:kinds: on our first K turns, value every option (normal move, two moves, remove a white stone, destroy an
    // empty point) with the fast search and play the best one; kinds = subset of "two,remove,destroy"
    if (cheatKind === "best" && cheats < Number(cheatA) && (opts.below === undefined || r.winRate < opts.below) && turn > (opts.after ?? 0)) {
      const kinds = (cheatB ?? "two,remove,destroy").split(",");
      const evalOpts = { ...opts, playouts: opts.evalPlayouts ?? 1500 };
      const rows0 = E.simpleBoardFromBoard(s.board);
      const options = [{ kind: "normal", value: r.winRate }];
      if (kinds.includes("two") && r.move) {
        const rows = rows0.map((row, x) => (x === r.move.x ? row.slice(0, r.move.y) + "X" + row.slice(r.move.y + 1) : row));
        const r2 = await fastSearch(rows, KOMI[opp], null, evalOpts);
        if (r2.move) options.push({ kind: "two", value: r2.winRate, a: r.move, b: r2.move });
      }
      for (let x = 0; x < rows0.length; x++) for (let y = 0; y < rows0.length; y++) {
        const c = rows0[x][y];
        const edit = (ch) => rows0.map((row, i) => (i === x ? row.slice(0, y) + ch + row.slice(y + 1) : row));
        if (kinds.includes("remove") && c === "O") {
          const v = (await fastSearch(edit("."), KOMI[opp], null, { ...evalOpts, toMove: 2 })).value;
          options.push({ kind: "remove", value: v, a: { x, y } });
        }
        if (kinds.includes("destroy") && c === ".") {
          const v = (await fastSearch(edit("#"), KOMI[opp], null, { ...evalOpts, toMove: 2 })).value;
          options.push({ kind: "destroy", value: v, a: { x, y } });
        }
      }
      options.sort((p, q) => q.value - p.value);
      const o = options[0];
      kindCount[o.kind] = (kindCount[o.kind] ?? 0) + 1;
      if (o.kind !== "normal") {
        time += 0.2 / cheatChance(cheats);
        cheats++;
        if (o.kind === "two") {
          E.makeMove(s, o.a.x, o.a.y, "Black");
          s.previousPlayer = "White";
          E.makeMove(s, o.b.x, o.b.y, "Black");
        } else {
          if (o.kind === "remove") s.board[o.a.x][o.a.y].color = "Empty";
          else s.board[o.a.x][o.a.y] = null;
          E.updateChains(s.board);
          s.previousPlayer = "Black";
        }
        const m = await E.getMove(s, "White", opp, false, seed());
        time += 0.16;
        if (m.type === "move" && E.makeMove(s, m.x, m.y, "White")) {} else E.passTurn(s, "White", false);
        continue;
      }
    }
    if (r.move && cheatKind === "need") cheat = r.winRate < Number(cheatA) && cheats < Number(cheatB);
    if (cheat) {
      // playTwoMoves: two stones in a row (search picks the second with black to move again)
      E.makeMove(s, r.move.x, r.move.y, "Black");
      s.previousPlayer = "White";
      const r2 = await pick();
      if (r2.move) E.makeMove(s, r2.move.x, r2.move.y, "Black");
      else s.previousPlayer = "Black";
      gameLog.push({ board: boardBefore, move: r.move, second: r2.move, winRate: r2.winRate });
      time += 0.2 / cheatChance(cheats);
      cheats++;
      twoMoves++;
    } else {
      gameLog.push({ board: boardBefore, move: r.move, winRate: r.winRate });
      if (r.move) E.makeMove(s, r.move.x, r.move.y, "Black");
      else E.passTurn(s, "Black", false);
    }
    if (s.passCount >= 2) break;
    const m = await E.getMove(s, "White", opp, false, seed());
    time += 0.16;
    if (m.type === "move" && E.makeMove(s, m.x, m.y, "White")) {} else E.passTurn(s, "White", false);
  }
  const sc = E.getScore(s); const won = sc.Black.sum > sc.White.sum;
  if (won) wins++;
  if (opts.dump && (!won || Math.random() < (opts.dumpWins ?? 0)))
    fs.appendFileSync(opts.dump, JSON.stringify({ opp, komi: KOMI[opp], won, final: E.simpleBoardFromBoard(s.board), score: [sc.Black.sum, sc.White.sum], turns: gameLog }) + "\n");
  (byOffline[offline] ??= [0, 0])[0] += won ? 1 : 0;
  byOffline[offline][1]++;
  // Win streak like the game: a win counts 1 + 0.25 x min(streak, 8) (x3 cap), a loss 0.5 and resets the streak
  // (breaking a losing streak gives a bonus; ignored)
  streak = won ? Math.max(1, streak + 1) : 0;
  power += sc.Black.sum * (opp === "Illuminati" && Number(size) === 5 ? 8 : (KOMI[opp] + 0.5) * 0.25) * (won ? 1 + 0.25 * Math.min(streak, 8) : 0.5);
  totalTime += time; cheatsTotal += cheats;
}
const n = Number(games);
console.log(`${opp} ${size}x${size} ${optsJson}: won ${wins}/${n}, ${(totalTime / n).toFixed(1)}s/game (CPU ${(cpu / n / 1000).toFixed(2)}s), cheats/g ${(cheatsTotal / n).toFixed(1)}, power/h ${(power / totalTime * 3600).toFixed(0)}  choices ${JSON.stringify(kindCount)}  by offline nodes: ${Object.entries(byOffline).map(([k, [w, t]]) => `${k}:${w}/${t}`).join(" ")}`);
