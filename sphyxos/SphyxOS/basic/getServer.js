/** @param {NS} ns */
export async function main(ns) {
  const server = ns.getServer(ns.args[0])

  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(server))
}