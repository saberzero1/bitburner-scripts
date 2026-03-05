/** @param {NS} ns */
export function getHackChance(ns) {
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(Math.min(1, Math.max(chance, 0))))

  const person = ns.getPlayer()
  const hackDifficulty = ns.args[1]
  const requiredHackingSkill = ns.getServerRequiredHackingLevel(ns.args[0])
  let chance = 0
  // Unrooted or unhackable server
  if (!ns.hasRootAccess(ns.args[0]) || hackDifficulty >= 100 || ns.getServerMinSecurityLevel(ns.args[0]) >= 100) {
    return
  }
  const hackFactor = 1.75;
  const difficultyMult = (100 - hackDifficulty) / 100;
  const skillMult = hackFactor * person.skills.hacking;
  const skillChance = (skillMult - requiredHackingSkill) / skillMult;
  try { chance =
    skillChance *
    difficultyMult *
    person.mults.hacking_chance *
    1 + Math.pow(person.skills.intelligence, 0.8) / 600
  }
  catch {
    chance =
    skillChance *
    difficultyMult *
    person.mults.hacking_chance
  }
}