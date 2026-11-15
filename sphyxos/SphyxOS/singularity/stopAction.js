/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    const test = ns.singularity.stopAction();
    ns.atExit(() => port.write(test));
}
