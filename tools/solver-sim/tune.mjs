// Batch-size sweeps: patch a constant in the working-tree probe and compare.
// usage: node tools/solver-sim/tune.mjs <trials> <model> "<CONST>=<v1>,<v2>,..." [FREE_GB list e.g. 2,12,40]
import { loadProbe, probeSource, runSolver } from "./harness.mjs";
const [trials, model, spec, frees = "12"] = process.argv.slice(2);
const [name, vals] = spec.split("=");
const DIFFS = {
  NIL: [3, 5, 8, 9, 12, 16, 20], DeepGreen: [3, 8, 12, 16, 17, 25, 35, 45], "Factori-Os": [3, 8, 12, 13, 18, 24, 25, 30, 40, 50],
  KingOfTheHill: [3, 6, 8, 12, 16, 24, 32, 40, 48, 54, 60], "RateMyPix.Auth": [3, 8, 9, 12, 16, 20], "2G_cellular": [9, 12, 16, 17, 20, 25, 30],
};
const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
for (const free of frees.split(",").map(Number)) {
  for (const v of vals.split(",")) {
    const src = probeSource("work").replace(new RegExp(`const ${name} = [^;]+;`), `const ${name} = ${v};`);
    const f = loadProbe(src);
    const rs = [];
    for (let i = 0; i < Number(trials); i++) rs.push(await runSolver(f, model, DIFFS[model][i % DIFFS[model].length], { freeGb: free, timeoutChance: 0.03 }));
    console.log(`free ${free} ${name}=${v}: ok ${rs.filter((r) => r.ok).length}/${rs.length} hb ${mean(rs.map((r) => r.bleeds)).toFixed(2)} auths ${mean(rs.map((r) => r.auths)).toFixed(1)} waves ${mean(rs.map((r) => r.waves)).toFixed(1)} time ${mean(rs.map((r) => r.time)).toFixed(2)}`);
  }
}
