import { getConfiguration, getNsDataThroughFile, log, formatMoney, formatDuration } from "./helpers.js";

/** Grafts augmentations for hacking level, one after another.
 *
 * Grafting (SF10) applies an augmentation immediately, without an install, and grafted augmentations persist across
 * installs like bought ones. Each graft costs 3x the augmentation's base price and (1h * log2(sum of mults) + 30m) / 2
 * divided by the intelligence bonus, and adds one entropy: all multipliers x0.98 per entropy until the next install
 * (unless violet Congruity Implant is installed, which it grafts first when affordable).
 *
 * In BN12 the last gate is the World Daemon's hacking requirement; hacking level scales directly with the hacking
 * multiplier, while experience only adds logarithmically. On 2026-11-16 (hack 7.7k vs 13.2k required, ~28h by
 * experience alone) the best grafts gave x1.69 net of entropy in ~2.5h.
 * Picks the affordable augmentation with the most ln(hacking gain x 0.98) per minute and stops once hacking reaches
 * --until-hack (default: the World Daemon's requirement once The Red Pill is installed) or no graft is worth its entropy.
 */
const argsSchema = [
    ["until-hack", 0], // Stop once hacking level reaches this (0 = the World Daemon's requirement, if The Red Pill is installed)
    ["min-gain", 0.03], // Only graft if ln(hacking gain) net of entropy (+ a little for hacking exp) is at least this
    ["exp-weight", 0.15], // Weight of the hacking-exp multiplier relative to the hacking multiplier
    ["reserve", 0], // Keep this much money
    ["focus", false], // Focus on grafting (only matters without Neuroreceptor Manager)
    ["once", false], // Graft at most one augmentation, then exit
];
export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

const CONGRUITY = "violet Congruity Implant";
const ENTROPY = Math.log(0.98);

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    ns.disableLog("ALL");
    // A graft that disappears long before it could finish was cancelled by something else (another script starting
    // work): back off instead of paying for a new graft every few seconds (2026-11-16: ~5 OmniTek grafts paid in 80s).
    let lastStart = null, backoffMs = 120_000;
    let moneySample = null, moneyRate = 0; // $/ms, to count the wait for an augmentation we can't afford yet
    while (true) {
        const work = await getNsDataThroughFile(ns, "ns.singularity.getCurrentWork()");
        if (work?.type === "GRAFTING") {
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
                return { money: p.money, city: p.city, hack: p.skills.hacking, entropy: p.entropy, owned,
                    redPill: owned.includes("The Red Pill"),
                    augs: ns.grafting.getGraftableAugmentations().map(name => ({ name,
                        cost: ns.grafting.getAugmentationGraftPrice(name), time: ns.grafting.getAugmentationGraftTime(name),
                        prereqs: ns.singularity.getAugmentationPrereq(name), stats: ns.singularity.getAugmentationStats(name) })) }; })()`,
            "/Temp/graft-candidates.txt");
        let target = options["until-hack"];
        if (!target && info.redPill)
            target = await getNsDataThroughFile(ns, `ns.getServerRequiredHackingLevel("w0r1d_d43m0n")`, "/Temp/graft-daemon-req.txt");
        if (target && info.hack >= target) return log(ns, `SUCCESS: hacking ${info.hack} >= ${target}: done grafting.`, true, "success");
        const budget = info.money - options.reserve;
        const now = Date.now();
        if (moneySample && now > moneySample.at && info.money > moneySample.money)
            moneyRate = 0.5 * moneyRate + 0.5 * ((info.money - moneySample.money) / (now - moneySample.at));
        moneySample = { at: now, money: info.money };
        const eligible = info.augs.filter((a) => a.prereqs.every((p) => info.owned.includes(p)));
        // Time to afford it at the current income (purchases elsewhere make this optimistic; it only decides waiting)
        const waitMs = (a) => (a.cost <= budget ? 0 : moneyRate > 0 ? (a.cost - budget) / moneyRate : Infinity);
        let choice = eligible.find((a) => a.name === CONGRUITY && a.cost <= budget); // stops entropy for every later graft
        if (!choice) {
            const owned = new Set(info.owned);
            const entropyPenalty = owned.has(CONGRUITY) ? 0 : ENTROPY;
            const scored = eligible.map((a) => {
                const gain = Math.log(a.stats.hacking ?? 1) + options["exp-weight"] * Math.log(a.stats.hacking_exp ?? 1) + entropyPenalty;
                return { ...a, gain, wait: waitMs(a), rate: gain / (a.time + waitMs(a)) };
            }).filter((a) => a.gain >= options["min-gain"] && Number.isFinite(a.rate));
            scored.sort((a, b) => b.rate - a.rate);
            choice = scored[0];
            // The best use of grafting time is something we can't afford yet: wait for the money rather than graft worse
            if (choice && choice.wait > 0) {
                log(ns, `INFO: Waiting ~${formatDuration(choice.wait)} to afford ${choice.name} (${formatMoney(choice.cost)}), ` +
                    `better per minute than any affordable graft.`);
                await ns.sleep(Math.min(Math.max(choice.wait, 10_000), 60_000));
                continue;
            }
        }
        if (!choice) {
            if (!moneyRate) { await ns.sleep(30_000); continue; } // no income measured yet
            return log(ns, `INFO: No graft is worth its entropy. Done.`, true);
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
        log(ns, `INFO: Grafting ${choice.name} (hacking x${(choice.stats.hacking ?? 1).toFixed(3)}, ${formatMoney(choice.cost)}, ` +
            `${formatDuration(choice.time)}; entropy ${info.entropy} -> ${info.owned.includes(CONGRUITY) ? info.entropy : info.entropy + 1}; ` +
            `hack ${info.hack}${target ? ` / ${target}` : ""})`, true, "info");
        if (options.once) return;
        lastStart = { name: choice.name, at: Date.now(), time: choice.time };
        await ns.sleep(20_000);
    }
}
