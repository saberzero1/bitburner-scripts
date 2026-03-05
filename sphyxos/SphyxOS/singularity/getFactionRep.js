/** @param {NS} ns */
export async function main(ns) {
    const port = ns.getPortHandle(ns.pid);
    const result = ns.singularity.getFactionRep(ns.args[0]);
    ns.atExit(() => port.write(result));
}
