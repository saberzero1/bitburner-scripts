/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  const result = ns.getServerMaxRam(ns.args[0]) - ns.getServerUsedRam(ns.args[0])
  ns.atExit(() => port.write(ns.args[0] === "home" ? result + 1.7 : result))
}