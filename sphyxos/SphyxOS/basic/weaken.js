export const weakenReady = true;
/** @param {NS} ns */
export async function main(ns) {
    if (!ns.args[1]) await ns.weaken(ns.args[0]);
    else await ns.weaken(ns.args[0], { additionalMsec: ns.args[1] });
}
