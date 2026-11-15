/** @param {NS} ns */
export async function main(ns) {
    const slvs = ns.sleeve.getNumSleeves();
    let port = ns.port.getHandle(ns.pid);
    ns.atExit(() => port.write(slvs));
}
