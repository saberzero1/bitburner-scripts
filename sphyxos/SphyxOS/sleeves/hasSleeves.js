/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    let sleeveAccess = false;
    try {
        ns.sleeve.getNumSleeves();
        sleeveAccess = true;
    } catch {}
    ns.atExit(() => port.write(sleeveAccess));
}
