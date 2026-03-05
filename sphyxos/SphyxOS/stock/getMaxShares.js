/** @param {NS} ns */
export async function main(ns) {
  let port = ns.getPortHandle(ns.pid)
  const result = ns.stock.getMaxShares(ns.args[0])
  ns.atExit(() => port.write(result))
}