import { getConfiguration, getNsDataThroughFile, log } from "./helpers.js";

/** Run timeline logger. Every few minutes, appends one JSON line describing where the run stands (installs, hacking
 * level vs the World Daemon's requirement, money and income, Bladeburner, gang, corp, Daedalus reputation) to
 * /data/run-timeline.txt. A gap between lines much longer than the interval means the game was closed or frozen.
 * Summarise with tools/run-timeline/timeline.py. Started by autopilot.js. */
const argsSchema = [
    ["interval-minutes", 5],
    ["max-file-kb", 3000], // When the log grows past this, keep only its newer half
];
export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

const LOG_FILE = "/data/run-timeline.txt";
const AUGS_FILE = "/Temp/affordable-augs.txt"; // written by faction-manager.js
const WORLD_DAEMON = "w0r1d_d43m0n";

// Each command's source is constant (the engine caches every distinct script source). Failures return null.
const tryCall = (body) => `(() => { try { return ${body}; } catch { return null; } })()`;
const COMMANDS = {
    reset: `ns.getResetInfo()`,
    player: `(p => ({ hack: p.skills.hacking, money: p.money, karma: p.karma, city: p.city }))(ns.getPlayer())`,
    income: `ns.getTotalScriptIncome()[0]`,
    daemonReq: tryCall(`ns.getServerRequiredHackingLevel(ns.args[0])`),
    work: tryCall(`ns.singularity.getCurrentWork()?.type ?? null`),
    daedalus: tryCall(`ns.singularity.getFactionRep("Daedalus")`),
    bladeburner: tryCall(
        `ns.bladeburner.inBladeburner() ? { rank: ns.bladeburner.getRank(), next: ns.bladeburner.getNextBlackOp(), action: ns.bladeburner.getCurrentAction()?.name ?? null } : null`,
    ),
    gang: tryCall(
        `ns.gang.inGang() ? (g => ({ respect: g.respect, territory: g.territory, members: ns.gang.getMemberNames().length }))(ns.gang.getGangInformation()) : null`,
    ),
    corp: tryCall(
        `ns.corporation.hasCorporation() ? (c => ({ funds: c.funds, investorShares: c.investorShares, public: c.public, divisions: c.divisions.length }))(ns.corporation.getCorporation()) : null`,
    ),
};

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    ns.disableLog("ALL");
    const intervalMs = options["interval-minutes"] * 60_000;
    let lastWrite = 0;
    while (true) {
        try {
            const snap = { t: Date.now() };
            for (const [key, command] of Object.entries(COMMANDS)) {
                const args = key === "daemonReq" ? [WORLD_DAEMON] : [];
                snap[key] = await getNsDataThroughFile(ns, command, `/Temp/run-logger-${key}.txt`, args);
            }
            const reset = snap.reset;
            delete snap.reset;
            snap.bn = `${reset.currentNode}`;
            snap.sinceAugH = +((snap.t - reset.lastAugReset) / 3.6e6).toFixed(3);
            snap.sinceNodeH = +((snap.t - reset.lastNodeReset) / 3.6e6).toFixed(3);
            const owned = reset.ownedAugs instanceof Map ? reset.ownedAugs : new Map(Object.entries(reset.ownedAugs ?? {}));
            snap.nf = owned.get("NeuroFlux Governor") ?? 0;
            snap.installed = owned.size;
            snap.redPill = owned.has("The Red Pill");
            try {
                const augs = JSON.parse(ns.read(AUGS_FILE) || "null");
                if (augs) snap.augs = { affordable: augs.affordable_count_ex_nf, awaiting: augs.awaiting_install_count_ex_nf, unpurchased: augs.unpurchased_count, cost: augs.total_aug_cost };
            } catch {
                /* faction-manager hasn't written it yet */
            }
            // Sleeves (from the files sleeve.js keeps up to date; no RAM): tasks, average shock and strength
            try {
                const unwrap = (f) => { const v = JSON.parse(ns.read(f) || "null"); return v?.$value ?? v; };
                const tasks = unwrap("/Temp/sleeve-getTask-all.txt"), sleeves = unwrap("/Temp/sleeve-getSleeve-all.txt");
                if (Array.isArray(tasks) && Array.isArray(sleeves) && sleeves.length) {
                    const counts = {};
                    for (const t of tasks) {
                        const k = t ? `${t.type}${t.crimeType ? ":" + t.crimeType : t.classType ? ":" + t.classType : ""}` : "IDLE";
                        counts[k] = (counts[k] ?? 0) + 1;
                    }
                    const avg = (f) => +(sleeves.reduce((a, x) => a + f(x), 0) / sleeves.length).toFixed(1);
                    snap.sleeves = { tasks: counts, shock: avg((x) => x.shock), str: avg((x) => x.skills.strength), sync: avg((x) => x.sync) };
                }
            } catch {
                /* sleeve.js hasn't written its files yet */
            }
            // Gaps: the game was closed, frozen, or this script wasn't running
            const previous = lastWrite || lastLineTime(ns);
            if (previous && snap.t - previous > 3 * intervalMs) snap.gapH = +((snap.t - previous) / 3.6e6).toFixed(3);
            append(ns, JSON.stringify(snap), options["max-file-kb"]);
            lastWrite = snap.t;
        } catch (err) {
            log(ns, `WARNING: run-logger snapshot failed: ${err?.message ?? err}`);
        }
        await ns.sleep(intervalMs);
    }
}

function lastLineTime(ns) {
    const lines = ns.read(LOG_FILE).trimEnd().split("\n");
    try {
        return JSON.parse(lines[lines.length - 1]).t;
    } catch {
        return 0;
    }
}

function append(ns, line, maxKb) {
    const existing = ns.read(LOG_FILE);
    if (existing.length > maxKb * 1000) {
        const keep = existing.slice(existing.length / 2);
        ns.write(LOG_FILE, keep.slice(keep.indexOf("\n") + 1) + line + "\n", "w");
    } else ns.write(LOG_FILE, line + "\n", "a");
}
