/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    let result;
    try {
        result = ns.bladeburner.getActionCurrentLevel(ns.args[0], ns.args[1]);
    } catch {
        result = -1;
    }
    ns.atExit(() => port.write(result));
}
