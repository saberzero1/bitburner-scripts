/** @param {NS} ns */
export async function main(ns) {
  let [func, ...argmnts] = ns.args
  ns.ramOverride(ns.getFunctionRamCost(func) + 1.6)
  let nsFunction = ns
  for (let prop of func.split(".")) nsFunction = nsFunction[prop]
  let result = false
  try {
    const res = nsFunction(...argmnts)
    if (res) result = res
    else result = true
  }
  catch { }
  ns.atExit(() => ns.writePort(ns.pid, result))
}