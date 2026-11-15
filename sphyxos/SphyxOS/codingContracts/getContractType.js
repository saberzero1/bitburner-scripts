/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    ns.atExit(() =>
        port.write(ns.codingcontract.getContractType(ns.args[0], ns.args[1])),
    );
}
