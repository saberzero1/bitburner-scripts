import { getConfiguration, formatRam, formatMoney } from "./helpers.js";
import { estimateCrackDifficulty } from "./darknet-helpers.js";

/**
 * Darknet Network Scanner for BitNode 15
 *
 * Terminal-based network visualizer that displays the darknet topology,
 * server details, authentication status, model types, and difficulty tiers.
 *
 * Features:
 * - Scans all directly connected darknet servers from current position
 * - Loads persisted data from orchestrator (passwords, clue cache)
 * - Shows network instability metrics (backdoor penalty, timeout chance)
 * - Color-coded status: authenticated, online, offline, stasis, cache
 * - Displays depth, model ID, difficulty tier, RAM, blocked RAM
 * - Shows password hints for unauthenticated servers
 * - Summarizes stasis link usage and network health
 * - Supports --json output for programmatic consumption
 *
 * Usage:
 *   run darknet-scan.js              — Full scan from terminal
 *   run darknet-scan.js --json       — Output JSON instead of HTML
 *   run darknet-scan.js --hide-stats — Omit RAM/blocked-RAM details
 *   run darknet-scan.js --compact    — Minimal output (no hints)
 */

const argsSchema = [
    ["hide-stats", false], // Hide RAM and blocked RAM stats
    ["compact", false], // Compact output — no hints or extra details
    ["json", false], // Output as JSON instead of terminal HTML
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PASSWORD_FILE = "/data/darknet-passwords.txt";
const CLUE_CACHE_FILE = "/data/darknet-clues-scanned.txt";

const TIER_LABELS = {
    0: "trivial",
    1: "easy",
    2: "medium",
    3: "hard",
    4: "expert",
};

const TIER_COLORS = {
    0: "#4caf50", // green
    1: "#8bc34a", // light green
    2: "#ffeb3b", // yellow
    3: "#ff9800", // orange
    4: "#f44336", // red
};

// ─── Entry Point ────────────────────────────────────────────────────────────

/** @param {NS} ns */
export function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    const showStats = !options["hide-stats"];
    const compact = options["compact"];
    const jsonOutput = options["json"];

    // Check prerequisites
    if (!ns.fileExists("DarkscapeNavigator.exe", "home")) {
        ns.tprint("ERROR: DarkscapeNavigator.exe required. Buy from darkweb.");
        return;
    }

    // ─── Gather data ────────────────────────────────────────────────────

    const currentHost = ns.getHostname();
    const knownPasswords = loadPasswords(ns);
    const nearbyServers = safeProbe(ns);
    const stasisServers = safeGetStasisServers(ns);
    const stasisLimit = safeGetStasisLimit(ns);
    const instability = safeGetInstability(ns);

    // Gather details for each nearby server
    const serverDetails = [];
    for (const hostname of nearbyServers) {
        const info = gatherServerInfo(
            ns,
            hostname,
            knownPasswords,
            stasisServers,
        );
        if (info) serverDetails.push(info);
    }

    // Sort: authenticated first, then by depth (shallow first), then by tier
    serverDetails.sort((a, b) => {
        // Authenticated servers first
        if (a.hasAdmin !== b.hasAdmin) return a.hasAdmin ? -1 : 1;
        // Then by depth (ascending)
        if (a.depth !== b.depth) return (a.depth ?? 999) - (b.depth ?? 999);
        // Then by tier (ascending = easier first)
        return (a.tier ?? 99) - (b.tier ?? 99);
    });

    // ─── Output ─────────────────────────────────────────────────────────

    if (jsonOutput) {
        outputJson(
            ns,
            currentHost,
            serverDetails,
            knownPasswords,
            stasisServers,
            stasisLimit,
            instability,
        );
    } else {
        outputTerminal(
            ns,
            currentHost,
            serverDetails,
            knownPasswords,
            stasisServers,
            stasisLimit,
            instability,
            showStats,
            compact,
        );
    }
}

// ─── Data Gathering ─────────────────────────────────────────────────────────

function gatherServerInfo(ns, hostname, knownPasswords, stasisServers) {
    let details;
    try {
        details = ns.dnet.getServerAuthDetails(hostname);
    } catch {
        return null;
    }
    if (!details) return null;

    let depth = null;
    try {
        depth = ns.dnet.getDepth(hostname);
    } catch {}
    if (depth === -1) depth = null;

    let blockedRam = 0;
    try {
        blockedRam = ns.dnet.getBlockedRam(hostname);
    } catch {}

    let maxRam = 0;
    let usedRam = 0;
    try {
        maxRam = ns.getServerMaxRam(hostname);
        usedRam = ns.getServerUsedRam(hostname);
    } catch {}

    let requiredCharisma = -1;
    try {
        requiredCharisma = ns.dnet.getServerRequiredCharismaLevel(hostname);
    } catch {}

    const difficulty = estimateCrackDifficulty({ modelId: details.modelId });
    const hasStasis = stasisServers.has(hostname);
    const hasPassword = knownPasswords.has(hostname);
    const hasCaches = details.hasAdminRights
        ? safeLsCaches(ns, hostname)
        : false;

    return {
        hostname,
        modelId: details.modelId || "unknown",
        isOnline: details.isOnline,
        isConnected: details.isConnectedToCurrentServer,
        hasSession: details.hasSession,
        hasAdmin: details.hasAdminRights,
        hasStasis,
        hasPassword,
        hasCaches,
        depth,
        maxRam,
        usedRam,
        blockedRam,
        requiredCharisma,
        passwordHint: details.passwordHint || details.staticPasswordHint || "",
        passwordHintData: details.passwordHintData || "",
        passwordFormat: details.passwordFormat || "",
        passwordLength: details.passwordLength || 0,
        tier: difficulty.tier,
        tierLabel: difficulty.label,
    };
}

// ─── Terminal HTML Output ───────────────────────────────────────────────────

function outputTerminal(
    ns,
    currentHost,
    servers,
    knownPasswords,
    stasisServers,
    stasisLimit,
    instability,
    showStats,
    compact,
) {
    const doc = eval("document");
    const terminalInput = doc.getElementById("terminal-input");
    if (!terminalInput) {
        // Fallback to tprint if not in terminal
        outputTprint(
            ns,
            currentHost,
            servers,
            knownPasswords,
            stasisServers,
            stasisLimit,
            instability,
            showStats,
            compact,
        );
        return;
    }

    function terminalInsert(html) {
        const term = doc.getElementById("terminal");
        if (!term) return;
        term.insertAdjacentHTML("beforeend", `<li>${html}</li>`);
    }

    // Inject CSS
    const cssId = "dnetScanCSS";
    doc.getElementById(cssId)?.remove();
    const css = `<style id="${cssId}">
        .dnetscan { white-space: pre; color: #c0c; font: 14px consolas, monospace; line-height: 18px; }
        .dnetscan .header { color: #f0f; font-weight: bold; }
        .dnetscan .subheader { color: #a8a; }
        .dnetscan .server { cursor: pointer; text-decoration: underline; }
        .dnetscan .authenticated { color: #0f0; }
        .dnetscan .session { color: #8f8; }
        .dnetscan .online { color: #c0c; }
        .dnetscan .offline { color: #666; }
        .dnetscan .stasis { color: #ff0; }
        .dnetscan .cache { color: #0ff; }
        .dnetscan .tier0 { color: #4caf50; }
        .dnetscan .tier1 { color: #8bc34a; }
        .dnetscan .tier2 { color: #ffeb3b; }
        .dnetscan .tier3 { color: #ff9800; }
        .dnetscan .tier4 { color: #f44336; }
        .dnetscan .dim { color: #888; }
        .dnetscan .stats { color: #a8a; }
        .dnetscan .hint { color: #88f; }
        .dnetscan .warn { color: #f80; }
        .dnetscan .separator { color: #606; }
    </style>`;
    doc.head.insertAdjacentHTML("beforeend", css);

    // ─── Build output ───────────────────────────────────────────────

    let out = "";

    // Header
    out += `<span class="header">╔══════════════════════════════════════════════════╗</span>\n`;
    out += `<span class="header">║        DARKNET NETWORK SCANNER v2.0              ║</span>\n`;
    out += `<span class="header">╚══════════════════════════════════════════════════╝</span>\n`;
    out += `\n`;

    // Summary
    const adminCount = servers.filter((s) => s.hasAdmin).length;
    const onlineCount = servers.filter((s) => s.isOnline).length;
    const offlineCount = servers.filter((s) => !s.isOnline).length;

    out += `<span class="subheader">Scanning from:</span> <span class="authenticated">${escapeHtml(currentHost)}</span>\n`;
    out += `<span class="subheader">Nearby servers:</span> ${servers.length} (${onlineCount} online, ${offlineCount} offline)\n`;
    out += `<span class="subheader">Admin access:</span>  <span class="authenticated">${adminCount}</span> / ${servers.length}\n`;
    out += `<span class="subheader">Known passwords:</span> ${knownPasswords.size}\n`;
    out += `<span class="subheader">Stasis links:</span>   ${stasisServers.size} / ${stasisLimit >= 0 ? stasisLimit : "?"}\n`;

    // Instability warning
    if (instability) {
        const authMult = instability.authenticationDurationMultiplier ?? 1;
        const timeoutChance = instability.authenticationTimeoutChance ?? 0;
        if (authMult > 1.05 || timeoutChance > 0.01) {
            out += `<span class="warn">⚠ Instability:</span> auth ×${authMult.toFixed(2)}, timeout ${(timeoutChance * 100).toFixed(1)}%\n`;
        } else {
            out += `<span class="dim">Network stable (auth ×${authMult.toFixed(2)})</span>\n`;
        }
    }

    out += `\n<span class="separator">──────────────────────────────────────────────────</span>\n\n`;

    // Server list
    if (servers.length === 0) {
        out += `<span class="dim">No darknet servers found nearby.</span>\n`;
    } else {
        for (let i = 0; i < servers.length; i++) {
            const s = servers[i];
            const isLast = i === servers.length - 1;
            const connector = isLast ? "└" : "├";
            const continuation = isLast ? " " : "│";

            // Status class
            let statusClass = "online";
            if (!s.isOnline) statusClass = "offline";
            else if (s.hasAdmin) statusClass = "authenticated";
            else if (s.hasSession) statusClass = "session";

            // Main server line
            out += `${connector}─ `;
            out += `<span class="server ${statusClass}">${escapeHtml(s.hostname)}</span>`;

            // Badges
            if (s.hasStasis) out += ` <span class="stasis">[STASIS]</span>`;
            if (s.hasCaches) out += ` <span class="cache">[CACHE]</span>`;
            if (s.hasPassword) out += ` <span class="dim">[PWD]</span>`;
            if (!s.isOnline) out += ` <span class="offline">[OFFLINE]</span>`;

            out += `\n`;

            // Detail line: model, tier, depth
            const tierClass = s.tier !== null ? `tier${s.tier}` : "dim";
            const tierText = s.tierLabel || "unknown";
            const depthText = s.depth !== null ? `d:${s.depth}` : "d:?";

            out += `${continuation}  `;
            out += `<span class="${tierClass}">${escapeHtml(s.modelId)}</span>`;
            out += ` <span class="dim">[${tierText}]</span>`;
            out += ` <span class="dim">${depthText}</span>`;

            if (s.passwordFormat && !s.hasAdmin) {
                out += ` <span class="dim">${s.passwordFormat}`;
                if (s.passwordLength > 0) out += `:${s.passwordLength}`;
                out += `</span>`;
            }

            out += `\n`;

            // Stats line (optional)
            if (showStats && s.isOnline) {
                const freeRam = Math.max(0, s.maxRam - s.usedRam);
                out += `${continuation}  <span class="stats">`;
                out += `RAM: ${formatRam(freeRam)}/${formatRam(s.maxRam)}`;
                if (s.blockedRam > 0)
                    out += ` (${formatRam(s.blockedRam)} blocked)`;
                if (s.requiredCharisma > 0) out += ` CHA≥${s.requiredCharisma}`;
                out += `</span>\n`;
            }

            // Hint line (optional, only for unauthenticated)
            if (!compact && !s.hasAdmin && s.passwordHint) {
                out += `${continuation}  <span class="hint">Hint: ${escapeHtml(truncate(s.passwordHint, 60))}</span>\n`;
            }
        }
    }

    // Tier legend
    out += `\n<span class="separator">──────────────────────────────────────────────────</span>\n`;
    out += `<span class="dim">Tiers: `;
    out += `<span class="tier0">■ trivial</span> `;
    out += `<span class="tier1">■ easy</span> `;
    out += `<span class="tier2">■ medium</span> `;
    out += `<span class="tier3">■ hard</span> `;
    out += `<span class="tier4">■ expert</span>`;
    out += `</span>\n`;
    out += `<span class="dim">Status: `;
    out += `<span class="authenticated">■ admin</span> `;
    out += `<span class="session">■ session</span> `;
    out += `<span class="online">■ online</span> `;
    out += `<span class="offline">■ offline</span> `;
    out += `<span class="stasis">■ stasis</span> `;
    out += `<span class="cache">■ cache</span>`;
    out += `</span>`;

    terminalInsert(`<div class="dnetscan">${out}</div>`);
}

// ─── Fallback tprint output ─────────────────────────────────────────────────

function outputTprint(
    ns,
    currentHost,
    servers,
    knownPasswords,
    stasisServers,
    stasisLimit,
    instability,
    showStats,
    compact,
) {
    const adminCount = servers.filter((s) => s.hasAdmin).length;
    const onlineCount = servers.filter((s) => s.isOnline).length;

    ns.tprint(`\n=== DARKNET NETWORK SCANNER v2.0 ===`);
    ns.tprint(`Scanning from: ${currentHost}`);
    ns.tprint(
        `Nearby: ${servers.length} servers (${onlineCount} online, ${adminCount} admin)`,
    );
    ns.tprint(
        `Known passwords: ${knownPasswords.size} | Stasis: ${stasisServers.size}/${stasisLimit >= 0 ? stasisLimit : "?"}`,
    );

    if (instability) {
        const authMult = instability.authenticationDurationMultiplier ?? 1;
        const timeoutChance = instability.authenticationTimeoutChance ?? 0;
        if (authMult > 1.05 || timeoutChance > 0.01) {
            ns.tprint(
                `WARNING: Instability — auth ×${authMult.toFixed(2)}, timeout ${(timeoutChance * 100).toFixed(1)}%`,
            );
        }
    }

    ns.tprint(`─────────────────────────────────────`);

    for (const s of servers) {
        let status = s.isOnline
            ? s.hasAdmin
                ? "✓"
                : s.hasSession
                  ? "◉"
                  : "○"
            : "✗";
        let badges = "";
        if (s.hasStasis) badges += " [STASIS]";
        if (s.hasCaches) badges += " [CACHE]";
        if (s.hasPassword) badges += " [PWD]";

        const tierText = s.tierLabel || "?";
        const depthText = s.depth !== null ? `d:${s.depth}` : "d:?";

        ns.tprint(
            `${status} ${s.hostname} — ${s.modelId} [${tierText}] ${depthText}${badges}`,
        );

        if (showStats && s.isOnline) {
            const freeRam = Math.max(0, s.maxRam - s.usedRam);
            let statsLine = `    RAM: ${formatRam(freeRam)}/${formatRam(s.maxRam)}`;
            if (s.blockedRam > 0)
                statsLine += ` (${formatRam(s.blockedRam)} blocked)`;
            if (s.requiredCharisma > 0)
                statsLine += ` CHA≥${s.requiredCharisma}`;
            ns.tprint(statsLine);
        }

        if (!compact && !s.hasAdmin && s.passwordHint) {
            ns.tprint(`    Hint: ${truncate(s.passwordHint, 60)}`);
        }
    }

    ns.tprint(`─────────────────────────────────────`);
}

// ─── JSON Output ────────────────────────────────────────────────────────────

function outputJson(
    ns,
    currentHost,
    servers,
    knownPasswords,
    stasisServers,
    stasisLimit,
    instability,
) {
    const output = {
        timestamp: Date.now(),
        currentHost,
        summary: {
            total: servers.length,
            online: servers.filter((s) => s.isOnline).length,
            admin: servers.filter((s) => s.hasAdmin).length,
            knownPasswords: knownPasswords.size,
            stasisLinks: stasisServers.size,
            stasisLimit: stasisLimit >= 0 ? stasisLimit : null,
            instability: instability ?? null,
        },
        servers,
    };
    ns.tprint(JSON.stringify(output, null, 2));
}

// ─── Safe API Wrappers ──────────────────────────────────────────────────────

function safeProbe(ns) {
    try {
        return ns.dnet.probe() || [];
    } catch {
        return [];
    }
}

function safeGetStasisServers(ns) {
    try {
        return new Set(ns.dnet.getStasisLinkedServers() || []);
    } catch {
        return new Set();
    }
}

function safeGetStasisLimit(ns) {
    try {
        return ns.dnet.getStasisLinkLimit();
    } catch {
        return -1;
    }
}

function safeGetInstability(ns) {
    try {
        return ns.dnet.getDarknetInstability();
    } catch {
        return null;
    }
}

function safeLsCaches(ns, hostname) {
    try {
        return ns.ls(hostname, ".cache").length > 0;
    } catch {
        return false;
    }
}

function loadPasswords(ns) {
    try {
        const data = ns.read(PASSWORD_FILE);
        if (data) return new Map(Object.entries(JSON.parse(data)));
    } catch {}
    return new Map();
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function truncate(str, maxLen) {
    if (!str) return "";
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + "...";
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
