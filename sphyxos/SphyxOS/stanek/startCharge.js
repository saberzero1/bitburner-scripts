import { getServersLight, proxy } from "SphyxOS/util.js"
const chargeScript = "SphyxOS/stanek/charge.js"
/** @param {NS} ns */
export async function main(ns) {
  ns.writePort(11, ns.pid)
  const quietMode = ns.args.includes("quiet")
  const servers = await getServersLight(ns)
  const promises = []
  const fragments = await proxy(ns, "stanek.activeFragments")
  let runningThreads = 0
  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue
    const reserved = server === "home" ? 256 : 0
    const threads = Math.floor((Math.max(0, ns.getServerMaxRam(server) - ns.getServerUsedRam(server) - reserved)) / 2)
    runningThreads += threads
    if (threads <= 0) continue
    ns.scp(chargeScript, server, "home")
    const scriptPid = ns.exec(chargeScript, server, threads, JSON.stringify(fragments))
    promises.push(ns.nextPortWrite(scriptPid))
  }
  if (!quietMode) ns.toast("Awaiting " + fragments.reduce((val, a) => a.id < 100 ? val += 1 : val = val, 0) + " charges with " + runningThreads + " threads.", "success", 3000)
  await Promise.all(promises)
  if (!quietMode) ns.toast("Done Charging", "success", 2000)
  ns.atExit(() => {
    ns.clearPort(11)
    ns.writePort(1, true)
  })
}