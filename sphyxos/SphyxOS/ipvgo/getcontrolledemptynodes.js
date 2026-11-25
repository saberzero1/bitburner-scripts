/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const result = ns.go.analysis.getControlledEmptyNodes();
    ns.atExit(() => port.write(result));
}
