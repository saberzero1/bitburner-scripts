/** @param {NS} ns */
export async function main(ns) {
  //Amount === ns.args[0]
  /**@type {BitNodeMultipliers} mults */
  let mults = null
  try { mults = ns.getBitNodeMultipliers() } catch { }
  let result = 0
  try { result = ns.args[0] / 1e6 * ns.getPlayer().mults.faction_rep * mults.FactionWorkRepGain }
  catch { result = ns.args[0] / 1e6 * ns.getPlayer().mults.faction_rep }

  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(result))
}