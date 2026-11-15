/** @param {NS} ns */
export async function main(ns) {
    let port = ns.port.getHandle(ns.pid);
    const result = ns.stock.getSymbols();
    ns.atExit(() => port.write(result));
}
