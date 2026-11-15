/**
 * Go simulation (scratch harness, copied into bitburner-src/test/jest by tools/go-sim/run.sh).
 * Runs the real go.js from bitburner-scripts against the real IPvGO engine and AI. The AI's per-move UI delay
 * (waitCycle -> sleep(200ms)) resolves immediately; requested delays are summed as simulated game time.
 * Env: SIM_SCRIPT (go.js path), SIM_GAMES, SIM_ARGS (JSON go.js options), SIM_CRIME (crime_success mult, for
 * cheat success), SIM_SF14 (source-file 14 level), SIM_OUT (JSON output file).
 */
jest.mock("../../src/utils/Utility", () => {
  const actual = jest.requireActual("../../src/utils/Utility");
  return {
    ...actual,
    sleep: (ms: number) => {
      (globalThis as unknown as { __simSleep?: (ms: number) => void }).__simSleep?.(ms);
      return Promise.resolve();
    },
  };
});

import fs from "fs";
import { Player } from "../../src/Player";
import { Go } from "../../src/Go/Go";
import { getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

initGameEnvironment();
let simulatedMs = 0;
// Simulated time also advances the player's playtime: the Go AI seeds its RNG from Player.totalPlaytime, so a
// frozen clock replays the same game every time.
const advance = (ms: number) => {
  simulatedMs += ms;
  Player.totalPlaytime += ms;
};
(globalThis as unknown as { __simSleep?: (ms: number) => void }).__simSleep = advance;

const env = process.env;
const SCRIPT = env.SIM_SCRIPT ?? "";
const GAMES = Number(env.SIM_GAMES ?? 20);
const HOURS = Number(env.SIM_HOURS ?? 0); // if set, stop after this much simulated time instead of a game count
const OUT = env.SIM_OUT ?? "/tmp/gosim.json";
const ARGS = JSON.parse(env.SIM_ARGS ?? "{}");

test(
  "go simulation",
  async () => {
    setupBasicTestingEnvironment();
    Player.sourceFiles.set(14, Number(env.SIM_SF14 ?? 3));
    Player.mults.crime_success = Number(env.SIM_CRIME ?? 1.6);
    const realNs = getNS() as unknown as Record<string, unknown> & { go: Record<string, unknown> };

    let src = fs.readFileSync(SCRIPT, "utf8");
    src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/m, "");
    src = src.replace(/^export\s+/gm, "");
    const files: Record<string, string> = {};
    const opNs = (args: unknown[]) => new Proxy(realNs, { get: (t, k) => (k === "args" ? args : t[k as string]) });
    const getNsDataThroughFile = async (_ns: unknown, command: string, fName: unknown, args: unknown[] = []) => {
      if (fName && typeof fName === "object") args = (fName as { args?: unknown[] }).args ?? [];
      const result = await new Function("ns", "return (async () => " + command + ")()")(opNs(args));
      return JSON.parse(JSON.stringify(result === undefined ? null : result));
    };
    const getConfiguration = (_ns: unknown, schema: [string, unknown][]) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of schema) o[k] = v;
      return { ...o, ...ARGS };
    };
    const main = new Function(
      "getConfiguration",
      "instanceCount",
      "log",
      "getErrorInfo",
      "getActiveSourceFiles",
      "getNsDataThroughFile",
      "formatTime",
      src + "\nreturn main;",
    )(
      getConfiguration,
      async () => 1,
      () => {},
      (e: unknown) => String(e),
      async () => ({ 14: Number(env.SIM_SF14 ?? 3) }),
      getNsDataThroughFile,
      (ms: number) => `${ms}ms`,
    );

    // Per-game records: detect game ends from the stats (wins + losses) after each move/pass
    const games: Record<string, unknown>[] = [];
    let finish: () => void = () => {};
    const done = new Promise<void>((r) => (finish = r));
    let stopped = false;
    const statsSnapshot = () => JSON.parse(JSON.stringify(Go.stats));
    let lastStats = statsSnapshot();
    let lastMs = 0;
    const checkGameEnd = () => {
      const now = statsSnapshot();
      for (const [opp, s] of Object.entries(now) as [string, Record<string, number>][]) {
        const before = (lastStats[opp] ?? { wins: 0, losses: 0, nodePower: 0, nodes: 0 }) as Record<string, number>;
        if (s.wins + s.losses > before.wins + before.losses) {
          games.push({
            opp,
            size: Go.previousGame?.board?.length ?? null,
            won: s.wins > before.wins,
            score: s.nodes - before.nodes,
            power: s.nodePower - before.nodePower,
            streak: s.winStreak,
            ms: simulatedMs - lastMs,
            cheats: Go.previousGame?.cheatCount ?? null,
          });
          lastMs = simulatedMs;
        }
      }
      lastStats = now;
      if ((HOURS ? simulatedMs >= HOURS * 3.6e6 : games.length >= GAMES) && !stopped) {
        stopped = true;
        finish();
      }
    };
    const wrapGo = (fn: (...a: unknown[]) => Promise<unknown>) => async (...a: unknown[]) => {
      if (stopped) return new Promise(() => {});
      const r = await fn(...a);
      checkGameEnd();
      return r;
    };
    const goApi = realNs.go as Record<string, unknown>;
    const cheatApi = goApi.cheat as Record<string, unknown>;
    const go = new Proxy(goApi, {
      get: (t, k) => {
        if (k === "makeMove" || k === "passTurn" || k === "opponentNextTurn")
          return wrapGo(t[k as string] as (...a: unknown[]) => Promise<unknown>);
        if (k === "cheat")
          return new Proxy(cheatApi, {
            get: (c, ck) =>
              ck === "playTwoMoves" || ck === "removeRouter" || ck === "repairOfflineNode" || ck === "destroyNode"
                ? wrapGo(c[ck as string] as (...a: unknown[]) => Promise<unknown>)
                : c[ck as string],
          });
        return t[k as string];
      },
    });
    const overrides: Record<string, unknown> = {
      args: [],
      go,
      print: () => {},
      printf: () => {},
      tprint: () => {},
      disableLog: () => {},
      sleep: async (ms: number) => advance(ms),
      asleep: async (ms: number) => advance(ms),
      read: (f: string) => files[f] ?? "",
      write: (f: string, data: string, mode: string) => {
        files[f] = mode === "a" ? (files[f] ?? "") + data : data;
      },
      getServerMaxRam: () => 1e6,
      getServerUsedRam: () => 0,
      exit: () => {
        throw new Error("exit");
      },
    };
    const nsMain = new Proxy(realNs, { get: (t, k) => (k in overrides ? overrides[k as string] : t[k as string]) });
    let cheatProbe: unknown;
    try {
      cheatProbe = await getNsDataThroughFile(null, "ns.go.cheat.getCheatSuccessChance()", null, []);
    } catch (e) {
      cheatProbe = "ERROR " + String(e).slice(0, 300);
    }
    void main(nsMain).catch((e: unknown) => {
      games.push({ error: String(e) });
      finish();
    });
    await done;
    fs.writeFileSync(OUT, JSON.stringify({ args: ARGS, cheatProbe, simulatedMs, finalStats: Go.stats, games, scriptResults: files["/data/go-results.txt"] ?? "" }));
  },
  6 * 3600 * 1000,
);
