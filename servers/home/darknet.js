import {
    log,
    getFilePath,
    getConfiguration,
    disableLogs,
    formatRam,
    getErrorInfo,
    portPeek,
    portRead,
    portClear,
    portWrite,
    getNsDataThroughFile,
} from "./helpers.js";
import {
    getDarknetPasswordSolver,
    tryFormatBruteforce,
    needsAuthFeedback,
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
    ["worker", "auto"], // Probes' spare RAM: "auto" (promoteStock for charisma while below the labyrinth's requirement, else phishing), "cha", "money", "off"
    ["enable-stock-manipulation", false], // Enable stock manipulation via promoteStock
    ["target-stock", ""], // Stock symbol to manipulate (if enabled)
    ["hack-target", ""], // Target server for hack/grow/weaken on freed darknet RAM
    ["stasis-priority", ["high-ram", "high-value"]], // Priority for stasis link allocation
    ["verbose", false], // Extra logging
    ["dry-run", false], // Don't actually execute, just log what would be done
    ["enable-migration", true], // Enable migration charging to cross air gaps
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
// When each password's host was last seen (discovered or authenticated). Used to prune passwords of servers that are
// gone: darknet hostnames churn, and without pruning the password file grew without bound (it is copied to every
// probe host and merged back from probe reports, so it ends up many times in the save file).
const PASSWORD_SEEN_FILE = "/data/darknet-password-seen.txt";
const PASSWORD_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const PASSWORD_MAX_ENTRIES = 5000;
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
const STASIS_SWAP_REQUEST_PORT = 21; // Legacy: probe stasis swap requests (drained, no longer used)
const ANCHOR_COMMAND_PORT = 22; // Orchestrator -> probes: {link: [hostnames]} (peeked, not consumed)
const PROBE_OPTIONS_PORT = 23; // Orchestrator -> probes: the probe options (peeked). Probes can only read files on their
// own server, so the options file on home never reached them.
const PROBE_PASSWORDS_PORT = 24; // Orchestrator -> probes: every known password (peeked), so a restarted probe can
// reconnect to servers cracked earlier instead of skipping them.
const STASIS_PWD_PORT = 19; // Netscript port for probe-reported stasis server passwords

// Self-contained labyrinth solver script. Deployed to a neighbor of a labyrinth server; position is per-PID, so it
// solves within one process. Args: [labHostname, resultPort, aimX, aimY].
// tools/lab-sim (the game's maze generator, Final labyrinth size, 200 mazes): the old solver called labreport before
// every move (each call costs as long as a move) and tried directions in a fixed order: 970 steps on average. Reading
// the walls from each move's own response and trying directions toward the far corner first: 264 (p90 354).
// It also runs with as many threads as its host allows: each step takes 1 / (1 + 0.2 * (threads - 1)) as long.
const LAB_SOLVER_CONTENT = [
    `/** @param {NS} ns */ export async function main(ns) {`,
    `  const [hostname, port, aimX, aimY] = ns.args;`,
    `  const D = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] };`,
    `  const rev = { north: "south", south: "north", west: "east", east: "west" };`,
    `  const send = (o) => (ns.port ? ns.port.write : ns.writePort)(port, JSON.stringify(Object.assign({ host: hostname }, o)));`,
    `  const parse = (data) => { const r = String(data ?? "").split("\\n"); return r.length >= 3 && r[1].length >= 3 ? { north: r[0][1] === " ", south: r[2][1] === " ", west: r[1][0] === " ", east: r[1][2] === " " } : null; };`,
    `  let rep = null;`,
    `  for (let i = 0; i < 20 && !rep; i++) { try { rep = await ns.dnet.labreport(); } catch {} if (!rep || !rep.success) { rep = null; await ns.sleep(1000); } }`,
    `  if (!rep) { send({ error: "no labreport" }); return; }`,
    `  let pos = [rep.coords[0], rep.coords[1]];`,
    `  let open = { north: rep.north, south: rep.south, east: rep.east, west: rep.west };`,
    `  const visited = new Set([pos.join(",")]);`,
    `  const stack = [];`,
    `  const score = (d) => (aimX - pos[0]) * D[d][0] + (aimY - pos[1]) * D[d][1];`,
    `  for (let i = 0; i < 50000; i++) {`,
    `    const order = Object.keys(D).sort((a, b) => score(b) - score(a));`,
    `    let dir = order.find((d) => open[d] && !visited.has((pos[0] + 2 * D[d][0]) + "," + (pos[1] + 2 * D[d][1])));`,
    `    let back = false;`,
    `    if (!dir) { if (stack.length === 0) { send({ error: "stuck" }); return; } dir = rev[stack[stack.length - 1]]; back = true; }`,
    `    const r = await ns.dnet.authenticate(hostname, "go " + dir);`,
    `    if (r.success) { send({ password: r.data ?? r.message }); return; }`,
    `    const msg = r.message || "";`,
    `    const m = msg.match(/moved to (\\d+),(\\d+)/);`,
    `    if (m) {`,
    `      if (back) stack.pop(); else stack.push(dir);`,
    `      pos = [parseInt(m[1], 10), parseInt(m[2], 10)];`,
    `      visited.add(pos.join(","));`,
    `      const seen = parse(r.data);`,
    `      if (seen) open = seen;`,
    `      else { const lr = await ns.dnet.labreport(); open = { north: lr.north, south: lr.south, east: lr.east, west: lr.west }; }`,
    `    } else if (/cannot go that way/i.test(msg)) {`,
    `      if (back) { send({ error: "backtrack blocked" }); return; }`,
    `      open[dir] = false;`,
    `    } else if (/charism|moxie|charming/i.test(msg)) { send({ error: "charisma" }); return; }`,
    `    else await ns.sleep(200); // timeout (network instability): retry`,
    `  }`,
    `  send({ error: "max iterations" });`,
    `}`,
].join("\n");
// Maze grid size per labyrinth (labyrinth.ts labData sizes, stitched from 4 odd-sized mazes): the solver aims for the
// far corner, where the exit is (minus a small random offset). Unknown labyrinths: aim far south-east.
const LAB_GRID = {
    th3_l4byr1nth: [21, 13], cru3l_l4byr1nth: [29, 21], m3rc1l3ss_l4byr1nth: [41, 25], ub3r_l4byr1nth: [61, 41],
    et3rn4l_l4byr1nth: [61, 41], end13ss_l4byr1nth: [61, 41], f1n4l_l4byr1nth: [61, 41], b0nus_l4byr1nth: [61, 41],
};
const PROBE_VERSION = 51;

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

    // Remove leftover per-call temp files from older script versions (they bloat the save file).
    // --legacy only touches file names current code never creates, so it's safe while probes run.
    try {
        ns.exec(getFilePath("cleanup.js"), "home", 1, "--legacy");
    } catch {}

    // Main loop
    while (true) {
        try {
            await state.refresh(ns);
            await writeProbeOptions(ns, options, state);
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
        this.passwordSeen = new Map(); // hostname -> last time the host was seen (for pruning)
        this.activeProbes = new Map(); // hostname -> { pid, version }
        this.stasisServers = new Set(); // hostnames with active stasis links
        this.zombieStasisServers = new Map(); // hostname -> { failCount, firstFailAt, lastFailAt } — stasis servers with connection issues
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
                let seen = {};
                try {
                    seen = JSON.parse(ns.read(PASSWORD_SEEN_FILE) || "{}");
                } catch {}
                // Entries without a timestamp (older files) get 30 minutes to be seen again before they're pruned
                const grace = Date.now() - PASSWORD_MAX_AGE_MS + 30 * 60 * 1000;
                for (const host of this.knownPasswords.keys())
                    this.passwordSeen.set(host, seen[host] ?? grace);
                log(
                    ns,
                    `INFO: Loaded ${this.knownPasswords.size} saved passwords`,
                );
            }
        } catch {
            // File doesn't exist or is invalid
        }
    }

    /** Note that a host was seen (discovered or authenticated), keeping its password from being pruned. */
    touchPassword(hostname) {
        if (this.knownPasswords.has(hostname)) this.passwordSeen.set(hostname, Date.now());
    }

    savePasswords(ns) {
        // Drop passwords of hosts not seen recently, and cap the total (most recently seen first)
        const cutoff = Date.now() - PASSWORD_MAX_AGE_MS;
        for (const host of [...this.knownPasswords.keys()]) {
            if ((this.passwordSeen.get(host) ?? 0) < cutoff) {
                this.knownPasswords.delete(host);
                this.passwordSeen.delete(host);
            }
        }
        if (this.knownPasswords.size > PASSWORD_MAX_ENTRIES) {
            const byAge = [...this.knownPasswords.keys()].sort(
                (a, b) => (this.passwordSeen.get(a) ?? 0) - (this.passwordSeen.get(b) ?? 0),
            );
            for (const host of byAge.slice(0, this.knownPasswords.size - PASSWORD_MAX_ENTRIES)) {
                this.knownPasswords.delete(host);
                this.passwordSeen.delete(host);
            }
        }
        ns.write(PASSWORD_FILE, JSON.stringify(Object.fromEntries(this.knownPasswords)), "w");
        ns.write(PASSWORD_SEEN_FILE, JSON.stringify(Object.fromEntries(this.passwordSeen)), "w");
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

    /** @param {boolean} seen false for passwords relayed from probe reports about hosts we haven't seen ourselves
     *  @param {boolean} save false when adding in bulk (call savePasswords once afterwards) */
    addPassword(ns, hostname, password, seen = true, save = true) {
        this.knownPasswords.set(hostname, password);
        if (seen || !this.passwordSeen.has(hostname))
            this.passwordSeen.set(
                hostname,
                seen || this.discoveredServers.has(hostname)
                    ? Date.now()
                    : Date.now() - PASSWORD_MAX_AGE_MS + 30 * 60 * 1000,
            );
        if (save) this.savePasswords(ns);
        // Clear zombie status when we learn a password for a zombie stasis server.
        // This is the primary recovery path: probes adjacent to the server re-authenticate
        // it and report the password, which the orchestrator picks up here.
        if (this.zombieStasisServers.has(hostname)) {
            this.zombieStasisServers.delete(hostname);
            log(
                ns,
                `Zombie stasis RECOVERED: ${hostname} — new password received, clearing zombie status`,
            );
        }
    }

    removePassword(ns, hostname) {
        if (this.knownPasswords.has(hostname)) {
            this.knownPasswords.delete(hostname);
            this.passwordSeen.delete(hostname);
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
        // zombieStasisServers: prune entries for servers no longer in stasisServers
        // (stasis was removed, or server was deleted). Also prune entries that have been
        // zombie for > 30 minutes — at that point the server is likely gone from the network.
        for (const [hostname, info] of this.zombieStasisServers) {
            if (!this.stasisServers.has(hostname)) {
                this.zombieStasisServers.delete(hostname);
            } else if (now - info.lastFailAt > 1800000) {
                // 30+ min since last failure check — stale entry
                this.zombieStasisServers.delete(hostname);
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
        this.staticPasswordHint = authDetails.passwordHint;
        this.passwordHintData = authDetails.data;
        this.isOnline = authDetails.isOnline;
        this.isConnected = authDetails.isConnectedToCurrentServer;
        this.hasSession = authDetails.hasSession;
        this.hasAdmin = false; // NOTE: getServerDetails does NOT return hasAdminRights; use ns.hasRootAccess() / isServerAuthenticated() instead
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

    while (portPeek(ns, LAB_NEIGHBOR_REPORT_PORT) !== "NULL PORT DATA") {
        const raw = portRead(ns, LAB_NEIGHBOR_REPORT_PORT);
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
    while (portPeek(ns, STASIS_PWD_PORT) !== "NULL PORT DATA") {
        const raw = portRead(ns, STASIS_PWD_PORT);
        try {
            const msg = JSON.parse(String(raw));
            if (msg.data) {
                const remotePwds = JSON.parse(msg.data);
                // Probes relay their whole password file (possibly thousands of stale entries). Only take passwords
                // for hosts we've discovered ourselves, and save once per report: saving per entry froze the game.
                let newCount = 0;
                for (const [host, pwd] of Object.entries(remotePwds)) {
                    if (!state.knownPasswords.has(host) && state.discoveredServers.has(host)) {
                        state.addPassword(ns, host, pwd, false, false);
                        newCount++;
                    }
                }
                if (newCount > 0) state.savePasswords(ns);
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
            (!zombieCheck || !zombieCheck.isOnline)
        ) {
            const existing = state.zombieStasisServers.get(stasisHost);
            const now = Date.now();
            if (!existing) {
                state.zombieStasisServers.set(stasisHost, {
                    failCount: 1,
                    firstFailAt: now,
                    lastFailAt: now,
                });
                log(
                    ns,
                    `Stale stasis detected: ${stasisHost} has stasis but no password and no auth details — tracking (1st failure)`,
                );
            } else {
                existing.failCount++;
                existing.lastFailAt = now;
                // Only log periodically (every 5 failures)
                if (existing.failCount % 5 === 0) {
                    log(
                        ns,
                        `Stale stasis: ${stasisHost} still unreachable (${existing.failCount} consecutive failures over ${Math.round((now - existing.firstFailAt) / 1000)}s)`,
                    );
                }
            }
            // Grace period: only skip if failed for > 5 minutes AND > 10 consecutive failures.
            // Before that, keep trying — probes may re-authenticate the server and report a password.
            const zombie = state.zombieStasisServers.get(stasisHost);
            if (
                zombie &&
                zombie.failCount >= 10 &&
                now - zombie.firstFailAt > 300000
            ) {
                continue; // Truly zombie — skip this server
            }
            // Still in grace period: fall through to try password helper anyway (it might work
            // if the server just hasn't had its exec session re-established yet)
        }
        try {
            // Alternative approach: exec a tiny helper on the stasis server that writes
            // its password file contents to a Netscript port. This avoids overwriting
            // home's password file.
            const helperScript = `/Temp/stasis-pwd-helper.js`; // one file: content is host-independent
            const helperContent =
                `/** @param {NS} ns */ export async function main(ns) {` +
                ` const data = ns.read("${PASSWORD_FILE}");` +
                ` if (data) (ns.port ? ns.port.write : ns.writePort)(${STASIS_PWD_PORT}, JSON.stringify({host: ns.getHostname(), data}));` +
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
                    while (portPeek(ns, STASIS_PWD_PORT) !== "NULL PORT DATA") {
                        const raw = portRead(ns, STASIS_PWD_PORT);
                        try {
                            const msg = JSON.parse(String(raw));
                            if (msg.data) {
                                const remotePwds = JSON.parse(msg.data);
                                // (See above: only discovered hosts, one save per report)
                                let newCount = 0;
                                for (const [host, pwd] of Object.entries(
                                    remotePwds,
                                )) {
                                    if (
                                        !state.knownPasswords.has(host) &&
                                        state.discoveredServers.has(host)
                                    ) {
                                        state.addPassword(ns, host, pwd, false, false);
                                        newCount++;
                                    }
                                }
                                if (newCount > 0) state.savePasswords(ns);
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
                    const result = ns.dnet.connectToSession(stasisHost, pwd);
                    if (!result.success && result.code === 401) {
                        state.removePassword(ns, stasisHost);
                        log(
                            ns,
                            `Stale password for stasis server ${stasisHost} — invalidated (401 on probe deploy)`,
                        );
                    }
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

    // Step 6: Anchors (stasis links). The orchestrator is the only decision maker; probes link their own
    // server when it is published on ANCHOR_COMMAND_PORT. Older probes may still send swap requests: drain them.
    while (portPeek(ns, STASIS_SWAP_REQUEST_PORT) !== "NULL PORT DATA") portRead(ns, STASIS_SWAP_REQUEST_PORT);
    refreshKnownServers(ns, state);
    await manageAnchors(ns, state, options);

    // Step 7: Migration charging (air gap crossing) is done by the probes, at the gap published in the probe options

    // Step 8: Clean up orphaned probes
    cleanupOrphanedProbes(ns, state);

    // Step 8b: Collect labyrinth solver results from port
    while (portPeek(ns, LAB_SOLVER_RESULT_PORT) !== "NULL PORT DATA") {
        const raw = portRead(ns, LAB_SOLVER_RESULT_PORT);
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
            } else if (Date.now() - info.deployedAt > 3 * 3600 * 1000) {
                // The solver always ends by itself (solved, stuck, charisma, max iterations); this only catches a hang.
                // (Was 5 minutes, but a large labyrinth takes hundreds of ~3 s steps, and a restarted solver starts
                // over at the entrance: positions are per process.)
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
    // (helpers.js completion ports live at 9000+, so they no longer collide with this one.)
    const DISCOVERY_PORT = 20;
    portClear(ns, DISCOVERY_PORT);

    // The temp script runs probe() on the remote server and writes result to a port.
    // This avoids scp back to home which may be unreachable from the darknet.
    // Content is constant, so one file is reused (and only compiled once by the game).
    const helperScript = `/Temp/darknet-probe-helper.js`;
    const helperContent =
        `/** @param {NS} ns */ export async function main(ns) {` +
        ` const result = ns.dnet.probe();` +
        ` const data = JSON.stringify({ source: ns.getHostname(), servers: result ?? [] });` +
        ` (ns.port ? ns.port.write : ns.writePort)(${DISCOVERY_PORT}, data);` +
        `}`;
    ns.write(helperScript, helperContent, "w");

    const readResults = () => {
        while (portPeek(ns, DISCOVERY_PORT) !== "NULL PORT DATA") {
            const raw = portRead(ns, DISCOVERY_PORT);
            try {
                const parsed = JSON.parse(String(raw));
                const source = parsed?.source;
                const servers = parsed?.servers;
                if (!Array.isArray(servers)) continue;
                for (const s of servers) {
                    if (!discovered.includes(s)) discovered.push(s);
                    // Record adjacency: source can reach s
                    if (source) {
                        if (!state.probeAdjacency.has(s))
                            state.probeAdjacency.set(s, new Set());
                        state.probeAdjacency.get(s).add(source);
                    }
                }
            } catch {}
        }
    };

    // Launch the helper on every target first, then wait for all of them together
    // (previously each target was waited on in turn, up to 2s each).
    const pending = new Map(); // pid -> target
    for (const target of probeTargets) {
        try {
            // Check if target has enough RAM for temp probe script (1.8 GB)
            const freeRam = Math.max(
                0,
                ns.getServerMaxRam(target) - ns.getServerUsedRam(target),
            );
            if (freeRam < 1.8) continue;
            ns.scp(helperScript, target, "home");
            const pid = ns.exec(helperScript, target, 1);
            if (pid > 0) pending.set(pid, target);
        } catch {
            // Target server offline or inaccessible
        }
    }

    // Probe is near-instant; read the port while waiting so it can't overflow (ports hold 50 entries).
    const deadline = Date.now() + 2000;
    while (pending.size > 0 && Date.now() < deadline) {
        await ns.sleep(50);
        readResults();
        const runningByHost = new Map();
        for (const [pid, target] of pending) {
            let running = runningByHost.get(target);
            if (!running) {
                try {
                    running = new Set(ns.ps(target).map((p) => p.pid));
                } catch {
                    running = new Set();
                }
                runningByHost.set(target, running);
            }
            if (!running.has(pid)) pending.delete(pid);
        }
    }
    readResults();

    // Cleanup the temp script on targets (the home copy is reused next tick)
    for (const target of new Set(probeTargets)) {
        if (target === "home") continue;
        try {
            if (ns.fileExists(helperScript, target)) ns.rm(helperScript, target);
        } catch {}
    }

    // Final cleanup: drain any leftover port data
    while (portPeek(ns, DISCOVERY_PORT) !== "NULL PORT DATA") {
        portRead(ns, DISCOVERY_PORT);
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
            details = ns.dnet.getServerDetails(hostname);
        } catch {
            continue;
        }
        if (!details.isOnline) continue;

        const serverInfo = new DarknetServerInfo(hostname, details);
        state.discoveredServers.set(hostname, serverInfo);
        state.touchPassword(hostname);

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
    state.touchPassword(hostname);

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

function safeHasRoot(ns, hostname) {
    try {
        return ns.hasRootAccess(hostname);
    } catch {
        return false;
    }
}

function safeGetAuthDetails(ns, hostname) {
    try {
        return ns.dnet.getServerDetails(hostname);
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
 * Feedback-based models are skipped: authenticate() returns no feedback outside labyrinths (it is only in
 * the server log), so they are left to the probes, which read it with heartbleed.
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
    if (safeHasRoot(ns, hostname)) {
        if (verbose) log(ns, `${hostname} already cracked by another agent`);
        return true;
    }

    // Feedback-based models: guessing blind from here would only burn attempts. Leave them to the probes.
    if (needsAuthFeedback(serverInfo)) {
        if (verbose)
            log(
                ns,
                `${hostname} (${serverInfo.modelId}) needs auth feedback; leaving it to the probes`,
            );
        return false;
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
    if (safeHasRoot(ns, hostname)) {
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
    let solverFree = 0;
    const rejectionReasons = [];
    for (const neighbor of neighbors) {
        // Must be reachable via exec from home: stasis-linked, darkweb, or connected
        const isStasis = state.stasisServers.has(neighbor);
        const isDarkweb = neighbor === "darkweb";
        let isConnected = false;
        try {
            isConnected =
                !!ns.dnet.getServerDetails(neighbor)
                    ?.isConnectedToCurrentServer;
        } catch {}
        if (isDarkweb || isStasis || isConnected) {
            // Check RAM availability (~3 GB needed: 1.6 base + labreport + authenticate)
            try {
                const maxRam = ns.getServerMaxRam(neighbor);
                const usedRam = ns.getServerUsedRam(neighbor);
                if (maxRam - usedRam >= 4) {
                    // The neighbor with the most free RAM: the solver's speed grows with its thread count
                    if (!solverHost || maxRam - usedRam > solverFree) {
                        solverHost = neighbor;
                        solverFree = maxRam - usedRam;
                    }
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
        const threadRam = ns.getScriptRam(LAB_SOLVER_SCRIPT, "home") || 2;
        const freeRam = ns.getServerMaxRam(solverHost) - ns.getServerUsedRam(solverHost);
        const threads = Math.max(1, Math.floor((freeRam - 0.5) / threadRam));
        const [gridW, gridH] = LAB_GRID[hostname] ?? [1e4, 1e4];
        const pid = ns.exec(
            LAB_SOLVER_SCRIPT,
            solverHost,
            threads,
            hostname,
            LAB_SOLVER_RESULT_PORT,
            gridW - 2,
            gridH - 2,
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
                        `Admin: ${safeHasRoot(ns, hostname)}, RAM: ${formatRam(usedRam)}/${formatRam(maxRam)}`,
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
// ─── Anchors (stasis links) ──────────────────────────────────────────────────
//
// Stasis links ("anchors") pin a darknet server in place, keep it online and allow remote exec. There are only
// 1-4 of them (+1 each for The W1ngs of Icarus, The H4mmer of Daedalus, The St4ff of Asclepius).
//
// Phases:
//  - push:   while the current labyrinth is unsolved (also while charisma is still short of it): one anchor per
//            air-gap segment for the deepest segments reached, on the server nearest the next gap (its probe charges
//            neighbours' migrations across), or on a labyrinth neighbour in the labyrinth's segment (planSegmentAnchors).
//  - stable: once the labyrinth is solved, anchors keep high-RAM servers stable.
//
// Swaps are conservative: an anchor is held at least ANCHOR_MIN_HOLD_MS, a candidate must beat the weakest
// anchor by ANCHOR_REPLACE_MARGIN points, must be verified ready (authenticated, online, enough RAM, reachable or running a probe)
// before anything is unlinked, and only one change is in flight at a time.

const ANCHOR_MIN_HOLD_MS = 5 * 60 * 1000;
const ANCHOR_SWAP_COOLDOWN_MS = 2 * 60 * 1000;
const ANCHOR_LINK_TIMEOUT_MS = 3 * 60 * 1000;
const ANCHOR_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;
const ANCHOR_REPLACE_MARGIN = 100; // score points (a new frontier foothold beats an old one or a charger)
const STASIS_RAM_NEEDED = 13.6; // 1.6 GB base + 12 GB setStasisLink

/**
 * Depths (and anchor candidacy) for every server we hold a password for. Only home's own neighbours used to be
 * looked up, so every server cracked deeper by probes counted as depth 0: the frontier gap stayed at row 8 and only
 * labyrinth neighbours (+1000) ever scored as anchors. getServerDetails works at any distance.
 */
function refreshKnownServers(ns, state) {
    for (const hostname of new Set([...state.knownPasswords.keys(), ...state.stasisServers])) {
        if (hostname === DARKWEB_HOSTNAME || hostname === "home") continue;
        let details;
        try {
            details = ns.dnet.getServerDetails(hostname);
        } catch {
            continue;
        }
        if (!details?.isOnline) {
            state.serverDepths.delete(hostname);
            continue;
        }
        if (typeof details.depth === "number") state.serverDepths.set(hostname, details.depth);
        if (!state.discoveredServers.has(hostname)) state.discoveredServers.set(hostname, new DarknetServerInfo(hostname, details));
        if (details.modelId === "(The Labyrinth)") state.labyrinthServers.add(hostname);
    }
    // Labyrinths have fixed names: look them up directly, so the target depth is known before a probe reaches one
    for (const lab of Object.keys(LAB_GRID)) {
        try {
            const details = ns.dnet.getServerDetails(lab);
            // Earlier labyrinths linger off the network (depth -1): only the current one has a depth
            if (details?.isOnline && details.depth > 0) state.labyrinthServers.add(lab);
        } catch {}
    }
    for (const lab of state.labyrinthServers) {
        try {
            const details = ns.dnet.getServerDetails(lab);
            if (details?.isOnline && typeof details.depth === "number") state.serverDepths.set(lab, details.depth);
        } catch {}
    }
}

/** Determine the anchoring phase and the labyrinth it is targeting. */
async function getAnchorPhase(ns, state) {
    // The current labyrinth: discovered, online lab server(s); prefer an unsolved one
    const labs = [...state.labyrinthServers].filter((h) => safeGetAuthDetails(ns, h)?.isOnline !== false);
    const unsolved = labs.filter((h) => !isServerAuthenticated(state, h));
    if (labs.length === 0) return { phase: "push", lab: null, reason: "labyrinth not found yet" };
    if (unsolved.length === 0) return { phase: "stable", lab: labs[0], reason: "labyrinth solved" };
    const lab = unsolved[0];
    // Charisma requirement: without it the labyrinth can't be navigated, so pushing deeper is pointless
    if (!state.charismaCheckedAt || Date.now() - state.charismaCheckedAt > 5 * 60 * 1000) {
        state.charismaCheckedAt = Date.now();
        try {
            state.playerCharisma = await getNsDataThroughFile(ns, "ns.getPlayer().skills.charisma", "/Temp/player-charisma.txt");
        } catch {}
        try {
            state.labCharismaRequired = ns.dnet.getServerRequiredCharismaLevel(lab);
        } catch {}
    }
    // Keep pushing while charisma is short: reaching the labyrinth takes hours, charisma grows meanwhile, and deep
    // anchors are what keep the progress (tools/dnet-sim/CrossSim: at 300 charisma, anchoring the deepest probe
    // hosts reached the Eternal labyrinth in 3.4h, against 11h+ for anchors next to the labyrinth only)
    if (state.playerCharisma !== undefined && state.labCharismaRequired > state.playerCharisma)
        return { phase: "push", lab, reason: `labyrinth unsolved (charisma ${state.playerCharisma} < ${state.labCharismaRequired}, reaching it first)` };
    return { phase: "push", lab, reason: "labyrinth unsolved" };
}

function scoreAnchor(ns, state, hostname, phaseInfo, ctx) {
    const depth = state.serverDepths.get(hostname) ?? 0;
    let ram = 0;
    try {
        ram = ns.getServerMaxRam(hostname);
    } catch {}
    if (phaseInfo.phase === "stable") {
        // Stability: host as much of our work as possible on servers that won't go offline
        return Math.min(ram, 16384) / 16 + 1;
    }
    let score = depth * 10; // deeper is better
    const segment = Math.floor(depth / AIR_GAP_DEPTH);
    // Foothold in the deepest segment reached: an anchored server can't be moved back across the gap, never loses
    // its connections, and home can exec on it at any distance (probes are redeployed there if they die)
    if (segment === ctx.frontierSegment && depth > 0) score += 400;
    // Charger before the gap being crossed: a stable host whose probe charges its neighbours' migrations. An anchor
    // can't migrate itself, so prefer the row just out of migration range (gap - 4) over the launch rows.
    if (ctx.gap && depth >= ctx.gap - 4 && depth < ctx.gap) score += (depth === ctx.gap - 4 ? 150 : 75) + Math.min(ram / 32, 50);
    // Next to the unsolved labyrinth: the solver needs one host there; more anchors there add little
    if (phaseInfo.lab && state.labyrinthNeighbors.get(phaseInfo.lab)?.has(hostname))
        score += !ctx.labAnchor || ctx.labAnchor === hostname ? 1000 : 50;
    if (depth <= 3) score -= 100; // the game keeps shallow servers dense; anchors add little there
    score += Math.min(ram / 64, 25); // tie-breaker
    return score;
}

/** Anchor decisions for inspection (read over the Remote API): phase, frontier, anchors and top candidates. */
const ANCHOR_STATUS_FILE = "/data/darknet-anchor-status.txt";
let lastAnchorStatus = 0;
function writeAnchorStatus(ns, state, phaseInfo, ctx, limit, score) {
    if (Date.now() - lastAnchorStatus < 30_000) return;
    lastAnchorStatus = Date.now();
    try {
        const depthOf = (h) => state.serverDepths.get(h) ?? null;
        const anchors = [...state.stasisServers].map((h) => ({
            h, depth: depthOf(h), score: Math.round(score(h)), heldMin: Math.round((Date.now() - (state.anchorSince?.get(h) ?? Date.now())) / 60000),
        }));
        const candidates = [];
        for (const [h] of state.discoveredServers) {
            if (state.stasisServers.has(h) || !isServerAuthenticated(state, h)) continue;
            const sc = score(h);
            if (sc > 0) candidates.push({ h, depth: depthOf(h), score: Math.round(sc) });
        }
        candidates.sort((a, b) => b.score - a.score);
        const top = candidates.slice(0, 12).map((c) => ({ ...c, ready: anchorReadiness(ns, state, c.h) }));
        const depths = [...state.serverDepths.entries()].filter(([h]) => isServerAuthenticated(state, h)).map(([, d]) => d);
        ns.write(ANCHOR_STATUS_FILE, JSON.stringify({
            t: Date.now(), phase: phaseInfo.phase, reason: phaseInfo.reason, lab: phaseInfo.lab, labDepth: phaseInfo.lab ? depthOf(phaseInfo.lab) : null,
            limit, frontierSegment: ctx.frontierSegment, gap: ctx.gap, deepestCracked: depths.length ? Math.max(...depths) : null,
            knownDepths: state.serverDepths.size, pending: state.anchorPending ?? null,
            sinceLastChangeMin: Math.round((Date.now() - (state.lastAnchorChange ?? 0)) / 60000), anchors, top,
            plan: phaseInfo.phase === "push" ? planSegmentAnchors(ns, state, phaseInfo, limit) : null,
        }), "w");
    } catch (err) {
        log(ns, `WARNING: anchor status failed: ${getErrorInfo(err)}`);
    }
}

/** Can this server be linked right now? Returns {ok, direct, reason}. */
function anchorReadiness(ns, state, hostname) {
    if (hostname === DARKWEB_HOSTNAME) return { ok: false, reason: "darkweb is always reachable" };
    if (!isServerAuthenticated(state, hostname)) return { ok: false, reason: "not authenticated" };
    const failedUntil = state.anchorFailures?.get(hostname) ?? 0;
    if (failedUntil > Date.now()) return { ok: false, reason: "recent link failure" };
    const details = safeGetAuthDetails(ns, hostname);
    if (!details?.isOnline) return { ok: false, reason: "offline" };
    let maxRam = 0;
    try {
        maxRam = ns.getServerMaxRam(hostname);
    } catch {}
    if (maxRam < STASIS_RAM_NEEDED) return { ok: false, reason: `only ${maxRam} GB RAM` };
    if (details.isConnectedToCurrentServer) return { ok: true, direct: true };
    // Otherwise the server's own probe must do it
    const probeScript = normalizeFilename(getFilePath(PROBE_SCRIPT));
    let hasProbe = false;
    try {
        hasProbe = ns.ps(hostname).some((p) => p.filename === probeScript);
    } catch {}
    return hasProbe ? { ok: true, direct: false } : { ok: false, reason: "no probe running" };
}

function isRunningLabSolver(ns, hostname) {
    try {
        return ns.ps(hostname).some((p) => /lab-solver/.test(p.filename));
    } catch {
        return false;
    }
}

function publishAnchorCommand(ns, link) {
    portClear(ns, ANCHOR_COMMAND_PORT);
    portWrite(ns, ANCHOR_COMMAND_PORT, JSON.stringify({ link, at: Date.now() }));
}

async function manageAnchors(ns, state, options) {
    let limit;
    try {
        limit = ns.dnet.getStasisLinkLimit();
    } catch {
        return; // Stasis API not available
    }
    state.anchorSince ??= new Map();
    state.anchorFailures ??= new Map();
    const now = Date.now();
    const linked = state.stasisServers;
    for (const h of linked) if (!state.anchorSince.has(h)) state.anchorSince.set(h, now);
    for (const h of [...state.anchorSince.keys()]) if (!linked.has(h)) state.anchorSince.delete(h);

    const phaseInfo = await getAnchorPhase(ns, state);
    if (state.anchorPhase !== phaseInfo.phase) {
        log(ns, `Anchors: phase ${phaseInfo.phase} (${phaseInfo.reason})`);
        state.anchorPhase = phaseInfo.phase;
    }

    // Deepest air-gap segment we hold any authenticated server in, the gap being crossed, and the (largest) anchored
    // labyrinth neighbour
    let frontierSegment = 0;
    for (const [h, depth] of state.serverDepths)
        if (isServerAuthenticated(state, h)) frontierSegment = Math.max(frontierSegment, Math.floor(depth / AIR_GAP_DEPTH));
    const labNeighbors = phaseInfo.lab ? state.labyrinthNeighbors.get(phaseInfo.lab) : undefined;
    let labAnchor = null;
    const maxRamOf = (h) => {
        try {
            return ns.getServerMaxRam(h);
        } catch {
            return 0;
        }
    };
    for (const h of linked) if (labNeighbors?.has(h) && (!labAnchor || maxRamOf(h) > maxRamOf(labAnchor))) labAnchor = h;
    const ctx = { frontierSegment, gap: options["enable-migration"] ? getFrontierGap(ns, state) : 0, labAnchor };
    const score = (h) => scoreAnchor(ns, state, h, phaseInfo, ctx);
    writeAnchorStatus(ns, state, phaseInfo, ctx, limit, score);

    // 1. A change in flight: link/unlink each take ~30s (setStasisLink duration), so wait for confirmation.
    const pending = state.anchorPending;
    if (pending?.stage === "unlinking") {
        if (!linked.has(pending.remove)) {
            state.anchorPending = null;
            await startAnchorLink(ns, state, options, pending.candidate, pending.remove);
        } else if (now - pending.startedAt > ANCHOR_LINK_TIMEOUT_MS) {
            log(ns, `WARNING: Anchors: unlinking ${pending.remove} timed out; keeping it`, false, "warning");
            state.anchorPending = null;
            state.lastAnchorChange = now;
        }
        return;
    }
    if (pending) {
        if (linked.has(pending.add)) {
            log(ns, `Anchors: ${pending.add} is now anchored${pending.replaced ? ` (replaced ${pending.replaced})` : ""}`);
            state.anchorPending = null;
            state.lastAnchorChange = now;
        } else if (now - pending.startedAt > ANCHOR_LINK_TIMEOUT_MS) {
            log(ns, `WARNING: Anchors: linking ${pending.add} timed out; trying another candidate later`, false, "warning");
            state.anchorFailures.set(pending.add, now + ANCHOR_FAILURE_COOLDOWN_MS);
            state.anchorPending = null;
        } else {
            publishAnchorCommand(ns, pending.direct ? [] : [pending.add]);
            return;
        }
    }
    publishAnchorCommand(ns, []);

    // 2 (push phase). One anchor per air-gap segment, for the deepest `limit` segments past the entry segment: in each,
    // the server closest to the next gap (its probe charges neighbours' migrations across), or a labyrinth neighbour in
    // the labyrinth's segment (to host the solver). Four anchors used to cluster in one segment.
    if (phaseInfo.phase === "push") {
        const plan = planSegmentAnchors(ns, state, phaseInfo, limit);
        const wanted = new Set(plan.map((p) => p.hostname));
        const toAdd = plan.filter((p) => !linked.has(p.hostname));
        if (!toAdd.length) return;
        if (linked.size < limit) {
            await startAnchorLink(ns, state, options, toAdd[0]);
            return;
        }
        if (now - (state.lastAnchorChange ?? 0) < ANCHOR_SWAP_COOLDOWN_MS) return;
        // Replace an anchor outside the plan: the shallowest one first
        const removable = [...linked].filter((h) => !wanted.has(h) && now - (state.anchorSince.get(h) ?? now) >= ANCHOR_MIN_HOLD_MS &&
            !isRunningLabSolver(ns, h)).sort((a, b) => (state.serverDepths.get(a) ?? -1) - (state.serverDepths.get(b) ?? -1));
        if (!removable.length) return;
        const remove = removable[0];
        log(ns, `Anchors: moving ${remove} (depth ${state.serverDepths.get(remove) ?? "?"}) to ${toAdd[0].hostname} (depth ${toAdd[0].score}, segment ${toAdd[0].segment})`);
        if (!(await execStasisLink(ns, state, remove, false, options))) {
            log(ns, `WARNING: Anchors: could not unlink ${remove}; keeping it`, false, "warning");
            state.lastAnchorChange = now;
            return;
        }
        state.anchorPending = { stage: "unlinking", remove, candidate: toAdd[0], startedAt: now };
        return;
    }

    // 2. Rank candidates. Only cracked servers with room for the link can be anchored; filter them first (the deepest
    // discovered servers are mostly uncracked, and used to fill the whole shortlist, so nothing away from the
    // labyrinth was ever anchored).
    const candidates = [];
    for (const [hostname] of state.discoveredServers) {
        if (linked.has(hostname) || !isServerAuthenticated(state, hostname)) continue;
        let maxRam = 0;
        try {
            maxRam = ns.getServerMaxRam(hostname);
        } catch {}
        if (maxRam < STASIS_RAM_NEEDED) continue;
        const s = score(hostname);
        if (s <= 0) continue;
        candidates.push({ hostname, score: s });
    }
    candidates.sort((a, b) => b.score - a.score);
    const pickReady = () => {
        for (const c of candidates.slice(0, 30)) {
            const r = anchorReadiness(ns, state, c.hostname);
            if (r.ok) return { ...c, direct: r.direct };
            if (options.verbose) log(ns, `Anchors: candidate ${c.hostname} (score ${c.score.toFixed(0)}) not ready: ${r.reason}`);
        }
        return null;
    };

    // 3. Free slot: fill it with the best ready candidate
    if (linked.size < limit) {
        const best = pickReady();
        if (best) await startAnchorLink(ns, state, options, best);
        return;
    }

    // 4. All slots used: consider replacing the weakest anchor
    if (now - (state.lastAnchorChange ?? 0) < ANCHOR_SWAP_COOLDOWN_MS) return;
    let weakest = null;
    for (const h of linked) {
        const z = state.zombieStasisServers.get(h);
        if (z && z.failCount >= 10 && now - z.firstFailAt > 300000) continue; // can't exec there
        if (now - (state.anchorSince.get(h) ?? now) < ANCHOR_MIN_HOLD_MS) continue; // hold new anchors
        if (isRunningLabSolver(ns, h)) continue; // never interrupt a labyrinth attempt
        const s = score(h);
        if (!weakest || s < weakest.score) weakest = { hostname: h, score: s };
    }
    if (!weakest || !candidates.length) return;
    if (candidates[0].score <= weakest.score + ANCHOR_REPLACE_MARGIN) return;
    // Verify the replacement is ready BEFORE unlinking anything
    const best = pickReady();
    if (!best || best.score <= weakest.score + ANCHOR_REPLACE_MARGIN) return;
    log(ns, `Anchors: replacing ${weakest.hostname} (score ${weakest.score.toFixed(0)}) with ${best.hostname} (score ${best.score.toFixed(0)}) [${phaseInfo.phase}]`);
    const removed = await execStasisLink(ns, state, weakest.hostname, false, options);
    if (!removed) {
        log(ns, `WARNING: Anchors: could not unlink ${weakest.hostname}; keeping it`, false, "warning");
        state.lastAnchorChange = now; // back off before retrying
        return;
    }
    // Wait for the unlink to complete before linking the replacement (the slot is still taken until then)
    state.anchorPending = { stage: "unlinking", remove: weakest.hostname, candidate: best, startedAt: now };
}

/**
 * The wanted anchor of each of the deepest `limit` segments (segment 0 holds the entrance and is skipped): a labyrinth
 * neighbour in the labyrinth's segment, otherwise the deepest ready server (ties: more RAM). A current anchor within a
 * row of the best stays, to avoid churn. Returns [{hostname, segment, score: depth, direct}], deepest segment first.
 */
function planSegmentAnchors(ns, state, phaseInfo, limit) {
    const labNeighbors = phaseInfo.lab ? state.labyrinthNeighbors.get(phaseInfo.lab) : null;
    const bySegment = new Map();
    for (const h of new Set([...state.discoveredServers.keys(), ...state.stasisServers])) {
        const depth = state.serverDepths.get(h);
        if (depth === undefined || depth < AIR_GAP_DEPTH || h === DARKWEB_HOSTNAME) continue;
        if (state.labyrinthServers.has(h)) continue;
        if (!state.stasisServers.has(h) && !isServerAuthenticated(state, h)) continue;
        let ram = 0;
        try {
            ram = ns.getServerMaxRam(h);
        } catch {}
        if (ram < STASIS_RAM_NEEDED && !state.stasisServers.has(h)) continue;
        const seg = Math.floor(depth / AIR_GAP_DEPTH);
        if (!bySegment.has(seg)) bySegment.set(seg, []);
        bySegment.get(seg).push({ h, depth, ram, lab: !!labNeighbors?.has(h) });
    }
    const plan = [];
    for (const seg of [...bySegment.keys()].sort((a, b) => b - a)) {
        if (plan.length >= limit) break;
        const servers = bySegment.get(seg).sort((a, b) => b.lab - a.lab || b.depth - a.depth || b.ram - a.ram);
        const best = servers[0];
        const current = servers.find((s) => state.stasisServers.has(s.h) && s.lab === best.lab && s.depth >= best.depth - 1);
        if (current) {
            plan.push({ hostname: current.h, segment: seg, score: current.depth, direct: false });
            continue;
        }
        for (const s of servers) {
            const r = state.stasisServers.has(s.h) ? { ok: true, direct: false } : anchorReadiness(ns, state, s.h);
            if (!r.ok) continue;
            plan.push({ hostname: s.h, segment: seg, score: s.depth, direct: r.direct });
            break;
        }
    }
    return plan;
}

/** Start linking a candidate: directly when home can exec there, otherwise via the server's own probe. */
async function startAnchorLink(ns, state, options, cand, replaced) {
    let direct = cand.direct;
    if (direct && !(await execStasisLink(ns, state, cand.hostname, true, options))) direct = false; // fall back to its probe
    state.anchorPending = { stage: "linking", add: cand.hostname, startedAt: Date.now(), direct, replaced };
    publishAnchorCommand(ns, direct ? [] : [cand.hostname]);
    log(ns, `Anchors: linking ${cand.hostname} (${cand.segment !== undefined ? `depth ${cand.score}, segment ${cand.segment}` : `score ${cand.score.toFixed(0)}`}, ${direct ? "direct" : "via its probe"})`);
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

    // Early exit for confirmed zombie stasis servers (past grace period).
    // Servers in grace period are still attempted — they may recover.
    const zombieInfo = state.zombieStasisServers.get(hostname);
    if (
        zombieInfo &&
        zombieInfo.failCount >= 10 &&
        Date.now() - zombieInfo.firstFailAt > 300000
    ) {
        if (options.verbose)
            log(
                ns,
                `INFO: Skipping stasis exec on confirmed zombie server ${hostname} (${zombieInfo.failCount} failures over ${Math.round((Date.now() - zombieInfo.firstFailAt) / 1000)}s)`,
            );
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
        // Also kill any probe by filename (safety net), and pause the spare-RAM worker (the probe restarts it)
        const runningProbes = ns
            .ps(hostname)
            .filter((p) => p.filename === probeScript || /darknet-worker-/.test(p.filename));
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
                    `hasAdmin=${safeHasRoot(ns, hostname)}, ` +
                    `online=${authDetails?.isOnline}, ` +
                    `stasis=${state.stasisServers.has(hostname)}, ` +
                    `connected=${authDetails?.isConnectedToCurrentServer}, ` +
                    `password=${pwd !== undefined ? "known" : "UNKNOWN"}`,
            );
        }
        // Track zombie status at runtime: no password + no auth details = unreachable.
        // Uses grace period: only give up after sustained failures.
        if (
            pwd === undefined &&
            (!authDetails || !authDetails.isOnline)
        ) {
            const now = Date.now();
            const existing = state.zombieStasisServers.get(hostname);
            if (!existing) {
                state.zombieStasisServers.set(hostname, {
                    failCount: 1,
                    firstFailAt: now,
                    lastFailAt: now,
                });
            } else {
                existing.failCount++;
                existing.lastFailAt = now;
            }
            const zombie = state.zombieStasisServers.get(hostname);
            if (zombie.failCount >= 10 && now - zombie.firstFailAt > 300000) {
                log(
                    ns,
                    `Zombie stasis confirmed at exec time: ${hostname} — unreachable for ${Math.round((now - zombie.firstFailAt) / 1000)}s (${zombie.failCount} failures)`,
                );
            } else {
                log(
                    ns,
                    `Stale stasis at exec time: ${hostname} — failure ${zombie.failCount}, still in grace period`,
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
                    // If auth failure (401), our stored password is wrong/stale.
                    // Remove it so the server gets re-authenticated by probes naturally.
                    if (sessionResult.code === 401) {
                        state.removePassword(ns, hostname);
                        log(
                            ns,
                            `Invalidated stale password for ${hostname} — probes will re-authenticate`,
                        );
                    }
                    return false;
                } else {
                    log(ns, `Session established with ${hostname}`);
                    // Successful session — clear any zombie tracking
                    state.zombieStasisServers.delete(hostname);
                }
            } catch (err) {
                log(
                    ns,
                    `WARN: connectToSession threw for ${hostname}: ${getErrorInfo(err)}`,
                );
                return false;
            }
        } else {
            log(
                ns,
                `WARN: No password known for stasis server ${hostname} — cannot establish session`,
            );
            return false;
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

/* Migration charging moved to the probes (attemptMigrationCharging in darknet-probe.js): induceServerMigration
 * must target a neighbouring server, and the old helper here targeted the server it ran on, which the game refuses. */

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

                // ns.read only reads files on home: copy the clue file here first.
                if (!ns.scp(clueFile, "home", hostname)) continue;
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

        // Match 'Server: X Password: "Y"' (the game's format) or "hostname: X, password: Y"
        const fullMatch =
            trimmed.match(
                /(?:server|host(?:name)?)\s*:?\s*([^\s,]+)[,\s]+password\s*:\s*"([^"]*)"/i,
            ) ||
            trimmed.match(
                /(?:server|host(?:name)?)\s*:?\s*([^\s,]+)[,\s]+password\s*:\s*'?([^'"}\s,]+)/i,
            );
        if (fullMatch) {
            passwords.push({ hostname: fullMatch[1], password: fullMatch[2] });
            continue;
        }

        // Match standalone "password: Y" or "pwd: Y" ("Remember this password: Y"). Needs a colon/equals,
        // so "The password for X contains a and b" is a hint, not the password "for".
        const pwdMatch = trimmed.match(
            /(?:password|pwd|pass)\s*[:=]\s*['"]?([^'"}\s,]+)/i,
        );
        if (pwdMatch) {
            passwords.push({ hostname: null, password: pwdMatch[1] });
            continue;
        }

        // Match "auth: Y" or "authenticate: Y"
        const authMatch = trimmed.match(
            /auth(?:enticate)?\s*:\s*['"]?([^'"}\s,]+)/i,
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
            const details = ns.dnet.getServerDetails(hostname);
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

/** What probes do with their host's spare RAM (see manageWorker in darknet-probe.js): charisma (promoteStock) while
 * it's below the current labyrinth's requirement, else phishing for money. Charisma restarts at every install. */
async function chooseWorkerMode(ns, options, state) {
    if (options["worker"] === "off") return { workerMode: "off", workerStock: "" };
    if (!state.workerCheckedAt || Date.now() - state.workerCheckedAt > 60 * 1000) {
        state.workerCheckedAt = Date.now();
        try {
            state.playerCharisma = await getNsDataThroughFile(ns, "ns.getPlayer().skills.charisma", "/Temp/player-charisma.txt");
        } catch {}
        // promoteStock raises a stock's volatility: use one we hold no position in
        try {
            state.workerStock = await getNsDataThroughFile(ns,
                "ns.stock.hasTixApiAccess() ? (ns.stock.getSymbols().find(s => { const p = ns.stock.getPosition(s); return p[0] === 0 && p[2] === 0; }) ?? '') : ''",
                "/Temp/darknet-worker-stock.txt");
        } catch {
            state.workerStock = "";
        }
        const unsolvedLab = [...state.labyrinthServers].find((h) => !isServerAuthenticated(state, h));
        if (unsolvedLab) {
            try {
                state.labCharismaRequired = ns.dnet.getServerRequiredCharismaLevel(unsolvedLab);
            } catch {}
        }
    }
    const needCharisma = (state.labCharismaRequired ?? 0) > (state.playerCharisma ?? Infinity);
    if (options["worker"] === "cha" || (options["worker"] === "auto" && needCharisma && state.workerStock))
        return { workerMode: "cha", workerStock: state.workerStock ?? "" };
    return { workerMode: "money", workerStock: "" };
}

/** The air gap row probes should carry servers across: the one after the deepest segment where we hold a server,
 * unless the unsolved labyrinth is already within reach. 0 = none. */
function getFrontierGap(ns, state) {
    let frontierSegment = 0;
    for (const [h, depth] of state.serverDepths)
        if (isServerAuthenticated(state, h)) frontierSegment = Math.max(frontierSegment, Math.floor(depth / AIR_GAP_DEPTH));
    const gap = (frontierSegment + 1) * AIR_GAP_DEPTH;
    const unsolvedLab = [...state.labyrinthServers].find((h) => !isServerAuthenticated(state, h));
    const labDepth = unsolvedLab ? state.serverDepths.get(unsolvedLab) : undefined;
    if (labDepth !== undefined && labDepth < gap) return 0;
    return gap;
}

async function writeProbeOptions(ns, options, state) {
    const labNeighbors = [...state.labyrinthNeighbors.values()].flatMap((set) => [...set]);
    const payload = {
        frontierGap: options["enable-migration"] ? getFrontierGap(ns, state) : 0,
        ...(await chooseWorkerMode(ns, options, state)),
        labNeighbors,
        enablePhishing: Boolean(options["enable-phishing"]),
        enableStockManipulation: Boolean(options["enable-stock-manipulation"]),
        targetStock: options["target-stock"] ?? "",
        hackTarget: options["hack-target"] ?? "",
        enableStasis: true,
        enableMigration: Boolean(options["enable-migration"]),
        probeVersion: PROBE_VERSION,
    };
    try {
        const json = JSON.stringify(payload);
        ns.write(OPTIONS_FILE, json, "w");
        portClear(ns, PROBE_OPTIONS_PORT);
        portWrite(ns, PROBE_OPTIONS_PORT, json);
        portClear(ns, PROBE_PASSWORDS_PORT);
        portWrite(ns, PROBE_PASSWORDS_PORT, JSON.stringify(Object.fromEntries(state.knownPasswords)));
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
