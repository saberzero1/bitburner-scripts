/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    try {
        ns.bladeburner.setActionLevel(ns.args[0], ns.args[1], ns.args[2]);
    } catch {}
    ns.atExit(() => port.write(true));
}
