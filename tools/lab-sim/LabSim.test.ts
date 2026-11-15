/**
 * Labyrinth search simulation (copied into bitburner-src/test/jest by tools/lab-sim/run.sh).
 * Mazes come from the game's generateMaze (src/DarkNet/effects/labyrinth.ts). Each step is one authenticate("go X")
 * or labreport/labradar call, which all cost the same time. A move's response shows the 3x3 around the new cell.
 * Env: SIM_W, SIM_H (maze size, Final lab 60x40), SIM_MAZES (count), SIM_OFFSET (max start/end offset, cells), SIM_OUT.
 */
import fs from "fs";
import { generateMaze } from "../../src/DarkNet/effects/labyrinth";

const env = process.env;
const W = Number(env.SIM_W ?? 60), H = Number(env.SIM_H ?? 40), N = Number(env.SIM_MAZES ?? 200);
const MAXOFF = Number(env.SIM_OFFSET ?? 3);
const DIRS: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const ORDER = ["north", "south", "east", "west"];
type P = [number, number];
const key = (p: P) => p[0] + "," + p[1];
const open = (m: string[], p: P, d: string) => m[p[1] + DIRS[d][1]]?.[p[0] + DIRS[d][0]] === " ";
const step = (p: P, d: string): P => [p[0] + 2 * DIRS[d][0], p[1] + 2 * DIRS[d][1]];

/** Single DFS explorer. report: labreport before every move (current solver). goal: try directions toward the end first. */
function dfs(m: string[], start: P, end: P, report: boolean, goal: boolean, aim: P = end): number {
  const visited = new Set<string>();
  const stack: string[] = [];
  let pos = start, steps = report ? 0 : 1; // without per-move reports, one initial labreport
  for (let guard = 0; guard < 1e6; guard++) {
    if (report) steps++;
    visited.add(key(pos));
    let dirs = ORDER;
    if (goal) dirs = [...ORDER].sort((a, b) => (aim[0] - pos[0]) * DIRS[b][0] + (aim[1] - pos[1]) * DIRS[b][1] - ((aim[0] - pos[0]) * DIRS[a][0] + (aim[1] - pos[1]) * DIRS[a][1]));
    const d = dirs.find((d) => open(m, pos, d) && !visited.has(key(step(pos, d))));
    if (d) {
      steps++;
      pos = step(pos, d);
      stack.push(d);
      if (pos[0] === end[0] && pos[1] === end[1]) return steps;
    } else {
      const back = stack.pop();
      if (!back) return Infinity;
      const rev = { north: "south", south: "north", east: "west", west: "east" }[back] as string;
      steps++;
      pos = step(pos, rev);
    }
  }
  return Infinity;
}

/** k explorers sharing one map. Each walks (BFS over known cells) to the nearest unexplored frontier not claimed by
 * another, preferring frontiers closer to the end when goal=true. Returns elapsed steps until any reaches the end. */
function parallel(m: string[], start: P, end: P, k: number, goal: boolean): number {
  const known = new Set<string>([key(start)]); // cells whose walls we've seen (stood on)
  const pos: P[] = Array.from({ length: k }, () => [...start] as P);
  const paths: P[][] = Array.from({ length: k }, () => []);
  const claimed = new Map<number, string>();
  const neighbors = (p: P) => ORDER.filter((d) => open(m, p, d)).map((d) => step(p, d));
  const plan = (i: number) => {
    // BFS from pos[i] through known cells; frontier = known cell with an open side to an unknown cell
    const prev = new Map<string, string | null>([[key(pos[i]), null]]);
    const distOf = new Map<string, number>([[key(pos[i]), 0]]);
    const q: P[] = [pos[i]];
    const others = new Set([...claimed.entries()].filter(([j]) => j !== i).map(([, v]) => v));
    let best: P | null = null, bestScore = Infinity;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const dist = distOf.get(key(c)) ?? 0;
      for (const n of neighbors(c)) {
        const nk = key(n);
        if (!known.has(nk)) {
          if (others.has(nk)) continue;
          const score = dist + 1 + (goal ? 0.5 * (Math.abs(end[0] - n[0]) + Math.abs(end[1] - n[1])) / 2 : 0);
          if (score < bestScore) { bestScore = score; best = n; prev.set(nk, key(c)); }
        } else if (!prev.has(nk)) { prev.set(nk, key(c)); distOf.set(nk, dist + 1); q.push(n); }
      }
    }
    if (!best) return;
    const path: P[] = [];
    for (let s: string | null = key(best); s && s !== key(pos[i]); s = prev.get(s) ?? null) path.unshift(s.split(",").map(Number) as P);
    paths[i] = path;
    claimed.set(i, key(best));
  };
  for (let t = 1; t < 1e6; t++) {
    for (let i = 0; i < k; i++) {
      if (paths[i].length === 0) plan(i);
      const nxt = paths[i].shift();
      if (!nxt) continue;
      pos[i] = nxt;
      known.add(key(nxt));
      if (nxt[0] === end[0] && nxt[1] === end[1]) return t + 1; // + initial report
      if (claimed.get(i) === key(nxt)) claimed.delete(i);
    }
  }
  return Infinity;
}

test("labyrinth search", () => {
  const results: Record<string, number[]> = {};
  const add = (name: string, v: number) => (results[name] ??= []).push(v);
  for (let n = 0; n < N; n++) {
    const m = generateMaze(W, H);
    const off = () => Math.floor(Math.random() * MAXOFF) * 2;
    const start: P = [1 + off(), 1 + off()];
    const end: P = [m[0].length - 2 - off(), m.length - 2 - off()];
    add("dfs+report (current)", dfs(m, start, end, true, false));
    add("dfs", dfs(m, start, end, false, false));
    add("dfs goal-first", dfs(m, start, end, false, true));
    add("dfs toward grid corner", dfs(m, start, end, false, true, [m[0].length - 2, m.length - 2]));
    for (const k of [1, 2]) add(`shared map x${k} goal`, parallel(m, start, end, k, true));
  }
  const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => {
    const s = [...v].sort((a, b) => a - b);
    return [k, { mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length), median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)] }];
  }));
  fs.writeFileSync(env.SIM_OUT ?? "/tmp/labsim.json", JSON.stringify(summary, null, 1));
});
