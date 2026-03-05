/** @param {NS} ns */
export async function main(ns) {
  try { await ns.singularity.installBackdoor() }
  catch {}
  await ns.sleep(100) //Give the other script time to set up the listener
  ns.atExit(() => ns.writePort(ns.pid, true))
}