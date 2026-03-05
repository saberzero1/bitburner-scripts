/** @param {NS} ns */
export function main(ns) {
  const port = ns.getPortHandle(ns.pid)
  ns.atExit(() => port.write(hackingTime))
  
  const host = ns.getServer(ns.args[0])
  /** @type {Person} person */
  const person = ns.getPlayer()

  host.hackDifficulty = ns.args[1]
  let hackingTime = 0
  try { hackingTime = ns.formulas.hacking.hackTime(host, person) }
  catch {
    const { hackDifficulty, requiredHackingSkill } = host;
    if (hackDifficulty >= 100 || requiredHackingSkill > person.skills.hacking) {
      hackingTime = Number.POSITIVE_INFINITY
      return
    }
    const difficultyMult = requiredHackingSkill * hackDifficulty;

    const baseDiff = 500;
    const baseSkill = 50;
    const diffFactor = 2.5;
    let skillFactor = diffFactor * difficultyMult + baseDiff;
    skillFactor /= person.skills.hacking + baseSkill;

    const hackTimeMultiplier = 5;
    try {
      hackingTime = 1000 *
        (hackTimeMultiplier * skillFactor) /
        (person.mults.hacking_speed *
          1 + Math.pow(person.skills.intelligence, 0.8) / 600)
    }
    catch { hackingTime = 1000 * hackTimeMultiplier * skillFactor / person.mults.hacking_speed }
  }
}