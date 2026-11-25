/**
 * Go search ceiling (copied into bitburner-src/test/jest by tools/go-sim/search.sh).
 * Plays black against the real IPvGO AI on real boards (offline nodes, handicap, komi) with a flat Monte Carlo
 * search: each legal move (and pass) is tried in SIM_ROLLOUTS playouts where white is the real AI with random seeds
 * and black is the AI's own policy (SIM_ROLLOUT_POLICY faction), and the move with the most playout wins is played.
 * SIM_ROLLOUTS=0 plays black with the rollout policy alone (baseline). No cheats.
 * Env: SIM_OPPONENT, SIM_SIZE, SIM_GAMES, SIM_ROLLOUTS, SIM_ROLLOUT_POLICY, SIM_OUT.
 */
jest.mock("../../src/utils/Utility", () => {
  const actual = jest.requireActual("../../src/utils/Utility");
  return { ...actual, sleep: () => Promise.resolve() };
});
import fs from "fs";
import { Player } from "@player";
import { GoColor, GoOpponent } from "@enums";
import { getNewBoardState, getStateCopy, makeMove, passTurn } from "../../src/Go/boardState/boardState";
import { getAllValidMoves, simpleBoardFromBoard } from "../../src/Go/boardAnalysis/boardAnalysis";
import { getScore } from "../../src/Go/boardAnalysis/scoring";
import { getMove } from "../../src/Go/boardAnalysis/goAI";
import type { BoardState } from "../../src/Go/Types";
import { initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

initGameEnvironment();

const env = process.env;
const OPPONENT = (env.SIM_OPPONENT ?? "Illuminati") as GoOpponent;
const SIZE = Number(env.SIM_SIZE ?? 5);
const GAMES = Number(env.SIM_GAMES ?? 20);
const ROLLOUTS = Number(env.SIM_ROLLOUTS ?? 16);
const POLICY = (env.SIM_ROLLOUT_POLICY ?? "Illuminati") as GoOpponent;
const OUT = env.SIM_OUT ?? "/tmp/searchsim.json";
const MAX_PLIES = SIZE * SIZE * 3;

const seed = () => 1 + Math.floor(Math.random() * 1e9);
const margin = (s: BoardState) => {
  const sc = getScore(s);
  return sc[GoColor.black].sum - sc[GoColor.white].sum;
};

/** Play one ply for `color` with the AI policy; returns false once the game is over (two passes). */
async function aiPly(s: BoardState, color: GoColor, faction: GoOpponent) {
  const play = await getMove(s, color, faction, false, seed());
  if (play.type === "move" && play.x !== null && play.y !== null && makeMove(s, play.x, play.y, color)) return s.passCount < 2;
  passTurn(s, color, false);
  return s.passCount < 2;
}

async function playout(s: BoardState, toMove: GoColor) {
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const faction = toMove === GoColor.white ? OPPONENT : POLICY;
    if (!(await aiPly(s, toMove, faction))) break;
    toMove = toMove === GoColor.white ? GoColor.black : GoColor.white;
  }
  return margin(s);
}

async function chooseMove(state: BoardState): Promise<{ x: number; y: number } | null> {
  const candidates: ({ x: number; y: number } | null)[] = [...getAllValidMoves(state, GoColor.black).map((p) => ({ x: p.x, y: p.y })), null];
  let best: { move: { x: number; y: number } | null; wins: number; total: number } | null = null;
  for (const move of candidates) {
    let wins = 0;
    let total = 0;
    for (let r = 0; r < ROLLOUTS; r++) {
      const s = getStateCopy(state);
      s.previousBoards = [...state.previousBoards]; // getStateCopy shares the history array
      if (move) makeMove(s, move.x, move.y, GoColor.black);
      else passTurn(s, GoColor.black, false);
      const m = s.passCount >= 2 ? margin(s) : await playout(s, GoColor.white);
      wins += m > 0 ? 1 : 0;
      total += m;
    }
    if (!best || wins > best.wins || (wins === best.wins && total > best.total)) best = { move, wins, total };
  }
  return best?.move ?? null;
}

test(
  "go search ceiling",
  async () => {
    setupBasicTestingEnvironment();
    const results: { won: boolean; margin: number; plies: number; board: string[]; score: unknown }[] = [];
    for (let g = 0; g < GAMES; g++) {
      Player.totalPlaytime = seed(); // offline nodes are seeded from play time
      const state = getNewBoardState(SIZE, OPPONENT, true);
      let plies = 0;
      while (plies < MAX_PLIES) {
        if (ROLLOUTS > 0) {
          const move = await chooseMove(state);
          if (move) makeMove(state, move.x, move.y, GoColor.black);
          else passTurn(state, GoColor.black, false);
          if (state.passCount >= 2) break;
        } else if (!(await aiPly(state, GoColor.black, POLICY))) break;
        if (!(await aiPly(state, GoColor.white, OPPONENT))) break;
        plies += 2;
      }
      const m = margin(state);
      results.push({ won: m > 0, margin: m, plies, board: simpleBoardFromBoard(state.board), score: getScore(state) });
      fs.writeFileSync(OUT, JSON.stringify({ opponent: OPPONENT, size: SIZE, rollouts: ROLLOUTS, policy: POLICY, results }));
    }
  },
  12 * 3600 * 1000,
);
