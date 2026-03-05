import { proxy, proxyTry, runIt, hasBN, maxRun, getServerAvailRam, doGetScriptRam, upgHomeRam, destroyWD, getOwnedSF, getResetInf } from "SphyxOS/util.js"
import { getReputationFromDonation, getWork, getPortOpeners, makeNewWindow, getWorth } from "SphyxOS/util.js"
let HASBN14_3 = false
let HASBN13 = false
let HASBN10 = false
let HASBN9 = false
let HASBN7 = false
let HASBN5 = false
let HASBN3 = false
let FAVOR = 150
let GO_CHANGE = true
let GANG_EQ_UPDATE = true
let GANG_EQ_UPDATE2 = true
let augments
let FOCUS
let currentNode
let moneySwitch
const WIDTH = 500
const HEIGHT = 75
let UPGRADED = false
let MOVEON = false
let win
const CASINOMONEY = 10000000000
let PRIMEMONEY
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  ns.ui.openTail()
  ns.ui.resizeTail(WIDTH, HEIGHT)
  ns.clearPort(21)
  ns.writePort(21, ns.pid)
  ns.writePort(1, true)
  ns.atExit(() => {
    ns.clearPort(21)
    ns.writePort(1, true)
    if (win) win.close()
    UPGRADED = false
  })
  win = false
  await getCommands(ns)
  ns.ui.setTailTitle(MOVEON ? "AutoPilot - Will move on" : "AutoPilot - Will not move on")
  if (win) win.header(MOVEON ? "AutoPilot - Will move on" : "AutoPilot - Will not move on")
  augments = await proxy(ns, "singularity.getOwnedAugmentations")
  moneySwitch = false
  FOCUS = !augments.includes("Neuroreceptor Management Implant")
  HASBN14_3 = await hasBN(ns, 14, 3)
  HASBN13 = await hasBN(ns, 13)
  HASBN10 = await hasBN(ns, 10)
  HASBN9 = await hasBN(ns, 9)
  HASBN7 = await hasBN(ns, 7)
  if (!HASBN7) HASBN7 = await hasBN(ns, 6)
  HASBN5 = await hasBN(ns, 5)
  HASBN3 = await hasBN(ns, 3, 3)
  FAVOR = await proxy(ns, "getFavorToDonate")
  GO_CHANGE = true
  GANG_EQ_UPDATE = true
  GANG_EQ_UPDATE2 = true
  const resetInfo = await getResetInf(ns)
  currentNode = resetInfo.currentNode
  PRIMEMONEY = currentNode === 8 ? 249800000 : 0 //Need to travel
  PRIMEMONEY += CASINOMONEY

  const neuroAmount = resetInfo.ownedAugs.get("NeuroFlux Governor") ?? 0
  //Startup
  await ns.sleep(10) //Give the Loader script enough time to reach it's await

  let activeFrags;
  if (HASBN13 && currentNode !== 8) {
    activeFrags = await proxy(ns, "stanek.activeFragments")
    if (activeFrags.length === 0)
      await loadStanek(ns)
    ns.writePort(12, "silent")
    ns.writePort(12, "stanek")
    ns.writePort(1, "puppet stanek on")
  }
  //Currently supported BN's, 1, 2, 3, 4, 5, 6, 7, 9, 10, 14
  //To do: 8, 11, 12, 13
  //Specific startups
  switch (currentNode) {
    case 1:
    case 4:
    case 5:
    case 9:
    case 10:
    default:
      if (HASBN3 && ns.peek(9) === "NULL PORT DATA")
        await runIt(ns, "SphyxOS/bins/corp.js", true, ["quiet"])
      break
    case 2:
      if (ns.peek(6) === "NULL PORT DATA") {
        ns.writePort(16, "Silent")
        ns.writePort(16, "AutoAscend On")
        ns.writePort(1, "gang autoascend on")
        ns.writePort(16, "AutoEQ Off")
        ns.writePort(1, "gang autoeq off")
        ns.writePort(16, "AutoMode")
        ns.writePort(1, "gang mode automode")
        ns.writePort(16, "Sleeves Off")
        ns.writePort(16, "NoTrain")
        ns.writePort(1, "sleeves idle") //Needed for now?
        await runIt(ns, "SphyxOS/bins/gang.js", true, [])
      }
      if (HASBN3 && ns.peek(9) === "NULL PORT DATA")
        await runIt(ns, "SphyxOS/bins/corp.js", true, ["quiet"])
      break
    case 3:
      if (ns.peek(9) === "NULL PORT DATA")
        await runIt(ns, "SphyxOS/bins/corp.js", true, [])
      break
    case 6:
    case 7:
    case 12:
      break
    case 8:
      let hasWSE = false
      let hasTIX = false
      if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        if (await proxy(ns, "stock.hasWseAccount")) hasWSE = true
        if (await proxy(ns, "stock.hasTixApiAccess")) hasTIX = true
      }
      else {
        if (await proxy(ns, "stock.hasWSEAccount")) hasWSE = true
        if (await proxy(ns, "stock.hasTIXAPIAccess")) hasTIX = true
      }
      if (ns.peek(4) === "NULL PORT DATA" && hasWSE && hasTIX) {
        ns.writePort(13, "silent")
        ns.writePort(13, "autobuyoff")
        ns.writePort(1, "stocks autobuy off")
        await runIt(ns, "SphyxOS/bins/tStocks.js", true, [])
      }
      break
  }

  //Always started up
  if (ns.peek(5) === "NULL PORT DATA") {
    ns.writePort(15, "Silent")
    ns.writePort(15, "No Logfile")
    ns.writePort(15, "Repeat On")
    ns.writePort(1, "ipvgo repeat on")
    ns.writePort(15, "Play as White Off")
    ns.writePort(1, "ipvgo playaswhite off")
    ns.writePort(15, HASBN14_3 ? "Cheats On" : "Cheats Off")
    ns.writePort(1, HASBN14_3 ? "ipvgo cheats on" : "ipvgo cheats off")
    ns.writePort(15, "Logging Off")
    ns.writePort(1, "ipvgo logging off")
    ns.writePort(15, "Net Off")
    ns.writePort(1, "ipvgo net off")
    ns.writePort(15, "Slum Off")
    ns.writePort(1, "ipvgo slum off")
    ns.writePort(15, "BH Off")
    ns.writePort(1, "ipvgo bh off")
    ns.writePort(15, "Tetrad Off")
    ns.writePort(1, "ipvgo tetrad off")
    ns.writePort(15, "Daed On")
    ns.writePort(1, "ipvgo daed on")
    ns.writePort(15, "Illum Off")
    ns.writePort(1, "ipvgo illum off")
    ns.writePort(15, "???? Off")
    ns.writePort(1, "ipvgo ???? off")
    ns.writePort(15, "No AI Off")
    ns.writePort(1, "ipvgo noai off")
    ns.writePort(15, "SlowMode Off")
    ns.writePort(1, "ipvgo slowmode off")
    await runIt(ns, "SphyxOS/bins/go.js", true, [])
  }
  if (ns.peek(2) === "NULL PORT DATA") {
    await runIt(ns, "SphyxOS/bins/puppetMini.js", true, [])
  }
  ns.writePort(12, "silent")
  ns.writePort(12, "nopurchaseservers")
  ns.writePort(1, "puppet autobuyservers off")
  ns.writePort(12, "noautohash")
  ns.writePort(1, "puppet autohash off")
  ns.writePort(12, "xp")
  ns.writePort(1, "puppet xp on")
  ns.writePort(12, "nolog")
  ns.writePort(1, "puppet log off")
  ns.writePort(12, "nopad")
  ns.writePort(1, "puppet pad off")

  //Requires individualizing:  8, 11, 12
  let MONEYCHANGE1 = true
  let MONEYCHANGE2 = true
  let MONEYCHANGE3 = true
  let MONEYCHANGE4 = true
  let MONEYCHANGE5 = true
  let MONEYCHANGE6 = true
  let hashMode = "money"
  switch (currentNode) {
    case 1:
    case 3:
    case 4:
    case 5:
    default:
      while (true) {
        //const resetInfo = await proxy(ns, "getResetInfo")
        //const neuroLevel = resetInfo.ownedAugs.get("NeuroFlux Governor") ?? 0
        await casino(ns) //Break the Casino
        await prime(ns)
        await getCommands(ns)
        if (HASBN9 && !await hasAllAugs(ns, "Netburners")) //Netburners
          await factionWork(ns, "1/8", "Netburners", false, false, 80, true)
        else if (!await hasAllAugs(ns, "Tian Di Hui")) //Tian Di Hui
          await factionWork(ns, "2/8", "Tian Di Hui", false, false, false, true, { city: "Chongqing" })
        else if (!await hasAllAugs(ns, "NiteSec")) //NiteSec
          await factionWork(ns, "3/8", "NiteSec", false, true, false, false, { homeRam: 32 })
        else if (!await hasAllAugs(ns, "CyberSec")) //CyberSec
          await factionWork(ns, "4/8", "CyberSec", false, true, false, true)
        else if (!await hasAllAugs(ns, "The Black Hand")) //The Black Hand
          await factionWork(ns, "5/8", "The Black Hand", false, true, false, true, { homeRam: 64 })
        else if (!await hasAllAugs(ns, "BitRunners")) //BitRunners
          await factionWork(ns, "6/8", "BitRunners", true, true, false, true, { homeRam: 128 })
        else if (!await hasAllAugs(ns, "Daedalus")) //Daedalus
          await factionWork(ns, "7/8", "Daedalus", true, false, false, true)
        else //Daedalus after Red Pill
          await farmFaction(ns, "8/8", "Daedalus", false, true)
      }
    case 2:
      while (true) {
        await casino(ns) //Break the Casino
        await prime(ns)
        await getCommands(ns)
        let gangCreation = false
        const moneySources = await proxy(ns, "getMoneySources")
        if (!await proxy(ns, "gang.inGang")) {
          gangCreation = true
          await factionWork(ns, "1/5", "Slum Snakes", false, false, false, true, { job: "field", cstats: 30, hashBuy: 50e12, karma: -9 })
        }
        else if (!await hasAllAugs(ns, "Sector-12")) {
          if (moneySources?.sinceInstall.hacking < 10e9 && GANG_EQ_UPDATE) {
            GANG_EQ_UPDATE = false
            ns.writePort(16, "Silent")
            ns.writePort(16, "AutoEQ Off")
            ns.writePort(1, "gang autoeq off")
          }
          else if (GANG_EQ_UPDATE2 && moneySources?.sinceInstall.hacking > 10e9) {
            GANG_EQ_UPDATE2 = false
            ns.writePort(16, "Silent")
            ns.writePort(16, "AutoEQ On")
            ns.writePort(1, "gang autoeq on")
          }
          if (gangCreation) {
            gangCreation = false
            GO_CHANGE = true
          }
          await gangCheck(ns)
          await factionWork(ns, "2/5", "Sector-12", true, false, false, false, { city: "Sector-12", hashBuy: await maxMoneyNeeded(ns, "Slum Snakes") / 2 })
        }
        else if (!await hasAllAugs(ns, "Slum Snakes")) {
          if (moneySources?.sinceInstall.hacking < 10e9 && GANG_EQ_UPDATE) {
            GANG_EQ_UPDATE = false
            ns.writePort(16, "Silent")
            ns.writePort(16, "AutoEQ Off")
            ns.writePort(1, "gang autoeq off")
          }
          else if (GANG_EQ_UPDATE2 && moneySources?.sinceInstall.hacking > 10e9) {
            GANG_EQ_UPDATE2 = false
            ns.writePort(16, "Silent")
            ns.writePort(16, "AutoEQ On")
            ns.writePort(1, "gang autoeq on")
          }

          await factionWork(ns, "3/5", "Sector-12", false, false, false, false, { city: "Sector-12" })
          await gangCheck(ns)
          if (await hasAllAugs(ns, "Slum Snakes")) {
            await dump(ns)
            UPGRADED = false
            await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
          }
        }
        else if (await proxy(ns, "singularity.getFactionFavor", "Sector-12") < FAVOR) {
          if (moneySources?.sinceInstall.hacking < 10e9 && GANG_EQ_UPDATE) {
            GANG_EQ_UPDATE = false
            ns.writePort(16, "Silent")
            ns.writePort(16, "AutoEQ Off")
            ns.writePort(1, "gang autoeq off")
          }
          else if (GANG_EQ_UPDATE2 && moneySources?.sinceInstall.hacking > 10e9) {
            GANG_EQ_UPDATE2 = false
            ns.writePort(16, "Silent")
            ns.writePort(16, "AutoEQ On")
            ns.writePort(1, "gang autoeq on")
          }
          await gangCheck(ns)
          await factionWork(ns, "4/5", "Sector-12", true, false, false, false, { city: "Sector-12", hashBuy: 1e18 })
        }
        else {
          if (GANG_EQ_UPDATE) {
            GANG_EQ_UPDATE = false
            ns.writePort(16, "Silent")
            ns.writePort(16, "AutoEQ Off")
            ns.writePort(1, "gang autoeq off")
          }
          await farmFaction(ns, "5/5", "Sector-12", false, true, await maxMoneyNeeded(ns, "Slum Snakes"), "hacking", "Sector-12")
        }
      }
    case 6:
    case 7:
      while (true) {
        await casino(ns)
        await prime(ns)
        await getCommands(ns)
        const moneySources = await proxy(ns, "getMoneySources")

        if (moneySources?.sinceInstall.casino < 10000000000) {
          await doCrime(ns, "money")
          clearLogs(ns)
          printLogs(ns, "Crime for Money while we wait for Casino.")
        }
        if (!await proxy(ns, "bladeburner.inBladeburner") && moneySources?.sinceInstall.casino >= 10000000000) {
          clearLogs(ns)
          printLogs(ns, "Training for BB entrance.")
        }
        if (ns.peek(8) === "NULL PORT DATA" && moneySources?.sinceInstall.casino >= 10000000000) {
          ns.writePort(18, "quiet")
          ns.writePort(18, "finisher off")
          ns.writePort(1, "bb finisher off")
          ns.writePort(18, "int mode off")
          ns.writePort(1, "bb int mode off")
          ns.writePort(18, HASBN10 ? "sleeves on" : "sleeves off")
          ns.writePort(1, HASBN10 ? "bb sleeves on" : "bb sleeves off")
          ns.writePort(18, "sleeve infil off")
          ns.writePort(1, "bb sleeve infil off")
          await runIt(ns, "SphyxOS/bins/bb.js", true, [])
          clearLogs(ns)
          printLogs(ns, "Training for BB entrance.")
        }
        if (HASBN9 && moneySources?.sinceInstall.casino >= 10000000000) {
          await hashes(ns, 1000000, "bbsp")
          await hashes(ns, 1000000, "bbrank")
        }
        if (await proxy(ns, "bladeburner.inBladeburner")) {
          let count = 0
          for (const bop of ns.bladeburner.getBlackOpNames()) {
            count += await proxy(ns, "bladeburner.getActionCountRemaining", "Black Operations", bop)            
          }
          clearLogs(ns)
          printLogs(ns, "Waiting for BladeBurner to finish.  " + (ns.bladeburner.getBlackOpNames().length - count) + " / " + ns.bladeburner.getBlackOpNames().length)
          if (count === 0) {
            UPGRADED = false
            await endIt(ns)
          }
        }
        await ns.sleep(1000)
      }
    case 8:
      ns.writePort(12, "silent")
      ns.writePort(12, "nomoney")
      ns.writePort(1, "puppet money off")
      let data4SCost;
      if (ns.ui.getGameInfo()?.versionNumber >= 44)
        data4SCost = await proxy(ns, "stock.has4SDataTixApi") ? 0 : 25000000000
      else
        data4SCost = await proxy(ns, "stock.has4SDataTIXAPI") ? 0 : 25000000000
      let buyAugsFlag = false
      while (true) {
        await casino(ns)
        await prime(ns, false, true)
        await getCommands(ns)
        const moneySources = await proxy(ns, "getMoneySources")
        const player = await proxy(ns, "getPlayer")
        if (moneySources?.sinceInstall.casino >= 10000000000 && MONEYCHANGE1) {
          ns.writePort(13, "silent")
          ns.writePort(13, "autobuy")
          ns.writePort(1, "stocks autobuy on")
          MONEYCHANGE1 = false
        }
        if (data4SCost > 0 && await proxy(ns, "getServerMoneyAvailable", "home") > data4SCost) {
          if (ns.ui.getGameInfo()?.versionNumber >= 44)
            await proxy(ns, "stock.purchase4SMarketDataTixApi")
          else
            await proxy(ns, "stock.purchase4SMarketDataTixApi")
        }
        await proxy(ns, "stock.purchase4SMarketDataTixApi")
        if (!await hasAllAugs(ns, "Tian Di Hui")) { //14b for all augments and neuroflux.  + 25b for 4s = 39b minimum to move on.
          if (MONEYCHANGE2) {
            ns.writePort(13, "silent")
            ns.writePort(13, 290000000 + 1000000) //Set reserve.  Need 1m to enter faction
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE4 && player.factions.includes("Tian Di Hui")) {
            ns.writePort(13, "silent")
            ns.writePort(13, 1000000) //Set reserve.  Need 1m to enter faction
            MONEYCHANGE4 = false
          }
          await factionWork(ns, "1/8 - " + formatNum(ns, 30000000000 + data4SCost + moneySources?.sinceInstall.augmentations, 2) + " - ", "Tian Di Hui", false, false, false, true, { city: "Chongqing", buyRep: false, buyAugs: buyAugsFlag })
          if (MONEYCHANGE3 && await proxy(ns, "singularity.getFactionRep", "Tian Di Hui") >= await maxRepNeeded(ns, "Tian Di Hui") && await proxy(ns, "getServerMoneyAvailable", "home") + await getWorth(ns) > 30000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuyoff")
            ns.writePort(1, "stocks autobuy off")
            ns.writePort(13, "sell")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE5 && !MONEYCHANGE3 && await getWorth(ns) <= 1 && await proxy(ns, "getServerMoneyAvailable", "home") > 28000000000 + moneySources.sinceInstall?.augmentations) {
            buyAugsFlag = true
            MONEYCHANGE5 = false
          }
        }
        else if (!await hasAllAugs(ns, "CyberSec")) {//CyberSec
          if (MONEYCHANGE2) {
            ns.writePort(13, "silent")
            ns.writePort(13, 290000000) //Set reserve.
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE4 && player.factions.includes("CyberSec")) {
            ns.writePort(13, "silent")
            ns.writePort(13, 1000000) //Set reserve.
            MONEYCHANGE4 = false
          }
          await factionWork(ns, "2/8 - " + formatNum(ns, 23000000000 + data4SCost + moneySources?.sinceInstall.augmentations, 2) + " - ", "CyberSec", false, true, false, true, { buyAugs: buyAugsFlag })
          if (MONEYCHANGE3 && await proxy(ns, "singularity.getFactionRep", "CyberSec") >= await maxRepNeeded(ns, "CyberSec") && await proxy(ns, "getServerMoneyAvailable", "home") + await getWorth(ns) > 23000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuyoff")
            ns.writePort(1, "stocks autobuy off")
            ns.writePort(13, "sell")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE5 && !MONEYCHANGE3 && await getWorth(ns) <= 1 && await proxy(ns, "getServerMoneyAvailable", "home") > 21000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            buyAugsFlag = true
            MONEYCHANGE5 = false
          }
        }
        else if (!await hasAllAugs(ns, "NiteSec")) {
          if (MONEYCHANGE2) {
            ns.writePort(13, "silent")
            ns.writePort(13, 290000000) //Set reserve.
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE4 && player.factions.includes("NiteSec")) {
            ns.writePort(13, "silent")
            ns.writePort(13, 1000000) //Set reserve.  Need 1m to enter faction
            MONEYCHANGE4 = false
          }
          await factionWork(ns, "3/8 - " + formatNum(ns, 33000000000 + data4SCost + moneySources?.sinceInstall.augmentations, 2) + " - ", "NiteSec", false, true, false, true, { homeRam: 32, buyRep: false, buyAugs: buyAugsFlag })
          if (MONEYCHANGE3 && await proxy(ns, "singularity.getFactionRep", "NiteSec") >= await maxRepNeeded(ns, "NiteSec") && await proxy(ns, "getServerMoneyAvailable", "home") + await getWorth(ns) > 33000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuyoff")
            ns.writePort(1, "stocks autobuy off")
            ns.writePort(13, "sell")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE5 && !MONEYCHANGE3 && await getWorth(ns) <= 1 && await proxy(ns, "getServerMoneyAvailable", "home") > 31000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            buyAugsFlag = true
            MONEYCHANGE5 = false
          }
        }
        else if (!await hasAllAugs(ns, "The Black Hand")) {
          if (MONEYCHANGE2) {
            ns.writePort(13, "silent")
            ns.writePort(13, 290000000) //Set reserve.
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE4 && player.factions.includes("The Black Hand")) {
            ns.writePort(13, "silent")
            ns.writePort(13, 1000000) //Set reserve.  Need 1m to enter faction
            MONEYCHANGE4 = false
          }
          await factionWork(ns, "4/8 - " + formatNum(ns, 53000000000 + data4SCost + moneySources?.sinceInstall.augmentations, 2) + " - ", "The Black Hand", false, true, false, true, { homeRam: 64, buyRep: false, buyAugs: buyAugsFlag })
          if (MONEYCHANGE3 && await proxy(ns, "singularity.getFactionRep", "The Black Hand") >= await maxRepNeeded(ns, "The Black Hand") && await proxy(ns, "getServerMoneyAvailable", "home") + await getWorth(ns) > 53000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuyoff")
            ns.writePort(1, "stocks autobuy off")
            ns.writePort(13, "sell")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE5 && !MONEYCHANGE3 && await getWorth(ns) <= 1 && await proxy(ns, "getServerMoneyAvailable", "home") > 51000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            buyAugsFlag = true
            MONEYCHANGE5 = false
          }
        }
        else if (!await hasAllAugs(ns, "BitRunners")) {
          if (MONEYCHANGE2) {
            ns.writePort(13, "silent")
            ns.writePort(13, 290000000) //Set reserve.
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE4 && player.factions.includes("BitRunners")) {
            ns.writePort(13, "silent")
            ns.writePort(13, 1000000) //Set reserve.  Need 1m to enter faction
            MONEYCHANGE4 = false
          }
          await factionWork(ns, "5/8 - " + formatNum(ns, 87000000000 + data4SCost + moneySources?.sinceInstall.augmentations, 2) + " - ", "BitRunners", true, true, false, true, { homeRam: 128, buyRep: false, buyAugs: buyAugsFlag })
          if (MONEYCHANGE3 && await proxy(ns, "singularity.getFactionRep", "BitRunners") >= await maxRepNeeded(ns, "BitRunners") && await proxy(ns, "getServerMoneyAvailable", "home") + await getWorth(ns) > 87000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuyoff")
            ns.writePort(1, "stocks autobuy off")
            ns.writePort(13, "sell")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE5 && !MONEYCHANGE3 && await getWorth(ns) <= 1 && await proxy(ns, "getServerMoneyAvailable", "home") > 85000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            buyAugsFlag = true
            MONEYCHANGE5 = false
          }
        }
        else if (!await hasAllAugs(ns, "Daedalus")) {
          if (MONEYCHANGE2) {
            ns.writePort(13, "silent")
            ns.writePort(13, 1000000) //Set reserve.
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE4 && player.skills.hacking >= 2500 && await proxy(ns, "getServerMoneyAvailable", "home") + await getWorth(ns) > 102000000000) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuyoff")
            ns.writePort(1, "stocks autobuy off")
            ns.writePort(13, "sell")
            MONEYCHANGE4 = false
          }
          await factionWork(ns, "7/8 - " + formatNum(ns, 178000000000 + data4SCost + moneySources?.sinceInstall.augmentations, 2) + " - ", "Daedalus", true, false, false, true, { buyRep: false, buyAugs: buyAugsFlag })
          if (MONEYCHANGE3 && await proxy(ns, "singularity.getFactionRep", "Daedalus") >= await maxRepNeeded(ns, "Daedalus") && await proxy(ns, "getServerMoneyAvailable", "home") + await getWorth(ns) > 178000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuyoff")
            ns.writePort(1, "stocks autobuy off")
            ns.writePort(13, "sell")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE5 && !MONEYCHANGE3 && await getWorth(ns) <= 1 && await proxy(ns, "getServerMoneyAvailable", "home") > 176000000000 + data4SCost + moneySources?.sinceInstall.augmentations) {
            buyAugsFlag = true
            MONEYCHANGE5 = false
          }
          if (MONEYCHANGE6 && player.factions.includes("Daedalus")) {
            ns.writePort(13, "silent")
            ns.writePort(13, "autobuy")
            ns.writePort(1, "stocks autobuy on")
            MONEYCHANGE6 = false
          }
        }
        else {
          if (MONEYCHANGE2) {
            ns.writePort(13, "silent")
            ns.writePort(13, 290000000) //Set reserve.
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE4 && player.factions.includes("Daedalus")) {
            ns.writePort(13, "silent")
            ns.writePort(13, 1000000) //Set reserve.  Need 1m to enter faction
            MONEYCHANGE4 = false
          }
          await farmFaction(ns, "8/8", "Daedalus", false, true)
        }
      }
    case 9:
      ns.writePort(12, "silent")
      ns.writePort(12, "nomoney")
      ns.writePort(1, "puppet money off")
      while (true) {
        await casino(ns) //Break the Casino
        await prime(ns, false)
        await getCommands(ns)
        const player = await proxy(ns, "getPlayer")
        const moneySources = await proxy(ns, "getMoneySources")
        const cctCost = await proxy(ns, "hacknet.hashCost", "Generate Coding Contract")
        const minHash = await proxy(ns, "hacknet.hashCost", "Reduce Minimum Security")
        const maxHash = await proxy(ns, "hacknet.hashCost", "Increase Maximum Money")
        const capacity = await proxy(ns, "hacknet.hashCapacity")
        const maxHomeRam = await proxy(ns, "getServerMaxRam", "home")

        const myAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
        if (moneySources?.sinceInstall.casino >= 10000000000 && moneySources?.sinceInstall.hacknet_expenses >= -10000000000) {
          const pidof = await runIt(ns, "SphyxOS/bins/hacknetPurchaser.js", false, [])
          if (pidof) {
            await ns.nextPortWrite(40)
            ns.clearPort(40)
          }
        }
        //Netburners has 5 augments.  We want to buy 6 or more NFG.  Means 11 min in float
        if (!await hasAllAugs(ns, "Netburners") || neuroAmount < 6) {

          if (!await hasAllAugs(ns, "Netburners") && player.factions.includes("Netburners") && await proxy(ns, "singularity.getFactionRep", "Netburners") < await maxRepNeeded(ns, "Netburners"))
            await factionWork(ns, "01/18", "Netburners", false, false, 80, false, { hashBuy: 11e20, hackLvl: 80 })
          else await factionWork(ns, "01/18", "Netburners", false, false, 80, false, { hashBuy: 11e20, hashType: "money", hackLvl: 80 })
          if (player.factions.includes("Netburners") && await hasAllAugs(ns, "Netburners")) {
            await dump(ns)
            await restart(ns, 11)
          }
        }
        //Tian has 8 unique augs to purchase here.  We want at least 3 more NFG, bringing us up to 9 in total for NFG
        else if (!await hasAllAugs(ns, "Tian Di Hui") || neuroAmount < 9) {

          if (!await hasAllAugs(ns, "Tian Di Hui") && player.factions.includes("Tian Di Hui") && await proxy(ns, "singularity.getFactionRep", "Tian Di Hui") < await maxRepNeeded(ns, "Tian Di Hui"))
            await factionWork(ns, "02/18", "Tian Di Hui", false, false, false, false, { city: "Chongqing", hashBuy: 11e20, hackLvl: 50 })
          else await factionWork(ns, "02/18", "Tian Di Hui", false, false, false, false, { city: "Chongqing", hashBuy: 11e20, hashType: "money", hackLvl: 50 })
          if (player.factions.includes("Tian Di Hui") && await hasAllAugs(ns, "Tian Di Hui")) {
            await dump(ns)
            await restart(ns, 8 + 9 - neuroAmount)
          }
        }
        //CyberSec has 5 unitue augs to purchase.  We want at least 6 more NFG, bringing us up to 15
        else if (!await hasAllAugs(ns, "CyberSec") || neuroAmount < 15) {
          if (!await hasAllAugs(ns, "CyberSec") && player.factions.includes("CyberSec") && await proxy(ns, "singularity.getFactionRep", "CyberSec") < await maxRepNeeded(ns, "CyberSec"))
            await factionWork(ns, "03/18", "CyberSec", false, true, false, false, { hashBuy: 1e20, homeRam: 32, hackLvl: 55 })
          else await factionWork(ns, "03/18", "CyberSec", false, true, false, false, { hashBuy: 1e20, homeRam: 32, hashType: "money", hackLvl: 55 })
          if (player.factions.includes("CyberSec") && await hasAllAugs(ns, "CyberSec")) {
            await dump(ns)
            await restart(ns, 5 + 9 - neuroAmount + 6)
          }
        }
        else if (neuroAmount < 40) {
          if (await maxRepNeeded(ns, "Netburners", false) > await proxy(ns, "singularity.getFactionRep", "Netburners"))
            await factionWork(ns, "04/18", "Netburners", false, false, 80, false, { hashBuy: 11e20, hackLvl: 80 })
          else await factionWork(ns, "04/18", "Netburners", false, false, 80, false, { hashBuy: 11e20, hashType: "money", hackLvl: 80 })
          if (player.factions.includes("Netburners")) {
            await dump(ns)
            if (myAugs.length - augments.length >= 7 || myAugs.length - augments.length + neuroAmount >= 40) {//We want at least 50 when done.
              UPGRADED = false
              await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
            }
          }
        }
        //Chongqing has 3 unique augs, we have 40 NFG now, we want another 2 from here.
        else if (!await hasAllAugs(ns, "Chongqing") || neuroAmount < 42) {
          if (!await hasAllAugs(ns, "Chongqing") && player.factions.includes("Chongqing") && await proxy(ns, "singularity.getFactionRep", "Chongqing") < await maxRepNeeded(ns, "Chongqing"))
            await factionWork(ns, "05/18", "Chongqing", false, false, false, false, { city: "Chongqing", hashBuy: 11e20 })
          else await factionWork(ns, "05/18", "Chongqing", false, false, false, false, { city: "Chongqing", hashBuy: 11e20, hashType: "money" })
          if (player.factions.includes("Chongqing") && await hasAllAugs(ns, "Chongqing")) {
            await dump(ns)
            await restart(ns, 3 + 2 + 40 - neuroAmount)
          }
        }
        //NiteSec has 6 unitue augs to purchase.  We have 42NFG, We want at least 0 more NFG, bringing us up to 42
        else if (!await hasAllAugs(ns, "NiteSec")) {
          if (!await hasAllAugs(ns, "NiteSec") && player.factions.includes("NiteSec") && await proxy(ns, "singularity.getFactionRep", "NiteSec") < await maxRepNeeded(ns, "NiteSec")) {
            if (MONEYCHANGE2) {
              ns.writePort(12, "silent")
              ns.writePort(12, "money")
              ns.writePort(1, "puppet money on")
              MONEYCHANGE2 = false
            }
            await factionWork(ns, "06/18", "NiteSec", false, true, false, true, { hackLvl: 205, hashBuy: 1e20 })
          }
          else {
            await factionWork(ns, "06/18", "NiteSec", false, true, false, true, { hackLvl: 205, hashBuy: 1e20, hashType: "money" })
          }
          if (player.factions.includes("NiteSec") && await hasAllAugs(ns, "NiteSec")) {
            await dump(ns)
            await restart(ns, 6 + 42 - neuroAmount)
          }
        }
        //Farm for a while
        else if (neuroAmount < 51) {
          const player = await proxy(ns, "getPlayer")
          if (MONEYCHANGE2 && player.skills.hacking >= 230) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          if (maxHomeRam < 4096) {
            while (await proxy(ns, "singularity.upgradeHomeRam")) { }
            await factionWork(ns, "07/18", "Netburners", true, false, 80, false, { hashBuy: 11e20, hashType: "money", hackLvl: 80, buyRep: false })
          }
          else if (await proxy(ns, "singularity.getFactionFavor", "Netburners") < FAVOR && player.factions.includes("Netburners") && await proxy(ns, "singularity.getFactionRep", "Netburners") < await maxRepNeeded(ns, "Netburners", false))
            await factionWork(ns, "07/18", "Netburners", true, false, 80, false, { hashBuy: 11e20, hackLvl: 80 })
          else if (cctCost < 2400 && player.factions.includes("Netburners") && await proxy(ns, "singularity.getFactionRep", "Netburners") < await maxRepNeeded(ns, "Netburners", false))
            await factionWork(ns, "07/18", "Netburners", false, false, 80, false, { hashBuy: 11e20, hackLvl: 80 })
          else await factionWork(ns, "07/18", "Netburners", false, false, 80, false, { hashBuy: 11e20, hashType: "money", hackLvl: 80 })

          if (maxHomeRam >= 4096) {
            await dump(ns)
          }
          const numAugs = 51 - neuroAmount > 7 ? 7 : 51 - neuroAmount
          await restart(ns, numAugs)
        }
        //The Black Hand has 4 augs 
        else if (!await hasAllAugs(ns, "The Black Hand")) {
          if (cctCost < 4200 && !await hasAllAugs(ns, "The Black Hand") && player.factions.includes("The Black Hand") && await proxy(ns, "singularity.getFactionRep", "The Black Hand") < await maxRepNeeded(ns, "The Black Hand"))
            await factionWork(ns, "08/18", "The Black Hand", false, true, false, true, { homeRam: 64, hackLvl: 345 })
          else await factionWork(ns, "08/18", "The Black Hand", false, true, false, true, { homeRam: 64, hashType: "money", hackLvl: 345 })
          if (player.factions.includes("The Black Hand") && await hasAllAugs(ns, "The Black Hand")) {
            await dump(ns)
            await restart(ns, 4)
          }
        }
        else if (!await hasAllAugs(ns, "Slum Snakes")) {
          if (cctCost < 5200 && player.factions.includes("Slum Snakes") && await proxy(ns, "singularity.getFactionRep", "Slum Snakes") < await maxRepNeeded(ns, "Slum Snakes"))
            await factionWork(ns, "09/18", "Slum Snakes", false, false, false, true, { job: "security", cstats: 30, karma: -9 })
          else await factionWork(ns, "09/18", "Slum Snakes", false, false, false, true, { job: "security", cstats: 30, karma: -9, hashType: "money" })
        }
        else if (!await hasAllAugs(ns, "Tetrads")) {
          if (cctCost < 5200 && player.factions.includes("Tetrads") && await proxy(ns, "singularity.getFactionRep", "Tetrads") < await maxRepNeeded(ns, "Tetrads"))
            await factionWork(ns, "10/18", "Tetrads", false, false, false, true, { job: "security", cstats: 75, city: "Chongqing", karma: -18 })
          else await factionWork(ns, "10/18", "Tetrads", false, false, false, true, { job: "security", cstats: 75, city: "Chongqing", karma: -18, hashType: "money" })
        }
        else if (!await hasAllAugs(ns, "BitRunners")) {
          if (cctCost < 5400 && player.factions.includes("BitRunners") && await proxy(ns, "singularity.getFactionRep", "BitRunners") < await maxRepNeeded(ns, "BitRunners"))
            await factionWork(ns, "11/18", "BitRunners", true, true, false, true, { homeRam: 128, hackLvl: 530 })
          else await factionWork(ns, "11/18", "BitRunners", true, true, false, true, { homeRam: 128, hashType: "money", hackLvl: 530 })
        }
        //Farm for a while
        else if (maxHomeRam < 32768 || neuroAmount < 100) {
          if (MONEYCHANGE2 && player.skills.hacking >= 1100) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          if (MONEYCHANGE3 && ns.peek(3) !== "n00dles") {
            ns.writePort(12, "silent")
            ns.writePort(12, "autohash")
            ns.writePort(1, "puppet autohash on")
            MONEYCHANGE3 = false
            hashMode = "None"
          }
          if (MONEYCHANGE4 && minHash > capacity && maxHash > capacity) {
            ns.writePort(12, "silent")
            ns.writePort(12, "noautohash")
            ns.writePort(1, "puppet autohash off")
            MONEYCHANGE4 = false
            hashMode = "money"
          }
          if (maxHomeRam < 32768) {
            while (await proxy(ns, "singularity.upgradeHomeRam")) { }
            await factionWork(ns, "12/18", "Netburners", true, false, 80, false, { hashBuy: 11e20, hashType: hashMode, hackLvl: 80, buyRep: false })
          }
          else await factionWork(ns, "12/18", "Netburners", true, false, 80, false, { hashBuy: 11e20, hashType: hashMode, hackLvl: 80 })

          if (maxHomeRam >= 32768) {
            await dump(ns)
          }
          await restart(ns, 6)
        }
        else if (!await hasAllAugs(ns, "Daedalus")) {
          if (MONEYCHANGE2 && player.skills.hacking >= 2500) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          if (cctCost < 5400 && player.factions.includes("Daedalus") && await proxy(ns, "singularity.getFactionRep", "Daedalus") < await maxRepNeeded(ns, "Daedalus"))
            await factionWork(ns, "13/18", "Daedalus", true, false, false, true, { hashBuy: 1e21, augsAtOnce: 3, filterNFG: true })
          else await factionWork(ns, "13/18", "Daedalus", true, false, false, true, { hashBuy: 1e21, hashType: "money", augsAtOnce: 3, filterNFG: true })
        }
        else if (!await hasAllAugs(ns, "The Syndicate")) {
          if (MONEYCHANGE2 && player.skills.hacking >= 2500) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          if (cctCost < 5400 && player.factions.includes("The Syndicate") && await proxy(ns, "singularity.getFactionRep", "The Syndicate") < await maxRepNeeded(ns, "The Syndicate"))
            await factionWork(ns, "14/18", "The Syndicate", false, false, false, true, { cstats: 200, city: "Sector-12", hashBuy: 1e21, karma: -90, buyRep: false })
          else await factionWork(ns, "14/18", "The Syndicate", false, false, false, true, { cstats: 200, city: "Sector-12", hashBuy: 1e21, karma: -90, hashType: "train", buyRep: false })
        }
        else if (!await hasAllAugs(ns, "Speakers for the Dead")) {
          if (MONEYCHANGE2 && player.skills.hacking >= 2500) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          if (cctCost < 5400 && player.factions.includes("Speakers for the Dead") && await proxy(ns, "singularity.getFactionRep", "Speakers for the Dead") < await maxRepNeeded(ns, "Speakers for the Dead"))
            await factionWork(ns, "15/18", "Speakers for the Dead", false, false, false, true, { cstats: 300, hashBuy: 50e21, karma: -45, killed: 30 })
          else await factionWork(ns, "15/18", "Speakers for the Dead", false, false, false, true, { cstats: 300, hashBuy: 50e21, karma: -45, killed: 30, hashType: "train" })
        }
        else if (!await hasAllAugs(ns, "The Covenant")) {
          if (MONEYCHANGE2 && player.skills.hacking >= 3000) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          if (cctCost < 5400 && player.factions.includes("The Covenant") && await proxy(ns, "singularity.getFactionRep", "The Covenant") < await maxRepNeeded(ns, "The Covenant"))
            await factionWork(ns, "16/18", "The Covenant", true, false, false, false, { cstats: 850, hashBuy: 1e21, augsAtOnce: 3, filterNFG: true })
          else await factionWork(ns, "16/18", "The Covenant", true, false, false, false, { cstats: 850, hashBuy: 1e21, hashType: "train", augsAtOnce: 3, filterNFG: true })
        }
        else if (!await hasAllAugs(ns, "Illuminati")) {
          if (MONEYCHANGE2 && player.skills.hacking >= 3000) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          if (cctCost < 5400 && player.factions.includes("Illuminati") && await proxy(ns, "singularity.getFactionRep", "Illuminati") < await maxRepNeeded(ns, "Illuminati"))
            await factionWork(ns, "17/18", "Illuminati", true, false, false, false, { cstats: 1200, hashBuy: 1e21 })
          else await factionWork(ns, "17/18", "Illuminati", true, false, false, false, { cstats: 1200, hashBuy: 1e21, hashType: "train" })
        }
        else if (!player.factions.includes("Netburners")) {
          await factionWork(ns, "18/18", "Netburners", true, false, 80, false, { hashbuy: 11e20, hashType: "money", hackLvl: 80, buyRep: false })
        }
        else {
          if (MONEYCHANGE2 && player.skills.hacking >= 4000) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await farmFaction(ns, "18/18", "Netburners", false, true)
        }
      }
    case 10:
      while (true) {
        await casino(ns) //Break the Casino
        await prime(ns)
        await getCommands(ns)
        const newestOwnedAugs = await proxy(ns, "singularity.getOwnedAugmentations")
        if (HASBN9 && !await hasAllAugs(ns, "Netburners")) //Netburners
          await factionWork(ns, "01/15", "Netburners", false, false, 80, true)
        else if (!await hasAllAugs(ns, "Tian Di Hui")) //Tian Di Hui
          await factionWork(ns, "02/15", "Tian Di Hui", false, false, false, true, { city: "Chongqing" })
        else if (!await hasAllAugs(ns, "CyberSec")) //NiteSec
          await factionWork(ns, "03/15", "CyberSec", false, true, false, true)
        else if (!await hasAllAugs(ns, "NiteSec")) //CyberSec
          await factionWork(ns, "04/15", "NiteSec", false, true, false, true, { homeRam: 32 })
        else if (await proxy(ns, "singularity.getFactionFavor", "The Black Hand") < FAVOR) //The Black Hand
          await factionWork(ns, "05/15", "The Black Hand", true, true, false, false, { homeRam: 64 })
        else {
          if (await maxSleeves(ns) === 8 && !await allSleevesUpgraded(ns)) { //
            if (neuroAmount < 140)
              await farmFaction(ns, "06/15", "The Black Hand", true, false, 0)
            else if (!await hasAllAugs(ns, "BitRunners")) //BitRunners
              await factionWork(ns, "07/15", "BitRunners", true, true, false, true, { homeRam: 128 })
            else if (!await hasAllAugs(ns, "Slum Snakes"))
              await factionWork(ns, "08/15", "Slum Snakes", false, false, false, true, { job: "security", cstats: 30, karma: -9 })
            else if (!await hasAllAugs(ns, "Tetrads"))
              await factionWork(ns, "09/15", "Tetrads", false, false, false, true, { job: "security", cstats: 75, city: "Chongqing", karma: -18 })
            else if (!await hasAllAugs(ns, "The Syndicate"))
              await factionWork(ns, "10/15", "The Syndicate", false, false, false, true, { cstats: 200, city: "Sector-12", karma: -90 })
            else if (!await hasAllAugs(ns, "Speakers for the Dead"))
              await factionWork(ns, "11/15", "Speakers for the Dead", true, false, false, true, { cstats: 300, hashBuy: 50e12, karma: -45, killed: 30 })
            else if (!await allSleevesUpgraded(ns)) {//Covenant until we get all sleeves
              const player = await proxy(ns, "getPlayer")
              if (player.factions.includes("The Covenant") && await proxy(ns, "getServerMoneyAvailable", "home") > 120e15) {
                const pidof = await runIt(ns, "SphyxOS/sleeves/buyUpgradeSleeves.js", false, [])
                if (pidof) {
                  await ns.nextPortWrite(40)
                  ns.clearPort(40)
                }
              }
              await factionWork(ns, "12/15", "The Covenant", false, false, false, false, { cstats: 850, hashBuy: 1e21 })
              if (await allSleevesUpgraded(ns)) {
                UPGRADED = false
                await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
                await proxy(ns, "singularity.softReset", "SphyxOS/singularity/restart.js")
              }
            }
          }
          else {
            if (neuroAmount < 100)
              await farmFaction(ns, "06/15", "The Black Hand", true, false, 0)
            else if (!await hasAllAugs(ns, "BitRunners")) //BitRunners
              await factionWork(ns, "07->13/15", "BitRunners", true, true, false, true, { homeRam: 128 })
            else if (!await hasAllAugs(ns, "Daedalus")) //Daedalus
              await factionWork(ns, "13/15", "Daedalus", true, false, false, true)
            else if (!newestOwnedAugs.includes("QLink")) {
              const player = await proxy(ns, "getPlayer")
              if (player.city !== "New Tokyo") {
                clearLogs(ns)
                printLogs(ns, "14/15 - Trying to travel to New Tokyo!  In " + player.city)
                await proxy(ns, "singularity.travelToCity", "New Tokyo")
                await ns.sleep(1000)
                continue
              }//Get to New Tokyo
              let wrk = await getWork(ns)
              if (wrk === null || wrk.type !== "GRAFTING" && await proxy(ns, "getServerMoneyAvailable", "home") > await proxy(ns, "grafting.getAugmentationGraftPrice", "QLink")) {
                await proxy(ns, "grafting.graftAugmentation", "QLink", FOCUS)
              }
              clearLogs(ns)
              printLogs(ns, "14/15 - Grafting QLink.  Please wait.")
              await ns.sleep(1000)
            }
            else
              await farmFaction(ns, "15/15", "Daedalus", false, true, 0)
          }
        }
      }
    case 11:
      while (true) {
        await casino(ns) //Break the Casino
        await prime(ns)
        await getCommands(ns)
        const player = await proxy(ns, "getPlayer")
        if (!augments.includes("Neuroreceptor Management Implant")) {
          if (MONEYCHANGE1 && player.factions.includes("Tian Di Hui")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await restart(ns, 1)
          await factionWork(ns, "1/14", "Tian Di Hui", false, false, false, false, { city: "Chongqing" })
        }
        if (!augments.includes("Nanofiber Weave")) {
          if (MONEYCHANGE1 && player.factions.includes("Tian Di Hui")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await restart(ns, 1)
          await factionWork(ns, "2/14", "Tian Di Hui", false, false, false, false, { city: "Chongqing" })
        }
        else if (!await hasAllAugs(ns, "Tian Di Hui")) {
          if (MONEYCHANGE1 && player.factions.includes("Tian Di Hui")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await restart(ns, 3)
          await factionWork(ns, "3/14", "Tian Di Hui", false, false, false, true, { city: "Chongqing" })
        }
        else if (neuroAmount < 8) {
          if (MONEYCHANGE1) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await dump(ns)
          await restart(ns, 8)
          await factionWork(ns, "4/14", "Tian Di Hui", false, false, false, false, { city: "Chongqing" })
        }
        else if (!await hasAllAugs(ns, "CyberSec")) {
          if (MONEYCHANGE1 && player.factions.includes("CyberSec")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await factionWork(ns, "5/14", "CyberSec", false, true, false, true)
        }
        else if (neuroAmount < 14) {
          if (MONEYCHANGE1 && player.factions.includes("Tian Di Hui")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await dump(ns)
          await restart(ns, 6)
          await factionWork(ns, "6/14", "Tian Di Hui", false, false, false, false, { city: "Chongqing" })
        }
        else if (!await hasAllAugs(ns, "NiteSec")) {
          if (MONEYCHANGE1 && player.factions.includes("NiteSec")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await restart(ns, 2)
          await factionWork(ns, "7/14", "NiteSec", false, true, false, true, { homeRam: 32 })
        }
        else if (neuroAmount < 17) {
          if (MONEYCHANGE1 && player.factions.includes("Tian Di Hui")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await dump(ns)
          await restart(ns, 4)
          await factionWork(ns, "8/14", "Tian Di Hui", false, false, false, false, { city: "Chongqing" })
        }
        else if (!await hasAllAugs(ns, "The Black Hand")) {
          if (MONEYCHANGE3) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nomoney")
            ns.writePort(1, "puppet money off")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE1 && player.factions.includes("The Black Hand")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE1 = false
          }
          await restart(ns, 1)
          if (await proxy(ns, "singularity.getFactionRep", "The Black Hand") < await maxRepNeeded(ns, "The Black Hand"))
            await factionWork(ns, "9/14", "The Black Hand", false, true, false, true, { hashBuy: 12e12, hashType: "None", buyRep: false })
          else {
            await factionWork(ns, "9/14", "The Black Hand", false, true, false, true, { job: "none", hashBuy: 12e12, hashType: "None", buyRep: false })
            await doCrime(ns, "money")
          }
        }
        else if (neuroAmount < 25) {
          if (MONEYCHANGE2 && player.factions.includes("The Black Hand")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await dump(ns)
          await restart(ns, 8)
          await factionWork(ns, "10/14", "The Black Hand", false, true, false, false)//, 0, "None", 1e12, 64, 0, 0, "none", 0, false)
        }
        else if (!await hasAllAugs(ns, "BitRunners")) {
          if (MONEYCHANGE3) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nomoney")
            ns.writePort(1, "puppet money off")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE1 && player.factions.includes("BitRunners")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE1 = false
          }
          if (await proxy(ns, "singularity.getFactionRep", "BitRunners") < await maxRepNeeded(ns, "BitRunners", false))
            await factionWork(ns, "11/14", "BitRunners", true, true, false, true, { homeRam: 128 })
          else {
            await doCrime(ns, "money")
            await factionWork(ns, "11/14", "BitRunners", true, true, false, true, { job: "none", homeRam: 128 })
          }
        }
        else if (neuroAmount < 90) {
          if (MONEYCHANGE3) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nomoney")
            ns.writePort(1, "puppet money off")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE1 && player.factions.includes("BitRunners")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE1 = false
          }
          const numAugs = 90 - neuroAmount > 8 ? 8 : 90 - neuroAmount
          await restart(ns, numAugs)
          await farmFaction(ns, "12/14", "BitRunners", true, false, 1000000)
        }
        else if (!await hasAllAugs(ns, "Daedalus")) {
          if (MONEYCHANGE3) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nomoney")
            ns.writePort(1, "puppet money off")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE1 && player.skills.hacking >= 2500) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE1 = false
          }
          await factionWork(ns, "13/14", "Daedalus", true, false, false, true)
        }
        else {
          if (MONEYCHANGE3) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nomoney")
            ns.writePort(1, "puppet money off")
            MONEYCHANGE3 = false
          }
          if (MONEYCHANGE1 && player.skills.hacking >= 2500) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            ns.writePort(12, "pad")
            ns.writePort(1, "puppet pad on")
            MONEYCHANGE1 = false
          }
          await farmFaction(ns, "14/14", "Daedalus", false, true)
        }
      }
    case 12:
      while (true) {
        //const resetInfo = await proxy(ns, "getResetInfo")
        //const neuroLevel = resetInfo.ownedAugs.get("NeuroFlux Governor") ?? 0
        await casino(ns) //Break the Casino
        await prime(ns)
        await getCommands(ns)
        if (!await hasAllAugs(ns, "Netburners")) //Netburners
          await factionWork(ns, "1/8", "Netburners", false, false, 80, true)
        else if (!await hasAllAugs(ns, "Tian Di Hui")) //Tian Di Hui
          await factionWork(ns, "2/8", "Tian Di Hui", false, false, false, true, { city: "Chongqing" })
        else if (!await hasAllAugs(ns, "NiteSec")) //NiteSec
          await factionWork(ns, "3/8", "NiteSec", false, true, false, false, { homeRam: 32 })
        else if (!await hasAllAugs(ns, "CyberSec")) //CyberSec
          await factionWork(ns, "4/8", "CyberSec", false, true, false, true)
        else if (!await hasAllAugs(ns, "The Black Hand")) //The Black Hand
          await factionWork(ns, "5/8", "The Black Hand", false, true, false, true, { homeRam: 64 })
        else if (!await hasAllAugs(ns, "BitRunners")) //BitRunners
          await factionWork(ns, "6/8", "BitRunners", true, true, false, true, { homeRam: 128 })
        else if (!await hasAllAugs(ns, "Daedalus")) //Daedalus
          await factionWork(ns, "7/8", "Daedalus", true, false, false, true)
        else //Daedalus after Red Pill
          await farmFaction(ns, "8/8", "Daedalus", false, true)
      }
    case 13:
      while (true) {
        const myAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
        await casino(ns) //Break the Casino
        await prime(ns)
        await getCommands(ns)
        const player = await proxy(ns, "getPlayer")
        if (HASBN9 && !await hasAllAugs(ns, "Netburners")) //Netburners
          await factionWork(ns, "01/20", "Netburners", false, false, 80, true)
        else if (!await hasAllAugs(ns, "Tian Di Hui")) //Tian Di Hui
          await factionWork(ns, "02/20", "Tian Di Hui", false, false, false, false, { city: "Chongqing" })
        else if (neuroAmount < 5) {
          if (MONEYCHANGE1) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await dump(ns)
          await restart(ns, 8 + 6)
          await factionWork(ns, "03/20", "Tian Di Hui", false, false, false, false, { city: "Chongqing" })
        }
        else if (!await hasAllAugs(ns, "CyberSec")) //CyberSec
          await factionWork(ns, "04/20", "CyberSec", false, true, false, false)
        else if (neuroAmount < 11) {
          if (MONEYCHANGE1 && myAugs.length - augments.length >= 10) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await dump(ns)
          await restart(ns, 5 + 6)
          await factionWork(ns, "05/20", "CyberSec", false, true, false, false)
        }
        else if (neuroAmount < 42) { //CyberSec should be donatable after
          if (MONEYCHANGE1 && myAugs.length - augments.length >= 6) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await dump(ns)
          await restart(ns, 8)
          await factionWork(ns, "06/20", "CyberSec", false, true, false, false)
        }
        else if (neuroAmount < 47) {
          if (MONEYCHANGE1 && myAugs.length - augments.length >= 3) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await dump(ns)
          await restart(ns, 5)
          await farmFaction(ns, "07/20", "CyberSec", true, false, 1000000000)
        }
        else if (!await hasAllAugs(ns, "Slum Snakes"))
          await factionWork(ns, "08/20", "Slum Snakes", false, false, false, true, { job: "security", cstats: 30, karma: -9 })
        else if (!await hasAllAugs(ns, "Tetrads"))
          await factionWork(ns, "09/20", "Tetrads", false, false, false, true, { job: "security", cstats: 75, city: "Chongqing", karma: -18 })
        else if (!await hasAllAugs(ns, "The Syndicate")) {
          if (MONEYCHANGE1 && player.skills.hacking > 160) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nomoney")
            ns.writePort(1, "puppet money off")
            MONEYCHANGE1 = false
          }
          if (MONEYCHANGE2 && player.factions.includes("The Syndicate")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "10/20", "The Syndicate", true, false, false, true, { cstats: 200, city: "Sector-12", karma: -90 })
        }
        else if (neuroAmount < 55) {
          if (MONEYCHANGE1 && myAugs.length - augments.length >= 2) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          await restart(ns, 4)
          await farmFaction(ns, "11/20", "CyberSec", true, false, 1000000000)
        }
        else if (neuroAmount < 80) {
          if (MONEYCHANGE1 && myAugs.length - augments.length >= 4) {
            ns.writePort(12, "silent")
            ns.writePort(12, "nopurchaseservers")
            ns.writePort(1, "puppet autobuyservers off")
            MONEYCHANGE1 = false
          }
          const amt = 80 - neuroAmount > 8 ? 8 : 80 - neuroAmount
          await restart(ns, amt)
          await farmFaction(ns, "12/20", "CyberSec", true, false, 1000000000)
        }
        else if (!await hasAllAugs(ns, "NiteSec")) //NiteSec
          await factionWork(ns, "13/20", "NiteSec", false, true, false, true, { hashBuy: 1e9, homeRam: 32 })
        else if (!await hasAllAugs(ns, "The Black Hand")) //The Black Hand
          await factionWork(ns, "14/20", "The Black Hand", false, true, false, true, { homeRam: 64 })
        else if (!await hasAllAugs(ns, "BitRunners")) //BitRunners
          await factionWork(ns, "15/20", "BitRunners", true, true, false, true, { homeRam: 128 })
        else if (!await hasAllAugs(ns, "Speakers for the Dead"))
          await factionWork(ns, "16/20", "Speakers for the Dead", true, false, false, true, { cstats: 300, karma: -45, killed: 30 })
        else if (!await hasAllAugs(ns, "The Covenant"))
          await factionWork(ns, "17/20", "The Covenant", true, false, false, false, { cstats: 850, augsAtOnce: 3, filterNFG: true })
        else if (!await hasAllAugs(ns, "Illuminati"))
          await factionWork(ns, "18/20", "Illuminati", true, false, false, false, { cstats: 1200 })
        else if (!await hasAllAugs(ns, "Daedalus")) //Daedalus
          await factionWork(ns, "19/20", "Daedalus", true, false, false, true)
        else //Daedalus after Red Pill
          await farmFaction(ns, "20/20", "CyberSec", true, true, 100000000000)
      }
    case 14:
      ns.writePort(12, "silent")
      ns.writePort(12, "nomoney")
      ns.writePort(1, "puppet money off")
      while (true) {
        //const resetInfo = await proxy(ns, "getResetInfo")
        //const neuroLevel = resetInfo.ownedAugs.get("NeuroFlux Governor") ?? 0
        await casino(ns) //Break the Casino
        await prime(ns)
        await getCommands(ns)
        const player = await proxy(ns, "getPlayer")

        if (HASBN9 && !await hasAllAugs(ns, "Netburners")) {//Netburners
          if (MONEYCHANGE2 && player.skills.hacking >= 80) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "01/15", "Netburners", false, false, 80, true)
        }
        else if (!await hasAllAugs(ns, "Tian Di Hui")) {//Tian Di Hui
          if (MONEYCHANGE2 && player.factions.includes("Tian Di Hui")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "02/15", "Tian Di Hui", false, false, false, true, { city: "Chongqing" })
        }
        else if (!await hasAllAugs(ns, "NiteSec")) {//NiteSec
          if (MONEYCHANGE2 && player.factions.includes("NiteSec")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "03/15", "NiteSec", false, true, false, false, { homeRam: 32 })
        }
        else if (!await hasAllAugs(ns, "CyberSec")) {//CyberSec
          if (MONEYCHANGE2 && player.factions.includes("CyberSec")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "04/15", "CyberSec", false, true, false, true)
        }
        //else if (neuroAmount < 30)
        //await farmFaction(ns, "xx/xx", "CyberSec", true, false)
        else if (!await hasAllAugs(ns, "The Black Hand")) {//The Black Hand
          if (MONEYCHANGE2 && player.factions.includes("The Black Hand")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "05/15", "The Black Hand", false, true, false, true, { homeRam: 64 })
        }
        else if (!await hasAllAugs(ns, "BitRunners")) {//BitRunners
          if (MONEYCHANGE2 && player.factions.includes("BitRunners")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "06/15", "BitRunners", true, true, false, true, { homeRam: 128 })
        }
        else if (neuroAmount < 100) {
          if (MONEYCHANGE2 && player.factions.includes("BitRunners")) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await farmFaction(ns, "07/15", "BitRunners", true, false)
        }
        else if (!await hasAllAugs(ns, "Slum Snakes")) {
          if (MONEYCHANGE2) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "08/15", "Slum Snakes", false, false, false, true, { job: "security", cstats: 30, karma: -9 })
        }
        else if (!await hasAllAugs(ns, "Tetrads")) {
          if (MONEYCHANGE2) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "09/15", "Tetrads", false, false, false, true, { job: "security", cstats: 75, city: "Chongqing", karma: -18 })
        }
        else if (!await hasAllAugs(ns, "The Syndicate")) {
          if (MONEYCHANGE2) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "10/15", "The Syndicate", false, false, false, true, { cstats: 200, city: "Sector-12", hashBuy: 1e21, karma: -90 })
        }
        else if (!await hasAllAugs(ns, "Speakers for the Dead")) {
          if (MONEYCHANGE2) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "11/15", "Speakers for the Dead", false, false, false, true, { cstats: 300, hashBuy: 50e21, karma: -45, killed: 30 })
        }
        else if (!await hasAllAugs(ns, "The Covenant")) {
          if (MONEYCHANGE2) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "12/15", "The Covenant", true, false, false, false, { cstats: 850, hashBuy: 1e21, augsAtOnce: 3, filterNFG: true })
        }
        else if (!await hasAllAugs(ns, "Illuminati")) {
          if (MONEYCHANGE2) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "13/15", "Illuminati", true, false, false, false, { cstats: 1200, hashBuy: 1e21 })
        }
        else if (!await hasAllAugs(ns, "Daedalus")) {//Daedalus
          if (MONEYCHANGE2 && player.skills.hacking >= 2000) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await factionWork(ns, "14/15", "Daedalus", true, false, false, true)
        }
        else {//Daedalus after Red Pill
          if (MONEYCHANGE2 && player.skills.hacking >= 2000) {
            ns.writePort(12, "silent")
            ns.writePort(12, "money")
            ns.writePort(1, "puppet money on")
            MONEYCHANGE2 = false
          }
          await farmFaction(ns, "15/15", "Daedalus", false, true)
        }
      }
  }
}
function formatNum(ns, num, opt) {
  if (ns.ui.getGameInfo()?.versionNumber >= 44)
    return ns.format.number(num, opt)
  else return ns.formatNumber(num, opt)
}
/** @param {NS} ns */
async function restart(ns, augNum) {
  const myAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
  if (myAugs.length - augments.length >= augNum) {
    UPGRADED = false
    await dump(ns)
    await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
  }
}
async function dump(ns) {
  const pidof = await runIt(ns, "SphyxOS/bins/dumpMoney.js", false, [])
  if (pidof) {
    await ns.nextPortWrite(40)
    ns.clearPort(40)
  }
}
/** @param {NS} ns */
function clearLogs(ns) {
  ns.clearLog()
  if (win) win.clear()
}
function printLogs(ns, text) {
  ns.printf(text)
  if (win && win.closed) {
    win = false
    ns.writePort(1, "autopilot popout off")
  }
  if (win) win.update(text)
}
/** @param {NS} ns */
async function prime(ns, purchaseServersOn = true, stocks = false) {
  const moneySources = await proxy(ns, "getMoneySources")
  if (HASBN9 && moneySources?.sinceInstall["hacknet"] < 1000000) await hashes(ns, 1e30, "money")
  if (!UPGRADED && moneySources?.sinceInstall.casino >= 10000000000) {
    if (await proxy(ns, "singularity.getUpgradeHomeRamCost") <= PRIMEMONEY)
      while (await proxy(ns, "singularity.upgradeHomeRam")) { UPGRADED = true }
    if (stocks) {
      if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        if (!await proxy(ns, "stock.hasWseAccount") && await proxy(ns, "stock.purchaseWseAccount")) UPGRADED = true
        if (!await proxy(ns, "stock.hasTixApiAccess") && await proxy(ns, "stock.purchaseTixApi")) UPGRADED = true
      }
      else {
        if (!await proxy(ns, "stock.hasWSEAccount") && await proxy(ns, "stock.purchaseWseAccount")) UPGRADED = true
        if (!await proxy(ns, "stock.hasTIXAPIAccess") && await proxy(ns, "stock.purchaseTixApi")) UPGRADED = true
      }
    }
    if (UPGRADED) {
      UPGRADED = false
      await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
      await proxy(ns, "singularity.softReset", "SphyxOS/singularity/restart.js")
    }
    else (UPGRADED = true)
  }
  if (purchaseServersOn && moneySources?.sinceInstall.casino >= 10000000000 && !moneySwitch) {
    moneySwitch = true
    ns.writePort(12, "silent")
    ns.writePort(12, "purchaseservers")
    ns.writePort(1, "puppet autobuyservers on")
  }
}
async function hashes(ns, moneyCeiling, type = "coding") {
  if (HASBN9 && await proxy(ns, "getServerMoneyAvailable", "home") >= moneyCeiling) {
    const pidof = await runIt(ns, "SphyxOS/bins/hacknetPurchaser.js", false, [])
    if (pidof) {
      await ns.nextPortWrite(40)
      ns.clearPort(40)
    }
  }
  if (HASBN9)
    await runIt(ns, "SphyxOS/extras/hashIt.js", false, [type])
}
async function casino(ns) {
  const moneySources = await proxy(ns, "getMoneySources")
  let CASINO = moneySources.sinceInstall?.casino >= 10e9 ? "Done" : "Need"
  if (CASINO === "Done") return true
  if (CASINO === "Need" && ns.peek(10) === "NULL PORT DATA") {
    const player = await proxy(ns, "getPlayer")
    if (player.city !== "Aevum" && await proxy(ns, "singularity.travelToCity", "Aevum")) {
      if (await proxy(ns, "getServerMoneyAvailable", "home") >= 10000) {
        const pidof = await runIt(ns, "SphyxOS/cheats/casino.js", false, [])
        if (pidof) {
          await ns.nextPortWrite(40) //We can do something else now
          ns.clearPort(40)
        }
      }
    }
    else if (player.city === "Aevum" && await proxy(ns, "getServerMoneyAvailable", "home") > 32000) {
      const pidof = await runIt(ns, "SphyxOS/cheats/casino.js", false, [])
      if (pidof) {
        await ns.nextPortWrite(40) //We can do something else now
        ns.clearPort(40)
      }
    }
  }
  return false
}
/** @param {NS} ns */
async function farmFaction(ns, step, faction, backdoor, end, moneyReserve = 25e12, job = "hacking", city = "None", augs = 11) {
  let player = await proxy(ns, "getPlayer")
  if (!player.factions.includes(faction)) {
    let player = await proxy(ns, "getPlayer")
    if (!player.factions.includes(faction)) {
      if (backdoor) {
        const pidof = await runIt(ns, "SphyxOS/bins/singularityBackdoor.js", false, ["quiet", "autopilot"])
        if (pidof) {
          clearLogs(ns)
          printLogs(ns, step + " Backdooring...")
          await ns.nextPortWrite(40)
          ns.clearPort(40)
        }
      }
      if (city !== "None") {
        if (player.city !== city && !await proxy(ns, "singularity.travelToCity", city)) {
          clearLogs(ns)
          printLogs(ns, step + " Waiting to travel to " + city)
          await ns.sleep(1000)
          return
        }
      }
      await proxy(ns, "singularity.checkFactionInvitations")
      await proxy(ns, "singularity.joinFaction", faction)
      const currentWork = await proxy(ns, "singularity.getCurrentWork")
      if (currentWork?.factionName !== faction) {
        await proxy(ns, "singularity.workForFaction", faction, job, false)
      }
      clearLogs(ns)
      player = await proxy(ns, "getPlayer")
      if (player.factions.includes(faction)) printLogs(ns, step + " Working for " + faction + " for it's NeuroFlux")
      else {
        printLogs(ns, step + " Waiting to work for " + faction)
        await doCrime(ns, "Money")
      }
    }
  }
  else {
    const currentWork = await proxy(ns, "singularity.getCurrentWork")
    if (currentWork?.factionName !== faction) {
      await proxy(ns, "singularity.workForFaction", faction, job, false)
    }
    clearLogs(ns)
    printLogs(ns, step + " Working for " + faction + " for it's NeuroFlux")
    const pidof = await runIt(ns, "SphyxOS/bins/codingContracts.js", false, ["quiet"])
    if (pidof) {
      await ns.nextPortWrite(40)
      ns.clearPort(40)
    }
  }
  if (end) await endIt(ns)
  if (await proxy(ns, "getServerMoneyAvailable", "home") > moneyReserve) {
    await dump(ns)
  }
  await restart(ns, augs)
  if (await proxy(ns, "singularity.getFactionFavor", faction) < FAVOR * 3 / 4 && await proxy(ns, "singularity.getFactionFavorGain", faction) + await proxy(ns, "singularity.getFactionFavor", faction) > FAVOR * 3 / 4) {
    //Reset for favor
    await dump(ns)
    UPGRADED = false
    await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
    await proxy(ns, "singularity.softReset", "SphyxOS/singularity/restart.js")
  }
  else if (await proxy(ns, "singularity.getFactionFavor", faction) >= FAVOR * 3 / 4 && await proxy(ns, "singularity.getFactionFavor", faction) < FAVOR && await proxy(ns, "singularity.getFactionFavorGain", faction) + await proxy(ns, "singularity.getFactionFavor", faction) > FAVOR) {
    //Reset for Max favor
    await dump(ns)
    UPGRADED = false
    await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
    await proxy(ns, "singularity.softReset", "SphyxOS/singularity/restart.js")
  }
  const TRP = augments.includes("The Red Pill")
  if (GO_CHANGE && (ipvgoOpponents.includes(faction) || TRP)) {
    GO_CHANGE = false
    ns.writePort(15, "Silent")
    ns.writePort(15, "Net Off")
    ns.writePort(1, "ipvgo net off")
    ns.writePort(15, "Slum Off")
    ns.writePort(1, "ipvgo slum off")
    ns.writePort(15, "BH Off")
    ns.writePort(1, "ipvgo bh off")
    ns.writePort(15, "Tetrad Off")
    ns.writePort(1, "ipvgo tetrad off")
    ns.writePort(15, "Daed Off")
    ns.writePort(1, "ipvgo daed off")
    ns.writePort(15, "Illum Off")
    ns.writePort(1, "ipvgo illum off")
    ns.writePort(15, "???? Off")
    ns.writePort(1, "ipvgo ???? off")
    if (TRP) {
      ns.writePort(15, "???? On")
      ns.writePort(1, "ipvgo ???? on")
    }
    else {
      if (currentNode === 9) {
        ns.writePort(15, "Net On")
        ns.writePort(1, "ipvgo net on")
      }
      else {
        ns.writePort(15, "Daed On")
        ns.writePort(1, "ipvgo daed on")
      }
      switch (faction) {
        case "Netburners":
          ns.writePort(15, "Net On")
          ns.writePort(1, "ipvgo net on")
          break
        case "Slum Snakes":
          ns.writePort(15, "Slum On")
          ns.writePort(1, "ipvgo slum on")
          break
        case "The Black Hand":
          ns.writePort(15, "BH On")
          ns.writePort(1, "ipvgo bh on")
          break
        case "Tetrads":
          ns.writePort(15, "Tetrad On")
          ns.writePort(1, "ipvgo tetrad on")
          break
        case "Daedalus":
          ns.writePort(15, "Daed On")
          ns.writePort(1, "ipvgo daed on")
          break
        case "Illuminati":
          ns.writePort(15, "Illum On")
          ns.writePort(1, "ipvgo illum on")
          break
      }
    }
  }
  else if (GO_CHANGE) {
    GO_CHANGE = false
    ns.writePort(15, "Silent")
    ns.writePort(15, "Net Off")
    ns.writePort(1, "ipvgo net off")
    ns.writePort(15, "Slum Off")
    ns.writePort(1, "ipvgo slum off")
    ns.writePort(15, "BH Off")
    ns.writePort(1, "ipvgo bh off")
    ns.writePort(15, "Tetrad Off")
    ns.writePort(1, "ipvgo tetrad off")
    ns.writePort(15, "Daed Off")
    ns.writePort(1, "ipvgo daed off")
    ns.writePort(15, "Illum Off")
    ns.writePort(1, "ipvgo illum off")
    ns.writePort(15, "???? Off")
    ns.writePort(1, "ipvgo ???? off")
    if (currentNode === 9) {
      ns.writePort(15, "Net On")
      ns.writePort(1, "ipvgo net on")
    }
    else {
      ns.writePort(15, "Daed On")
      ns.writePort(1, "ipvgo daed on")
    }
  }
  await ns.sleep(1000)
}
/** @param {NS} ns */
async function factionWork(ns, step, faction, breakToMaxFavor, backdoor, hacknetPurchase, restart, settings) {
  const job = settings?.job ?? "hacking"
  const cstats = settings?.cstats ?? 0
  const city = settings?.city ?? "None"
  const hashBuy = settings?.hashBuy ?? 1e12
  const homeRam = settings?.homeRam ?? 0
  const karma = settings?.karma ?? 0
  const killed = settings?.killed ?? 0
  const hashType = settings?.hashType ?? "coding"
  const hackLvl = settings?.hackLvl ?? 0
  const buyRep = settings?.buyRep ?? true
  const augsAtOnce = settings?.augsAtOnce ?? 11
  const filterNFG = settings?.filterNFG ?? false
  const moneySaved = settings?.moneySaved ?? 1000000
  const buyAugs = settings?.buyAugs ?? true

  let player = await proxy(ns, "getPlayer")
  if (!player.factions.includes(faction)) {
    await proxy(ns, "singularity.checkFactionInvitations")
    await ns.sleep(4)
    await proxy(ns, "singularity.joinFaction", faction)
    const player2 = await proxy(ns, "getPlayer")
    if (player2.factions.includes(faction)) return
    if (backdoor) {
      const pidof = await runIt(ns, "SphyxOS/bins/singularityBackdoor.js", false, ["quiet", "autopilot"])
      if (pidof) {
        await ns.nextPortWrite(40)
        ns.clearPort(40)
      }
    }
    const moneySources = await proxy(ns, "getMoneySources")
    if (moneySources?.sinceInstall.casino >= 10000000000) {
      if (homeRam > await proxy(ns, "getServerMaxRam", "home"))
        await proxy(ns, "singularity.upgradeHomeRam")
      if (hacknetPurchase && player.skills.hacking >= hacknetPurchase) {
        const pidof = await runIt(ns, "SphyxOS/bins/hacknetPurchaser.js", false, [])
        if (pidof) {
          await ns.nextPortWrite(40)
          ns.clearPort(40)
        }
      }
      if (HASBN9 && hashType !== "None") {
        const ports = await getPortOpeners(ns)
        if (ports < 5) await hashes(ns, hashBuy, "money")
        await hashes(ns, hashBuy, hashType)
      }
      const skills = player.skills
      const wrk = await getWork(ns)
      if (skills.hacking < hacknetPurchase || skills.hacking < hackLvl) {
        if (player.city !== "Sector-12" && !await proxy(ns, "singularity.travelToCity", "Sector-12")) {
          clearLogs(ns)
          printLogs(ns, step + " Waiting to travel to Sector-12")
          await doCrime(ns, "Money")
          await ns.sleep(1000)
          return
        }
        clearLogs(ns)
        const highest = hacknetPurchase > hackLvl ? hacknetPurchase : hackLvl
        printLogs(ns, step + " Train Hack to " + highest)
        if (wrk === null || wrk.classType !== "Computer Science")
          await proxy(ns, "singularity.universityCourse", "Rothman University", "Computer Science", FOCUS)
        await ns.sleep(1000)
        return
      }

      if (cstats > 0 && (skills.agility < cstats || skills.strength < cstats || skills.defense < cstats || skills.dexterity < cstats)) {
        if (player.city !== "Sector-12" && !await proxy(ns, "singularity.travelToCity", "Sector-12")) {
          clearLogs(ns)
          printLogs(ns, step + " Waiting to travel to Sector-12")
          await doCrime(ns, "Money")
          await ns.sleep(1000)
          return
        }
        if (skills.strength < cstats) {
          clearLogs(ns)
          printLogs(ns, step + " Train Str to " + cstats)
          if (wrk === null || wrk.classType !== "str")
            await proxy(ns, "singularity.gymWorkout", "Powerhouse Gym", "str", FOCUS)
        }
        else if (skills.agility < cstats) {
          clearLogs(ns)
          printLogs(ns, step + " Train Agi to " + cstats)
          if (wrk === null || wrk.classType !== "agi")
            await proxy(ns, "singularity.gymWorkout", "Powerhouse Gym", "agi", FOCUS)
        }
        else if (skills.defense < cstats) {
          clearLogs(ns)
          printLogs(ns, step + " Train Def to " + cstats)
          if (wrk === null || wrk.classType !== "def")
            await proxy(ns, "singularity.gymWorkout", "Powerhouse Gym", "def", FOCUS)
        }
        else {
          clearLogs(ns)
          printLogs(ns, step + " Train Dex to " + cstats)
          if (wrk === null || wrk.classType !== "dex")
            await proxy(ns, "singularity.gymWorkout", "Powerhouse Gym", "dex", FOCUS)
        }
        await ns.sleep(1000)
        return
      }
      if (karma !== 0 && karma < 0 && ns.heart.break() > karma) { //One day there may be positive karma.  I know I tried once.
        clearLogs(ns)
        printLogs(ns, step + " Need Karma")
        await doCrime(ns, "Karma")
        await ns.sleep(1000)
        return
      }
      if (player.numPeopleKilled < killed) {
        clearLogs(ns)
        printLogs(ns, step + " Need Kills")
        await doCrime(ns, "Killed")
        await ns.sleep(1000)
        return
      }
      if (city !== "None") {
        if (player.city !== city && !await proxy(ns, "singularity.travelToCity", city)) {
          clearLogs(ns)
          printLogs(ns, step + " Waiting to travel to " + city)
          await doCrime(ns, "Money")
          await ns.sleep(1000)
          return
        }
      }
    }
    await proxy(ns, "singularity.checkFactionInvitations")
    await ns.sleep(4)
    await proxy(ns, "singularity.joinFaction", faction)
    const currentWork = await proxy(ns, "singularity.getCurrentWork")
    if (job !== "none" && currentWork?.factionName !== faction)
      await proxy(ns, "singularity.workForFaction", faction, job, FOCUS)
    clearLogs(ns)
    player = await proxy(ns, "getPlayer")
    if (player.factions.includes(faction)) printLogs(ns, step + " Working for " + faction)
    else {
      printLogs(ns, step + " Waiting to work for " + faction)
      await doCrime(ns, "Money")
    }
  }
  else {
    const currentWork = await proxy(ns, "singularity.getCurrentWork")
    if (job !== "none" && currentWork?.factionName !== faction)
      await proxy(ns, "singularity.workForFaction", faction, job, FOCUS)
    if (HASBN3 && await proxy(ns, "singularity.getFactionRep", faction) < await maxRepNeeded(ns, faction)) {
      const corp = await proxyTry(ns, "corporation.getCorporation")
      if (corp && corp.valuation >= 100000000000000) {
        await proxyTry(ns, "corporation.bribe", faction, corp.funds / 100)
      }
    }
    if (buyAugs && !await hasAllAugs(ns, faction) && await proxy(ns, "singularity.getFactionRep", faction) >= await maxRepNeeded(ns, faction) && await proxy(ns, "getServerMoneyAvailable", "home") > await maxMoneyNeeded(ns, faction)) {
      let augsFromFaction = await proxy(ns, "singularity.getAugmentationsFromFaction", faction)
      augsFromFaction = augsFromFaction.filter(f => f !== "NeuroFlux Governor")

      let augs = []
      for (const aug of augsFromFaction) {
        const record = {
          "Name": aug,
          "Price": await proxy(ns, "singularity.getAugmentationPrice", aug)
        }
        augs.push(record)
      }
      augs = augs.toSorted((a, b) => b.Price - a.Price)
      let augCheck = true
      while (augCheck && await proxy(ns, "getServerMoneyAvailable", "home") > await maxMoneyNeeded(ns, faction)) {
        augCheck = false
        for (const aug of augs)
          if (await proxy(ns, "singularity.purchaseAugmentation", faction, aug.Name)) {
            augCheck = true
            break
          }
      }
    }
    else if (HASBN9 && hashType !== "None") {
      const ports = await getPortOpeners(ns)
      if (ports < 5) await hashes(ns, hashBuy, "money")
      await hashes(ns, hashBuy, hashType)
    }
    clearLogs(ns)
    printLogs(ns, step + " Working for " + faction)
    const pidof = await runIt(ns, "SphyxOS/bins/codingContracts.js", false, ["quiet"])
    if (pidof) {
      await ns.nextPortWrite(40)
      ns.clearPort(40)
    }
  }
  const myAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
  const augments = await proxy(ns, "singularity.getOwnedAugmentations")
  if (restart && myAugs.length - augments.length >= augsAtOnce) {
    UPGRADED = false
    await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
  }
  const augs = await proxy(ns, "singularity.getOwnedAugmentations")
  const TRP = augs.includes("The Red Pill")
  if (GO_CHANGE && (ipvgoOpponents.includes(faction) || TRP)) {
    GO_CHANGE = false
    ns.writePort(15, "Silent")
    ns.writePort(15, "Net Off")
    ns.writePort(1, "ipvgo net off")
    ns.writePort(15, "Slum Off")
    ns.writePort(1, "ipvgo slum off")
    ns.writePort(15, "BH Off")
    ns.writePort(1, "ipvgo bh off")
    ns.writePort(15, "Tetrad Off")
    ns.writePort(1, "ipvgo tetrad off")
    ns.writePort(15, "Daed Off")
    ns.writePort(1, "ipvgo daed off")
    ns.writePort(15, "Illum Off")
    ns.writePort(1, "ipvgo illum off")
    ns.writePort(15, "???? Off")
    ns.writePort(1, "ipvgo ???? off")
    if (TRP) {
      ns.writePort(15, "???? On")
      ns.writePort(1, "ipvgo ???? on")
    }
    else {
      if (currentNode === 9) {
        ns.writePort(15, "Net On")
        ns.writePort(1, "ipvgo net on")
      }
      else {
        ns.writePort(15, "Daed On")
        ns.writePort(1, "ipvgo daed on")
      }
      switch (faction) {
        case "Netburners":
          ns.writePort(15, "Net On")
          ns.writePort(1, "ipvgo net on")
          break
        case "Slum Snakes":
          ns.writePort(15, "Slum On")
          ns.writePort(1, "ipvgo slum on")
          break
        case "The Black Hand":
          ns.writePort(15, "BH On")
          ns.writePort(1, "ipvgo bh on")
          break
        case "Tetrads":
          ns.writePort(15, "Tetrad On")
          ns.writePort(1, "ipvgo tetrad on")
          break
        case "Daedalus":
          ns.writePort(15, "Daed On")
          ns.writePort(1, "ipvgo daed on")
          break
        case "Illuminati":
          ns.writePort(15, "Illum On")
          ns.writePort(1, "ipvgo illum on")
          break
      }
    }
  }
  else if (GO_CHANGE) {
    GO_CHANGE = false
    ns.writePort(15, "Silent")
    ns.writePort(15, "Net Off")
    ns.writePort(1, "ipvgo net off")
    ns.writePort(15, "Slum Off")
    ns.writePort(1, "ipvgo slum off")
    ns.writePort(15, "BH Off")
    ns.writePort(1, "ipvgo bh off")
    ns.writePort(15, "Tetrad Off")
    ns.writePort(1, "ipvgo tetrad off")
    ns.writePort(15, "Daed Off")
    ns.writePort(1, "ipvgo daed off")
    ns.writePort(15, "Illum Off")
    ns.writePort(1, "ipvgo illum off")
    ns.writePort(15, "???? Off")
    ns.writePort(1, "ipvgo ???? off")
    if (currentNode === 9) {
      ns.writePort(15, "Net On")
      ns.writePort(1, "ipvgo net on")
    }
    else {
      ns.writePort(15, "Daed On")
      ns.writePort(1, "ipvgo daed on")
    }
  }
  if (breakToMaxFavor) {
    if (await proxy(ns, "singularity.getFactionFavor", faction) < FAVOR * 3 / 4 && await proxy(ns, "singularity.getFactionFavorGain", faction) + await proxy(ns, "singularity.getFactionFavor", faction) > FAVOR * 3 / 4) {
      //Reset for favor
      await dump(ns)
      UPGRADED = false
      await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
      await proxy(ns, "singularity.softReset", "SphyxOS/singularity/restart.js")
    }
    else if (await proxy(ns, "singularity.getFactionFavor", faction) >= FAVOR * 3 / 4 && await proxy(ns, "singularity.getFactionFavor", faction) < FAVOR && await proxy(ns, "singularity.getFactionFavorGain", faction) + await proxy(ns, "singularity.getFactionFavor", faction) > FAVOR) {
      //Reset for Max favor
      await dump(ns)
      UPGRADED = false
      await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
      await proxy(ns, "singularity.softReset", "SphyxOS/singularity/restart.js")
    }
  }
  if (buyRep && await proxy(ns, "singularity.getFactionFavor", faction) >= FAVOR) {
    const maxRep = await maxRepNeeded(ns, faction, filterNFG)
    if (await proxy(ns, "singularity.getFactionRep", faction) < maxRep) {
      const donate = await getReputationFromDonation(ns, 1e6) //Rep for donating 1e6 dollars
      const rep = await proxy(ns, "singularity.getFactionRep", faction)
      const targetrep = maxRep
      const maxDonate = ((targetrep - rep) / donate * 1e6) + 1
      const moneyAvailable = await proxy(ns, "getServerMoneyAvailable", "home")
      await proxy(ns, "singularity.donateToFaction", faction, Math.min(moneyAvailable - moneySaved, maxDonate))
    }
  }
  if (restart && await hasAllAugs(ns, faction)) {
    await dump(ns)
    UPGRADED = false
    await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
  }
  await ns.sleep(1000)
}
/** @param {NS} ns */
async function gangCheck(ns) {
  const player = await proxy(ns, "getPlayer")
  const total = await totalAugs(ns, "Slum Snakes", true)
  const myMoney = await proxy(ns, "getServerMoneyAvailable", "home")
  const maxMoney = Math.min(await currentMaxUnlockCost(ns, "Slum Snakes"), 8e9)
  const hasMoney = myMoney >= maxMoney
  const waiting = await augsWaiting(ns)
  if ((await totalAugs(ns, "Slum Snakes") === total && total !== 0 && hasMoney) || (total + waiting > 11 && waiting === 0 && hasMoney) || (total + waiting > 11 && waiting > 0)) {
    await dump(ns)
  }
  if (await augsWaiting(ns) >= 8) {
    UPGRADED = false
    await proxy(ns, "singularity.installAugmentations", "SphyxOS/singularity/restart.js")
  }
  if (player.skills.hacking >= 15000) await endIt(ns)
}
/** @param {NS} ns */
async function augsWaiting(ns) {
  const augs1 = await proxy(ns, "singularity.getOwnedAugmentations", true)
  const augs2 = await proxy(ns, "singularity.getOwnedAugmentations", false)
  return augs1.length - augs2.length
}
/** @param {NS} ns */
async function totalAugs(ns, faction, onlyUnlocked = false) {
  const allFacAugs = await proxy(ns, "singularity.getAugmentationsFromFaction", faction)
  const allAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
  const factionAugs = allFacAugs.filter(f => f !== "NeuroFlux Governor" && !allAugs.includes(f))
  let count = 0
  const rep = await proxy(ns, "singularity.getFactionRep", faction)
  for (const aug of factionAugs) {
    if (onlyUnlocked) {
      if (rep >= await proxy(ns, "singularity.getAugmentationRepReq", aug)) count++
    }
    else count++
  }
  return count
}
/** @param {NS} ns */
async function hasAllAugs(ns, faction) {
  const allAugs = await proxy(ns, "singularity.getAugmentationsFromFaction", faction)
  const factionAugs = allAugs.filter(f => f !== "NeuroFlux Governor")
  const ownedAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
  for (const aug of factionAugs) {
    if (!ownedAugs.includes(aug)) return false
  }
  return true
}
/** @param {NS} ns */
async function maxRepNeeded(ns, faction, filterNFG = true) {
  const allFacAugs = await proxy(ns, "singularity.getAugmentationsFromFaction", faction)
  const allAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
  let factionAugs
  if (filterNFG) factionAugs = allFacAugs.filter(f => f !== "NeuroFlux Governor" && !allAugs.includes(f))
  else factionAugs = allFacAugs.filter(aug => !allAugs.includes(aug))
  let repNeeded = 0
  for (const aug of factionAugs) {
    const rep = await proxy(ns, "singularity.getAugmentationRepReq", aug)
    if (rep > repNeeded) repNeeded = rep
  }
  return repNeeded
}
/** @param {NS} ns */
async function maxMoneyNeeded(ns, faction) {
  const allFacAugs = await proxy(ns, "singularity.getAugmentationsFromFaction", faction)
  const allAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
  const factionAugs = allFacAugs.filter(f => f !== "NeuroFlux Governor" && !allAugs.includes(f))
  let moneyNeeded = 0
  for (const aug of factionAugs) {
    const money = await proxy(ns, "singularity.getAugmentationPrice", aug)
    if (money > moneyNeeded) moneyNeeded = money
  }
  return moneyNeeded
}
/** @param {NS} ns */
async function currentMaxUnlockCost(ns, faction) {
  const allFacAugs = await proxy(ns, "singularity.getAugmentationsFromFaction", faction)
  const allAugs = await proxy(ns, "singularity.getOwnedAugmentations", true)
  const tmp = allFacAugs.filter(f => f !== "NeuroFlux Governor" && !allAugs.includes(f))
  const factionAugs = []
  const myRep = await proxy(ns, "singularity.getFactionRep", faction)
  for (const aug of tmp) {
    const rep = await proxy(ns, "singularity.getAugmentationRepReq", aug)
    if (myRep >= rep) factionAugs.push(aug)
  }
  let moneyNeeded = 0
  for (const aug of factionAugs) {
    const money = await proxy(ns, "singularity.getAugmentationPrice", aug)
    if (money > moneyNeeded) moneyNeeded = money
  }
  return moneyNeeded
}
/** @param {NS} ns */
async function endIt(ns) {
  //We need to upgrade ram to a certain minimum.
  const maxRam = await maxRun(ns, false)
  if (maxRam < 256 && await getServerAvailRam(ns, "home") < 256) {
    const upgCost = await doGetScriptRam(ns, "SphyxOS/singularity/upgradeHomeRam.js")
    if (maxRam >= upgCost) await upgHomeRam(ns)
  }
  else if (maxRam >= 256) {
    const nextBN = await getNextBN(ns)
    if (MOVEON) await destroyWD(ns, nextBN, "SphyxOS/singularity/restart.js")
    else {
      if (!ns.fileExists("b1t_flum3.exe")) {
        while (!ns.fileExists("b1t_flum3.exe", "home")) {
          clearLogs(ns)
          printLogs(ns, "Creating b1t_flum3.exe.  Please wait")
          await proxy(ns, "singularity.createProgram", "b1t_flum3.exe")
          await ns.sleep(5000)
        }
      }
      UPGRADED = false
      await destroyWD(ns, 1, "SphyxOS/singularity/flume.js")
    }
  }
}
/** @param {NS} ns */
async function getNextBN(ns) {
  let nextbn = 0
  let nextbnlvl = 0
  for (let check of bnorder) {
    let isthere = false
    const sourceFiles = await getOwnedSF(ns)
    for (const bn of sourceFiles) {
      let bonus = 0
      const resetInfo = await getResetInf(ns)
      if (resetInfo.currentNode == check[0]) bonus = 1
      if (bn.n == check[0] && bn.lvl + bonus >= check[1]) isthere = true
      if (bn.n == resetInfo.currentNode && 1 >= check[1]) isthere = true
      if (currentNode === check[0] && 1 >= check[1]) isthere = true
    }
    if (isthere == false) {
      nextbn = check[0]
      nextbnlvl = check[1]
      break
    }
  }
  let value = ns.sprintf("%s" + "." + "%s", nextbn, nextbnlvl)
  return Number.parseInt(value)
}
/** @param {NS} ns */
async function loadStanek(ns) {
  let defaultFileLocation = "/SphyxOS/stanek/loadouts/"
  await proxy(ns, "stanek.acceptGift")
  const homeFiles = await proxy(ns, "ls", "home", defaultFileLocation)
  const files = homeFiles.map(m => [m.substring(defaultFileLocation.length - 1), defaultFileLocation])

  let usableFiles = []
  for (const testFile of files) {
    //const testFile = file.substring(12)
    const [width, hight, ...fileName] = testFile[0].substring(0, testFile[0].length - 4).split("x")
    if (width <= await proxy(ns, "stanek.giftWidth") && hight <= await proxy(ns, "stanek.giftHeight") && fileName.includes("autoPilot"))
      usableFiles.push([width + "x" + hight + "x" + fileName.join("x"), testFile[1]])
  }
  usableFiles = usableFiles.sort((a, b) => {
    const [width, height] = a[0].split("x")
    const [width2, height2] = b[0].split("x")
    return (width2 + height2) - (width + height)
  })
  const selectable = []
  for (const usableFile of usableFiles) {
    selectable.push(usableFile[0])
  }
  const chosen = selectable.shift()
  if (chosen === "") {
    ns.toast("No loadout for Stanek found!", "error", 3000)
    ns.exit()
  }
  else {
    ns.stanek.clearGift()
    for (const file of usableFiles) {
      if (chosen === file[0]) {
        defaultFileLocation = file[1]
        break
      }
    }
    await proxy(ns, "scp", defaultFileLocation + chosen + ".txt", ns.self().server, "home")
    const file = JSON.parse(ns.read(defaultFileLocation + chosen + ".txt"))
    for (const frag of file) {
      //.x, .y, .rotation, .id
      await proxy(ns, "stanek.placeFragment", frag.x, frag.y, frag.rotation, frag.id)
    }
  }
}
/** @param {NS} ns */
async function allSleevesUpgraded(ns) {
  const numSleeves = await proxy(ns, "sleeve.getNumSleeves")
  if (await maxSleeves(ns) > numSleeves) return false
  for (let slv = 0; slv < numSleeves; slv++) {
    const mrBean = await proxy(ns, "sleeve.getSleeve", slv)
    if (mrBean.memory < 100) return false
  }
  return true
}
async function maxSleeves(ns) {
  const resetInfo = await proxy(ns, "getResetInfo")
  const sourceFiles = []
  for (const item of resetInfo.ownedSF) {
    const record = {
      "n": item[0],
      "lvl": item[1]
    }
    sourceFiles.push(record)
  }
  let added = currentNode === 10 ? 1 : 0
  for (const sf of sourceFiles) if (sf.n === 10) {
    added += sf.lvl === 3 ? 2 : sf.lvl
  }
  return 5 + added
}


/** @param {NS} ns */
async function doCrime(ns, type, slv = null) {
  //Cycle our crimes and find the best for our mode.
  const me = slv === null ? await proxy(ns, "getPlayer") : await proxy(ns, "sleeve.getSleeve", slv)
  let bestRatio = 0
  let bestCrime = "Mug"
  for (const crime of crimes) {
    const chance = getChance(crime, me)
    const gain = type === "Money" ? crime.money : type === "Karma" ? crime.karma : type === "Killed" ? crime.kills : crime.intelligence_exp
    const ratio = gain * chance / crime.time
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestCrime = crime.name
    }
  }
  if (slv === null) {
    const maxRam = await maxRun(ns, false, false)
    if (maxRam < ns.getFunctionRamCost("singularity.commitCrime") + 1.6)
      return
    const task = await proxy(ns, "singularity.getCurrentWork")
    if (task?.crimeType !== bestCrime) {
      await proxyTry(ns, "singularity.commitCrime", bestCrime, FOCUS)
      if (maxRam < ns.getFunctionRamCost("singularity.commitCrime") + 1.6) {
        ns.toast("Please commit " + bestCrime, "info", 10000)
        await ns.sleep(10000)
      }
    }
  }
  else {
    const task = await proxy(ns, "sleeve.getTask", slv)
    if (task?.crimeType !== bestCrime)
      await proxyTry(ns, "sleeve.setToCommitCrime", slv, bestCrime)
  }
}

function getChance(crimestats, person) {
  let hackweight = crimestats.hacking_success_weight * person.skills.hacking
  let strweight = crimestats.strength_success_weight * person.skills.strength
  let defweight = crimestats.defense_success_weight * person.skills.defense
  let dexweight = crimestats.dexterity_success_weight * person.skills.dexterity
  let agiweight = crimestats.agility_success_weight * person.skills.agility
  let chaweight = crimestats.charisma_success_weight * person.skills.charisma
  let intweight = HASBN5 ? 0.025 * person.skills.intelligence : 0
  let chance = hackweight + strweight + defweight + dexweight + agiweight + chaweight + intweight
  chance /= 975
  chance /= crimestats.difficulty
  chance *= person.mults.crime_success
  if (HASBN5) chance *= 1 + (1 * Math.pow(person.skills.intelligence, 0.8)) / 600
  chance *= 100
  return Math.min(chance, 100)
}
/** @param {NS} ns */
async function getCommands(ns) {
  let silent = false
  while (ns.peek(22) !== "NULL PORT DATA") {
    let result = ns.readPort(22)
    switch (result) {
      case "popout":
        win = await makeNewWindow("AutoPilot", ns.ui.getTheme())
        if (!silent) ns.tprintf("Autopilot will use a popout")
        if (win) win.header(MOVEON ? "AutoPilot - Will move on" : "AutoPilot - Will not move on")
        break
      case "nopopout":
        if (win) win.close()
        win = false
        if (!silent) ns.tprintf("Autopilot will not use a popout")
        break
      case "moveon":
        MOVEON = true
        if (!silent) ns.tprintf("Autopilot will move on when done")
        ns.ui.setTailTitle("AutoPilot - Will move on")
        if (win) win.header("AutoPilot - Will move on")
        break;
      case "nomoveon":
        MOVEON = false
        if (!silent) ns.tprintf("Autopilot will not move on when done")
        ns.ui.setTailTitle("AutoPilot - Will not move on")
        if (win) win.header("AutoPilot - Will not move on")
        break;
      case "silent":
        silent = true
        break;
      default:
        ns.tprintf("Invalid command received in Autopilot: %s", result)
        break;
    }
  }
}
const crimes = [
  {
    "name": "Shoplift",
    "time": 2e3,
    "money": 15e3,
    "difficulty": 1 / 20,
    "karma": 0.1,
    "kills": 0,
    "hacking_success_weight": 0,
    "strength_success_weight": 0,
    "defense_success_weight": 0,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  },/*
  {
    "name": "Rob Store",
    "time": 60e3,
    "money": 400e3,
    "difficulty": 1 / 5,
    "karma": 0.5,
    "kills": 0,
    "hacking_success_weight": 0.5,
    "strength_success_weight": 0,
    "defense_success_weight": 0,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 7.5 * 0.05
  },*/
  {
    "name": "Mug",
    "time": 4e3,
    "money": 36e3,
    "difficulty": 1 / 5,
    "karma": 0.25,
    "kills": 0,
    "hacking_success_weight": 0,
    "strength_success_weight": 1.5,
    "defense_success_weight": 0.5,
    "dexterity_success_weight": 1.5,
    "agility_success_weight": 0.5,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  },/*
  {
    "name": "Larceny",
    "time": 90e3,
    "money": 800e3,
    "difficulty": 1 / 3,
    "karma": 1.5,
    "kills": 0,
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
    "kills": 0,
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
    "kills": 0,
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
    "kills": 0,
    "hacking_success_weight": 0,
    "charisma_success_weight": 1,
    "strength_success_weight": 1,
    "defense_success_weight": 1,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  },*/
  {
    "name": "Homicide",
    "time": 3e3,
    "money": 45e3,
    "difficulty": 1,
    "karma": 3,
    "kills": 1,
    "hacking_success_weight": 0,
    "strength_success_weight": 2,
    "defense_success_weight": 2,
    "dexterity_success_weight": 0.5,
    "agility_success_weight": 0.5,
    "charisma_success_weight": 0,
    "intelligence_exp": 0
  }/*,
  {
    "name": "Grand Theft Auto",
    "time": 80e3,
    "money": 1.6e6,
    "difficulty": 8,
    "karma": 5,
    "kills": 0,
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
    "kills": 0,
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
    "kills": 1,
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
    "kills": 0,
    "hacking_success_weight": 1,
    "strength_success_weight": 1,
    "defense_success_weight": 1,
    "dexterity_success_weight": 1,
    "agility_success_weight": 1,
    "charisma_success_weight": 1,
    "intelligence_exp": 130 * 0.05
  }*/
]
//[[0, 1]]  [0] is Node, [1] is lvl
const bnorder = [[4, 3], [5, 1], [3, 3], [10, 3], [7, 1], [9, 3], [14, 3], [13, 3], [1, 3], [2, 3], [7, 3], [6, 3], [8, 3], [5, 3], [11, 3], [12, 99999]]
const ipvgoOpponents = ["Tetrads", "The Black Hand", "Daedalus", "Illuminati", "????????????"]
//const ipvgoOpponents = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati", "????????????"]