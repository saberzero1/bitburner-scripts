/** @param {NS} ns */
export async function main(ns) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }

  const serverDetails = []
  for (const server of serverList) {
    serverDetails.push(ns.getServer(server))
  }
  serverDetails.sort((a, b) => { return (a.maxRam - a.ramUsed) - (b.maxRam - b.ramUsed) })

  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(serverDetails))
}