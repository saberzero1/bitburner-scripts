/** @param {NS} ns */
export async function main(ns) {
    let [func, ...argmnts] = ns.args;
    ns.ramOverride(ns.getFunctionRamCost(func) + 1.6);
    let nsFunction = ns;
    for (let prop of func.split(".")) nsFunction = nsFunction[prop];
    const result = nsFunction(...argmnts);
    ns.atExit(() => ns.writePort(ns.pid, result));
}
