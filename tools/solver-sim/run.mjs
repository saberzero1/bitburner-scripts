// Old (a git ref, default HEAD) vs new (working tree) darknet-probe.js solvers on engine-generated passwords.
// usage: node tools/solver-sim/run.mjs [trials per model=1000] [models comma-separated] [oldRef=HEAD]
// env: FREE_GB (helper RAM on the probe's host, default 12), TIMEOUT (408 chance per auth, default 0.03)
import { loadProbe, probeSource, runSolver } from "./harness.mjs";

const trials = Number(process.argv[2] ?? 1000);
const DIFFS = {
  NIL: [3, 5, 8, 9, 12, 16, 20],
  "PHP 5.4": [3, 10, 15, 20, 30, 40, 50],
  DeepGreen: [3, 8, 12, 16, 17, 25, 35, 45],
  "Factori-Os": [3, 8, 12, 13, 18, 24, 25, 30, 40, 50],
  KingOfTheHill: [3, 6, 8, 12, 16, 24, 32, 40, 48, 54, 60],
  "RateMyPix.Auth": [3, 8, 9, 12, 16, 20],
  "2G_cellular": [9, 12, 16, 17, 20, 25, 30],
  "BigMo%od": [9, 15, 20, 30, 40, 50, 60],
  "FreshInstall_1.0": [3],
  Laika4: [5],
  TopPass: [20],
  "EuroZone Free": [20],
};
const models = process.argv[3] ? process.argv[3].split(",") : Object.keys(DIFFS);
const oldRef = process.argv[4] ?? "HEAD";
const opts = { freeGb: Number(process.env.FREE_GB ?? 12), timeoutChance: Number(process.env.TIMEOUT ?? 0.03) };
const versions = { old: loadProbe(probeSource(oldRef)), new: loadProbe(probeSource("work")) };

const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
const p90 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.9)];
const fmt = (a) => `${mean(a).toFixed(1)}/${p90(a).toFixed(0)}`;

console.log(`trials ${trials}/model, freeGb ${opts.freeGb}, timeout ${opts.timeoutChance}. cells: mean/p90`);
console.log("model            ver  ok%     heartbleeds  auths       waves      time(auth units)");
for (const model of models) {
  const diffs = DIFFS[model];
  for (const [ver, factory] of Object.entries(versions)) {
    const rs = [];
    for (let i = 0; i < trials; i++) rs.push(await runSolver(factory, model, diffs[i % diffs.length], opts));
    const fails = rs.filter((r) => !r.ok);
    const okPct = (100 * (rs.length - fails.length)) / rs.length;
    console.log(
      `${model.padEnd(16)} ${ver.padEnd(4)} ${okPct.toFixed(1).padStart(5)}  ${fmt(rs.map((r) => r.bleeds)).padEnd(12)} ` +
        `${fmt(rs.map((r) => r.auths)).padEnd(11)} ${fmt(rs.map((r) => r.waves)).padEnd(10)} ${fmt(rs.map((r) => r.time))}`,
    );
    if (process.env.FAILS && fails.length)
      for (const f of fails.slice(0, Number(process.env.FAILS)))
        console.log(`   fail d=${f.difficulty} pw=${f.password} got=${f.result} err=${f.error?.message ?? ""}`);
  }
}
