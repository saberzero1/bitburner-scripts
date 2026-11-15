/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    ns.atExit(() => port.write(1));
    ns.gang.setMemberTask(ns.args[0], ns.args[1]);
}
