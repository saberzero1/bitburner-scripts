/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  const result = ns.singularity.upgradeHomeRam()
  ns.atExit(() => port.write(result))
}