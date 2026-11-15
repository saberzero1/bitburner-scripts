/**
 * Hacknet simulation (copied into bitburner-src/test/jest by tools/hacknet-sim/run.sh).
 * Mirrors daemon.js's hacknet policy with the real hacknet-upgrade-manager.js: a one-time kickstart, then every
 * 28 s one run per tier (max payoff time, max spend as a fraction of money). Hashes are sold for money each
 * second (spend-hacknet-hashes.js default). Env: SIM_SCRIPT, SIM_HOURS, SIM_INCOME ($/s), SIM_CAPITAL,
 * SIM_TIERS (JSON [[payoffHours, moneyFraction], ...]; [] = never buy), SIM_KICKSTART (payoff hours, 0 = none),
 * SIM_PLAYER (live {mults}), SIM_HACKNET_MULT (BN HacknetNodeMoney, BN12.73: 0.236), SIM_OUT.
 */
import fs from "fs";
import { Player } from "@player";
import { currentNodeMults } from "../../src/BitNode/BitNodeMultipliers";
import { processHacknetEarnings } from "../../src/Hacknet/HacknetHelpers";
import { getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

initGameEnvironment();

const env = process.env;
const HOURS = Number(env.SIM_HOURS ?? 24);
const INCOME = Number(env.SIM_INCOME ?? 1e6);
const OUT = env.SIM_OUT ?? "/tmp/hacknetsim.json";
const TIERS: [number, number][] = JSON.parse(env.SIM_TIERS ?? "[[4,0.1],[8,0.01],[1e100,0.001]]");
const KICKSTART = Number(env.SIM_KICKSTART ?? 1);

test(
  "hacknet simulation",
  async () => {
    setupBasicTestingEnvironment();
    Player.sourceFiles.set(9, 3);
    currentNodeMults.HacknetNodeMoney = Number(env.SIM_HACKNET_MULT ?? 0.236);
    if (env.SIM_PLAYER) Object.assign(Player.mults, JSON.parse(fs.readFileSync(env.SIM_PLAYER, "utf8")).mults);
    // setupBasicTestingEnvironment may have bought hacknet nodes/servers: start from none
    Player.hacknetNodes.length = 0;
    Player.money = Number(env.SIM_CAPITAL ?? 1e9);
    const realNs = getNS() as unknown as Record<string, unknown> & { hacknet: Record<string, (...a: unknown[]) => unknown> };

    let src = fs.readFileSync(env.SIM_SCRIPT ?? "", "utf8");
    src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/m, "");
    src = src.replace(/^export\s+/gm, "");
    const managerMain = new Function("getConfiguration", "disableLogs", "formatDuration", "formatMoney", src + "\nreturn main;");

    let simMs = 0;
    let soldForMoney = 0;
    const samples: Record<string, unknown>[] = [];
    let nextSample = 0;
    const tick = (ms: number) => {
      // Advance one or more seconds: player income, hash production, hash selling
      for (let left = ms; left > 0; left -= 1000) {
        const step = Math.min(1000, left);
        Player.gainMoney(INCOME * (step / 1000), "other");
        processHacknetEarnings(step / 200);
        const hashes = realNs.hacknet.numHashes() as number;
        const n = Math.floor(hashes / 4);
        if (n > 0) {
          const before = Player.money;
          realNs.hacknet.spendHashes("Sell for Money", "", n);
          soldForMoney += Player.money - before;
        }
        simMs += step;
        if (simMs >= nextSample) {
          let production = 0;
          for (let i = 0; i < (realNs.hacknet.numNodes() as number); i++)
            production += (realNs.hacknet.getNodeStats(i) as { production: number }).production;
          samples.push({ h: +(simMs / 3.6e6).toFixed(2), money: Player.money, nodes: realNs.hacknet.numNodes(), hashRate: production, soldForMoney });
          nextSample += 600_000;
        }
      }
    };
    class StopRun extends Error {}
    // One manager pass: its first sleep() ends the run (so the harness controls time). Repeat while it keeps buying.
    const runManager = async (args: Record<string, unknown>) => {
      const nsRun = new Proxy(realNs, {
        get: (t, k) => {
          if (k === "sleep") return async () => {
            throw new StopRun();
          };
          if (k === "print" || k === "disableLog" || k === "toast") return () => {};
          if (k === "read") return () => "";
          return t[k as string];
        },
      });
      for (let pass = 0; pass < 10000; pass++) {
        const before = Player.money;
        const getConfiguration = (_ns: unknown, schema: [string, unknown][]) => {
          const o: Record<string, unknown> = {};
          for (const [k, v] of schema) o[k] = v;
          return { ...o, ...args, "max-spend": (args["max-spend"] as number) - (startMoney - Player.money) };
        };
        const startMoney = pass === 0 ? Player.money : startMoneyOfRun;
        if (pass === 0) startMoneyOfRun = Player.money;
        try {
          await managerMain(getConfiguration, () => {}, (ms: number) => `${ms}`, (n: number) => `${n}`)(nsRun);
          return; // the manager stopped on its own (spend limit reached)
        } catch (e) {
          if (!(e instanceof StopRun)) throw e;
        }
        if (Player.money >= before) return; // nothing bought this pass
      }
    };
    let startMoneyOfRun = 0;

    if (KICKSTART > 0) await runManager({ c: true, "max-payoff-time": `${KICKSTART}h`, interval: 0, "max-spend": Player.money });
    while (simMs < HOURS * 3.6e6) {
      for (const [hours, fraction] of TIERS)
        await runManager({ c: true, "max-payoff-time": `${hours}h`, "max-spend": Player.money * fraction, interval: 0 });
      tick(28_000);
    }
    samples.push({ h: +(simMs / 3.6e6).toFixed(2), money: Player.money, nodes: realNs.hacknet.numNodes(), soldForMoney });
    fs.writeFileSync(OUT, JSON.stringify({ tiers: TIERS, kickstart: KICKSTART, income: INCOME, samples }));
  },
  6 * 3600 * 1000,
);
