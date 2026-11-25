/**
 * Darknet password solver benchmark (copied into bitburner-src/test/jest by tools/dnet-sim/run.sh).
 * For each password model and difficulty, creates real darknet servers next to a darknet host and runs the
 * probe's real tryAccessServer (Remote/darknet-probe.js) through a real ns. Network delays resolve instantly and
 * are summed as simulated time. Env: SIM_PROBE (probe path), SIM_TRIALS, SIM_DIFFICULTIES (comma list),
 * SIM_MODELS (optional comma list of config builder names), SIM_MAX_ATTEMPTS, SIM_OUT.
 */
import fs from "fs";
import { Player } from "@player";
import { CompletedProgramName } from "@enums";
import { getDarkscapeNavigator } from "../../src/DarkNet/effects/effects";
import { DarknetState } from "../../src/DarkNet/models/DarknetState";
import { connectServers, GetServerOrThrow } from "../../src/Server/AllServers";
import { helpers } from "../../src/Netscript/NetscriptHelpers";
import * as Gen from "../../src/DarkNet/controllers/ServerGenerator";
import { fixDoImportIssue, getFirstDarknetServerAdjacentToDarkWeb, getNS, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

fixDoImportIssue();
initGameEnvironment();

const env = process.env;
const TRIALS = Number(env.SIM_TRIALS ?? 10);
const DIFFS = (env.SIM_DIFFICULTIES ?? "2,8,16,30").split(",").map(Number);
const MAX_ATTEMPTS = Number(env.SIM_MAX_ATTEMPTS ?? 3000);
const OUT = env.SIM_OUT ?? "/tmp/dnetsim.json";
const BUILDERS: Record<string, (d: number) => unknown> = {
  getEchoVulnConfig: Gen.getEchoVulnConfig,
  getSortedEchoVulnConfig: Gen.getSortedEchoVulnConfig,
  getNoPasswordConfig: Gen.getNoPasswordConfig,
  getDefaultPasswordConfig: Gen.getDefaultPasswordConfig,
  getCaptchaConfig: Gen.getCaptchaConfig,
  getDogNameConfig: Gen.getDogNameConfig,
  getMastermindHintConfig: Gen.getMastermindHintConfig,
  getTimingAttackConfig: Gen.getTimingAttackConfig,
  getRomanNumeralConfig: Gen.getRomanNumeralConfig,
  getLargestPrimeFactorConfig: Gen.getLargestPrimeFactorConfig,
  getGuessNumberConfig: Gen.getGuessNumberConfig,
  getLargeDictionaryConfig: Gen.getLargeDictionaryConfig,
  getEuCountryDictionaryConfig: Gen.getEuCountryDictionaryConfig,
  getYesn_tConfig: Gen.getYesn_tConfig,
  getBufferOverflowConfig: Gen.getBufferOverflowConfig as unknown as (d: number) => unknown,
  getBinaryEncodedConfig: Gen.getBinaryEncodedConfig,
  getXorMaskEncryptedPasswordConfig: Gen.getXorMaskEncryptedPasswordConfig as unknown as (d: number) => unknown,
  getSpiceLevelConfig: Gen.getSpiceLevelConfig,
  getConvertToBase10Config: Gen.getConvertToBase10Config,
  getParseArithmeticExpressionConfig: Gen.getParseArithmeticExpressionConfig,
  getDivisibilityTestConfig: Gen.getDivisibilityTestConfig,
  getTripleModuloConfig: Gen.getTripleModuloConfig,
  getKingOfTheHillConfig: Gen.getKingOfTheHillConfig,
  getPacketSnifferConfig: Gen.getPacketSnifferConfig,
};

class AttemptLimit extends Error {}

test(
  "darknet solver benchmark",
  async () => {
    DarknetState.offlineServers = new Set();
    setupBasicTestingEnvironment({ purchaseCloudServer: true, purchaseHacknetServer: true });
    Player.sourceFiles.set(15, 1);
    getDarkscapeNavigator();
    Player.getHomeComputer().programs.push(CompletedProgramName.formulas);
    Player.mults.charisma = 1e10;
    Player.gainCharismaExp(1e100);

    let simulatedMs = 0;
    (helpers as unknown as { netscriptDelay: (ctx: unknown, ms: number) => Promise<void> }).netscriptDelay = (_ctx, ms) => {
      simulatedMs += ms;
      return Promise.resolve();
    };

    const hostName = getFirstDarknetServerAdjacentToDarkWeb();
    const host = GetServerOrThrow(hostName);
    host.maxRam = 1e6;
    const realNs = getNS(hostName) as unknown as Record<string, unknown> & { dnet: Record<string, unknown> };

    // Load the probe's functions (strip exports, return the internals we need)
    let src = fs.readFileSync(env.SIM_PROBE ?? "", "utf8");
    src = src.replace(/^export\s+/gm, "");
    const probe = new Function(src + "\nreturn { tryAccessServer };")() as {
      tryAccessServer: (ns: unknown, host: string, details: unknown, passwords: Map<string, string>) => Promise<string | null>;
    };

    let attempts = 0;
    const dnet = new Proxy(realNs.dnet, {
      get: (t, k) => {
        const v = t[k as string];
        if (k === "authenticate" && typeof v === "function")
          return (...a: unknown[]) => {
            if (++attempts > MAX_ATTEMPTS) throw new AttemptLimit("attempt limit");
            return (v as (...x: unknown[]) => unknown)(...a);
          };
        return v;
      },
    });
    const nsProbe = new Proxy(realNs, { get: (t, k) => (k === "dnet" ? dnet : t[k as string]) });

    const names = env.SIM_MODELS ? env.SIM_MODELS.split(",") : Object.keys(BUILDERS);
    const results: Record<string, unknown>[] = [];
    for (const name of names) {
      for (const d of DIFFS) {
        for (let trial = 0; trial < TRIALS; trial++) {
          const server = Gen.serverFactory(BUILDERS[name] as never, d, d, 0);
          connectServers(server, host);
          attempts = 0;
          const t0 = simulatedMs;
          let error: string | null = null;
          try {
            const details = (realNs.dnet.getServerDetails as (h: string) => unknown)(server.hostname);
            await probe.tryAccessServer(nsProbe, server.hostname, details, new Map());
          } catch (e) {
            error = e instanceof AttemptLimit ? "attempt limit" : String(e).slice(0, 200);
          }
          results.push({
            model: server.modelId,
            builder: name,
            difficulty: d,
            success: server.hasAdminRights,
            attempts,
            simSeconds: (simulatedMs - t0) / 1000,
            passwordLength: server.password.length,
            error,
          });
          host.serversOnNetwork = host.serversOnNetwork.filter((h) => h !== server.hostname);
          server.serversOnNetwork = [];
        }
      }
      fs.writeFileSync(OUT, JSON.stringify(results));
    }
    fs.writeFileSync(OUT, JSON.stringify(results));
  },
  6 * 3600 * 1000,
);
