/** @param {NS} ns */
export async function main(ns) {
    let port = ns.port.getHandle(ns.pid);
    const result = ns.stock.sellStock(ns.args[0], ns.args[1]);
    ns.atExit(() => port.write(result));
}
