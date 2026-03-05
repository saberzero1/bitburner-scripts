/** @param {NS} ns **/
export async function main(ns) {
  const servers = getServersLight(ns)
  for (const server of servers) {
    try { ns.brutessh(server) } catch { }
    try { ns.ftpcrack(server) } catch { }
    try { ns.relaysmtp(server) } catch { }
    try { ns.httpworm(server) } catch { }
    try { ns.sqlinject(server) } catch { }
    try {
      ns.nuke(server)
      ns.scp("SphyxOS/basic/weaken.js", server, "home")
      ns.scp("SphyxOS/basic/grow.js", server, "home")
      ns.scp("SphyxOS/basic/hack.js", server, "home")
      ns.scp("SphyxOS/util.js", server, "home")
      ns.scp("SphyxOS/forms.js", server, "home")
    }
    catch { }
  }
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(1))
}

/** @param {NS} ns */
export function getServersLight(ns) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }  
  return Array.from(serverList)
}