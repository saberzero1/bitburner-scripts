/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  const result = ns.getPlayer()
  ns.atExit(() => port.write(result))
}