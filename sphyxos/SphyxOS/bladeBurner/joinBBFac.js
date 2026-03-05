/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result = ns.bladeburner.joinBladeburnerFaction();
    ns.atExit(() => port.write(result));
}
