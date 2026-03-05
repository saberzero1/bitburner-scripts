let MODE = "Recovery" //Training, Money, Recovery, Sync, Karma, Int
const IMODE = "Training" // Install Mode
let HASBN5 = false
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  HASBN5 = hasBN(ns, 5, 1)
  ns.ui.openTail()
  //Read commands, set Mode
  if (ns.args.length > 1) {
    ns.printf("Only 1 argument.\nmoney, karma, int, recovery, sync, training, install")
    ns.exit()
  }
  if (ns.args.includes("money")) MODE = "Money"
  if (ns.args.includes("karma")) MODE = "Karma"
  if (ns.args.includes("int")) MODE = "Int"
  if (ns.args.includes("recovery")) MODE = "Recovery"
  if (ns.args.includes("sync")) MODE = "Sync"
  if (ns.args.includes("training")) MODE = "Training"
  if (ns.args.includes("install")) MODE = "Install"

  while (true) {
    //me, num, task
    const sleeves = getSleeveObject(ns)
    if (MODE === "Install") installAugs(ns, sleeves)
    displaySleeves(ns)
    await ns.sleep(1000)
    for (const slv of sleeves) {
      
      if (MODE === "Recovery") {
        ns.sleeve.setToShockRecovery(slv.num)
        continue
      }
      if (MODE === "Sync") {
        ns.sleeve.setToSynchronize(slv.num)
        continue
      }
      if (MODE === "Training") {
        const skls = slv.me.skills
        //Make sure we are in Sector-12
        if (slv.me.city !== "Sector-12") {
          if (!ns.sleeve.travel(slv.num, "Sector-12")) continue
        }
        if (skls.hacking === Math.min(skls.hacking, skls.strength, skls.defense, skls.dexterity, skls.agility, skls.charisma)) {
          if (slv.task === null || slv.task.classType !== "Computer Science") {
            ns.sleeve.setToUniversityCourse(slv.num, "Rothman University", "Computer Science")
          }
          continue
        }
        if (skls.strength === Math.min(skls.hacking, skls.strength, skls.defense, skls.dexterity, skls.agility, skls.charisma)) {
          if (slv.task === null || slv.task.classType !== "str") {
            ns.sleeve.setToGymWorkout(slv.num, "Powerhouse Gym", "str")
          }
          continue
        }
        if (skls.defense === Math.min(skls.hacking, skls.strength, skls.defense, skls.dexterity, skls.agility, skls.charisma)) {
          if (slv.task === null || slv.task.classType !== "def") {
            ns.sleeve.setToGymWorkout(slv.num, "Powerhouse Gym", "def")
          }
          continue
        }
        if (skls.dexterity === Math.min(skls.hacking, skls.strength, skls.defense, skls.dexterity, skls.agility, skls.charisma)) {
          if (slv.task === null || slv.task.classType !== "dexterity") {
            ns.sleeve.setToGymWorkout(slv.num, "Powerhouse Gym", "dex")
          }
          continue
        }
        if (skls.agility === Math.min(skls.hacking, skls.strength, skls.defense, skls.dexterity, skls.agility, skls.charisma)) {
          if (slv.task === null || slv.task.classType !== "agi") {
            ns.sleeve.setToGymWorkout(slv.num, "Powerhouse Gym", "agi")
          }
          continue
        }
        if (skls.charisma === Math.min(skls.hacking, skls.strength, skls.defense, skls.dexterity, skls.agility, skls.charisma)) {
          if (slv.task === null || slv.task.classType !== "Leadership") {
            ns.sleeve.setToUniversityCourse(slv.num, "rothman university", "Leadership")
          }
          continue
        }
        ns.tprintf("Error!  Failed to train.")
        continue
      }//End Training
      if (["Money", "Karma", "Int", "Install"].includes(MODE)) {
        //Cycle our crimes and find the best for our mode.
        const STYLE = MODE === "Install" ? IMODE : MODE
        let bestRatio = 0
        let bestCrime = "Mug"
        for (const crime of crimes) {
          const chance = getChance(ns, crime, slv.me)
          const gain = STYLE === "Money" ? crime.money : STYLE === "Install" ? crime.money : STYLE === "Karma" ? crime.karma : crime.intelligence_exp
          const ratio = gain * chance / crime.time
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestCrime = crime.name
          }
        }

        if (slv.task && slv.task.crimeType !== bestCrime) ns.sleeve.setToCommitCrime(slv.num, bestCrime)
        continue
      }
    }//End of sleeves
  }//End While True
}
/** @param {NS} ns */
function installAugs(ns, sleeves) {
  for (const slv of sleeves) {
    if (slv.me.shock !== 0) continue
    const augs = ns.sleeve.getSleevePurchasableAugs(slv.num)
    augs.forEach((a) => ns.sleeve.purchaseSleeveAug(slv.num, a.name))
  }
}
/** @param {NS} ns */
function getSleeveObject(ns) {
  const sleeves = []
  for (let slv = 0; slv < ns.sleeve.getNumSleeves(); slv++) {
    const record = {
      "num": slv,
      "me": ns.sleeve.getSleeve(slv),
      "task": ns.sleeve.getTask(slv)
    }
    sleeves.push(record)
  }
  return sleeves
}
/** @param {NS} ns */
function hasBN(ns, bn, bnLvl = 1) {
  const resetInfo = ns.getResetInfo()
  const sourceFiles = []
  for (const item of ns.getResetInfo().ownedSF) {
    const record = {
      "n": item[0],
      "lvl": item[1]
    }
    sourceFiles.push(record)
  }
  if (resetInfo.currentNode === bn) {
    return true
  }
  for (const sf of sourceFiles) if (sf.n === bn && sf.lvl >= bnLvl) {
    return true
  }
  return false
}
/** @param {NS} ns */
async function displaySleeves(ns) {
  ns.clearLog()
  ns.print("Sleeve Statistics:")
  if (HASBN5) ns.printf("%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s", "#", "Hack", "Str", "Def", "Dex", "Agi", "Cha", "Int", "Aug", "Shock", "Action", "Name")
  else ns.printf("%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s", "#", "Hack", "Str", "Def", "Dex", "Agi", "Cha", "Aug", "Shock", "Action", "Name")
  //num, me, task
  const sleeves = getSleeveObject(ns)
  for (const slv of sleeves) {
    if (HASBN5) ns.printf("%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s %s", slv.num, ns.format.number(slv.me.skills.hacking, 3), ns.format.number(slv.me.skills.strength, 3), ns.format.number(slv.me.skills.defense, 3), ns.format.number(slv.me.skills.dexterity, 3), ns.format.number(slv.me.skills.agility, 3), ns.format.number(slv.me.skills.charisma, 3), ns.format.number(slv.me.skills.intelligence), ns.sleeve.getSleeveAugmentations(slv.num).length, ns.format.number(slv.me.shock, 2), slv.task === null ? "Shock Recovery" : slv.task.type, slv.task.actionType || slv.task.classType || slv.task.crimeType || "n/a")
    else ns.printf("%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s %s", slv.num, ns.format.number(slv.me.skills.hacking, 3), ns.format.number(slv.me.skills.strength, 3), ns.format.number(slv.me.skills.defense, 3), ns.format.number(slv.me.skills.dexterity, 3), ns.format.number(slv.me.skills.agility, 3), ns.format.number(slv.me.skills.charisma, 3), ns.sleeve.getSleeveAugmentations(slv.num).length, ns.format.number(slv.me.shock, 2), slv.task === null ? "Shock Recovery" : slv.task.type, slv.task.actionType || slv.task.classType || slv.task.crimeType || "n/a")
  }
}
function getChance(ns, crimestats, wsleeve) {
  let hackweight = crimestats.hacking_success_weight * wsleeve.skills.hacking
  let strweight = crimestats.strength_success_weight * wsleeve.skills.strength
  let defweight = crimestats.defense_success_weight * wsleeve.skills.defense
  let dexweight = crimestats.dexterity_success_weight * wsleeve.skills.dexterity
  let agiweight = crimestats.agility_success_weight * wsleeve.skills.agility
  let chaweight = crimestats.charisma_success_weight * wsleeve.skills.charisma
  let intweight = HASBN5 ? 0.025 * wsleeve.skills.intelligence : 0
  let chance = hackweight + strweight + defweight + dexweight + agiweight + chaweight + intweight
  chance /= 975
  chance /= crimestats.difficulty
  chance *= wsleeve.mults.crime_success
  if (HASBN5) chance *= 1 + (1 * Math.pow(wsleeve.skills.intelligence, 0.8)) / 600
  chance *= 100
  return Math.min(chance, 100)
}
const crimes = [
  {
    "name": "Shoplift",
    "time": 2e3,
    "money": 15e3,
    "difficulty": 1 / 20,
    "karma": 0.1,
    "hacking_success_weight": 0,
    "strength_success_weight": 0,
    "defense_success_weight": 0,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  },
  {
    "name": "Rob Store",
    "time": 60e3,
    "money": 400e3,
    "difficulty": 1 / 5,
    "karma": 0.5,
    "hacking_success_weight": 0.5,
    "strength_success_weight": 0,
    "defense_success_weight": 0,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 7.5 * 0.05
  },
  {
    "name": "Mug",
    "time": 4e3,
    "money": 36e3,
    "difficulty": 1 / 5,
    "karma": 0.25,
    "hacking_success_weight": 0,
    "strength_success_weight": 1.5,
    "defense_success_weight": 0.5,
    "dexterity_success_weight": 1.5,
    "agility_success_weight": 0.5,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  },
  {
    "name": "Larceny",
    "time": 90e3,
    "money": 800e3,
    "difficulty": 1 / 3,
    "karma": 1.5,
    "hacking_success_weight": 0.5,
    "strength_success_weight": 0,
    "defense_success_weight": 0,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 15 * 0.05
  },
  {
    "name": "Deal Drugs",
    "time": 10e3,
    "money": 120e3,
    "difficulty": 1,
    "karma": 0.5,
    "hacking_success_weight": 0,
    "strength_success_weight": 0,
    "defense_success_weight": 0,
    "charisma_success_weight": 3,
    "dexterity_success_weight": 2,
    "agility_success_weight": 1,
    "intelligence_exp": 0
  },
  {
    "name": "Bond Forgery",
    "time": 300e3,
    "money": 4.5e6,
    "difficulty": 1 / 2,
    "karma": 0.1,
    "hacking_success_weight": 0.05,
    "strength_success_weight": 0,
    "defense_success_weight": 0,
    "dexterity_success_weight": 1.25,
    "agility_success_weight": 0,
    "charisma_success_weight": 0,
    "intelligence_exp": 60 * 0.05
  },
  {
    "name": "Traffick Arms",
    "time": 40e3,
    "money": 600e3,
    "difficulty": 2,
    "karma": 1,
    "hacking_success_weight": 0,
    "charisma_success_weight": 1,
    "strength_success_weight": 1,
    "defense_success_weight": 1,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  },
  {
    "name": "Homicide",
    "time": 3e3,
    "money": 45e3,
    "difficulty": 1,
    "karma": 3,
    "hacking_success_weight": 0,
    "strength_success_weight": 2,
    "defense_success_weight": 2,
    "dexterity_success_weight": 0.5,
    "agility_success_weight": 0.5,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  },
  {
    "name": "Grand Theft Auto",
    "time": 80e3,
    "money": 1.6e6,
    "difficulty": 8,
    "karma": 5,
    "hacking_success_weight": 1,
    "strength_success_weight": 1,
    "defense_success_weight": 0,
    "dexterity_success_weight": 4,
    "agility_success_weight": 2,
    "charisma_success_weight": 2,
    "intelligence_exp": 16 * 0.05
  },
  {
    "name": "Kidnap",
    "time": 120e3,
    "money": 3.6e6,
    "difficulty": 5,
    "karma": 6,
    "hacking_success_weight": 0,
    "strength_success_weight": 1,
    "defense_success_weight": 0,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 1,
    "intelligence_exp": 26 * 0.05
  },
  {
    "name": "Assassination",
    "time": 300e3,
    "money": 12e6,
    "difficulty": 8,
    "karma": 10,
    "hacking_success_weight": 0,
    "strength_success_weight": 1,
    "defense_success_weight": 0,
    "dexterity_success_weight": 2,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 65 * 0.05
  },
  {
    "name": "Heist",
    "time": 600e3,
    "money": 120e6,
    "difficulty": 18,
    "karma": 15,
    "hacking_success_weight": 1,
    "strength_success_weight": 1,
    "defense_success_weight": 1,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 1,
    "intelligence_exp": 130 * 0.05
  }
]