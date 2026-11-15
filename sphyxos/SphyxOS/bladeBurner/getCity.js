/** @param {NS} ns */
export async function main(ns) {
    let port = ns.port.getHandle(ns.pid);
    const result = ns.bladeburner.getCity();
    ns.atExit(() => port.write(result));
}
