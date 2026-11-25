/** @param {NS} ns */
export async function main(ns) {
    const slv = ns.sleeve.getSleeve(ns.args[0]);
    let port = ns.getPortHandle(ns.pid);
    ns.atExit(() => port.write(slv));
}
