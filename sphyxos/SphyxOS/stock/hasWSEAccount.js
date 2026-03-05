/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    let result;
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        result = ns.stock.hasWseAccount();
    else result = ns.stock.hasWSEAccount();
    ns.atExit(() => port.write(result));
}
