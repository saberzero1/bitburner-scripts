const PROBE_VERSION = 25;

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
            // Free blocked RAM FIRST — maximizes available RAM for all subsequent operations
            await freeBlockedRam(ns);

            const nearbyServers = (await runScan(ns)) || [];
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

                let success = false;
                try {
                    success = await processServer(
                        ns,
                        hostname,
                        passwords,
                        PASSWORD_FILE,
                        SCRIPT_NAME,
                    );
                } catch (err) {
                    logError(ns, `Probe error processing ${hostname}`, err);
                }
                if (success) {
                    failedServers.delete(hostname);
                    // Mark as completed — re-check every 60s to verify probe is still alive
                    completedServers.set(hostname, {
                        probeDeployed: true,
                        recheckAt: Date.now() + 60000,
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
            }

            await handleCacheFiles(ns, HOST);
            await runOptionalActions(ns, OPTIONS_FILE, HOST);
            await manageStasis(ns, OPTIONS_FILE, HOST, passwords);
            await attemptMigrationCharging(ns, OPTIONS_FILE, HOST);

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
                        try {
                            ns.dnet.connectToSession(stasisHost, pwd);
                        } catch {}
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
    const details = await getAuthDetails(ns, hostname);
    if (!details || !details.isOnline) {
        return false;
    }

    // If we already have a session on this server, just deploy/propagate
    if (details.hasSession || hostname === "darkweb") {
        if (details.depth === undefined || details.depth === null) {
            try {
                await runDepth(ns, hostname);
            } catch {}
        }
        await scanClueFiles(ns, hostname, passwords, passwordFile);
        return await deployProbe(
            ns,
            hostname,
            passwords.get(hostname),
            scriptName,
        );
    }

    // If we have a saved password, try to establish a session with it.
    // connectToSession works at any distance and is instant.
    if (passwords.has(hostname)) {
        const knownPassword = passwords.get(hostname);
        try {
            ns.dnet.connectToSession(hostname, knownPassword ?? "");
        } catch {}

        // Re-check if session was established
        const refreshed = await getAuthDetails(ns, hostname);
        if (refreshed?.hasSession) {
            await scanClueFiles(ns, hostname, passwords, passwordFile);
            return await deployProbe(ns, hostname, knownPassword, scriptName);
        }

        // Session failed — server may have restarted with a new password.
        // Remove the stale password so we re-authenticate below.
        passwords.delete(hostname);
        savePasswords(ns, passwordFile, passwords);
    }

    // Per darknet docs: authenticate can ONLY target nearby CONNECTED servers.
    // If the server isn't connected to us, we can't authenticate — skip it.
    if (!details.isConnectedToCurrentServer) {
        return false;
    }

    // Try to authenticate (crack password)
    const password = await tryAccessServer(ns, hostname, details, passwords);
    if (password !== null) {
        passwords.set(hostname, password ?? "");
        savePasswords(ns, passwordFile, passwords);
        await scanClueFiles(ns, hostname, passwords, passwordFile);
        return await deployProbe(ns, hostname, password, scriptName);
    }

    return false;
}

async function tryAccessServer(ns, hostname, details, passwords) {
    if ((details.modelId || "").toLowerCase().includes("labyrinth")) {
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

    // Re-check: another agent may have cracked this while we tried hints
    const preCheck = await getAuthDetails(ns, hostname);
    if (preCheck?.hasAdminRights) return "";

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

    // Re-check before packetCapture: another agent may have cracked this
    const preCap = await getAuthDetails(ns, hostname);
    if (preCap?.hasAdminRights) return "";

    // RAM-aware packetCapture gating: only attempt if enough RAM available
    // packetCapture temp script costs 7.6GB (1.6 base + 6.0 ns.dnet.packetCapture)
    const HOST = ns.getHostname();
    const captureCost = 7.6;
    const freeRam =
        (await nsGetServerMaxRam(ns, HOST)) -
        (await nsGetServerUsedRam(ns, HOST));
    if (freeRam >= captureCost) {
        try {
            const captured = await runCapture(ns, hostname);
            if (captured?.password) {
                const result = await runAuth(ns, hostname, captured.password);
                if (result.success) {
                    ns.print(`SUCCESS: Captured password for ${hostname}`);
                    return captured.password;
                }
            }
        } catch {}
    }

    return null;
}

async function solveLabyrinth(ns, hostname) {
    // The labyrinth solver MUST run as a single persistent PID because
    // DarknetState.labLocations[pid] tracks position per-PID.
    // Using temp scripts (new PID per call) resets position to (1,1) every time.
    // Solution: generate a self-contained temp script that runs the entire DFS
    // maze walk within one process, using labreport for directions and
    // authenticate for movement.
    const host = ns.getHostname();
    const id = commandCounter++ % COMMAND_COUNTER_WRAP;
    const resultFile = `/Temp/lab-result-${id}.txt`;
    const scriptFile = `/Temp/lab-solver-${id}.js`;

    // Build the method name dynamically to RAM-dodge 'authenticate' (0.4 GB)
    // labreport is 0 GB so it's safe to use literally
    const authMethod = ["auth", "enticate"].join("");

    // The self-contained DFS solver script.
    // It calls ns.dnet.labreport() for position + open directions,
    // and ns.dnet[authMethod](hostname, "go <dir>") for movement.
    // Position tracking comes from response messages, not from labreport,
    // because we need to know if a move succeeded.
    const solverScript = [
        `export async function main(ns) {`,
        `  const host = "${hostname}";`,
        `  const rf = "${resultFile}";`,
        `  const am = ["auth", "enticate"].join("");`,
        `  const visited = new Set();`,
        `  const stack = [];`,
        `  let px = 1, py = 1;`,
        `  try {`,
        `    const rpt0 = ns.dnet.labreport();`,
        `    if (rpt0 && rpt0.success && rpt0.coords) { px = rpt0.coords[0]; py = rpt0.coords[1]; }`,
        `  } catch {}`,
        `  const deltas = { north: [0,-2], south: [0,2], west: [-2,0], east: [2,0] };`,
        `  const rev = { north:"south", south:"north", west:"east", east:"west" };`,
        `  for (let i = 0; i < 5000; i++) {`,
        `    const key = px+","+py;`,
        `    visited.add(key);`,
        `    let dirs = null;`,
        `    try {`,
        `      const rpt = ns.dnet.labreport();`,
        `      if (rpt && rpt.success) {`,
        `        dirs = [];`,
        `        if (rpt.north) dirs.push("north");`,
        `        if (rpt.south) dirs.push("south");`,
        `        if (rpt.east) dirs.push("east");`,
        `        if (rpt.west) dirs.push("west");`,
        `        if (rpt.coords) { px = rpt.coords[0]; py = rpt.coords[1]; }`,
        `      }`,
        `    } catch {}`,
        `    if (!dirs) { ns.write(rf,"FAIL:no_directions","w"); return; }`,
        `    const nd = dirs.find(d => {`,
        `      const dd = deltas[d];`,
        `      return !visited.has((px+dd[0])+","+(py+dd[1]));`,
        `    });`,
        `    if (nd) {`,
        `      stack.push({ px, py, dir: nd });`,
        `      const mr = await ns.dnet[am](host, "go "+nd);`,
        `      if (mr && mr.success) { ns.write(rf,"SUCCESS","w"); return; }`,
        `      const msg = (mr && mr.message) || "";`,
        `      const mm = msg.match(/moved to (\\d+),(\\d+)/);`,
        `      if (mm) { px = parseInt(mm[1],10); py = parseInt(mm[2],10); }`,
        `      else { stack.pop(); }`,
        `      await ns.sleep(10);`,
        `      continue;`,
        `    }`,
        `    if (stack.length === 0) { ns.write(rf,"FAIL:exhausted","w"); return; }`,
        `    const back = stack.pop();`,
        `    const rd = rev[back.dir];`,
        `    const br = await ns.dnet[am](host, "go "+rd);`,
        `    if (br && br.success) { ns.write(rf,"SUCCESS","w"); return; }`,
        `    const bmsg = (br && br.message) || "";`,
        `    const bm = bmsg.match(/moved to (\\d+),(\\d+)/);`,
        `    if (bm) { px = parseInt(bm[1],10); py = parseInt(bm[2],10); }`,
        `    else { ns.write(rf,"FAIL:stuck","w"); return; }`,
        `    await ns.sleep(10);`,
        `  }`,
        `  ns.write(rf,"FAIL:max_iterations","w");`,
        `}`,
    ].join("\n");

    ns.write(scriptFile, solverScript, "w");
    ns.write(resultFile, "<pending>", "w");

    const pid = ns.exec(scriptFile, host);
    if (!pid) {
        ns.print(`ERROR: Failed to exec labyrinth solver for ${hostname}`);
        return false;
    }

    // Poll for result — labyrinth solving can take many iterations
    // Each iteration has a 10ms sleep, 5000 iterations max = ~50 seconds worst case
    for (let i = 0; i < 600; i++) {
        const data = ns.read(resultFile);
        if (data && data !== "<pending>") {
            ns.print(`Labyrinth result for ${hostname}: ${data}`);
            return data === "SUCCESS";
        }
        await ns.sleep(100);
    }

    ns.print(`WARNING: Labyrinth solver timed out for ${hostname}`);
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
            try {
                ns.dnet.connectToSession(hostname, password ?? "");
            } catch {}
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

        // The probe script needs ~3.0 GB base RAM to run
        const PROBE_RAM_COST = 3.0;

        // If target is tight on RAM, try freeing blocked RAM remotely
        if (targetFreeRam < PROBE_RAM_COST && targetMaxRam >= 4) {
            try {
                const blockedRam = await runGetBlockedRam(ns, hostname);
                if (blockedRam > 0) {
                    // memoryReallocation with hostname arg frees RAM on the connected target
                    await runMemoryReallocation(ns, hostname);
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
        const scpResult = await nsScpWithSession(
            ns,
            scriptName,
            hostname,
            password,
        );
        if (scpResult === null) {
            ns.print(`WARN: Failed to scp ${scriptName} to ${hostname}`);
            return false;
        }

        // Step 6: Copy the password file to target so the new probe has known passwords
        const PASSWORD_FILE_PATH = "/data/darknet-passwords.txt";
        try {
            await nsScpWithSession(ns, PASSWORD_FILE_PATH, hostname, password);
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

async function freeBlockedRam(ns) {
    try {
        const result = await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.mem),
        );
        if (result && result.freedRam > 0) {
            ns.print(`Freed ${result.freedRam}GB RAM`);
        }
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

async function runOptionalActions(ns, optionsFile, hostname) {
    const options = loadProbeOptions(ns, optionsFile);
    // phishingAttack and promoteStock temp scripts each cost 3.6GB (1.6 base + 2.0 dnet API)
    const expensiveOpCost = 3.6;
    const host = ns.getHostname();
    const freeRam =
        (await nsGetServerMaxRam(ns, host)) -
        (await nsGetServerUsedRam(ns, host));
    if (options.enablePhishing && freeRam >= expensiveOpCost) {
        await runPhishing(ns, hostname);
    }
    if (
        options.enableStockManipulation &&
        options.targetStock &&
        freeRam >= expensiveOpCost
    ) {
        await runStockBoost(ns, options.targetStock);
    }
}

function loadProbeOptions(ns, filePath) {
    const defaults = {
        enablePhishing: false,
        enableStockManipulation: false,
        enableStasis: true,
        enableMigration: false,
        targetStock: "",
    };
    try {
        const data = ns.read(filePath);
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

// ===== STASIS LINK MANAGEMENT =====
// Probes manage stasis links locally since the orchestrator on home
// can only exec on darkweb/stasis-linked servers. Probes ARE on adjacent servers.

const AIR_GAP_DEPTH = 8;
const STASIS_RECHECK_INTERVAL = 120000; // Re-evaluate stasis every 2 minutes
let lastStasisCheck = 0;

async function manageStasis(ns, optionsFile, hostname, passwords) {
    const options = loadProbeOptions(ns, optionsFile);
    if (!options.enableStasis) return;

    // Throttle stasis checks — expensive operations
    if (Date.now() - lastStasisCheck < STASIS_RECHECK_INTERVAL) return;
    lastStasisCheck = Date.now();

    try {
        // Get current stasis state (these are 0 GB cost calls)
        const stasisLimit = await runGetStasisLimit(ns);
        if (stasisLimit <= 0) return; // No stasis slots available

        const stasisList = await runGetStasisList(ns);
        const currentStasisSet = new Set(stasisList || []);

        // If this server is already stasis-linked, nothing to do
        if (currentStasisSet.has(hostname)) return;

        // Score this server for stasis worthiness
        const myScore = await scoreServerForStasis(ns, hostname);
        if (myScore <= 0) return; // Not worth stasis-linking

        if (currentStasisSet.size < stasisLimit) {
            // Free slot available — set stasis on this server
            ns.print(
                `Stasis: slot available (${currentStasisSet.size}/${stasisLimit}), setting stasis on ${hostname} (score: ${myScore})`,
            );
            await execStasisBootstrap(ns, hostname, true);
        } else {
            // All slots full — check if we should replace the weakest
            let weakestHost = null;
            let weakestScore = Infinity;
            for (const stasisHost of currentStasisSet) {
                const score = await scoreServerForStasis(ns, stasisHost);
                if (score < weakestScore) {
                    weakestScore = score;
                    weakestHost = stasisHost;
                }
            }

            // Only replace if our score beats the weakest by a significant margin (20%+)
            if (weakestHost && myScore > weakestScore * 1.2) {
                ns.print(
                    `Stasis: replacing ${weakestHost} (score: ${weakestScore}) with ${hostname} (score: ${myScore})`,
                );
                // We can only remove stasis on servers we're ON — write a request for the
                // probe on the weak server to handle removal, OR ask orchestrator.
                // For now: if the weak server is adjacent, we remove it via its probe.
                // The simplest approach: just set stasis on ourselves. The game may
                // auto-evict the weakest when over limit, or the orchestrator handles cleanup.
                // Per API: setStasisLink only works on current server. So we set stasis here
                // and rely on the orchestrator to remove the weakest if needed.
                await execStasisBootstrap(ns, hostname, true);
            }
        }
    } catch (err) {
        logError(ns, `Stasis management error`, err);
    }
}

async function scoreServerForStasis(ns, hostname) {
    let score = 0;

    // Get server depth (0 GB cost)
    let depth;
    try {
        depth = await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.depth, commandArgs.singleArg),
            [hostname],
        );
    } catch {}

    if (depth !== undefined && depth !== null && typeof depth === "number") {
        const posInGap = depth % AIR_GAP_DEPTH;
        // Critical: servers just before air gaps are migration staging points
        if (posInGap === AIR_GAP_DEPTH - 2 || posInGap === AIR_GAP_DEPTH - 1) {
            score += 80;
        } else if (posInGap === 0 || posInGap === 1) {
            // Just after an air gap — useful anchor
            score += 30;
        }

        // Penalize shallow servers (game auto-maintains density there)
        if (depth <= 3) {
            score -= 50;
        }

        // Deeper = harder to reach = stasis more valuable
        score += Math.min(depth * 2, 30);
    }

    // RAM is the DOMINANT factor — user wants high-RAM servers for daemon.js hacking
    try {
        const serverRam = await nsGetServerMaxRam(ns, hostname);
        // Strong RAM bonus: 1 point per 8GB, up to 200 points for 1.6TB
        score += Math.min(Math.floor(serverRam / 8), 200);
    } catch {}

    return score;
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
async function execStasisBootstrap(ns, hostname, enable) {
    const host = ns.getHostname();
    const STASIS_SCRIPT_RAM = 13.6; // 1.6 base + 12.0 setStasisLink
    const PROBE_RAM_COST = 3.0;

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
    } else if (maxRam >= STASIS_SCRIPT_RAM + PROBE_RAM_COST) {
        // Not enough free RAM with probe running, but enough if we kill probe first.
        // Write bootstrap that: sets stasis, then re-launches probe.
        const probeScript = "Remote/darknet-probe.js";
        const script = [
            `export async function main(ns){`,
            `try{await ns.dnet.setStasisLink(${stasisArg});}catch(e){ns.print('ERROR: '+e);}`,
            `try{await ns.sleep(100);`,
            `ns.exec('${probeScript}',ns.getHostname(),1,${PROBE_VERSION});}catch(e){}`,
            `};`,
        ].join("");
        ns.write(scriptName, script, "w");

        // Kill ourselves, free RAM, launch bootstrap
        // But wait — we can't kill ourselves. We write the script,
        // free blocked RAM, and exec it. If it fits in remaining RAM, great.
        // If not, we need to accept we can't do stasis on this tight server.
        const blockedRam = await runGetBlockedRam(ns, host);
        if (freeRam + blockedRam >= STASIS_SCRIPT_RAM) {
            // Free blocked RAM first to make room
            await freeBlockedRam(ns);
            const updatedFree = maxRam - (await nsGetServerUsedRam(ns, host));
            if (updatedFree >= STASIS_SCRIPT_RAM) {
                const pid = ns.exec(scriptName, host, 1);
                if (pid > 0) {
                    for (let w = 0; w < 60; w++) {
                        await ns.sleep(50);
                        const running = await nsPs(ns, host);
                        if (!running.some((p) => p.pid === pid)) break;
                    }
                    ns.print(
                        `Stasis ${enable ? "set" : "removed"} on ${hostname} (after freeing RAM)`,
                    );
                }
            } else {
                ns.print(
                    `WARN: ${hostname} has ${updatedFree.toFixed(1)}GB free after clearing blocked, need ${STASIS_SCRIPT_RAM}GB for stasis`,
                );
            }
        } else {
            ns.print(
                `WARN: ${hostname} too tight for stasis (${freeRam.toFixed(1)}GB free + ${blockedRam.toFixed(1)}GB blocked < ${STASIS_SCRIPT_RAM}GB needed)`,
            );
        }
    } else {
        ns.print(
            `WARN: ${hostname} maxRam ${maxRam}GB too small for stasis (need ${STASIS_SCRIPT_RAM + PROBE_RAM_COST}GB)`,
        );
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

async function runGetBlockedRam(ns, hostname) {
    try {
        const result = await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.blockedRam, commandArgs.singleArg),
            [hostname],
        );
        return typeof result === "number" ? result : 0;
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

async function attemptMigrationCharging(ns, optionsFile, hostname) {
    const options = loadProbeOptions(ns, optionsFile);
    if (!options.enableMigration) return;

    // Throttle migration checks
    if (Date.now() - lastMigrationCheck < MIGRATION_RECHECK_INTERVAL) return;
    lastMigrationCheck = Date.now();

    // Migration charging cost: 1.6 base + 4.0 API = 5.6 GB via temp script
    const MIGRATION_COST = 5.6;
    const host = ns.getHostname();
    const freeRam =
        (await nsGetServerMaxRam(ns, host)) -
        (await nsGetServerUsedRam(ns, host));
    if (freeRam < MIGRATION_COST) return;

    try {
        // Scan for adjacent servers that could benefit from migration
        const nearbyServers = (await runScan(ns)) || [];
        for (const target of nearbyServers) {
            if (target === hostname || target === host) continue; // Can't migrate self

            // Check if target is online and connected
            const details = await getAuthDetails(ns, target);
            if (
                !details ||
                !details.isOnline ||
                !details.isConnectedToCurrentServer
            )
                continue;

            // Get target depth — migration is useful for deep servers near air gaps
            let depth;
            try {
                depth = await runDnetCommand(
                    ns,
                    buildDnetCommand(commandNames.depth, commandArgs.singleArg),
                    [target],
                );
            } catch {}

            if (
                depth === undefined ||
                depth === null ||
                typeof depth !== "number"
            )
                continue;

            // Only migrate servers near air gap boundaries (depths 6,7,14,15,22,23,...)
            const posInGap = depth % AIR_GAP_DEPTH;
            if (
                posInGap !== AIR_GAP_DEPTH - 2 &&
                posInGap !== AIR_GAP_DEPTH - 1
            )
                continue;

            // Re-check free RAM (operations above used some)
            const currentFree =
                (await nsGetServerMaxRam(ns, host)) -
                (await nsGetServerUsedRam(ns, host));
            if (currentFree < MIGRATION_COST) break;

            try {
                const result = await runDnetCommand(
                    ns,
                    buildDnetCommand(
                        commandNames.migrate,
                        commandArgs.singleArg,
                    ),
                    [target],
                );
                if (result) {
                    ns.print(
                        `Migration charged on ${target} (depth: ${depth})`,
                    );
                }
            } catch {}
        }
    } catch (err) {
        logError(ns, `Migration charging error`, err);
    }
}
async function scanClueFiles(ns, hostname, passwords, passwordFile) {
    try {
        const dataFiles = await nsLs(ns, hostname, ".data.txt");
        if (!dataFiles.length) return;

        for (const file of dataFiles) {
            try {
                const content = ns.read(file);
                if (!content) continue;
                const parsed = parseDarknetLogs(content);
                const lines = String(content).split(/\r?\n/);
                for (const line of lines) {
                    const fullMatch = line.match(
                        /host(?:name)?[:\s]+([^\s,]+)[,\s]+password[:\s]+['\"]?([^'"}\s,]+)/i,
                    );
                    if (fullMatch) {
                        passwords.set(fullMatch[1], fullMatch[2]);
                    }
                }
                for (const pwd of parsed.passwords) {
                    if (!pwd) continue;
                    if (!passwords.has(hostname)) passwords.set(hostname, pwd);
                }
                savePasswords(ns, passwordFile, passwords);
            } catch {}
        }
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

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (candidate.length > maxLen) continue;
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

    if (length <= 7) {
        const result = await solvePermutationByAuth(
            ns,
            hostname,
            sorted.split(""),
            10000,
        );
        return result;
    }

    const attempts = 2500;
    let bestCandidate = shuffleString(sorted);
    let bestScore = Infinity;
    let stagnation = 0;
    let feedbackMisses = 0;

    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, rmsd: 0 };
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const rmsd = getRmsdFeedbackFromLogs(bleed.logs, guess);
            if (Number.isFinite(rmsd)) return { success: false, rmsd };
        }
        return null;
    }

    for (let i = 0; i < attempts; i++) {
        const fb = await authWithFeedback(bestCandidate);
        if (fb?.success) return bestCandidate;
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (!fb) {
            feedbackMisses++;
            if (feedbackMisses > 4) return null;
            continue;
        }
        const rmsd = fb.rmsd;
        if (rmsd < bestScore) {
            bestScore = rmsd;
            stagnation = 0;
        } else {
            stagnation++;
        }
        const next = mutateSwap(bestCandidate);
        const nextFb = await authWithFeedback(next);
        if (nextFb?.success) return next;
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (!nextFb) {
            feedbackMisses++;
            if (feedbackMisses > 4) return null;
            continue;
        }
        const nextRmsd = nextFb.rmsd;
        if (nextRmsd <= bestScore) {
            bestCandidate = next;
            bestScore = nextRmsd;
        }
        if (stagnation > 50) {
            bestCandidate = shuffleString(sorted);
            stagnation = 0;
        }
    }
    return null;
}

async function solveMastermind(ns, hostname, serverInfo) {
    resetCrackedCheck(hostname);
    const length = getPasswordLength(serverInfo, 4);
    // Default to full alphanumeric if format is unknown — the offline fallback
    // from getServerAuthDetails returns passwordFormat: "numeric" even for
    // alphanumeric passwords. Using the wider charset is always safe (slower
    // but correct), while the narrow charset causes permanent failures.
    const charset =
        getCharsetForFormat(serverInfo?.passwordFormat) || defaultCharset();
    const constraints = [];
    const counts = new Map();

    // Helper: make an auth attempt and retrieve Mastermind feedback via heartbleed.
    // The authenticate() API does NOT return the exact/misplaced data for non-labyrinth
    // models — it only returns {success, code, message:"Unauthorized"}.
    // We must read the server logs via heartbleed to get the actual feedback.
    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, exact: length, misplaced: 0 };
        // Read recent server logs to find our guess's feedback
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const fb = getMastermindFeedbackFromLogs(bleed.logs, guess);
            if (fb) return { success: false, ...fb };
        }
        return null; // Could not retrieve feedback
    }

    // Phase 1: Character counting — try each char repeated to determine how many
    // of each character appear in the password.
    let feedbackMisses = 0;
    for (const ch of charset) {
        const probe = ch.repeat(length);
        const fb = await authWithFeedback(probe);
        if (fb?.success) return probe;
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (fb) {
            counts.set(ch, fb.exact + fb.misplaced);
            constraints.push({
                guess: probe,
                exact: fb.exact,
                misplaced: fb.misplaced,
            });
        } else {
            feedbackMisses++;
            // If heartbleed consistently fails, we can't solve this interactively
            if (feedbackMisses > 5) {
                return await bruteMastermind(
                    ns,
                    hostname,
                    charset,
                    length,
                    constraints,
                );
            }
        }
    }

    const multiset = [];
    for (const [ch, count] of counts.entries()) {
        for (let i = 0; i < count; i++) multiset.push(ch);
    }

    if (multiset.length !== length || multiset.length === 0) {
        return await bruteMastermind(
            ns,
            hostname,
            charset,
            length,
            constraints,
        );
    }

    const tries = { count: 0, limit: 6000 };
    const checkCandidate = async (candidate) => {
        for (const c of constraints) {
            const feedback = compareMastermind(candidate, c.guess);
            if (
                feedback.exact !== c.exact ||
                feedback.misplaced !== c.misplaced
            )
                return false;
        }
        const fb = await authWithFeedback(candidate);
        if (fb?.success) return candidate;
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (fb)
            constraints.push({
                guess: candidate,
                exact: fb.exact,
                misplaced: fb.misplaced,
            });
        return false;
    };

    return await permuteWithConstraints(multiset, tries, checkCandidate);
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
    const length = getPasswordLength(serverInfo, 6);
    const maxValue = Math.pow(10, length) - 1;
    const primes = generatePrimes(Math.min(997, maxValue));
    let product = 1n;
    for (const prime of primes) {
        const primeValue = BigInt(prime);
        const divisible = await isDivisibleBy(ns, hostname, primeValue);
        if (!divisible) continue;
        let power = primeValue;
        while (true) {
            const nextPower = power * primeValue;
            const divisiblePower = await isDivisibleBy(ns, hostname, nextPower);
            if (!divisiblePower) break;
            power = nextPower;
        }
        let temp = power;
        while (temp > 1n) {
            product *= primeValue;
            temp /= primeValue;
        }
        if (await isAlreadyCracked(ns, hostname)) return null;
    }
    if (product <= 1n) return null;
    const candidate = product.toString();
    const result = await runAuth(ns, hostname, candidate);
    return result.success ? candidate : null;
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

    const host = serverInfo?.currentHost || hostname;
    const maxRam = await nsGetServerMaxRam(ns, host);
    const usedRam = await nsGetServerUsedRam(ns, host);
    const freeRam = Math.max(0, maxRam - usedRam);
    const capturedCandidates = new Set();

    const expectedLength = serverInfo?.passwordLength;
    const format = serverInfo?.passwordFormat;

    if (freeRam >= 6) {
        for (let attempt = 0; attempt < 20; attempt++) {
            const traffic = await runCapture(ns, hostname);
            const text = String(traffic ?? "");
            if (!text) continue;
            const matches = text.matchAll(/(\S+):(\S+)/g);
            for (const match of matches) {
                const capturedHost = match[1];
                const capturedPassword = match[2];
                if (!capturedHost || !capturedPassword) continue;
                if (capturedHost === hostname) {
                    const result = await runAuth(
                        ns,
                        hostname,
                        capturedPassword,
                    );
                    if (result.success) return capturedPassword;
                    if (await isAlreadyCracked(ns, hostname)) return null;
                } else {
                    capturedCandidates.add(capturedPassword);
                }
            }
        }
        for (const candidate of capturedCandidates) {
            if (!candidate) continue;
            if (expectedLength && candidate.length !== expectedLength) continue;
            if (format === "numeric" && !/^\d+$/.test(candidate)) continue;
            if (format === "alphabetic" && !/^[a-zA-Z]+$/.test(candidate))
                continue;
            if (format === "alphanumeric" && !/^[a-zA-Z0-9]+$/.test(candidate))
                continue;
            const result = await runAuth(ns, hostname, candidate);
            if (result.success) return candidate;
            if (await isAlreadyCracked(ns, hostname)) return null;
        }
        return null;
    }

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
    const domainHigh = Math.pow(10, length) - 1;
    const width = Math.pow(10, Math.max(length - 2, 0)) + 1;
    const step = Math.max(1, Math.floor(3 * width));
    const cache = new Map();
    let feedbackMisses = 0;

    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, altitude: Infinity };
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const altitude = getAltitudeFeedbackFromLogs(bleed.logs, guess);
            if (Number.isFinite(altitude)) return { success: false, altitude };
        }
        return null;
    }

    const altitudeAt = async (x) => {
        if (cache.has(x)) return cache.get(x);
        const value = await authWithFeedback(String(x));
        if (!value) {
            feedbackMisses++;
            if (feedbackMisses > 4) return null;
            return null;
        }
        cache.set(x, value);
        return value;
    };

    // Phase 1: Coarse scan across entire domain
    let bestX = 0;
    let bestA = -Infinity;
    for (let x = 0; x <= domainHigh; x += step) {
        const result = await altitudeAt(x);
        if (!result) return null;
        if (result.success) return String(x);
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (result.altitude > bestA) {
            bestA = result.altitude;
            bestX = x;
        }
    }

    // Phase 2: Ternary search in local window around best coarse point
    let low = Math.max(0, bestX - 3 * step);
    let high = Math.min(domainHigh, bestX + 3 * step);

    while (high - low > 20) {
        const m1 = Math.floor(low + (high - low) / 3);
        const m2 = Math.floor(high - (high - low) / 3);
        const a1 = await altitudeAt(m1);
        if (!a1) return null;
        if (a1.success) return String(m1);
        if (await isAlreadyCracked(ns, hostname)) return null;
        const a2 = await altitudeAt(m2);
        if (!a2) return null;
        if (a2.success) return String(m2);
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (a1.altitude < a2.altitude) low = m1 + 1;
        else high = m2 - 1;
    }

    // Phase 3: Linear scan of final candidates
    bestX = low;
    bestA = -Infinity;
    for (let x = low; x <= high; x++) {
        const result = await altitudeAt(x);
        if (!result) return null;
        if (result.success) return String(x);
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (result.altitude > bestA) {
            bestA = result.altitude;
            bestX = x;
        }
    }

    // Final attempt with best candidate
    const finalResp = await runAuth(ns, hostname, String(bestX));
    return finalResp.success ? String(bestX) : null;
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

    let guess = charset[0].repeat(length);
    const baseFeedback = await authWithFeedback(guess);
    if (baseFeedback?.success) return guess;
    if (!baseFeedback) {
        feedbackMisses++;
        if (feedbackMisses > 4) return null;
        return null;
    }
    let currentCount = baseFeedback.count;
    if (!Number.isFinite(currentCount)) return null;

    for (let i = 0; i < length; i++) {
        let found = false;
        for (const ch of charset) {
            if (ch === guess[i]) continue; // skip current char
            const trial = guess.substring(0, i) + ch + guess.substring(i + 1);
            const fb = await authWithFeedback(trial);
            if (fb?.success) return trial;
            if (await isAlreadyCracked(ns, hostname)) return null;
            if (!fb) {
                feedbackMisses++;
                if (feedbackMisses > 4) return null;
                continue;
            }
            if (Number.isFinite(fb.count) && fb.count > currentCount) {
                // This char increased the pepper count — it's correct for this position
                guess = guess.substring(0, i) + ch + guess.substring(i + 1);
                currentCount = fb.count;
                found = true;
                break;
            }
        }
        // If no char improved count, the initial char was already correct
        if (!found) currentCount = currentCount; // no-op, position was already right
    }

    const finalResp = await authWithFeedback(guess);
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

async function solveTopPass(ns, hostname) {
    return await tryDictionary(ns, hostname, commonPasswordDictionary);
}

async function solveEuroZone(ns, hostname) {
    return await tryDictionary(ns, hostname, euCountries);
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
                prefix += ch;
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
    const max = BigInt(Math.pow(10, length) - 1);
    const moduli = [31, 29, 27, 25, 23];
    const residues = [];
    let feedbackMisses = 0;

    async function authWithFeedback(guess) {
        const resp = await runAuth(ns, hostname, guess);
        if (resp.success) return { success: true, result: null };
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const result = getModuloResultFeedbackFromLogs(bleed.logs, guess);
            if (Number.isFinite(result)) return { success: false, result };
        }
        return null;
    }
    for (const mod of moduli) {
        const n = nextAlignedGreater(max, mod);
        const fb = await authWithFeedback(n.toString());
        if (fb?.success) return n.toString();
        if (await isAlreadyCracked(ns, hostname)) return null;
        if (!fb) {
            feedbackMisses++;
            if (feedbackMisses > 4) return null;
            return null;
        }
        const result = fb.result;
        if (!Number.isFinite(result)) return null;
        residues.push(BigInt(result));
    }
    const modulus = moduli.reduce((acc, m) => acc * BigInt(m), 1n);
    let candidate = crt(
        residues,
        moduli.map((m) => BigInt(m)),
    );
    if (candidate < 0n) candidate = ((candidate % modulus) + modulus) % modulus;
    while (candidate > max) candidate -= modulus;
    for (let k = 0n; candidate + k * modulus <= max; k++) {
        const trial = candidate + k * modulus;
        const result = await runAuth(ns, hostname, trial.toString());
        if (result.success) return trial.toString();
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

function parseMastermindData(resp) {
    const data = String(resp?.data ?? resp?.message ?? "");
    const match = data.match(/(\d+)\s*,\s*(\d+)/);
    if (!match) return null;
    return { exact: Number(match[1]), misplaced: Number(match[2]) };
}

function compareMastermind(candidate, guess) {
    let exact = 0;
    const remainingCandidate = [];
    const remainingGuess = [];
    for (let i = 0; i < candidate.length; i++) {
        if (candidate[i] === guess[i]) exact++;
        else {
            remainingCandidate.push(candidate[i]);
            remainingGuess.push(guess[i]);
        }
    }
    const counts = new Map();
    for (const ch of remainingCandidate)
        counts.set(ch, (counts.get(ch) || 0) + 1);
    let misplaced = 0;
    for (const ch of remainingGuess) {
        const count = counts.get(ch) || 0;
        if (count > 0) {
            misplaced++;
            counts.set(ch, count - 1);
        }
    }
    return { exact, misplaced };
}

async function bruteMastermind(ns, hostname, charset, length, constraints) {
    resetCrackedCheck(hostname);
    const total = Math.pow(charset.length, length);
    if (!Number.isFinite(total) || total > 300000) return null;
    for (let i = 0; i < total; i++) {
        const candidate = buildCandidate(i, charset, length);
        let ok = true;
        for (const c of constraints) {
            const feedback = compareMastermind(candidate, c.guess);
            if (
                feedback.exact !== c.exact ||
                feedback.misplaced !== c.misplaced
            ) {
                ok = false;
                break;
            }
        }
        if (!ok) continue;
        const resp = await runAuth(ns, hostname, candidate);
        if (resp.success) return candidate;
        if (await isAlreadyCracked(ns, hostname)) return null;
        // Try to get feedback from heartbleed for constraint tightening
        const bleed = await runHeartbleedMulti(ns, hostname, 5);
        if (bleed?.logs) {
            const feedback = getMastermindFeedbackFromLogs(
                bleed.logs,
                candidate,
            );
            if (feedback)
                constraints.push({
                    guess: candidate,
                    exact: feedback.exact,
                    misplaced: feedback.misplaced,
                });
        }
    }
    return null;
}

async function permuteWithConstraints(multiset, tries, checkCandidate) {
    const counts = new Map();
    for (const d of multiset) counts.set(d, (counts.get(d) || 0) + 1);
    const keys = Array.from(counts.keys());
    const targetLen = multiset.length;
    const buffer = new Array(targetLen);

    const backtrack = async (idx) => {
        if (tries.count >= tries.limit) return null;
        if (idx === targetLen) {
            tries.count++;
            const candidate = buffer.join("");
            const match = await checkCandidate(candidate);
            return match || null;
        }
        for (const key of keys) {
            const count = counts.get(key);
            if (!count) continue;
            counts.set(key, count - 1);
            buffer[idx] = key;
            const result = await backtrack(idx + 1);
            if (result) return result;
            counts.set(key, count);
        }
        return null;
    };

    return await backtrack(0);
}

async function solvePermutationByAuth(ns, hostname, digits, limit) {
    resetCrackedCheck(hostname);
    let attempts = 0;
    let found = null;
    await permuteDigits(digits, async (candidate) => {
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

function shuffleString(value) {
    const chars = value.split("");
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
}

function mutateSwap(value) {
    if (value.length < 2) return value;
    const chars = value.split("");
    const i = Math.floor(Math.random() * chars.length);
    let j = Math.floor(Math.random() * chars.length);
    if (i === j) j = (j + 1) % chars.length;
    [chars[i], chars[j]] = [chars[j], chars[i]];
    return chars.join("");
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
    if (cleaned.includes("ns.exit(),"))
        cleaned = cleaned.split("ns.exit(),")[0];
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

function generatePrimes(limit) {
    const sieve = new Array(limit + 1).fill(true);
    sieve[0] = false;
    sieve[1] = false;
    for (let i = 2; i * i <= limit; i++) {
        if (!sieve[i]) continue;
        for (let j = i * i; j <= limit; j += i) sieve[j] = false;
    }
    const primes = [];
    for (let i = 2; i <= limit; i++) if (sieve[i]) primes.push(i);
    return primes;
}

async function isDivisibleBy(ns, hostname, divisor) {
    const resp = await runAuth(ns, hostname, divisor.toString());
    if (resp.success) return true;
    const bleed = await runHeartbleedMulti(ns, hostname, 5);
    if (bleed?.logs) {
        const fb = getDivisibilityFeedbackFromLogs(
            bleed.logs,
            divisor.toString(),
        );
        if (fb !== null) return fb;
    }
    const data = String(resp?.data ?? "").toLowerCase();
    if (data === "true") return true;
    if (data === "false") return false;
    const msg = String(resp?.message ?? "").toLowerCase();
    if (msg.includes("is divisible")) return true;
    if (msg.includes("not divisible")) return false;
    return false;
}

function parseModuloResult(resp) {
    const data = resp?.data ?? resp?.message ?? "";
    const match = String(data).match(/(-?\d+)/);
    return match ? Number(match[1]) : NaN;
}

function nextAlignedGreater(max, mod) {
    const maxMod = Number(max % 32n);
    let delta = (mod - maxMod + 32) % 32;
    if (delta === 0) delta = 32;
    return max + BigInt(delta);
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

function parseDarknetLogs(logs) {
    const passwords = [];
    const hints = [];
    const entries = Array.isArray(logs)
        ? logs
        : String(logs || "").split(/\r?\n/);
    for (const log of entries) {
        const line = String(log || "");
        const pwdMatch = line.match(/password[:\s]+['\"]?([^'"}\s]+)/i);
        if (pwdMatch) passwords.push(pwdMatch[1]);
        const authMatch = line.match(
            /auth(?:enticate)?[:\s]+['\"]?([^'"}\s]+)/i,
        );
        if (authMatch) passwords.push(authMatch[1]);
        const hintMatch = line.match(/hint[:\s]+(.+)/i);
        if (hintMatch) hints.push(hintMatch[1].trim());
    }
    return { passwords, hints };
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
    details: ["get", "Server", "Auth", "Details"].join(""),
    capture: ["packet", "Capture"].join(""),
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
const COMMAND_COUNTER_WRAP = 1000;

function buildDnetCommand(name, args = "") {
    return `${dnetPrefix}${name}(${args})`;
}

function buildNsCommand(name, args = "") {
    return `${nsPrefix}${name}(${args})`;
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
async function runDnetCommand(ns, command, args = []) {
    const id = commandCounter++ % COMMAND_COUNTER_WRAP;
    const host = ns.getHostname();
    const resultFile = `/Temp/dnet-task-${id}.txt`;
    const scriptFile = `/Temp/dnet-task-${id}.js`;
    const script =
        `export async function main(ns){let r;try{const v=await (${command});` +
        `const w=v===undefined?{$type:'undefined'}:v===null?{$type:'null'}:v;` +
        `r=JSON.stringify({$type:'result',$value:w});}catch(e){r="ERROR: "+(typeof e==='string'?e:e?.message??JSON.stringify(e));}` +
        `const f="${resultFile}";ns.write(f,r,'w');}`;
    // NOTE: ns.rm removed from temp script to save 1.0GB RAM per invocation.
    // Script files are overwritten on reuse (counter wraps at 100000).
    ns.write(scriptFile, script, "w");
    ns.write(resultFile, "<pending>", "w");
    const pid = ns.exec(scriptFile, host, 1, ...args);
    if (!pid) return null;
    for (let i = 0; i < 50; i++) {
        const data = ns.read(resultFile);
        if (data && data !== "<pending>") {
            return decodePayload(data);
        }
        await ns.sleep(10);
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
    const scriptFile = `/Temp/dnet-task-${id}.js`;
    const pwd = (password ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const script =
        `export async function main(ns){let r;try{` +
        `${dnetPrefix}${commandNames.link}(${nsPrefix}args[1],'${pwd}');` +
        `const v=await (${nsPrefix}${commandNames.copyFile}(${nsPrefix}args[0],${nsPrefix}args[1]));` +
        `const w=v===undefined?{$type:'undefined'}:v===null?{$type:'null'}:v;` +
        `r=JSON.stringify({$type:'result',$value:w});}catch(e){r="ERROR: "+(typeof e==='string'?e:e?.message??JSON.stringify(e));}` +
        `const f="${resultFile}";ns.write(f,r,'w');}`;
    ns.write(scriptFile, script, "w");
    ns.write(resultFile, "<pending>", "w");
    const pid = ns.exec(scriptFile, host, 1, source, destination);
    if (!pid) return null;
    for (let i = 0; i < 50; i++) {
        const data = ns.read(resultFile);
        if (data && data !== "<pending>") {
            return decodePayload(data);
        }
        await ns.sleep(10);
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

async function nsGetServerMaxRam(ns, hostname) {
    return (
        (await runDnetCommand(
            ns,
            buildNsCommand(commandNames.getMaxRam, commandArgs.singleArg),
            [hostname],
        )) || 0
    );
}

async function nsGetServerUsedRam(ns, hostname) {
    return (
        (await runDnetCommand(
            ns,
            buildNsCommand(commandNames.getUsedRam, commandArgs.singleArg),
            [hostname],
        )) || 0
    );
}

// nsGetScriptName removed — hardcoded script name used instead

async function runAuth(ns, hostname, password) {
    try {
        const result = await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.auth, commandArgs.pairArg),
            [hostname, password],
        );
        if (result && typeof result === "object" && "success" in result)
            return result;
    } catch {}
    return { success: false, message: "error", code: 0, data: null };
}

async function runScan(ns) {
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
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.details, commandArgs.singleArg),
            [hostname],
        );
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
async function isAlreadyCracked(ns, hostname) {
    const count = (_crackedCheckCounters.get(hostname) || 0) + 1;
    _crackedCheckCounters.set(hostname, count);
    if (count % _CRACKED_CHECK_INTERVAL !== 0) return false;
    try {
        const details = await getAuthDetails(ns, hostname);
        return details?.hasAdminRights === true;
    } catch {
        return false;
    }
}

/** Reset the cracked-check counter for a hostname (call at start of each solver). */
function resetCrackedCheck(hostname) {
    _crackedCheckCounters.delete(hostname);
}

async function runCapture(ns, hostname) {
    try {
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.capture, commandArgs.singleArg),
            [hostname],
        );
    } catch {}
    return null;
}

async function runHeartbleed(ns, hostname) {
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
    try {
        // Build custom heartbleed command with multi-log capture and peek
        const args = `${nsPrefix}args[0], { peek: true, logsToCapture: ${logsToCapture} }`;
        return await runDnetCommand(
            ns,
            buildDnetCommand(commandNames.bleed, args),
            [hostname],
        );
    } catch {}
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

async function runDepth(ns, hostname) {
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
