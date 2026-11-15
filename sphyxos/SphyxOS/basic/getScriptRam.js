/** @param {NS} ns */
export async function main(ns) {
    const result = ns.getScriptRam(ns.args[0], "home");
    ns.atExit(() => ns.port.write(ns.pid, result));
}
