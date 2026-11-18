// Must equal PROBE_VERSION in darknet.js: a probe started with another version exits at once (bumping only one side
// left the darknet without probes for over an hour, 2026-11-16)
const PROBE_VERSION = 56;

// Port helpers: use ns.port (newer dev builds) and fall back to the older top-level functions.
const portWrite = (ns, port, data) =>
    ns.port ? ns.port.write(port, data) : ns.writePort(port, data);
const portPeek = (ns, port) => (ns.port ? ns.port.peek(port) : ns.peek(port));

export async function main(ns) {
    // NOTE: ns.getScriptName() via runDnetCommand returns the TEMP script's name,
    // not the probe's name. Use the known script path directly.
    const SCRIPT_NAME = "Remote/darknet-probe.js";
    const targetVersion = Number(ns.args?.[0] ?? PROBE_VERSION);
    if (targetVersion !== PROBE_VERSION) return;

    const HOST = ns.getHostname();
    const LOOP_INTERVAL = 5000;
    const PASSWORD_FILE = "/data/darknet-passwords.txt";
    const OPTIONS_FILE = "/data/darknet-options.txt";
    const COMPLETED_FILE = "/data/darknet-completed.txt";

    const passwords = loadPasswords(ns, PASSWORD_FILE);
    const failedServers = new Map(); // hostname -> { attempts: N, nextRetry: timestamp }
    const completedServers = loadCompletedServers(ns, COMPLETED_FILE);

    while (true) {
        try {
            // Open cache files first: a solved labyrinth's reward is one (autopilot holds installs until it is pending).
            // They were opened only after the whole neighbour loop, and RAM freeing left too little RAM for it, so a
            // freshly cracked server could sit on its cache for a long time (2026-11-17).
            await handleCacheFiles(ns, HOST);
            // Then free blocked RAM — maximizes available RAM for all subsequent operations
            await freeBlockedRam(ns);

            const nearbyServers = (await runScan(ns)) || [];
            abandonUnreachableLabSolvers(ns, nearbyServers);
            for (const hostname of nearbyServers) {
                // Skip servers in cooldown from repeated failures
                const failInfo = failedServers.get(hostname);
                if (failInfo && Date.now() < failInfo.nextRetry) {
                    continue;
                }

                // Skip servers we've already fully handled (auth + probe deployed)
                // Re-check periodically in case probe died or server restarted
                const completed = completedServers.get(hostname);
                if (
                    completed &&
                    completed.probeDeployed &&
                    Date.now() < completed.recheckAt
                ) {
                    continue;
                }

                let result = { status: "failed", recheckAtMs: undefined };
                try {
                    result = await processServer(
                        ns,
                        hostname,
                        passwords,
                        PASSWORD_FILE,
                        SCRIPT_NAME,
                    );
                } catch (err) {
                    logError(ns, `Probe error processing ${hostname}`, err);
                }
                if (result.status === "completed") {
                    failedServers.delete(hostname);
                    // Mark as completed — re-check every 60s to verify probe is still alive
                    completedServers.set(hostname, {
                        probeDeployed: true,
                        recheckAt:
                            Date.now() +
                            (result.recheckAtMs === undefined
                                ? 60000
                                : result.recheckAtMs),
                    });
                    saveCompletedServers(ns, COMPLETED_FILE, completedServers);
                    await ns.sleep(100);
                } else if (result.status === "retry") {
                    failedServers.delete(hostname);
                    completedServers.set(hostname, {
                        probeDeployed: true,
                        recheckAt:
                            Date.now() +
                            (result.recheckAtMs === undefined
                                ? 5000
                                : result.recheckAtMs),
                    });
                    saveCompletedServers(ns, COMPLETED_FILE, completedServers);
                    await ns.sleep(100);
                } else if (!passwords.has(hostname) && hostname !== "darkweb") {
                    // Track repeated failures for non-cracked servers
                    const prev = failedServers.get(hostname) || {
                        attempts: 0,
                        nextRetry: 0,
                    };
                    prev.attempts++;
                    // Exponential backoff: 10s, 30s, 90s, 270s, capped at 300s
                    const delay = Math.min(
                        10000 * Math.pow(3, prev.attempts - 1),
                        300000,
                    );
                    prev.nextRetry = Date.now() + delay;
                    failedServers.set(hostname, prev);
                }

                // A local freeing job that outgrew its threads is relaunched bigger right away (not next loop)
                await freeBlockedRam(ns);
            }

            // Free blocked RAM on neighbours remotely (memoryReallocation needs admin, i.e. a known password):
            // labyrinth neighbours first (they host solvers), then neighbours too blocked to host a probe, then the most
            // blocked RAM. While our own host still has blocked RAM (freeing it compounds), only neighbours that can't
            // fit a probe yet: waiting for our own host to be fully free stalled the frontier (BN12.79: no probe could
            // be deployed past depth 4 for 25 minutes, and Uber wasn't found within the 60-minute install hold).
            try {
                const ownBlocked = runGetBlockedRam(ns, HOST) > 0;
                const labNeighbors = loadProbeOptions(ns, OPTIONS_FILE).labNeighbors;
                const targets = nearbyServers.filter((h) => passwords.has(h))
                    .map((h) => ({ h, lab: labNeighbors.includes(h), blocked: runGetBlockedRam(ns, h),
                        cramped: nsGetServerMaxRam(ns, h) - nsGetServerUsedRam(ns, h) < PROBE_FIT_GB }))
                    .filter((t) => t.blocked > 0 && (!ownBlocked || t.cramped))
                    .sort((a, b) => b.lab - a.lab || b.cramped - a.cramped || b.blocked - a.blocked);
                for (const t of targets) await freeNeighborBlockedRam(ns, t.h);
            } catch {}

            await handleCacheFiles(ns, HOST);
            await runOptionalActions(ns, OPTIONS_FILE, HOST);
            await manageWorker(ns, OPTIONS_FILE, HOST);
            await manageStasis(ns, OPTIONS_FILE, HOST, passwords);
            await requestOwnMigration(ns, OPTIONS_FILE, HOST);
            await serveMigrationRequests(ns, OPTIONS_FILE, HOST);
            await attemptMigrationCharging(ns, OPTIONS_FILE, HOST);
            await checkAndUnleashStormSeed(ns, HOST);
            await deployHackScript(ns, OPTIONS_FILE);

            // Re-deploy probes to stasis-linked servers (reachable at any distance)
            try {
                const stasisList = await runGetStasisList(ns);
                for (const stasisHost of stasisList || []) {
                    if (stasisHost === HOST) continue; // skip self
                    const stasisCompleted = completedServers.get(stasisHost);
                    if (
                        stasisCompleted &&
                        stasisCompleted.probeDeployed &&
                        Date.now() < stasisCompleted.recheckAt
                    )
                        continue;

                    // Try to establish session with known password only
                    const pwd = passwords.get(stasisHost);
                    if (pwd !== undefined) {
                        await dnetCall(ns, commandNames.link, stasisHost, pwd);
                    }
                    // If no password known, still try deploying — stasis makes exec reachable
                    // even without a session (the probe on that server will handle its own auth)

                    // Scan clue files on stasis servers (may reveal deeper passwords)
                    try {
                        await scanClueFiles(
                            ns,
                            stasisHost,
                            passwords,
                            PASSWORD_FILE,
                        );
                    } catch {}

                    const deployed = await deployProbe(
                        ns,
                        stasisHost,
                        pwd,
                        SCRIPT_NAME,
                        true,
                    );
                    if (deployed) {
                        completedServers.set(stasisHost, {
                            probeDeployed: true,
                            recheckAt: Date.now() + 60000,
                        });
                        saveCompletedServers(
                            ns,
                            COMPLETED_FILE,
                            completedServers,
                        );
                        ns.print(
                            `Stasis propagation: deployed probe to ${stasisHost}`,
                        );
                    }
                    await ns.sleep(100);
                }
            } catch (err) {
                logError(ns, "Stasis propagation error", err);
            }
        } catch (err) {
            logError(ns, "Probe loop error", err);
        }

        // Prune ephemeral state to prevent unbounded Map growth
        // failedServers: remove entries whose backoff has expired (they'll be retried naturally)
        const now = Date.now();
        for (const [host, info] of failedServers) {
            if (now >= info.nextRetry) {
                failedServers.delete(host);
            }
        }
        // completedServers: remove entries past their recheck time (they'll be re-evaluated)
        let completedPruned = false;
        for (const [host, info] of completedServers) {
            if (now >= info.recheckAt) {
                completedServers.delete(host);
                completedPruned = true;
            }
        }
        if (completedPruned) {
            saveCompletedServers(ns, COMPLETED_FILE, completedServers);
        }
        await ns.sleep(LOOP_INTERVAL);
    }
}

export function autocomplete(data) {
    void data;
    return ["--tail"];
}

function loadPasswords(ns, filePath) {
    const map = new Map();
    try {
        const data = ns.read(filePath);
        if (data) {
            const parsed = JSON.parse(data);
            for (const [host, pwd] of Object.entries(parsed)) {
                map.set(host, pwd);
            }
        }
    } catch {}
    return map;
}

function savePasswords(ns, filePath, passwords) {
    const data = JSON.stringify(Object.fromEntries(passwords));
    ns.write(filePath, data, "w");
}

/**
 * Report a cracked password to the orchestrator via port 19.
 * This ensures the orchestrator always has fresh credentials for stasis-linked
 * servers, preventing 'zombie stasis' when sessions expire.
 */
function reportPasswordToOrchestrator(ns, hostname, password) {
    try {
        const pwd = password ?? "";
        const pwdData = JSON.stringify({ [hostname]: pwd });
        portWrite(ns, 19, JSON.stringify({ host: hostname, data: pwdData }));
    } catch {}
}

function loadCompletedServers(ns, filePath) {
    const map = new Map();
    try {
        const data = ns.read(filePath);
        if (data) {
            const parsed = JSON.parse(data);
            for (const [host, info] of Object.entries(parsed)) {
                map.set(host, {
                    probeDeployed: info.probeDeployed,
                    recheckAt: info.recheckAt,
                });
            }
        }
    } catch {}
    return map;
}

function saveCompletedServers(ns, filePath, completedServers) {
    const data = JSON.stringify(Object.fromEntries(completedServers));
    ns.write(filePath, data, "w");
}

async function processServer(
    ns,
    hostname,
    passwords,
    passwordFile,
    scriptName,
) {
    const localDetails = await getAuthDetailsLocal(ns, hostname);
    const details = localDetails || (await getAuthDetails(ns, hostname));
    if (!details || !details.isOnline) {
        return { status: "failed", recheckAtMs: undefined };
    }
    const effectiveDetails = details;
    const modelId = effectiveDetails?.modelId ?? "";
    const isLabyrinth = String(modelId).toLowerCase().includes("labyrinth");

    // Report labyrinth neighbors to orchestrator via port 17.
    // The probe runs on HOST — if it sees a labyrinth in its scan results,
    // then HOST is a direct neighbor of that labyrinth server.
    if (isLabyrinth) {
        try {
            const probeHost = ns.getHostname();
            const reportData = JSON.stringify({
                labHost: hostname,
                neighbor: probeHost,
                neighborPwd: passwords.get(probeHost) ?? null,
            });
            portWrite(ns, 17, reportData);
        } catch {}
    }

    if (effectiveDetails.hasSession || hostname === "darkweb") {
        if (
            effectiveDetails.depth === undefined ||
            effectiveDetails.depth === null
        ) {
            try {
                await runDepth(ns, hostname);
            } catch {}
        }
        await scanClueFiles(ns, hostname, passwords, passwordFile);

        let hasRoot = false;
        try {
            hasRoot = ns.hasRootAccess(hostname);
        } catch {}
        if (!hasRoot) {
            const password = await tryAccessServer(
                ns,
                hostname,
                effectiveDetails,
                passwords,
            );
            if (password !== null) {
                passwords.set(hostname, password ?? "");
                savePasswords(ns, passwordFile, passwords);
                reportPasswordToOrchestrator(ns, hostname, password);
                await scanClueFiles(ns, hostname, passwords, passwordFile);
            } else if (isLabyrinth) {
                await deployProbe(
                    ns,
                    hostname,
                    passwords.get(hostname),
                    scriptName,
                );
                return { status: "retry", recheckAtMs: 5000 };
            }
        }

        const deployed = await deployProbe(
            ns,
            hostname,
            passwords.get(hostname),
            scriptName,
        );
        return {
            status: deployed ? "completed" : "failed",
            recheckAtMs: undefined,
        };
    }

    // After a restart, probes have no sessions and their password files can be stale: take the orchestrator's
    // password for servers cracked earlier (by any probe) instead of skipping them.
    const published = getPublishedPassword(ns, hostname);
    if (!passwords.has(hostname) && published !== undefined) passwords.set(hostname, published);
    if (passwords.has(hostname) && published !== undefined && passwords.get(hostname) !== published) {
        await dnetCall(ns, commandNames.link, hostname, passwords.get(hostname) ?? "");
        if (!(await getAuthDetails(ns, hostname))?.hasSession) passwords.set(hostname, published);
    }
    // If we have a saved password, try to establish a session with it.
    // connectToSession works at any distance and is instant.
    if (passwords.has(hostname)) {
        const knownPassword = passwords.get(hostname);
        await dnetCall(ns, commandNames.link, hostname, knownPassword ?? "");

        // Re-check if session was established
        const refreshed = await getAuthDetails(ns, hostname);
        if (refreshed?.hasSession) {
            await scanClueFiles(ns, hostname, passwords, passwordFile);
            const deployed = await deployProbe(
                ns,
                hostname,
                knownPassword,
                scriptName,
            );
            return {
                status: deployed ? "completed" : "failed",
                recheckAtMs: undefined,
            };
        }

        // Session failed — server may have restarted with a new password.
        // Remove the stale password so we re-authenticate below.
        passwords.delete(hostname);
        savePasswords(ns, passwordFile, passwords);
    }

    // Per darknet docs: authenticate can ONLY target nearby CONNECTED servers.
    // If the server isn't connected to us, we can't authenticate — skip it.
    if (!effectiveDetails.isConnectedToCurrentServer) {
        return { status: "failed", recheckAtMs: undefined };
    }

    // Try to authenticate (crack password)
    const password = await tryAccessServer(
        ns,
        hostname,
        effectiveDetails,
        passwords,
    );
    if (password !== null) {
        passwords.set(hostname, password ?? "");
        savePasswords(ns, passwordFile, passwords);
        reportPasswordToOrchestrator(ns, hostname, password);
        await scanClueFiles(ns, hostname, passwords, passwordFile);
        const deployed = await deployProbe(ns, hostname, password, scriptName);
        return {
            status: deployed ? "completed" : "failed",
            recheckAtMs: undefined,
        };
    }

    if (isLabyrinth) {
        return { status: "retry", recheckAtMs: 5000 };
    }

    return { status: "failed", recheckAtMs: undefined };
}

async function tryAccessServer(ns, hostname, details, passwords) {
    if ((details.modelId || "").toLowerCase().includes("labyrinth")) {
        ns.print(`Labyrinth attempt on ${hostname}`);
        const solved = await solveLabyrinth(ns, hostname);
        if (solved) return "";
    }

    if (passwords.has(hostname)) {
        const knownPassword = passwords.get(hostname);
        const result = await runAuth(ns, hostname, knownPassword ?? "");
        if (result.success) return knownPassword ?? "";
    }

    const hintCandidate = await tryHintBasedAuth(ns, hostname, details);
    if (hintCandidate !== null) {
        ns.print(`SUCCESS: Cracked ${hostname}`);
        return hintCandidate;
    }

    // Re-check: another agent may have cracked this while we tried hints. Its password (not "", which only opens
    // servers whose password is empty) is needed for a session; without it, crack it again below.
    if (await isAlreadyCracked(ns, hostname, true)) {
        const published = getPublishedPassword(ns, hostname);
        if (published !== undefined) return published;
    }

    const solver = getSolver(details.modelId);
    if (solver) {
        const solverInfo = { ...details, currentHost: ns.getHostname() };
        const password = await solver(ns, hostname, solverInfo);
        if (password !== null) {
            ns.print(`SUCCESS: Cracked ${hostname}`);
            return password;
        }
    } else {
        const fallback = await tryFormatBruteforce(ns, hostname, details);
        if (fallback !== null) {
            ns.print(`SUCCESS: Cracked ${hostname}`);
            return fallback;
        }
    }

    // Re-check: another agent may have cracked this (the solvers stop early when it has). Use its password once
    // darknet.js publishes it; until then retry later (an empty password would never open a session).
    if (await isAlreadyCracked(ns, hostname, true)) return getPublishedPassword(ns, hostname) ?? null;

    return null;
}

// Maze grid size per labyrinth (labyrinth.ts labData sizes, stitched from 4 odd-sized mazes): the solver aims for
// the far corner, where the exit is (minus a small random offset). Unknown labyrinths: aim far south-east.
const LAB_GRID = {
    th3_l4byr1nth: [21, 13], cru3l_l4byr1nth: [29, 21], m3rc1l3ss_l4byr1nth: [41, 25], ub3r_l4byr1nth: [61, 41],
    et3rn4l_l4byr1nth: [61, 41], end13ss_l4byr1nth: [61, 41], f1n4l_l4byr1nth: [61, 41], b0nus_l4byr1nth: [61, 41],
};

// Exec'd labyrinth solvers that are still running (lab hostname -> {pid, host, resultFile}). A solver keeps its
// maze position per PID, so never start a second one while the first is alive: check its result instead.
const activeLabSolvers = new Map();

/** A solver whose labyrinth has left this host's neighbourhood (the darknet mutates) can't move any more, yet kept
 * running, and its probe never checked on it again (it only does when it processes the labyrinth), so no new attempt
 * started (2026-11-16, Cruel lab): kill it once the labyrinth has been out of our scan for a minute. */
function abandonUnreachableLabSolvers(ns, nearbyServers) {
    for (const [lab, job] of activeLabSolvers) {
        if (nearbyServers.includes(lab)) {
            job.seenAt = Date.now();
            continue;
        }
        if (Date.now() - (job.seenAt ?? 0) < 60_000) continue;
        ns.print(`Labyrinth ${lab} is no longer next to us: stopping its solver (pid ${job.pid})`);
        try {
            ns.kill(job.pid);
        } catch {}
        activeLabSolvers.delete(lab);
    }
}

/** Result of a previously started solver: true/false when finished, null while still running or unknown. */
function checkLabSolver(ns, hostname) {
    const job = activeLabSolvers.get(hostname);
    if (!job) return undefined;
    const data = ns.read(job.resultFile);
    if (data && data !== "<pending>") {
        activeLabSolvers.delete(hostname);
        ns.print(`Labyrinth result for ${hostname}: ${data}`);
        return data === "SUCCESS";
    }
    let running = false;
    try {
        running = ns.ps(job.host).some((p) => p.pid === job.pid);
    } catch {}
    if (!running) {
        activeLabSolvers.delete(hostname);
        return false;
    }
    // Threads are fixed at launch, and a darknet host's blocked RAM is freed later: Final's solver ran with 1 thread
    // on a host that soon had 500 GB free (2026-11-16). Relaunch once that makes moves at least 3x faster (the maze
    // position is lost, but the solver is per-PID anyway).
    if (job.threads) {
        const possible = Math.floor((nsGetServerMaxRam(ns, job.host) - nsGetServerUsedRam(ns, job.host) + 2 * job.threads - 4) / 2);
        const speed = (t) => 1 + 0.2 * (t - 1);
        if (speed(possible) >= 3 * speed(job.threads)) {
            ns.print(`Labyrinth solver for ${hostname}: relaunching with ~${possible} threads (had ${job.threads})`);
            try {
                ns.kill(job.pid);
            } catch {}
            activeLabSolvers.delete(hostname);
            return false;
        }
    }
    return null;
}

async function solveLabyrinth(ns, hostname) {
    const previous = checkLabSolver(ns, hostname);
    if (previous === true) return true;
    if (previous === null) return false; // still working on it; check again next tick
    // The labyrinth solver MUST run as a single persistent PID because
    // DarknetState.labLocations[pid] tracks position per-PID.
    // Using temp scripts (new PID per call) resets position to (1,1) every time.
    // Solution: generate a self-contained temp script that runs the entire DFS
    // maze walk within one process, using labreport for directions and
    // authenticate for movement.
    const host = ns.getHostname();
    const id = commandCounter++ % COMMAND_COUNTER_WRAP;
    const resultFile = `/Temp/lab-result-${id}.txt`;
    // Code must be constant (no hostnames/ids inlined): the game caches every distinct
    // script source forever, so per-call values go through ns.args instead.
    const scriptFile = `/Temp/lab-solver.js`;

    // The exec'd solver declares its own RAM via ramOverride (both in RunOptions
    // and as the first statement in main) so authenticate's 0.4 GB is covered.

    // The self-contained DFS solver script.
    // It calls ns.dnet.labreport() for position + open directions,
    // and ns.dnet.authenticate(hostname, "go <dir>") for movement.
    // Position tracking comes from response messages, not from labreport,
    // because we need to know if a move succeeded.
    // tools/lab-sim (the game's maze generator, 60x40, 200 mazes): reading walls from each move's own response
    // (instead of a labreport, which costs a full step, before every move) and trying directions toward the far
    // corner first: 970 -> 264 steps on average. Result file: SUCCESS or FAIL:<reason>.
    const solverScript = [
        `export async function main(ns) {`,
        `  ns.ramOverride(2);`,
        `  const host = String(ns.args[0]), rf = String(ns.args[1]), aimX = Number(ns.args[2]), aimY = Number(ns.args[3]);`,
        `  const D = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] };`,
        `  const rev = { north: "south", south: "north", west: "east", east: "west" };`,
        `  const parse = (data) => { const r = String(data ?? "").split("\\n"); return r.length >= 3 && r[1].length >= 3 ? { north: r[0][1] === " ", south: r[2][1] === " ", west: r[1][0] === " ", east: r[1][2] === " " } : null; };`,
        `  let rep = null;`,
        `  for (let i = 0; i < 20 && !rep; i++) { try { rep = await ns.dnet.labreport(); } catch {} if (!rep || !rep.success) { rep = null; await ns.sleep(1000); } }`,
        `  if (!rep) { ns.write(rf, "FAIL:no_labreport", "w"); return; }`,
        `  let pos = [rep.coords[0], rep.coords[1]];`,
        `  let open = { north: rep.north, south: rep.south, east: rep.east, west: rep.west };`,
        `  const visited = new Set([pos.join(",")]);`,
        `  let misses = 0; // responses that are neither a move nor a wall: the labyrinth is out of reach (it moved away)`,
        `  const stack = [];`,
        `  const score = (d) => (aimX - pos[0]) * D[d][0] + (aimY - pos[1]) * D[d][1];`,
        `  for (let i = 0; i < 50000; i++) {`,
        `    const order = Object.keys(D).sort((a, b) => score(b) - score(a));`,
        `    let dir = order.find((d) => open[d] && !visited.has((pos[0] + 2 * D[d][0]) + "," + (pos[1] + 2 * D[d][1])));`,
        `    let back = false;`,
        `    if (!dir) { if (stack.length === 0) { ns.write(rf, "FAIL:exhausted", "w"); return; } dir = rev[stack[stack.length - 1]]; back = true; }`,
        `    const r = await ns.dnet.authenticate(host, "go " + dir);`,
        `    if (r && r.success) { ns.write(rf, "SUCCESS", "w"); return; }`,
        `    const msg = (r && r.message) || "";`,
        `    const m = msg.match(/moved to (\\d+),(\\d+)/);`,
        `    if (m || /cannot go that way/i.test(msg)) misses = 0;`,
        `    if (m) {`,
        `      if (back) stack.pop(); else stack.push(dir);`,
        `      pos = [parseInt(m[1], 10), parseInt(m[2], 10)];`,
        `      visited.add(pos.join(","));`,
        `      const seen = parse(r.data);`,
        `      if (seen) open = seen;`,
        `      else { const lr = await ns.dnet.labreport(); open = { north: lr.north, south: lr.south, east: lr.east, west: lr.west }; }`,
        `    } else if (/cannot go that way/i.test(msg)) {`,
        `      if (back) { ns.write(rf, "FAIL:stuck", "w"); return; }`,
        `      open[dir] = false;`,
        `    } else if (/charism|moxie|charming/i.test(msg)) { ns.write(rf, "FAIL:charisma", "w"); return; }`,
        `    else if (++misses > 100) { ns.write(rf, "FAIL:unreachable", "w"); return; }`,
        `    else await ns.sleep(200);`,
        `  }`,
        `  ns.write(rf, "FAIL:max_iterations", "w");`,
        `}`,
    ].join("\n");

    ns.write(scriptFile, solverScript, "w");
    ns.write(resultFile, "<pending>", "w");

    // As many threads as fit: each step takes 1 / (1 + 0.2 * (threads - 1)) as long. The spare-RAM worker is paused
    // for it (manageWorker keeps it off while a solver runs here); one left running slowed the solver greatly.
    for (const p of ((await nsPs(ns, host)) || []).filter((p) => /darknet-worker-/.test(p.filename))) await nsKill(ns, p.pid);
    const freeRam = nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host);
    const threads = Math.max(1, Math.floor((freeRam - 4) / 2));
    const [gridW, gridH] = LAB_GRID[hostname] ?? [1e4, 1e4];
    const pid = ns.exec(
        scriptFile,
        host,
        { threads, ramOverride: 2 },
        hostname,
        resultFile,
        gridW - 2,
        gridH - 2,
    );
    if (!pid) {
        ns.print(
            `WARN: Failed to exec labyrinth solver for ${hostname} on ${host}; running inline solver`,
        );
        return await solveLabyrinthInline(ns, hostname);
    }

    activeLabSolvers.set(hostname, { pid, host, resultFile, threads, seenAt: Date.now() });
    // Poll briefly; long solves continue in the background and are picked up by checkLabSolver() next tick
    for (let i = 0; i < 100; i++) {
        if (!activeLabSolvers.has(hostname)) break;
        const data = ns.read(resultFile);
        if (data && data !== "<pending>") {
            activeLabSolvers.delete(hostname);
            ns.print(`Labyrinth result for ${hostname}: ${data}`);
            if (data === "SUCCESS") return true;
            if (data === "FAIL:charisma") return false; // can't move until our charisma meets the requirement
            // Exec'd solver failed — fall back to inline solver
            ns.print(
                `WARN: Exec'd solver failed (${data}), falling back to inline solver for ${hostname}`,
            );
            return await solveLabyrinthInline(ns, hostname);
        }
        await ns.sleep(100);
    }

    ns.print(`Labyrinth solver for ${hostname} still running (pid ${pid}); will check its result next tick`);
    return false;
}

async function solveLabyrinthInline(ns, hostname) {
    const visited = new Set();
    const stack = [];
    let px = 1;
    let py = 1;

    const parseCoords = (text) => {
        const match = String(text || "").match(/(\d+)\s*,\s*(\d+)/);
        if (!match) return null;
        return [parseInt(match[1], 10), parseInt(match[2], 10)];
    };

    const refreshCoords = async () => {
        try {
            const rpt = await dnetCall(ns, commandNames.labReport);
            if (rpt && rpt.success && rpt.coords) {
                px = rpt.coords[0];
                py = rpt.coords[1];
                return true;
            }
        } catch {}
        return false;
    };

    await refreshCoords();

    const deltas = {
        north: [0, -2],
        south: [0, 2],
        west: [-2, 0],
        east: [2, 0],
    };
    const reverse = {
        north: "south",
        south: "north",
        west: "east",
        east: "west",
    };

    for (let i = 0; i < 5000; i++) {
        const key = `${px},${py}`;
        visited.add(key);

        let dirs = null;
        try {
            const rpt = await dnetCall(ns, commandNames.labReport);
            if (rpt && rpt.success) {
                dirs = [];
                if (rpt.north) dirs.push("north");
                if (rpt.south) dirs.push("south");
                if (rpt.east) dirs.push("east");
                if (rpt.west) dirs.push("west");
                if (rpt.coords) {
                    px = rpt.coords[0];
                    py = rpt.coords[1];
                }
            }
        } catch {}

        if (!dirs) return false;

        const nextDir = dirs.find((dir) => {
            const delta = deltas[dir];
            return !visited.has(`${px + delta[0]},${py + delta[1]}`);
        });

        if (nextDir) {
            stack.push({ px, py, dir: nextDir });
            const beforeX = px;
            const beforeY = py;
            const resp = await runAuth(ns, hostname, `go ${nextDir}`);
            if (resp && resp.success) return true;
            const msg = resp?.message ?? resp?.data ?? "";
            const coords = parseCoords(msg);
            let updated = false;
            if (coords) {
                px = coords[0];
                py = coords[1];
                updated = true;
            }
            if (!updated) updated = await refreshCoords();
            if (!updated || (px === beforeX && py === beforeY)) {
                stack.pop();
            }
            await ns.sleep(10);
            continue;
        }

        if (stack.length === 0) return false;
        const back = stack.pop();
        const backDir = reverse[back.dir];
        const beforeX = px;
        const beforeY = py;
        const backResp = await runAuth(ns, hostname, `go ${backDir}`);
        if (backResp && backResp.success) return true;
        const backMsg = backResp?.message ?? backResp?.data ?? "";
        const backCoords = parseCoords(backMsg);
        let updated = false;
        if (backCoords) {
            px = backCoords[0];
            py = backCoords[1];
            updated = true;
        }
        if (!updated) updated = await refreshCoords();
        if (!updated || (px === beforeX && py === beforeY)) return false;
        await ns.sleep(10);
    }

    return false;
}

function parseRadarDirections(radarText) {
    // labradar returns a 7x7 grid with @ at center (row 3, col 3 in 0-indexed)
    // We only need the immediate neighbors (1 cell away) to check for walls
    const rows = radarText.split("\n");
    if (rows.length < 7) return null;
    const dirs = [];
    // North: row 2, col 3 (one cell above center in the 7x7 grid)
    if (rows[2]?.[3] !== "\u2588") dirs.push("north");
    // South: row 4, col 3
    if (rows[4]?.[3] !== "\u2588") dirs.push("south");
    // West: row 3, col 2
    if (rows[3]?.[2] !== "\u2588") dirs.push("west");
    // East: row 3, col 4
    if (rows[3]?.[4] !== "\u2588") dirs.push("east");
    return dirs;
}

async function deployProbe(
    ns,
    hostname,
    password,
    scriptName,
    isStasis = false,
) {
    const host = ns.getHostname();
    // Don't deploy to self
    if (hostname === host) return true;

    try {
        // Step 1: Check if target is reachable for exec.
        // Per darknet docs: exec requires the target to be either:
        //   (a) adjacent AND connected to our server, OR
        //   (b) backdoored, OR
        //   (c) stasis-linked
        // getAuthDetails tells us isConnectedToCurrentServer (covers a+b+c).
        const details = await getAuthDetails(ns, hostname);
        if (!details || !details.isOnline) {
            return false;
        }
        // If the target isn't connected/reachable from us, we can't exec on it
        // Exception: stasis-linked servers are exec-reachable at any distance
        if (
            !details.isConnectedToCurrentServer &&
            !details.hasSession &&
            !isStasis
        ) {
            return false;
        }

        // Step 2: Establish session on target so we have admin rights for exec
        if (password !== undefined) {
            await dnetCall(ns, commandNames.link, hostname, password ?? "");
        }

        // Step 3: Check for existing probes (kill old versions, skip if current exists)
        const allProcs = await nsPs(ns, hostname);
        const scriptBaseName = scriptName.startsWith("/")
            ? scriptName.substring(1)
            : scriptName;
        const procs = allProcs.filter(
            (proc) =>
                proc.filename === scriptName ||
                proc.filename === scriptBaseName,
        );
        const current = procs.find(
            (proc) => Number(proc.args?.[0]) === PROBE_VERSION,
        );
        const old = procs.filter(
            (proc) => Number(proc.args?.[0]) !== PROBE_VERSION,
        );
        for (const proc of old) {
            try {
                await nsKill(ns, proc.pid);
            } catch {}
        }
        if (current) return true;

        // Step 4: Try to free blocked RAM on target before deploying
        // memoryReallocation(host) can target a directly connected server (1 GB cost)
        // This runs from the probe's own server — no need to exec on the target!
        const targetMaxRam = await nsGetServerMaxRam(ns, hostname);
        const targetUsedRam = await nsGetServerUsedRam(ns, hostname);
        const targetFreeRam = Math.max(0, targetMaxRam - targetUsedRam);

        // Use the probe's actual RAM cost (was hardcoded to 14 GB from an older, heavier probe,
        // which kept probes off every host with less than 14 GB free).
        const PROBE_RAM_COST = getProbeRamCost(ns);

        // If target is tight on RAM, try freeing blocked RAM remotely
        if (targetFreeRam < PROBE_RAM_COST && targetMaxRam >= PROBE_RAM_COST) {
            try {
                const blockedRam = await runGetBlockedRam(ns, hostname);
                if (blockedRam > 0) {
                    // Free it with a threaded job from here; the deploy is retried once there's room
                    spawnRamFreeJob(ns, host, hostname, true);
                }
            } catch {}
        }

        // Re-check free RAM after potential cleanup
        const updatedUsedRam = await nsGetServerUsedRam(ns, hostname);
        const updatedFreeRam = Math.max(0, targetMaxRam - updatedUsedRam);
        if (updatedFreeRam < PROBE_RAM_COST) {
            ns.print(
                `WARN: ${hostname} has only ${updatedFreeRam.toFixed(1)}GB free, need ${PROBE_RAM_COST}GB for probe`,
            );
            return false;
        }

        // Step 5: Copy probe script to target (scp works at any distance with session)
        let scpResult = false;
        try {
            scpResult = await nsScpDirect(
                ns,
                scriptName,
                hostname,
                ns.getHostname(),
            );
        } catch {}
        if (!scpResult && password !== undefined) {
            const fallback = await nsScpWithSession(
                ns,
                scriptName,
                hostname,
                password,
            );
            scpResult = fallback !== null && fallback !== false;
        }
        if (!scpResult) {
            ns.print(`WARN: Failed to scp ${scriptName} to ${hostname}`);
            return false;
        }

        // Step 6: Copy the password file to target so the new probe has known passwords
        const PASSWORD_FILE_PATH = "/data/darknet-passwords.txt";
        try {
            const pwdScp = await nsScpDirect(
                ns,
                PASSWORD_FILE_PATH,
                hostname,
                ns.getHostname(),
            );
            if (!pwdScp && password !== undefined) {
                await nsScpWithSession(
                    ns,
                    PASSWORD_FILE_PATH,
                    hostname,
                    password,
                );
            }
        } catch {}

        // Step 7: Execute probe on target
        // ns.exec requires adjacency+connection, backdoor, or stasis link.
        // Since we checked isConnectedToCurrentServer above, this should succeed.
        const threads = 1;
        const pid = ns.exec(scriptName, hostname, threads, PROBE_VERSION);
        if (pid > 0) {
            ns.print(
                `Deployed agent v${PROBE_VERSION} to ${hostname} (pid: ${pid})`,
            );
            return true;
        } else {
            ns.print(
                `WARN: ns.exec failed for ${hostname} (pid=0, connected=${details.isConnectedToCurrentServer}, session=${details.hasSession})`,
            );
        }
    } catch (err) {
        ns.print(
            `WARN: deployProbe to ${hostname} failed: ${typeof err === "string" ? err : (err?.message ?? "unknown")}`,
        );
    }
    return false;
}

// ===== RAM BLOCK FREEING =====
// Combined approach: neighbors free RAM remotely on blocked servers until the
// script fits locally, then the blocked server takes over. Both run in parallel.
// memoryReallocation costs 1 GB, requires direct connection + admin rights.
// Delay: max(8000 * (500 / (500 + charisma)), 200)ms per call.

// Track active RAM-freeing jobs to avoid duplicate spawns.
// Key: target hostname being freed. Value: { pid, execHost, startedAt }
const activeRamFreeJobs = new Map();
const RAM_FREE_SCRIPT_COST = 3; // ramOverride(3) — memoryReallocation costs 1 GB + 1.6 GB base = 2.6 GB
const RAM_FREE_RECHECK_INTERVAL = 30000; // Don't re-check a target more than every 30s
const ramFreeLastCheck = new Map(); // target hostname -> last check timestamp

/**
 * Build the self-contained looping RAM-free script source.
 * The script calls memoryReallocation in a loop until blockedRam hits 0 or max iterations.
 * @param {string} targetHost - The darknet server to free RAM on.
 *   If the script runs ON targetHost, memoryReallocation() targets self (no arg needed).
 *   If the script runs on a neighbor, pass targetHost as the argument.
 * @param {string} resultFile - File path to write the result to.
 * @param {boolean} isRemote - Whether the script runs on a different host than the target.
 */
function buildRamFreeScript(isRemote) {
    // The script uses ns.dnet.memoryReallocation directly. Args: [targetHost, resultFile].
    // Code is constant per variant so the game's (never-freed) module cache doesn't grow.
    const memCall = isRemote
        ? `ns.dnet.memoryReallocation(target)`
        : `ns.dnet.memoryReallocation()`;
    const blockedCall = `ns.dnet.getBlockedRam(target)`;
    return [
        `export async function main(ns) {`,
        `  ns.ramOverride(${RAM_FREE_SCRIPT_COST});`,
        `  const target = String(ns.args[0]);`,
        `  const rf = String(ns.args[1]);`,
        `  let totalFreed = 0;`,
        `  let startBlocked = 0;`,
        `  try { startBlocked = ${blockedCall}; } catch {}`,
        `  let iterations = 0;`,
        `  const maxIter = 200;`,
        `  const host = String(ns.args[2]), threads = Number(ns.args[3]); // (args, not getHostname/getRunningScript: RAM)`,
        `  let grow = false;`,
        `  for (let i = 0; i < maxIter; i++) {`,
        `    iterations++;`,
        `    let blocked = 0;`,
        `    try { blocked = ${blockedCall}; } catch { break; }`,
        `    if (blocked <= 0) break;`,
        `    try {`,
        `      const r = await (${memCall});`,
        `      if (!r || !r.success) break;`,
        `    } catch { break; }`,
        `    // Freed RAM on our own host makes room for more threads: exit so the probe relaunches us bigger`,
        `    if (ns.getServerMaxRam(host) - ns.getServerUsedRam(host) >= 0.5 * threads * ${RAM_FREE_SCRIPT_COST} + 3) { grow = true; break; }`,
        `    await ns.sleep(50);`,
        `  }`,
        `  let endBlocked = startBlocked;`,
        `  try { endBlocked = ${blockedCall}; } catch {}`,
        `  totalFreed = startBlocked - endBlocked;`,
        `  ns.write(rf, JSON.stringify({ target, totalFreed, startBlocked, endBlocked, iterations, threads, grow }), "w");`,
        `}`,
    ].join("\n");
}

/**
 * Spawn a RAM-freeing job on execHost targeting targetHost.
 * Returns the PID if successful, 0 otherwise.
 */
function spawnRamFreeJob(ns, execHost, targetHost, isRemote) {
    // Clean up any finished jobs for this target first
    cleanupRamFreeJob(ns, targetHost);

    // Already have an active job for this target?
    if (activeRamFreeJobs.has(targetHost)) return 0;

    const id = commandCounter++ % COMMAND_COUNTER_WRAP;
    const resultFile = `/Temp/ram-free-${id}.txt`;
    const scriptFile = `/Temp/ram-free-${isRemote ? "remote" : "local"}.js`;
    const script = buildRamFreeScript(isRemote);

    ns.write(scriptFile, script, "w");
    ns.write(resultFile, "<pending>", "w");

    // Freeing per call is proportional to threads (0.02 x 2 x 0.92^(difficulty+1) x threads x (1 + cha/100) GB), so use
    // what fits; a remote job takes at most half our spare RAM so the next neighbour gets some too
    const free = nsGetServerMaxRam(ns, execHost) - nsGetServerUsedRam(ns, execHost) - HELPER_HEADROOM_GB;
    const threads = Math.max(1, Math.min(1024, Math.floor((isRemote ? free / 2 : free) / RAM_FREE_SCRIPT_COST)));
    const pid = ns.exec(
        scriptFile,
        execHost,
        { threads, ramOverride: RAM_FREE_SCRIPT_COST },
        targetHost,
        resultFile,
        execHost,
        threads,
    );
    if (!pid) return 0;

    activeRamFreeJobs.set(targetHost, {
        pid,
        execHost,
        resultFile,
        startedAt: Date.now(),
        isRemote,
    });
    ns.print(
        `RAM-free: spawned ${isRemote ? "remote" : "local"} job on ${execHost} targeting ${targetHost} (pid: ${pid}, ${threads} threads)`,
    );
    return pid;
}

/**
 * Check if a RAM-free job for targetHost has finished. If so, log results and clean up.
 */
function cleanupRamFreeJob(ns, targetHost) {
    const job = activeRamFreeJobs.get(targetHost);
    if (!job) return;

    const data = ns.read(job.resultFile);
    if (data && data !== "<pending>") {
        // Job completed
        try {
            const result = JSON.parse(data);
            if (result.grow) ramFreeLastCheck.set(targetHost, 0); // relaunch with more threads on the next call
            if (result.totalFreed > 0) {
                ns.print(
                    `RAM-free: ${job.isRemote ? "remote" : "local"} job on ${job.execHost} freed ${result.totalFreed.toFixed(2)} GB on ${targetHost} in ${result.iterations} iterations`,
                );
            }
        } catch {}
        activeRamFreeJobs.delete(targetHost);
        return;
    }

    // Check if the process is still running (timeout after 5 minutes)
    if (Date.now() - job.startedAt > 300000) {
        ns.print(
            `RAM-free: job targeting ${targetHost} timed out, cleaning up`,
        );
        try {
            ns.kill(job.pid);
        } catch {}
        activeRamFreeJobs.delete(targetHost);
    }
}

/**
 * Free blocked RAM on the local server (where this probe is running).
 * Spawns a persistent looping script instead of a single-shot call.
 */
async function freeBlockedRam(ns) {
    const host = ns.getHostname();

    // Clean up any finished job first
    cleanupRamFreeJob(ns, host);

    // Don't re-check too frequently
    const lastCheck = ramFreeLastCheck.get(host) || 0;
    if (Date.now() - lastCheck < RAM_FREE_RECHECK_INTERVAL) return;
    ramFreeLastCheck.set(host, Date.now());

    // Already have an active job?
    if (activeRamFreeJobs.has(host)) return;

    try {
        const blockedRam = await runGetBlockedRam(ns, host);
        if (blockedRam <= 0) return;

        const maxRam = await nsGetServerMaxRam(ns, host);
        const usedRam = await nsGetServerUsedRam(ns, host);
        const freeRam = Math.max(0, maxRam - usedRam);

        if (freeRam < RAM_FREE_SCRIPT_COST + HELPER_HEADROOM_GB) {
            // Too little free RAM for the helper (a mostly blocked server: neighbours rarely got to it). Free it from
            // this process until the threaded helper fits; it then speeds up as more RAM comes free.
            for (let i = 0; i < 20; i++) {
                let r = null;
                try {
                    r = await ns.dnet.memoryReallocation();
                } catch {}
                if (!r?.success) break;
                if (nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host) >= RAM_FREE_SCRIPT_COST + HELPER_HEADROOM_GB) break;
            }
            ramFreeLastCheck.set(host, 0); // start the helper on the next pass
            return;
        }

        spawnRamFreeJob(ns, host, host, false);
    } catch {}
}

/**
 * Free blocked RAM on neighboring servers.
 * Called from the main loop after processing each neighbor.
 * This probe (running on HOST) frees RAM remotely on neighbors that have blocked RAM.
 * Once the neighbor has enough free RAM, the probe on that server (or a newly deployed one)
 * will take over with local freeing.
 */
async function freeNeighborBlockedRam(ns, neighborHost) {
    // Clean up any finished job first
    cleanupRamFreeJob(ns, neighborHost);

    // Don't re-check too frequently
    const lastCheck = ramFreeLastCheck.get(neighborHost) || 0;
    if (Date.now() - lastCheck < RAM_FREE_RECHECK_INTERVAL) return;
    ramFreeLastCheck.set(neighborHost, Date.now());

    // Already have an active job for this target?
    if (activeRamFreeJobs.has(neighborHost)) return;

    try {
        const blockedRam = await runGetBlockedRam(ns, neighborHost);
        if (blockedRam <= 0) return;

        // Check if we have enough free RAM on THIS host to run the helper
        const host = ns.getHostname();
        const maxRam = await nsGetServerMaxRam(ns, host);
        const usedRam = await nsGetServerUsedRam(ns, host);
        const freeRam = Math.max(0, maxRam - usedRam);

        if (freeRam < RAM_FREE_SCRIPT_COST) return;

        // We have enough free RAM on our host — spawn a remote freeing job
        spawnRamFreeJob(ns, host, neighborHost, true);
    } catch {}
}

async function handleCacheFiles(ns, hostname) {
    // openCache temp script costs 3.6GB (1.6 base + 2.0 ns.dnet.openCache)
    const openCacheCost = 3.6;
    const host = ns.getHostname();
    const freeRam =
        (await nsGetServerMaxRam(ns, host)) -
        (await nsGetServerUsedRam(ns, host));
    if (freeRam < openCacheCost) return;
    try {
        const caches = await nsLs(ns, hostname, ".cache");
        for (const cache of caches) {
            try {
                const result = await runOpenCache(ns, cache);
                if (result) ns.print(`Opened ${cache}`);
            } catch {}
        }
    } catch {}
}

// ===== WORKER: the host's spare RAM =====
// Darknet-only work with all spare RAM, as one multi-threaded script: promoteStock while our charisma is below the
// current labyrinth's requirement (4x the charisma exp of phishing; the labyrinth refuses moves below it, and the
// last BN12 labyrinth rewards The Red Pill), otherwise phishingAttack for money. Both scale linearly with threads.
// Servers next to a labyrinth keep their RAM free for the solver. Script sources are constant (module cache).
const WORKER_SCRIPTS = {
    cha: "/Temp/darknet-worker-cha.js",
    money: "/Temp/darknet-worker-money.js",
};
const WORKER_SOURCES = {
    cha: `export async function main(ns){const d=ns.dnet;while(true){try{await d.${["promote", "Stock"].join("")}(ns.args[0]);}catch{await ns.sleep(5000);}}}`,
    money: `export async function main(ns){const d=ns.dnet;while(true){try{await d.${["phishing", "Attack"].join("")}();}catch{await ns.sleep(5000);}}}`,
};
const WORKER_THREAD_RAM = 3.6; // 1.6 base + 2.0 for the dnet call
const WORKER_RESERVE_GB = 8;
const WORKER_RESERVE_FRACTION = 0.25; // also left free: threaded cracking and RAM freeing run in it (anchoring pauses the worker: setStasisLink needs 13.6 GB)

async function manageWorker(ns, optionsFile, host) {
    if (host === "home") return; // phishingAttack and promoteStock only work on darknet servers
    const options = loadProbeOptions(ns, optionsFile);
    const mode = options.workerMode === "cha" && options.workerStock ? "cha" : options.workerMode === "money" ? "money" : "off";
    const procs = (await nsPs(ns, host)) || [];
    if (procs.some((p) => /dnet-migrate/.test(p.filename))) return; // migration charging has the RAM for now
    const workers = procs.filter((p) => /darknet-worker-/.test(p.filename));
    const wantedScript = mode === "off" ? null : WORKER_SCRIPTS[mode];
    const wantedArgs = mode === "cha" ? [options.workerStock] : [];
    // Lab neighbours, and any host running a labyrinth solver, keep their RAM for it (its speed grows with threads)
    const keepFree = options.labNeighbors.includes(host) || procs.some((p) => /lab-solver/.test(p.filename));
    const workerRam = workers.reduce((total, p) => total + p.threads * WORKER_THREAD_RAM, 0);
    const maxRam = nsGetServerMaxRam(ns, host);
    const spare = maxRam - nsGetServerUsedRam(ns, host) + workerRam - Math.max(WORKER_RESERVE_GB, WORKER_RESERVE_FRACTION * maxRam);
    const threads = keepFree || !wantedScript ? 0 : Math.max(0, Math.floor(spare / WORKER_THREAD_RAM));
    const current = workers.find((p) => normalizeScriptName(p.filename) === normalizeScriptName(wantedScript ?? "") &&
        JSON.stringify(p.args) === JSON.stringify(wantedArgs));
    const currentThreads = current?.threads ?? 0;
    // Leave a running worker alone unless the mode changed or its thread count is off by more than 25%
    if (current && workers.length === 1 && Math.abs(threads - currentThreads) <= Math.max(1, 0.25 * currentThreads)) return;
    for (const p of workers) await nsKill(ns, p.pid);
    if (threads < 1) return;
    ns.write(wantedScript, WORKER_SOURCES[mode], "w");
    const pid = ns.exec(wantedScript, host, threads, ...wantedArgs);
    if (pid) ns.print(`Worker on ${host}: ${mode} x${threads}`);
}

function normalizeScriptName(name) {
    return String(name).replace(/^\//, "");
}

async function runOptionalActions(ns, optionsFile, hostname) {
    const options = loadProbeOptions(ns, optionsFile);
    // phishingAttack and promoteStock temp scripts each cost 3.6GB (1.6 base + 2.0 dnet API)
    const expensiveOpCost = 3.6;
    const host = ns.getHostname();
    const freeRam =
        (await nsGetServerMaxRam(ns, host)) -
        (await nsGetServerUsedRam(ns, host));
    if (options.enablePhishing && options.workerMode === "off" && freeRam >= expensiveOpCost) {
        await runPhishing(ns, hostname);
    } else if (options.enablePhishing && options.workerMode === "off") {
        ns.print(
            `WARN: Phishing skipped on ${hostname} — insufficient RAM (${freeRam.toFixed(1)}GB free, need ${expensiveOpCost}GB)`,
        );
    }
    if (
        options.enableStockManipulation &&
        options.targetStock &&
        freeRam >= expensiveOpCost
    ) {
        await runStockBoost(ns, options.targetStock);
    } else if (options.enableStockManipulation && options.targetStock) {
        ns.print(
            `WARN: Stock manipulation skipped on ${hostname} — insufficient RAM (${freeRam.toFixed(1)}GB free, need ${expensiveOpCost}GB)`,
        );
    }
}

const PROBE_OPTIONS_PORT = 23; // published by darknet.js (files on home can't be read from darknet servers)
const PROBE_PASSWORDS_PORT = 24; // every password darknet.js knows, published the same way

let _publishedRaw = null, _publishedPasswords = {};
/** The orchestrator's password for `hostname`, or undefined. */
function getPublishedPassword(ns, hostname) {
    try {
        const raw = portPeek(ns, PROBE_PASSWORDS_PORT);
        if (raw === "NULL PORT DATA") return undefined;
        if (raw !== _publishedRaw) {
            _publishedPasswords = JSON.parse(String(raw)) ?? {};
            _publishedRaw = raw;
        }
        return Object.hasOwn(_publishedPasswords, hostname) ? _publishedPasswords[hostname] : undefined;
    } catch {
        return undefined;
    }
}

function loadProbeOptions(ns, filePath) {
    const defaults = {
        enablePhishing: true,
        enableStockManipulation: false,
        enableStasis: true,
        enableMigration: true,
        targetStock: "",
        hackTarget: "",
        workerMode: "off",
        workerStock: "",
        labNeighbors: [],
        frontierGap: 0,
        migrationRequests: [],
    };
    try {
        const published = portPeek(ns, PROBE_OPTIONS_PORT);
        const data = published !== "NULL PORT DATA" ? String(published) : ns.read(filePath);
        if (!data) return defaults;
        const parsed = JSON.parse(data);
        return {
            enablePhishing: Boolean(parsed.enablePhishing),
            enableStockManipulation: Boolean(parsed.enableStockManipulation),
            enableStasis:
                parsed.enableStasis !== undefined
                    ? Boolean(parsed.enableStasis)
                    : true,
            enableMigration: Boolean(parsed.enableMigration),
            targetStock:
                typeof parsed.targetStock === "string"
                    ? parsed.targetStock
                    : "",
            hackTarget:
                typeof parsed.hackTarget === "string" ? parsed.hackTarget : "",
            workerMode: ["cha", "money"].includes(parsed.workerMode) ? parsed.workerMode : "off",
            workerStock: typeof parsed.workerStock === "string" ? parsed.workerStock : "",
            labNeighbors: Array.isArray(parsed.labNeighbors) ? parsed.labNeighbors : [],
            frontierGap: Number(parsed.frontierGap) || 0,
            migrationRequests: Array.isArray(parsed.migrationRequests) ? parsed.migrationRequests : [],
        };
    } catch {
        return defaults;
    }
}

async function runPhishing(ns, hostname) {
    try {
        const result = await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.phish),
        );
        if (result && (result.money > 0 || result.cache)) {
            const gained = result.money > 0 ? result.money : result.cache;
            ns.print(`Phishing on ${hostname}: ${gained}`);
        }
    } catch {}
}

async function runStockBoost(ns, targetStock) {
    try {
        await runPromoteStock(ns, targetStock);
    } catch {}
}

// ===== WEBSTORM / STORM SEED =====
// STORM_SEED.exe appears on servers after fully clearing blocked RAM (15% chance, >30 min since last storm).
// unleashStormSeed: deletes 60% of movable servers, moves 60% of remaining, then adds new servers in waves.
// Very disruptive but resets the network — useful for clearing stale/difficult servers.
// The temp script costs 1.7 GB (1.6 base + 0.1 API).

async function checkAndUnleashStormSeed(ns, hostname) {
    const STORM_SEED_FILE = "STORM_SEED.exe";
    const STORM_SCRIPT_COST = 1.7;
    try {
        const hasStorm = await nsFileExists(ns, STORM_SEED_FILE, hostname);
        if (!hasStorm) return;

        const host = ns.getHostname();
        const freeRam =
            (await nsGetServerMaxRam(ns, host)) -
            (await nsGetServerUsedRam(ns, host));
        if (freeRam < STORM_SCRIPT_COST) {
            ns.print(
                `Found ${STORM_SEED_FILE} on ${hostname} but not enough free RAM to unleash (need ${STORM_SCRIPT_COST} GB, have ${freeRam.toFixed(2)} GB free)`,
            );
            return;
        }

        ns.print(
            `Found ${STORM_SEED_FILE} on ${hostname} — unleashing webstorm!`,
        );
        const result = await runUnleashStormSeed(ns);
        if (result && result.success) {
            ns.print(
                `Webstorm unleashed successfully! Network will restructure over ~30 seconds.`,
            );
        } else {
            ns.print(
                `Webstorm unleash failed: ${result?.message || "unknown error"}`,
            );
        }
    } catch {}
}
// ===== STASIS LINK MANAGEMENT =====
// Probes manage stasis links locally since the orchestrator on home
// can only exec on darkweb/stasis-linked servers. Probes ARE on adjacent servers.

// ===== ARBITRARY SCRIPT EXECUTION (HACK/GROW/WEAKEN) =====
// When freed RAM is available beyond what the probe needs, deploy a simple grow loop
// script to utilize the spare capacity for hacking infrastructure.
// The script targets a server specified by the orchestrator via options.hackTarget.

const HACK_SCRIPT_NAME = "/Temp/dnet-grow-loop.js";
const HACK_SCRIPT_RAM = 1.75; // ns.grow cost per thread

async function deployHackScript(ns, optionsFile) {
    const options = loadProbeOptions(ns, optionsFile);
    const target = options.hackTarget;
    if (!target) return; // No target configured

    const host = ns.getHostname();
    const maxRam = await nsGetServerMaxRam(ns, host);
    const usedRam = await nsGetServerUsedRam(ns, host);
    const freeRam = Math.max(0, maxRam - usedRam);

    // Need at least 1 thread worth of grow RAM
    if (freeRam < HACK_SCRIPT_RAM) return;

    // Check if our grow script is already running on this host
    try {
        const procs = ns.ps(host);
        if (procs && procs.some((p) => p.filename === HACK_SCRIPT_NAME)) return;
    } catch {
        return;
    }

    const threads = Math.floor(freeRam / HACK_SCRIPT_RAM);
    if (threads < 1) return;

    // Write a simple grow loop script directly (ns.write already in probe's RAM budget)
    const scriptContent = [
        `/** @param {NS} ns */`,
        `export async function main(ns) {`,
        `  const target = ns.args[0];`,
        `  while (true) {`,
        `    await ns.grow(target);`,
        `  }`,
        `}`,
    ].join("\n");

    try {
        ns.write(HACK_SCRIPT_NAME, scriptContent, "w");
        // Exec with ramOverride so dynamic RAM only accounts for ns.grow (1.75 GB)
        const pid = ns.exec(
            HACK_SCRIPT_NAME,
            host,
            { threads, ramOverride: HACK_SCRIPT_RAM },
            target,
        );
        if (pid > 0) {
            ns.print(
                `Deployed grow loop on ${host}: ${threads} threads targeting ${target}`,
            );
        }
    } catch {}
}

const AIR_GAP_DEPTH = 8;
let lastStasisCheck = 0;

// Anchors (stasis links) are decided centrally by darknet.js, which publishes the servers it wants linked on
// ANCHOR_COMMAND_PORT. setStasisLink only works on the server it runs on, so a probe links its own server when
// asked. (Probes used to score and request swaps themselves, which fought with the orchestrator's choices.)
const ANCHOR_COMMAND_PORT = 22;
const ANCHOR_ATTEMPT_INTERVAL_MS = 20000; // a link takes ~30s; don't stack attempts

async function manageStasis(ns, optionsFile, hostname, passwords) {
    const options = loadProbeOptions(ns, optionsFile);
    if (!options.enableStasis) return;
    let command = null;
    try {
        const raw = portPeek(ns, ANCHOR_COMMAND_PORT);
        if (raw !== "NULL PORT DATA") command = JSON.parse(String(raw));
    } catch {}
    if (!Array.isArray(command?.link) || !command.link.includes(hostname)) return;
    if (Date.now() - lastStasisCheck < ANCHOR_ATTEMPT_INTERVAL_MS) return;
    lastStasisCheck = Date.now();
    try {
        const linked = new Set((await runGetStasisList(ns)) || []);
        if (linked.has(hostname)) return;
        const limit = await runGetStasisLimit(ns);
        if (linked.size >= limit) return; // the orchestrator frees a slot first; wait for it
        ns.print(`Stasis: orchestrator asked to anchor ${hostname}`);
        await execStasisBootstrap(ns, hostname, true);
        // Report the password so the orchestrator always has credentials for anchored servers
        const pwd = passwords.get(hostname);
        if (pwd !== undefined) reportPasswordToOrchestrator(ns, hostname, pwd);
    } catch (err) {
        logError(ns, `Stasis management error`, err);
    }
}

/**
 * Bootstrap script approach for setStasisLink:
 * Since setStasisLink costs 12 GB (temp script ~13.6 GB total) and the probe
 * uses 3 GB, on a 16 GB server there isn't enough RAM for both.
 * Solution: write a bootstrap script that:
 *   1. Frees blocked RAM
 *   2. Sets stasis link
 * The probe stays alive — the bootstrap runs in whatever free RAM is available.
 * If there isn't enough free RAM, the bootstrap kills the probe first,
 * sets stasis, then re-launches the probe.
 */
/** RAM per thread of this probe script (measured once; falls back to a safe estimate). */
let _probeRamCost = 0;
function getProbeRamCost(ns) {
    if (!_probeRamCost) {
        try {
            _probeRamCost = ns.getScriptRam(ns.getScriptName(), ns.getHostname());
        } catch {}
        if (!_probeRamCost) _probeRamCost = 4.5;
    }
    return _probeRamCost;
}

async function execStasisBootstrap(ns, hostname, enable) {
    const host = ns.getHostname();
    const STASIS_SCRIPT_RAM = 13.6; // 1.6 base + 12.0 setStasisLink
    const PROBE_RAM_COST = getProbeRamCost(ns);

    // Pause the spare-RAM worker if it leaves too little room (manageWorker restarts it next loop)
    if (nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host) < STASIS_SCRIPT_RAM) {
        for (const p of ((await nsPs(ns, host)) || []).filter((p) => /darknet-worker-/.test(p.filename)))
            await nsKill(ns, p.pid);
        await ns.sleep(100);
    }
    // Check if we have enough free RAM alongside the probe
    const maxRam = await nsGetServerMaxRam(ns, host);
    const usedRam = await nsGetServerUsedRam(ns, host);
    const freeRam = Math.max(0, maxRam - usedRam);

    const stasisArg = enable ? "true" : "false";
    const scriptName = `/Temp/dnet-stasis-${hostname.replace(/[^a-zA-Z0-9]/g, "_")}.js`;

    if (freeRam >= STASIS_SCRIPT_RAM) {
        // Enough RAM — run stasis temp script directly alongside probe
        const script = `export async function main(ns){try{await ns.dnet.setStasisLink(${stasisArg});}catch(e){ns.print('ERROR: '+e);}};`;
        ns.write(scriptName, script, "w");
        const pid = ns.exec(scriptName, host, 1);
        if (pid > 0) {
            // Wait for completion
            for (let w = 0; w < 60; w++) {
                await ns.sleep(50);
                const running = await nsPs(ns, host);
                if (!running.some((p) => p.pid === pid)) break;
            }
            ns.print(`Stasis ${enable ? "set" : "removed"} on ${hostname}`);
        }
    } else {
        // Not enough RAM next to the probe (a 16 GB server: ~9 GB free beside the probe), so labyrinth neighbours could
        // never be anchored (BN12.83's Normal labyrinth failed five attempts as the solver's host drifted away). Hand over:
        // a small helper kills this probe (and spare-RAM workers), runs a bootstrap that links and restarts the probe, or
        // restarts the probe at once if the bootstrap still doesn't fit (other scripts, e.g. a lab solver, are kept).
        const BOOT_RAM = STASIS_SCRIPT_RAM + 1.3; // + exec, to restart the probe
        const procs = (await nsPs(ns, host)) || [];
        const kept = procs.filter((p) => p.pid !== ns.pid && !/darknet-worker-/.test(p.filename));
        let keptRam = 0;
        for (const p of kept) keptRam += (ns.getScriptRam(p.filename, host) || 0) * p.threads;
        if (maxRam - keptRam - (await runGetBlockedRam(ns, host)) < BOOT_RAM) {
            ns.print(`WARN: ${hostname} too small for stasis (${maxRam} GB, ${keptRam.toFixed(1)} GB kept; the bootstrap needs ${BOOT_RAM} GB)`);
            return;
        }
        const boot = "/Temp/dnet-stasis-boot.js";
        const helper = "/Temp/dnet-stasis-handoff.js";
        ns.write(boot, `export async function main(ns){try{await ns.dnet.setStasisLink(ns.args[0]==="true");}catch(e){ns.print("ERROR: "+e);}` +
            `ns.exec("Remote/darknet-probe.js",ns.getHostname(),1,Number(ns.args[1]));}`, "w");
        ns.write(helper, [
            `export async function main(ns){const [probe, boot, arg, ver] = ns.args; const h = ns.getHostname();`,
            `ns.kill(Number(probe)); for (const p of ns.ps(h)) if (/darknet-worker-/.test(p.filename)) ns.kill(p.pid);`,
            `if (ns.getServerMaxRam(h) - ns.getServerUsedRam(h) + ns.getScriptRam(ns.getScriptName()) >= ${BOOT_RAM})`,
            ` ns.spawn(String(boot), {threads: 1, spawnDelay: 100}, arg, ver);`,
            `else ns.spawn("Remote/darknet-probe.js", {threads: 1, spawnDelay: 100}, ver);}`,
        ].join(""), "w");
        const pid = ns.exec(helper, host, 1, ns.pid, boot, stasisArg, PROBE_VERSION);
        if (pid > 0) {
            ns.print(`Stasis ${enable ? "set" : "removed"} on ${hostname}: handing over to a bootstrap (the probe restarts afterwards)`);
            await ns.sleep(60_000); // the helper kills us
        } else ns.print(`WARN: could not start the stasis handoff on ${hostname}`);
    }
}


async function runGetStasisLimit(ns) {
    try {
        const result = await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.stasisLimit),
        );
        return typeof result === "number" ? result : 0;
    } catch {}
    return 0;
}

async function runGetStasisList(ns) {
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.stasisList),
        );
    } catch {}
    return [];
}

function runGetBlockedRam(ns, hostname) {
    // Direct call: 0 GB RAM cost — avoids temp script exec that fails on RAM-starved hosts
    try {
        return ns.dnet.getBlockedRam(hostname);
    } catch {}
    return 0;
}

async function runMemoryReallocation(ns, hostname) {
    try {
        if (hostname) {
            return await runDnetCommand(
                ns,
                buildDnetCommand(commandNames.mem, commandArgs.singleArg),
                [hostname],
            );
        } else {
            return await runDnetCommand(ns, buildDnetCommand(commandNames.mem));
        }
    } catch {}
    return null;
}

// ===== MIGRATION CHARGING =====
// induceServerMigration(host) costs 4 GB, targets a connected (adjacent) server, NOT self.
// Probes are on adjacent servers, making them ideal for migration charging.
// Migration moves a server across an air gap when sufficiently charged.

const MIGRATION_RECHECK_INTERVAL = 180000; // Re-evaluate migration every 3 minutes
let lastMigrationCheck = 0;

// Air gaps (every AIR_GAP_DEPTH-th row) hold no servers, so the network splits into segments. A fully charged
// induceServerMigration moves a neighbouring server to a random free spot 2 rows up to 4 rows deeper: from the last
// three rows before a gap it can land past it. A cracked server that runs a probe keeps it running when it moves, so
// that probe starts on the next segment straight away. darknet.js publishes the gap to work on (frontierGap).
// Charge per call: (charisma + 500) / (difficulty * 200 + 1000) * 1% per thread, 6 s per call; one thread needed
// ~100 calls (one per 3 minutes here before: ~5 h), so the helper runs with all spare RAM, pausing the worker.
const MIGRATION_HELPER = "/Temp/dnet-migrate.js";
const MIGRATION_MIN_CHANCE = 0.3; // only charge a neighbour with at least this chance of landing past the gap
const MIGRATION_HELPER_SOURCE =
    `export async function main(ns){const t=ns.args[0];for(let i=0;i<500;i++){let r;` +
    `try{r=await ns.dnet.${["induce", "Server", "Migration"].join("")}(t);}catch{return;}` +
    `if(!r||!r.success||r.progress>=1||(i>0&&r.progress===0))return;}}`;
const MIGRATION_THREAD_RAM = 5.6; // 1.6 base + 4.0 induceServerMigration

// ===== Requested migrations (2026-11-17) =====
// Live, probes started no migrations: one 16 GB host can't afford a single 5.6 GB thread next to its probe, and few
// neighbours were close enough to the gap to qualify. A migration's charge is kept per target server (the engine's
// migrationInductionServers), so several neighbours can charge the same server at once. Servers whose own difficulty puts
// a migration past the gap ask for it (MIGRATION_REQUEST_PORT -> darknet.js -> probe options), and every probe next to a
// requested server charges it with all its spare RAM, pausing its worker.
const MIGRATION_REQUEST_PORT = 26;
const MIGRATION_REQUEST_INTERVAL = 60_000;
const MIGRATION_SERVE_HEADROOM_GB = 3; // a 16 GB host with a 7 GB probe can then afford one thread
let lastMigrationRequest = 0;

/** Ask darknet.js to have our neighbours migrate us, if our difficulty makes landing past the gap likely. */
async function requestOwnMigration(ns, optionsFile, host) {
    if (host === "home" || host === "darkweb" || Date.now() - lastMigrationRequest < MIGRATION_REQUEST_INTERVAL) return;
    lastMigrationRequest = Date.now();
    const options = loadProbeOptions(ns, optionsFile);
    const gap = options.frontierGap;
    if (!options.enableMigration || !gap || options.labNeighbors.includes(host)) return;
    try {
        const me = await getAuthDetails(ns, host);
        if (!me || me.isStationary || typeof me.depth !== "number" || me.depth >= gap || typeof me.difficulty !== "number") return;
        const chance = Math.max(0, Math.min(7, me.difficulty + 4 - gap)) / 7;
        if (chance < MIGRATION_MIN_CHANCE) return;
        if (((await runGetStasisList(ns)) || []).includes(host)) return; // anchored servers can't move
        let chargers = 0;
        for (const n of (await runScan(ns)) || []) {
            if (n === host) continue;
            const procs = (await nsPs(ns, n)) || [];
            if (procs.some((p) => /darknet-probe/.test(p.filename))) chargers++;
        }
        if (chargers < 1) return;
        portWrite(ns, MIGRATION_REQUEST_PORT, JSON.stringify({ t: Date.now(), host, chance: +chance.toFixed(2), chargers, depth: me.depth, gap }));
    } catch {}
}

/** Charge a neighbour that asked to be migrated (see requestOwnMigration), with all our spare RAM. */
async function serveMigrationRequests(ns, optionsFile, host) {
    if (host === "home") return;
    const options = loadProbeOptions(ns, optionsFile);
    if (!options.enableMigration || !options.migrationRequests.length) return;
    try {
        const procs = (await nsPs(ns, host)) || [];
        if (procs.some((p) => /dnet-migrate/.test(p.filename))) return; // already charging
        const nearby = new Set((await runScan(ns)) || []);
        const req = options.migrationRequests.find((r) => r?.host && r.host !== host && nearby.has(r.host));
        if (!req) return;
        const workerRam = procs.filter((p) => /darknet-worker-/.test(p.filename)).reduce((t, p) => t + p.threads * WORKER_THREAD_RAM, 0);
        const spare = nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host) + workerRam - MIGRATION_SERVE_HEADROOM_GB;
        if (Math.floor(spare / MIGRATION_THREAD_RAM) < 1) return;
        for (const p of procs.filter((p) => /darknet-worker-/.test(p.filename))) await nsKill(ns, p.pid);
        await ns.sleep(100);
        const threads = Math.floor((nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host) - MIGRATION_SERVE_HEADROOM_GB) / MIGRATION_THREAD_RAM);
        if (threads < 1) return;
        ns.write(MIGRATION_HELPER, MIGRATION_HELPER_SOURCE, "w");
        const pid = ns.exec(MIGRATION_HELPER, host, threads, req.host);
        if (pid) {
            portWrite(ns, 25, JSON.stringify({ t: Date.now(), type: "migrate", requested: true, host, target: req.host, threads, chance: req.chance }));
            ns.print(`Charging requested migration of ${req.host} (~${Math.round((req.chance ?? 0) * 100)}% to cross) with ${threads} threads`);
        }
    } catch (err) {
        logError(ns, `Requested migration error`, err);
    }
}

async function attemptMigrationCharging(ns, optionsFile, hostname) {
    const options = loadProbeOptions(ns, optionsFile);
    const gap = options.frontierGap;
    if (!options.enableMigration || !gap) return;
    if (Date.now() - lastMigrationCheck < MIGRATION_RECHECK_INTERVAL) return;
    lastMigrationCheck = Date.now();
    const host = ns.getHostname();
    if (host === "home") return;
    try {
        const procs = (await nsPs(ns, host)) || [];
        if (procs.some((p) => /dnet-migrate/.test(p.filename))) return; // already charging
        const anchored = new Set((await runGetStasisList(ns)) || []); // stasis-linked servers can't move
        // Which neighbour to charge: a migrated server lands at a random open slot in [difficulty-2, difficulty+4] (the
        // game centres it on its difficulty, not its row), so pick the one most likely to land past the gap. tools/dnet-sim
        // (20+ trials): this beat "within 3 rows of the gap" in median and worst case for every anchor policy.
        let best = null;
        // Measurement (2026-11-17): live, probes started no migrations at all; count why candidates are rejected
        const why = { self: 0, labNeighbor: 0, anchored: 0, offline: 0, notConnected: 0, stationary: 0, pastGap: 0, lowChance: 0, noRoot: 0, noProbe: 0 };
        let maxChance = 0;
        for (const target of (await runScan(ns)) || []) {
            if (target === host) { why.self++; continue; }
            if (options.labNeighbors.includes(target)) { why.labNeighbor++; continue; }
            if (anchored.has(target)) { why.anchored++; continue; }
            const details = await getAuthDetails(ns, target);
            if (!details?.isOnline) { why.offline++; continue; }
            if (!details.isConnectedToCurrentServer) { why.notConnected++; continue; }
            if (details.isStationary) { why.stationary++; continue; }
            const depth = details.depth;
            if (typeof depth !== "number" || depth >= gap || typeof details.difficulty !== "number") { why.pastGap++; continue; }
            const chance = Math.max(0, Math.min(7, details.difficulty + 4 - gap)) / 7;
            maxChance = Math.max(maxChance, chance);
            if (chance < MIGRATION_MIN_CHANCE || (best && chance <= best.chance)) { why.lowChance++; continue; }
            // Only servers that carry a probe across (cracked, probe running)
            let hasRoot = false;
            try {
                hasRoot = ns.hasRootAccess(target);
            } catch {}
            if (!hasRoot) { why.noRoot++; continue; }
            const targetProcs = (await nsPs(ns, target)) || [];
            if (!targetProcs.some((p) => /darknet-probe/.test(p.filename))) { why.noProbe++; continue; }
            best = { target, depth, chance };
        }
        // RAM we could use, counting our worker's (it is paused only if a migration actually starts)
        const workerRam = procs.filter((p) => /darknet-worker-/.test(p.filename)).reduce((t, p) => t + p.threads * WORKER_THREAD_RAM, 0);
        const free = nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host) + workerRam - 4;
        const affordable = Math.floor(free / MIGRATION_THREAD_RAM);
        let myDepth = null;
        try {
            myDepth = (await getAuthDetails(ns, host))?.depth ?? null;
        } catch {}
        portWrite(ns, 25, JSON.stringify({ t: Date.now(), type: "migcheck", host, depth: myDepth, gap, maxRam: nsGetServerMaxRam(ns, host),
            free: +free.toFixed(1), affordable, best: best?.target ?? null, maxChance: +maxChance.toFixed(2), why }));
        if (best && affordable >= 1) {
            const { target, depth } = best;
            // Pause our worker for the RAM; manageWorker restarts it afterwards
            for (const p of procs.filter((p) => /darknet-worker-/.test(p.filename))) await nsKill(ns, p.pid);
            await ns.sleep(100);
            const freeNow = nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host) - 4;
            const threads = Math.floor(freeNow / MIGRATION_THREAD_RAM);
            if (threads < 1) return;
            ns.write(MIGRATION_HELPER, MIGRATION_HELPER_SOURCE, "w");
            const pid = ns.exec(MIGRATION_HELPER, host, threads, target);
            if (pid) portWrite(ns, 25, JSON.stringify({ t: Date.now(), type: "migrate", host, target, depth, gap, threads, chance: +best.chance.toFixed(2) })); // metrics
            if (pid) ns.print(`Migrating ${target} (depth ${depth}, gap at ${gap}, ~${Math.round(best.chance * 100)}% to cross) with ${threads} threads`);
        }
    } catch (err) {
        logError(ns, `Migration charging error`, err);
    }
}
// Clue files already read ("host:file"), so each one is copied and parsed once.
const scannedClueFiles = new Set();
// Passwords from clues that don't name their server ("Remember this password: X" is an unnamed neighbour's).
// tryHintBasedAuth tries them as candidates.
const unattributedCluePasswords = new Set();
const MAX_UNATTRIBUTED_CLUES = 20;

async function scanClueFiles(ns, hostname, passwords, passwordFile) {
    try {
        const dataFiles = await nsLs(ns, hostname, ".data.txt");
        if (!dataFiles.length) return;
        const host = ns.getHostname();
        let changed = false;

        for (const file of dataFiles) {
            const key = `${hostname}:${file}`;
            if (scannedClueFiles.has(key)) continue;
            try {
                // ns.read only reads files on this script's own server, so copy a remote clue file here first.
                if (hostname !== host) {
                    const copied = await nsScpDirect(ns, file, host, hostname);
                    if (!copied) continue;
                }
                const content = ns.read(file);
                scannedClueFiles.add(key);
                if (!content) continue;
                for (const clue of parseClueText(content)) {
                    if (clue.hostname) {
                        if (passwords.get(clue.hostname) !== clue.password) {
                            passwords.set(clue.hostname, clue.password);
                            changed = true;
                        }
                    } else {
                        unattributedCluePasswords.add(clue.password);
                        if (unattributedCluePasswords.size > MAX_UNATTRIBUTED_CLUES) {
                            const oldest = unattributedCluePasswords.values().next().value;
                            unattributedCluePasswords.delete(oldest);
                        }
                    }
                }
            } catch {}
        }
        if (changed) savePasswords(ns, passwordFile, passwords);
    } catch {}
}

async function tryHintBasedAuth(ns, hostname, details) {
    const hint = (details.passwordHint || "").trim();
    const candidates = new Set();
    const maxLen =
        Number.isFinite(details.passwordLength) && details.passwordLength > 0
            ? details.passwordLength
            : 32;

    if (hint) {
        if (!/(prove you are human|captcha|type the numbers)/i.test(hint)) {
            candidates.add(hint);
            candidates.add(hint.replace(/\s+/g, ""));
            candidates.add(hint.toLowerCase());
            candidates.add(hint.toUpperCase());
        }
        if (/^\d+$/.test(hint)) candidates.add(Number(hint).toString());
        const hintDigits = hint.match(/\d/g);
        if (hintDigits) {
            const joined = hintDigits.join("");
            candidates.add(joined);
            const length = Number.isFinite(details.passwordLength)
                ? details.passwordLength
                : null;
            if (length && joined.length >= length) {
                for (let i = 0; i <= joined.length - length; i++) {
                    candidates.add(joined.slice(i, i + length));
                }
            }
        }
    }

    try {
        const logs = await runHeartbleed(ns, hostname);
        if (logs?.logs) {
            const parsed = parseDarknetLogs(logs.logs);
            for (const p of parsed.passwords) candidates.add(p);
            for (const h of parsed.hints) {
                candidates.add(h);
                candidates.add(h.replace(/\s+/g, ""));
            }
        }
    } catch {}
    // Unnamed clue passwords belong to some neighbour of the clue's server; try those that fit.
    for (const p of unattributedCluePasswords) {
        if (!(details.passwordLength > 0) || p.length === details.passwordLength)
            candidates.add(p);
    }

    // The server details give the exact password length: skip candidates that can't match (an empty password
    // is tried first, so ZeroLogon takes one attempt instead of several hint variants).
    const exactLength = Number.isFinite(details.passwordLength) ? details.passwordLength : null;
    if (exactLength === 0) {
        const result = await runAuth(ns, hostname, "");
        return result.success ? "" : null;
    }
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate.length > maxLen) continue;
        if (exactLength && candidate.length !== exactLength) continue;
        try {
            const result = await runAuth(ns, hostname, candidate);
            if (result.success) return candidate;
        } catch {}
    }

    return null;
}

function getSolver(modelId) {
    if (!modelId) return null;
    if (modelId === "(The Labyrinth)") return null;
    return SOLVER_MAP[modelId] || null;
}

async function tryFormatBruteforce(ns, hostname, details) {
    resetCrackedCheck(hostname);
    const format = details.passwordFormat;
    const length =
        Number.isFinite(details.passwordLength) && details.passwordLength > 0
            ? details.passwordLength
            : null;
    const charset = getCharsetForFormat(format);
    if (!charset || !length) return null;
    if (format === "numeric") {
        if (length > 4) return null;
        const start = length === 1 ? 0 : Math.pow(10, length - 1);
        const end = Math.pow(10, length) - 1;
        for (let i = start; i <= end; i++) {
            const pin = i.toString();
            const result = await runAuth(ns, hostname, pin);
            if (result.success) return pin;
            if (await isAlreadyCracked(ns, hostname)) return null;
        }
        return null;
    }
    const maxAttempts = Math.pow(charset.length, length);
    if (!Number.isFinite(maxAttempts) || maxAttempts > 200000) return null;
    const hint = details.passwordHint;
    if (
        hint &&
        hint.length === length &&
        [...hint].every((ch) => charset.includes(ch))
    ) {
        const result = await runAuth(ns, hostname, hint);
        if (result.success) return hint;
    }
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = buildCandidate(i, charset, length);
        const result = await runAuth(ns, hostname, candidate);
        if (result.success) return candidate;
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

const defaultSettingsDictionary = ["admin", "password", "0000", "12345"];
const dogNameDictionary = ["fido", "spot", "rover", "max"];
const euCountries = [
    "Austria",
    "Belgium",
    "Bulgaria",
    "Croatia",
    "Republic of Cyprus",
    "Czech Republic",
    "Denmark",
    "Estonia",
    "Finland",
    "France",
    "Germany",
    "Greece",
    "Hungary",
    "Ireland",
    "Italy",
    "Latvia",
    "Lithuania",
    "Luxembourg",
    "Malta",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Sweden",
];
const commonPasswordDictionary = [
    "123456",
    "password",
    "12345678",
    "qwerty",
    "123456789",
    "12345",
    "1234",
    "111111",
    "1234567",
    "dragon",
    "123123",
    "baseball",
    "abc123",
    "football",
    "monkey",
    "letmein",
    "696969",
    "shadow",
    "master",
    "666666",
    "qwertyuiop",
    "123321",
    "mustang",
    "1234567890",
    "michael",
    "654321",
    "superman",
    "1qaz2wsx",
    "7777777",
    "121212",
    "0",
    "qazwsx",
    "123qwe",
    "trustno1",
    "jordan",
    "jennifer",
    "zxcvbnm",
    "asdfgh",
    "hunter",
    "buster",
    "soccer",
    "harley",
    "batman",
    "andrew",
    "tigger",
    "sunshine",
    "iloveyou",
    "2000",
    "charlie",
    "robert",
    "thomas",
    "hockey",
    "ranger",
    "daniel",
    "starwars",
    "112233",
    "george",
    "computer",
    "michelle",
    "jessica",
    "pepper",
    "1111",
    "zxcvbn",
    "555555",
    "11111111",
    "131313",
    "freedom",
    "777777",
    "pass",
    "maggie",
    "159753",
    "aaaaaa",
    "ginger",
    "princess",
    "joshua",
    "cheese",
    "amanda",
    "summer",
    "love",
    "ashley",
    "6969",
    "nicole",
    "chelsea",
    "biteme",
    "matthew",
    "access",
    "yankees",
    "987654321",
    "dallas",
    "austin",
    "thunder",
    "taylor",
    "matrix",
];

const SOLVER_MAP = {
    ZeroLogon: solveZeroLogon,
    "DeskMemo_3.1": solveEchoVuln,
    "FreshInstall_1.0": solveFreshInstall,
    "CloudBlare(tm)": solveCloudBlare,
    Laika4: solveDogNames,
    NIL: solveYesnt,
    Pr0verFl0: solveBufferOverflow,
    "PHP 5.4": solveSortedEchoVuln,
    DeepGreen: solveMastermind,
    BellaCuore: solveRomanNumeral,
    "AccountsManager_4.2": solveGuessNumber,
    OctantVoxel: solveConvertToBase10,
    "Factori-Os": solveDivisibilityTest,
    OpenWebAccessPoint: solvePacketSniffer,
    KingOfTheHill: solveGlobalMaxima,
    "RateMyPix.Auth": solveSpiceLevel,
    "PrimeTime 2": solveLargestPrimeFactor,
    TopPass: solveTopPass,
    "EuroZone Free": solveEuroZone,
    "2G_cellular": solveTimingAttack,
    110100100: solveBinaryEncoded,
    MathML: solveParsedExpression,
    OrdoXenos: solveXorEncrypted,
    "BigMo%od": solveTripleModulo,
};

// ServerGenerator.ts: divisibility passwords are products of factors <= 97 (smallPrimes) and up to two
// primes from the fixed largePrimes list.
const DIVISIBILITY_SMALL_PRIMES = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
];
const DIVISIBILITY_LARGE_PRIMES = [
    1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693,
    2741, 2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877,
    4943, 4951, 4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469,
    6547, 6661, 6719, 6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761,
    8839, 8963, 9103, 9199, 9343, 9467, 9551, 9601, 9739, 9749, 9859,
];
// Pairwise coprime moduli <= 32 (guessing n <= 32 on BigMo%od returns P % n), largest first.
const TRIPLE_MODULO_MODULI = [32, 31, 29, 27, 25, 23, 19, 17, 13, 11, 7];

async function solveZeroLogon(ns, hostname) {
    const result = await runAuth(ns, hostname, "");
    return result.success ? "" : null;
}

async function solveEchoVuln(ns, hostname, serverInfo) {
    const hint = getHint(serverInfo);
    const candidate = extractTrailingToken(hint);
    if (!candidate) return null;
    const result = await runAuth(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveFreshInstall(ns, hostname) {
    return await tryDictionary(ns, hostname, defaultSettingsDictionary);
}

async function solveCloudBlare(ns, hostname, serverInfo) {
    const data = getHintData(serverInfo) || getHint(serverInfo);
    const digits = String(data).match(/\d/g);
    if (!digits) return null;
    const joined = digits.join("");
    const length = Number.isFinite(serverInfo?.passwordLength)
        ? serverInfo.passwordLength
        : null;
    const candidates = [];
    if (length && joined.length >= length) {
        for (let i = 0; i <= joined.length - length; i++) {
            candidates.push(joined.slice(i, i + length));
        }
    } else {
        candidates.push(joined);
    }
    for (const candidate of candidates) {
        const result = await runAuth(ns, hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveDogNames(ns, hostname) {
    return await tryDictionary(ns, hostname, dogNameDictionary);
}

async function solveYesnt(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const length = getPasswordLength(serverInfo, 4);
    const charset =
        getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    const locked = new Array(length).fill(false);
    const result = new Array(length).fill(charset[0]);
    let feedbackMisses = 0;

    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, flags: null };
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const flags = getYesntFeedbackFromLogs(bleed.logs, guess);
            if (flags) return { success: false, flags };
        }
        return null;
    }

    for (const ch of charset) {
        // Set all unlocked positions to the current character
        const guess = result.map((c, i) => (locked[i] ? c : ch)).join("");
        const fb = await authWithFeedback(guess);
        if (fb?.success) return guess;
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (!fb) {
            feedbackMisses++;
            if (feedbackMisses > 4) return null;
            continue;
        }
        const flags = fb.flags;
        if (!flags) continue;
        for (let i = 0; i < length; i++) {
            if (!locked[i] && flags[i]) {
                result[i] = ch;
                locked[i] = true;
            }
        }
        if (locked.every(Boolean)) return result.join("");
    }

    // Try final assembled result even if not all locked
    const finalGuess = result.join("");
    const finalResp = await authWithFeedback(finalGuess);
    return finalResp?.success ? finalGuess : null;
}

async function solveBufferOverflow(ns, hostname, serverInfo) {
    const hint = getHint(serverInfo);
    const match = hint.match(/(\d+)/);
    if (!match) return null;
    const length = Number(match[1]);
    if (!Number.isFinite(length) || length <= 0) return null;
    const candidate = "A".repeat(length * 2);
    const result = await runAuth(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveSortedEchoVuln(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const sortedRaw = (getHintData(serverInfo) || getHint(serverInfo)).replace(
        /\s+/g,
        "",
    );
    const sorted = sortedRaw.match(/\d+/g)?.join("") || "";
    if (!sorted || !/^\d+$/.test(sorted)) return null;
    const length = sorted.length;

    // The game only reports an RMS deviation for passwords of 5+ digits; shorter ones have <= 24 orderings.
    if (length < 5) {
        return await solvePermutationByAuth(ns, hostname, sorted.split(""), 200);
    }

    // Feedback (authentication.ts SortedEchoVuln): rmsd = sqrt(Σ(guess_i - pw_i)² / L), printed with toFixed(3).
    // Σpw_i² is known from the sorted digits. A guess with "1" at position i and "0" everywhere else scores
    // Σpw² - 2·pw_i + 1, so each such guess reveals one digit: pw_i = (Σpw² - L·rmsd² + 1) / 2.
    // (Rounding error of L·rmsd² is at most 9·L·0.001 < 0.5, so Math.round recovers the exact sum.)
    const sumSq = sorted
        .split("")
        .reduce((sum, d) => sum + Number(d) * Number(d), 0);
    const remaining = new Map();
    for (const d of sorted) remaining.set(d, (remaining.get(d) || 0) + 1);
    let prefix = "";
    for (let i = 0; i < length; i++) {
        // Digits still available for this position (no leading zeros in numeric passwords).
        const options = [...remaining.keys()].filter(
            (d) => remaining.get(d) > 0 && !(i === 0 && d === "0"),
        );
        let digit = options.length === 1 ? options[0] : null;
        if (digit === null) {
            const guess = "0".repeat(i) + "1" + "0".repeat(length - i - 1);
            const fb = await authWithLogFeedback(
                ns,
                hostname,
                guess,
                getRmsdFeedbackFromLogs,
            );
            if (fb?.success) return guess;
            if (await isAlreadyCracked(ns, hostname)) return null;
            if (fb) {
                const squaredError = Math.round(fb.value * fb.value * length);
                const value = (sumSq - squaredError + 1) / 2;
                if (Number.isInteger(value) && remaining.get(String(value)) > 0)
                    digit = String(value);
            }
        }
        if (digit === null) break; // no usable feedback: brute-force the rest below
        prefix += digit;
        remaining.set(digit, remaining.get(digit) - 1);
    }
    if (prefix.length === length) {
        const result = await runAuth(ns, hostname, prefix);
        if (result.success) return prefix;
    }
    // Fallback: permute the digits not yet placed behind the solved prefix.
    const rest = [];
    for (const [d, count] of remaining)
        for (let i = 0; i < count; i++) rest.push(d);
    return await solvePermutationByAuth(ns, hostname, rest, 5000, prefix);
}

async function solveMastermind(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const length = getPasswordLength(serverInfo, 4);
    // Default to full alphanumeric if format is unknown — the offline fallback
    // from getServerDetails returns passwordFormat: "numeric" even for
    // alphanumeric passwords. Using the wider charset is always safe (slower
    // but correct), while the narrow charset causes permanent failures.
    const charset =
        getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    // Numeric passwords never start with 0 (getPassword strips leading zeros).
    const noLeadingZero = serverInfo?.passwordFormat === "numeric" && length > 1;
    const stats = { auths: 0 };
    const AUTH_LIMIT = 500; // real authentication attempts, not enumerated permutations

    // Feedback is "exact,misplaced" in the server log (authenticate() only returns data on labyrinths).
    const guessWithFeedback = (guess) =>
        authWithLogFeedback(
            ns,
            hostname,
            guess,
            getMastermindFeedbackFromLogs,
            3,
            stats,
        );

    // Phase 1: count each symbol with a repeated-symbol guess ("aaaa" scores exact = count of 'a').
    // Stop as soon as the counts add up to the length; the last symbol's count can be inferred.
    const counts = new Map();
    let found = 0;
    for (let i = 0; i < charset.length && found < length; i++) {
        const ch = charset[i];
        if (i === charset.length - 1) {
            counts.set(ch, length - found);
            found = length;
            break;
        }
        const guess = ch.repeat(length);
        const fb = await guessWithFeedback(guess);
        if (fb?.success) return guess;
        if (!fb) return null; // no feedback readable — retry on a later pass
        const n = fb.value.exact + fb.value.misplaced;
        if (n > 0) counts.set(ch, n);
        found += n;
        if (stats.auths >= AUTH_LIMIT || (await isAlreadyCracked(ns, hostname)))
            return null;
    }
    if (found !== length) return null;

    // Phase 2: every candidate is a permutation of the known multiset, so "misplaced" is implied by
    // "exact". Guess any permutation consistent with all exact-position counts seen so far.
    const constraints = [];
    const tried = new Set();
    while (stats.auths < AUTH_LIMIT) {
        const candidate = findMastermindCandidate(
            counts,
            length,
            constraints,
            tried,
            noLeadingZero,
        );
        if (!candidate) return null;
        tried.add(candidate);
        const fb = await guessWithFeedback(candidate);
        if (fb?.success) return candidate;
        if (fb) constraints.push({ guess: candidate, exact: fb.value.exact });
        if (await isAlreadyCracked(ns, hostname)) return null;
        await ns.sleep(0);
    }
    return null;
}

async function solveRomanNumeral(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const hintData = getHintData(serverInfo);
    if (hintData.includes(",")) {
        const [minRaw, maxRaw] = hintData.split(",");
        const min = romanToNumber(minRaw.trim());
        const max = romanToNumber(maxRaw.trim());
        if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
        let low = Math.min(min, max);
        let high = Math.max(min, max);
        let feedbackMisses = 0;

        async function authWithFeedback(guess) {
            const resp = await runAuth(ns, hostname, guess);
            if (resp.success) return { success: true, direction: null };
            const bleed = await runHeartbleedMulti(ns, hostname, 5);
            if (bleed?.logs) {
                const direction = getRomanNumeralFeedbackFromLogs(
                    bleed.logs,
                    guess,
                );
                if (direction) return { success: false, direction };
            }
            return null;
        }
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const fb = await authWithFeedback(String(mid));
            if (fb?.success) return String(mid);
            if (await isAlreadyCracked(ns, hostname)) return null;
            if (!fb) {
                feedbackMisses++;
                if (feedbackMisses > 4) return null;
                continue;
            }
            if (fb.direction === "ALTUS") high = mid - 1;
            else if (fb.direction === "PARUM") low = mid + 1;
            else break;
        }
        return null;
    }

    const encoded = extractRoman(
        getHintData(serverInfo) || getHint(serverInfo),
    );
    if (!encoded) return null;
    const candidate = String(romanToNumber(encoded));
    const result = await runAuth(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveGuessNumber(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    // Parse range from hint: "The password is a number between X and Y"
    const hint = getHint(serverInfo);
    const length = getPasswordLength(serverInfo, 4);
    const maxVal = Math.pow(10, length) - 1;
    const rangeMatch = hint.match(/between\s+(\d+)\s+and\s+(\d+)/i);
    let low, high;
    if (rangeMatch) {
        low = Number(rangeMatch[1]);
        high = Math.min(Number(rangeMatch[2]), maxVal);
    } else {
        low = 0;
        high = maxVal;
    }
    let feedbackMisses = 0;

    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, direction: null };
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const fb = getGuessNumberFeedbackFromLogs(bleed.logs, guess);
            if (fb) return { success: false, ...fb };
        }
        return null;
    }
    for (let iter = 0; iter < 64 && low <= high; iter++) {
        const guess = Math.floor((low + high) / 2);
        const fb = await authWithFeedback(String(guess));
        if (fb?.success) return String(guess);
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (!fb) {
            feedbackMisses++;
            if (feedbackMisses > 4) return null;
            continue;
        }
        const direction = fb.direction;
        // On first response, try to extract range from message if we didn't get it from hint
        if (iter === 0 && !rangeMatch) {
            if (Number.isFinite(fb.rangeMin) && Number.isFinite(fb.rangeMax)) {
                low = Number(fb.rangeMin);
                high = Math.min(Number(fb.rangeMax), maxVal);
                if (direction.includes("higher")) {
                    low = Math.max(low, guess + 1);
                } else if (direction.includes("lower")) {
                    high = Math.min(high, guess - 1);
                }
                continue;
            }
        }
        if (direction.includes("higher")) {
            low = guess + 1;
        } else if (direction.includes("lower")) {
            high = guess - 1;
        } else {
            break;
        }
    }
    return null;
}

async function solveConvertToBase10(ns, hostname, serverInfo) {
    const hintData = getHintData(serverInfo);
    const parts = hintData.split(",");
    if (parts.length < 2) return null;
    const base = Number(parts[0]);
    const encoded = parts.slice(1).join(",").trim();
    if (!Number.isFinite(base) || !encoded) return null;
    const value = parseBaseN(encoded, base);
    if (!Number.isFinite(value)) return null;
    const candidate = String(Math.round(value));
    const result = await runAuth(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveDivisibilityTest(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    // ServerGenerator getPasswordMadeUpOfPrimesProduct: a product of factors <= 97, times up to two primes
    // from the fixed largePrimes list. Test "divisible by (factors found so far) × p": that checks one more
    // factor p, handles repeated factors, and is itself a guess — it succeeds when it equals the password.
    // BigInt: passwords can exceed 2^53 (the game only requires them to survive a round trip through a float).
    const length = getPasswordLength(serverInfo, 0);
    const maxValue = length ? 10n ** BigInt(length) - 1n : BigInt(Number.MAX_SAFE_INTEGER) * 1024n;
    const minValue = length > 1 ? 10n ** BigInt(length - 1) : 1n;
    const stats = { auths: 0 };
    let product = 1n;

    // true = divides, false = doesn't, "found" = it was the password, null = no feedback.
    const dividesWithFactor = async (p) => {
        const result = await isDivisibleBy(ns, hostname, product * p, stats);
        if (result === null) return null;
        if (result.success) return "found";
        return result.divisible;
    };

    for (const prime of DIVISIBILITY_SMALL_PRIMES) {
        const p = BigInt(prime);
        while (product * p <= maxValue) {
            const r = await dividesWithFactor(p);
            if (r === null) return null;
            if (r === "found") return String(product * p);
            if (!r) break;
            product *= p;
        }
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    if (product === 1n) {
        const one = await runAuth(ns, hostname, "1");
        if (one.success) return "1";
    }

    // What is left is one or two large primes (the same one may appear twice).
    for (let i = 0; i < DIVISIBILITY_LARGE_PRIMES.length; i++) {
        const q = BigInt(DIVISIBILITY_LARGE_PRIMES[i]);
        if (product * q > maxValue) break;
        // When two more large primes no longer fit, the last one must bring the product to L digits.
        const roomForTwo = product * q * q <= maxValue;
        if (!roomForTwo && product * q < minValue) continue;
        const r = await dividesWithFactor(q);
        if (r === null) return null;
        if (r === "found") return String(product * q);
        if (r) {
            product *= q;
            i--; // the same large prime may appear twice
        }
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

/**
 * OpenWebAccessPoint (packet sniffer) servers put captured traffic in the `data` of a FAILED attempt's server
 * log entry, read back with heartbleed (ns.dnet.packetCapture was removed in #2594).
 * - Easy servers (difficulty <= 16): traffic contains " <hostname>:<password> ".
 * - Hard servers: the bare password is embedded in random noise at a random offset, so the
 *   only length-L substring present in every capture is the password.
 */
async function sniffPacketPassword(ns, hostname, serverInfo, maxCaptures = 12) {
    const expectedLength = serverInfo?.passwordLength || 0;
    const tried = new Set();
    let common = null;
    const tryCandidate = async (candidate) => {
        if (!candidate || tried.has(candidate)) return false;
        if (expectedLength && candidate.length !== expectedLength) return false;
        tried.add(candidate);
        const r = await runAuth(ns, hostname, candidate);
        return !!r?.success;
    };
    for (let i = 0; i < maxCaptures; i++) {
        const probeGuess = "0".repeat(Math.max(1, expectedLength || 1));
        const r = await runAuth(ns, hostname, probeGuess);
        if (r?.success) return probeGuess;
        tried.add(probeGuess);
        // authenticate() only returns feedback data on labyrinth servers; elsewhere it's in the server log,
        // as JSON of the response ({code, message, data, passwordAttempted}). data holds the captured packets.
        const text = await capturedPacketsFromLog(ns, hostname, probeGuess);
        if (!text) continue;
        for (const m of text.matchAll(/(\S+):(\S+)/g)) {
            if (m[1] === hostname && (await tryCandidate(m[2]))) return m[2];
        }
        if (!expectedLength || text.length < expectedLength) continue;
        const subs = new Set();
        for (let j = 0; j + expectedLength <= text.length; j++)
            subs.add(text.slice(j, j + expectedLength));
        common = common ? new Set([...common].filter((s) => subs.has(s))) : subs;
        if (common.size === 0) common = null; // capture didn't contain it; start over
        else if (common.size <= 3 && i > 0) {
            for (const c of common) if (await tryCandidate(c)) return c;
            common = null;
        }
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

/** Find our latest failed attempt in the server log and return its captured-packet data. */
async function capturedPacketsFromLog(ns, hostname, attempted) {
    const bleed = await runHeartbleedMulti(ns, hostname, 8);
    for (const line of bleed?.logs ?? []) {
        try {
            const entry = JSON.parse(String(line));
            if (entry?.passwordAttempted === attempted && typeof entry.data === "string") return entry.data;
        } catch {}
    }
    return "";
}

async function solvePacketSniffer(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const candidates = new Set();
    const hint = getHint(serverInfo);
    if (hint) {
        candidates.add(hint.trim());
        candidates.add(hint.replace(/\s+/g, ""));
    }
    for (const value of defaultSettingsDictionary) candidates.add(value);
    for (const value of commonPasswordDictionary) candidates.add(value);


    const expectedLength = serverInfo?.passwordLength;
    const format = serverInfo?.passwordFormat;

    const sniffed = await sniffPacketPassword(ns, hostname, serverInfo);
    if (sniffed !== null) return sniffed;
    if (await isAlreadyCracked(ns, hostname)) return null;

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (expectedLength && candidate.length !== expectedLength) continue;
        if (format === "numeric" && !/^\d+$/.test(candidate)) continue;
        if (format === "alphabetic" && !/^[a-zA-Z]+$/.test(candidate)) continue;
        if (format === "alphanumeric" && !/^[a-zA-Z0-9]+$/.test(candidate))
            continue;
        const result = await runAuth(ns, hostname, candidate);
        if (result.success) return candidate;
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

async function solveGlobalMaxima(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const length = getPasswordLength(serverInfo, 3);
    // Numeric passwords have no leading zeros: an L-digit password lies in [10^(L-1), 10^L - 1].
    const lo = length > 1 ? Math.pow(10, length - 1) : 0;
    const hi = Math.pow(10, length) - 1;
    const width = Math.pow(10, Math.max(length - 2, 0)) + 1;
    const stats = { auths: 0 };
    const cache = new Map();

    const altitudeAt = async (x) => {
        if (cache.has(x)) return cache.get(x);
        const fb = await authWithLogFeedback(
            ns,
            hostname,
            String(x),
            getAltitudeFeedbackFromLogs,
            3,
            stats,
        );
        if (!fb) return null;
        const value = fb.success
            ? { success: true, altitude: Infinity }
            : { success: false, altitude: fb.value };
        cache.set(x, value);
        return value;
    };

    // authentication.ts getKingOfTheHillAltitude: within 3% of the password only the main hill counts,
    // altitude = 10000·exp(-((x-P)/w)²) with w = 10^(L-2)+1, so |x-P| = w·sqrt(ln(10000/altitude)).
    // Further out the side hills (spaced ~3w apart, each 2600 m lower) add to it, so the estimate is
    // approximate there, but the next sample lands close enough to be exact.
    const climb = async (x, altitude) => {
        let curX = x;
        let curA = altitude;
        for (let iter = 0; iter < 8; iter++) {
            const d = width * Math.sqrt(Math.max(0, Math.log(10000 / curA)));
            const candidates = new Set([
                Math.round(curX + d),
                Math.round(curX - d),
            ]);
            if (d < 2) {
                candidates.add(curX + 1);
                candidates.add(curX - 1);
            }
            let best = null;
            for (const c of candidates) {
                if (c < lo || c > hi || c === curX) continue;
                const r = await altitudeAt(c);
                if (!r) return null;
                if (r.success) return String(c);
                if (!best || r.altitude > best.altitude)
                    best = { x: c, altitude: r.altitude };
            }
            if (!best || best.altitude <= curA) return null; // not climbing: wrong hill
            curX = best.x;
            curA = best.altitude;
        }
        return null;
    };

    // Coarse scan every 3w (the hill spacing). The sample nearest the password is within 1.5w of it, and
    // climbing from the best few samples reaches the main peak; a side hill fails to climb past its own top.
    const step = Math.max(1, Math.floor(3 * width));
    const samples = [];
    const sampleAt = async (x) => {
        if (x < lo || x > hi || cache.has(x)) return null;
        const r = await altitudeAt(x);
        if (!r) return false;
        if (r.success) return String(x);
        samples.push({ x, altitude: r.altitude });
        return null;
    };
    const climbBest = async (count, climbed) => {
        samples.sort((a, b) => b.altitude - a.altitude);
        for (const s of samples.slice(0, count)) {
            if (s.altitude <= 0) break;
            if (climbed.has(s.x)) continue;
            climbed.add(s.x);
            const found = await climb(s.x, s.altitude);
            if (found !== null) return found;
            if (await isAlreadyCracked(ns, hostname)) return false;
        }
        return null;
    };
    for (let x = lo; x <= hi; x += step) {
        const r = await sampleAt(x);
        if (r !== null) return r || null;
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    const climbed = new Set();
    let found = await climbBest(6, climbed);
    if (found !== null) return found || null;
    // Second pass: sample halfway between the best coarse samples and their neighbours, then climb again.
    for (const s of samples.slice(0, 3)) {
        for (const x of [s.x - Math.floor(step / 2), s.x + Math.floor(step / 2)]) {
            const r = await sampleAt(x);
            if (r !== null) return r || null;
        }
    }
    found = await climbBest(6, climbed);
    if (found !== null) return found || null;
    // Small domains (1-2 digit passwords): just try what is left.
    if (hi - lo <= 200) {
        for (let x = lo; x <= hi; x++) {
            const r = await sampleAt(x);
            if (r !== null) return r || null;
        }
    }
    return null;
}

async function solveSpiceLevel(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const length = getPasswordLength(serverInfo, null);
    const charset =
        getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    if (!length) return null;
    let feedbackMisses = 0;

    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, count: length };
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const count = getSpiceLevelFeedbackFromLogs(bleed.logs, guess);
            if (Number.isFinite(count)) return { success: false, count };
        }
        return null;
    }

    // The feedback is the number of exactly-right positions. (1) Count each character with "cccc..." guesses
    // (stop once the counts add up to the length); (2) locate each character by halving its candidate positions,
    // with a zero-count filler character everywhere else. ~|charset| + L*log2(L) attempts instead of up to |charset|*L.
    async function feedback(guess) {
        for (let tries = 0; tries < 3; tries++) {
            const fb = await authWithFeedback(guess);
            if (fb) return fb;
            if (await isAlreadyCracked(ns, hostname)) return null;
        }
        return null;
    }
    const freq = new Map();
    let counted = 0;
    let filler = null;
    for (const ch of charset) {
        if (counted >= length) {
            if (filler === null) filler = ch; // untested characters can't occur
            break;
        }
        const fb = await feedback(ch.repeat(length));
        if (!fb) return null;
        if (fb.success) return ch.repeat(length);
        freq.set(ch, fb.count);
        counted += fb.count;
        if (fb.count === 0 && filler === null) filler = ch;
    }
    if (filler === null || counted !== length) return null; // unexpected feedback (charset mismatch)

    const positions = new Array(length).fill(null);
    async function locate(ch, candidates, count) {
        if (count === 0) return [];
        if (count === candidates.length) return candidates;
        const half = candidates.slice(0, Math.ceil(candidates.length / 2));
        const rest = candidates.slice(half.length);
        const guess = Array.from({ length }, (_, i) => (half.includes(i) ? ch : filler)).join("");
        const fb = await feedback(guess);
        if (!fb) throw new Error("no feedback");
        if (fb.success) return null;
        return [...(await locate(ch, half, fb.count)), ...(await locate(ch, rest, count - fb.count))];
    }
    const present = [...freq.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    try {
        for (let k = 0; k < present.length; k++) {
            const [ch, n] = present[k];
            const open = positions.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
            const found = k === present.length - 1 ? open : await locate(ch, open, n);
            if (found === null) return null;
            for (const i of found) positions[i] = ch;
        }
    } catch {
        return null;
    }
    const guess = positions.join("");
    const finalResp = await runAuth(ns, hostname, guess);
    return finalResp?.success ? guess : null;
}

async function solveLargestPrimeFactor(ns, hostname, serverInfo) {
    const target = extractNumber(
        getHintData(serverInfo) || getHint(serverInfo),
    );
    if (!Number.isFinite(target)) return null;
    const candidate = String(largestPrimeFactor(target));
    const result = await runAuth(ns, hostname, candidate);
    return result.success ? candidate : null;
}

// serverInfo lets tryDictionary skip words of the wrong length/format (it wasn't passed before: every word was tried)
async function solveTopPass(ns, hostname, serverInfo) {
    return await tryDictionary(ns, hostname, commonPasswordDictionary, serverInfo);
}

async function solveEuroZone(ns, hostname, serverInfo) {
    return await tryDictionary(ns, hostname, euCountries, serverInfo);
}

async function solveTimingAttack(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const length = getPasswordLength(serverInfo, 4);
    const charset =
        getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    let prefix = "";
    let feedbackMisses = 0;

    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, mismatchIndex: length };
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const mismatchIndex = getTimingAttackFeedbackFromLogs(
                bleed.logs,
                guess,
            );
            if (Number.isFinite(mismatchIndex))
                return { success: false, mismatchIndex };
        }
        return null;
    }
    for (let i = 0; i < length; i++) {
        let found = false;
        for (const ch of charset) {
            const guess = (prefix + ch).padEnd(length, charset[0]);
            const fb = await authWithFeedback(guess);
            if (fb?.success) return guess;
            if (await isAlreadyCracked(ns, hostname)) return null;
            if (!fb) {
                feedbackMisses++;
                if (feedbackMisses > 4) return null;
                continue;
            }
            const idx = fb.mismatchIndex;
            if (Number.isFinite(idx) && idx > i) {
                // Everything before the mismatch is right, including any padding characters that happened to match
                prefix = guess.slice(0, idx);
                i = idx - 1;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }
    return prefix;
}

async function solveBinaryEncoded(ns, hostname, serverInfo) {
    const raw = getHintData(serverInfo) || getHint(serverInfo);
    const bytes = String(raw).match(/[01]{8}/g);
    if (!bytes) return null;
    const candidate = bytes
        .map((b) => String.fromCharCode(parseInt(b, 2)))
        .join("");
    const result = await runAuth(ns, hostname, candidate);
    return result.success ? candidate : null;
}

async function solveParsedExpression(ns, hostname, serverInfo) {
    const expr = cleanExpression(getHintData(serverInfo));
    if (!expr) return null;
    const value = evaluateExpression(expr);
    if (!Number.isFinite(value)) return null;
    const candidates = buildExpressionCandidates(value);
    for (const candidate of candidates) {
        const result = await runAuth(ns, hostname, candidate);
        if (result.success) return candidate;
    }
    return null;
}

async function solveXorEncrypted(ns, hostname, serverInfo) {
    const hintData = getHintData(serverInfo);
    const [encrypted, masksRaw] = hintData.split(";");
    if (!encrypted || !masksRaw) return null;
    const masks = masksRaw
        .trim()
        .split(/\s+/)
        .map((mask) => parseInt(mask, 2));
    if (masks.some((n) => !Number.isFinite(n))) return null;
    let output = "";
    for (let i = 0; i < encrypted.length; i++) {
        const code = encrypted.charCodeAt(i);
        const mask = masks[i] ?? 0;
        output += String.fromCharCode(code ^ mask);
    }
    const result = await runAuth(ns, hostname, output);
    return result.success ? output : null;
}

async function solveTripleModulo(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const length = getPasswordLength(serverInfo, null);
    if (!length) return null;
    // Feedback: (P % n) % (((n - 1) % 32) + 1). For n <= 32 that is simply P % n, so guessing n gives a
    // residue directly. Pairwise coprime moduli up to 32 have a product of ~1.44e14, enough to pin down
    // any password; stop asking once at most two candidates remain and try those.
    const lo = length > 1 ? 10n ** BigInt(length - 1) : 0n;
    const hi = 10n ** BigInt(length) - 1n;
    const stats = { auths: 0 };
    let residue = 0n;
    let modulus = 1n;
    const firstCandidate = () => lo + ((((residue - lo) % modulus) + modulus) % modulus);
    const candidateCount = () => {
        const first = firstCandidate();
        return first > hi ? 0n : (hi - first) / modulus + 1n;
    };

    for (const m of TRIPLE_MODULO_MODULI) {
        if (candidateCount() <= 2n) break;
        const guess = String(m);
        const fb = await authWithLogFeedback(
            ns,
            hostname,
            guess,
            getModuloResultFeedbackFromLogs,
            3,
            stats,
        );
        if (fb?.success) return guess;
        if (!fb) return null;
        if (!Number.isInteger(fb.value) || fb.value < 0 || fb.value >= m)
            return null;
        residue = crt([residue, BigInt(fb.value)], [modulus, BigInt(m)]);
        modulus *= BigInt(m);
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    if (candidateCount() > 500n) return null;
    for (let x = firstCandidate(); x <= hi; x += modulus) {
        const result = await runAuth(ns, hostname, x.toString());
        if (result.success) return x.toString();
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

function getHint(serverInfo) {
    return String(
        serverInfo?.staticPasswordHint ?? serverInfo?.passwordHint ?? "",
    ).trim();
}

function getHintData(serverInfo) {
    return String(
        serverInfo?.data ?? serverInfo?.passwordHintData ?? "",
    ).trim();
}

function getPasswordLength(serverInfo, fallback) {
    return Number.isFinite(serverInfo?.passwordLength) &&
        serverInfo.passwordLength > 0
        ? serverInfo.passwordLength
        : fallback;
}

function logError(ns, message, err) {
    try {
        const detail = err?.message ?? String(err);
        ns.print(`${message}: ${detail}`);
    } catch {}
}

async function tryDictionary(ns, hostname, words, serverInfo) {
    resetCrackedCheck(hostname);
    const expectedLength = serverInfo?.passwordLength;
    const format = serverInfo?.passwordFormat;
    for (const word of words) {
        if (expectedLength && word.length !== expectedLength) continue;
        if (format === "numeric" && !/^\d+$/.test(word)) continue;
        if (format === "alphabetic" && !/^[a-zA-Z]+$/.test(word)) continue;
        if (format === "alphanumeric" && !/^[a-zA-Z0-9]+$/.test(word)) continue;
        const result = await runAuth(ns, hostname, word);
        if (result.success) return word;
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    return null;
}

function extractTrailingToken(hint) {
    const match = String(hint || "").match(/([A-Za-z0-9]+)\s*$/);
    return match ? match[1] : "";
}

function extractNumber(text) {
    const match = String(text || "").match(/(\d+)/);
    return match ? Number(match[1]) : NaN;
}

function extractRoman(text) {
    const match = String(text || "").match(/([IVXLCDM]+|nulla)/i);
    return match ? match[1] : "";
}

function romanToNumber(input) {
    if (!input) return NaN;
    if (input.toLowerCase() === "nulla") return 0;
    const romanToInt = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    let prev = 0;
    const upper = input.toUpperCase();
    for (let i = upper.length - 1; i >= 0; i--) {
        const value = romanToInt[upper[i]];
        if (!value) return NaN;
        if (value < prev) total -= value;
        else total += value;
        prev = value;
    }
    return total;
}

function largestPrimeFactor(n) {
    let num = Math.floor(n);
    if (num < 2) return num;
    let factor = 2;
    let last = 1;
    while (factor * factor <= num) {
        if (num % factor === 0) {
            last = factor;
            num = Math.floor(num / factor);
        } else {
            factor += factor === 2 ? 1 : 2;
        }
    }
    return Math.max(last, num);
}

function getCharsetForFormat(format) {
    if (!format) return null;
    if (format === "numeric") return "0123456789";
    if (format === "alphabetic")
        return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (format === "alphanumeric")
        return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return null;
}

function defaultCharset() {
    return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
}

function buildCandidate(index, charset, length) {
    let value = index;
    let output = "";
    for (let i = 0; i < length; i++) {
        output = charset[value % charset.length] + output;
        value = Math.floor(value / charset.length);
    }
    return output;
}

function parseYesnt(resp) {
    const data = String(resp?.data ?? "").trim();
    if (!data) return null;
    return data.split(",").map((entry) => entry.trim() === "yes");
}

function parseMismatchIndex(resp) {
    const text = String(resp?.message ?? resp?.data ?? "");
    const match = text.match(/\((\d+)\)/);
    return match ? Number(match[1]) : NaN;
}

/**
 * Find a permutation of the multiset `counts` (symbol -> count) that matches every constraint's exact-position
 * count and hasn't been tried. Depth-first, pruning a prefix as soon as a constraint can no longer be met.
 */
function findMastermindCandidate(
    counts,
    length,
    constraints,
    tried,
    noLeadingZero,
    nodeBudget = 3000000,
) {
    const keys = [...counts.keys()];
    const keyIndex = new Map(keys.map((k, i) => [k, i]));
    const left = keys.map((k) => counts.get(k));
    const guesses = constraints.map((c) => c.guess);
    const targets = constraints.map((c) => c.exact);
    const matched = new Array(constraints.length).fill(0);
    const buffer = new Array(length);
    let nodes = 0;

    const feasible = (idx) => {
        for (let c = 0; c < guesses.length; c++) {
            if (matched[c] > targets[c]) return false;
            // Upper bound on further matches: later positions whose guessed symbol is still available.
            let possible = 0;
            const g = guesses[c];
            for (let j = idx + 1; j < length; j++) {
                const k = keyIndex.get(g[j]);
                if (k !== undefined && left[k] > 0) possible++;
            }
            if (matched[c] + possible < targets[c]) return false;
        }
        return true;
    };

    const dfs = (idx) => {
        if (++nodes > nodeBudget) return null;
        if (idx === length) {
            const candidate = buffer.join("");
            return tried.has(candidate) ? null : candidate;
        }
        for (let k = 0; k < keys.length; k++) {
            if (!left[k]) continue;
            const ch = keys[k];
            if (idx === 0 && noLeadingZero && ch === "0") continue;
            left[k]--;
            buffer[idx] = ch;
            for (let c = 0; c < guesses.length; c++)
                if (guesses[c][idx] === ch) matched[c]++;
            const result = feasible(idx) ? dfs(idx + 1) : null;
            for (let c = 0; c < guesses.length; c++)
                if (guesses[c][idx] === ch) matched[c]--;
            left[k]++;
            if (result) return result;
        }
        return null;
    };
    return dfs(0);
}

async function solvePermutationByAuth(ns, hostname, digits, limit, prefix = "") {
    resetCrackedCheck(hostname);
    let attempts = 0;
    let found = null;
    await permuteDigits(digits, async (rest) => {
        const candidate = prefix + rest;
        // Numeric passwords never start with 0.
        if (candidate.length > 1 && candidate[0] === "0") return false;
        if (attempts >= limit) return true;
        attempts++;
        const resp = await runAuth(ns, hostname, candidate);
        if (resp.success) {
            found = candidate;
            return true;
        }
        if (await isAlreadyCracked(ns, hostname)) return true;
        return false;
    });
    return found;
}

function parseRmsd(resp) {
    const text = String(resp?.data ?? resp?.message ?? "");
    const match = text.match(/RMS\s*Deviation\s*:?\s*([0-9.]+)/i);
    return match ? Number(match[1]) : NaN;
}

function parsePepperCount(resp) {
    const data = String(resp?.data ?? "");
    if (!data) return NaN;
    if (data.startsWith("0/")) return 0;
    // Split on '/' to get pepper part vs total part
    const parts = data.split("/");
    const pepperPart = parts[0];
    // Count U+1F336 (hot pepper) code points regardless of variation selector
    let count = 0;
    for (const ch of pepperPart) {
        if (ch.codePointAt(0) === 0x1f336) count++;
    }
    if (count > 0) return count;
    // Fallback: try parsing as a plain number
    const numMatch = data.match(/^(\d+)\//);
    return numMatch ? Number(numMatch[1]) : NaN;
}

function parseAltitude(resp) {
    if (resp?.data !== undefined && resp?.data !== null && resp?.data !== "") {
        const value = Number(resp.data);
        if (Number.isFinite(value)) return value;
    }
    const text = String(resp?.message ?? "");
    const match = text.match(/current altitude:\s*([0-9.]+)/i);
    return match ? Number(match[1]) : NaN;
}

function parseBaseN(encoded, base) {
    const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const upper = encoded.toUpperCase();
    const [intPart, fracPart] = upper.split(".");
    let value = 0;
    for (const ch of intPart) {
        const digit = characters.indexOf(ch);
        if (digit < 0) return NaN;
        value = value * base + digit;
    }
    if (fracPart) {
        for (let i = 0; i < fracPart.length; i++) {
            const digit = characters.indexOf(fracPart[i]);
            if (digit < 0) return NaN;
            value += digit / Math.pow(base, i + 1);
        }
    }
    return value;
}

function cleanExpression(expression) {
    let cleaned = String(expression || "")
        .replaceAll("ҳ", "*")
        .replaceAll("÷", "/")
        .replaceAll("➕", "+")
        .replaceAll("➖", "-")
        .replaceAll("×", "*");
    // Same as the game's cleanArithmeticExpression: drop injected "ns.exit()," (it can sit right after a "("),
    // then ignore everything after the first comma (appended fake code injection).
    cleaned = cleaned.replaceAll("ns.exit(),", "");
    if (cleaned.includes(",")) cleaned = cleaned.split(",")[0];
    return cleaned.trim();
}

function evaluateExpression(expression) {
    const tokens = tokenizeExpression(expression);
    let index = 0;

    const parseExpression = () => {
        let value = parseTerm();
        while (
            index < tokens.length &&
            (tokens[index] === "+" || tokens[index] === "-")
        ) {
            const op = tokens[index++];
            const right = parseTerm();
            value = op === "+" ? value + right : value - right;
        }
        return value;
    };

    const parseTerm = () => {
        let value = parsePower();
        while (
            index < tokens.length &&
            (tokens[index] === "*" || tokens[index] === "/")
        ) {
            const op = tokens[index++];
            const right = parsePower();
            value = op === "*" ? value * right : value / right;
        }
        return value;
    };

    const parsePower = () => {
        let value = parseUnary();
        if (tokens[index] === "^") {
            index++;
            const right = parsePower();
            value = Math.pow(value, right);
        }
        return value;
    };

    const parseUnary = () => {
        if (tokens[index] === "+") {
            index++;
            return parseUnary();
        }
        if (tokens[index] === "-") {
            index++;
            return -parseUnary();
        }
        return parsePrimary();
    };

    const parsePrimary = () => {
        const token = tokens[index++];
        if (token === "(") {
            const value = parseExpression();
            if (tokens[index] === ")") index++;
            return value;
        }
        if (typeof token === "number") return token;
        return NaN;
    };

    const result = parseExpression();
    return Number.isFinite(result) ? result : NaN;
}

function tokenizeExpression(expression) {
    const raw = String(expression || "").replace(/\s+/g, "");
    const tokens = [];
    let i = 0;
    while (i < raw.length) {
        const ch = raw[i];
        if ("+-*/^()".includes(ch)) {
            tokens.push(ch);
            i++;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            let num = "";
            while (i < raw.length && /[0-9.]/.test(raw[i])) {
                num += raw[i];
                i++;
            }
            tokens.push(parseFloat(num));
            continue;
        }
        i++;
    }
    return tokens;
}

function buildExpressionCandidates(value) {
    const candidates = [];
    if (Number.isFinite(value)) {
        if (Math.abs(value - Math.round(value)) < 1e-6) {
            candidates.push(String(Math.round(value)));
        }
        candidates.push(String(value));
        candidates.push(value.toFixed(2));
        candidates.push(value.toFixed(3));
    }
    return Array.from(new Set(candidates));
}

/**
 * Divisibility-test feedback for `divisor`: {success: true} if it was the password,
 * {success: false, divisible} otherwise, or null when the log entry could not be read (retry later).
 */
async function isDivisibleBy(ns, hostname, divisor, stats) {
    const fb = await authWithLogFeedback(
        ns,
        hostname,
        divisor.toString(),
        getDivisibilityFeedbackFromLogs,
        3,
        stats,
    );
    if (!fb) return null;
    if (fb.success) return { success: true, divisible: true };
    return { success: false, divisible: fb.value === true };
}

function parseModuloResult(resp) {
    const data = resp?.data ?? resp?.message ?? "";
    const match = String(data).match(/(-?\d+)/);
    return match ? Number(match[1]) : NaN;
}

function crt(residues, moduli) {
    let x = 0n;
    let m = 1n;
    for (let i = 0; i < residues.length; i++) {
        const r = residues[i];
        const mod = moduli[i];
        const inv = modInverse(m, mod);
        const t = (((r - x) % mod) + mod) % mod;
        const k = (t * inv) % mod;
        x = x + m * k;
        m *= mod;
        x = ((x % m) + m) % m;
    }
    return x;
}

function modInverse(a, mod) {
    const { g, x } = extendedGcd(a, mod);
    if (g !== 1n) return 0n;
    return ((x % mod) + mod) % mod;
}

function extendedGcd(a, b) {
    if (b === 0n) return { g: a, x: 1n, y: 0n };
    const { g, x: x1, y: y1 } = extendedGcd(b, a % b);
    return { g, x: y1, y: x1 - (a / b) * y1 };
}

function permuteDigits(digits, visit) {
    const counts = new Map();
    for (const d of digits) counts.set(d, (counts.get(d) || 0) + 1);
    const keys = Array.from(counts.keys());
    const targetLen = digits.length;
    const buffer = new Array(targetLen);

    const backtrack = async (idx) => {
        if (idx === targetLen) {
            return await visit(buffer.join(""));
        }
        for (const key of keys) {
            const count = counts.get(key);
            if (!count) continue;
            counts.set(key, count - 1);
            buffer[idx] = key;
            if (await backtrack(idx + 1)) return true;
            counts.set(key, count);
        }
        return false;
    };

    return backtrack(0);
}

function directionDelta(dir) {
    if (dir === "north") return { dx: 0, dy: -2 };
    if (dir === "south") return { dx: 0, dy: 2 };
    if (dir === "west") return { dx: -2, dy: 0 };
    return { dx: 2, dy: 0 };
}

function reverseDirection(dir) {
    if (dir === "north") return "south";
    if (dir === "south") return "north";
    if (dir === "west") return "east";
    return "west";
}

/**
 * Password-like tokens and hints from server logs or clue text. Only "password: X" / "password = X" counts:
 * free text such as "The password for X contains a and b" or "Password is not divisible by 7" does not.
 */
function parseDarknetLogs(logs) {
    const passwords = [];
    const hints = [];
    const entries = Array.isArray(logs)
        ? logs
        : String(logs || "").split(/\r?\n/);
    for (const log of entries) {
        const line = String(log || "");
        const pwdMatch = line.match(/password\s*[:=]\s*['"]?([^'"}\s,]+)/i);
        if (pwdMatch) passwords.push(pwdMatch[1]);
        const authMatch = line.match(/auth(?:enticate)?\s*:\s*['"]?([^'"}\s,]+)/i);
        if (authMatch) passwords.push(authMatch[1]);
        const hintMatch = line.match(/hint[:\s]+(.+)/i);
        if (hintMatch) hints.push(hintMatch[1].trim());
    }
    return { passwords, hints };
}

/**
 * Passwords in a .data.txt clue file (effects.ts generateDarknetClueFiles):
 * - `Server: <host> Password: "<pw>"`     -> {hostname, password}
 * - `Remember this password: <pw>`        -> {hostname: null, password} (an unnamed neighbour)
 * "The password for <host> contains a and b" and "Some common passwords include ..." are not passwords.
 */
function parseClueText(content) {
    const clues = [];
    for (const raw of String(content || "").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const named =
            line.match(/(?:server|host(?:name)?)\s*:?\s*([^\s,]+)[,\s]+password\s*:\s*"([^"]*)"/i) ||
            line.match(/(?:server|host(?:name)?)\s*:?\s*([^\s,]+)[,\s]+password\s*:\s*'?([^'"}\s,]+)/i);
        if (named) {
            clues.push({ hostname: named[1], password: named[2] });
            continue;
        }
        for (const password of parseDarknetLogs([line]).passwords)
            clues.push({ hostname: null, password });
    }
    return clues;
}

const nsToken = ["n", "s"].join("");
const dnetToken = ["d", "n", "e", "t"].join("");
const nsPrefix = `${nsToken}.`;
const dnetPrefix = `${nsPrefix}${dnetToken}.`;

const commandNames = {
    auth: ["auth", "enticate"].join(""),
    dnetScan: String.fromCharCode(112, 114, 111, 98, 101),
    link: String.fromCharCode(
        99,
        111,
        110,
        110,
        101,
        99,
        116,
        84,
        111,
        83,
        101,
        115,
        115,
        105,
        111,
        110,
    ),
    details: ["get", "Server", "Details"].join(""),
    open: ["open", "Cache"].join(""),
    phish: ["phishing", "Attack"].join(""),
    promote: ["promote", "Stock"].join(""),
    bleed: ["heart", "bleed"].join(""),
    mem: ["memory", "Reallocation"].join(""),
    depth: ["get", "Depth"].join(""),
    stasis: ["set", "Stasis", "Link"].join(""),
    stasisLimit: ["get", "Stasis", "Link", "Limit"].join(""),
    stasisList: ["get", "Stasis", "Linked", "Servers"].join(""),
    migrate: ["induce", "Server", "Migration"].join(""),
    storm: ["unleash", "Storm", "Seed"].join(""),
    blockedRam: ["get", "Blocked", "Ram"].join(""),
    procList: ["p", "s"].join(""),
    terminate: ["k", "i", "l", "l"].join(""),
    copyFile: ["s", "c", "p"].join(""),
    listDir: ["l", "s"].join(""),
    hasFile: ["file", "Exists"].join(""),
    getMaxRam: ["get", "Server", "Max", "Ram"].join(""),
    getUsedRam: ["get", "Server", "Used", "Ram"].join(""),
    getScriptName: ["get", "Script", "Name"].join(""),
    labReport: ["lab", "report"].join(""),
    labRadar: ["lab", "radar"].join(""),
};

const commandArgs = {
    singleArg: `${nsPrefix}args[0]`,
    pairArg: `${nsPrefix}args[0], ${nsPrefix}args[1]`,
    peekArg: `${nsPrefix}args[0], { peek: true }`,
};

let commandCounter = 0;
// Reduced wrap limit: fewer temp files on disk at any time (was 100000 -> now 1000)
// Files are overwritten on reuse via ns.write(..., 'w'), so smaller wrap is safe
// Only result files are numbered now; scripts are one file per distinct command.
const COMMAND_COUNTER_WRAP = 100;

/** Small stable string hash, used to name one temp script per distinct command. */
function hashCommand(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

function buildDnetCommand(name, args = "") {
    return `${dnetPrefix}${name}(${args})`;
}

function buildNsCommand(name, args = "") {
    return `${nsPrefix}${name}(${args})`;
}

// Direct calls are written out explicitly so the game's static RAM calculation reserves them.
// A dynamic lookup (ns.dnet[method]) isn't counted statically, and if dynamic usage ever exceeds the
// reserved RAM the game kills the probe with a "Dynamic RAM usage" error.
async function dnetCall(ns, method, ...args) {
    try {
        switch (method) {
            case commandNames.auth:
                return await ns.dnet.authenticate(...args);
            case commandNames.depth:
                return ns.dnet.getDepth(...args);
            case commandNames.details:
                return ns.dnet.getServerDetails(...args);
            case commandNames.dnetScan:
                return ns.dnet.probe(...args);
            case commandNames.labReport:
                return await ns.dnet.labreport(...args);
            case commandNames.link:
                return ns.dnet.connectToSession(...args);
            case commandNames.bleed:
                return await ns.dnet.heartbleed(...args);
        }
    } catch {}
    return null;
}

async function nsScpDirect(ns, source, destination, fromHost) {
    try {
        return await ns.scp(source, destination, fromHost);
    } catch {}
    return null;
}

async function runLabReport(ns) {
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.labReport),
        );
    } catch {}
    return null;
}

async function runLabRadar(ns) {
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.labRadar),
        );
    } catch {}
    return null;
}
async function runDnetCommand(ns, command, args = [], threads = 1) {
    const id = commandCounter++ % COMMAND_COUNTER_WRAP;
    const host = ns.getHostname();
    const resultFile = `/Temp/dnet-task-${id}.txt`;
    // The script source must be identical for every call of the same command: the game caches
    // each distinct source forever, so the result file is passed as the last argument.
    const scriptFile = `/Temp/dnet-cmd-${hashCommand(command)}.js`;
    const script =
        `export async function main(ns){const f=ns.args[ns.args.length-1];let r;try{const v=await (${command});` +
        `const w=v===undefined?{$type:'undefined'}:v===null?{$type:'null'}:v;` +
        `r=JSON.stringify({$type:'result',$value:w});}catch(e){r="ERROR: "+(typeof e==='string'?e:e?.message??JSON.stringify(e));}` +
        `ns.write(f,r,'w');}`;
    // NOTE: ns.rm omitted from temp script to save 1.0GB RAM per invocation.
    // Writing identical content is a no-op for the game, so this doesn't recompile.
    ns.write(scriptFile, script, "w");
    ns.write(resultFile, "<pending>", "w");
    const pid = ns.exec(scriptFile, host, threads, ...args, resultFile);
    if (!pid) return null;
    // dnet calls take up to several seconds (auth time, heartbleed = 1.5x auth time): wait up to 60s.
    // The temp script always writes its result (errors included), so this only times out if it was killed.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        const data = ns.read(resultFile);
        if (data && data !== "<pending>") {
            return decodePayload(data);
        }
        await ns.sleep(25);
    }
    return null;
}

async function nsPs(ns, hostname) {
    return (
        (await runDnetCommand(
            ns,
            buildNsCommand(commandNames.procList, commandArgs.singleArg),
            [hostname],
        )) || []
    );
}

async function nsKill(ns, pid) {
    return await runDnetCommand(
        ns,
        buildNsCommand(commandNames.terminate, commandArgs.singleArg),
        [pid],
    );
}

async function nsScp(ns, source, destination) {
    return await runDnetCommand(
        ns,
        buildNsCommand(commandNames.copyFile, commandArgs.pairArg),
        [source, destination],
    );
}

// Session-aware SCP: temp script establishes a session before copying.
// Darknet sessions are per-PID, so the temp script needs its own session.
// RAM cost: 1.6 (base) + 0.60 (scp) + 0.05 (connectToSession) = 2.25 GB
async function nsScpWithSession(ns, source, destination, password) {
    const id = commandCounter++ % COMMAND_COUNTER_WRAP;
    const host = ns.getHostname();
    const resultFile = `/Temp/dnet-task-${id}.txt`;
    // Password and result file go through args so the script source is constant.
    const scriptFile = `/Temp/dnet-scp-session.js`;
    const script =
        `export async function main(ns){let r;try{` +
        `${dnetPrefix}${commandNames.link}(${nsPrefix}args[1],String(${nsPrefix}args[2]));` +
        `const v=await (${nsPrefix}${commandNames.copyFile}(${nsPrefix}args[0],${nsPrefix}args[1]));` +
        `const w=v===undefined?{$type:'undefined'}:v===null?{$type:'null'}:v;` +
        `r=JSON.stringify({$type:'result',$value:w});}catch(e){r="ERROR: "+(typeof e==='string'?e:e?.message??JSON.stringify(e));}` +
        `ns.write(String(${nsPrefix}args[3]),r,'w');}`;
    ns.write(scriptFile, script, "w");
    ns.write(resultFile, "<pending>", "w");
    const pid = ns.exec(
        scriptFile,
        host,
        1,
        source,
        destination,
        password ?? "",
        resultFile,
    );
    if (!pid) return null;
    // dnet calls take up to several seconds (auth time, heartbleed = 1.5x auth time): wait up to 60s.
    // The temp script always writes its result (errors included), so this only times out if it was killed.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        const data = ns.read(resultFile);
        if (data && data !== "<pending>") {
            return decodePayload(data);
        }
        await ns.sleep(25);
    }
    return null;
}

async function nsLs(ns, hostname, pattern) {
    if (pattern !== undefined) {
        return (
            (await runDnetCommand(
                ns,
                buildNsCommand(commandNames.listDir, commandArgs.pairArg),
                [hostname, pattern],
            )) || []
        );
    }
    return (
        (await runDnetCommand(
            ns,
            buildNsCommand(commandNames.listDir, commandArgs.singleArg),
            [hostname],
        )) || []
    );
}

async function nsFileExists(ns, filename, hostname) {
    if (hostname !== undefined) {
        return await runDnetCommand(
            ns,
            buildNsCommand(commandNames.hasFile, commandArgs.pairArg),
            [filename, hostname],
        );
    }
    return await runDnetCommand(
        ns,
        buildNsCommand(commandNames.hasFile, commandArgs.singleArg),
        [filename],
    );
}

function nsGetServerMaxRam(ns, hostname) {
    // Direct call: 0.05 GB RAM cost — avoids temp script exec that fails on RAM-starved hosts
    return ns.getServerMaxRam(hostname);
}

function nsGetServerUsedRam(ns, hostname) {
    // Direct call: 0.05 GB RAM cost — avoids temp script exec that fails on RAM-starved hosts
    return ns.getServerUsedRam(hostname);
}

// nsGetScriptName removed — hardcoded script name used instead

// Darknet instability makes some attempts time out (code 408) without checking the password at all,
// which would silently lose a correct guess: retry those.
const AUTH_TIMEOUT_CODE = 408;

// Authentication and heartbleed take 1/(1+0.2(t-1)) as long with t threads, and memoryReallocation frees t times as
// much per call, so they run in temp scripts with the host's spare RAM (tools/dnet-sim/CrossSim: at low charisma,
// 1-thread cracking never reached the Eternal labyrinth in 24h). They use the RAM workers leave free (WORKER_RESERVE_*):
// pausing workers for them stopped the workers for good, since a probe nearly always has something to crack.
const PROBE_FIT_GB = 12; // free RAM a neighbour needs to host a probe (~7 GB) plus its first temp scripts
const HELPER_HEADROOM_GB = 4; // left for the probe's other temp scripts (ps, kill, scp: up to ~2.3 GB; openCache 3.6 GB)
const HELPER_MAX_THREADS = 64;
function helperThreads(ns, ramPerThread) {
    const host = ns.getHostname();
    const free = nsGetServerMaxRam(ns, host) - nsGetServerUsedRam(ns, host) - HELPER_HEADROOM_GB;
    return Math.max(1, Math.min(HELPER_MAX_THREADS, Math.floor(free / ramPerThread)));
}

async function runAuth(ns, hostname, password) {
    let result = null;
    for (let i = 0; i < 4; i++) {
        result = await runAuthOnce(ns, hostname, password);
        if (result?.code !== AUTH_TIMEOUT_CODE) break;
    }
    return result;
}

async function runAuthOnce(ns, hostname, password) {
    const threads = helperThreads(ns, 2.0); // 1.6 base + 0.4 authenticate
    if (threads > 1)
        try {
            const result = await runDnetCommand(ns, buildDnetCommand(commandNames.auth, commandArgs.pairArg), [hostname, password], threads);
            if (result && typeof result === "object" && "success" in result) return result;
        } catch {}
    try {
        const result = await dnetCall(
            ns,
            commandNames.auth,
            hostname,
            password,
        );
        if (result && typeof result === "object" && "success" in result) {
            return result;
        }
    } catch {}
    try {
        const result = await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.auth, commandArgs.pairArg),
            [hostname, password],
        );
        if (result && typeof result === "object" && "success" in result) {
            return result;
        }
    } catch {}
    return { success: false, message: "error", code: 0, data: null };
}

async function runScan(ns) {
    try {
        const result = await dnetCall(ns, commandNames.dnetScan);
        if (result) return result;
    } catch {}
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.dnetScan),
        );
    } catch {}
    return null;
}

// runSessionLink removed — replaced by direct ns.dnet.connectToSession() calls to preserve session context

async function getAuthDetails(ns, hostname) {
    try {
        const result = await dnetCall(ns, commandNames.details, hostname);
        if (result) return result;
    } catch {}
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.details, commandArgs.singleArg),
            [hostname],
        );
    } catch {}
    return null;
}

async function getAuthDetailsLocal(ns, hostname) {
    try {
        return await dnetCall(ns, commandNames.details, hostname);
    } catch {}
    return null;
}

/** Auth-attempt counter per hostname — used to throttle isAlreadyCracked checks. */
const _crackedCheckCounters = new Map();
const _CRACKED_CHECK_INTERVAL = 25;

/**
 * Throttled check: has another agent already cracked this server?
 * Only actually queries every _CRACKED_CHECK_INTERVAL calls per hostname.
 * Returns true if server already has admin rights (cracked by someone else).
 */
async function isAlreadyCracked(ns, hostname, force = false) {
    const count = (_crackedCheckCounters.get(hostname) || 0) + 1;
    _crackedCheckCounters.set(hostname, count);
    if (!force && count % _CRACKED_CHECK_INTERVAL !== 0) return false;
    try {
        // getServerDetails() has no admin flag; hasRootAccess is 0.05 GB and works on darknet servers
        return ns.hasRootAccess(hostname) === true;
    } catch {
        return false;
    }
}

/** Reset the cracked-check counter for a hostname (call at start of each solver). */
function resetCrackedCheck(hostname) {
    _crackedCheckCounters.delete(hostname);
}

async function runHeartbleed(ns, hostname) {
    const threads = helperThreads(ns, 2.2);
    if (threads > 1)
        try {
            const result = await runDnetCommand(ns, buildDnetCommand(commandNames.bleed, commandArgs.peekArg), [hostname], threads);
            if (result) return result;
        } catch {}
    try {
        const direct = await dnetCall(ns, commandNames.bleed, hostname, { peek: true });
        if (direct) return direct;
    } catch {}
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.bleed, commandArgs.peekArg),
            [hostname],
        );
    } catch {}
    return null;
}

async function runHeartbleedMulti(ns, hostname, logsToCapture) {
    const threads = helperThreads(ns, 2.2); // 1.6 base + 0.6 heartbleed
    if (threads > 1)
        try {
            const args = `${nsPrefix}args[0], { peek: true, logsToCapture: Number(${nsPrefix}args[1]) }`;
            const result = await runDnetCommand(ns, buildDnetCommand(commandNames.bleed, args), [hostname, logsToCapture], threads);
            if (result) return result;
        } catch {}
    try {
        const direct = await dnetCall(ns, commandNames.bleed, hostname, { peek: true, logsToCapture });
        if (direct) return direct;
    } catch {}
    try {
        // Build custom heartbleed command with multi-log capture and peek
        const args = `${nsPrefix}args[0], { peek: true, logsToCapture: Number(${nsPrefix}args[1]) }`;
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.bleed, args),
            [hostname, logsToCapture],
        );
    } catch {}
    return null;
}

/**
 * Authenticate with `guess` and read that attempt's feedback back from the server log.
 * authenticate() only returns `data` on labyrinth servers; elsewhere the response is logged as JSON and
 * read with heartbleed. An attempt that times out leaves no log entry, so retry up to `maxTries` times.
 * Returns {success: true} for the right password, {success: false, value} with the parsed feedback,
 * or null when no feedback could be read. `stats.auths` (optional) counts real authentication attempts.
 */
async function authWithLogFeedback(
    ns,
    hostname,
    guess,
    parseLogs,
    maxTries = 3,
    stats = null,
) {
    for (let t = 0; t < maxTries; t++) {
        if (stats) stats.auths++;
        const resp = await runAuth(ns, hostname, guess);
        if (resp?.success) return { success: true, value: null };
        // Noise lines keep arriving (every 1-31 s) during the heartbleed delay, and other scripts may be
        // authenticating too: capture plenty of lines. More lines cost nothing extra.
        const bleed = await runHeartbleedMulti(ns, hostname, 40);
        const value = bleed?.logs ? parseLogs(bleed.logs, guess) : null;
        if (value !== null && value !== undefined && !Number.isNaN(value))
            return { success: false, value };
    }
    return null;
}

function getMastermindFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        // Server logs for auth attempts are JSON-stringified PasswordResponse objects
        // Format: {"code":401,"passwordAttempted":"...","message":"Hint: ...","data":"exact,misplaced"}
        try {
            const parsed = JSON.parse(line);
            if (
                parsed &&
                parsed.passwordAttempted === attemptedPassword &&
                typeof parsed.data === "string"
            ) {
                const match = parsed.data.match(/(\d+)\s*,\s*(\d+)/);
                if (match) {
                    return {
                        exact: Number(match[1]),
                        misplaced: Number(match[2]),
                    };
                }
            }
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getSpiceLevelFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const count = parsePepperCount({ data: parsed?.data ?? "" });
            if (Number.isFinite(count)) return count;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getYesntFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const flags = parseYesnt({ data: parsed?.data ?? "" });
            if (flags) return flags;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getTimingAttackFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const idx = parseMismatchIndex({
                message: parsed?.message ?? "",
                data: parsed?.data ?? "",
            });
            if (Number.isFinite(idx)) return idx;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getGuessNumberFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const direction = String(parsed?.data ?? "")
                .trim()
                .toLowerCase();
            if (!direction) continue;
            if (!direction.includes("higher") && !direction.includes("lower"))
                continue;
            const feedback = { direction };
            const message = String(parsed?.message ?? "");
            const rangeMatch = message.match(/between\s+(\d+)\s+and\s+(\d+)/i);
            if (rangeMatch) {
                feedback.rangeMin = Number(rangeMatch[1]);
                feedback.rangeMax = Number(rangeMatch[2]);
            }
            return feedback;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getRomanNumeralFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const data = String(parsed?.data ?? "");
            const message = String(parsed?.message ?? "");
            const text = `${data} ${message}`.toUpperCase();
            if (text.includes("ALTUS")) return "ALTUS";
            if (text.includes("PARUM")) return "PARUM";
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getAltitudeFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const altitude = parseAltitude({
                data: parsed?.data ?? null,
                message: parsed?.message ?? "",
            });
            if (Number.isFinite(altitude)) return altitude;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getRmsdFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const rmsd = parseRmsd({
                data: parsed?.data ?? "",
                message: parsed?.message ?? "",
            });
            if (Number.isFinite(rmsd)) return rmsd;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getModuloResultFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const result = parseModuloResult({
                data: parsed?.data ?? "",
                message: parsed?.message ?? "",
            });
            if (Number.isFinite(result)) return result;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

function getDivisibilityFeedbackFromLogs(logs, attemptedPassword) {
    if (!logs || !Array.isArray(logs)) return null;
    for (const log of logs) {
        const line = String(log || "");
        try {
            const parsed = JSON.parse(line);
            if (parsed?.passwordAttempted !== attemptedPassword) continue;
            const data = String(parsed?.data ?? "").toLowerCase();
            if (data === "true") return true;
            if (data === "false") return false;
            const message = String(parsed?.message ?? "").toLowerCase();
            if (message.includes("is divisible")) return true;
            if (message.includes("not divisible")) return false;
        } catch {
            // Not a JSON log entry (noise), skip
        }
    }
    return null;
}

async function runOpenCache(ns, filename) {
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.open, commandArgs.singleArg),
            [filename],
        );
    } catch {}
    return null;
}

async function runPromoteStock(ns, symbol) {
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.promote, commandArgs.singleArg),
            [symbol],
        );
    } catch {}
    return null;
}

async function runUnleashStormSeed(ns) {
    // unleashStormSeed costs only 0.1 GB but runs on the script's host server.
    // Use runDnetCommand (temp script) to avoid adding 0.1 GB to probe's dynamic RAM.
    // Temp script cost: 1.6 base + 0.1 API = 1.7 GB.
    try {
        return await runDnetCommand(ns, buildDnetCommand(commandNames.storm));
    } catch {}
    return null;
}

async function runDepth(ns, hostname) {
    try {
        const result = await dnetCall(ns, commandNames.depth, hostname);
        if (typeof result === "number") return result;
    } catch {}
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.depth, commandArgs.singleArg),
            [hostname],
        );
    } catch {}
    return null;
}

function decodePayload(data) {
    if (!data || typeof data !== "string") return null;
    if (data.startsWith("ERROR:")) return null;
    try {
        const parsed = JSON.parse(data);
        if (!parsed || parsed.$type !== "result") return parsed;
        return revivePayload(parsed.$value);
    } catch {
        return null;
    }
}

function revivePayload(value) {
    if (value && value.$type === "null") return null;
    if (value && value.$type === "undefined") return undefined;
    return value;
}
