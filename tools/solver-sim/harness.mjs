// Runs darknet-probe.js solvers against engine.mjs with a mock ns on a virtual clock.
// - Temp scripts (ns.exec of the probe's /Temp/dnet-cmd-*.js) are recognised by their source and complete after the
//   engine's delay: authenticate = auth time, heartbleed = 1.5x auth time (NetscriptFunctions/Darknet.ts). The password
//   is checked and the attempt logged when the delay ends, as in the engine.
// - Direct ns.dnet calls and ns.sleep advance the clock; a second async ns call while one is pending throws, like the
//   engine's concurrency check (Netscript/NetscriptHelpers.tsx checkEnvFlags).
// - Authentications time out (code 408, nothing logged) with probability `timeoutChance`
//   (effects/offlineServerHandling.ts getTimeoutChance: 3% per frozen/extra backdoored server).
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as E from "./engine.mjs";

const REPO = new URL("../../", import.meta.url).pathname;
const PROBE = "servers/home/Remote/darknet-probe.js";

export function probeSource(ref) {
  if (!ref || ref === "work") return readFileSync(REPO + PROBE, "utf8");
  return execSync(`git -C ${REPO} show ${ref}:${PROBE}`, { encoding: "utf8", maxBuffer: 64 << 20 });
}

export function loadProbe(src) {
  const body = src.replace(/^export /gm, "") + "\n;return { SOLVER_MAP };";
  return new Function("Date", body);
}

export async function runSolver(factory, modelId, difficulty, opts = {}) {
  const { baseMs = 1000, freeGb = 12, timeoutChance = 0.03, server: given } = opts;
  const s = given ?? E.makeServer(modelId, difficulty);
  let now = 1_000_000;
  const DateShim = { now: () => now };
  const { SOLVER_MAP } = factory(DateShim);
  const files = new Map();
  const events = []; // {t, fn}
  const stats = { auths: 0, bleeds: 0, maxConcurrent: 0, waves: 0, solvedBy: null, time: 0 };
  let running = 0;
  let usedRam = 7.2;
  const maxRam = 7.2 + 4 + freeGb; // probe + HELPER_HEADROOM_GB + helper RAM
  let busy = false;
  let pid = 100;
  let lastAuthStart = -1;

  const advance = (t) => {
    for (;;) {
      events.sort((a, b) => a.t - b.t);
      if (!events.length || events[0].t > t) break;
      const ev = events.shift();
      now = Math.max(now, ev.t);
      ev.fn();
    }
    now = Math.max(now, t);
  };
  const doAuth = (password, threads, p) => {
    stats.auths++;
    const dur = E.authTime(s, threads, password, baseMs);
    return {
      dur,
      finish: () => {
        if (Math.random() < timeoutChance) return { success: false, code: 408, message: "Request timed out" };
        const resp = E.checkPassword(s, password, dur);
        E.logPasswordAttempt(s, resp, p, now);
        if (resp.code === 200) {
          if (!stats.solvedBy) stats.solvedBy = password;
          return { success: true, code: 200, message: "Success" };
        }
        return { success: false, code: 401, message: "Unauthorized" };
      },
    };
  };
  const doBleed = (host, opts2, threads) => {
    stats.bleeds++;
    const dur = 1.5 * E.authTime(s, threads, "", baseMs);
    return {
      dur,
      finish: () => ({ success: true, code: 200, message: "Success", logs: E.getServerLogs(s, opts2?.logsToCapture ?? 1, !!opts2?.peek, now) }),
    };
  };
  // The engine marks the script busy until an async ns call's promise settles, and any ns call meanwhile kills the
  // script; so busy is cleared only when the promise resolves (a Promise.all of two ns calls throws here too).
  let killed = null; // the engine kills the script (killWorkerScript), so a caught error still ends the run
  const check = () => {
    if (killed) throw killed;
    if (busy) throw (killed = new Error("CONCURRENCY: concurrent ns calls"));
  };
  const asyncCall = (dur, finish) => {
    check();
    busy = true;
    advance(now + dur);
    const v = finish();
    return Promise.resolve().then(() => {
      busy = false;
      return v;
    });
  };
  const ns0 = {
    pid: 1,
    args: [],
    getHostname: () => "probehost",
    getServerMaxRam: () => maxRam,
    getServerUsedRam: () => usedRam,
    hasRootAccess: () => false,
    print: () => {},
    tprint: () => {},
    write: (f, d, mode) => {
      files.set(f, mode === "a" ? (files.get(f) ?? "") + d : String(d));
    },
    read: (f) => files.get(f) ?? "",
    sleep: (ms) => asyncCall(ms ?? 0, () => true),
    asleep: (ms) => (advance(now + (ms ?? 0)), Promise.resolve(true)),
    exec: (script, host, threads = 1, ...args) => {
      const src = files.get(script) ?? "";
      const resultFile = args[args.length - 1];
      let job;
      let ram;
      if (src.includes("authenticate(")) {
        ram = 2.0;
        job = doAuth(String(args[1]), threads, pid + 1);
        if (now !== lastAuthStart) stats.waves++;
        lastAuthStart = now;
      } else if (src.includes("heartbleed(")) {
        ram = 2.2;
        const m = src.includes("logsToCapture") ? { peek: true, logsToCapture: Number(args[1]) } : { peek: true };
        job = doBleed(args[0], m, threads);
      } else throw new Error(`unexpected temp script ${script}: ${src.slice(0, 120)}`);
      if (usedRam + ram * threads > maxRam + 1e-9) return 0;
      usedRam += ram * threads;
      running++;
      stats.maxConcurrent = Math.max(stats.maxConcurrent, running);
      const myPid = ++pid;
      events.push({
        t: now + job.dur,
        fn: () => {
          const v = job.finish();
          usedRam -= ram * threads;
          running--;
          files.set(resultFile, JSON.stringify({ $type: "result", $value: v }));
        },
      });
      return myPid;
    },
    dnet: {
      authenticate: (host, password) => {
        const job = doAuth(String(password), 1, 1);
        if (now !== lastAuthStart) stats.waves++;
        lastAuthStart = now;
        return asyncCall(job.dur, job.finish);
      },
      heartbleed: (host, o) => {
        const job = doBleed(host, o, 1);
        return asyncCall(job.dur, job.finish);
      },
      getServerDetails: () => E.serverDetails(s),
    },
  };
  const guard = (o) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "function" && k !== "asleep" && k !== "sleep" ? (...a) => (check(), v(...a)) : v]));
  const ns = { ...guard(ns0), dnet: guard(ns0.dnet) };
  const solver = SOLVER_MAP[modelId];
  const t0 = now;
  let result;
  let error = null;
  try {
    result = await solver(ns, s.hostname, E.serverDetails(s));
  } catch (e) {
    error = e;
  }
  if (killed) error = killed;
  advance(now + 60_000); // let stragglers finish (their auths still count)
  stats.time = 0;
  return {
    ok: !killed && result === s.password && stats.solvedBy === s.password,
    result,
    password: s.password,
    difficulty,
    error,
    ...stats,
    time: (now - 60_000 - t0) / baseMs,
  };
}
