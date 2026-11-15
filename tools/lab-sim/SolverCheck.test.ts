/**
 * Runs darknet.js's actual LAB_SOLVER_CONTENT against mazes from the game's generator, with labreport/authenticate
 * mocked to return the game's messages and getSurroundingsVisualized views (labyrinth.ts handleLabyrinthPassword).
 * Env: SIM_DARKNET (path to darknet.js, or Remote/darknet-probe.js with SIM_PROBE=1), SIM_MAZES, SIM_OUT.
 */
import fs from "fs";
import { generateMaze, getSurroundingsVisualized } from "../../src/DarkNet/effects/labyrinth";

test("lab solver against real mazes", async () => {
  const src = fs.readFileSync(process.env.SIM_DARKNET ?? "", "utf8");
  const probe = process.env.SIM_PROBE === "1";
  const arr = probe ? src.match(/const solverScript = (\[[\s\S]*?\])\.join\("\\n"\);/) : src.match(/const LAB_SOLVER_CONTENT = (\[[\s\S]*?\])\.join\("\\n"\);/);
  if (!arr) throw new Error("LAB_SOLVER_CONTENT not found");
  const code = (new Function("return " + arr[1])() as string[]).join("\n").replace("export async function main", "return async function main");
  const results: number[] = [];
  for (let n = 0; n < Number(process.env.SIM_MAZES ?? 50); n++) {
    const maze = generateMaze(60, 40);
    const off = () => Math.floor(Math.random() * 3) * 2;
    let pos = [1 + off(), 1 + off()];
    const end = [maze[0].length - 2 - off(), maze.length - 2 - off()];
    let steps = 0, outcome = "";
    const D: Record<string, number[]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    const view = () => getSurroundingsVisualized(maze, pos[0], pos[1], 1, true, false);
    const ns = {
      args: probe ? ["f1n4l_l4byr1nth", "/Temp/rf.txt", 59, 39] : ["f1n4l_l4byr1nth", 18, 59, 39],
      ramOverride: () => {},
      write: (_f: string, s: string) => { outcome = s === "SUCCESS" ? '"password"' : s; },
      sleep: async () => {},
      writePort: (_p: number, s: string) => { outcome = s; },
      dnet: {
        labreport: async () => { steps++; const r = view().split("\n");
          return { success: true, coords: [...pos], north: r[0][1] === " ", east: r[1][2] === " ", south: r[2][1] === " ", west: r[1][0] === " " }; },
        authenticate: async (_h: string, cmd: string) => {
          steps++;
          const d = D[cmd.split(" ")[1]];
          if (maze[pos[1] + d[1]]?.[pos[0] + d[0]] !== " ")
            return { success: false, message: `You cannot go that way. You are still at ${pos[0]},${pos[1]}.`, data: view() };
          pos = [pos[0] + 2 * d[0], pos[1] + 2 * d[1]];
          if (pos[0] === end[0] && pos[1] === end[1]) return { success: true, message: "You have successfully navigated the labyrinth! Congratulations", data: "pw" };
          return { success: false, message: `You have moved to ${pos[0]},${pos[1]}.`, data: view() };
        },
      },
    };
    await (new Function(code)() as (ns: unknown) => Promise<void>)(ns);
    if (!outcome.includes('"password"')) throw new Error("solver failed: " + outcome);
    results.push(steps);
  }
  const s = [...results].sort((a, b) => a - b);
  fs.writeFileSync(process.env.SIM_OUT ?? "/tmp/solvercheck.json", JSON.stringify({ mean: Math.round(results.reduce((a, b) => a + b, 0) / results.length), median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] }));
});
