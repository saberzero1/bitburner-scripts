/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    const result = ns.singularity.getOwnedAugmentations(ns.args[0]);
    ns.atExit(() => port.write(result));
}
