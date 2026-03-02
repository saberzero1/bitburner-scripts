import {
    log, getFilePath, getConfiguration, disableLogs, formatRam,
    getErrorInfo
} from './helpers.js'
import {
    getDarknetPasswordSolver, tryFormatBruteforce, solveLabyrinth,
    parseDarknetLogs, estimateCrackDifficulty
} from './darknet-helpers.js'

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
    ['tail', false], // Open a tail window for this script
    ['interval', 5000], // Main loop interval in ms
    ['max-probes', 10], // Maximum number of probe scripts running simultaneously
    ['enable-phishing', true], // Enable phishing attacks for money/charisma
    ['enable-stock-manipulation', false], // Enable stock manipulation via promoteStock
    ['target-stock', ''], // Stock symbol to manipulate (if enabled)
    ['stasis-priority', ['high-ram', 'high-value']], // Priority for stasis link allocation
    ['verbose', false], // Extra logging
    ['dry-run', false], // Don't actually execute, just log what would be done
    ['enable-migration', true], // Enable migration charging to cross air gaps
    ['migration-charge-loops', 20], // Max charge loops per migration attempt per tick
    ['enable-clue-scanning', true], // Scan clue files on cracked servers
    ['easy-first', true], // Prioritize low-tier servers for authentication
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AIR_GAP_DEPTH = 8;
const CLUE_FILE_SUFFIX = '.data.txt';
const PROBE_SCRIPT = '/Remote/darknet-probe.js';
const PASSWORD_FILE = '/data/darknet-passwords.txt';
const OPTIONS_FILE = '/data/darknet-options.txt';
const CLUE_CACHE_FILE = '/data/darknet-clues-scanned.txt';
const STASIS_HELPER_SCRIPT = '/Temp/darknet-stasis-helper.js';
const STASIS_HELPER_CONTENT = `/** @param {NS} ns */ export async function main(ns) { const enable = ns.args[0] === 'true'; ns.dnet.setStasisLink(enable); }`;
const PROBE_VERSION = 8;

// ─── Entry Point ─────────────────────────────────────────────────────────────

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    if (options.tail) (ns.ui?.openTail ? ns.ui.openTail() : ns.tail());

    disableLogs(ns, ['sleep', 'scan', 'getServerMaxRam', 'getServerUsedRam', 'scp', 'exec', 'kill', 'ps', 'rm', 'read', 'write', 'ls']);

    // Check if darknet is available
    if (!ns.fileExists('DarkscapeNavigator.exe', 'home')) {
        log(ns, 'ERROR: DarkscapeNavigator.exe not found. Purchase it from the darkweb.', true, 'error');
        return;
    }

    const state = new DarknetState(ns, options);

    log(ns, 'INFO: Darknet orchestrator v2 starting...', true, 'info');

    // Main loop
    while (true) {
        try {
            writeProbeOptions(ns, options);
            await state.refresh(ns);
            await orchestrateDarknet(ns, state, options);
        } catch (err) {
            log(ns, `WARNING: Darknet orchestrator error: ${getErrorInfo(err)}`, false, 'warning');
        }
        await ns.sleep(options.interval);
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
        this.scannedClueFiles = new Set(); // set of file paths already scanned
        this.pendingMigrations = new Map(); // hostname -> { charge, lastAttempt }
        this.lastRefresh = 0;
        this.lastStatusLog = 0;
        this.lastStats = { discovered: 0, passwords: 0, probes: 0, stasis: 0, admin: 0, clues: 0 };
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
                log(ns, `INFO: Loaded ${this.knownPasswords.size} saved passwords`);
            }
        } catch {
            // File doesn't exist or is invalid
        }
    }

    savePasswords(ns) {
        const data = JSON.stringify(Object.fromEntries(this.knownPasswords));
        ns.write(PASSWORD_FILE, data, 'w');
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
        ns.write(CLUE_CACHE_FILE, data, 'w');
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
                const probeScript = getFilePath(PROBE_SCRIPT);
                const alive = procs.some(p => p.filename === probeScript && p.pid === probeInfo.pid);
                if (!alive) {
                    this.activeProbes.delete(hostname);
                }
            } catch {
                this.activeProbes.delete(hostname);
            }
        }

        this.lastRefresh = Date.now();
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
        this.hasAdmin = authDetails.hasAdminRights;
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

    // Step 2: Discover servers via probe from home
    const nearbyServers = safeProbe(ns);

    // Step 3: Build a prioritized work queue
    const workQueue = buildWorkQueue(ns, state, nearbyServers, options);

    // Step 4: Process each server
    for (const hostname of workQueue) {
        await processServer(ns, state, hostname, options);
    }

    // Step 5: Scan clue files on all cracked servers
    if (options['enable-clue-scanning']) {
        await scanAllClueFiles(ns, state, options);
    }

    // Step 6: Manage stasis links (exec from target server)
    await manageStasisLinks(ns, state, options);

    // Step 7: Charge migrations for air gap crossing
    if (options['enable-migration']) {
        await chargeMigrations(ns, state, options);
    }

    // Step 8: Clean up orphaned probes
    cleanupOrphanedProbes(ns, state);

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

        // Skip already-admin servers for auth (but still add to discovered)
        if (details.hasAdminRights) {
            // Still need to deploy probes, but prioritize new servers for auth
            withInfo.push({ hostname, serverInfo, priority: 1000 }); // low priority
            continue;
        }

        // Can't auth if not connected and no stasis
        if (!details.isConnectedToCurrentServer && !state.stasisServers.has(hostname)) {
            continue;
        }

        // Priority: known password first, then by tier (easy first)
        let priority = 0;
        if (state.knownPasswords.has(hostname) || state.cluePasswords.has(hostname)) {
            priority = -100; // highest priority — we know the password
        } else if (options['easy-first']) {
            const diff = estimateCrackDifficulty({ modelId: serverInfo.modelId });
            priority = (diff.tier ?? 5) * 10;
        }

        withInfo.push({ hostname, serverInfo, priority });
    }

    withInfo.sort((a, b) => a.priority - b.priority);
    return withInfo.map(w => w.hostname);
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

    // Already have admin — deploy probe
    if (details.hasAdminRights) {
        await deployProbe(ns, state, hostname, options);
        return;
    }

    // Can't auth if not connected and no stasis
    if (!details.isConnectedToCurrentServer && !state.stasisServers.has(hostname)) {
        if (verbose) log(ns, `Skipping auth for ${hostname}: not connected and no stasis`);
        return;
    }

    const success = await authenticateServer(ns, state, hostname, serverInfo, options);
    if (success) {
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
    const knownPassword = state.knownPasswords.get(hostname) ?? state.cluePasswords.get(hostname);
    if (knownPassword !== undefined) {
        if (verbose) log(ns, `Trying known password for ${hostname}`);
        try {
            const result = await ns.dnet.authenticate(hostname, knownPassword);
            if (result.success) {
                log(ns, `SUCCESS: Authenticated ${hostname} with saved password`);
                state.addPassword(ns, hostname, knownPassword);
                return true;
            }
        } catch { /* auth failed */ }
        // Password no longer valid (server restarted with new password)
        state.removePassword(ns, hostname);
        state.cluePasswords.delete(hostname);
    }

    // Labyrinth — special solver
    if (serverInfo.modelId === '(The Labyrinth)') {
        try {
            const solved = await solveLabyrinth(ns, hostname);
            if (solved) {
                log(ns, `SUCCESS: Solved labyrinth on ${hostname}`);
                return true;
            }
        } catch (err) {
            if (verbose) log(ns, `Labyrinth solve failed on ${hostname}: ${getErrorInfo(err)}`);
        }
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
                    log(ns, `SUCCESS: Cracked ${hostname} (model: ${serverInfo.modelId})`);
                    state.addPassword(ns, hostname, password);
                    return true;
                }
            }
        } catch (err) {
            if (verbose) log(ns, `Solver error on ${hostname}: ${getErrorInfo(err)}`);
        }
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
    } catch { /* bruteforce failed */ }

    logAuthFailure(ns, state, hostname, serverInfo);
    return false;
}

function logAuthFailure(ns, state, hostname, serverInfo) {
    const now = Date.now();
    const last = state.lastAuthLog.get(hostname) ?? 0;
    if (now - last < 60000) return; // Throttle to once per minute per server
    state.lastAuthLog.set(hostname, now);
    log(ns, `WARN: Unable to auth ${hostname} (model: ${serverInfo.modelId}, tier: ${serverInfo.difficulty?.label ?? '?'}, ` +
        `format: ${serverInfo.passwordFormat}, length: ${serverInfo.passwordLength}, ` +
        `hint: ${serverInfo.passwordHint ?? ''})`, false, 'warning');
}

// ─── Probe Deployment ────────────────────────────────────────────────────────

/**
 * Deploy the probe script to a target server. Handles version management:
 * kills old versions, skips if current version already running.
 */
async function deployProbe(ns, state, hostname, options) {
    // Don't exceed max probe count
    if (state.activeProbes.size >= options['max-probes'] && !state.activeProbes.has(hostname)) return;

    const probeScript = getFilePath(PROBE_SCRIPT);

    // Check if probe script exists on home
    if (!ns.fileExists(probeScript, 'home')) return;

    try {
        // Establish session if we know the password
        const password = state.getPassword(hostname);
        if (password !== undefined) {
            try {
                ns.dnet.connectToSession(hostname, password);
            } catch { /* session already exists or failed */ }
        }

        // Check and manage existing probe processes
        const procs = ns.ps(hostname).filter(p => p.filename === probeScript);
        const currentVersionProcs = procs.filter(p => Number(p.args?.[0]) === PROBE_VERSION);
        const oldVersionProcs = procs.filter(p => Number(p.args?.[0]) !== PROBE_VERSION);

        // Kill old version probes
        for (const proc of oldVersionProcs) {
            try { ns.kill(proc.pid); } catch { }
        }

        // If current version already running, keep exactly one
        if (currentVersionProcs.length > 0) {
            for (const proc of currentVersionProcs.slice(1)) {
                try { ns.kill(proc.pid); } catch { }
            }
            state.activeProbes.set(hostname, { pid: currentVersionProcs[0].pid, version: PROBE_VERSION });
            return;
        }

        // Check RAM
        const maxRam = ns.getServerMaxRam(hostname);
        const usedRam = ns.getServerUsedRam(hostname);
        const scriptRam = ns.getScriptRam(probeScript, 'home');
        const freeRam = Math.max(0, maxRam - usedRam);

        if (scriptRam > freeRam) {
            if (options.verbose) {
                log(ns, `WARN: ${hostname} lacks RAM for probe (needs ${formatRam(scriptRam)}, has ${formatRam(freeRam)} free)`, false, 'warning');
            }
            return;
        }

        // Copy and execute
        ns.scp(probeScript, hostname, 'home');
        if (!ns.fileExists(probeScript, hostname)) {
            log(ns, `WARN: Probe script missing on ${hostname} after SCP`, false, 'warning');
            return;
        }

        const pid = ns.exec(probeScript, hostname, 1, PROBE_VERSION);
        if (pid > 0) {
            state.activeProbes.set(hostname, { pid, version: PROBE_VERSION });
            log(ns, `Deployed probe v${PROBE_VERSION} to ${hostname} (pid: ${pid})`);
        } else {
            if (options.verbose) {
                const details = safeGetAuthDetails(ns, hostname);
                log(ns, `WARN: Failed to launch probe on ${hostname}. ` +
                    `Connected: ${details?.isConnectedToCurrentServer}, Session: ${details?.hasSession}, ` +
                    `Admin: ${details?.hasAdminRights}, RAM: ${formatRam(usedRam)}/${formatRam(maxRam)}`,
                    false, 'warning');
            }
        }
    } catch (err) {
        if (options.verbose) {
            log(ns, `WARN: Probe deployment failed on ${hostname}: ${getErrorInfo(err)}`, false, 'warning');
        }
    }
}

/**
 * Ensure a probe is running on home.
 */
async function ensureHomeProbe(ns, state, options) {
    const probeScript = getFilePath(PROBE_SCRIPT);
    if (!ns.fileExists(probeScript, 'home')) return;

    const homeProcs = ns.ps('home').filter(p => p.filename === probeScript);
    const currentVersionProcs = homeProcs.filter(p => Number(p.args?.[0]) === PROBE_VERSION);
    const oldVersionProcs = homeProcs.filter(p => Number(p.args?.[0]) !== PROBE_VERSION);

    // Kill old versions
    for (const proc of oldVersionProcs) {
        try { ns.kill(proc.pid); } catch { }
    }

    // Keep exactly one current version
    if (currentVersionProcs.length > 1) {
        for (const proc of currentVersionProcs.slice(1)) {
            try { ns.kill(proc.pid); } catch { }
        }
    }

    if (currentVersionProcs.length > 0) {
        state.activeProbes.set('home', { pid: currentVersionProcs[0].pid, version: PROBE_VERSION });
        return;
    }

    // Launch new probe on home
    const maxRam = ns.getServerMaxRam('home');
    const usedRam = ns.getServerUsedRam('home');
    const scriptRam = ns.getScriptRam(probeScript, 'home');
    if (scriptRam <= Math.max(0, maxRam - usedRam)) {
        const pid = ns.exec(probeScript, 'home', 1, PROBE_VERSION);
        if (pid > 0) {
            state.activeProbes.set('home', { pid, version: PROBE_VERSION });
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
    if (currentLinks >= stasisLimit) return;

    // Find candidate servers: must have admin, not already stasis-linked
    const candidates = [];
    for (const [hostname, info] of state.discoveredServers) {
        if (state.stasisServers.has(hostname)) continue;
        if (!info.hasAdmin) continue;

        let score = 0;
        try {
            const serverRam = ns.getServerMaxRam(hostname);
            score += serverRam / 1024; // Prefer high RAM servers
        } catch { }

        // Prefer servers near air gaps (strategic value for migration)
        const depth = state.serverDepths.get(hostname);
        if (depth !== undefined) {
            const distToGap = depth % AIR_GAP_DEPTH;
            if (distToGap <= 2 || distToGap >= AIR_GAP_DEPTH - 2) {
                score += 50; // Near air gap = strategic value
            }
        }

        candidates.push({ hostname, score });
    }

    candidates.sort((a, b) => b.score - a.score);

    const slotsAvailable = stasisLimit - currentLinks;
    for (const candidate of candidates.slice(0, slotsAvailable)) {
        const success = await execStasisLink(ns, candidate.hostname, true, options);
        if (success) {
            state.stasisServers.add(candidate.hostname);
            log(ns, `Applied stasis link to ${candidate.hostname}`);
        }
    }
}

/**
 * Execute a stasis link toggle on a target server by writing and running
 * a temporary helper script ON that server.
 */
async function execStasisLink(ns, hostname, enable, options) {
    if (options['dry-run']) {
        log(ns, `[DRY-RUN] Would ${enable ? 'set' : 'remove'} stasis link on ${hostname}`);
        return false;
    }

    try {
        ns.write(STASIS_HELPER_SCRIPT, STASIS_HELPER_CONTENT, 'w');

        ns.scp(STASIS_HELPER_SCRIPT, hostname, 'home');


        const pid = ns.exec(STASIS_HELPER_SCRIPT, hostname, 1, String(enable));
        if (pid <= 0) {
            if (options.verbose) {
                log(ns, `WARN: Failed to exec stasis helper on ${hostname}`, false, 'warning');
            }
            return false;
        }

        let waited = 0;
        while (waited < 5000) {
            await ns.sleep(100);
            waited += 100;
            const running = ns.ps(hostname).some(p => p.pid === pid);
            if (!running) break;
        }

        return true;
    } catch (err) {
        if (options.verbose) {
            log(ns, `WARN: Stasis link failed on ${hostname}: ${getErrorInfo(err)}`, false, 'warning');
        }
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
    const maxLoops = options['migration-charge-loops'];

    // Find servers near air gaps that could benefit from migration
    for (const [hostname, info] of state.discoveredServers) {
        if (!info.hasAdmin) continue;
        if (!info.isOnline) continue;

        const depth = state.serverDepths.get(hostname);
        if (depth === undefined || depth === null) continue;

        // Only charge servers that are just below an air gap
        // (depth just above a multiple of AIR_GAP_DEPTH, meaning they're blocked)
        const rowBelowGap = depth % AIR_GAP_DEPTH;
        if (rowBelowGap !== 1 && rowBelowGap !== 2) continue; // Only charge if 1-2 rows below gap

        // Ensure we're connected/have session
        if (!info.isConnected && !state.stasisServers.has(hostname)) continue;

        if (verbose) log(ns, `Charging migration for ${hostname} (depth: ${depth})`);

        for (let i = 0; i < maxLoops; i++) {
            try {
                const chargeResult = ns.dnet.chargeServerMigration(hostname);
                if (chargeResult?.migrated) {
                    log(ns, `SUCCESS: ${hostname} migrated across air gap!`, true, 'success');
                    break;
                }
                if (chargeResult?.charge >= 1.0) {
                    log(ns, `Migration charged for ${hostname}, awaiting migration`);
                    break;
                }
            } catch (err) {
                if (verbose) log(ns, `Migration charge failed for ${hostname}: ${getErrorInfo(err)}`);
                break;
            }
        }
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

    for (const [hostname, info] of state.discoveredServers) {
        if (!info.hasAdmin) continue;

        try {
            const files = ns.ls(hostname);
            const clueFiles = files.filter(f => f.endsWith(CLUE_FILE_SUFFIX));

            for (const clueFile of clueFiles) {
                const cacheKey = `${hostname}:${clueFile}`;
                if (state.scannedClueFiles.has(cacheKey)) continue;

                const content = ns.read(clueFile);
                if (!content) {
                    state.scannedClueFiles.add(cacheKey);
                    continue;
                }

                const clues = parseClueFile(content);

                // Process password clues
                for (const clue of clues.passwords) {
                    if (clue.hostname && clue.password) {
                        // Full hostname + password clue
                        if (!state.knownPasswords.has(clue.hostname)) {
                            state.cluePasswords.set(clue.hostname, clue.password);
                            newCluesFound++;
                            if (verbose) log(ns, `CLUE: Found password for ${clue.hostname} in ${clueFile} on ${hostname}`);
                        }
                    } else if (clue.password && !clue.hostname) {
                        // Password without hostname — try it on nearby unknown servers
                        for (const [nearHost, nearInfo] of state.discoveredServers) {
                            if (nearInfo.hasAdmin) continue;
                            if (state.knownPasswords.has(nearHost) || state.cluePasswords.has(nearHost)) continue;
                            state.cluePasswords.set(nearHost, clue.password);
                        }
                    }
                }

                state.scannedClueFiles.add(cacheKey);
            }
        } catch {
            // Server offline or inaccessible
        }
    }

    if (newCluesFound > 0) {
        state.saveScannedClues(ns);
        log(ns, `CLUE: Found ${newCluesFound} new password clues from data files`);
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
    const lines = String(content || '').split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Match "hostname: X, password: Y" or "host: X password: Y" patterns
        const fullMatch = trimmed.match(/host(?:name)?[:\s]+([^\s,]+)[,\s]+password[:\s]+['"]?([^'"}\s,]+)/i);
        if (fullMatch) {
            passwords.push({ hostname: fullMatch[1], password: fullMatch[2] });
            continue;
        }

        // Match standalone "password: Y" or "pwd: Y"
        const pwdMatch = trimmed.match(/(?:password|pwd|pass)[:\s]+['"]?([^'"}\s,]+)/i);
        if (pwdMatch) {
            passwords.push({ hostname: null, password: pwdMatch[1] });
            continue;
        }

        // Match "auth: Y" or "authenticate: Y"
        const authMatch = trimmed.match(/auth(?:enticate)?[:\s]+['"]?([^'"}\s,]+)/i);
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
        if (hostname === 'home') continue;
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
        enablePhishing: Boolean(options['enable-phishing']),
        enableStockManipulation: Boolean(options['enable-stock-manipulation']),
        targetStock: options['target-stock'] ?? '',
        probeVersion: PROBE_VERSION,
    };
    try {
        ns.write(OPTIONS_FILE, JSON.stringify(payload), 'w');
    } catch { }
}

// ─── Status Logging ──────────────────────────────────────────────────────────

function logStatus(ns, state, verbose) {
    const adminCount = Array.from(state.discoveredServers.values()).filter(s => s.hasAdmin).length;
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
        const changed = Object.keys(stats).some(k => stats[k] !== state.lastStats[k]);
        if (changed || (now - state.lastStatusLog) > 60000) {
            const delta = Object.fromEntries(
                Object.keys(stats).map(k => [k, stats[k] - (state.lastStats[k] ?? 0)])
            );
            log(ns, `Darknet: discovered ${stats.discovered}(${fmtDelta(delta.discovered)}), ` +
                `admin ${stats.admin}(${fmtDelta(delta.admin)}), ` +
                `passwords ${stats.passwords}(${fmtDelta(delta.passwords)}), ` +
                `probes ${stats.probes}(${fmtDelta(delta.probes)}), ` +
                `stasis ${stats.stasis}(${fmtDelta(delta.stasis)}), ` +
                `clues ${stats.clues}(${fmtDelta(delta.clues)})`);
            state.lastStats = stats;
            state.lastStatusLog = now;
        }
    }
}

function fmtDelta(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}
