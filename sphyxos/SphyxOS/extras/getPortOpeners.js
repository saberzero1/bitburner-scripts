/** @param {NS} ns */
export async function main(ns) {
  let count = 0
  if (ns.fileExists("BruteSSH.exe", "home")) count++
  if (ns.fileExists("FTPCrack.exe", "home")) count++
  if (ns.fileExists("relaySMTP.exe", "home")) count++
  if (ns.fileExists("HTTPWorm.exe", "home")) count++
  if (ns.fileExists("SQLInject.exe", "home")) count++

  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(count))
}
