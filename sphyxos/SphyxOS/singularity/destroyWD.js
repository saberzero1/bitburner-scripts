/** @param {NS} ns */
export async function main(ns) {
    const port = ns.getPortHandle(ns.pid);
    const test = ns.singularity.destroyW0r1dD43m0n(ns.args[0], ns.args[1]);
    ns.atExit(() => port.write(test));
}
