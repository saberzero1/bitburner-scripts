/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  const result = ns.gang.getOtherGangInformation()
  ns.atExit(() => port.write(result))
}