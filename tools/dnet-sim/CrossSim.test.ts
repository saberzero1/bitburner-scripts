/**
 * Darknet depth-progress simulation (copied into bitburner-src/test/jest by tools/dnet-sim/cross.sh).
 * The network is the real engine's: populateDarknet, mutateDarknet at the game's rate (moves, restarts, deletions,
 * new links), and real chargeServerMigration / moveDarknetServer. Our scripts are modelled:
 *  - probes crack connected neighbours one at a time (median attempts per model from the solver benchmark, times
 *    the real calculateAuthenticationTime) and deploy a probe on every cracked neighbour; restarts and deletions
 *    kill probes, and a probe on a connected neighbour redeploys them;
 *  - migration charging (SIM_POLICY): "none"; "depth" (the probes' rule: a cracked probe neighbour 1-3 rows before
 *    the frontier gap); "difficulty" (the neighbour whose landing window, which the game centres on the server's
 *    difficulty, puts the most open slots past the frontier gap);
 *  - anchors (SIM_ANCHORS slots): "none", "lab" (only next to the labyrinth), "frontier" (the deepest probe hosts).
 * Measures the time until a probe sits next to the labyrinth. Env: SIM_LAB (1-7: Cruel..Final), SIM_CHA, SIM_HOURS,
 * SIM_TRIALS, SIM_POLICY, SIM_ANCHOR_POLICY, SIM_ANCHORS, SIM_THRESHOLD (min crossing chance), SIM_OUT.
 */
import fs from "fs";
import { Player } from "@player";
import { AugmentationName } from "@enums";
import { DarknetState, getServerState } from "../../src/DarkNet/models/DarknetState";
import { populateDarknet, clearDarknet } from "../../src/DarkNet/controllers/NetworkGenerator";
import { mutateDarknet } from "../../src/DarkNet/controllers/NetworkMovement";
import { getRamBlockRemoved } from "../../src/DarkNet/effects/ramblock";
import { calculateAuthenticationTime, chargeServerMigration, getDarkscapeNavigator } from "../../src/DarkNet/effects/effects";
import { getLabyrinthDetails, getNetDepth, isLabyrinthServer } from "../../src/DarkNet/effects/labyrinth";
import { getAllOpenPositions, getDarknetCyclesPerMutation, getAllDarknetServers } from "../../src/DarkNet/utils/darknetNetworkUtils";
import { DarknetServer } from "../../src/Server/DarknetServer";
import { GetServer } from "../../src/Server/AllServers";
import { SpecialServers } from "../../src/Server/data/SpecialServers";
import { AIR_GAP_DEPTH } from "../../src/DarkNet/Enums";
import { fixDoImportIssue, initGameEnvironment, setupBasicTestingEnvironment } from "./Utilities";

fixDoImportIssue();
initGameEnvironment();

const env = process.env;
const LAB = Number(env.SIM_LAB ?? 4); // 4 = Eternal (depth 29)
const CHA = Number(env.SIM_CHA ?? 3000);
const HOURS = Number(env.SIM_HOURS ?? 12);
const TRIALS = Number(env.SIM_TRIALS ?? 5);
const POLICY = env.SIM_POLICY ?? "depth";
const ANCHOR_POLICY = env.SIM_ANCHOR_POLICY ?? "lab";
const ANCHORS = Number(env.SIM_ANCHORS ?? 4);
const THRESHOLD = Number(env.SIM_THRESHOLD ?? 0.3);
const OUT = env.SIM_OUT ?? "/tmp/crosssim.json";
const THREADS = env.SIM_THREADS ?? "1"; // "1": auth and RAM freeing in 1-thread scripts (current probe); "auto": spare RAM
const PROBE_RESERVE_GB = 8; // probe + temp scripts
const MIGRATION_THREAD_RAM = 5.6;
const MIGRATION_RECHECK_S = 180;
const DEPLOY_S = 5;
// Median solver attempts per model at high difficulty (tools/dnet-sim full2, d=16..30)
const ATTEMPTS: Record<string, number> = {
  "110100100": 2, "2G_cellular": 46, "AccountsManager_4.2": 9, BellaCuore: 9, "BigMo%od": 7, "CloudBlare(tm)": 1,
  DeepGreen: 15, "DeskMemo_3.1": 1, "EuroZone Free": 3, "Factori-Os": 75, "FreshInstall_1.0": 3, KingOfTheHill: 32,
  Laika4: 3, MathML: 1, NIL: 58, OctantVoxel: 11, OpenWebAccessPoint: 3, OrdoXenos: 1, "PHP 5.4": 7, Pr0verFl0: 1,
  "PrimeTime 2": 11, "RateMyPix.Auth": 80, TopPass: 8, ZeroLogon: 1,
};
const LAB_AUGS = [AugmentationName.TheBrokenWings, AugmentationName.TheBoots, AugmentationName.TheHammer,
  AugmentationName.TheStaff, AugmentationName.TheLaw, AugmentationName.TheSword];

type Job = { kind: "crack" | "deploy" | "free"; target: string; until: number };
type Charge = { target: string; threads: number; nextCall: number };

const segOf = (depth: number) => Math.floor(depth / AIR_GAP_DEPTH);
const dnet = (h: string) => {
  const s = GetServer(h);
  return s instanceof DarknetServer ? s : null;
};

/** Chance that a full migration lands past `gap` (the game picks a random open slot in [diff-2, diff+4]). */
function crossChance(server: DarknetServer, gap: number): number {
  const positions = getAllOpenPositions(server.difficulty - 2, server.difficulty + 4);
  if (!positions.length) return 0;
  return positions.filter(([x]) => x > gap).length / positions.length;
}

const freeRam = (s: DarknetServer) => s.maxRam - s.blockedRam - PROBE_RESERVE_GB;
/** Threads a probe host gives to a helper of `ram` GB per thread (half its spare RAM; the rest is for migrations). */
const helperThreads = (host: DarknetServer, ram: number) =>
  THREADS === "auto" ? Math.max(1, Math.floor(Math.max(0, freeRam(host)) * 0.5 / ram)) : 1;
const freeDelayS = () => (Math.max(8000 * (500 / (500 + Player.skills.charisma)), 200) + 50) / 1000;

async function runTrial(trial: number) {
  clearDarknet();
  DarknetState.offlineServers = new Set();
  DarknetState.migrationInductionServers = new Map();
  populateDarknet();
  const lab = getLabyrinthDetails().lab;
  const labDepth = getNetDepth();
  const cracked = new Set<string>([SpecialServers.DarkWeb]);
  const probes = new Set<string>([SpecialServers.DarkWeb]); // darkweb: the orchestrator on home
  const jobs = new Map<string, Job>();
  const charges = new Map<string, Charge>();
  const lastChargeCheck = new Map<string, number>();
  const passwords = new Map<string, string>();
  const freeing = new Set<string>();
  let t = 0;
  let nextMutation = 0;
  const segReached: Record<number, number> = { 0: 0 };
  let labAt: number | null = null;
  let migrations = 0;
  let crossings = 0;
  let probeKills = 0;
  const mutationS = (getDarknetCyclesPerMutation() * 200) / 1000;

  const frontierGap = () => {
    let seg = 0;
    for (const h of probes) {
      const s = dnet(h);
      if (s && s.depth >= 0) seg = Math.max(seg, segOf(s.depth));
    }
    const gap = (seg + 1) * AIR_GAP_DEPTH;
    return labDepth - 1 < gap ? 0 : gap;
  };

  while (t < HOURS * 3600 && labAt === null) {
    // Network mutations at the game's rate
    while (nextMutation <= t) {
      mutateDarknet();
      nextMutation += mutationS;
    }
    // Probe deaths: deleted servers, restarts (the engine logs pid -1 on restart); deleted hostnames lose passwords
    for (const h of [...cracked]) {
      if (h === SpecialServers.DarkWeb) continue;
      const s = dnet(h);
      if (!s || passwords.get(h) !== s.password) {
        cracked.delete(h);
        if (probes.delete(h)) probeKills++;
        jobs.delete(h);
        charges.delete(h);
        continue;
      }
      const logs = getServerState(h).serverLogs;
      if (logs.some((l) => l.pid === -1)) {
        if (probes.delete(h)) probeKills++;
        jobs.delete(h);
        charges.delete(h);
        logs.length = 0;
      }
    }
    // Anchors
    if (ANCHOR_POLICY !== "none") {
      const anchored = getAllDarknetServers().filter((s) => s.hasStasisLink);
      for (const s of anchored) if (!probes.has(s.hostname) && cracked.has(s.hostname)) probes.add(s.hostname); // home redeploys
      let wanted: string[] = [];
      const hosts = [...probes].map(dnet).filter((s): s is DarknetServer => !!s && s.hostname !== SpecialServers.DarkWeb && s.maxRam >= 13.6);
      if (ANCHOR_POLICY === "lab") wanted = hosts.filter((s) => lab && s.serversOnNetwork.includes(lab.hostname)).map((s) => s.hostname).slice(0, 1);
      else if (ANCHOR_POLICY === "frontier") {
        const gap = frontierGap();
        const best = hosts.filter((s) => lab && s.serversOnNetwork.includes(lab.hostname)).slice(0, 1);
        const rest = hosts.filter((s) => !best.includes(s)).sort((a, b) => b.depth - a.depth);
        // the deepest hosts, but leave launch candidates (those that could cross) free to migrate
        wanted = [...best, ...rest.filter((s) => !gap || crossChance(s, gap) < THRESHOLD)].slice(0, ANCHORS).map((s) => s.hostname);
      }
      for (const s of anchored) if (!wanted.includes(s.hostname)) s.hasStasisLink = s.backdoorInstalled = false;
      for (const h of wanted) {
        const s = dnet(h)!;
        if (!s.hasStasisLink && getAllDarknetServers().filter((x) => x.hasStasisLink).length < ANCHORS) s.hasStasisLink = s.backdoorInstalled = true;
      }
    }
    // Probes free their own server's blocked RAM in the background
    for (const h of probes) {
      const host = dnet(h);
      if (!host || host.blockedRam <= 0 || h === SpecialServers.DarkWeb) continue;
      const threads = THREADS === "auto" ? Math.max(1, Math.floor(Math.max(0, freeRam(host)) / 2.6)) : 1;
      host.blockedRam = Math.max(0, host.blockedRam - getRamBlockRemoved(host, threads) / freeDelayS());
    }
    // Probes: one crack/free/deploy job each
    for (const h of [...probes]) {
      const host = dnet(h);
      if (!host) continue;
      const job = jobs.get(h);
      if (job && job.until <= t) {
        jobs.delete(h);
        const target = dnet(job.target);
        if (target && host.serversOnNetwork.includes(target.hostname)) {
          if (job.kind === "free") freeing.delete(target.hostname);
          if (job.kind === "crack") {
            cracked.add(target.hostname);
            passwords.set(target.hostname, target.password);
          }
          if (freeRam(target) >= 0) probes.add(target.hostname);
          else if (target.maxRam >= PROBE_RESERVE_GB) {
            // Free enough of its blocked RAM remotely for a probe (memoryReallocation from this host)
            const need = target.blockedRam - (target.maxRam - PROBE_RESERVE_GB);
            const perCall = getRamBlockRemoved(target, helperThreads(host, 2.6));
            const calls = Math.ceil(need / Math.max(perCall, 1e-6));
            jobs.set(h, { kind: "free", target: target.hostname, until: t + calls * freeDelayS() });
            target.blockedRam = Math.max(0, target.blockedRam - Math.min(need, calls * perCall)); // applied at the end below
            freeing.add(target.hostname);
          }
        }
      }
      if (jobs.has(h)) continue;
      if (lab && host.serversOnNetwork.includes(lab.hostname)) {
        labAt = t;
        break;
      }
      for (const n of host.serversOnNetwork) {
        const s = dnet(n);
        if (!s || isLabyrinthServer(n) || n === SpecialServers.DarkWeb) continue;
        if (cracked.has(n) && !probes.has(n) && !freeing.has(n)) {
          jobs.set(h, { kind: "deploy", target: n, until: t + DEPLOY_S });
          break;
        }
        if (!cracked.has(n)) {
          const attempts = ATTEMPTS[s.modelId] ?? 10;
          const ms = attempts * (calculateAuthenticationTime(s, Player, helperThreads(host, 2.0)) + 200);
          jobs.set(h, { kind: "crack", target: n, until: t + ms / 1000 });
          break;
        }
      }
    }
    // Migration charging (a separate script on each probe host)
    const gap = frontierGap();
    for (const h of probes) {
      if (POLICY === "none" || !gap || h === SpecialServers.DarkWeb) continue;
      const host = dnet(h);
      if (!host) continue;
      const charge = charges.get(h);
      if (charge) {
        if (charge.nextCall > t) continue;
        const target = dnet(charge.target);
        if (!target || !host.serversOnNetwork.includes(target.hostname) || target.hasStasisLink) {
          charges.delete(h);
          continue;
        }
        const before = target.depth;
        const r = chargeServerMigration(target, charge.threads);
        charge.nextCall = t + 6;
        if (r.newCharge >= 1 || DarknetState.migrationInductionServers.get(target.hostname) === 0) {
          charges.delete(h);
          migrations++;
          if (target.depth > gap && before < gap) crossings++;
        }
        continue;
      }
      if (t - (lastChargeCheck.get(h) ?? -1e9) < MIGRATION_RECHECK_S) continue;
      lastChargeCheck.set(h, t);
      const threads = Math.floor(Math.max(0, freeRam(host)) / MIGRATION_THREAD_RAM);
      if (threads < 1) continue;
      let best: { target: string; score: number } | null = null;
      for (const n of host.serversOnNetwork) {
        const s = dnet(n);
        if (!s || !probes.has(n) || s.hasStasisLink || s.isStationary || isLabyrinthServer(n) || s.depth >= gap) continue;
        if (lab && s.serversOnNetwork.includes(lab.hostname)) continue;
        let score = 0;
        if (POLICY === "depth") score = s.depth >= gap - 3 ? 1 : 0;
        else if (POLICY === "difficulty") score = crossChance(s, gap) >= THRESHOLD ? crossChance(s, gap) : 0;
        if (score > 0 && (!best || score > best.score)) best = { target: n, score };
      }
      if (best) charges.set(h, { target: best.target, threads, nextCall: t });
    }
    // Progress
    for (const h of probes) {
      const s = dnet(h);
      if (!s || s.depth < 0) continue;
      const seg = segOf(s.depth);
      if (segReached[seg] === undefined) segReached[seg] = t;
    }
    t += 1;
  }
  return {
    trial, labDepth, labAt: labAt === null ? null : +(labAt / 3600).toFixed(2),
    segReached: Object.fromEntries(Object.entries(segReached).map(([k, v]) => [k, +(v / 3600).toFixed(2)])),
    migrations, crossings, probeKills, probesAtEnd: probes.size,
  };
}

test(
  "darknet depth progress",
  async () => {
    setupBasicTestingEnvironment();
    Player.sourceFiles.set(15, 1);
    for (const aug of LAB_AUGS.slice(0, LAB)) Player.augmentations.push({ name: aug, level: 1 });
    getDarkscapeNavigator();
    Player.skills.charisma = CHA;
    Player.gainCharismaExp = () => {};
    const results = [];
    for (let i = 0; i < TRIALS; i++) {
      results.push(await runTrial(i));
      fs.writeFileSync(OUT, JSON.stringify({ policy: POLICY, threads: THREADS, anchors: ANCHOR_POLICY, slots: ANCHORS, cha: CHA, results }));
    }
  },
  6 * 3600 * 1000,
);
