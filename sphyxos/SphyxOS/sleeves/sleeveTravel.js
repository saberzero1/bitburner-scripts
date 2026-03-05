/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result = ns.sleeve.travel(ns.args[0], ns.args[1]);
    ns.atExit(() => port.write(result));
}
