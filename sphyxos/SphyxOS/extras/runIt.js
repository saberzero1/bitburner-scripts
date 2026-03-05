import { reservedRam } from "SphyxOS/util.js"
/** @param {NS} ns */
export async function main(ns) {
  //Any runIt now has a persistent argument to pass along if it can run on hacknet servers.
  //This way you can choose to run something like puppet on a hacknet server
  let thispid = 0
  let threads = 1
  const [script, persistent, scriptOverride, ...argmts] = ns.args
  const scriptRam = scriptOverride === 0 ? ns.getScriptRam(script) : scriptOverride
  if (!persistent && Math.floor((ns.getServerMaxRam("home") - ns.getServerUsedRam("home")) / scriptRam) >= 1) {
    thispid = ns.exec(script, "home", { threads: 1, temporary: true }, ...argmts)
    if (thispid > 0)
      threads--
  }
  if (threads >= 1) {
    const servers = getServersLight(ns, persistent)
    let emergencyReserve = ns.getServerMaxRam("home") <= 16 ? true : false
    const maxRam = !persistent ? 0 : maxRun(ns, persistent)
    const resRam = !persistent ? 0 : maxRam >= 256 ? 256 : maxRam >= 128 ? 128 : maxRam >= 64 ? 64 : maxRam >= 32 ? 32 : 16
    for (const server of servers) {
      if (!ns.hasRootAccess(server)) continue
      if ((server.startsWith("hacknet") && persistent)) continue
      let tmpramavailable = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
      if (persistent && emergencyReserve && tmpramavailable >= resRam) {
        emergencyReserve = false
        tmpramavailable -= resRam
      }
      if (server.startsWith("home") && persistent) tmpramavailable = Math.max(tmpramavailable - reservedRam, 0)
      if (tmpramavailable <= 0) continue
      const threadsonserver = Math.floor(tmpramavailable / scriptRam)
      // How many threads can we run?  If we can run something, do it
      if (threadsonserver <= 0) continue
      ns.scp([script, "SphyxOS/util.js", "SphyxOS/forms.js"], server, "home")
      thispid = ns.exec(script, server, { threads: 1, temporary: true }, ...argmts)
      if (thispid === 0) continue //ns.tprintf("Failed to run: %s on %s", script, server)
      threads--
      break
    }// All servers
  }
  if (threads >= 1) ns.tprintf("Failed to allocate all threads for script: %s", script)

  await ns.nextPortWrite(thispid)
  const result = ns.readPort(thispid)
  ns.atExit(() => ns.writePort(ns.pid, result))
}

/** @param {NS} ns */
function getServersLight(ns, persistent) {
  const serverList = new Set(["home"])
  for (const server of serverList) {
    for (const connection of ns.scan(server)) {
      serverList.add(connection)
    }
  }
  let serverDetails = Array.from(serverList)
  if (persistent)
    serverDetails = serverDetails.sort((a, b) => { return (ns.getServerMaxRam(b) - ns.getServerUsedRam(b)) - (ns.getServerMaxRam(a) - ns.getServerUsedRam(a)) })
  return serverDetails
}

/** @param {NS} ns */
function maxRun(ns, persistent, useHacknet = false) {
  //Any runIt now has a persistent argument to pass along if it can run on hacknet servers.
  //This way you can choose to run something like puppet on a hacknet server
  let highest = 0
  /**@type {String[]} servers */
  const servers = getServersLight(ns, persistent)
  let emergencyReserve = ns.getServerMaxRam("home") <= 16 ? true : false
  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue
    if ((server.startsWith("hacknet") && !useHacknet)) continue
    let tmpramavailable = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
    if (server === "home" && persistent) tmpramavailable = Math.max(tmpramavailable - reservedRam, 0)
    if (tmpramavailable > highest)
      highest = tmpramavailable
  }// All servers
  if (!persistent)
    return highest
  //Highest is now max run
  const resRam = highest >= 256 ? 256 : highest >= 128 ? 128 : highest >= 64 ? 64 : highest >= 32 ? 32 : 16
  //Now that we have the highest, we go again
  let highest2 = 0
  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue
    if ((server.startsWith("hacknet") && persistent)) continue
    let tmpramavailable = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
    if (persistent && emergencyReserve && tmpramavailable >= resRam) {
      emergencyReserve = false
      tmpramavailable -= resRam
    }
    if (server === "home" && persistent) tmpramavailable = Math.max(tmpramavailable - reservedRam, 0)
    if (tmpramavailable > highest2)
      highest2 = tmpramavailable
  }// All servers
  return highest2
}