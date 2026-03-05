/** @param {NS} ns */
export async function main(ns) {
    const port = ns.getPortHandle(ns.pid);
    ns.atExit(() => port.write(result));

    const bn = ns.args[0];
    const bnLvl = ns.args[1] ? ns.args[1] : 1;
    const forced = ns.args[2] ?? false;
    const resetInfo = ns.getResetInfo();
    const sourceFiles = [];
    for (const item of ns.getResetInfo().ownedSF) {
        const record = {
            n: item[0],
            lvl: item[1],
        };
        sourceFiles.push(record);
    }
    let result = 0;
    if (resetInfo.currentNode === bn && !forced) {
        result = 1;
        return;
    }
    for (const sf of sourceFiles)
        if (sf.n === bn && sf.lvl >= bnLvl) {
            result = 1;
            return;
        }
    result = 0;
}
