import { getConfiguration, getNsDataThroughFile, log, formatMoney, formatDuration } from "./helpers.js";

/** Grafts augmentations for whatever gates the BitNode right now (SF10).
 *
 * Grafting applies an augmentation immediately, without an install, and grafted augmentations persist across installs.
 * Each graft costs 3x the augmentation's base price and (1h * log2(sum of mults) + 30m) / 2 divided by the intelligence
 * bonus, and adds one entropy: all multipliers x0.98 per entropy until the next install (unless violet Congruity
 * Implant is installed, which it grafts first when affordable in hacking mode).
 *
 * Modes (re-evaluated before every graft):
 *  - charisma: darknet.js is stuck at a labyrinth whose charisma requirement is above ours (each labyrinth reward must
 *    be installed, and installs reset charisma; levels scale with the multiplier). BN12.76: Merciless (1500) waited
 *    1.75h+ at 1.2k charisma; Enhanced Social Interaction Implant (x1.6, $4b, 47m) clears it on its own.
 *  - hacking: The Red Pill is installed and hacking is below the World Daemon's requirement (BN12.75: 7.7k vs 13.2k,
 *    ~28h by experience alone; grafts gave x1.7+ in a few hours).
 *  - otherwise idle.
 * Picks the eligible augmentation with the most ln(gain x 0.98 entropy) per minute (counting the wait to afford it),
 * and keeps autopilot's reserve (reserve.txt).
 */
const argsSchema = [
    ["until-hack", 0], // Hacking mode target (0 = the World Daemon's requirement)
    ["min-gain", 0.03], // Only graft if ln(gain) net of entropy is at least this
    ["exp-weight", 0.15], // Weight of the matching exp multiplier relative to the level multiplier
    ["reserve", null], // Keep this much money (default: reserve.txt, i.e. autopilot's reserve)
    ["focus", false], // Focus on grafting (only matters without Neuroreceptor Manager)
    ["once", false], // Graft at most one augmentation, then exit
    ["no-charisma", false], // Don't graft for darknet labyrinth charisma
];
export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

const CONGRUITY = "violet Congruity Implant";
const ENTROPY = Math.log(0.98);
const IDLE_MS = 2 * 60_000;
const STATUS_FILE = "/Temp/graft-status.txt"; // {t, mode}: read by autopilot.js

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    ns.disableLog("ALL");
    // A graft that disappears long before it could finish was cancelled by something else (another script starting
    // work): back off instead of paying for a new graft every few seconds.
    let lastStart = null, backoffMs = 120_000;
    let moneySample = null, moneyRate = 0; // $/ms, to count the wait for an augmentation we can't afford yet
    let lastMode;
    while (true) {
        const work = await getNsDataThroughFile(ns, "ns.singularity.getCurrentWork()");
        if (work?.type === "GRAFTING") {
            ns.write(STATUS_FILE, JSON.stringify({ t: Date.now(), mode: lastMode ?? "grafting" }), "w");
            await ns.sleep(15_000);
            continue;
        }
        if (lastStart && Date.now() - lastStart.at < Math.min(lastStart.time * 0.9, 5 * 60_000) + 30_000) {
            log(ns, `WARNING: The graft of ${lastStart.name} stopped after ${formatDuration(Date.now() - lastStart.at)} ` +
                `(of ${formatDuration(lastStart.time)}): something cancelled it. Waiting ${formatDuration(backoffMs)} before grafting again.`, true, "warning");
            await ns.sleep(backoffMs);
            backoffMs = Math.min(backoffMs * 2, 30 * 60_000);
            lastStart = null;
            continue;
        }
        const info = await getNsDataThroughFile(ns,
            `(() => { const p = ns.getPlayer(), owned = ns.singularity.getOwnedAugmentations(true);
                return { lastAugReset: ns.getResetInfo().lastAugReset, money: p.money, city: p.city, hack: p.skills.hacking, cha: p.skills.charisma, entropy: p.entropy, owned,
                    redPill: owned.includes("The Red Pill"),
                    augs: ns.grafting.getGraftableAugmentations().map(name => ({ name,
                        cost: ns.grafting.getAugmentationGraftPrice(name), time: ns.grafting.getAugmentationGraftTime(name),
                        prereqs: ns.singularity.getAugmentationPrereq(name), stats: ns.singularity.getAugmentationStats(name) })) }; })()`,
            "/Temp/graft-candidates.txt");

        // What gates us now?
        let mode = null, target = 0;
        if (info.redPill) {
            target = options["until-hack"] ||
                (await getNsDataThroughFile(ns, `ns.getServerRequiredHackingLevel("w0r1d_d43m0n")`, "/Temp/graft-daemon-req.txt"));
            if (info.hack < target) mode = "hacking";
            else return log(ns, `SUCCESS: hacking ${info.hack} >= ${target}: done grafting.`, true, "success");
        } else if (!options["no-charisma"]) {
            let dnet = null;
            try {
                dnet = JSON.parse(ns.read("/data/darknet-anchor-status.txt") || "null");
            } catch {}
            // (status from before the last install is about a darknet that no longer exists)
            const fresh = dnet && Date.now() - dnet.t < 10 * 60_000 && dnet.t > info.lastAugReset;
            if (fresh && dnet.lab && dnet.phase === "push" && dnet.labCha > info.cha) {
                mode = "charisma";
                target = dnet.labCha;
            }
        }
        // Tell autopilot whether we're in a graft series (it holds installs then; idle = installs may go ahead)
        ns.write(STATUS_FILE, JSON.stringify({ t: Date.now(), mode }), "w");
        if (mode !== lastMode) {
            log(ns, mode ? `INFO: Grafting for ${mode} (${mode === "hacking" ? info.hack : info.cha} / ${target}).` : `INFO: Nothing to graft for right now; waiting.`);
            lastMode = mode;
        }
        if (!mode) {
            await ns.sleep(IDLE_MS);
            continue;
        }

        const reserve = options.reserve ?? Number(ns.read("reserve.txt") || 0);
        const budget = info.money - reserve;
        const now = Date.now();
        // Smoothed income; flat or falling money pulls it down (a one-off jump must not keep us waiting forever)
        if (moneySample && now > moneySample.at)
            moneyRate = 0.5 * moneyRate + 0.5 * Math.max(0, (info.money - moneySample.money) / (now - moneySample.at));
        moneySample = { at: now, money: info.money };
        const eligible = info.augs.filter((a) => a.prereqs.every((p) => info.owned.includes(p)));
        const waitMs = (a) => (a.cost <= budget ? 0 : moneyRate > 0 ? (a.cost - budget) / moneyRate : Infinity);
        const [stat, expStat] = mode === "hacking" ? ["hacking", "hacking_exp"] : ["charisma", "charisma_exp"];
        // violet Congruity Implant stops entropy; worth it when grafting for hacking (a long series without installs)
        let choice = mode === "hacking" ? eligible.find((a) => a.name === CONGRUITY && a.cost <= budget) : null;
        if (!choice) {
            const entropyPenalty = info.owned.includes(CONGRUITY) ? 0 : ENTROPY;
            const scored = eligible.map((a) => {
                const gain = Math.log(a.stats[stat] ?? 1) + options["exp-weight"] * Math.log(a.stats[expStat] ?? 1) + entropyPenalty;
                return { ...a, gain, wait: waitMs(a), rate: gain / (a.time + waitMs(a)) };
            }).filter((a) => a.gain >= options["min-gain"] && Number.isFinite(a.rate));
            scored.sort((a, b) => b.rate - a.rate);
            choice = scored[0];
            if (choice && choice.wait > 0) {
                log(ns, `INFO: Waiting ~${formatDuration(choice.wait)} to afford ${choice.name} (${formatMoney(choice.cost)}), ` +
                    `better per minute than any affordable graft.`);
                await ns.sleep(Math.min(Math.max(choice.wait, 10_000), 60_000));
                continue;
            }
        }
        if (!choice) {
            await ns.sleep(moneyRate ? IDLE_MS : 30_000); // nothing affordable worth grafting (yet)
            continue;
        }
        if (info.city !== "New Tokyo") {
            const travelled = await getNsDataThroughFile(ns, `ns.singularity.travelToCity("New Tokyo")`, "/Temp/graft-travel.txt");
            if (!travelled) {
                log(ns, `WARNING: Could not travel to New Tokyo to graft. Retrying in a minute.`, false, "warning");
                await ns.sleep(60_000);
                continue;
            }
        }
        const started = await getNsDataThroughFile(ns, `ns.grafting.graftAugmentation(ns.args[0], ns.args[1])`,
            "/Temp/graft-start.txt", [choice.name, options.focus]);
        if (!started) {
            log(ns, `WARNING: Failed to start grafting ${choice.name}. Retrying in a minute.`, false, "warning");
            await ns.sleep(60_000);
            continue;
        }
        log(ns, `INFO: Grafting ${choice.name} for ${mode} (${stat} x${(choice.stats[stat] ?? 1).toFixed(3)}, ${formatMoney(choice.cost)}, ` +
            `${formatDuration(choice.time)}; entropy ${info.entropy} -> ${info.owned.includes(CONGRUITY) ? info.entropy : info.entropy + 1}; ` +
            `${mode === "hacking" ? info.hack : info.cha} / ${target})`, true, "info");
        if (options.once) return;
        lastStart = { name: choice.name, at: Date.now(), time: choice.time };
        await ns.sleep(20_000);
    }
}
