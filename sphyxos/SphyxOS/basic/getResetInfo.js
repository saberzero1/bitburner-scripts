/** @param {NS} ns */
export async function main(ns) {
  let port = ns.getPortHandle(ns.pid)
  const result = ns.getResetInfo()
  ns.atExit(() => port.write(result))
}