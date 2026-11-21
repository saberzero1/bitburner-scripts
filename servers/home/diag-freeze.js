/**
 * Diagnose game freezes. Run it in the background (`run diag-freeze.js`) and leave it until a freeze happens.
 * Every 250ms it measures how late its own timer fires (the game's main thread being blocked) and counts newly started
 * processes (from the growth in process IDs, plus the scripts it sees). When a stall over 1 second happens, the
 * previous ~20 seconds are appended to /Temp/freeze-diag.txt. A rolling summary is kept in /Temp/freeze-summary.txt.
 * @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const stallFile = "/Temp/freeze-diag.txt";
    const summaryFile = "/Temp/freeze-summary.txt";
    const intervalMs = 250;
    ns.write(stallFile, "", "w");

    const scanAll = () => {
        const seen = new Set(["home"]);
        const queue = ["home"];
        while (queue.length) for (const next of ns.scan(queue.pop())) if (!seen.has(next)) seen.add(next) && queue.push(next);
        return [...seen];
    };
    let hosts = scanAll();
    let lastHostScan = Date.now();
    let knownPids = new Set();
    let maxPid = 0;
    const samples = [];
    let last = performance.now();
    let stalls = 0;

    while (true) {
        await ns.sleep(intervalMs);
        const now = performance.now();
        const lagMs = Math.round(now - last - intervalMs);
        last = now;
        if (Date.now() - lastHostScan > 60_000) {
            hosts = scanAll();
            lastHostScan = Date.now();
        }
        const startedByScript = {};
        const pidsNow = new Set();
        let processes = 0;
        let highestPid = maxPid;
        for (const host of hosts) {
            let procs = [];
            try {
                procs = ns.ps(host);
            } catch {
                continue;
            }
            processes += procs.length;
            for (const proc of procs) {
                pidsNow.add(proc.pid);
                if (proc.pid > highestPid) highestPid = proc.pid;
                if (!knownPids.has(proc.pid) && proc.pid > maxPid)
                    startedByScript[proc.filename] = (startedByScript[proc.filename] ?? 0) + 1;
            }
        }
        // Process IDs are sequential, so their growth counts every process started, even ones too short-lived to see
        const started = maxPid ? highestPid - maxPid : 0;
        maxPid = highestPid;
        knownPids = pidsNow;
        samples.push({ t: new Date().toISOString(), lagMs, started, processes, startedByScript });
        if (samples.length > 80) samples.shift();

        if (lagMs > 1000) {
            stalls++;
            ns.write(stallFile, JSON.stringify({ stallMs: lagMs, at: new Date().toISOString(), last20s: samples }) + "\n", "a");
        }
        // Rolling summary: process starts per script over the kept window
        const totals = {};
        let totalStarted = 0;
        for (const sample of samples) {
            totalStarted += sample.started;
            for (const [script, n] of Object.entries(sample.startedByScript)) totals[script] = (totals[script] ?? 0) + n;
        }
        const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 15);
        ns.write(
            summaryFile,
            JSON.stringify({ updated: new Date().toISOString(), windowSec: (samples.length * intervalMs) / 1000, stalls, totalStarted, processesNow: processes, seenStartingByScript: top }, null, 1),
            "w",
        );
    }
}
