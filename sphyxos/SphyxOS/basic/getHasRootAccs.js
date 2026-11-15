/** @param {NS} ns */
export async function main(ns) {
    const result = ns.hasRootAccess(ns.args[0]);

    const port = ns.port.getHandle(ns.pid);
    ns.atExit(() => port.write(result));
}
