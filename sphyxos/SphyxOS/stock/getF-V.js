/** @param {NS} ns */
export async function main(ns) {
    let port = ns.port.getHandle(ns.pid);
    let record = {
        vol: ns.stock.getVolatility(ns.args[0]),
        forcast: ns.stock.getForecast(ns.args[0]),
    };
    ns.atExit(() => port.write(record));
}
