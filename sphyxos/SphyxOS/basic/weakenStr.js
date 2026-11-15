/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    const result = ns.weakenAnalyze(1);
    ns.atExit(() => port.write(result));
}
