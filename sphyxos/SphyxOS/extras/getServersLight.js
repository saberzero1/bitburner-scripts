/** @param {NS} ns */
export async function main(ns) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }

  let serverDetails = []
  for (const server of serverList) {
    serverDetails.push(server)
  }
  serverDetails = serverDetails.sort((a, b) => { return (ns.getServerMaxRam(a) - ns.getServerUsedRam(a)) - (ns.getServerMaxRam(b) - ns.getServerUsedRam(b)) })

  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(serverDetails))
}