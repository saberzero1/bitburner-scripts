/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    const result = ns.singularity.donateToFaction(ns.args[0], ns.args[1]);
    ns.atExit(() => port.write(result));
}
