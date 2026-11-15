/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result = ns.bladeburner.getBlackOpRank(ns.args[0]);
    ns.atExit(() => port.write(result));
}
