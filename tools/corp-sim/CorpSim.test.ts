/**
 * Corporation growth simulation (scratch harness, not part of the game's test suite).
 * Runs the real corporation.js planner from bitburner-scripts against the real corporation engine.
 * Config via env: SIM_SCRIPT (path to corporation.js), SIM_MULT (CorporationValuation), SIM_DIVMULT,
 * SIM_SOFTCAP, SIM_HOURS, SIM_ARGS (JSON object of script options), SIM_OUT (JSON lines output file).
 */
import fs from "fs";
import { Player } from "../../src/Player";
import { getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";
import { enterBitNode } from "../../src/RedPill";
import { getDefaultBitNodeOptions } from "../../src/BitNode/BitNodeUtils";
import { currentNodeMults } from "../../src/BitNode/BitNodeMultipliers";
import * as corpConstants from "../../src/Corporation/data/Constants";

initGameEnvironment();

const env = process.env;
const SCRIPT = env.SIM_SCRIPT ?? "";
const HOURS = Number(env.SIM_HOURS ?? 24);
const OUT = env.SIM_OUT ?? "/tmp/corpsim.jsonl";
const ARGS = JSON.parse(env.SIM_ARGS ?? "{}");

test(
  "corp growth simulation",
  async () => {
    setupBasicTestingEnvironment();
    enterBitNode(true, Player.bitNodeN, 3, getDefaultBitNodeOptions());
    currentNodeMults.CorporationValuation = Number(env.SIM_MULT ?? 1);
    currentNodeMults.CorporationDivisions = Number(env.SIM_DIVMULT ?? 1);
    currentNodeMults.CorporationSoftcap = Number(env.SIM_SOFTCAP ?? 1);
    const realNs = getNS();
    Player.money = 150e9;
    realNs.corporation.createCorporation("Sim", true);
    const corp = Player.corporation!;
    Player.money = 0;

    // ── Script loading: strip the helpers import and exports, inject stubs ──
    let src = fs.readFileSync(SCRIPT, "utf8");
    src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/m, "");
    src = src.replace(/^export\s+/gm, "");
    const files: Record<string, string> = {};
    const opSpend: Record<string, number> = {}; // funds spent per op (cumulative)
    const logs: string[] = [];
    const opNs = (args: unknown[]) => ({
      corporation: realNs.corporation,
      args,
      getBitNodeMultipliers: () => ({ ...currentNodeMults }),
      getResetInfo: () => ({ currentNode: 3 }),
    });
    const getNsDataThroughFile = async (_ns: unknown, command: string, fName: unknown, args: unknown[] = []) => {
      if (fName && typeof fName === "object") args = (fName as { args?: unknown[] }).args ?? [];
      const fundsBefore = corp.funds;
      const result = new Function("ns", "return " + command)(opNs(args));
      const opName = typeof fName === "string" ? fName.replace(/^.*corp-op-|\.txt$/g, "") : "other";
      opSpend[opName] = (opSpend[opName] ?? 0) + (fundsBefore - corp.funds);
      if (env.SIM_TRACE && Math.abs((cycles * corpConstants.secondsPerMarketCycle) / 3600 - Number(env.SIM_TRACE)) < 0.004)
        logs.push(`TRACE ${typeof fName === "string" ? fName : ""} ${String(args[0] ?? "").slice(0, 400)} => ${JSON.stringify(result)?.slice(0, 200)} funds=${corp.funds.toExponential(3)}`);
      return JSON.parse(JSON.stringify(result === undefined ? null : result));
    };
    const getConfiguration = (_ns: unknown, schema: [string, unknown][]) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of schema) o[k] = v;
      return { ...o, ...ARGS };
    };
    const log = (_ns: unknown, msg: string) => {
      logs.push(`${((cycles * corpConstants.secondsPerMarketCycle) / 3600).toFixed(2)}h ${msg}`);
    };
    const formatMoney = (n: number) => `$${(n / 1e9).toFixed(2)}b`;
    const main = new Function(
      "log",
      "getConfiguration",
      "disableLogs",
      "formatMoney",
      "getNsDataThroughFile",
      src + "\nreturn main;",
    )(log, getConfiguration, () => {}, formatMoney, getNsDataThroughFile);

    // ── Engine stepping ──
    const totalCycles = Math.round((HOURS * 3600) / corpConstants.secondsPerMarketCycle);
    let cycles = 0;
    let dividends = 0;
    let finish: () => void = () => {};
    const done = new Promise<void>((r) => (finish = r));
    const samples: Record<string, unknown>[] = [];
    const sample = () => {
      const offer = corp.getInvestmentOffer();
      samples.push({
        h: +((cycles * corpConstants.secondsPerMarketCycle) / 3600).toFixed(2),
        funds: corp.funds,
        profit: corp.revenue - corp.expenses,
        valuation: corp.valuation,
        round: corp.public ? "public" : offer.round,
        offer: offer.funds,
        owned: corp.numShares,
        total: corp.totalShares,
        sharePrice: corp.sharePrice,
        dividends,
        opSpend: { ...opSpend },
        divisions: corp.divisions.size,
        banks: (() => {
          try {
            return JSON.parse(files["/data/corp-state.txt"] ?? "{}").bank ?? null;
          } catch {
            return null;
          }
        })(),
        products: (() => {
          const t = corp.divisions.get("Tobacco");
          if (!t) return null;
          const o: Record<string, unknown> = {};
          for (const [n, pr] of t.products) o[n] = +pr.developmentProgress.toFixed(1);
          const offices: Record<string, number> = {};
          for (const [c, off] of Object.entries(t.offices)) if (off) offices[c] = off.numEmployees;
          return { o, offices, adv: t.numAdVerts, aw: Math.round(t.awareness) };
        })(),
      });
    };
    const nsMain = {
      args: [],
      corporation: {
        hasCorporation: () => true,
        getConstants: () => realNs.corporation.getConstants(),
        nextUpdate: async () => {
          if (cycles >= totalCycles) {
            finish();
            return new Promise(() => {});
          }
          const name = corp.state.nextName;
          const before = Player.money;
          corp.storeCycles(corpConstants.gameCyclesPerCorpStateCycle);
          corp.process();
          dividends += Player.money - before;
          if (name === "START") {
            cycles++;
            if (cycles % 60 === 0) sample(); // every 10 minutes
          }
          return name;
        },
      },
      read: (f: string) => files[f] ?? "",
      write: (f: string, data: string, mode: string) => {
        files[f] = mode === "a" ? (files[f] ?? "") + data : data;
      },
      sleep: async () => {},
      disableLog: () => {},
      getServerMoneyAvailable: () => 0,
    };
    void main(nsMain);
    await done;
    sample();
    const rounds = logs.filter((l) => /TRACE|Accept|Going public|Round \d:|Creating division|Developing product/.test(l));
    fs.writeFileSync(OUT, JSON.stringify({ env: { mult: env.SIM_MULT, args: ARGS, hours: HOURS }, samples, events: rounds.slice(0, 200) }));
  },
  24 * 3600 * 1000,
);
