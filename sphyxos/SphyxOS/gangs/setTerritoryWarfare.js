/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    ns.atExit(() => port.write(1));
    ns.gang.setTerritoryWarfare(ns.args[0]);
}
