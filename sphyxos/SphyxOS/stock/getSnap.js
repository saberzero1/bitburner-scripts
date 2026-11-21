/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    let record = {
        bidp: ns.stock.getBidPrice(ns.args[0]),
        askp: ns.stock.getAskPrice(ns.args[0]),
        price: ns.stock.getPrice(ns.args[0]),
    };
    ns.atExit(() => port.write(record));
}
