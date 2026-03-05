/** @param {NS} ns */
export async function main(ns) {
  const log = "SphyxOS/changeLog.txt"
  ns.disableLog("ALL")
  ns.ui.openTail()
  const file = ns.read(log)
  ns.printf("%s", file)
}