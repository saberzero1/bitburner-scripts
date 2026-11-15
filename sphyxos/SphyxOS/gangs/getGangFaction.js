/** @param {NS} ns */
export async function main(ns) {
    const port = ns.getPortHandle(ns.pid);
    let gangFac = "NOFACTION";
    try {
        gangFac = ns.gang.getGangInformation().faction;
    } catch {}
    ns.atExit(() => port.write(gangFac));
}
