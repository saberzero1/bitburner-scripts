/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result = ns.bladeburner.getRank();
    ns.atExit(() => port.write(result));
}
