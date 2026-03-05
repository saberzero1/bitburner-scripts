/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result = ns.sleeve.getSleeveAugmentations(ns.args[0]).length;
    ns.atExit(() => port.write(result));
}
