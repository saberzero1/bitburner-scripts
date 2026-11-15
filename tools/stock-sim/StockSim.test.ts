/**
 * Stock market simulation (copied into bitburner-src/test/jest by tools/stock-sim/run.sh).
 * Runs the real stockmaster.js against the real stock market engine, one market update (6 s) at a time.
 * Env: SIM_SCRIPT, SIM_HOURS, SIM_ARGS (JSON stockmaster.js options), SIM_CAPITAL, SIM_4S ("1" = 4S data + API
 * owned from the start), SIM_4S_COST_MULT (BN12: 4.24), SIM_OUT.
 */
import fs from "fs";
import { Player } from "@player";
import { currentNodeMults } from "../../src/BitNode/BitNodeMultipliers";
import { initStockMarket, processStockPrices, StockMarket } from "../../src/StockMarket/StockMarket";
import { getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

initGameEnvironment();

const env = process.env;
const HOURS = Number(env.SIM_HOURS ?? 24);
const OUT = env.SIM_OUT ?? "/tmp/stocksim.json";
const ARGS = JSON.parse(env.SIM_ARGS ?? "{}");

test(
  "stock simulation",
  async () => {
    setupBasicTestingEnvironment();
    for (const [sf, lvl] of [[4, 3], [8, 3]]) Player.sourceFiles.set(sf, lvl);
    currentNodeMults.FourSigmaMarketDataCost = Number(env.SIM_4S_COST_MULT ?? 4.24);
    currentNodeMults.FourSigmaMarketDataApiCost = Number(env.SIM_4S_COST_MULT ?? 4.24);
    initStockMarket();
    Player.hasWseAccount = true;
    Player.hasTixApiAccess = true;
    if (env.SIM_4S === "1") {
      Player.has4SData = true;
      Player.has4SDataTixApi = true;
    }
    const capital = Number(env.SIM_CAPITAL ?? 1e10);
    Player.money = capital;
    const realNs = getNS() as unknown as Record<string, unknown> & { stock: Record<string, unknown> };

    let src = fs.readFileSync(env.SIM_SCRIPT ?? "", "utf8");
    src = src.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/m, "");
    src = src.replace(/^export\s+/gm, "");
    const files: Record<string, string> = {};
    const logs: string[] = [];
    let simMs = 0;
    const wallStart = Date.now();
    Date.now = () => wallStart + simMs;
    const nsWithArgs = (args: unknown[]) => new Proxy(realNs, { get: (t, k) => (k === "args" ? args : t[k as string]) });
    const getNsDataThroughFile = async (_ns: unknown, command: string, fName: unknown, args: unknown[] = []) => {
      if (fName && typeof fName === "object") args = (fName as { args?: unknown[] }).args ?? [];
      const result = await new Function("ns", "return (async () => " + command + ")()")(nsWithArgs(args));
      return JSON.parse(JSON.stringify(result === undefined ? null : result));
    };
    const runCommand = async (_ns: unknown, command: string, _f: unknown, args: unknown[] = []) => {
      await new Function("ns", "return (async () => { " + command + " })()")(nsWithArgs(args));
      return 1;
    };
    const getConfiguration = (_ns: unknown, schema: [string, unknown][]) => {
      const o: Record<string, unknown> = {};
      for (const [k, v] of schema) o[k] = v;
      return { ...o, disableHud: true, ...ARGS };
    };
    const fmt = (n: number) => `${(n / 1e9).toFixed(2)}b`;
    const main = new Function(
      "instanceCount",
      "getConfiguration",
      "getNsDataThroughFile",
      "runCommand",
      "getActiveSourceFiles",
      "tryGetBitNodeMultipliers",
      "formatMoney",
      "formatNumberShort",
      "formatDuration",
      "getStockSymbols",
      src + "\nreturn main;",
    )(
      async () => 1,
      getConfiguration,
      getNsDataThroughFile,
      runCommand,
      async () => ({ 4: 3, 8: 3 }),
      async () => ({ ...currentNodeMults }),
      fmt,
      fmt,
      (ms: number) => `${Math.round(ms / 1000)}s`,
      async () => (realNs.stock.getSymbols as () => string[])(),
    );

    // Net worth: cash plus positions valued at what selling them would give
    const netWorth = () => {
      let total = Player.money;
      for (const stock of Object.values(StockMarket) as unknown[]) {
        const st = stock as { playerShares?: number; playerShortShares?: number; playerAvgShortPx?: number; getBidPrice?: () => number; getAskPrice?: () => number };
        if (!st || typeof st.getBidPrice !== "function") continue;
        total += (st.playerShares ?? 0) * st.getBidPrice();
        total += (st.playerShortShares ?? 0) * (2 * (st.playerAvgShortPx ?? 0) - (st.getAskPrice as () => number)());
      }
      return total;
    };
    let finish: () => void = () => {};
    let stopped = false;
    const done = new Promise<void>((r) => (finish = r));
    const samples: Record<string, unknown>[] = [];
    let nextSample = 0;
    let carry = 0;
    const advance = (ms: number) => {
      if (stopped) return;
      carry += ms;
      while (carry >= 6000 && !stopped) {
        carry -= 6000;
        StockMarket.lastUpdate = 0; // the engine rate-limits by wall-clock time
        processStockPrices(30);
        simMs += 6000;
        if (simMs >= nextSample) {
          samples.push({ h: +(simMs / 3.6e6).toFixed(2), netWorth: netWorth(), cash: Player.money, has4S: Player.has4SDataTixApi });
          nextSample += 600_000;
        }
        if (simMs >= HOURS * 3.6e6) {
          stopped = true;
          finish();
        }
      }
    };
    const stockApi = new Proxy(realNs.stock, {
      get: (t, k) => {
        if (k === "nextUpdate")
          return async () => {
            if (stopped) return new Promise(() => {});
            advance(6000);
            return 6000;
          };
        return t[k as string];
      },
    });
    const overrides: Record<string, unknown> = {
      args: [],
      stock: stockApi,
      print: () => {},
      tprint: () => {},
      toast: () => {},
      disableLog: () => {},
      getScriptName: () => "stockmaster.js",
      getHostname: () => "home",
      sleep: async (ms: number) => {
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
    samples.push({ h: +(simMs / 3.6e6).toFixed(2), netWorth: netWorth(), cash: Player.money, has4S: Player.has4SDataTixApi });
    fs.writeFileSync(OUT, JSON.stringify({ args: ARGS, capital, error, samples, logs: logs.slice(-100) }));
  },
  6 * 3600 * 1000,
);
