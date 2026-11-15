/** @param {NS} ns */
export async function main(ns) {
    let port = ns.port.getHandle(ns.pid);
    let result;
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        result = ns.stock.has4SDataTixApi();
    else result = ns.stock.has4SDataTixApi();
    ns.atExit(() => port.write(result));
}
