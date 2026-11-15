/**
 * Bladeburner simulation (copied into bitburner-src/test/jest by tools/bb-sim/run.sh).
 * Runs the real bladeburner.js against the real Bladeburner engine, one engine second at a time.
 * Env: SIM_SCRIPT, SIM_HOURS, SIM_ARGS (JSON bladeburner.js options), SIM_STATS (starting combat/cha levels),
 * SIM_LEVEL_MULT (BN stat level multiplier), SIM_RANK_MULT, SIM_SKILLCOST_MULT, SIM_OUT.
 */
import fs from "fs";
import { Player } from "@player";
import { currentNodeMults } from "../../src/BitNode/BitNodeMultipliers";
import { calculateExp } from "../../src/PersonObjects/formulas/skill";
import { Router } from "../../src/ui/Router";
import { Page } from "../../src/ui/Router";
import { Sleeve } from "../../src/PersonObjects/Sleeve/Sleeve";
import { getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

initGameEnvironment();

const env = process.env;
const HOURS = Number(env.SIM_HOURS ?? 24);
const OUT = env.SIM_OUT ?? "/tmp/bbsim.json";
const ARGS = JSON.parse(env.SIM_ARGS ?? "{}");

test(
  "bladeburner simulation",
  async () => {
    setupBasicTestingEnvironment();
    (Router as unknown as { page: () => Page }).page = () => Page.Terminal;
    Player.sourceFiles.set(4, 3);
    Player.sourceFiles.set(6, 3);
    Player.sourceFiles.set(7, 3);
    const levelMult = Number(env.SIM_LEVEL_MULT ?? 0.236);
    for (const k of ["Strength", "Defense", "Dexterity", "Agility", "Charisma", "Hacking"] as const)
      (currentNodeMults as unknown as Record<string, number>)[`${k}LevelMultiplier`] = levelMult;
    currentNodeMults.BladeburnerRank = Number(env.SIM_RANK_MULT ?? 0.236);
    currentNodeMults.BladeburnerSkillCost = Number(env.SIM_SKILLCOST_MULT ?? 4.24);
    // Optional live player data (multipliers from augmentations etc.): {mults, skills} from ns.getPlayer()
    const live = env.SIM_PLAYER ? JSON.parse(fs.readFileSync(env.SIM_PLAYER, "utf8")) : null;
    if (live) Object.assign(Player.mults, live.mults);
    const statLevel = (k: string) =>
      env.SIM_STATS === "live" && live ? Number(live.skills[k]) : Number(env.SIM_STATS ?? 500);
    const exp = (k: "strength" | "defense" | "dexterity" | "agility" | "charisma") =>
      calculateExp(statLevel(k), Player.mults[k] * levelMult);
    for (const k of ["strength", "defense", "dexterity", "agility", "charisma"] as const) Player.exp[k] = exp(k);
    Player.updateSkillLevels();
    Player.startBladeburner();
    const bb = Player.bladeburner!;
    const realNs = getNS() as unknown as Record<string, unknown> & { bladeburner: Record<string, unknown> };

    // Optional sleeves: copied from live ns.sleeve.getSleeve() data, each pinned to a Bladeburner task
    // SIM_SLEEVE_TASKS: JSON list per sleeve of [action, contract?], e.g. [["Infiltrate Synthoids"],["Take on contracts","Tracking"]]
    const sleeveTasks: string[][] = JSON.parse(env.SIM_SLEEVE_TASKS ?? "[]");
    const liveSleeves = env.SIM_SLEEVES_FILE ? JSON.parse(fs.readFileSync(env.SIM_SLEEVES_FILE, "utf8")) : [];
    Player.sourceFiles.set(10, 3);
    Player.sleeves = sleeveTasks.map((_, i) => {
      const sl = new Sleeve();
      const src = liveSleeves[i % Math.max(1, liveSleeves.length)];
      if (src) {
        Object.assign(sl.exp, src.exp);
        Object.assign(sl.mults, src.mults);
      }
      sl.shock = 0;
      sl.sync = 100;
      sl.updateSkillLevels();
      return sl;
    });
    const sleeveApi = (realNs as unknown as { sleeve: { setToBladeburnerAction: (i: number, a: string, c?: string) => boolean } }).sleeve;
    sleeveTasks.forEach(([action, contract], i) => {
      try {
        sleeveApi.setToBladeburnerAction(i, action, contract);
      } catch (e) {
        throw new Error(`sleeve ${i} task ${action}: ${String(e).slice(0, 200)}`);
      }
    });

    let src = fs.readFileSync(env.SIM_SCRIPT ?? "", "utf8");
    src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/m, "");
    src = src.replace(/^export\s+/gm, "");
    const files: Record<string, string> = {};
    const logs: string[] = [];
    let simMs = 0;
    const wallStart = Date.now();
    Date.now = () => wallStart + simMs;
    const evalCommand = async (command: string, args: unknown[] = []) => {
      const nsArgs = new Proxy(realNs, { get: (t, k) => (k === "args" ? args : t[k as string]) });
      const result = await new Function("ns", "return (async () => " + command + ")()")(nsArgs);
      return JSON.parse(JSON.stringify(result === undefined ? null : result));
    };
    const getNsDataThroughFile = async (_ns: unknown, command: string, fName: unknown, args: unknown[] = []) => {
      if (fName && typeof fName === "object") args = (fName as { args?: unknown[] }).args ?? [];
      return evalCommand(command, args);
    };
    const getConfiguration = (_ns: unknown, schema: [string, unknown][]) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of schema) o[k] = v;
      return { "disable-spending-hashes": true, ...o, ...ARGS };
    };
    const fmt = (n: number) => `${Math.round(n)}`;
    const main = new Function(
      "log",
      "disableLogs",
      "getConfiguration",
      "instanceCount",
      "getNsDataThroughFile",
      "getFilePath",
      "getActiveSourceFiles",
      "formatNumberShort",
      "formatDuration",
      src + "\nreturn main;",
    )(
      (_ns: unknown, msg: string) => logs.push(`${(simMs / 3.6e6).toFixed(2)}h ${String(msg).slice(0, 300)}`),
      () => {},
      getConfiguration,
      async () => 1,
      getNsDataThroughFile,
      (f: string) => f,
      async () => ({ 4: 3, 6: 3, 7: 3 }),
      fmt,
      (ms: number) => `${Math.round(ms / 1000)}s`,
    );

    let finish: () => void = () => {};
    let stopped = false;
    const done = new Promise<void>((r) => (finish = r));
    const samples: Record<string, unknown>[] = [];
    let nextSample = 0;
    const sample = () => {
      samples.push({
        h: +(simMs / 3.6e6).toFixed(2),
        rank: bb.rank,
        blackOps: bb.numBlackOpsComplete,
        skillPoints: bb.skillPoints,
        stamina: bb.stamina,
        maxStamina: bb.maxStamina,
        action: bb.action?.name ?? null,
        str: Player.skills.strength,
        cha: Player.skills.charisma,
        counts: Object.fromEntries([...Object.values(bb.contracts), ...Object.values(bb.operations)].map((a) => [a.name, +a.count.toFixed(1)])),
        chaos: Object.fromEntries(Object.entries(bb.cities).map(([c, v]) => [c, Math.round((v as { chaos: number }).chaos)])),
        city: bb.getCurrentCity().name,
      });
    };
    let carry = 0;
    const advance = (ms: number) => {
      if (stopped) return;
      carry += ms;
      while (carry >= 1000 && !stopped) {
        carry -= 1000;
        bb.storeCycles(5);
        bb.process();
        for (const sl of Player.sleeves) sl.process(5);
        simMs += 1000;
        if (simMs >= nextSample) {
          sample();
          nextSample += 600_000;
        }
        if (simMs >= HOURS * 3.6e6 || bb.numBlackOpsComplete >= bb.blackOperationArray.length) {
          stopped = true;
          finish();
        }
      }
    };
    const bbApi = new Proxy(realNs.bladeburner, {
      get: (t, k) => {
        if (k === "nextUpdate")
          return async () => {
            if (stopped) return new Promise(() => {});
            const p = (t.nextUpdate as () => Promise<number>)();
            advance(1000);
            return p;
          };
        return t[k as string];
      },
    });
    const overrides: Record<string, unknown> = {
      args: [],
      bladeburner: bbApi,
      print: () => {},
      tprint: () => {},
      alert: () => {},
      disableLog: () => {},
      run: () => 0,
      sleep: async (ms: number) => {
        if (stopped) return new Promise(() => {});
        advance(Math.max(ms, 1));
      },
      asleep: async (ms: number) => {
        if (stopped) return new Promise(() => {});
        advance(Math.max(ms, 1));
      },
      read: (f: string) => files[f] ?? "",
      write: (f: string, data: string, mode: string) => {
        files[f] = mode === "a" ? (files[f] ?? "") + data : data;
      },
    };
    const nsMain = new Proxy(realNs, { get: (t, k) => (k in overrides ? overrides[k as string] : t[k as string]) });
    let error: string | null = null;
    void main(nsMain).catch((e: unknown) => {
      error = String(e).slice(0, 500);
      finish();
    });
    await done;
    sample();
    fs.writeFileSync(
      OUT,
      JSON.stringify({ args: ARGS, stats: env.SIM_STATS, error, finishedHours: bb.numBlackOpsComplete >= bb.blackOperationArray.length ? simMs / 3.6e6 : null, totalBlackOps: bb.blackOperationArray.length, samples, logs: [...logs.slice(0, 80), ...logs.slice(-150)] }),
    );
  },
  6 * 3600 * 1000,
);
