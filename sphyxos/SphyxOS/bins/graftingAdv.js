import { proxy, proxyTry, getWork, makeNewWindow } from "SphyxOS/util.js"
let win
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  ns.atExit(() => {
    ns.clearPort(20)
    ns.writePort(1, true)
    if (win) {
      win.close()
      ns.writePort(1, "grafting popout off")
    }
  })
  ns.clearPort(20)
  ns.writePort(20, ns.pid)
  win = false
  let graftable = await getGraftable(ns)
  const specificQueue = []
  let MODE = await ns.prompt("Select Priority:", { type: "select", choices: priorities })
  let SPECIFIC;
  let FOCUS = graftable.includes("Neuroreceptor Management Implant")
  if (MODE === "Specific") SPECIFIC = await ns.prompt("Select Augment:", { type: "select", choices: graftable })
  if (MODE === "" || (MODE === "Specific" && SPECIFIC === "")) {
    ns.tprint("No selection made in grafter.  Exiting")
    ns.exit()
  }
  else if (MODE === "Specific") specificQueue.push(SPECIFIC)

  while (MODE === "Specific" && SPECIFIC !== "" && SPECIFIC !== "Done") {
    graftable = await getGraftable(ns, specificQueue)
    SPECIFIC = await ns.prompt("Select Next Queued Augment:", { type: "select", choices: ["Done"].concat(graftable) })
    if (SPECIFIC !== "" && SPECIFIC !== "Done") {
      specificQueue.push(SPECIFIC)
    }
  }
  ns.ui.openTail()
  await getCommands(ns)
  let player = await proxy(ns, "getPlayer")
  let city = player.city
  if (city !== "New Tokyo") {
    while (city !== "New Tokyo") {
      await ns.sleep(100)
      clearAll(ns)
      update(ns, ns.sprintf("Trying to travel to New Tokyo!  In %s", city))
      await proxy(ns, "singularity.travelToCity", "New Tokyo")
      player = await proxy(ns, "getPlayer")
      city = player.city

    }
  }//Get to New Tokyo
  let temp = []
  if (MODE !== "Specific") {
    graftable = await proxy(ns, "grafting.getGraftableAugmentations")

    for (const graft of graftable) {
      const record = {
        "name": graft,
        "price": await proxy(ns, "grafting.getAugmentationGraftPrice", graft),
        "stats": await proxy(ns, "singularity.getAugmentationStats", graft),
        "time": await proxy(ns, "grafting.getAugmentationGraftTime", graft)
      }
      temp.push(record)
    }
  }
  if (MODE !== "Specific") {
    switch (MODE) {
      case "None":
        graftable = temp
        break
      case "Price Highest":
        graftable = temp.toSorted((a, b) => { return b.price - a.price })
        break
      case "Price Lowest":
        graftable = temp.toSorted((a, b) => { return a.price - b.price })
        break
      case "Fastest":
        graftable = temp.toSorted((a, b) => { return a.time - b.time })
        break
      case "Special":
        break
      case "H/G/W Speed":
        graftable = temp.toSorted((a, b) => { return b.stats?.hacking_speed - a.stats?.hacking_speed })
        break
      case "Hack Power":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacking_money - a.stats?.hacking_money) })
        break
      case "Grow Power":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacking_grow - a.stats?.hacking_grow) })
        break
      case "Hack Success":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacking_chance - a.stats?.hacking_chance) })
        break
      case "Hacking":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacking_exp - a.stats?.hacking_exp) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacking - a.stats?.hacking) })
        break
      case "Strength":
        graftable = temp.toSorted((a, b) => { return (b.stats?.strength_exp - a.stats?.strength_exp) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.strength - a.stats?.strength) })
        break
      case "Defence":
        graftable = temp.toSorted((a, b) => { return (b.stats?.defense_exp - a.stats?.defense_exp) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.defense - a.stats?.defense) })
        break
      case "Dexterity":
        graftable = temp.toSorted((a, b) => { return (b.stats?.dexterity_exp - a.stats?.dexterity_exp) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.dexterity - a.stats?.dexterity) })
        break
      case "Agility":
        graftable = temp.toSorted((a, b) => { return (b.stats?.agility_exp - a.stats?.agility_exp) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.agility - a.stats?.agility) })
        break
      case "Charisma":
        graftable = temp.toSorted((a, b) => { return (b.stats?.charisma_exp - a.stats?.charisma_exp) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.charisma - a.stats?.charisma) })
        break
      case "Reputation":
        graftable = temp.toSorted((a, b) => { return (b.stats?.company_rep - a.stats?.company_rep) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.faction_rep - a.stats?.faction_rep) })
        break
      case "Work Money":
        graftable = temp.toSorted((a, b) => { return (b.stats?.work_money - a.stats?.work_money) })
        break
      case "Crime Money":
        graftable = temp.toSorted((a, b) => { return (b.stats?.crime_success - a.stats?.crime_success) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.crime_money - a.stats?.crime_money) })
        break
      case "Crime Chance":
        graftable = temp.toSorted((a, b) => { return (b.stats?.crime_money - a.stats?.crime_money) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.crime_success - a.stats?.crime_success) })
        break
      case "HackNet Production":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_money - a.stats?.hacknet_node_money) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_ram_cost - a.stats?.hacknet_node_ram_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_core_cost - a.stats?.hacknet_node_core_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_level_cost - a.stats?.hacknet_node_level_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_money - a.stats?.hacknet_node_money) })
        break
      case "Hacknet Level Costs":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_money - a.stats?.hacknet_node_money) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_ram_cost - a.stats?.hacknet_node_ram_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_core_cost - a.stats?.hacknet_node_core_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_level_cost - a.stats?.hacknet_node_level_cost) })
        break
      case "Hacknet RAM Costs":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_money - a.stats?.hacknet_node_money) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_core_cost - a.stats?.hacknet_node_core_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_level_cost - a.stats?.hacknet_node_level_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_ram_cost - a.stats?.hacknet_node_ram_cost) })
        break
      case "HackNet Core Cost":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_money - a.stats?.hacknet_node_money) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_ram_cost - a.stats?.hacknet_node_ram_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_level_cost - a.stats?.hacknet_node_level_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_money - a.stats?.hacknet_node_money) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_core_cost - a.stats?.hacknet_node_core_cost) })
        break
      case "HackNet Money":
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_ram_cost - a.stats?.hacknet_node_ram_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_core_cost - a.stats?.hacknet_node_core_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_level_cost - a.stats?.hacknet_node_level_cost) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.hacknet_node_money - a.stats?.hacknet_node_money) })
        break
      case "BB Analysis":
        graftable = temp.toSorted((a, b) => { return (b.stats?.bladeburner_analysis - a.stats?.bladeburner_analysis) })
        break
      case "BB Stamina":
        graftable = temp.toSorted((a, b) => { return (b.stats?.bladeburner_stamina_gain - a.stats?.bladeburner_stamina_gain) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.bladeburner_max_stamina - a.stats?.bladeburner_max_stamina) })
        break
      case "BB Stamina Gain":
        graftable = temp.toSorted((a, b) => { return (b.stats?.bladeburner_max_stamina - a.stats?.bladeburner_max_stamina) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.bladeburner_stamina_gain - a.stats?.bladeburner_stamina_gain) })
        break
      case "BB Success Chance":
        graftable = temp.toSorted((a, b) => { return (b.stats?.agility - a.stats?.agility) })
        graftable = temp.toSorted((a, b) => { return (b.stats?.bladeburner_success_chance - a.stats?.bladeburner_success_chance) })
        break
      default:
        ns.tprintf("Invalid Mode received in grafter: %s", MODE)
        ns.exit()
    }
    graftable = graftable.map(g => g.name)
  }
  if (MODE === "Special") graftable = special
  //New while loop here with a queue
  //graftable is now sorted, or I have my specificQueue
  const augments = MODE !== "Specific" ? graftable : specificQueue
  const bench = []
  while (augments.length > 0) { //Expand this while loop
    await getCommands(ns)
    const aug = augments.shift()
    if (!await proxyTry(ns, "grafting.getAugmentationGraftPrice", aug)) continue
    player = await proxy(ns, "getPlayer")
    city = player.city
    if (city !== "New Tokyo") {
      while (city !== "New Tokyo") {
        clearAll(ns)
        update(ns, ns.sprintf("Trying to travel to New Tokyo!  Currently in %s", city))
        await proxy(ns, "singularity.travelToCity", "New Tokyo")
        player = await proxy(ns, "getPlayer")
        city = player.city
        await ns.sleep(100)
      }
    }//Get to New Tokyo
    clearAll(ns)
    update(ns, "Waiting on a graft to start.")
    graftable = await getGraftable(ns)
    FOCUS = graftable.includes("Neuroreceptor Management Implant")
    let wrk = await getWork(ns)
    if (wrk == null || wrk.type !== "GRAFTING") {
      if (!await proxy(ns, "grafting.graftAugmentation", aug, FOCUS)) {
        bench.push(aug) //Keep track of what we've skipped
        if (augments.length === 0)
          while (bench.length > 0)
            augments.unshift(bench.pop())
        await ns.sleep(100)
        continue
      }
    }
    wrk = await getWork(ns)
    while (wrk && wrk.type === "GRAFTING") {
      await getCommands(ns)
      clearAll(ns)
      update(ns, ns.sprintf("Mode: %s", MODE))
      update(ns, ns.sprintf("Neuroreceptor Management Implant: %s", !FOCUS))
      update(ns, ns.sprintf("Grafting: %s", wrk.augmentation))
      if (ns.ui.getGameInfo()?.versionNumber >= 44) update(ns, ns.sprintf("Will take roughly %s", ns.format.time(await proxy(ns, "grafting.getAugmentationGraftTime", wrk.augmentation) - (wrk.cyclesWorked * 200))))
      else update(ns, ns.sprintf("Will take roughly %s", ns.tFormat(await proxy(ns, "grafting.getAugmentationGraftTime", wrk.augmentation) - (wrk.cyclesWorked * 200))))
      const augStats = await proxy(ns, "singularity.getAugmentationStats", wrk.augmentation)
      for (const [name, stat] of Object.entries(augStats)) if (stat !== 1) update(ns, ns.sprintf("%s - %s", name, stat))
      if (FOCUS) update(ns, "Can be off if you unfocus")
      else update(ns, "You can do something else now.")
      await ns.sleep(500)
      wrk = await getWork(ns)
    }
    await ns.sleep(100)
    while (bench.length > 0)
      augments.unshift(bench.pop())
  }
  update(ns, "No augments left in list, finishing up.")
  await ns.sleep(1000)
}
/** @param {NS} ns */
async function getGraftable(ns, willOwnAugs = []) {
  const ownedAugs = await proxy(ns, "singularity.getOwnedAugmentations")
  ownedAugs.push(...willOwnAugs)
  const graftableAugs = await proxy(ns, "grafting.getGraftableAugmentations")
  const graftable = graftableAugs.filter((aug) => {
    if (ownedAugs.includes(aug)) return false
    const preReq = ns.singularity.getAugmentationPrereq(aug)
    if (preReq.length === 0) return true
    const ownedPreReq = preReq.filter((pre) => ownedAugs.includes(pre))
    if (ownedPreReq.length === preReq.length) return true
    return false
  })
  return graftable
}
/** @param {NS} ns */
function clearAll(ns) {
  ns.clearLog()
  if (win) win.clear()
}
/** @param {NS} ns */
function update(ns, text) {
  ns.printf(text)
  if (win && win.closed) {
    win = false
    ns.writePort(1, "grafting popout off")
  }
  if (win) win.update(text)
}
/** @param {NS} ns */
async function getCommands(ns) {
  let silent = false
  while (ns.peek(23) !== "NULL PORT DATA") {
    let result = ns.readPort(23)
    switch (result) {
      case "popout":
        win = await makeNewWindow("Grafting", ns.ui.getTheme())
        if (!silent) ns.tprintf("Grafting will use a popout")
        break
      case "nopopout":
        if (win) win.close()
        win = false
        if (!silent) ns.tprintf("Grafting will not use a popout")
        break
      case "silent":
        silent = true
        break;
      default:
        ns.tprintf("Invalid command received in GraftingBasic: %s", result)
        break;
    }
  }
}
const special = ["violet Congruity Implant", "Neuroreceptor Management Implant", "PCMatrix", "BitRunners Neurolink"]
const priorities = ["None", "Specific", "Price Highest", "Price Lowest", "Fastest", "Special", "H/G/W Speed", "Hack Power", "Grow Power", "Hack Success", "Hacking", "Strength", "Defence", "Dexterity", "Agility", "Charisma", "Reputation", "Work Money", "Crime Money", "Crime Chance", "HackNet Production", "Hacknet Level Costs", "HackNet RAM Cost", "HackNet Core Cost", "HackNet Money", "BB Analysis", "BB Stamina", "BB Stamina Gain", "BB Success Chance"]