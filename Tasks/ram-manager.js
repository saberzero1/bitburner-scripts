import {
    formatMoney,
    formatRam,
    getConfiguration,
    getNsDataThroughFile,
    log,
} from "../helpers.js";

const max_ram = 2 ** 30;
const argsSchema = [
    ["budget", 0.2], // Spend up to this much of current cash on ram upgrades per tick (Default is high, because these are permanent for the rest of the BN)
    ["reserve", null], // Reserve this much cash before determining spending budgets (defaults to contents of reserve.txt if not specified)
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // Invalid options, or ran in --help mode.
    const reserve =
        options["reserve"] != null
            ? options["reserve"]
            : Number(ns.read("reserve.txt") || 0);
    const freeRam = Math.max(
        0,
        ns.getServerMaxRam("home") - ns.getServerUsedRam("home"),
    );
    if (freeRam < 7) {
        return log(
            ns,
            `INFO: Skipping ram-manager (free RAM ${formatRam(freeRam)} too low for temp scripts)`,
        );
    }
    const money = await safeGetNsData(
        ns,
        `ns.getServerMoneyAvailable(ns.args[0])`,
        ["home"],
    );
    if (money === null) return;
    let spendable = Math.min(money - reserve, money * options.budget);
    if (isNaN(spendable))
        return log(
            ns,
            `ERROR: One of the arguments could not be parsed as a number: ${JSON.stringify(options)}`,
            true,
            "error",
        );
    // Quickly buy as many upgrades as we can within the budget
    do {
        let cost = await safeGetNsData(
            ns,
            `ns.singularity.getUpgradeHomeRamCost()`,
        );
        let currentRam = await safeGetNsData(
            ns,
            `ns.getServerMaxRam(ns.args[0])`,
            ["home"],
        );
        if (cost === null || currentRam === null) return;
        if (cost >= Number.MAX_VALUE || currentRam === max_ram)
            return log(
                ns,
                `INFO: We're at max home RAM (${formatRam(currentRam)})`,
            );
        const nextRam = currentRam * 2;
        const upgradeDesc = `home RAM from ${formatRam(currentRam)} to ${formatRam(nextRam)} (cost: ${formatMoney(cost)})`;
        if (spendable < cost)
            return log(
                ns,
                `Money we're allowed to spend (${formatMoney(spendable)}) is less than the cost (${formatMoney(cost)}) to upgrade ${upgradeDesc}`,
            );
        if (!(await safeGetNsData(ns, `ns.singularity.upgradeHomeRam()`)))
            return log(
                ns,
                `ERROR: Failed to upgrade ${upgradeDesc} thinking we could afford it ` +
                    `(cash: ${formatMoney(money)} budget: ${formatMoney(spendable)})`,
                true,
                "error",
            );
        // Otherwise, we've successfully upgraded home ram.
        log(ns, `SUCCESS: Upgraded ${upgradeDesc}`, true, "success");
        const newMaxRam = await safeGetNsData(
            ns,
            `ns.getServerMaxRam(ns.args[0])`,
            ["home"],
        );
        if (newMaxRam === null) return;
        if (nextRam !== newMaxRam)
            log(
                ns,
                `WARNING: Expected to upgrade ${upgradeDesc}, but new home ram is ${newMaxRam}`,
                true,
                "warning",
            );
        // Only loop again if we successfully upgraded home ram, to see if we can upgrade further
        spendable -= cost;
        await ns.sleep(100); // On the off-chance we have an infinite loop bug, this makes us killable.
    } while (spendable > 0);
}

async function safeGetNsData(ns, command, args = null) {
    try {
        return await getNsDataThroughFile(ns, command, null, args || []);
    } catch {
        log(
            ns,
            `WARNING: ram-manager skipped '${command}' due to insufficient RAM`,
            false,
            "warning",
        );
        return null;
    }
}
