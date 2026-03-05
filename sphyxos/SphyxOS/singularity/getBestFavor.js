/** @param {NS} ns */
export async function main(ns) {
  const s = ns.singularity
  const factions = ns.getPlayer().factions
  let bestFac = "none"
  let bestFav = -1
  let gangFac = "none"

  try { gangFac = ns.gang.getGangInformation().faction } catch { }
  //Best favor for purchasing Neuroflux.  Filter out factions without it
  for (const faction of factions) {
    if (s.getFactionFavor(faction) > bestFav && faction !== gangFac && faction !== "Bladeburners" && faction !== "Church of the Machine God" && faction !== "Shadows of Anarchy") {
      bestFac = faction
      bestFav = s.getFactionFavor(faction)
    }
  }
  let result = {
    "faction": bestFac,
    "favor": bestFav
  }
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(result))
}