/** @param {NS} ns */
export async function main(ns) {
  const result = ns.scp(ns.args[0], ns.args[1], "home")

  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(result))
}