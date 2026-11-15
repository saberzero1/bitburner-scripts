/** @param {NS} ns */
export async function main(ns) {
    const port = ns.port.getHandle(ns.pid);
    ns.atExit(() => port.write(result));

    const resetInfo = ns.getResetInfo();
    const result = resetInfo.currentNode;
}
