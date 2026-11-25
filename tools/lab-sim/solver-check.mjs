// Runs servers/home/Remote/lab-solver.js against the game's maze generator with a mock ns (positions per PID, a shared
// port 27, labreport/authenticate like DarkNet/effects/labyrinth.ts). node tools/lab-sim/solver-check.mjs [mazes]
import { main } from "../../servers/home/Remote/lab-solver.js";
const WALL = 1, PATH = 0, N = [0, -1], E = [1, 0], S = [0, 1], W = [-1, 0];
function mazeMaker(sw, sh) { const w = sw % 2 === 0 ? sw + 1 : sw, h = sh % 2 === 0 ? sh + 1 : sh; const m = Array.from({ length: h }, () => Array(w).fill(WALL)); const st = [[1, 1]];
  while (st.length) { const [x, y] = st.pop(); const nb = [N, E, S, W].map(([dx, dy]) => [x + dx * 2, y + dy * 2]).filter(([a, b]) => a > 0 && a < w && b > 0 && b < h && m[b][a] === WALL);
    if (nb.length) { st.push([x, y]); const [a, b] = nb[Math.floor(Math.random() * nb.length)]; m[(y + b) / 2][(x + a) / 2] = PATH; m[b][a] = PATH; st.push([a, b]); } } return m; }
function generateMaze(width, height) { const hw = Math.ceil(width / 2), hh = Math.ceil(height / 2); const [m1, m2, m3, m4] = [0, 0, 0, 0].map(() => mazeMaker(hw, hh));
  const top = m1.map((r, y) => r.slice(0, -1).concat(m2[y])), bot = m3.map((r, y) => r.slice(0, -1).concat(m4[y])); const m = top.slice(0, -1).concat(bot); const sw = m1[0].length - 1, sh = m1.length - 1;
  m[Math.floor((Math.random() * hh) / 4) * 2 + 1][sw] = PATH; m[sh][Math.floor((Math.random() * hw) / 4) * 2 + 1] = PATH; m[m.length - (Math.floor((Math.random() * hh) / 4) * 2 + 1) - 1][sw] = PATH; m[sh][m[0].length - (Math.floor((Math.random() * hw) / 4) * 2 + 1) - 1] = PATH; return m; }
const off = (len, on) => (on ? Math.floor(Math.random() * Math.min(3, len / 4)) * 2 : 0);
async function run(MW, MH, nSolvers) {
  const m = generateMaze(MW, MH), offsets = MW >= 60, H = m.length, Wd = m[0].length;
  const end = [Wd - 2 - off(H, offsets), H - 2 - off(H, offsets)];
  const ports = new Map(); let done = null; const moves = {};
  const vis = (x, y) => [-1, 0, 1].map((dy) => [-1, 0, 1].map((dx) => (dx === 0 && dy === 0 ? "@" : m[y + dy]?.[x + dx] === PATH ? " " : "█")).join("")).join("\n");
  const solvers = Array.from({ length: nSolvers }, (_, i) => {
    const pid = 100 + i; let pos = [1 + off(H, offsets), 1 + off(H, offsets)]; moves[pid] = 0;
    const ns = { pid, args: ["lab", "file", Wd, H, offsets ? 1 : 0],
      sleep: () => new Promise((r) => setImmediate(r)),
      write: (f, d) => { if (d === "SUCCESS" && !done) done = pid; },
      writePort: (p, d) => { if (!ports.has(p)) ports.set(p, []); ports.get(p).push(d); },
      peek: (p) => ports.get(p)?.[0] ?? "NULL PORT DATA", clearPort: (p) => ports.set(p, []),
      dnet: {
        labreport: async () => ({ success: true, coords: [...pos], north: m[pos[1] - 1][pos[0]] === PATH, south: m[pos[1] + 1][pos[0]] === PATH, west: m[pos[1]][pos[0] - 1] === PATH, east: m[pos[1]][pos[0] + 1] === PATH }),
        authenticate: async (h, cmd) => {
          await new Promise((r) => setImmediate(r)); // one move per tick per solver: solvers interleave
          if (done) return { success: false, message: "x" };
          moves[pid]++;
          const d = { north: N, east: E, south: S, west: W }[cmd.split(" ")[1]];
          if (m[pos[1] + d[1]][pos[0] + d[0]] !== PATH) return { success: false, message: `You cannot go that way. You are still at ${pos}.` };
          pos = [pos[0] + 2 * d[0], pos[1] + 2 * d[1]];
          if (pos[0] === end[0] && pos[1] === end[1]) return { success: true, data: "pw" };
          return { success: false, message: `You have moved to ${pos[0]},${pos[1]}.`, data: vis(pos[0], pos[1]) };
        } } };
    return main(ns);
  });
  await Promise.race([Promise.all(solvers), new Promise((r) => { const t = setInterval(() => { if (done) { clearInterval(t); r(); } }, 1); })]);
  return done ? moves[done] : Infinity;
}
const n = Number(process.argv[2] ?? 100);
for (const [MW, MH] of [[60, 40], [40, 26]]) for (const k of [1, 2, 3]) {
  const r = []; for (let i = 0; i < n; i++) r.push(await run(MW, MH, k));
  const s = [...r].sort((a, b) => a - b);
  console.log(`${MW}x${MH} ${k} solver(s): mean ${(r.reduce((t, v) => t + v, 0) / n).toFixed(0)} median ${s[n >> 1]} p90 ${s[Math.floor(n * 0.9)]} fails ${r.filter((v) => v === Infinity).length}`);
}
process.exit(0);
