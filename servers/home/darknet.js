import {
    log,
    getFilePath,
    getConfiguration,
    disableLogs,
    formatRam,
    getErrorInfo,
} from "./helpers.js";
import {
    getDarknetPasswordSolver,
    tryFormatBruteforce,
    parseDarknetLogs,
    estimateCrackDifficulty,
} from "./darknet-helpers.js";

/**
 * Darknet Orchestrator for BitNode 15
 *
 * Main controller that manages darknet exploration, server authentication,
 * probe deployment, stasis links, migration charging (air gap crossing),
 * and clue file scanning. Works standalone in BN15 and integrates with
 * daemon.js for other bitnodes.
 *
 * Key mechanics handled:
 * - Network is a 40×8 grid with air gaps every 8 rows
 * - Stasis links MUST be set from the target server (exec temp script)
 * - Migration charging moves servers across air gaps
 * - Clue files (.data.txt) on cracked servers contain passwords/hints
 * - Backdoor penalty: 1.07^surplus applied to ALL auth times
 * - Network mutates: servers move, restart, get deleted, new ones added
 */

const argsSchema = [
    ["interval", 5000], // Main loop interval in ms
    ["max-probes", 10], // Maximum number of probe scripts running simultaneously
    ["enable-phishing", true], // Enable phishing attacks for money/charisma
    ["enable-stock-manipulation", false], // Enable stock manipulation via promoteStock
    ["target-stock", ""], // Stock symbol to manipulate (if enabled)
    ["stasis-priority", ["high-ram", "high-value"]], // Priority for stasis link allocation
    ["verbose", false], // Extra logging
    ["dry-run", false], // Don't actually execute, just log what would be done
    ["enable-migration", true], // Enable migration charging to cross air gaps
    ["migration-charge-loops", 20], // Max charge loops per migration attempt per tick
    ["enable-clue-scanning", true], // Scan clue files on cracked servers
    ["easy-first", true], // Prioritize low-tier servers for authentication
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AIR_GAP_DEPTH = 8;
const DARKWEB_HOSTNAME = "darkweb";
const CLUE_FILE_SUFFIX = ".data.txt";
const PROBE_SCRIPT = "/Remote/darknet-probe.js";
const PASSWORD_FILE = "/data/darknet-passwords.txt";
const OPTIONS_FILE = "/data/darknet-options.txt";
const CLUE_CACHE_FILE = "/data/darknet-clues-scanned.txt";
const STASIS_HELPER_SCRIPT = "/Temp/darknet-stasis-helper.js";
const STASIS_HELPER_CONTENT = `/** @param {NS} ns */ export async function main(ns) { const enable = ns.args[0] === 'true'; await ns.dnet.setStasisLink(enable); }`;
const MUTATION_HELPER_SCRIPT = "/Temp/darknet-mutation-wait.js";
const MUTATION_HELPER_CONTENT = `/** @param {NS} ns */ export async function main(ns) { await ns.dnet.nextMutation(); ns.write('/Temp/mutation-done.txt', 'done', 'w'); ns.rm('${MUTATION_HELPER_SCRIPT}'); }`;
const RAMFREE_HELPER_SCRIPT = "/Temp/darknet-ramfree.js";
const RAMFREE_HELPER_CONTENT = `/** @param {NS} ns */ export async function main(ns) { while (ns.dnet.getBlockedRam() > 0) { await ns.dnet.memoryReallocation(); await ns.sleep(50); } ns.write('/Temp/ramfree-done.txt', 'done', 'w'); }`;
const RAMFREE_RESULT_FILE = "/Temp/ramfree-done.txt";
const LAB_SOLVER_SCRIPT = "/Temp/darknet-lab-solver.js";
const LAB_SOLVER_RESULT_PORT = 18; // Netscript port for labyrinth solver results
const LAB_NEIGHBOR_REPORT_PORT = 17; // Netscript port for probe-reported labyrinth neighbors
const STASIS_SWAP_REQUEST_PORT = 21; // Netscript port for probe stasis swap requests
const STASIS_PWD_PORT = 19; // Netscript port for probe-reported stasis server passwords

// Self-contained labyrinth solver script. Deployed to a stasis-linked neighbor of a
// labyrinth server. Uses DFS with backtracking. Position is per-PID so we must solve
// entirely within one exec. Args: [labHostname, resultPort]
const LAB_SOLVER_CONTENT = [
    `/** @param {NS} ns */ export async function main(ns) {`,
    `  const hostname = ns.args[0];`,
    `  const port = ns.args[1];`,
    `  const visited = new Set();`,
    `  const stack = [];`,
    `  const dirs = ["north", "south", "east", "west"];`,
    `  const delta = { north: [0,-2], south: [0,2], west: [-2,0], east: [2,0] };`,
    `  const rev = { north: "south", south: "north", west: "east", east: "west" };`,
    `  let pos = [1,1];`,
    `  for (let i = 0; i < 5000; i++) {`,
    `    let report;`,
    `    try { report = ns.dnet.labreport(); } catch { await ns.sleep(200); continue; }`,
    `    if (!report || !report.success) { await ns.sleep(200); continue; }`,
    `    pos = [report.coords[0], report.coords[1]];`,
    `    const key = pos[0] + "," + pos[1];`,
    `    visited.add(key);`,
    `    let moved = false;`,
    `    for (const d of dirs) {`,
    `      if (!report[d]) continue;`,
    `      const nk = (pos[0]+delta[d][0]) + "," + (pos[1]+delta[d][1]);`,
    `      if (visited.has(nk)) continue;`,
    `      const r = await ns.dnet.authenticate(hostname, "go " + d);`,
    `      if (r.success) {`,
    `        ns.writePort(port, JSON.stringify({ host: hostname, password: r.data ?? r.message }));`,
    `        return;`,
    `      }`,
    `      const mm = (r.message || "").match(/moved to (\\d+),(\\d+)/);`,
    `      if (mm) {`,
    `        stack.push({ pos: [...pos], dir: d });`,
    `        pos = [parseInt(mm[1],10), parseInt(mm[2],10)];`,
    `        moved = true;`,
    `        break;`,
    `      }`,
    `    }`,
    `    if (!moved) {`,
    `      if (stack.length === 0) { ns.writePort(port, JSON.stringify({ host: hostname, error: "stuck" })); return; }`,
    `      const back = stack.pop();`,
    `      const br = await ns.dnet.authenticate(hostname, "go " + rev[back.dir]);`,
    `      if (br.success) {`,
    `        ns.writePort(port, JSON.stringify({ host: hostname, password: br.data ?? br.message }));`,
    `        return;`,
    `      }`,
    `      const bm = (br.message || "").match(/moved to (\\d+),(\\d+)/);`,
    `      if (bm) { pos = [parseInt(bm[1],10), parseInt(bm[2],10)]; }`,
    `      else { ns.writePort(port, JSON.stringify({ host: hostname, error: "backtrack failed" })); return; }`,
    `    }`,
    `    await ns.sleep(50);`,
    `  }`,
    `  ns.writePort(port, JSON.stringify({ host: hostname, error: "max iterations" }));`,
    `}`,
].join("\n");
const PROBE_VERSION = 32;

/** Strip leading slash to match Bitburner's internal filename format (used by ns.ps()). */
function normalizeFilename(path) {
    return path.startsWith("/") ? path.substring(1) : path;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    disableLogs(ns, [
        "sleep",
        "scan",
        "getServerMaxRam",
        "getServerUsedRam",
        "scp",
        "exec",
        "kill",
        "ps",
        "rm",
        "read",
        "write",
        "ls",
    ]);

    // Check if darknet is available
    if (!ns.fileExists("DarkscapeNavigator.exe", "home")) {
        log(
            ns,
            "ERROR: DarkscapeNavigator.exe not found. Purchase it from the darkweb.",
            true,
            "error",
        );
        return;
    }

    const state = new DarknetState(ns, options);

    log(ns, "INFO: Darknet orchestrator v2 starting...", true, "info");

    // Main loop
    while (true) {
        try {
            writeProbeOptions(ns, options);
            await state.refresh(ns);
            await orchestrateDarknet(ns, state, options);
        } catch (err) {
            log(
                ns,
                `WARNING: Darknet orchestrator error: ${getErrorInfo(err)}`,
                false,
                "warning",
            );
        }
        await waitForMutation(ns, options.interval);
    }
}

/**
 * Wait for a darknet mutation event OR a timeout, whichever comes first.
 * Uses a temp script to call ns.dnet.nextMutation() (1.0GB) so the cost
 * doesn't inflate the orchestrator's static RAM analysis.
 */
async function waitForMutation(ns, interval) {
    const doneFile = "/Temp/mutation-done.txt";
    try {
        ns.write(MUTATION_HELPER_SCRIPT, MUTATION_HELPER_CONTENT, "w");
        ns.write(doneFile, "", "w");
        const pid = ns.exec(MUTATION_HELPER_SCRIPT, "home", 1);
        if (pid <= 0) {
            // Fallback to plain sleep if we can't spawn the helper
            await ns.sleep(interval);
            return;
        }
        // Poll for either the mutation helper finishing or timeout
        const deadline = Date.now() + interval;
        while (Date.now() < deadline) {
            const data = ns.read(doneFile);
            if (data === "done") {
                break;
            }
            // Check if helper died without writing
            const running = ns.ps("home").some((p) => p.pid === pid);
            if (!running) break;
            await ns.sleep(200);
        }
        // Kill helper if it's still running (timeout case)
        try {
            ns.kill(pid);
        } catch {}
        // Clean up temp files
        try {
            ns.rm(MUTATION_HELPER_SCRIPT);
        } catch {}
        try {
            ns.rm(doneFile);
        } catch {}
    } catch {
        await ns.sleep(interval);
    }
}

// ─── State Management ────────────────────────────────────────────────────────

/**
 * Centralized state for darknet operations. Persists passwords to disk.
 * Tracks discovered servers, active probes, stasis links, and scanned clues.
 */
class DarknetState {
    constructor(ns, options) {
        this.options = options;
        this.discoveredServers = new Map(); // hostname -> DarknetServerInfo
        this.knownPasswords = new Map(); // hostname -> password
        this.activeProbes = new Map(); // hostname -> { pid, version }
        this.stasisServers = new Set(); // hostnames with active stasis links
        this.zombieStasisServers = new Set(); // stasis servers we can't interact with (no password, no auth)
        this.scannedClueFiles = new Set(); // set of file paths already scanned
        this.pendingMigrations = new Map(); // hostname -> { charge, lastAttempt }
        this.authenticatedServers = new Set(); // servers confirmed to have admin
        this.labyrinthServers = new Set(); // hostnames with modelId === "(The Labyrinth)"
        this.labyrinthNeighbors = new Map(); // labHostname -> Set of authenticated neighbor hostnames
        this.activeLabSolvers = new Map(); // labHostname -> { pid, solverHost, deployedAt }
        this.probeAdjacency = new Map(); // discoveredHostname -> Set of probing source hostnames (rebuilt each tick)
        this.lastRefresh = 0;
        this.lastStatusLog = 0;
        this.lastStats = {
            discovered: 0,
            passwords: 0,
            probes: 0,
            stasis: 0,
            admin: 0,
            clues: 0,
        };
        this.lastAuthLog = new Map(); // hostname -> timestamp (throttle auth failure logs)
        this.cluePasswords = new Map(); // hostname -> password (from clue files)
        this.serverDepths = new Map(); // hostname -> estimated depth

        this.loadPasswords(ns);
        this.loadScannedClues(ns);
    }

    loadPasswords(ns) {
        try {
            const data = ns.read(PASSWORD_FILE);
            if (data) {
                const parsed = JSON.parse(data);
                for (const [host, pwd] of Object.entries(parsed)) {
                    this.knownPasswords.set(host, pwd);
                }
                log(
                    ns,
                    `INFO: Loaded ${this.knownPasswords.size} saved passwords`,
                );
            }
        } catch {
            // File doesn't exist or is invalid
        }
    }

    savePasswords(ns) {
        const data = JSON.stringify(Object.fromEntries(this.knownPasswords));
        ns.write(PASSWORD_FILE, data, "w");
    }

    loadScannedClues(ns) {
        try {
            const data = ns.read(CLUE_CACHE_FILE);
            if (data) {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) {
                    for (const path of parsed) this.scannedClueFiles.add(path);
                }
            }
        } catch {
            // Fresh start
        }
    }

    saveScannedClues(ns) {
        const data = JSON.stringify([...this.scannedClueFiles]);
        ns.write(CLUE_CACHE_FILE, data, "w");
    }

    async refresh(ns) {
        // Update stasis link info
        try {
            const stasisServers = ns.dnet.getStasisLinkedServers();
            this.stasisServers = new Set(stasisServers);
        } catch {
            // Stasis API may not be available
        }

        // Refresh active probes — check which are still running
        for (const [hostname, probeInfo] of this.activeProbes) {
            try {
                const procs = ns.ps(hostname);
                const probeScript = normalizeFilename(
                    getFilePath(PROBE_SCRIPT),
                );
                const alive = procs.some(
                    (p) =>
                        p.filename === probeScript && p.pid === probeInfo.pid,
                );
                if (!alive) {
                    this.activeProbes.delete(hostname);
                }
            } catch {
                this.activeProbes.delete(hostname);
            }
        }

        this.lastRefresh = Date.now();

        // Periodic pruning of ephemeral state to prevent unbounded growth
        this.pruneEphemeralState();
    }

    addPassword(ns, hostname, password) {
        this.knownPasswords.set(hostname, password);
        this.savePasswords(ns);
    }

    removePassword(ns, hostname) {
        if (this.knownPasswords.has(hostname)) {
            this.knownPasswords.delete(hostname);
            this.savePasswords(ns);
        }
    }

    getPassword(hostname) {
        return this.knownPasswords.get(hostname);
    }

    /**
     * Prune ephemeral state Maps to prevent unbounded memory growth.
     * Knowledge state (discoveredServers, cluePasswords, scannedClueFiles,
     * knownPasswords) is preserved. Only operational/transient state is pruned.
     */
    pruneEphemeralState() {
        const now = Date.now();

        // lastAuthLog: remove entries older than 5 minutes (only used for log throttling)
        for (const [hostname, timestamp] of this.lastAuthLog) {
            if (now - timestamp > 300000) {
                this.lastAuthLog.delete(hostname);
            }
        }

        // pendingMigrations: remove entries with lastAttempt older than 10 minutes
        for (const [hostname, migration] of this.pendingMigrations) {
            if (migration.lastAttempt && now - migration.lastAttempt > 600000) {
                this.pendingMigrations.delete(hostname);
            }
        }

        // serverDepths: cap at 500 entries (keep most recently seen)
        if (this.serverDepths.size > 500) {
            const excess = this.serverDepths.size - 500;
            let removed = 0;
            for (const [hostname] of this.serverDepths) {
                if (removed >= excess) break;
                // Only prune depths for servers not currently discovered
                if (!this.discoveredServers.has(hostname)) {
                    this.serverDepths.delete(hostname);
                    removed++;
                }
            }
        }

        // authenticatedServers: prune entries for servers no longer in discoveredServers
        // (server went offline/deleted from network mutations)
        if (this.authenticatedServers.size > 500) {
            for (const hostname of this.authenticatedServers) {
                if (
                    !this.discoveredServers.has(hostname) &&
                    !this.knownPasswords.has(hostname)
                ) {
                    this.authenticatedServers.delete(hostname);
                }
            }
        }
    }
}

/**
 * Check if a server is authenticated (has admin rights) without using
 * the expensive ns.dnet.getServer() API (2 GB). Uses our tracked state instead.
 * darkweb always has admin. Any server we've successfully authenticated is tracked.
 */
function isServerAuthenticated(state, hostname) {
    if (hostname === DARKWEB_HOSTNAME) return true;
    if (state.authenticatedServers.has(hostname)) return true;
    if (state.knownPasswords.has(hostname)) return true;
    if (state.cluePasswords.has(hostname)) return true;
    return false;
}

// ─── Server Info ─────────────────────────────────────────────────────────────

/**
 * Wrapper for darknet server auth details with additional orchestrator metadata.
 */
class DarknetServerInfo {
    constructor(hostname, authDetails) {
        this.hostname = hostname;
        this.modelId = authDetails.modelId;
        this.passwordHint = authDetails.passwordHint;
        this.staticPasswordHint = authDetails.staticPasswordHint;
        this.passwordHintData = authDetails.passwordHintData;
        this.isOnline = authDetails.isOnline;
        this.isConnected = authDetails.isConnectedToCurrentServer;
        this.hasSession = authDetails.hasSession;
        this.hasAdmin = false; // NOTE: getServerAuthDetails does NOT return hasAdminRights; use isServerAuthenticated() instead
        this.passwordFormat = authDetails.passwordFormat;
        this.passwordLength = authDetails.passwordLength;
        this.depth = authDetails.depth ?? null;
        this.lastSeen = Date.now();
        this.difficulty = estimateCrackDifficulty({ modelId: this.modelId });
    }
}

// ─── Main Orchestration ──────────────────────────────────────────────────────

/**
 * One tick of the orchestrator: discover servers, authenticate, deploy probes,
 * manage stasis links, charge migrations, scan clues, and clean up.
 */
async function orchestrateDarknet(ns, state, options) {
    const verbose = options.verbose;

    // Step 1: Ensure home has a probe running
    await ensureHomeProbe(ns, state, options);

    // Step 1b: Collect labyrinth neighbor reports from probes (port 17).
    // Probes at any depth write { labHost, neighbor } whenever they discover a labyrinth.
    // Clear previous neighbors each tick and rebuild from fresh reports to prune stale entries
    // (darknet servers move, so old neighbors may no longer be adjacent).
    // Prune stale neighbors: clear all neighbor sets, then rebuild from fresh port data.
    // We keep the outer Map keys (labyrinth hostnames) since labyrinthServers is the source of truth.
    for (const [, neighbors] of state.labyrinthNeighbors) {
        neighbors.clear();
    }

    while (ns.peek(LAB_NEIGHBOR_REPORT_PORT) !== "NULL PORT DATA") {
        const raw = ns.readPort(LAB_NEIGHBOR_REPORT_PORT);
        try {
            const msg = JSON.parse(String(raw));
            if (msg.labHost && msg.neighbor) {
                state.labyrinthServers.add(msg.labHost);
                if (!state.labyrinthNeighbors.has(msg.labHost)) {
                    state.labyrinthNeighbors.set(msg.labHost, new Set());
                }
                state.labyrinthNeighbors.get(msg.labHost).add(msg.neighbor);
                // Ingest the neighbor's password so the orchestrator knows it's authenticated
                // (required for stasis swap scoring and solver deployment)
                if (
                    msg.neighborPwd != null &&
                    !state.knownPasswords.has(msg.neighbor)
                ) {
                    state.addPassword(ns, msg.neighbor, msg.neighborPwd);
                    if (verbose)
                        log(
                            ns,
                            `INFO Learned password for labyrinth neighbor ${msg.neighbor} from probe report`,
                        );
                }
                // Ensure the neighbor is in discoveredServers so stasis swap considers it
                if (!state.discoveredServers.has(msg.neighbor)) {
                    state.discoveredServers.set(
                        msg.neighbor,
                        new DarknetServerInfo(msg.neighbor, {
                            modelId: "unknown",
                            passwordHint: null,
                            staticPasswordHint: null,
                            passwordHintData: null,
                            isOnline: true,
                            isConnectedToCurrentServer: false,
                            hasSession: false,
                            passwordFormat: null,
                            passwordLength: null,
                            depth: null,
                        }),
                    );
                }
                if (verbose)
                    log(
                        ns,
                        `INFO Probe reported labyrinth ${msg.labHost} neighbor: ${msg.neighbor}`,
                    );
            }
        } catch {}
    }

    // Step 1c: Collect stasis server passwords reported by probes (port 19).
    // When a probe sets stasis on itself, it writes its password here so the orchestrator
    // always has credentials for stasis servers — preventing future 'zombie stasis' situations.
    while (ns.peek(STASIS_PWD_PORT) !== "NULL PORT DATA") {
        const raw = ns.readPort(STASIS_PWD_PORT);
        try {
            const msg = JSON.parse(String(raw));
            if (msg.data) {
                const remotePwds = JSON.parse(msg.data);
                let newCount = 0;
                for (const [host, pwd] of Object.entries(remotePwds)) {
                    if (!state.knownPasswords.has(host)) {
                        state.addPassword(ns, host, pwd);
                        newCount++;
                    }
                }
                if (newCount > 0) {
                    log(
                        ns,
                        `Collected ${newCount} new password(s) from probe stasis report (${msg.host})`,
                    );
                }
            }
        } catch {}
    }

    // Step 2: Discover servers via probe from home (sees only darkweb)
    let nearbyServers = safeProbe(ns);

    // Step 2b: Also probe from darkweb and other authed darknet servers
    // to discover depth-0+ servers the orchestrator otherwise never learns about
    const extraServers = await discoverFromAuthedServers(ns, state);
    for (const s of extraServers) {
        if (!nearbyServers.includes(s)) nearbyServers.push(s);
    }

    // Step 3: Build a prioritized work queue
    const workQueue = buildWorkQueue(ns, state, nearbyServers, options);

    // Step 3b: Update labyrinth neighbors from probeAdjacency for ALL known labyrinths
    // buildWorkQueue only updates neighbors for labyrinths appearing in this tick's nearbyServers.
    // If a labyrinth was discovered previously but its neighbor's probe didn't run this tick,
    // we still need to keep labyrinthNeighbors populated from probeAdjacency.
    for (const labHost of state.labyrinthServers) {
        const sources = state.probeAdjacency.get(labHost);
        if (sources && sources.size > 0) {
            if (!state.labyrinthNeighbors.has(labHost)) {
                state.labyrinthNeighbors.set(labHost, new Set());
            }
            for (const src of sources) {
                state.labyrinthNeighbors.get(labHost).add(src);
            }
        }
    }

    // Step 4: Process each server
    for (const hostname of workQueue) {
        await processServer(ns, state, hostname, options);
    }

    // Step 4b: Collect passwords from stasis servers and deploy probes
    // Stasis servers are exec/scp-reachable from home at any distance, but we
    // need the actual password to establish a session. Probes on those servers
    // saved passwords to their local /data/darknet-passwords.txt — pull those back.
    for (const stasisHost of state.stasisServers) {
        if (stasisHost === "home") continue;
        // Detect zombie stasis servers: no password known AND auth details are all undefined.
        // These servers have active stasis links in the game registry but we've completely
        // lost access — no password, no admin rights, no session. Skip them to avoid
        // wasting time on exec/scp that will always fail.
        const zombieCheck = safeGetAuthDetails(ns, stasisHost);
        const pwd = state.getPassword(stasisHost);
        if (
            pwd === undefined &&
            (!zombieCheck || zombieCheck.hasAdminRights === undefined)
        ) {
            if (!state.zombieStasisServers.has(stasisHost)) {
                state.zombieStasisServers.add(stasisHost);
                log(
                    ns,
                    `Zombie stasis detected: ${stasisHost} has stasis but no password and no auth details — marking as unreachable`,
                );
            }
            continue;
        }
        try {
            // Alternative approach: exec a tiny helper on the stasis server that writes
            // its password file contents to a Netscript port. This avoids overwriting
            // home's password file.
            const helperScript = `/Temp/stasis-pwd-helper-${stasisHost.replace(/[^a-zA-Z0-9]/g, "_")}.js`;
            const helperContent =
                `/** @param {NS} ns */ export async function main(ns) {` +
                ` const data = ns.read("${PASSWORD_FILE}");` +
                ` if (data) ns.writePort(${STASIS_PWD_PORT}, JSON.stringify({host: ns.getHostname(), data}));` +
                `}`;

            // Check if stasis server has enough RAM for the helper (~1.6 GB base)
            const maxRam = ns.getServerMaxRam(stasisHost);
            const usedRam = ns.getServerUsedRam(stasisHost);
            const freeRam = Math.max(0, maxRam - usedRam);
            if (freeRam >= 1.7) {
                // Establish session if we already know the password (may have been saved from a previous run)
                const pwd = state.getPassword(stasisHost);
                if (pwd !== undefined) {
                    try {
                        ns.dnet.connectToSession(stasisHost, pwd);
                    } catch {}
                }
                ns.write(helperScript, helperContent, "w");
                ns.scp(helperScript, stasisHost, "home");
                const pid = ns.exec(helperScript, stasisHost, 1);
                if (pid > 0) {
                    // Wait briefly for it to complete
                    let waited = 0;
                    while (waited < 2000) {
                        await ns.sleep(50);
                        waited += 50;
                        if (!ns.ps(stasisHost).some((p) => p.pid === pid))
                            break;
                    }
                    // Read result from port
                    while (ns.peek(STASIS_PWD_PORT) !== "NULL PORT DATA") {
                        const raw = ns.readPort(STASIS_PWD_PORT);
                        try {
                            const msg = JSON.parse(String(raw));
                            if (msg.data) {
                                const remotePwds = JSON.parse(msg.data);
                                let newCount = 0;
                                for (const [host, pwd] of Object.entries(
                                    remotePwds,
                                )) {
                                    if (!state.knownPasswords.has(host)) {
                                        state.addPassword(ns, host, pwd);
                                        newCount++;
                                    }
                                }
                                if (newCount > 0) {
                                    log(
                                        ns,
                                        `Collected ${newCount} new password(s) from stasis server ${stasisHost}`,
                                    );
                                }
                            }
                        } catch {}
                    }
                }
                // Cleanup
                try {
                    ns.rm(helperScript);
                } catch {}
                try {
                    ns.rm(helperScript, stasisHost);
                } catch {}
            }

            // Now try to establish session and deploy probe with known password
            const pwd = state.getPassword(stasisHost);
            if (pwd !== undefined) {
                try {
                    ns.dnet.connectToSession(stasisHost, pwd);
                } catch {}
            }
            await deployProbe(ns, state, stasisHost, options);
        } catch (err) {
            if (verbose)
                log(
                    ns,
                    `Stasis probe deploy to ${stasisHost} failed: ${getErrorInfo(err)}`,
                );
        }
    }

    // Step 5: Scan clue files on all cracked servers
    if (options["enable-clue-scanning"]) {
        await scanAllClueFiles(ns, state, options);
    }

    // Step 5b: Process stasis swap requests from probes (port 21).
    // Probes on deep servers can't remove stasis on OTHER servers (setStasisLink is local-only).
    // When a probe wants stasis but all slots are full, it writes a swap request here.
    // The orchestrator CAN exec on existing stasis servers, so it removes the weakest.
    // On the probe's next tick, it will find a free slot and set stasis on itself.
    {
        // Collect all swap requests, then process the best one
        const swapRequests = [];
        while (ns.peek(STASIS_SWAP_REQUEST_PORT) !== "NULL PORT DATA") {
            const raw = ns.readPort(STASIS_SWAP_REQUEST_PORT);
            try {
                const req = JSON.parse(String(raw));
                if (req.removeHost && req.requestor) swapRequests.push(req);
            } catch {}
        }
        if (swapRequests.length > 0) {
            // If ALL stasis slots are occupied by zombies, swap is impossible — just drain the requests
            const allZombie = [...state.stasisServers].every((h) =>
                state.zombieStasisServers.has(h),
            );
            if (allZombie) {
                if (verbose)
                    log(
                        ns,
                        `INFO: All ${state.stasisServers.size} stasis slot(s) are zombies — ignoring ${swapRequests.length} swap request(s). Probes solve labyrinths directly.`,
                    );
            } else {
                // Pick the request with the highest score (best candidate to receive stasis)
                swapRequests.sort(
                    (a, b) => (b.myScore || 0) - (a.myScore || 0),
                );
                const best = swapRequests[0];
                if (state.zombieStasisServers.has(best.removeHost)) {
                    // Target is a zombie — can't remove stasis, skip
                    if (verbose)
                        log(
                            ns,
                            `INFO: Swap target ${best.removeHost} is a zombie stasis server — cannot remove. Ignoring ${swapRequests.length} requests.`,
                        );
                } else if (state.stasisServers.has(best.removeHost)) {
                    log(
                        ns,
                        `Stasis swap: processing best of ${swapRequests.length} requests — ${best.requestor} (score: ${best.myScore}) wants to replace ${best.removeHost} (score: ${best.weakestScore})`,
                    );
                    const removed = await execStasisLink(
                        ns,
                        state,
                        best.removeHost,
                        false,
                        options,
                    );
                    if (removed) {
                        state.stasisServers.delete(best.removeHost);
                        state.zombieStasisServers.delete(best.removeHost);
                        log(
                            ns,
                            `Stasis swap: removed stasis from ${best.removeHost} — slot now free for ${best.requestor}`,
                        );
                    } else {
                        log(
                            ns,
                            `WARN: Stasis swap: failed to remove stasis from ${best.removeHost} (will retry next tick)`,
                        );
                    }
                } else if (verbose) {
                    log(
                        ns,
                        `INFO: Stasis swap target ${best.removeHost} no longer stasis-linked, ignoring ${swapRequests.length} requests`,
                    );
                }
            }
        }
    }
    // Step 6: Manage stasis links (exec from target server)
    await manageStasisLinks(ns, state, options);

    // Step 7: Charge migrations for air gap crossing
    if (options["enable-migration"]) {
        await chargeMigrations(ns, state, options);
    }

    // Step 8: Clean up orphaned probes
    cleanupOrphanedProbes(ns, state);

    // Step 8b: Collect labyrinth solver results from port
    while (ns.peek(LAB_SOLVER_RESULT_PORT) !== "NULL PORT DATA") {
        const raw = ns.readPort(LAB_SOLVER_RESULT_PORT);
        try {
            const msg = JSON.parse(String(raw));
            if (msg.password && msg.host) {
                log(ns, `SUCCESS: Labyrinth solver cracked ${msg.host}!`);
                // The solver got the password from authenticate's success response
                state.addPassword(ns, msg.host, msg.password);
                state.authenticatedServers.add(msg.host);
                // Clean up solver script on the solver host
                const solverInfo = state.activeLabSolvers.get(msg.host);
                state.activeLabSolvers.delete(msg.host);
                if (solverInfo) {
                    try {
                        ns.rm(LAB_SOLVER_SCRIPT, solverInfo.solverHost);
                    } catch {}
                }
            } else if (msg.error) {
                log(
                    ns,
                    `WARN: Labyrinth solver failed for ${msg.host}: ${msg.error}`,
                );
                state.activeLabSolvers.delete(msg.host);
            }
        } catch {}
    }

    // Step 8c: Clean up finished/timed-out labyrinth solvers
    for (const [labHost, info] of state.activeLabSolvers) {
        try {
            const running = ns
                .ps(info.solverHost)
                .some((p) => p.pid === info.pid);
            if (!running) {
                // Solver finished without writing to port (crash or killed)
                if (verbose)
                    log(
                        ns,
                        `Labyrinth solver for ${labHost} on ${info.solverHost} is no longer running`,
                    );
                state.activeLabSolvers.delete(labHost);
                try {
                    ns.rm(LAB_SOLVER_SCRIPT, info.solverHost);
                } catch {}
            } else if (Date.now() - info.deployedAt > 300000) {
                // Solver running >5 min — likely stuck, kill it
                log(
                    ns,
                    `WARN: Killing stuck labyrinth solver for ${labHost} (PID ${info.pid})`,
                );
                try {
                    ns.kill(info.pid);
                } catch {}
                state.activeLabSolvers.delete(labHost);
                try {
                    ns.rm(LAB_SOLVER_SCRIPT, info.solverHost);
                } catch {}
            }
        } catch {
            state.activeLabSolvers.delete(labHost);
        }
    }

    // Step 9: Log status
    logStatus(ns, state, verbose);
}

// ─── Server Discovery & Prioritization ───────────────────────────────────────

/**
 * Safely call ns.dnet.probe() — returns list of nearby hostnames.
 */
function safeProbe(ns) {
    try {
        return ns.dnet.probe() || [];
    } catch {
        return [];
    }
}

/**
 * Discover servers by probing from darkweb and other authenticated darknet servers.
 * From home, ns.dnet.probe() only returns ["darkweb"] because home is not a DarknetServer.
 * From darkweb, probe returns all depth-0 servers. From depth-0 servers, probe returns
 * depth-1 neighbors, etc. This expands the orchestrator's visibility beyond just darkweb.
 * Uses a temp script pattern to call probe() on remote servers (0.2 GB + 1.6 GB base).
 */
async function discoverFromAuthedServers(ns, state) {
    const discovered = [];

    // Reset probe adjacency map each tick (rebuilt from fresh probe data)
    state.probeAdjacency = new Map();

    // Always try darkweb first — it sees all depth-0 servers
    const probeTargets = [DARKWEB_HOSTNAME];

    // Also add authenticated servers that have active probes (we know they're reachable)
    for (const [hostname] of state.activeProbes) {
        if (hostname === "home" || hostname === DARKWEB_HOSTNAME) continue;
        if (isServerAuthenticated(state, hostname)) {
            probeTargets.push(hostname);
        }
    }

    // Use a dedicated Netscript port for receiving probe results from remote servers.
    // Ports are global — any server can write to them regardless of network topology.
    // Port 20 is reserved for darknet discovery (helpers.js uses ports 1-20 round-robin,
    // but only briefly; we clear before and after use).
    const DISCOVERY_PORT = 20;
    ns.clearPort(DISCOVERY_PORT);

    let probeCounter = 0;

    for (const target of probeTargets) {
        try {
            // Check if target has enough RAM for temp probe script (1.8 GB)
            const maxRam = ns.getServerMaxRam(target);
            const usedRam = ns.getServerUsedRam(target);
            const freeRam = Math.max(0, maxRam - usedRam);
            if (freeRam < 1.8) continue;

            const probeId = probeCounter++;
            const helperScript = `/Temp/darknet-probe-helper-${probeId}.js`;

            // The temp script runs probe() on the remote server and writes result to a port.
            // This avoids scp back to home which may be unreachable from the darknet.
            const helperContent =
                `/** @param {NS} ns */ export async function main(ns) {` +
                ` const result = ns.dnet.probe();` +
                ` const data = JSON.stringify({ source: ns.getHostname(), servers: result ?? [] });` +
                ` ns.writePort(${DISCOVERY_PORT}, data);` +
                `}`;

            ns.write(helperScript, helperContent, "w");
            ns.scp(helperScript, target, "home");

            const pid = ns.exec(helperScript, target, 1);
            if (pid <= 0) continue;

            // Wait for the temp script to finish (probe is near-instant)
            let waited = 0;
            while (waited < 2000) {
                await ns.sleep(50);
                waited += 50;
                if (!ns.ps(target).some((p) => p.pid === pid)) break;
            }

            // Read all results from the port (the script wrote one JSON object with source + servers)
            while (ns.peek(DISCOVERY_PORT) !== "NULL PORT DATA") {
                const raw = ns.readPort(DISCOVERY_PORT);
                try {
                    const parsed = JSON.parse(String(raw));
                    const source = parsed?.source;
                    const servers = parsed?.servers;
                    if (Array.isArray(servers)) {
                        for (const s of servers) {
                            if (!discovered.includes(s)) discovered.push(s);
                            // Record adjacency: source can reach s
                            if (source) {
                                if (!state.probeAdjacency.has(s)) {
                                    state.probeAdjacency.set(s, new Set());
                                }
                                state.probeAdjacency.get(s).add(source);
                            }
                        }
                    }
                } catch {}
            }

            // Cleanup temp script on both home and target
            try {
                ns.rm(helperScript);
            } catch {}
            try {
                ns.rm(helperScript, target);
            } catch {}
        } catch {
            // Target server offline or inaccessible
        }
    }

    // Final cleanup: drain any leftover port data
    while (ns.peek(DISCOVERY_PORT) !== "NULL PORT DATA") {
        ns.readPort(DISCOVERY_PORT);
    }

    return discovered;
}

/**
 * Build a prioritized work queue. Easy servers first (low tier),
 * then servers we already have passwords for, then the rest.
 */
function buildWorkQueue(ns, state, nearbyServers, options) {
    const withInfo = [];

    for (const hostname of nearbyServers) {
        let details;
        try {
            details = ns.dnet.getServerAuthDetails(hostname);
        } catch {
            continue;
        }
        if (!details.isOnline) continue;

        const serverInfo = new DarknetServerInfo(hostname, details);
        state.discoveredServers.set(hostname, serverInfo);

        // Track depth
        if (serverInfo.depth !== null) {
            state.serverDepths.set(hostname, serverInfo.depth);
        }

        // Detect labyrinth servers and track their neighbors (from probe adjacency data)
        if (serverInfo.modelId === "(The Labyrinth)") {
            state.labyrinthServers.add(hostname);
            // Populate labyrinthNeighbors from probeAdjacency
            const sources = state.probeAdjacency.get(hostname);
            if (sources && sources.size > 0) {
                if (!state.labyrinthNeighbors.has(hostname)) {
                    state.labyrinthNeighbors.set(hostname, new Set());
                }
                for (const src of sources) {
                    state.labyrinthNeighbors.get(hostname).add(src);
                }
            }
        }

        // Skip already-authenticated servers for auth (but still add to discovered)
        if (isServerAuthenticated(state, hostname)) {
            // Still need to deploy probes, but prioritize new servers for auth
            withInfo.push({ hostname, serverInfo, priority: 1000 }); // low priority
            continue;
        }

        // Can't auth if not connected and no stasis
        if (
            !details.isConnectedToCurrentServer &&
            !state.stasisServers.has(hostname)
        ) {
            continue;
        }

        // Priority: known password first, then by tier (easy first)
        let priority = 0;
        if (
            state.knownPasswords.has(hostname) ||
            state.cluePasswords.has(hostname)
        ) {
            priority = -100; // highest priority — we know the password
        } else if (options["easy-first"]) {
            const diff = estimateCrackDifficulty({
                modelId: serverInfo.modelId,
            });
            priority = (diff.tier ?? 5) * 10;
        }

        withInfo.push({ hostname, serverInfo, priority });
    }

    withInfo.sort((a, b) => a.priority - b.priority);
    return withInfo.map((w) => w.hostname);
}

// ─── Server Processing ───────────────────────────────────────────────────────

/**
 * Process a single server: authenticate if needed, then deploy probe.
 */
async function processServer(ns, state, hostname, options) {
    const verbose = options.verbose;

    const details = safeGetAuthDetails(ns, hostname);
    if (!details || !details.isOnline) {
        if (verbose) log(ns, `Server ${hostname} is offline or unreachable`);
        return;
    }

    const serverInfo = new DarknetServerInfo(hostname, details);
    state.discoveredServers.set(hostname, serverInfo);

    // Already authenticated — deploy probe
    if (isServerAuthenticated(state, hostname)) {
        await deployProbe(ns, state, hostname, options);
        return;
    }

    // Can't auth if not connected and no stasis
    if (
        !details.isConnectedToCurrentServer &&
        !state.stasisServers.has(hostname)
    ) {
        if (verbose)
            log(
                ns,
                `Skipping auth for ${hostname}: not connected and no stasis`,
            );
        return;
    }

    const success = await authenticateServer(
        ns,
        state,
        hostname,
        serverInfo,
        options,
    );
    if (success) {
        state.authenticatedServers.add(hostname);
        await deployProbe(ns, state, hostname, options);
    }
}

function safeGetAuthDetails(ns, hostname) {
    try {
        return ns.dnet.getServerAuthDetails(hostname);
    } catch {
        return null;
    }
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Attempt to authenticate with a server using, in order:
 * 1. Known password (from persistence or clue files)
 * 2. Labyrinth solver (if model is The Labyrinth)
 * 3. Model-specific solver from darknet-helpers.js
 * 4. Format-based bruteforce fallback
 */
async function authenticateServer(ns, state, hostname, serverInfo, options) {
    const verbose = options.verbose;

    // Try known password first
    const knownPassword =
        state.knownPasswords.get(hostname) ?? state.cluePasswords.get(hostname);
    if (knownPassword !== undefined) {
        if (verbose) log(ns, `Trying known password for ${hostname}`);
        try {
            const result = await ns.dnet.authenticate(hostname, knownPassword);
            if (result.success) {
                log(
                    ns,
                    `SUCCESS: Authenticated ${hostname} with saved password`,
                );
                state.addPassword(ns, hostname, knownPassword);
                return true;
            }
        } catch {
            /* auth failed */
        }
        // Password no longer valid (server restarted with new password)
        state.removePassword(ns, hostname);
        state.cluePasswords.delete(hostname);
    }

    // Labyrinth — deploy a dedicated solver to a stasis-linked neighbor.
    // The solver runs as a single PID (position is per-PID) and walks the maze.
    // labreport/authenticate require running on a darknet server or direct connection,
    // so we deploy from home to a reachable neighbor that can reach the labyrinth.
    if (serverInfo.modelId === "(The Labyrinth)") {
        const deployed = await deployLabyrinthSolver(
            ns,
            state,
            hostname,
            verbose,
        );
        if (deployed) {
            if (verbose)
                log(ns, `Labyrinth ${hostname}: solver deployed/running`);
        } else {
            if (verbose)
                log(
                    ns,
                    `Labyrinth ${hostname}: no solver deployed yet (need stasis neighbor)`,
                );
        }
        return false; // Don't try normal auth on labyrinth servers
    }

    // Re-check: another agent (probe) may have cracked this while we waited
    const preCheck = safeGetAuthDetails(ns, hostname);
    if (preCheck?.hasAdminRights) {
        if (verbose) log(ns, `${hostname} already cracked by another agent`);
        return true;
    }

    // Model-specific solver
    const solver = getDarknetPasswordSolver(serverInfo.modelId);
    if (solver) {
        try {
            const password = await solver(ns, hostname, serverInfo);
            if (password !== null) {
                const result = await ns.dnet.authenticate(hostname, password);
                if (result.success) {
                    log(
                        ns,
                        `SUCCESS: Cracked ${hostname} (model: ${serverInfo.modelId})`,
                    );
                    state.addPassword(ns, hostname, password);
                    return true;
                }
            }
        } catch (err) {
            if (verbose)
                log(ns, `Solver error on ${hostname}: ${getErrorInfo(err)}`);
        }
    }

    // Re-check before bruteforce: another agent may have cracked this
    const preBrute = safeGetAuthDetails(ns, hostname);
    if (preBrute?.hasAdminRights) {
        if (verbose) log(ns, `${hostname} already cracked by another agent`);
        return true;
    }

    // Format-based bruteforce fallback
    try {
        const fallback = await tryFormatBruteforce(ns, hostname, serverInfo);
        if (fallback !== null) {
            const result = await ns.dnet.authenticate(hostname, fallback);
            if (result.success) {
                log(ns, `SUCCESS: Cracked ${hostname} (format bruteforce)`);
                state.addPassword(ns, hostname, fallback);
                return true;
            }
        }
    } catch {
        /* bruteforce failed */
    }

    logAuthFailure(ns, state, hostname, serverInfo);
    return false;
}

/**
 * Deploy a labyrinth solver script to a stasis-linked neighbor of the labyrinth.
 * The solver runs as a single PID on the neighbor server (position is per-PID),
 * walks the maze with DFS, and writes the password to a Netscript port on success.
 * Returns true if a solver is already running or was just deployed.
 */
async function deployLabyrinthSolver(ns, state, hostname, verbose) {
    // Check if a solver is already active for this labyrinth
    const existing = state.activeLabSolvers.get(hostname);
    if (existing) {
        // Check if it's still running
        try {
            const running = ns
                .ps(existing.solverHost)
                .some((p) => p.pid === existing.pid);
            if (running) {
                if (verbose)
                    log(
                        ns,
                        `Labyrinth solver already running on ${existing.solverHost} for ${hostname} (PID ${existing.pid})`,
                    );
                return true; // solver in flight
            }
        } catch {}
        // Solver finished or crashed — clean up and allow re-deploy
        state.activeLabSolvers.delete(hostname);
    }

    // Find a stasis-linked neighbor that can run the solver
    const neighbors = state.labyrinthNeighbors.get(hostname);
    if (!neighbors || neighbors.size === 0) {
        if (verbose)
            log(
                ns,
                `Labyrinth ${hostname}: no known neighbors yet (waiting for probe adjacency data). ` +
                    `Known labyrinths: [${[...state.labyrinthServers].join(", ")}], ` +
                    `probeAdjacency keys: [${[...state.probeAdjacency.keys()].join(", ")}]`,
            );
        return false;
    }

    let solverHost = null;
    const rejectionReasons = [];
    for (const neighbor of neighbors) {
        // Must be reachable via exec from home: stasis-linked, darkweb, or connected
        const isStasis = state.stasisServers.has(neighbor);
        const isDarkweb = neighbor === "darkweb";
        let isConnected = false;
        try {
            isConnected =
                !!ns.dnet.getServerAuthDetails(neighbor)
                    ?.isConnectedToCurrentServer;
        } catch {}
        if (isDarkweb || isStasis || isConnected) {
            // Check RAM availability (~3 GB needed: 1.6 base + labreport + authenticate)
            try {
                const maxRam = ns.getServerMaxRam(neighbor);
                const usedRam = ns.getServerUsedRam(neighbor);
                if (maxRam - usedRam >= 4) {
                    solverHost = neighbor;
                    break;
                } else {
                    rejectionReasons.push(
                        `${neighbor}: reachable but low RAM (${(maxRam - usedRam).toFixed(1)}/${maxRam}GB free, need 4GB)`,
                    );
                }
            } catch {
                rejectionReasons.push(
                    `${neighbor}: reachable but RAM check failed`,
                );
            }
        } else {
            rejectionReasons.push(
                `${neighbor}: not reachable (stasis=${isStasis}, connected=${isConnected})`,
            );
        }
    }

    if (!solverHost) {
        if (verbose)
            log(
                ns,
                `Labyrinth ${hostname}: no reachable neighbor with enough RAM. ` +
                    `Neighbors: [${[...neighbors].join(", ")}], ` +
                    `Stasis servers: [${[...state.stasisServers].join(", ")}]. ` +
                    `Rejections: ${rejectionReasons.join("; ")}`,
            );
        return false;
    }

    // Deploy the solver
    try {
        // Establish session for this PID — exec/scp require per-PID session on darknet
        const solverPwd = state.getPassword(solverHost);
        if (solverPwd !== undefined) {
            try {
                ns.dnet.connectToSession(solverHost, solverPwd);
            } catch {}
        }
        ns.write(LAB_SOLVER_SCRIPT, LAB_SOLVER_CONTENT, "w");
        ns.scp(LAB_SOLVER_SCRIPT, solverHost, "home");
        const pid = ns.exec(
            LAB_SOLVER_SCRIPT,
            solverHost,
            1,
            hostname,
            LAB_SOLVER_RESULT_PORT,
        );
        if (pid <= 0) {
            log(
                ns,
                `WARN: Failed to exec labyrinth solver on ${solverHost} for ${hostname}`,
            );
            return false;
        }
        state.activeLabSolvers.set(hostname, {
            pid,
            solverHost,
            deployedAt: Date.now(),
        });
        log(
            ns,
            `Deployed labyrinth solver on ${solverHost} for ${hostname} (PID ${pid})`,
        );
        return true;
    } catch (err) {
        log(
            ns,
            `WARN: Labyrinth solver deploy failed for ${hostname}: ${getErrorInfo(err)}`,
        );
        return false;
    }
}

function logAuthFailure(ns, state, hostname, serverInfo) {
    const now = Date.now();
    const last = state.lastAuthLog.get(hostname) ?? 0;
    if (now - last < 60000) return; // Throttle to once per minute per server
    state.lastAuthLog.set(hostname, now);
    log(
        ns,
        `WARN: Unable to auth ${hostname} (model: ${serverInfo.modelId}, tier: ${serverInfo.difficulty?.label ?? "?"}, ` +
            `format: ${serverInfo.passwordFormat}, length: ${serverInfo.passwordLength}, ` +
            `hint: ${serverInfo.passwordHint ?? ""})`,
        false,
        "warning",
    );
}

/**
 * Free blocked RAM on a target server by running memoryReallocation via temp script.
 * Must be called BEFORE deploying probe so there's enough free RAM.
 * The temp script costs ~2.6 GB (1.6 base + 1.0 memoryReallocation).
 * getBlockedRam costs 0 GB and doesn't require direct connection — safe from home.
 * memoryReallocation requires direct connection + admin — must run on target.
 */
async function freeBlockedRamOnServer(ns, state, hostname, options) {
    try {
        const blockedRam = ns.dnet.getBlockedRam(hostname);
        if (blockedRam <= 0) return; // Already free

        // Check there's enough free RAM on target for the helper script (~2.6 GB)
        const maxRam = ns.getServerMaxRam(hostname);
        const usedRam = ns.getServerUsedRam(hostname);
        const freeRam = Math.max(0, maxRam - usedRam);
        const helperCost = 2.6; // 1.6 base + 1.0 memoryReallocation
        if (freeRam < helperCost) {
            if (options.verbose) {
                log(
                    ns,
                    `WARN: ${hostname} lacks RAM for RAM-free helper (needs ${helperCost}GB, has ${formatRam(freeRam)} free)`,
                    false,
                    "warning",
                );
            }
            return;
        }
        // Guard: ns.exec requires adjacency, backdoor, or stasis link from the calling server.
        // The orchestrator runs on home. From home, only 'darkweb' is adjacent.
        // For non-adjacent, non-stasis servers, we cannot exec the helper.
        const ramFreeDetails = safeGetAuthDetails(ns, hostname);
        const canExec =
            hostname === DARKWEB_HOSTNAME ||
            ramFreeDetails?.isConnectedToCurrentServer ||
            state.stasisServers.has(hostname);

        if (!canExec) {
            if (options.verbose) {
                log(
                    ns,
                    `INFO: Cannot exec RAM-free helper on ${hostname} from home (not adjacent/stasis). Skipping.`,
                );
            }
            return;
        }

        log(
            ns,
            `Freeing ${formatRam(blockedRam)} blocked RAM on ${hostname}...`,
        );

        // Write, SCP, and execute the helper script on the target
        ns.write(RAMFREE_HELPER_SCRIPT, RAMFREE_HELPER_CONTENT, "w");
        ns.scp(RAMFREE_HELPER_SCRIPT, hostname, "home");

        // Clear old result file
        try {
            ns.rm(RAMFREE_RESULT_FILE);
        } catch {}

        const pid = ns.exec(RAMFREE_HELPER_SCRIPT, hostname, 1);
        if (pid <= 0) {
            if (options.verbose) {
                log(
                    ns,
                    `WARN: Failed to launch RAM-free helper on ${hostname}`,
                    false,
                    "warning",
                );
            }
            return;
        }

        // Wait for completion (memoryReallocation takes ~0.2-8s per call, may need many calls)
        // For 1 GB blocked RAM at difficulty 0 with modest charisma: ~14 calls * ~2s each = ~28s
        // Generous timeout of 120s to handle slow cases
        const maxWait = 120000;
        let waited = 0;
        while (waited < maxWait) {
            await ns.sleep(500);
            waited += 500;
            // Check if the script finished
            if (!ns.ps(hostname).some((p) => p.pid === pid)) break;
        }

        // Verify success
        const remaining = ns.dnet.getBlockedRam(hostname);
        if (remaining <= 0) {
            log(
                ns,
                `Freed all blocked RAM on ${hostname} (was ${formatRam(blockedRam)})`,
            );
        } else {
            log(
                ns,
                `Partially freed RAM on ${hostname}: ${formatRam(blockedRam - remaining)} freed, ${formatRam(remaining)} remaining`,
                false,
                "warning",
            );
        }

        // Cleanup
        try {
            ns.rm(RAMFREE_HELPER_SCRIPT, hostname);
        } catch {}
        try {
            ns.rm(RAMFREE_RESULT_FILE);
        } catch {}
        try {
            ns.rm(RAMFREE_RESULT_FILE, hostname);
        } catch {}
    } catch (err) {
        if (options.verbose) {
            log(
                ns,
                `WARN: RAM-free failed on ${hostname}: ${getErrorInfo(err)}`,
                false,
                "warning",
            );
        }
    }
}
// ─── Probe Deployment ────────────────────────────────────────────────────────

/**
 * Deploy the probe script to a target server. Handles version management:
 * kills old versions, skips if current version already running.
 */
async function deployProbe(ns, state, hostname, options) {
    // Don't exceed max probe count
    if (
        state.activeProbes.size >= options["max-probes"] &&
        !state.activeProbes.has(hostname)
    )
        return;

    const probeScript = normalizeFilename(getFilePath(PROBE_SCRIPT));

    // Check if probe script exists on home
    if (!ns.fileExists(probeScript, "home")) return;

    try {
        // Establish session if we know the password (skip for darkweb — always accessible)
        if (hostname !== DARKWEB_HOSTNAME) {
            const password = state.getPassword(hostname);
            if (password !== undefined) {
                try {
                    ns.dnet.connectToSession(hostname, password);
                } catch {
                    /* session already exists or failed */
                }
            }
        }

        // Check and manage existing probe processes
        const procs = ns.ps(hostname).filter((p) => p.filename === probeScript);
        const currentVersionProcs = procs.filter(
            (p) => Number(p.args?.[0]) === PROBE_VERSION,
        );
        const oldVersionProcs = procs.filter(
            (p) => Number(p.args?.[0]) !== PROBE_VERSION,
        );

        // Kill old version probes
        for (const proc of oldVersionProcs) {
            try {
                ns.kill(proc.pid);
            } catch {}
        }

        // If current version already running, keep exactly one
        if (currentVersionProcs.length > 0) {
            for (const proc of currentVersionProcs.slice(1)) {
                try {
                    ns.kill(proc.pid);
                } catch {}
            }
            state.activeProbes.set(hostname, {
                pid: currentVersionProcs[0].pid,
                version: PROBE_VERSION,
            });
            return;
        }

        // Free blocked RAM before checking if probe fits (especially important for 16GB servers)
        await freeBlockedRamOnServer(ns, state, hostname, options);

        // Probe logic is not thread-parallelized; extra threads just duplicate work and waste RAM
        const threads = 1;
        const maxRam = ns.getServerMaxRam(hostname);
        const usedRam = ns.getServerUsedRam(hostname);
        const freeRam = Math.max(0, maxRam - usedRam);
        const probeRamPerThread = ns.getScriptRam(probeScript, "home");

        if (probeRamPerThread > freeRam) {
            if (options.verbose) {
                log(
                    ns,
                    `WARN: ${hostname} lacks RAM for probe (needs ${formatRam(probeRamPerThread)}, has ${formatRam(freeRam)} free)`,
                    false,
                    "warning",
                );
            }
            return;
        }

        // Always scp the probe script — scp works at any distance with a session.
        // Even if we can't exec from home, the probe network can pick it up later.
        ns.scp(probeScript, hostname, "home");
        if (!ns.fileExists(probeScript, hostname)) {
            log(
                ns,
                `WARN: Probe script missing on ${hostname} after SCP`,
                false,
                "warning",
            );
            return;
        }

        // Also scp the password file so the probe has known passwords on startup
        try {
            const passwordData = ns.read(PASSWORD_FILE);
            if (passwordData) {
                ns.scp(PASSWORD_FILE, hostname, "home");
            }
        } catch {}

        // Per darknet docs: ns.exec requires the target to be either:
        //   (a) adjacent AND connected to the server running this script, OR
        //   (b) backdoored, OR
        //   (c) stasis-linked
        // The orchestrator runs on home. From home, only 'darkweb' is adjacent.
        // For non-adjacent servers without stasis/backdoor, we can only scp the script;
        // the probe network must propagate via hop-by-hop exec from adjacent darknet servers.
        const details = safeGetAuthDetails(ns, hostname);
        const canExec =
            hostname === DARKWEB_HOSTNAME ||
            details?.isConnectedToCurrentServer ||
            state.stasisServers.has(hostname);

        if (!canExec) {
            if (options.verbose) {
                log(
                    ns,
                    `INFO: SCP'd probe to ${hostname} but cannot exec from home (not adjacent/stasis). Probes will propagate it.`,
                );
            }
            return;
        }

        const pid = ns.exec(probeScript, hostname, threads, PROBE_VERSION);
        if (pid > 0) {
            state.activeProbes.set(hostname, { pid, version: PROBE_VERSION });
            log(
                ns,
                `Deployed probe v${PROBE_VERSION} to ${hostname} (pid: ${pid}, threads: ${threads})`,
            );
        } else {
            if (options.verbose) {
                log(
                    ns,
                    `WARN: Failed to launch probe on ${hostname}. ` +
                        `Connected: ${details?.isConnectedToCurrentServer}, Session: ${details?.hasSession}, ` +
                        `Admin: ${details?.hasAdminRights}, RAM: ${formatRam(usedRam)}/${formatRam(maxRam)}`,
                    false,
                    "warning",
                );
            }
        }
    } catch (err) {
        if (options.verbose) {
            log(
                ns,
                `WARN: Probe deployment failed on ${hostname}: ${getErrorInfo(err)}`,
                false,
                "warning",
            );
        }
    }
}

/**
 * Ensure a probe is running on home.
 */
async function ensureHomeProbe(ns, state, options) {
    const probeScript = normalizeFilename(getFilePath(PROBE_SCRIPT));
    if (!ns.fileExists(probeScript, "home")) return;

    const homeProcs = ns.ps("home").filter((p) => p.filename === probeScript);
    const currentVersionProcs = homeProcs.filter(
        (p) => Number(p.args?.[0]) === PROBE_VERSION,
    );
    const oldVersionProcs = homeProcs.filter(
        (p) => Number(p.args?.[0]) !== PROBE_VERSION,
    );

    // Kill old versions
    for (const proc of oldVersionProcs) {
        try {
            ns.kill(proc.pid);
        } catch {}
    }

    // Keep exactly one current version
    if (currentVersionProcs.length > 1) {
        for (const proc of currentVersionProcs.slice(1)) {
            try {
                ns.kill(proc.pid);
            } catch {}
        }
    }

    if (currentVersionProcs.length > 0) {
        state.activeProbes.set("home", {
            pid: currentVersionProcs[0].pid,
            version: PROBE_VERSION,
        });
        return;
    }

    // Probe logic is not thread-parallelized; extra threads just duplicate work and waste RAM
    const threads = 1;
    const maxRam = ns.getServerMaxRam("home");
    const usedRam = ns.getServerUsedRam("home");
    const freeRam = Math.max(0, maxRam - usedRam);
    const probeRamPerThread = ns.getScriptRam(probeScript, "home");

    if (probeRamPerThread <= freeRam) {
        const pid = ns.exec(probeScript, "home", threads, PROBE_VERSION);
        if (pid > 0) {
            state.activeProbes.set("home", { pid, version: PROBE_VERSION });
        }
    }
}

// ─── Stasis Link Management ─────────────────────────────────────────────────

/**
 * Manage stasis links. CRITICAL: setStasisLink must be called from the target
 * server — it operates on the server the calling script is running on.
 * We exec a tiny helper script on the target to do this.
 */
async function manageStasisLinks(ns, state, options) {
    let stasisLimit;
    try {
        stasisLimit = ns.dnet.getStasisLinkLimit();
    } catch {
        return; // Stasis API not available
    }

    const currentLinks = state.stasisServers.size;

    // Build scored candidate list for ALL authenticated servers (including current stasis)
    // Cache scores to avoid repeated ns.getServerMaxRam() calls per tick
    const scoreCache = new Map();
    const scoreServer = (hostname) => {
        const cached = scoreCache.get(hostname);
        if (cached !== undefined) return cached;
        let score = 0;
        const depth = state.serverDepths.get(hostname);

        if (depth !== undefined) {
            const posInGap = depth % AIR_GAP_DEPTH;
            if (
                posInGap === AIR_GAP_DEPTH - 2 ||
                posInGap === AIR_GAP_DEPTH - 1
            ) {
                // Depth is 6,7 / 14,15 / 22,23 / 30,31 — critical for migration staging
                score += 80;
            } else if (posInGap === 0 || posInGap === 1) {
                score += 30;
            }

            if (depth <= 3) {
                score -= 50;
            }

            score += Math.min(depth * 2, 30);
        }

        // RAM is the DOMINANT factor — high-RAM servers are the primary goal
        // for stasis (they serve as additional hacking infrastructure for daemon.js)
        try {
            const serverRam = ns.getServerMaxRam(hostname);
            // Strong RAM bonus: 1 point per 2GB, up to 400 points for 800GB+
            score += Math.min(Math.floor(serverRam / 2), 400);
        } catch {}

        // Labyrinth adjacency: servers adjacent to unsolved labyrinths get a massive bonus
        // to prioritize getting stasis links for labyrinth solving
        for (const [labHost, neighbors] of state.labyrinthNeighbors) {
            if (neighbors.has(hostname)) {
                // Only boost if the labyrinth is not yet authenticated (unsolved)
                if (!isServerAuthenticated(state, labHost)) {
                    score += 200;
                    break; // One bonus is enough
                }
            }
        }

        scoreCache.set(hostname, score);
        return score;
    };

    // Diagnostic: log labyrinth neighbor status in stasis management
    if (state.labyrinthNeighbors.size > 0 && options.verbose) {
        for (const [labHost, neighbors] of state.labyrinthNeighbors) {
            const labSolved = isServerAuthenticated(state, labHost);
            const neighborDetails = [...neighbors].map((n) => {
                const isStasis = state.stasisServers.has(n);
                const isAuthed = isServerAuthenticated(state, n);
                const score = isAuthed ? scoreServer(n) : "N/A (unauthed)";
                return `${n}(stasis=${isStasis}, authed=${isAuthed}, score=${score})`;
            });
            log(
                ns,
                `Labyrinth stasis info: ${labHost} (solved=${labSolved}), neighbors: ${neighborDetails.join(", ")}`,
            );
        }
    }

    // Find candidates not yet stasis-linked
    const candidates = [];
    for (const [hostname] of state.discoveredServers) {
        if (state.stasisServers.has(hostname)) continue;
        if (hostname === DARKWEB_HOSTNAME) continue; // darkweb is always reachable from home — stasis is pointless
        if (!isServerAuthenticated(state, hostname)) continue;
        candidates.push({ hostname, score: scoreServer(hostname) });
    }
    candidates.sort((a, b) => b.score - a.score);

    if (currentLinks < stasisLimit) {
        // Free slots available — fill them with best candidates
        const slotsAvailable = stasisLimit - currentLinks;
        for (const candidate of candidates.slice(0, slotsAvailable)) {
            if (candidate.score <= 0) break; // Not worth stasis-linking
            const success = await execStasisLink(
                ns,
                state,
                candidate.hostname,
                true,
                options,
            );
            if (success) {
                state.stasisServers.add(candidate.hostname);
                log(
                    ns,
                    `Applied stasis link to ${candidate.hostname} (score: ${candidate.score})`,
                );
            }
        }
    } else if (candidates.length > 0 && candidates[0].score > 0) {
        // All slots full — check if the best unlinked candidate beats the weakest linked server
        let weakestHost = null;
        let weakestScore = Infinity;
        for (const stasisHost of state.stasisServers) {
            // Skip zombie stasis servers — we can't remove them, so they're not swap candidates
            if (state.zombieStasisServers.has(stasisHost)) continue;
            const score = scoreServer(stasisHost);
            if (score < weakestScore) {
                weakestScore = score;
                weakestHost = stasisHost;
            }
        }

        const bestCandidate = candidates[0];
        // Only replace if the candidate beats the weakest by 20%+
        if (weakestHost && bestCandidate.score > weakestScore * 1.1) {
            // Remove stasis from weakest
            const removed = await execStasisLink(
                ns,
                state,
                weakestHost,
                false,
                options,
            );
            if (removed) {
                state.stasisServers.delete(weakestHost);
                log(
                    ns,
                    `Removed stasis from ${weakestHost} (score: ${weakestScore})`,
                );

                // Apply stasis to better candidate
                const added = await execStasisLink(
                    ns,
                    state,
                    bestCandidate.hostname,
                    true,
                    options,
                );
                if (added) {
                    state.stasisServers.add(bestCandidate.hostname);
                    log(
                        ns,
                        `Applied stasis link to ${bestCandidate.hostname} (score: ${bestCandidate.score}, replacing ${weakestHost})`,
                    );
                }
            }
        }
    }
}

/**
 * Execute a stasis link toggle on a target server by writing and running
 * a temporary helper script ON that server.
 */
async function execStasisLink(ns, state, hostname, enable, options) {
    if (options["dry-run"]) {
        log(
            ns,
            `[DRY-RUN] Would ${enable ? "set" : "remove"} stasis link on ${hostname}`,
        );
        return false;
    }

    // Early exit for zombie stasis servers — servers we've already determined are unreachable.
    // No point attempting exec/scp/connectToSession that will always fail.
    if (state.zombieStasisServers.has(hostname)) {
        if (options.verbose)
            log(ns, `INFO: Skipping stasis exec on zombie server ${hostname}`);
        return false;
    }
    // Guard: ns.exec requires adjacency, backdoor, or stasis link from the calling server.
    // The orchestrator runs on home. From home, only 'darkweb' is adjacent.
    // We can also exec on servers that already have stasis links.
    // For all other servers, we CANNOT exec from home — probes must handle stasis locally.
    const details = safeGetAuthDetails(ns, hostname);
    const canExec =
        hostname === DARKWEB_HOSTNAME ||
        details?.isConnectedToCurrentServer ||
        state.stasisServers.has(hostname);

    if (!canExec) {
        if (options.verbose) {
            log(
                ns,
                `INFO: Cannot exec stasis helper on ${hostname} from home (not adjacent/stasis). Probes will handle stasis locally.`,
            );
        }
        return false;
    }

    try {
        const probeScript = normalizeFilename(getFilePath(PROBE_SCRIPT));

        // Kill running probe on this server first — stasis helper (13.6GB) won't fit alongside probe
        const probeInfo = state.activeProbes.get(hostname);
        if (probeInfo) {
            try {
                ns.kill(probeInfo.pid);
            } catch {}
            state.activeProbes.delete(hostname);
        }
        // Also kill any probe by filename (safety net)
        const runningProbes = ns
            .ps(hostname)
            .filter((p) => p.filename === probeScript);
        for (const proc of runningProbes) {
            try {
                ns.kill(proc.pid);
            } catch {}
        }

        // Wait for RAM to be freed after killing processes — game needs an async tick
        await ns.sleep(200);

        // Kill any remaining processes on the server that might block RAM
        // (e.g. other temp scripts left behind)
        const remainingProcs = ns
            .ps(hostname)
            .filter((p) => p.filename !== STASIS_HELPER_SCRIPT);
        for (const proc of remainingProcs) {
            try {
                ns.kill(proc.pid);
            } catch {}
        }
        if (remainingProcs.length > 0) await ns.sleep(100);

        // Establish session for this PID — exec/scp on darknet requires a per-PID session
        // (stasis link sets backdoorInstalled which bypasses direct connection, but session is separate)
        const pwd = state.getPassword(hostname);
        const authDetails = safeGetAuthDetails(ns, hostname);
        if (options.verbose) {
            log(
                ns,
                `Stasis exec diagnostics for ${hostname}: ` +
                    `hasAdmin=${authDetails?.hasAdminRights}, ` +
                    `backdoor=${authDetails?.backdoorInstalled}, ` +
                    `stasis=${authDetails?.hasStasisLink}, ` +
                    `connected=${authDetails?.isConnectedToCurrentServer}, ` +
                    `password=${pwd !== undefined ? "known" : "UNKNOWN"}`,
            );
        }
        // Detect zombie at runtime: no password + no auth details = permanently unreachable
        if (
            pwd === undefined &&
            (!authDetails || authDetails.hasAdminRights === undefined)
        ) {
            if (!state.zombieStasisServers.has(hostname)) {
                state.zombieStasisServers.add(hostname);
                log(
                    ns,
                    `Zombie stasis detected at exec time: ${hostname} — marking as unreachable, will not retry`,
                );
            }
            return false;
        }
        if (pwd !== undefined) {
            try {
                const sessionResult = ns.dnet.connectToSession(hostname, pwd);
                if (!sessionResult.success) {
                    log(
                        ns,
                        `WARN: connectToSession failed for ${hostname}: code=${sessionResult.code}, msg=${sessionResult.message}`,
                    );
                } else {
                    log(ns, `Session established with ${hostname}`);
                }
            } catch (err) {
                log(
                    ns,
                    `WARN: connectToSession threw for ${hostname}: ${getErrorInfo(err)}`,
                );
            }
        } else {
            log(
                ns,
                `WARN: No password known for stasis server ${hostname} — cannot establish session`,
            );
        }
        ns.write(STASIS_HELPER_SCRIPT, STASIS_HELPER_CONTENT, "w");
        const scpResult = ns.scp(STASIS_HELPER_SCRIPT, hostname, "home");
        if (!scpResult) {
            log(
                ns,
                `WARN: SCP failed for ${hostname} — cannot deploy stasis helper`,
            );
        }
        // Attempt exec with retry — RAM may still be freeing up
        let pid = ns.exec(STASIS_HELPER_SCRIPT, hostname, 1, String(enable));
        if (pid <= 0) {
            // Retry after waiting for RAM reclamation
            const maxRam = ns.getServerMaxRam(hostname);
            const usedRam = ns.getServerUsedRam(hostname);
            log(
                ns,
                `WARN: Stasis exec failed on ${hostname} (${usedRam.toFixed(1)}/${maxRam.toFixed(1)} GB used), retrying after sleep...`,
            );
            await ns.sleep(500);
            pid = ns.exec(STASIS_HELPER_SCRIPT, hostname, 1, String(enable));
        }
        if (pid <= 0) {
            const maxRam = ns.getServerMaxRam(hostname);
            const usedRam = ns.getServerUsedRam(hostname);
            log(
                ns,
                `WARN: Failed to exec stasis helper on ${hostname} even after retry (${usedRam.toFixed(1)}/${maxRam.toFixed(1)} GB used, need ~13.6GB free)`,
                false,
                "warning",
            );
            // Redeploy probe even on stasis failure
            await deployProbe(ns, state, hostname, options);
            return false;
        }

        // Wait for stasis helper to finish
        let waited = 0;
        while (waited < 5000) {
            await ns.sleep(100);
            waited += 100;
            const running = ns.ps(hostname).some((p) => p.pid === pid);
            if (!running) break;
        }
        // Clean up stasis helper temp files
        try {
            ns.rm(STASIS_HELPER_SCRIPT);
        } catch {}
        try {
            ns.rm(STASIS_HELPER_SCRIPT, hostname);
        } catch {}

        // Redeploy probe after stasis completes
        await deployProbe(ns, state, hostname, options);

        return true;
    } catch (err) {
        if (options.verbose) {
            log(
                ns,
                `WARN: Stasis link failed on ${hostname}: ${getErrorInfo(err)}`,
                false,
                "warning",
            );
        }
        // Attempt to redeploy probe on error too
        try {
            await deployProbe(ns, state, hostname, options);
        } catch {}
        return false;
    }
}

// ─── Migration Charging ──────────────────────────────────────────────────────

/**
 * Charge servers near air gaps to move them across.
 * chargeServerMigration() adds charge based on charisma, difficulty, and threads.
 * When charge reaches 1.0, server moves up by 2 rows.
 */
async function chargeMigrations(ns, state, options) {
    const verbose = options.verbose;
    const maxLoops = options["migration-charge-loops"];

    const MIGRATION_HELPER_SCRIPT = "/Temp/darknet-migration-helper.js";
    const MIGRATION_HELPER_CONTENT = `/** @param {NS} ns */ export async function main(ns) { ns.dnet.induceServerMigration(ns.args[0]); ns.rm('${MIGRATION_HELPER_SCRIPT}'); }`;

    // Performance: cap servers charged per tick to avoid spawning too many helpers
    const MAX_MIGRATION_SERVERS_PER_TICK = 3;
    let migrationsThisTick = 0;
    // Find servers near air gaps that could benefit from migration
    for (const [hostname, info] of state.discoveredServers) {
        if (migrationsThisTick >= MAX_MIGRATION_SERVERS_PER_TICK) break;
        if (!isServerAuthenticated(state, hostname)) continue;
        if (!info.isOnline) continue;

        const depth = state.serverDepths.get(hostname);
        if (depth === undefined || depth === null) continue;

        // Only charge servers that are just below an air gap
        // (depth just above a multiple of AIR_GAP_DEPTH, meaning they're blocked)
        const rowBelowGap = depth % AIR_GAP_DEPTH;
        if (rowBelowGap !== 1 && rowBelowGap !== 2) continue; // Only charge if 1-2 rows below gap

        // Guard: ns.exec requires adjacency, backdoor, or stasis link from the calling server.
        // The orchestrator runs on home. From home, only 'darkweb' is adjacent.
        // For non-adjacent, non-stasis servers, we cannot exec the migration helper.
        const migDetails = safeGetAuthDetails(ns, hostname);
        const canExec =
            hostname === DARKWEB_HOSTNAME ||
            migDetails?.isConnectedToCurrentServer ||
            state.stasisServers.has(hostname);

        if (!canExec) {
            if (verbose) {
                log(
                    ns,
                    `INFO: Cannot exec migration helper on ${hostname} from home (not adjacent/stasis). Skipping.`,
                );
            }
            continue;
        }

        if (verbose)
            log(ns, `Charging migration for ${hostname} (depth: ${depth})`);

        // Use multi-thread temp script on target server for faster charging
        // Migration charge scales linearly with threads
        // Temp script cost: 1.6 (base) + 4.0 (induceServerMigration) = 5.6 GB per thread
        const migrationScriptCost = 5.6;
        try {
            const targetMaxRam = ns.getServerMaxRam(hostname);
            const targetUsedRam = ns.getServerUsedRam(hostname);
            const targetFreeRam = Math.max(0, targetMaxRam - targetUsedRam);
            const migrationThreads = Math.max(
                1,
                Math.floor(targetFreeRam / migrationScriptCost),
            );

            ns.write(MIGRATION_HELPER_SCRIPT, MIGRATION_HELPER_CONTENT, "w");
            ns.scp(MIGRATION_HELPER_SCRIPT, hostname, "home");

            for (let i = 0; i < maxLoops; i++) {
                const pid = ns.exec(
                    MIGRATION_HELPER_SCRIPT,
                    hostname,
                    migrationThreads,
                    hostname,
                );
                if (pid <= 0) {
                    if (verbose)
                        log(ns, `Migration exec failed for ${hostname}`);
                    break;
                }

                // Wait for the helper to finish
                let waited = 0;
                while (waited < 3000) {
                    await ns.sleep(50);
                    waited += 50;
                    const running = ns.ps(hostname).some((p) => p.pid === pid);
                    if (!running) break;
                }

                // Check migration status via auth details refresh
                const newDetails = safeGetAuthDetails(ns, hostname);
                if (!newDetails || !newDetails.isOnline) {
                    // Server may have migrated or gone offline
                    log(
                        ns,
                        `SUCCESS: ${hostname} migrated or moved (depth was: ${depth})`,
                        true,
                        "success",
                    );
                    break;
                }
                const newDepth = newDetails.depth;
                if (newDepth !== undefined && newDepth !== depth) {
                    log(
                        ns,
                        `SUCCESS: ${hostname} migrated from depth ${depth} to ${newDepth}!`,
                        true,
                        "success",
                    );
                    state.serverDepths.set(hostname, newDepth);
                    break;
                }
            }
        } catch (err) {
            if (verbose)
                log(
                    ns,
                    `Migration charge failed for ${hostname}: ${getErrorInfo(err)}`,
                );
        }
        migrationsThisTick++;
        // Clean up migration helper temp files
        try {
            ns.rm(MIGRATION_HELPER_SCRIPT);
        } catch {}
        try {
            ns.rm(MIGRATION_HELPER_SCRIPT, hostname);
        } catch {}
    }
}

// ─── Clue File Scanning ──────────────────────────────────────────────────────

/**
 * Scan .data.txt clue files on all cracked servers.
 * Clue files may contain:
 * - Passwords for other servers (with or without hostname)
 * - Partial password hints (2 characters from nearby server)
 * - Common password dictionary entries
 * - Lore notes (packet sniff data)
 */
async function scanAllClueFiles(ns, state, options) {
    const verbose = options.verbose;
    let newCluesFound = 0;

    // Performance: cap servers scanned per tick to avoid O(n²) blowup
    const MAX_SERVERS_PER_TICK = 20;
    const MAX_CLUES_PER_TICK = 50;
    let serversScanned = 0;
    let cluesProcessed = 0;

    // Pre-collect unauthenticated servers once (avoids inner O(n) loop per clue)
    const unauthServers = [];
    for (const [nearHost] of state.discoveredServers) {
        if (isServerAuthenticated(state, nearHost)) continue;
        if (
            state.knownPasswords.has(nearHost) ||
            state.cluePasswords.has(nearHost)
        )
            continue;
        unauthServers.push(nearHost);
    }

    for (const [hostname, info] of state.discoveredServers) {
        if (
            serversScanned >= MAX_SERVERS_PER_TICK ||
            cluesProcessed >= MAX_CLUES_PER_TICK
        )
            break;
        if (!isServerAuthenticated(state, hostname)) continue;

        try {
            const files = ns.ls(hostname);
            const clueFiles = files.filter((f) => f.endsWith(CLUE_FILE_SUFFIX));

            for (const clueFile of clueFiles) {
                if (cluesProcessed >= MAX_CLUES_PER_TICK) break;
                const cacheKey = `${hostname}:${clueFile}`;
                if (state.scannedClueFiles.has(cacheKey)) continue;

                const content = ns.read(clueFile);
                if (!content) {
                    state.scannedClueFiles.add(cacheKey);
                    continue;
                }

                const clues = parseClueFile(content);
                cluesProcessed++;

                // Process password clues
                for (const clue of clues.passwords) {
                    if (clue.hostname && clue.password) {
                        // Full hostname + password clue
                        if (!state.knownPasswords.has(clue.hostname)) {
                            state.cluePasswords.set(
                                clue.hostname,
                                clue.password,
                            );
                            newCluesFound++;
                            if (verbose)
                                log(
                                    ns,
                                    `CLUE: Found password for ${clue.hostname} in ${clueFile} on ${hostname}`,
                                );
                        }
                    } else if (clue.password && !clue.hostname) {
                        // Password without hostname — assign to unauthenticated servers
                        // (pre-collected above, O(1) lookup per server)
                        for (const nearHost of unauthServers) {
                            state.cluePasswords.set(nearHost, clue.password);
                        }
                    }
                }

                state.scannedClueFiles.add(cacheKey);
            }
        } catch {
            // Server offline or inaccessible
        }
        serversScanned++;
    }

    if (newCluesFound > 0) {
        state.saveScannedClues(ns);
        log(
            ns,
            `CLUE: Found ${newCluesFound} new password clues from data files`,
        );
    }
}

/**
 * Parse a clue file's content for passwords and hints.
 * Clue formats observed in the game source:
 * - "password: <password>" (for neighboring server, no hostname)
 * - "hostname: <host>, password: <password>" (for disconnected nearby server)
 * - Two characters from a nearby server's password with hostname
 * - Common password dictionary entries
 * - Lore/packet sniff phrases
 */
function parseClueFile(content) {
    const passwords = [];
    const hints = [];
    const lines = String(content || "").split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Match "hostname: X, password: Y" or "host: X password: Y" patterns
        const fullMatch = trimmed.match(
            /host(?:name)?[:\s]+([^\s,]+)[,\s]+password[:\s]+['"]?([^'"}\s,]+)/i,
        );
        if (fullMatch) {
            passwords.push({ hostname: fullMatch[1], password: fullMatch[2] });
            continue;
        }

        // Match standalone "password: Y" or "pwd: Y"
        const pwdMatch = trimmed.match(
            /(?:password|pwd|pass)[:\s]+['"]?([^'"}\s,]+)/i,
        );
        if (pwdMatch) {
            passwords.push({ hostname: null, password: pwdMatch[1] });
            continue;
        }

        // Match "auth: Y" or "authenticate: Y"
        const authMatch = trimmed.match(
            /auth(?:enticate)?[:\s]+['"]?([^'"}\s,]+)/i,
        );
        if (authMatch) {
            passwords.push({ hostname: null, password: authMatch[1] });
            continue;
        }

        // Anything else is a hint
        hints.push(trimmed);
    }

    return { passwords, hints };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Remove probes from tracking for servers that went offline.
 */
function cleanupOrphanedProbes(ns, state) {
    const toRemove = [];
    for (const [hostname] of state.activeProbes) {
        if (hostname === "home") continue;
        try {
            const details = ns.dnet.getServerAuthDetails(hostname);
            if (!details.isOnline) toRemove.push(hostname);
        } catch {
            toRemove.push(hostname);
        }
    }
    for (const hostname of toRemove) {
        state.activeProbes.delete(hostname);
    }
}

// ─── Probe Options ───────────────────────────────────────────────────────────

function writeProbeOptions(ns, options) {
    const payload = {
        enablePhishing: Boolean(options["enable-phishing"]),
        enableStockManipulation: Boolean(options["enable-stock-manipulation"]),
        targetStock: options["target-stock"] ?? "",
        probeVersion: PROBE_VERSION,
    };
    try {
        ns.write(OPTIONS_FILE, JSON.stringify(payload), "w");
    } catch {}
}

// ─── Status Logging ──────────────────────────────────────────────────────────

function logStatus(ns, state, verbose) {
    const adminCount = Array.from(state.discoveredServers.keys()).filter(
        (hostname) => isServerAuthenticated(state, hostname),
    ).length;
    const stats = {
        discovered: state.discoveredServers.size,
        passwords: state.knownPasswords.size,
        probes: state.activeProbes.size,
        stasis: state.stasisServers.size,
        admin: adminCount,
        clues: state.cluePasswords.size,
    };

    if (verbose) {
        log(ns, `Darknet Status: ${JSON.stringify(stats)}`);
    } else {
        const now = Date.now();
        const changed = Object.keys(stats).some(
            (k) => stats[k] !== state.lastStats[k],
        );
        if (changed || now - state.lastStatusLog > 60000) {
            const delta = Object.fromEntries(
                Object.keys(stats).map((k) => [
                    k,
                    stats[k] - (state.lastStats[k] ?? 0),
                ]),
            );
            log(
                ns,
                `Darknet: discovered ${stats.discovered}(${fmtDelta(delta.discovered)}), ` +
                    `admin ${stats.admin}(${fmtDelta(delta.admin)}), ` +
                    `passwords ${stats.passwords}(${fmtDelta(delta.passwords)}), ` +
                    `probes ${stats.probes}(${fmtDelta(delta.probes)}), ` +
                    `stasis ${stats.stasis}(${fmtDelta(delta.stasis)}), ` +
                    `clues ${stats.clues}(${fmtDelta(delta.clues)})`,
            );
            state.lastStats = stats;
            state.lastStatusLog = now;
        }
    }

    // Log labyrinth status whenever labyrinths are known
    if (state.labyrinthServers.size > 0) {
        const labInfo = [...state.labyrinthServers].map((labHost) => {
            const solved = isServerAuthenticated(state, labHost);
            const neighbors = state.labyrinthNeighbors.get(labHost);
            const neighborList = neighbors ? [...neighbors].join(",") : "none";
            const solver = state.activeLabSolvers.get(labHost);
            const solverInfo = solver
                ? `solver=${solver.solverHost}:PID${solver.pid}`
                : "no-solver";
            return `${labHost}(solved=${solved}, neighbors=[${neighborList}], ${solverInfo})`;
        });
        log(ns, `Labyrinth: ${labInfo.join("; ")}`);
    }
}

function fmtDelta(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}
