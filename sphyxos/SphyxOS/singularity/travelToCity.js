/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  const result = ns.singularity.travelToCity(ns.args[0])
  ns.atExit(() => port.write(result))
}