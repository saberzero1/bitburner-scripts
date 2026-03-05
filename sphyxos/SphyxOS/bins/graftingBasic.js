import { proxy, proxyTry, makeNewWindow } from "SphyxOS/util.js"
let win;
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  let g = ns.grafting
  ns.atExit(() => {
    ns.clearPort(20)
    ns.writePort(1, true)
    if (win) {
      ns.writePort(1, "grafting popout off")
      win.close()
    }
  })
  ns.clearPort(20)
  ns.writePort(20, ns.pid)
  win = false
  let graftable = await proxy(ns, "grafting.getGraftableAugmentations")
  let queue = []
  graftable.unshift("Done")
  let FOCUS = graftable.includes("Neuroreceptor Management Implant")
  let SPECIFIC = await ns.prompt("Select Augment:", { type: "select", choices: graftable })

  if (SPECIFIC === "" || SPECIFIC === "Done")
    ns.exit()
  queue.push(SPECIFIC)
  while (SPECIFIC !== "" && SPECIFIC !== "Done") {
    SPECIFIC = await ns.prompt("Select Next Queued Augment:", { type: "select", choices: graftable.filter(f => !queue.includes(f)) })
    if (SPECIFIC !== "" && SPECIFIC !== "Done") {
      queue.push(SPECIFIC)
    }
  }
  ns.ui.openTail()
  ns.clearLog()
  await getCommands(ns)
  update(ns, ns.sprintf("Neuroreceptor Management Implant: %s", !FOCUS))
  if (FOCUS) update(ns, "Please remain focused or your time will increase.")
  else update(ns, "You can unfocus and do other things without penalty now.")
  update(ns, "Grafting: Unknown")
  update(ns, "Will take a min of Unknown.")
  update(ns, "Script will continue once this graft is finished.")
  let ready = false
  try {
    g.waitForOngoingGrafting().then(() => {
      ready = true
    })
  }
  catch { ready = true }
  while (!ready) {
    await getCommands(ns)
    clearAll(ns)
    update(ns, ns.sprintf("Neuroreceptor Management Implant: %s", !FOCUS))
    if (FOCUS) update(ns, "Please remain focused or your time will increase.")
    else update(ns, "You can unfocus and do other things without penalty now.")
    update(ns, "Grafting: Unknown")
    update(ns, "Will take a min of Unknown.")
    update(ns, "Script will continue once this graft is finished.")
    await ns.asleep(200)
  }
  while (queue.length > 0) {
    graftable = await proxy(ns, "grafting.getGraftableAugmentations")
    FOCUS = graftable.includes("Neuroreceptor Management Implant")
    let player = await proxy(ns, "getPlayer")
    let city = player.city
    if (city !== "New Tokyo") {
      while (city !== "New Tokyo") {
        ns.clearLog()
        update(ns, ns.sprintf("You need to travel to New Tokyo!  Currently in %s", city))
        player = await proxy(ns, "getPlayer")
        city = player.city
        await ns.sleep(100)
      }
    }//Get to New Tokyo
    ns.clearLog()
    SPECIFIC = queue.shift()
    graftable = await proxy(ns, "grafting.getGraftableAugmentations")
    FOCUS = graftable.includes("Neuroreceptor Management Implant")
    await proxyTry(ns, "grafting.graftAugmentation", SPECIFIC, FOCUS)
    update(ns, ns.sprintf("Neuroreceptor Management Implant: %s", !FOCUS))
    if (FOCUS) update(ns, ns.sprintf("Please remain focused or your time will increase."))
    else update(ns, ns.sprintf("You can unfocus and do other things without penalty now."))
    update(ns, ns.sprintf("Grafting: %s", SPECIFIC))
    const graftTime = await proxyTry(ns, "grafting.getAugmentationGraftTime", SPECIFIC)
    if (graftTime) {
      if (ns.ui.getGameInfo()?.versionNumber >= 44) update(ns, ns.sprintf("Will take a min of %s", ns.format.time(graftTime)))
      else update(ns, ns.sprintf("Will take a min of %s", ns.tFormat(graftTime)))
    }
    if (queue.length > 0) {
      const price = await proxyTry(ns, "grafting.getAugmentationGraftPrice", queue[0])
      if (price) {
        if (ns.ui.getGameInfo()?.versionNumber >= 44) update(ns, ns.sprintf("Queued: %s for $%s", queue[0], ns.format.number(price, 3)))
        else update(ns, ns.sprintf("Queued: %s for $%s", queue[0], ns.tFormat(price, 3)))
      }
      else update(ns, "Queued: Invalid and will be skipped.")
      update(ns, ns.sprintf("#Queued After above: %s", queue.length - 1))
    }
    const time = performance.now()
    ready = false
    try {
      g.waitForOngoingGrafting().then(() => {
        ready = true
      })
    }
    catch { ready = true }
    while (!ready) {
      await getCommands(ns)
      clearAll(ns)
      update(ns, ns.sprintf("Neuroreceptor Management Implant: %s", !FOCUS))
      if (FOCUS) update(ns, ns.sprintf("Please remain focused or your time will increase."))
      else update(ns, ns.sprintf("You can unfocus and do other things without penalty now."))
      update(ns, ns.sprintf("Grafting: %s", SPECIFIC))
      const graftTime = await proxyTry(ns, "grafting.getAugmentationGraftTime", SPECIFIC)
      if (graftTime) {
        if (ns.ui.getGameInfo()?.versionNumber >= 44) update(ns, ns.sprintf("Will take a min of %s", ns.format.time(graftTime)))
        else update(ns, ns.sprintf("Will take a min of %s", ns.tFormat(graftTime)))
      }
      if (queue.length > 0) {
        const price = await proxyTry(ns, "grafting.getAugmentationGraftPrice", queue[0])
        if (price) {
          if (ns.ui.getGameInfo()?.versionNumber >= 44) update(ns, ns.sprintf("Queued: %s for $%s", queue[0], ns.format.number(price, 3)))
          else update(ns, ns.sprintf("Queued: %s for $%s", queue[0], ns.tFormat(price, 3)))
        }
        else update(ns, "Queued: Invalid and will be skipped.")
        update(ns, ns.sprintf("#Queued After above: %s", queue.length - 1))
      }
      await ns.asleep(200)
    }
    if (performance.now() - time < 1000) {
      const augPrice = await proxyTry(ns, "grafting.getAugmentationGraftPrice", SPECIFIC)
      if (!augPrice)
        update(ns, "You have already installed this.")
      else if (ns.getServerMoneyAvailable("home") < augPrice)
        update(ns, "You need more money for this augment")
      else
        update(ns, ns.sprintf("Need to install a pre-req for %s first", SPECIFIC))
    }

    if (queue.length === 0) {
      update(ns, "No augments left in queue.  Finishing up.")
      break
    }
  }
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