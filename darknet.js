import {
    log, getFilePath, getConfiguration, disableLogs, formatRam,
    getErrorInfo
} from './helpers.js'
import { getDarknetPasswordSolver, tryFormatBruteforce, solveLabyrinth } from './darknet-helpers.js'

/**
 * Darknet Orchestrator for BitNode 15
 * 
 * Main controller script that manages darknet exploration, server authentication,
 * cache looting, and resource extraction. Designed to work standalone in BN15
 * and integrate with daemon.js for other bitnodes.
 */

const argsSchema = [
    ['tail', false], // Open a tail window for this script
    ['interval', 5000], // Main loop interval in ms
    ['max-probes', 10], // Maximum number of probe scripts to have running simultaneously
    ['enable-phishing', true], // Enable phishing attacks for money/charisma
    ['enable-stock-manipulation', false], // Enable stock manipulation via promoteStock
    ['target-stock', ''], // Stock symbol to manipulate (if enabled)
    ['stasis-priority', ['high-ram', 'high-value']], // Priority for stasis link allocation
    ['verbose', false], // Extra logging
    ['dry-run', false], // Don't actually execute, just log what would be done
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    if (options.tail) (ns.ui?.openTail ? ns.ui.openTail() : ns.tail());

    disableLogs(ns, ['sleep', 'scan', 'getServerMaxRam', 'getServerUsedRam', 'scp', 'exec']);

    // Check if darknet is available
    if (!ns.fileExists('DarkscapeNavigator.exe', 'home')) {
        log(ns, 'ERROR: DarkscapeNavigator.exe not found. Purchase it from the darkweb to access the darknet.', true, 'error');
        return;
    }

    // Initialize state
    const state = new DarknetState(ns, options);

    log(ns, 'INFO: Darknet orchestrator starting...', true, 'info');

    // Main loop
    while (true) {
        try {
            writeProbeOptions(ns, options);
            await state.refresh(ns);
            await orchestrateDarknet(ns, state, options);
        } catch (err) {
            log(ns, `WARNING: Darknet orchestrator encountered error: ${getErrorInfo(err)}`, false, 'warning');
        }
        await ns.sleep(options.interval);
    }
}

/**
 * Maintains state about darknet servers, passwords, and active operations
 */
class DarknetState {
    constructor(ns, options) {
        this.options = options;
        this.discoveredServers = new Map(); // hostname -> DarknetServerInfo
        this.knownPasswords = new Map(); // hostname -> password
        this.activeProbes = new Set(); // Set of hostnames with active probe scripts
        this.stasisServers = new Set(); // Set of hostnames with stasis links
        this.lastRefresh = 0;
        this.lastStatusLog = 0;
        this.lastStats = { discovered: 0, passwords: 0, probes: 0, stasis: 0, admin: 0 };
        this.probeVersion = 4;
        this.lastAuthLog = new Map();

        // Load persisted passwords from file
        this.loadPasswords(ns);
    }

    loadPasswords(ns) {
        try {
            const data = ns.read('/data/darknet-passwords.txt');
            if (data) {
                const parsed = JSON.parse(data);
                for (const [host, pwd] of Object.entries(parsed)) {
                    this.knownPasswords.set(host, pwd);
                }
                log(ns, `INFO: Loaded ${this.knownPasswords.size} saved passwords`);
            }
        } catch {
            // File doesn't exist or is invalid, that's fine
        }
    }

    savePasswords(ns) {
        const data = JSON.stringify(Object.fromEntries(this.knownPasswords));
        ns.write('/data/darknet-passwords.txt', data, 'w');
    }

    async refresh(ns) {
        // Update stasis link info
        try {
            const stasisServers = ns.dnet.getStasisLinkedServers();
            this.stasisServers = new Set(stasisServers);
        } catch {
            // May not have the function available
        }

        this.lastRefresh = Date.now();
    }

    addPassword(ns, hostname, password) {
        this.knownPasswords.set(hostname, password);
        this.savePasswords(ns);
    }

    getPassword(hostname) {
        return this.knownPasswords.get(hostname);
    }
}

/**
 * Server info wrapper for darknet servers
 */
class DarknetServerInfo {
    constructor(hostname, authDetails) {
        this.hostname = hostname;
        this.modelId = authDetails.modelId;
        this.passwordHint = authDetails.passwordHint;
        this.isOnline = authDetails.isOnline;
        this.isConnected = authDetails.isConnectedToCurrentServer;
        this.hasSession = authDetails.hasSession;
        this.hasAdmin = authDetails.hasAdminRights;
        this.passwordFormat = authDetails.passwordFormat;
        this.passwordLength = authDetails.passwordLength;
        this.lastSeen = Date.now();
    }
}

/**
 * Main orchestration logic
 * @param {NS} ns 
 * @param {DarknetState} state 
 * @param {Object} options 
 */
async function orchestrateDarknet(ns, state, options) {
    const verbose = options.verbose;

    // Step 1: Ensure we have probes deployed from home
    const homeProbes = await ensureHomeProbes(ns, state, options);

    // Step 2: Check servers accessible from home
    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
        await processServer(ns, state, hostname, 'home', options);
    }

    // Step 3: Manage stasis links
    await manageStasisLinks(ns, state, options);

    // Step 4: Clean up orphaned probes (servers that went offline)
    await cleanupOrphanedProbes(ns, state);

    const adminCount = Array.from(state.discoveredServers.values()).filter(s => s.hasAdmin).length;
    const stats = {
        discovered: state.discoveredServers.size,
        passwords: state.knownPasswords.size,
        probes: state.activeProbes.size,
        stasis: state.stasisServers.size,
        admin: adminCount
    };
    if (verbose) {
        log(ns, `Darknet Status: ${JSON.stringify(stats)}`);
    } else {
        const now = Date.now();
        const changed = Object.keys(stats).some(k => stats[k] !== state.lastStats[k]);
        if (changed || (now - state.lastStatusLog) > 60000) {
            const delta = Object.fromEntries(Object.keys(stats).map(k => [k, stats[k] - state.lastStats[k]]));
            log(ns, `Darknet Progress: discovered ${stats.discovered} (${delta.discovered >= 0 ? '+' : ''}${delta.discovered}), ` +
                `admin ${stats.admin} (${delta.admin >= 0 ? '+' : ''}${delta.admin}), ` +
                `passwords ${stats.passwords} (${delta.passwords >= 0 ? '+' : ''}${delta.passwords}), ` +
                `probes ${stats.probes} (${delta.probes >= 0 ? '+' : ''}${delta.probes}), ` +
                `stasis ${stats.stasis} (${delta.stasis >= 0 ? '+' : ''}${delta.stasis})`);
            state.lastStats = stats;
            state.lastStatusLog = now;
        }
    }
}

/**
 * Process a single darknet server
 */
async function processServer(ns, state, hostname, currentServer, options) {
    const verbose = options.verbose;

    // Get server details
    const details = ns.dnet.getServerAuthDetails(hostname);
    if (!details.isOnline) {
        if (verbose) log(ns, `Server ${hostname} is offline`);
        return;
    }

    // Update our knowledge
    const serverInfo = new DarknetServerInfo(hostname, details);
    state.discoveredServers.set(hostname, serverInfo);

    // If we already have admin, do exploitation
    if (details.hasAdminRights) {
        // Deploy probe if not already running
        await deployProbe(ns, state, hostname, options);
        return;
    }

    // If we don't have admin, try to authenticate
    if (!details.isConnectedToCurrentServer && !state.stasisServers.has(hostname)) {
        if (verbose) log(ns, `Skipping auth for ${hostname}: not connected`, false, 'warning');
        return;
    }
    const success = await authenticateServer(ns, state, hostname, serverInfo, options);
    if (success) {
        await deployProbe(ns, state, hostname, options);
    }
}

/**
 * Attempt to authenticate with a server
 */
async function authenticateServer(ns, state, hostname, serverInfo, options) {
    const verbose = options.verbose;

    // Check if we already know the password
    const hasKnownPassword = state.knownPasswords.has(hostname);
    const knownPassword = hasKnownPassword ? state.getPassword(hostname) : undefined;
    if (hasKnownPassword) {
        if (verbose) log(ns, `Trying known password for ${hostname}`);
        const result = await ns.dnet.authenticate(hostname, knownPassword ?? '');
        if (result.success) {
            log(ns, `SUCCESS: Authenticated ${hostname} with saved password`);
            return true;
        }
        // Password no longer valid (server restarted with new password)
        state.knownPasswords.delete(hostname);
    }

    // Try to solve based on model
    if ((serverInfo.modelId || '').toLowerCase().includes('labyrinth')) {
        const solved = await solveLabyrinth(ns, hostname);
        if (solved) {
            log(ns, `SUCCESS: Solved labyrinth on ${hostname}`);
            return true;
        }
    }

    const solver = getDarknetPasswordSolver(serverInfo.modelId);
    if (!solver) {
        if (verbose) log(ns, `No solver for model ${serverInfo.modelId} on ${hostname} (hint: ${serverInfo.passwordHint ?? ''})`);
        const fallback = await tryFormatBruteforce(ns, hostname, serverInfo);
        if (fallback !== null) {
            const result = await ns.dnet.authenticate(hostname, fallback);
            if (result.success) {
                log(ns, `SUCCESS: Cracked ${hostname} (format: ${serverInfo.passwordFormat})`);
                state.addPassword(ns, hostname, fallback);
                return true;
            }
        }
        logAuthFailure(ns, state, hostname, serverInfo);
        return false;
    }

    // Attempt to solve
    const password = await solver(ns, hostname, serverInfo);
    if (password !== null) {
        const result = await ns.dnet.authenticate(hostname, password);
        if (result.success) {
            log(ns, `SUCCESS: Cracked ${hostname} (model: ${serverInfo.modelId})`);
            state.addPassword(ns, hostname, password);
            return true;
        }
    }

    logAuthFailure(ns, state, hostname, serverInfo);
    return false;
}

function logAuthFailure(ns, state, hostname, serverInfo) {
    const now = Date.now();
    const last = state.lastAuthLog.get(hostname) ?? 0;
    if (now - last < 60000) return;
    state.lastAuthLog.set(hostname, now);
    log(ns, `WARN: Unable to auth ${hostname} (model: ${serverInfo.modelId}, format: ${serverInfo.passwordFormat}, ` +
        `length: ${serverInfo.passwordLength}, hint: ${serverInfo.passwordHint ?? ''})`, false, 'warning');
}

function writeProbeOptions(ns, options) {
    const filePath = '/data/darknet-probe-options.txt';
    const payload = {
        enablePhishing: Boolean(options['enable-phishing']),
        enableStockManipulation: Boolean(options['enable-stock-manipulation']),
        targetStock: options['target-stock'] ?? '',
    };
    try {
        ns.write(filePath, JSON.stringify(payload), 'w');
    } catch {
    }
}

/**
 * Deploy a probe script to a server
 */
async function deployProbe(ns, state, hostname, options) {
    if (state.activeProbes.has(hostname)) return;
    if (state.activeProbes.size >= options['max-probes']) return;

    const probeScript = getFilePath('/Remote/darknet-probe.js');
    
    // Check if probe script exists
    if (!ns.fileExists(probeScript, 'home')) {
        return;
    }

    try {
        // Establish session if needed
        const password = state.getPassword(hostname);
        if (password !== undefined) {
            ns.dnet.connectToSession(hostname, password);
        }

        const maxRam = ns.getServerMaxRam(hostname);
        const usedRam = ns.getServerUsedRam(hostname);
        const fullRam = ns.getScriptRam(probeScript, 'home');
        const freeRam = Math.max(0, maxRam - usedRam);
        if (fullRam > freeRam) {
            log(ns, `WARN: ${hostname} lacks RAM for probe (needs ${formatRam(fullRam)}, has ${formatRam(freeRam)} free).`,
                false, 'warning');
            return false;
        }

        // Copy probe script
        ns.scp(probeScript, hostname, 'home');
        if (!ns.fileExists(probeScript, hostname)) {
            log(ns, `WARN: Probe script missing on ${hostname} after SCP.`, false, 'warning');
            return false;
        }

        const procs = ns.ps(hostname).filter(p => p.filename === probeScript);
        const matchingProcs = procs.filter(p => Number(p.args?.[0]) === state.probeVersion);
        for (const proc of procs) {
            if (Number(proc.args?.[0]) !== state.probeVersion) {
                try { ns.kill(proc.pid); } catch { }
            }
        }
        if (matchingProcs.length > 0) {
            for (const proc of matchingProcs.slice(1)) {
                try { ns.kill(proc.pid); } catch { }
            }
            return true;
        }

        // Execute probe
        const pid = ns.exec(probeScript, hostname, 1, state.probeVersion);
        if (pid > 0) {
            state.activeProbes.add(hostname);
            log(ns, `Deployed probe to ${hostname} (pid: ${pid})`);
        } else {
            const details = ns.dnet.getServerAuthDetails(hostname);
            const ramInfo = (() => {
                try {
                    return `${formatRam(usedRam)}/${formatRam(maxRam)}`;
                } catch { return 'unknown'; }
            })();
            const scriptRam = (() => {
                try {
                    return formatRam(ns.getScriptRam(probeScript, 'home'));
                } catch { return 'unknown'; }
            })();
            log(ns, `WARN: Failed to launch probe on ${hostname}. Connected: ${details.isConnectedToCurrentServer}, ` +
                `Session: ${details.hasSession}, Admin: ${details.hasAdminRights}, RAM: ${ramInfo}, Script: ${scriptRam}`,
                false, 'warning');
        }
    } catch (err) {
        // Failed to deploy probe
    }
}

/**
 * Ensure we have probes running from home servers
 */
async function ensureHomeProbes(ns, state, options) {
    const probeScript = getFilePath('/Remote/darknet-probe.js');
    
    // Check for probe on home
    const homeProcs = ns.ps('home');
    const homeProbeProcs = homeProcs.filter(p => p.filename === probeScript);
    const matchingHomeProcs = homeProbeProcs.filter(p => Number(p.args?.[0]) === state.probeVersion);
    for (const proc of homeProbeProcs) {
        if (Number(proc.args?.[0]) !== state.probeVersion) {
            try { ns.kill(proc.pid); } catch { }
        }
    }
    if (matchingHomeProcs.length > 1) {
        for (const proc of matchingHomeProcs.slice(1)) {
            try { ns.kill(proc.pid); } catch { }
        }
    }

    if (matchingHomeProcs.length === 0 && ns.fileExists(probeScript, 'home')) {
        const maxRam = ns.getServerMaxRam('home');
        const usedRam = ns.getServerUsedRam('home');
        const scriptRam = ns.getScriptRam(probeScript, 'home');
        if (scriptRam <= Math.max(0, maxRam - usedRam)) {
            const pid = ns.exec(probeScript, 'home', 1, state.probeVersion);
            if (pid > 0) {
                state.activeProbes.add('home');
            }
        }
        return state.activeProbes.has('home');
    }
    if (matchingHomeProcs.length > 0) state.activeProbes.add('home');
    return state.activeProbes.has('home');
}

/**
 * Manage stasis links for server stability
 */
async function manageStasisLinks(ns, state, options) {
    try {
        const stasisLimit = ns.dnet.getStasisLinkLimit();
        const currentLinks = state.stasisServers.size;

        if (currentLinks >= stasisLimit) return;

        // Find best servers to stasis link based on priority
        const candidates = [];
        for (const [hostname, info] of state.discoveredServers) {
            if (state.stasisServers.has(hostname)) continue;
            if (!info.hasAdmin) continue;

            // Calculate priority score
            let score = 0;
            try {
                const serverRam = ns.getServerMaxRam(hostname);
                score += serverRam / 1024; // Prefer high RAM
            } catch {
                // Server might be offline
            }

            candidates.push({ hostname, score });
        }

        candidates.sort((a, b) => b.score - a.score);

        // Apply stasis to top candidates
        for (const candidate of candidates.slice(0, stasisLimit - currentLinks)) {
            try {
                ns.dnet.setStasisLink(true); // Must be called from the target server
                state.stasisServers.add(candidate.hostname);
                log(ns, `Applied stasis link to ${candidate.hostname}`);
            } catch {
                // Failed to apply stasis
            }
        }
    } catch {
        // Stasis API not available
    }
}

/**
 * Clean up probes on servers that went offline
 */
async function cleanupOrphanedProbes(ns, state) {
    const toRemove = [];
    for (const hostname of state.activeProbes) {
        if (hostname === 'home') continue;

        try {
            const details = ns.dnet.getServerAuthDetails(hostname);
            if (!details.isOnline) {
                toRemove.push(hostname);
            }
        } catch {
            toRemove.push(hostname);
        }
    }

    for (const hostname of toRemove) {
        state.activeProbes.delete(hostname);
    }
}
