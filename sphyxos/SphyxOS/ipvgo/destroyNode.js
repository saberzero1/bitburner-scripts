/** @param {NS} ns */
export async function main(ns) {
    let port = ns.getPortHandle(ns.pid);
    const results = await ns.go.cheat.destroyNode(
        ns.args[0],
        ns.args[1],
        ns.args[2],
    );
    ns.atExit(() => port.write(results));
}
