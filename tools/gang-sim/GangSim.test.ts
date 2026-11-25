/**
 * Gang simulation (copied into bitburner-src/test/jest by tools/gang-sim/run.sh).
 * Runs the real gangs.js against the real gang engine. Simulated time advances the gang via Gang.process();
 * the player gets a fixed income (stands in for hacking money). Env: SIM_SCRIPT, SIM_HOURS, SIM_ARGS (JSON
 * gangs.js options), SIM_INCOME ($/s), SIM_FACTION, SIM_SOFTCAP, SIM_OUT.
 */
import fs from "fs";
import { Player } from "@player";
import { FactionName } from "@enums";
import { AllGangs } from "../../src/Gang/AllGangs";
import { currentNodeMults } from "../../src/BitNode/BitNodeMultipliers";
import { joinFaction } from "../../src/Faction/FactionHelpers";
import { Factions } from "../../src/Faction/Factions";
import { getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

initGameEnvironment();

const env = process.env;
const HOURS = Number(env.SIM_HOURS ?? 24);
const INCOME = Number(env.SIM_INCOME ?? 1e6);
const OUT = env.SIM_OUT ?? "/tmp/gangsim.json";
const ARGS = JSON.parse(env.SIM_ARGS ?? "{}");
const FACTION = (env.SIM_FACTION ?? "Speakers for the Dead") as FactionName;
const MS_PER_CYCLE = 200;

test(
  "gang simulation",
  async () => {
    setupBasicTestingEnvironment();
    Player.sourceFiles.set(2, 3);
    Player.sourceFiles.set(4, 3);
    currentNodeMults.GangSoftcap = Number(env.SIM_SOFTCAP ?? 0.8);
    currentNodeMults.GangUniqueAugs = Number(env.SIM_UNIQUEAUGS ?? 1);
    joinFaction(Factions[FACTION]);
    Player.startGang(FACTION, false);
    Player.money = 0;
    if (env.SIM_4S === "1") Player.has4SDataTixApi = true;
    const gang = Player.gang!;
    const realNs = getNS() as unknown as Record<string, unknown> & { gang: Record<string, unknown> };

    let src = fs.readFileSync(env.SIM_SCRIPT ?? "", "utf8");
    src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/m, "");
    src = src.replace(/^export\s+/gm, "");
    const files: Record<string, string> = {};
    const logs: string[] = [];
    const evalCommand = async (command: string, args: unknown[] = []) => {
      const nsArgs = new Proxy(realNs, { get: (t, k) => (k === "args" ? args : t[k as string]) });
      const result = await new Function("ns", "return (async () => " + command + ")()")(nsArgs);
      return JSON.parse(JSON.stringify(result === undefined ? null : result));
    };
    const getNsDataThroughFile = async (_ns: unknown, command: string, fName: unknown, args: unknown[] = []) => {
      if (fName && typeof fName === "object") args = (fName as { args?: unknown[] }).args ?? [];
      return evalCommand(command, args);
    };
    const runCommand = async (_ns: unknown, command: string, _f: unknown, args: unknown[] = []) => {
      await new Function("ns", "return (async () => { " + command + " })()")(
        new Proxy(realNs, { get: (t, k) => (k === "args" ? args : t[k as string]) }),
      );
      return 1;
    };
    const getConfiguration = (_ns: unknown, schema: [string, unknown][]) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of schema) o[k] = v;
      return { ...o, ...ARGS };
    };
    const fmt = (n: number) => (Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(2)}b` : `${Math.round(n)}`);
    const main = new Function(
      "log",
      "getConfiguration",
      "instanceCount",
      "getNsDataThroughFile",
      "getActiveSourceFiles",
      "runCommand",
      "tryGetBitNodeMultipliers",
      "formatMoney",
      "formatNumberShort",
      "formatDuration",
      src + "\nreturn main;",
    )(
      (_ns: unknown, msg: string) => logs.push(`${(simMs / 3.6e6).toFixed(2)}h ${String(msg).slice(0, 300)}`),
      getConfiguration,
      async () => 1,
      getNsDataThroughFile,
      async () => ({ 2: 3, 4: 3 }),
      runCommand,
      async () => ({ ...currentNodeMults }),
      fmt,
      fmt,
      (ms: number) => `${Math.round(ms / 1000)}s`,
    );

    // ── Time ──
    let simMs = 0;
    // gangs.js times some decisions with Date.now() (e.g. training after recruit/ascend): follow simulated time
    const wallStart = Date.now();
    Date.now = () => wallStart + simMs;
    let finish: () => void = () => {};
    let stopped = false;
    const done = new Promise<void>((r) => (finish = r));
    const samples: Record<string, unknown>[] = [];
    let nextSample = 0;
    let firstFullTerritory: number | null = null;
    const sample = () => {
      const info = AllGangs[gang.facName];
      samples.push({
        h: +(simMs / 3.6e6).toFixed(2),
        territory: info.territory,
        power: info.power,
        respect: gang.respect,
        wanted: gang.wanted,
        moneyGainRate: gang.moneyGainRate * 5, // per second (per-cycle rate x 5 cycles/s)
        members: gang.members.length,
        warfare: gang.territoryWarfareEngaged,
        playerMoney: Player.money,
        factionRep: Factions[FACTION].playerReputation,
        memberDetail: gang.members.map((m) => ({ n: m.name, task: m.task, str: Math.round(m.str), cha: Math.round(m.cha), hack: Math.round(m.hack), upg: m.upgrades.length + m.augmentations.length })),
      });
    };
    const advance = (ms: number) => {
      if (stopped) return;
      const cycles = ms / MS_PER_CYCLE;
      Player.gainMoney(INCOME * (ms / 1000), "other");
      gang.process(cycles);
      simMs += ms;
      if (firstFullTerritory === null && AllGangs[gang.facName].territory >= 0.9999) firstFullTerritory = simMs / 3.6e6;
      if (simMs >= nextSample) {
        sample();
        nextSample += 600_000;
      }
      if (simMs >= HOURS * 3.6e6) {
        stopped = true;
        finish();
      }
    };
    const gangApi = new Proxy(realNs.gang, {
      get: (t, k) => {
        if (k === "nextUpdate")
          return async () => {
            if (stopped) return new Promise(() => {});
            const p = (t.nextUpdate as () => Promise<number>)();
            advance(2000); // the engine processes the gang in 2 s chunks
            return p;
          };
        return t[k as string];
      },
    });
    const overrides: Record<string, unknown> = {
      args: [],
      gang: gangApi,
      print: () => {},
      tprint: () => {},
      disableLog: () => {},
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
    const apiProbe = await evalCommand(
      "({ info: ns.gang.getGangInformation(), task: ns.gang.getTaskStats('Mug People'), members: ns.gang.getMemberNames() })",
    ).catch((e: unknown) => String(e));
    let error: string | null = null;
    void main(nsMain).catch((e: unknown) => {
      error = String(e).slice(0, 500);
      finish();
    });
    await done;
    sample();
    fs.writeFileSync(OUT, JSON.stringify({ apiProbe, args: ARGS, income: INCOME, firstFullTerritory, error, samples, logs: [...logs.slice(0, 60), ...logs.slice(-200)] }));
  },
  6 * 3600 * 1000,
);
