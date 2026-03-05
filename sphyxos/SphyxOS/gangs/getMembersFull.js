/** @param {NS} ns */
export async function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  const result = ns.gang.getMemberNames().map((m) => ns.gang.getMemberInformation(m))
  ns.atExit(() => port.write(result))
}