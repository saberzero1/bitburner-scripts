/** @param {NS} ns */
export async function main(ns) {
  let port = ns.getPortHandle(ns.pid)
  let enabled = 0
  try {
    ns.stock.buyShort("ECP", 0)
    enabled = 1
  }
  catch {}
  ns.atExit(() => port.write(enabled))
}