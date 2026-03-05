import { getResetInf, getOwnedSF, runIt, proxy, proxyTry, getServersLight, getServerAvailRam } from "SphyxOS/util.js"
const version = "v2.6.10"
const openDB = new Set
let optionsDB = []
let resetInfo
let sourceFiles
let wnd

/*Static port numbers for comms:
 * 1  - this script (loader) receive
 * 2  - puppetMini: emit pid
 * 3  - puppetMini: emit bestTarget
 * 4  - stocks: emit pid
 * 5  - ipvgo: emit pid
 * 6  - gangs: emit pid
 * 7  - sleeves: emit pid
 * 8  - BB: emit pid
 * 9  - corps: emit pid
 * 10 - casino: emit pid
 * 11 - stanek: emit pid
 * 12 - puppetMini receive
 * 13 - stocks receive
 * 15 - ipvgo receive
 * 16 - gangs receive
 * 17 - sleeves receive
 * 18 - BB receive
 * 19 - corps receive
 * 20 - grafting: emit pid
 * 21 - autopilot: emit pid
 * 22 - autopilot receive
 * 23 - grafting basic/adv: receive
 * 24 - darknet complete passwords
 * 25 - darknet in progress
 * 26 = darknet currently working on
 * 30 - autoInfil:
 */
/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  const bbVersionNum = ns.ui.getGameInfo()?.versionNumber ?? "<=43"
  const bbVersionName = ns.ui.getGameInfo().version
  const bbVersionCommit = ns.ui.getGameInfo().commit
  const bbPlatform = ns.ui.getGameInfo().platform
  ns.ui.openTail()
  await ns.sleep(10) //Give stuff time to end.  Issues when updating.
  resetInfo = await getResetInf(ns)
  sourceFiles = await getOwnedSF(ns)
  if (hasBN(resetInfo, sourceFiles, 13)) await proxy(ns, "stanek.acceptGift")
  //optionsDB = []
  if (globalThis["document"].autopilot) optionsDB["AutoPilotMoveOn"] = globalThis["document"].autopilot
  await setOptionsDB(ns)

  if (ns.args.includes("BBRestart")) { //Restart from BB
    if (hasBN(resetInfo, sourceFiles, 10)) { //Sleeves
      optionsDB["SleeveMode"] = "BB"
      optionsDB["BBFinisher"] = true
      await buttonBBStart(ns)
      await buttonBatcherStart(ns)
    }
  }
  if (ns.args.includes("autoPilot")) { //Restart from autoPilot
    if (hasBN(resetInfo, sourceFiles, 4, 2)) {
      ns.writePort(22, "silent")
      ns.writePort(22, optionsDB["AutoPilotMoveOn"] ? "moveon" : "nomoveon")
      await runIt(ns, "SphyxOS/bins/autopilot.js", true, [])
    }
  }
  while (true) {
    processCommands(ns)
    wnd = globalThis["window"]
    ns.clearLog()
    //Buttons that show up when unlocked
    const batcherUseHacknet = hasBN(resetInfo, sourceFiles, 9, 1) ? <button style={optionsDB["BatcherUseHacknet"] ? greenStyle : redStyle} onClick={() => buttonBatcherUseHacknet(ns)}>{"Use Hacknet"}</button> : ""
    const batcherAutoHash = hasBN(resetInfo, sourceFiles, 9, 1) ? <button style={optionsDB["BatcherAutoHash"] ? greenStyle : redStyle} onClick={() => buttonBatcherAutoHash(ns)}>{"Auto Hash"}</button> : ""
    const batcherChargeStanek = hasBN(resetInfo, sourceFiles, 13) ? <button style={optionsDB["BatcherStanek"] ? greenStyle : redStyle} onClick={() => buttonBatcherToggleStanek(ns)}>{"Charge Stanek"}</button> : ""
    const batcherAutoBuyHacknet = hasBN(resetInfo, sourceFiles, 9, 1) ? <button style={optionsDB["BatcherAutoBuyHacknet"] ? greenStyle : redStyle} onClick={() => buttonBatcherAutoBuyHacknet(ns)}>{"Batcher: AutoBuy"}</button> : ""
    const miscBackdoorBasic = !hasBN(resetInfo, sourceFiles, 4, 2) ? <button style={greenStyle} onClick={() => buttonMiscBackdoorBasic(ns)}>{"Backdoor"}</button> : ""
    const miscBackdoorSingBasic = hasBN(resetInfo, sourceFiles, 4, 2) ? <button style={greenStyle} onClick={() => buttonMiscBackdoorSing(ns)}>{"Backdoor Basic"}</button> : ""
    const miscBackdoorSingAll = hasBN(resetInfo, sourceFiles, 4, 2) ? <button style={greenStyle} onClick={() => buttonMiscBackdoorSing(ns, true)}>{"Backdoor All"}</button> : ""
    const gangSleeves = hasBN(resetInfo, sourceFiles, 10, 1) ? <button style={optionsDB["SleeveMode"] === "Gangs" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Gangs")}>{"Sleeves"}</button> : ""
    const bbSleeves = hasBN(resetInfo, sourceFiles, 10, 1) ? <button style={optionsDB["SleeveMode"] === "BB" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "BB")}>{"Sleeves"}</button> : ""
    const bbInfilOnly = hasBN(resetInfo, sourceFiles, 10, 1) ? <button style={optionsDB["BBInfilOnly"] ? greenStyle : redStyle} onClick={() => buttonBBInfilOnly(ns)}>{"Infil Only"}</button> : ""
    const keepAlive = bbPlatform !== "Steam" ? <button style={wnd.keepAlive ? greenStyle : redStyle} onClick={() => buttonMiscKeepAlive(ns)}>{"Keep Tab Alive"}</button> : ""
    const displayButtons = <span>
      <button style={optionsDB["DisplayToggleHelper"] ? greenStyle : redStyle} onClick={() => buttonDisplayToggleHelper(ns)}>{"Helper Text"}</button>
      <button style={optionsDB["DisplayToggleCollapse"] ? greenStyle : redStyle} onClick={() => buttonDisplayToggleCollapse(ns)}>{"Collapsible"}</button>
      <button style={greenStyle} onClick={() => buttonDisplayOpenLogs(ns)}>{"Open Logs"}</button>
      <button style={greenStyle} onClick={() => buttonDisplayClearActive(ns)}>{"Clear Active"}</button>
      <button style={greenStyle} onClick={() => buttonDisplayRefresh(ns)}>{"Refresh"}</button><br></br>
      <button style={greenStyle} onClick={() => buttonDisplayUpdate(ns)}>{"Update"}</button>
      <button style={greenStyle} onClick={() => buttonChangeLog(ns)}>{"Change Log"}</button>
      <button style={greenStyle} onClick={() => buttonDisplayRemove(ns)}>{"REMOVE PROGRAM"}</button>
    </span>;
    const mainBuffer = getBuffer(0)
    await ns.asleep(4)
    const hasCorp = await proxy(ns, "corporation.hasCorporation")
    const hasBB = await proxy(ns, "bladeburner.inBladeburner")
    const corp = hasCorp ? await proxy(ns, "corporation.getCorporation") : false
    const player = await proxy(ns, "getPlayer")
    const batcherHelp = hasBN(resetInfo, sourceFiles, 13) ? "Get Money and/or XP  Charge Stanek between cycles  Pop out the log" : "Get Money and/or XP  Pop out the log"
    let corpBribeName = "Bribe Unavailable"
    if (corp && corp.valuation >= 100000000000000 && player.factions.length > 0) corpBribeName = "Bribe"
    //All the commands
    const rows = [
      ["Batcher", 1, 1, <span>
        <button style={ns.peek(2) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonBatcherStart(ns)}>{ns.peek(2) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>
        <button style={optionsDB["BatcherAutoBuyServers"] ? greenStyle : redStyle} onClick={() => buttonBatcherAutoBuyServers(ns)}>{"Auto-Buy Servers"}</button>
        {batcherUseHacknet}
        {batcherAutoHash} {optionsDB["DisplayToggleHelper"] && "Activate/Deactivate the batcher and it's helpers"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={optionsDB["BatcherMoney"] ? greenStyle : redStyle} onClick={() => buttonBatcherToggleMoney(ns)}>{"Money Mode"}</button>
        <button style={optionsDB["BatcherXP"] ? greenStyle : redStyle} onClick={() => buttonBatcherToggleXP(ns)}>{"XP Mode"}</button>
        {batcherChargeStanek}
        <button style={optionsDB["BatcherPad"] ? greenStyle : redStyle} onClick={() => buttonBatcherPad(ns)}>{"Pad Grows"}</button>
        <button style={optionsDB["BatcherLog"] ? greenStyle : redStyle} onClick={() => buttonBatcherLog(ns)}>{"LogErrors"}</button>
        <button style={optionsDB["BatcherPopout"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "Batcher")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && batcherHelp}</span>],
      ["Hacknet", 1, 1, <span>
        <button style={greenStyle} onClick={() => buttonHacknetBuyHacknet(ns)}>{"Buy Hacknet"}</button>
        {batcherAutoBuyHacknet} {optionsDB["DisplayToggleHelper"] && "Buy Hacknet or allow batcher to auto buy if unlocked"}</span>],
      ["Hashing", 9, 1, <span>
        <button style={greenStyle} onClick={() => buttonHashing(ns, "money")}>{"Money"}</button>
        <button style={ns.peek(3) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonHashing(ns, "min")}>{"Reduce Min Sec"}</button>
        <button style={ns.peek(3) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonHashing(ns, "max")}>{"Boost Max Money"}</button>
        <button style={greenStyle} onClick={() => buttonHashing(ns, "coding")}>{"Generate Contract"}</button> {optionsDB["DisplayToggleHelper"] && "Sec and Money require a batcher target"} <br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={hasCorp ? greenStyle : redStyle} onClick={() => buttonHashing(ns, "corp")}>{"Corp Money"}</button>
        <button style={hasCorp ? greenStyle : redStyle} onClick={() => buttonHashing(ns, "research")}>{"Corp Research"}</button>
        <button style={hasBB ? greenStyle : redStyle} onClick={() => buttonHashing(ns, "bbrank")}>{"Boost BB Rank"}</button>
        <button style={hasBB ? greenStyle : redStyle} onClick={() => buttonHashing(ns, "bbsp")}>{"Boost BB SP"}</button> {optionsDB["DisplayToggleHelper"] && "Targets corp and BB"} <br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={greenStyle} onClick={() => buttonHashing(ns, study)}>{"Boost Study"}</button>
        <button style={greenStyle} onClick={() => buttonHashing(ns, "train")}>{"Boost Train"}</button>
        <button style={greenStyle} onClick={() => buttonHashing(ns, "favor")}>{"Boost Job Favor"}</button> {optionsDB["DisplayToggleHelper"] && "Targets training, study and jobs"}</span>],
      ["Stocks", 1, 1, <span>
        <button style={ns.peek(4) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonStocksStart(ns)}>{ns.peek(4) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>
        <button style={ns.peek(4) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonStocksBuy(ns)}>{"Buy"}</button>
        <button style={ns.peek(4) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonStocksSell(ns)}>{"Sell"}</button>
        <button style={optionsDB["StocksToggleAutoBuy"] ? greenStyle : redStyle} onClick={() => buttonStocksToggleAutoBuy(ns)}>{"Toggle AutoBuy"}</button>
        <button style={greenStyle} onClick={() => buttonStocksReset(ns)}>{"Reset Stats"}</button>
        <button style={optionsDB["StocksPopOut"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "Stocks")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && "Activate, buy and sell stocks. Set it to auto buy. Pop out the log."}</span>],
      ["Misc", 1, 1, <span>
        {miscBackdoorBasic}
        {miscBackdoorSingBasic}
        {miscBackdoorSingAll}
        <button style={greenStyle} onClick={() => buttonMiscTeleport(ns)}>{"Teleport"}</button> {optionsDB["DisplayToggleHelper"] && "Backdoor servers, or move to a server"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={greenStyle} onClick={() => buttonMiscSolveContracts(ns)}>{"Solve Contracts"}</button>
        <button style={optionsDB["ShareMode"] ? greenStyle : redStyle} onClick={() => buttonMiscShareRam(ns)}>{optionsDB["ShareMode"] ? "Unshare Ram" : "Share Ram"}</button>
        {keepAlive} {optionsDB["DisplayToggleHelper"] && "Contracts solve, Share all ram and keep tab alive"}</span>],
      ["Singularity", 4, 2, <span>
        <button style={greenStyle} onClick={() => buttonSingDumpMoney(ns)}>{"Dump Money"}</button> {optionsDB["DisplayToggleHelper"] && "Spend all your money on augments and home upgrades"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={ns.peek(21) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonAutoPilot(ns)}>{"AutoPilot V1"}</button>
        <button style={optionsDB["AutoPilotMoveOn"] ? greenStyle : redStyle} onClick={() => buttonAutoPilotMoveOn(ns)}>{"Start On Next"}</button>
        <button style={optionsDB["AutoPilotPopOut"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "AutoPilot")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && "Takes full control of the game and runs you through the node   Start scripts on the next node  Pop out the log window"}</span>],
      ["IPvGo", 1, 1, <span>
        <button style={ns.peek(5) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonIPvGoStart(ns)}>{ns.peek(5) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>
        <button style={optionsDB["IPvGoPlayAsWhite"] ? greenStyle : redStyle} onClick={() => buttonIPvGoPlayWhite(ns)}>{"Play White"}</button>
        <button style={optionsDB["IPvGoRepeat"] ? greenStyle : redStyle} onClick={() => buttonIPvGoRepeat(ns)}>{"Repeat"}</button>
        <button style={optionsDB["IPvGoCheats"] ? greenStyle : redStyle} onClick={() => buttonIPvGoCheats(ns)}>{"Cheats"}</button>
        <button style={optionsDB["IPvGoLogging"] ? greenStyle : redStyle} onClick={() => buttonIPvGoLogging(ns)}>{"Logging"}</button> {optionsDB["DisplayToggleHelper"] && "Start and toggle IPvGo settings"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={optionsDB["IPvGoNetburners"] ? greenStyle : redStyle} onClick={() => buttonIPvGoNetburners(ns)}>{"Netburners"}</button>
        <button style={optionsDB["IPvGoSlumSnakes"] ? greenStyle : redStyle} onClick={() => buttonIPvGoSlumSnakes(ns)}>{"Slum Snakes"}</button>
        <button style={optionsDB["IPvGoTheBlackHand"] ? greenStyle : redStyle} onClick={() => buttonIPvGoTheBlackHand(ns)}>{"The Black Hand"}</button>
        <button style={optionsDB["IPvGoTetrads"] ? greenStyle : redStyle} onClick={() => buttonIPvGoTetrads(ns)}>{"Tetrads"}</button> {optionsDB["DisplayToggleHelper"] && "Toggleable opponents"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={optionsDB["IPvGoDaedalus"] ? greenStyle : redStyle} onClick={() => buttonIPvGoDaedalus(ns)}>{"Daedalus"}</button>
        <button style={optionsDB["IPvGoIlluminati"] ? greenStyle : redStyle} onClick={() => buttonIPvGoIlluminati(ns)}>{"Illuminati"}</button>
        <button style={optionsDB["IPvGoUnknown"] ? greenStyle : redStyle} onClick={() => buttonIPvGoUnknown(ns)}>{"????????"}</button>
        <button style={optionsDB["IPvGoNoAI"] ? greenStyle : redStyle} onClick={() => buttonIPvGoNoAI(ns)}>{"No AI"}</button>
        <button style={optionsDB["IPvGoSlowMode"] ? greenStyle : redStyle} onClick={() => buttonIPvGoSlowMode(ns)}>{"SlowMode"}</button>
        <button style={optionsDB["IPvGoPopOut"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "IPvGo")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && "Toggleable opponents. ??? is after fl1ght. No AI will only play on practice board.  Create a delay before making moves.  Popout the log file."}</span>],
      ["Gangs", 2, 1, <span>
        <button style={ns.peek(6) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonGangStart(ns)}>{ns.peek(6) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>
        <button style={optionsDB["GangAutoAscend"] ? greenStyle : redStyle} onClick={() => buttonGangAutoAscend(ns)}>{"Auto-Ascend"}</button>
        <button style={optionsDB["GangAutoEQ"] ? greenStyle : redStyle} onClick={() => buttonGangAutoEQ(ns)}>{"Auto-EQ"}</button>
        {gangSleeves} {optionsDB["DisplayToggleHelper"] && "Start and toggle Automatic Gang settings"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={optionsDB["GangMode"] === "AutoMode" ? greenStyle : redStyle} onClick={() => buttonGangMode(ns, "AutoMode")}>{"AutoMode"}</button>
        <button style={optionsDB["GangMode"] === "Respect" ? greenStyle : redStyle} onClick={() => buttonGangMode(ns, "Respect")}>{"Respect"}</button>
        <button style={optionsDB["GangMode"] === "Money" ? greenStyle : redStyle} onClick={() => buttonGangMode(ns, "Money")}>{"Money"}</button>{optionsDB["DisplayToggleHelper"] && "Set gang to earn Respect, make money or auto"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={greenStyle} onClick={() => buttonGangBuyEQ(ns)}>{"Buy EQ All"}</button>
        <button style={greenStyle} onClick={() => buttonGangAscend(ns)}>{"Ascend All"}</button>
        <button style={optionsDB["GangPopOut"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "Gang")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && "Buy gear for / or ascend everyone"}</span>],
      ["Corps", 3, 3, <span>
        <button style={ns.peek(9) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonCorpStart(ns)}>{ns.peek(9) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>
        <button style={greenStyle} onClick={() => buttonCorpResetTAII(ns)}>{"Reset TAII"}</button>
        <button style={corpBribeName === "Bribe" ? greenStyle : redStyle} onClick={() => buttonCorpBribe(ns,)}>{corpBribeName}</button> {optionsDB["DisplayToggleHelper"] && "Activate Corps, Reset TAII DB, Bribe factions"}</span>],
      ["BladeBurner", 6, 1, <span>
        <button style={ns.peek(8) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonBBStart(ns)}>{ns.peek(8) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>
        <button style={optionsDB["BBFinisher"] ? greenStyle : redStyle} onClick={() => buttonBBFinisher(ns)}>{"Finisher"}</button>
        <button style={optionsDB["BBIntMode"] ? greenStyle : redStyle} onClick={() => buttonBBIntMode(ns)}>{"Int Mode"}</button>
        {bbSleeves}
        {bbInfilOnly}
        <button style={optionsDB["BBPopOut"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "BB")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && "Start BB and sets modes. Finisher will end BN and start a new one, int trains int,  PopOut the log"}</span>],
      ["Stanek", 13, 1, <span>
        <button style={ns.peek(11) !== "NULL PORT DATA" ? redStyle : greenStyle} onClick={() => buttonStanekStart(ns)}>{ns.peek(11) === "NULL PORT DATA" ? "Charge" : "Pls Wait"}</button>
        <button style={greenStyle} onClick={() => buttonStanekSaveConfig(ns)}>{"Save Config"}</button>
        <button style={greenStyle} onClick={() => buttonStanekLoadConfig(ns)}>{"Load Config"}</button>
        <button style={optionsDB["StanekDefault"] ? greenStyle : redStyle} onClick={() => buttonStanekUseDefault(ns)}>{"Defaults"}</button> {optionsDB["DisplayToggleHelper"] && "Save/Load your config. Allow defaults to show when loading"}</span>],
      ["Sleeves", 10, 1, <span>
        <button style={ns.peek(7) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonSleeveStart(ns)}>{ns.peek(7) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>
        <button style={optionsDB["SleeveMode"] === "Recovery" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Recovery")}>{"Recovery"}</button>
        <button style={optionsDB["SleeveMode"] === "Sync" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Sync")}>{"Sync"}</button>
        <button style={optionsDB["SleeveMode"] === "Training" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Training")}>{"Train"}</button>
        <button style={optionsDB["SleeveInstall"] ? greenStyle : redStyle} onClick={() => buttonSleevesInstallAugments(ns)}>{"Install Augments"}</button>{optionsDB["DisplayToggleHelper"] && "Start sleeve manager and toggle modes.  Install augments for all sleeves"}<br></br>
        {!optionsDB["DisplayToggleCollapse"] && mainBuffer}<button style={optionsDB["SleeveMode"] === "Money" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Money")}>{"Money"}</button>
        <button style={optionsDB["SleeveMode"] === "Karma" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Karma")}>{"Karma"}</button>
        <button style={optionsDB["SleeveMode"] === "Idle" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Idle")}>{"Idle"}</button>
        <button style={optionsDB["SleeveMode"] === "Int" ? greenStyle : redStyle} onClick={() => buttonSleevesToggle(ns, "Int")}>{"Int"}</button>
        <button style={optionsDB["SleevePopOut"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "Sleeve")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && "Toggle more sleeve training options"}</span>],
      ["Grafting", 10, 1, <span>
        <button style={greenStyle} onClick={() => buttonGrafting(ns)}>{"Grafting"}</button>
        <button style={optionsDB["GraftingPopOut"] ? greenStyle : redStyle} onClick={() => buttonPopout(ns, "Grafting")}>{"Pop Out"}</button> {optionsDB["DisplayToggleHelper"] && "Start the Auto Grafter"}</span>],
      ["Cheats", 1, 1, <span>
        {optionsDB["DisplayToggleCollapse"] && "Dev/Unlocks" + getBuffer(11)}<button style={greenStyle} onClick={() => buttonDevMenu(ns)}>{"Dev Menu"}</button>
        <button style={greenStyle} onClick={() => buttonUnlockAll(ns)}>{"Unlock All Achievements"}</button>{optionsDB["DisplayToggleHelper"] && "Open the Dev Menu or give yourself all achievements"}<br></br>
        {"Casino" + getBuffer(6)}<button style={ns.peek(10) !== "NULL PORT DATA" ? greenStyle : redStyle} onClick={() => buttonCasinoStart(ns)}>{ns.peek(10) === "NULL PORT DATA" ? "Activate" : "De-Activate"}</button>{optionsDB["DisplayToggleHelper"] && "Move to Aevum, start script, it will end. Move into Casino, restart script while in casino"}<br></br>
        {"AutoInfil" + getBuffer(9)}<button style={wnd.tmrAutoInf ? greenStyle : redStyle} onClick={() => buttonAutoInfilStart(ns)}>{!wnd.tmrAutoInf ? "Activate" : "De-Activate"}</button>
        <button style={optionsDB["AutoInfilAuto"] ? greenStyle : redStyle} onClick={() => buttonAutoInfilAuto(ns)}>{"Auto"}</button>
        <button style={optionsDB["AutoInfilMoneyMode"] ? greenStyle : redStyle} onClick={() => buttonAutoInfilMoney(ns)}>{"Money"}</button>
        <button style={optionsDB["AutoInfilFactionMode"] ? greenStyle : redStyle} onClick={() => buttonAutoInfilFaction(ns)}>{"Faction"}</button>{optionsDB["AutoInfilFaction"]} {optionsDB["DisplayToggleHelper"] && "Start Auto Infil, switch between modes.  Enter a companies Infiltrate screen to start"}</span>],
    ]
    ns.printRaw(<h4>{"SphyxOS " + version}<br></br>{"Game: " + bbVersionName + " (v" + bbVersionNum + " - " + bbVersionCommit + ")"}<br></br>{bbPlatform}</h4>)
    ns.printRaw(displayButtons)
    for (const [sendTitle, bn, lvl, buttonsList] of rows) {
      if (hasBN(resetInfo, sourceFiles, bn, lvl)
        || (bn === 6 && hasBN(resetInfo, sourceFiles, 7, lvl)))
        ns.printRaw(<Row title={sendTitle.toString()} buttons={buttonsList}></Row>)
    }
    await ns.nextPortWrite(1)
  }
}
function processCommands(ns) {
  while (ns.peek(1) !== "NULL PORT DATA") {
    const result = ns.readPort(1)
    if (result !== 1 && result !== true) { // 1 and true are used to just cycle the display, anythign else is state communication
      //ns.tprintf(result)
      switch (result) {
        case "puppet money on":
          optionsDB["BatcherMoney"] = true
          break
        case "puppet money off":
          optionsDB["BatcherMoney"] = false
          break
        case "puppet xp on":
          optionsDB["BatcherXP"] = true
          break
        case "puppet xp off":
          optionsDB["BatcherXP"] = false
          break
        case "puppet autobuyservers on":
          optionsDB["BatcherAutoBuyServers"] = true
          break
        case "puppet autobuyservers off":
          optionsDB["BatcherAutoBuyServers"] = false
          break
        case "puppet autohash on":
          optionsDB["BatcherAutoHash"] = true
          break
        case "puppet autohash off":
          optionsDB["BatcherAutoHash"] = false
          break
        case "puppet stanek on":
          optionsDB["BatcherStanek"] = true
          break
        case "puppet stanek off":
          optionsDB["BatcherStanek"] = false
          break
        case "puppet hacknet on":
          optionsDB["BatcherUseHacknet"] = true
          break
        case "puppet hacknet off":
          optionsDB["BatcherUseHacknet"] = false
          break
        case "puppet autobuyhacknet on":
          optionsDB["BatcherAutoBuyHacknet"] = true
          break
        case "puppet autobuyhacknet off":
          optionsDB["BatcherAutoBuyHacknet"] = false
          break
        case "puppet popout off":
          optionsDB["BatcherPopout"] = false
          break
        case "puppet log on":
          optionsDB["BatcherLog"] = true
          break
        case "puppet log off":
          optionsDB["BatcherLog"] = false
          break
        case "puppet pad on":
          optionsDB["BatcherPad"] = true
          break
        case "puppet pad off":
          optionsDB["BatcherPad"] = false
          break
        case "ipvgo repeat on":
          optionsDB["IPvGoRepeat"] = true
          break
        case "ipvgo repeat off":
          optionsDB["IPvGoRepeat"] = false
          break
        case "ipvgo playaswhite off":
          optionsDB["IPvGoPlayAsWhite"] = false
          break
        case "ipvgo playaswhite on":
          optionsDB["IPvGoPlayAsWhite"] = true
          break
        case "ipvgo cheats on":
          optionsDB["IPvGoCheats"] = true
          break
        case "ipvgo cheats off":
          optionsDB["IPvGoCheats"] = false
          break
        case "ipvgo logging on":
          optionsDB["IPvGoLogging"] = true
          break
        case "ipvgo logging off":
          optionsDB["IPvGoLogging"] = false
          break
        case "ipvgo net on":
          optionsDB["IPvGoNetburners"] = true
          break
        case "ipvgo net off":
          optionsDB["IPvGoNetburners"] = false
          break
        case "ipvgo slum on":
          optionsDB["IPvGoSlumSnakes"] = true
          break
        case "ipvgo slum off":
          optionsDB["IPvGoSlumSnakes"] = false
          break
        case "ipvgo bh on":
          optionsDB["IPvGoTheBlackHand"] = true
          break
        case "ipvgo bh off":
          optionsDB["IPvGoTheBlackHand"] = false
          break
        case "ipvgo tetrad on":
          optionsDB["IPvGoTetrads"] = true
          break
        case "ipvgo tetrad off":
          optionsDB["IPvGoTetrads"] = false
          break
        case "ipvgo daed on":
          optionsDB["IPvGoDaedalus"] = true
          break
        case "ipvgo daed off":
          optionsDB["IPvGoDaedalus"] = false
          break
        case "ipvgo illum on":
          optionsDB["IPvGoIlluminati"] = true
          break
        case "ipvgo illum off":
          optionsDB["IPvGoIlluminati"] = false
          break
        case "ipvgo ???? on":
          optionsDB["IPvGoUnknown"] = true
          break
        case "ipvgo ???? off":
          optionsDB["IPvGoUnknown"] = false
          break
        case "ipvgo noai on":
          optionsDB["IPvGoNoAI"] = true
          break
        case "ipvgo noai off":
          optionsDB["IPvGoNoAI"] = false
          break
        case "ipvgo slowmode on":
          optionsDB["IPvGoSlowMode"] = true
          break
        case "ipvgo slowmode off":
          optionsDB["IPvGoSlowMode"] = false
          break
        case "ipvgo popout off":
          optionsDB["IPvGoPopOut"] = false
          break
        case "gang autoascend on":
          optionsDB["GangAutoAscend"] = true
          break
        case "gang autoascend off":
          optionsDB["GangAutoAscend"] = false
          break
        case "gang autoeq on":
          optionsDB["GangAutoEQ"] = true
          break
        case "gang autoeq off":
          optionsDB["GangAutoEQ"] = false
          break
        case "gang mode automode":
          optionsDB["GangMode"] = "AutoMode"
          break
        case "gang mode respect":
          optionsDB["GangMode"] = "Respect"
          break
        case "gang mode money":
          optionsDB["GangMode"] = "Money"
          break
        case "gang popout off":
          optionsDB["GangPopOut"] = false
          break
        case "sleeves idle":
          optionsDB["SleeveMode"] = "Idle"
          break
        case "sleeves popout off":
          optionsDB["SleevePopOut"] = false
          break
        case "stocks popout off":
          optionsDB["StocksPopOut"] = false
          break
        case "stocks autobuy off":
          optionsDB["StocksToggleAutoBuy"] = false
          break
        case "stocks autobuy on":
          optionsDB["StocksToggleAutoBuy"] = true
          break
        case "autopilot popout off":
          optionsDB["AutoPilotPopOut"] = false
          break
        case "bb finisher off":
          optionsDB["BBFinisher"] = false
          break
        case "bb int mode off":
          optionsDB["BBIntMode"] = false
          break
        case "bb sleeves on":
          optionsDB["SleeveMode"] === "BB"
          break
        case "bb sleeves off":
          optionsDB["SleeveMode"] === "Idle"
          break
        case "bb sleeve infil off":
          optionsDB["BBInfilOnly"] = false
          break
        case "bb popout off":
          optionsDB["BBPopOut"] = false
          break
        case "grafting popout off":
          optionsDB["GraftingPopOut"] = false
          break
        default:
          ns.tprintf("Invalid response received in autopilot: %s", result)
          break
      }
    }
  }
}
function getBuffer(startValue, endValue = 12) {
  let buffer = ""
  for (let i = startValue; i < endValue; i++)
    buffer += " "
  buffer += ":"
  return buffer
}
function buttonDisplayToggleHelper(ns) {
  optionsDB["DisplayToggleHelper"] = !optionsDB["DisplayToggleHelper"]
  ns.writePort(1, true)
}
function buttonDisplayToggleCollapse(ns) {
  optionsDB["DisplayToggleCollapse"] = !optionsDB["DisplayToggleCollapse"]
  ns.writePort(1, true)
}
function buttonDisplayRefresh(ns) {
  ns.writePort(1, true)
}
function buttonDisplayOpenLogs(ns) {
  if (ns.peek(2) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(2)) // Puppet
  if (ns.peek(4) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(4)) // Stocks
  if (ns.peek(5) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(5)) // IPvGo
  if (ns.peek(6) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(6)) // Gangs
  if (ns.peek(7) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(7)) // Sleeves
  if (ns.peek(8) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(8)) // BB
  if (ns.peek(9) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(9)) // Corps
  if (ns.peek(10) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(10)) // Casino
  if (ns.peek(20) !== "NULL PORT DATA") ns.ui.openTail(ns.peek(20)) // Casino
  ns.writePort(1, true)
}
async function buttonDisplayClearActive(ns) {
  if (ns.peek(2) !== "NULL PORT DATA" && ns.peek(2) > 0) await proxy(ns, "kill", ns.peek(2))// Puppet
  if (ns.peek(4) !== "NULL PORT DATA" && ns.peek(4) > 0) await proxy(ns, "kill", ns.peek(4))// Stocks
  if (ns.peek(5) !== "NULL PORT DATA" && ns.peek(5) > 0) await proxy(ns, "kill", ns.peek(5))// IPvGo
  if (ns.peek(6) !== "NULL PORT DATA" && ns.peek(6) > 0) await proxy(ns, "kill", ns.peek(6))// Gangs
  if (ns.peek(7) !== "NULL PORT DATA" && ns.peek(7) > 0) await proxy(ns, "kill", ns.peek(7))// Sleeves
  if (ns.peek(8) !== "NULL PORT DATA" && ns.peek(8) > 0) await proxy(ns, "kill", ns.peek(8))// BB
  if (ns.peek(9) !== "NULL PORT DATA" && ns.peek(9) > 0) await proxy(ns, "kill", ns.peek(9))// Corps
  if (ns.peek(10) !== "NULL PORT DATA" && ns.peek(10) > 0) await proxy(ns, "kill", ns.peek(10))// Casino
  if (ns.peek(20) !== "NULL PORT DATA" && ns.peek(20) > 0) await proxy(ns, "kill", ns.peek(20))// Casino
  if (ns.peek(30) !== "NULL PORT DATA" && ns.peek(30) > 0) await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, [])
  if (optionsDB["ShareMode"]) {
    optionsDB["ShareMode"] = false
    await runIt(ns, "SphyxOS/bins/startShare.js", false, ["stop"])
  }
  ns.clearPort(2)// Puppet
  ns.clearPort(4)// Stocks
  ns.clearPort(5)// IPvGo
  ns.clearPort(6)// Gangs
  ns.clearPort(7)// Sleeves
  ns.clearPort(8)// BB
  ns.clearPort(9)// Corps
  ns.clearPort(10)// Casino
  ns.clearPort(11)//Stanek
  ns.clearPort(20)//Stanek
  ns.clearPort(30)//AutoInfil
  ns.writePort(1, 1)
}
/** @param {NS} ns */
async function buttonDisplayUpdate(ns) {
  const updatePid = ns.exec("SphyxOS/extras/update.js", "home")// false, []) //Update everything
  while (ns.isRunning(updatePid)) await ns.asleep(4)
  ns.exec("Loader.js", "home")
  ns.ui.closeTail()
  ns.exit()
}
function buttonChangeLog(ns) {
  const updatePid = ns.exec("SphyxOS/bins/changeLog.js", "home")
  if (updatePid === 0) ns.tprintf("Error:  Not enough RAM to open change log.")
}
async function buttonDisplayRemove(ns) {
  const result = await ns.prompt("Are you sure?", { type: "boolean" })
  if (result === true) {
    const localStorage = !!await ns.prompt("Local Storage(Stanek loadouts, etc) too?", { type: "boolean" })
    ns.tprintf("Deleting SphyxOS.")
    await buttonDisplayClearActive(ns)
    await ns.asleep(4)
    writeRemoval(ns)
    await ns.asleep(4)
    const servers = await getServersLight(ns)
    const scriptRam = 2.8
    ns.tprintf("RAM: %s", scriptRam)
    for (const server of servers) {
      if (server === "home") continue
      const ram = await getServerAvailRam(ns, server)
      if (ram < scriptRam) continue
      await proxy(ns, "scp", "SphyxOSRemoval.js", server)
      await ns.asleep(4)
      ns.exec("SphyxOSRemoval.js", server, 1, localStorage)
      await proxy(ns, "rm", "SphyxOSRemoval.js")
      ns.tprintf("Server: %s", server)
      ns.exit()
    }
    ns.toast("Not enough free RAM to run the removal script.", "error", 3000)
  }
}
/** @param {NS} ns */
function writeRemoval(ns) {
  const data = `
export async function main(ns) {
  const localRemoval = ns.args[0]
  ns.rm("SphyxOS.txt", "home")
  const files = ns.ls("home", "SphyxOS/")
  if (localRemoval) files.push(...ns.ls("home", "SphyxOSUserData/"))
  files.push("Loader.js")
  for (const file of files)
    ns.rm(file, "home")
}`
  ns.write("SphyxOSRemoval.js", data, "w")
}
async function buttonPopout(ns, program) {
  switch (program) {
    case "Batcher":
      optionsDB["BatcherPopout"] = !optionsDB["BatcherPopout"]
      if (ns.peek(2) !== "NULL PORT DATA")
        optionsDB["BatcherPopout"] === true ? ns.writePort(12, "popout") : ns.writePort(12, "nopopout")
      break
    case "AutoPilot":
      optionsDB["AutoPilotPopOut"] = !optionsDB["AutoPilotPopOut"]
      if (ns.peek(21) !== "NULL PORT DATA")
        ns.writePort(22, optionsDB["AutoPilotPopOut"] ? "popout" : "nopopout")
      break
    case "Stocks":
      optionsDB["StocksPopOut"] = !optionsDB["StocksPopOut"]
      if (ns.peek(4) !== "NULL PORT DATA")
        ns.writePort(13, optionsDB["StocksPopOut"] ? "popout" : "nopopout")
      break
    case "IPvGo":
      optionsDB["IPvGoPopOut"] = !optionsDB["IPvGoPopOut"]
      if (ns.peek(5) !== "NULL PORT DATA")
        ns.writePort(15, optionsDB["IPvGoPopOut"] ? "popout" : "nopopout")
      break
    case "BB":
      optionsDB["BBPopOut"] = !optionsDB["BBPopOut"]
      if (ns.peek(8) !== "NULL PORT DATA")
        ns.writePort(18, optionsDB["BBPopOut"] ? "popout" : "nopopout")
      break
    case "Gang":
      optionsDB["GangPopOut"] = !optionsDB["GangPopOut"]
      if (ns.peek(6) !== "NULL PORT DATA")
        ns.writePort(16, optionsDB["GangPopOut"] ? "popout" : "nopopout")
      break
    case "Grafting":
      optionsDB["GraftingPopOut"] = !optionsDB["GraftingPopOut"]
      if (ns.peek(20) !== "NULL PORT DATA")
        ns.writePort(23, optionsDB["GraftingPopOut"] ? "popout" : "nopopout")
      break
    case "Sleeve":
      optionsDB["SleevePopOut"] = !optionsDB["SleevePopOut"]
      if (ns.peek(7) !== "NULL PORT DATA")
        ns.writePort(17, optionsDB["SleevePopOut"] ? "popout" : "nopopout")
      break
    default:
      ns.tprintf("Invalid program for popout: " + program)
      break
  }
  ns.writePort(1, 1)
}
async function buttonBatcherStart(ns) {
  if (ns.peek(2) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(2))
  }
  else {
    const commands = []
    if (optionsDB["BatcherUseHacknet"]) commands.push("usehacknet")
    if (optionsDB["BatcherAutoHash"]) commands.push("autohash")
    if (!optionsDB["BatcherAutoBuyServers"]) commands.push("nopurchase")
    if (optionsDB["BatcherAutoBuyHacknet"]) commands.push("autobuyhacknet")
    if (!optionsDB["BatcherMoney"]) commands.push("nomoney")
    if (!optionsDB["BatcherXP"]) commands.push("noxp")
    if (optionsDB["BatcherStanek"]) commands.push("stanek")
    ns.writePort(12, "silent")
    optionsDB["BatcherPopout"] === true ? ns.writePort(12, "popout") : ns.writePort(12, "nopopout")
    optionsDB["BatcherLog"] === true ? ns.writePort(12, "log") : ns.writePort(12, "nolog")
    optionsDB["BatcherPad"] === true ? ns.writePort(12, "pad") : ns.writePort(12, "nopad")
    await runIt(ns, "SphyxOS/bins/puppetMini.js", true, commands)
  }
  ns.writePort(1, true)
}
function buttonBatcherAutoBuyServers(ns) {
  optionsDB["BatcherAutoBuyServers"] = !optionsDB["BatcherAutoBuyServers"]
  if (optionsDB["BatcherAutoBuyServers"] && ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "purchaseservers")
  }
  else if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "nopurchaseservers")
  }
  ns.writePort(1, true)
}
function buttonBatcherUseHacknet(ns) {
  optionsDB["BatcherUseHacknet"] = !optionsDB["BatcherUseHacknet"]
  if (optionsDB["BatcherUseHacknet"] && ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "hacknet")
  }
  else if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "nohacknet")
  }
  ns.writePort(1, true)
}
function buttonBatcherAutoHash(ns) {
  optionsDB["BatcherAutoHash"] = !optionsDB["BatcherAutoHash"]
  if (optionsDB["BatcherAutoHash"] && ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "autohash")
  }
  else if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "noautohash")
  }
  ns.writePort(1, true)
}
function buttonBatcherAutoBuyHacknet(ns) {
  optionsDB["BatcherAutoBuyHacknet"] = !optionsDB["BatcherAutoBuyHacknet"]
  if (optionsDB["BatcherAutoBuyHacknet"] && ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "autobuyhacknet")
  }
  else if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, "noautobuyhacknet")
  }
  ns.writePort(1, true)
}
function buttonBatcherToggleMoney(ns) {
  optionsDB["BatcherMoney"] = !optionsDB["BatcherMoney"]
  if (!optionsDB["BatcherMoney"] && !optionsDB["BatcherXP"])
    optionsDB["BatcherMoney"] = true
  if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, optionsDB["BatcherMoney"] ? "money" : "nomoney")
  }
  ns.writePort(1, true)
}
function buttonBatcherToggleXP(ns) {
  optionsDB["BatcherXP"] = !optionsDB["BatcherXP"]
  if (!optionsDB["BatcherMoney"] && !optionsDB["BatcherXP"])
    optionsDB["BatcherMoney"] = true
  if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, optionsDB["BatcherXP"] ? "xp" : "noxp")
  }
  ns.writePort(1, true)
}
async function buttonBatcherToggleStanek(ns) {
  const frags = await proxy(ns, "stanek.activeFragments")
  if (frags.length === 0) {
    ns.toast("Please select a loadout first", "error", 3000)
    optionsDB["BatcherStanek"] = false
    return
  }
  optionsDB["BatcherStanek"] = !optionsDB["BatcherStanek"]
  if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, optionsDB["BatcherStanek"] ? "stanek" : "nostanek")
  }
  ns.writePort(1, true)
}
async function buttonBatcherLog(ns) {
  optionsDB["BatcherLog"] = !optionsDB["BatcherLog"]
  if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, optionsDB["BatcherLog"] ? "log" : "nolog")
  }
  ns.writePort(1, true)
}
async function buttonBatcherPad(ns) {
  optionsDB["BatcherPad"] = !optionsDB["BatcherPad"]
  if (ns.peek(2) !== "NULL PORT DATA") {
    ns.writePort(12, optionsDB["BatcherPad"] ? "pad" : "nopad")
  }
  ns.writePort(1, true)
}
async function buttonHacknetBuyHacknet(ns) {
  await runIt(ns, "SphyxOS/bins/hacknetPurchaser.js", false, [])
  ns.writePort(1, true)
}
async function buttonMiscBackdoorBasic(ns) {
  await runIt(ns, "SphyxOS/extras/crawl-Basic.js", true, [])
  ns.writePort(1, true)
}
async function buttonMiscBackdoorSing(ns, all = false) {
  if (all) await runIt(ns, "SphyxOS/bins/singularityBackdoor.js", true, ["all"])
  else await runIt(ns, "SphyxOS/bins/singularityBackdoor.js", true, [])
  ns.writePort(1, true)
}
async function buttonMiscTeleport(ns) {
  await runIt(ns, "SphyxOS/extras/teleport.js", false, [])
  ns.writePort(1, true)
}
async function buttonMiscSolveContracts(ns) {
  await runIt(ns, "SphyxOS/bins/codingContracts.js", false, [])
  ns.writePort(1, true)
}
async function buttonMiscShareRam(ns) {
  optionsDB["ShareMode"] = !optionsDB["ShareMode"]
  if (optionsDB["ShareMode"]) await runIt(ns, "SphyxOS/bins/startShare.js", false, [])
  else await runIt(ns, "SphyxOS/bins/startShare.js", false, ["stop"])
  ns.writePort(1, true)
}
async function buttonMiscKeepAlive(ns) {
  if (wnd.keepAlive) {
    wnd.keepAlive.close()
    delete wnd.keepAlive    
  }
  else {
    const ctx = new AudioContext({ latencyHint: "playback" })
    const osc = ctx.createOscillator()
    // 1Hz - far too low to be audible
    osc.frequency.setValueAtTime(1, ctx.currentTime)
    const ctxGain = ctx.createGain()
    // This is just above the threshold where playback is considered "silent".
    ctxGain.gain.setValueAtTime(0.001, ctx.currentTime)
    // Have to avoid picking up the RAM cost of singularity.connect
    osc["connect"](ctxGain)
    ctxGain["connect"](ctx.destination)
    osc.start()
    wnd.keepAlive = ctx    
  }
  ns.writePort(1, true)
}
async function buttonHashing(ns, mode) {
  const p = await runIt(ns, "SphyxOS/extras/hashIt.js", false, [mode])
  if (p > 0) await ns.nextPortWrite(p)
  ns.clearPort(p)
  ns.writePort(1, true)
}
async function buttonStocksStart(ns) {
  if (ns.peek(4) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(4))
  }
  else {
    const commands = []
    if (optionsDB["StocksToggleAutoBuy"]) commands.push("autobuy")
    ns.writePort(13, "silent")
    ns.writePort(13, optionsDB["StocksPopOut"] ? "popout" : "nopopout")
    await runIt(ns, "SphyxOS/bins/tStocks.js", true, commands)
  }
  ns.writePort(1, true)
}
function buttonStocksBuy(ns) {
  if (ns.peek(4) !== "NULL PORT DATA") ns.writePort(13, "buy")
  ns.writePort(1, true)
}
function buttonStocksSell(ns) {
  if (ns.peek(4) !== "NULL PORT DATA") ns.writePort(13, "sell")
  ns.writePort(1, true)
}
function buttonStocksToggleAutoBuy(ns) {
  optionsDB["StocksToggleAutoBuy"] = !optionsDB["StocksToggleAutoBuy"]
  if (optionsDB["StocksToggleAutoBuy"] && ns.peek(4) !== "NULL PORT DATA") {
    ns.writePort(13, "autobuy")
  }
  else if (ns.peek(4) !== "NULL PORT DATA") {
    ns.writePort(13, "autobuyoff")
  }
  ns.writePort(1, true)
}
function buttonStocksReset(ns) {
  if (ns.peek(4) !== "NULL PORT DATA") {
    ns.writePort(13, "reset")
  }
  ns.writePort(1, true)
}
async function buttonAutoPilot(ns) {
  if (ns.peek(21) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(21))
  }
  else {
    ns.writePort(22, "silent")
    ns.writePort(22, optionsDB["AutoPilotPopOut"] ? "popout" : "nopopout")
    ns.writePort(22, optionsDB["AutoPilotMoveOn"] ? "moveon" : "nomoveon")
    globalThis["document"].autopilot = optionsDB["AutoPilotMoveOn"]
    await runIt(ns, "SphyxOS/bins/autopilot.js", true, [])
  }
  ns.writePort(1, true)
}
async function buttonAutoPilotMoveOn(ns) {
  optionsDB["AutoPilotMoveOn"] = !optionsDB["AutoPilotMoveOn"]
  if (ns.peek(21) !== "NULL PORT DATA") {
    globalThis["document"].autopilot = optionsDB["AutoPilotMoveOn"]
    ns.writePort(22, optionsDB["AutoPilotMoveOn"] ? "moveon" : "nomoveon")
  }
  ns.writePort(1, true)
}
async function buttonIPvGoStart(ns) {
  if (ns.peek(5) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(5))
  }
  else {
    ns.writePort(15, "Silent")
    ns.writePort(15, optionsDB["IPvGoRepeat"] ? "Repeat On" : "Repeat Off")
    ns.writePort(15, optionsDB["IPvGoPlayAsWhite"] ? "Play as White On" : "Play as White Off")
    ns.writePort(15, optionsDB["IPvGoCheats"] ? "Cheats On" : "Cheats Off")
    ns.writePort(15, optionsDB["IPvGoLogging"] ? "Logging On" : "Logging Off")
    ns.writePort(15, optionsDB["IPvGoNetburners"] ? "Net On" : "Net Off")
    ns.writePort(15, optionsDB["IPvGoSlumSnakes"] ? "Slum On" : "Slum Off")
    ns.writePort(15, optionsDB["IPvGoTheBlackHand"] ? "BH On" : "BH Off")
    ns.writePort(15, optionsDB["IPvGoTetrads"] ? "Tetrad On" : "Tetrad Off")
    ns.writePort(15, optionsDB["IPvGoDaedalus"] ? "Daed On" : "Daed Off")
    ns.writePort(15, optionsDB["IPvGoIlluminati"] ? "Illum On" : "Illum Off")
    ns.writePort(15, optionsDB["IPvGoUnknown"] ? "???? On" : "???? Off")
    ns.writePort(15, optionsDB["IPvGoNoAI"] ? "No AI On" : "No AI Off")
    const port = await runIt(ns, "SphyxOS/bins/go.js", true, [])
    if (port > 0) ns.writePort(5, port)
  }
  ns.writePort(1, true)
}
function buttonIPvGoPlayWhite(ns) {
  optionsDB["IPvGoPlayAsWhite"] = !optionsDB["IPvGoPlayAsWhite"]
  if (!optionsDB["IPvGoPlayAsWhite"]) {
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "Play as White Off")
  }
  else {
    optionsDB["IPvGoNoAI"] = true
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "Play as White On")
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "No AI On")
  }
  ns.writePort(1, true)
}
function buttonIPvGoRepeat(ns) {
  optionsDB["IPvGoRepeat"] = !optionsDB["IPvGoRepeat"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoRepeat"] ? "Repeat On" : "Repeat Off")
  ns.writePort(1, true)
}
function buttonIPvGoCheats(ns) {
  optionsDB["IPvGoCheats"] = !optionsDB["IPvGoCheats"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoCheats"] ? "Cheats On" : "Cheats Off")
  ns.writePort(1, true)
}
function buttonIPvGoLogging(ns) {
  optionsDB["IPvGoLogging"] = !optionsDB["IPvGoLogging"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoLogging"] ? "Logging On" : "Logging Off")
  ns.writePort(1, true)
}
function buttonIPvGoNetburners(ns) {
  optionsDB["IPvGoNetburners"] = !optionsDB["IPvGoNetburners"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoNetburners"] ? "Net On" : "Net Off")
  ns.writePort(1, true)
}
function buttonIPvGoSlumSnakes(ns) {
  optionsDB["IPvGoSlumSnakes"] = !optionsDB["IPvGoSlumSnakes"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoSlumSnakes"] ? "Slum On" : "Slum Off")
  ns.writePort(1, true)
}
function buttonIPvGoTheBlackHand(ns) {
  optionsDB["IPvGoTheBlackHand"] = !optionsDB["IPvGoTheBlackHand"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoTheBlackHand"] ? "BH On" : "BH Off")
  ns.writePort(1, true)
}
function buttonIPvGoTetrads(ns) {
  optionsDB["IPvGoTetrads"] = !optionsDB["IPvGoTetrads"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoTetrads"] ? "Tetrad On" : "Tetrad Off")
  ns.writePort(1, true)
}
function buttonIPvGoDaedalus(ns) {
  optionsDB["IPvGoDaedalus"] = !optionsDB["IPvGoDaedalus"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoDaedalus"] ? "Daed On" : "Daed Off")
  ns.writePort(1, true)
}
function buttonIPvGoIlluminati(ns) {
  optionsDB["IPvGoIlluminati"] = !optionsDB["IPvGoIlluminati"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoIlluminati"] ? "Illum On" : "Illum Off")
  ns.writePort(1, true)
}
function buttonIPvGoUnknown(ns) {
  optionsDB["IPvGoUnknown"] = !optionsDB["IPvGoUnknown"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoUnknown"] ? "???? On" : "???? Off")
  ns.writePort(1, true)
}
function buttonIPvGoNoAI(ns) {
  optionsDB["IPvGoNoAI"] = !optionsDB["IPvGoNoAI"]
  if (!optionsDB["IPvGoNoAI"]) {
    optionsDB["IPvGoPlayAsWhite"] = false
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "Play as White Off")
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "No AI Off")
  }
  else {
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoPlayAsWhite"] ? "Play as White On" : "Play as White Off")
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "No AI On")
  }
  ns.writePort(1, true)
}
function buttonIPvGoSlowMode(ns) {
  optionsDB["IPvGoSlowMode"] = !optionsDB["IPvGoSlowMode"]
  if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoSlowMode"] ? "SlowMode On" : "SlowMode Off")
  ns.writePort(1, true)
}
async function buttonGangStart(ns) {
  if (ns.peek(6) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(6))
  }
  else {
    ns.writePort(16, "Silent")
    ns.writePort(16, optionsDB["GangAutoAscend"] ? "AutoAscend On" : "AutoAscend Off")
    ns.writePort(16, optionsDB["GangAutoEQ"] ? "AutoEQ On" : "AutoEQ Off")
    ns.writePort(16, optionsDB["GangMode"])
    ns.writePort(16, optionsDB["SleeveMode"] === "Gangs" ? "Sleeves On" : "Sleeves Off")
    const port = await runIt(ns, "SphyxOS/bins/gang.js", true, [])
    if (port) ns.writePort(6, port)
  }
  ns.writePort(1, true)
}
function buttonGangAutoAscend(ns) {
  optionsDB["GangAutoAscend"] = !optionsDB["GangAutoAscend"]
  ns.writePort(16, optionsDB["GangAutoAscend"] ? "AutoAscend On" : "AutoAscend Off")
  ns.writePort(1, true)
}
function buttonGangAutoEQ(ns) {
  optionsDB["GangAutoEQ"] = !optionsDB["GangAutoEQ"]
  ns.writePort(16, optionsDB["GangAutoEQ"] ? "AutoEQ On" : "AutoEQ Off")
  ns.writePort(1, true)
}
function buttonGangMode(ns, mode) {
  optionsDB["GangMode"] = mode
  if (ns.peek(6) !== "NULL PORT DATA")
    ns.writePort(16, optionsDB["GangMode"])
  ns.writePort(1, true)
}
function buttonGangBuyEQ(ns) {
  if (ns.peek(6) !== "NULL PORT DATA") ns.writePort(16, "Buy EQ")
  ns.writePort(1, true)
}
function buttonGangAscend(ns) {
  if (ns.peek(6) !== "NULL PORT DATA") ns.writePort(16, "Ascend")
  ns.writePort(1, true)
}
async function buttonCorpStart(ns) {
  if (ns.peek(9) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(9))
  }
  else {
    await runIt(ns, "SphyxOS/bins/corp.js", true, [])
  }
  ns.writePort(1, true)
}
function buttonCorpResetTAII(ns) {
  if (ns.peek(9) !== "NULL PORT DATA") ns.writePort(19, "Reset TAII")
  ns.writePort(1, true)
}
async function buttonCorpBribe(ns) {
  const player = await proxy(ns, "getPlayer")
  if (player.factions.length === 0) return
  const corp = await proxyTry(ns, "corporation.getCorporation")
  if (corp && corp.valuation >= 100000000000000) {
    const faction = await ns.prompt("Choose a faction to bribe:", { type: "select", choices: player.factions })
    if (faction === "") return
    await proxyTry(ns, "corporation.bribe", faction, corp.funds / 100)
    ns.tprintf("Corp: Attempted to bribe: %s", faction)
  }
  ns.writePort(1, true)
}
async function buttonSingDumpMoney(ns) {
  await runIt(ns, "SphyxOS/bins/dumpMoney.js", false, [])
  ns.writePort(1, true)
}
async function buttonSleeveStart(ns) {
  if (ns.peek(7) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(7))
  }
  else {
    ns.writePort(17, "Silent")
    ns.writePort(17, optionsDB["SleeveMode"])
    ns.writePort(17, optionsDB["SleeveInstall"] ? "Install On" : "Install Off")
    await runIt(ns, "SphyxOS/bins/tSleeves.js", true, [])
  }
  ns.writePort(1, true)
}
function buttonSleevesInstallAugments(ns) {
  optionsDB["SleeveInstall"] = !optionsDB["SleeveInstall"]
  if (ns.peek(7) !== "NULL PORT DATA") ns.writePort(17, optionsDB["SleeveInstall"] ? "Install On" : "Install Off")
  ns.writePort(1, true)
}
async function buttonSleevesToggle(ns, mode) {
  switch (optionsDB["SleeveMode"]) { // Turn off the one that's on since it's changing
    case "Gangs":
      if (ns.peek(6) !== "NULL PORT DATA") ns.writePort(16, "Sleeves Off")
      break
    case "BB":
      if (ns.peek(8) !== "NULL PORT DATA") ns.writePort(18, "sleeves off")
      break
    case "Training":
    case "Recovery":
    case "Sync":
    case "Money":
    case "Karma":
    case "Idle":
    case "Int":
      if (ns.peek(7) !== "NULL PORT DATA"
        && !["Training", "Idle", "Recovery", "Sync", "Money", "Karma", "Int"].includes(mode)) await proxy(ns, "kill", ns.peek(7))
      break

    default:
      ns.tprintf("Invalid Sleeve mode: %s", optionsDB["SleeveMode"])
  }
  const numSleeves = await proxy(ns, "sleeve.getNumSleeves")
  if (optionsDB["SleeveMode"] === mode || mode === "Idle") { //turn it off and set to idle if it's the same one
    //Switch all sleeves to idle
    for (let slv = 0; slv < numSleeves; slv++)
      await proxy(ns, "sleeve.setToIdle", slv)
    optionsDB["SleeveMode"] = "Idle"
  }
  else {
    switch (mode) { // Turn on the new one
      case "Gangs":
        if (ns.peek(6) !== "NULL PORT DATA") ns.writePort(16, "Sleeves On")
        break
      case "BB":
        if (ns.peek(8) !== "NULL PORT DATA") ns.writePort(18, "sleeves on")
        break
      case "Training":
      case "Recovery":
      case "Sync":
      case "Money":
      case "Karma":
      case "Int":
        if (ns.peek(7) !== "NULL PORT DATA")
          ns.writePort(17, mode)
        break
      case "Idle":
        for (let i = 0; i < numSleeves; i++)
          await proxy(ns, "sleeve.setToIdle", i)
        break
      default:
        ns.tprintf("Invalid Sleeve mode: %s", mode)
    }
    optionsDB["SleeveMode"] = mode
  }
  ns.writePort(1, true)
}
async function buttonGrafting(ns) {
  resetInfo = await getResetInf(ns)
  sourceFiles = await getOwnedSF(ns)
  const hasSing = hasBN(resetInfo, sourceFiles, 4, 2)
  let pidof = 0
  if (hasSing) {
    pidof = await runIt(ns, "SphyxOS/bins/graftingAdv.js", true, [])
  }
  else {
    pidof = await runIt(ns, "SphyxOS/bins/graftingBasic.js", true, [])
  }
  if (pidof > 0) ns.writePort(20, pidof)
  ns.writePort(1, true)
}
async function buttonBBStart(ns) {
  if (ns.peek(8) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(8))
  }
  else {
    ns.writePort(18, "quiet")
    ns.writePort(18, optionsDB["BBFinisher"] ? "finisher on" : "finisher off")
    ns.writePort(18, optionsDB["BBIntMode"] ? "int mode on" : "int mode off")
    ns.writePort(18, optionsDB["SleeveMode"] === "BB" ? "sleeves on" : "sleeves off")
    ns.writePort(18, optionsDB["BBInfilOnly"] ? "sleeve infil on" : "sleeve infil off")
    const value = await runIt(ns, "SphyxOS/bins/bb.js", true, [])
    if (value > 0) ns.writePort(8, value)
  }
  ns.writePort(1, true)
}
function buttonBBFinisher(ns) {
  optionsDB["BBFinisher"] = !optionsDB["BBFinisher"]
  if (ns.peek(8) !== "NULL PORT DATA") ns.writePort(18, optionsDB["BBFinisher"] ? "finisher on" : "finisher off")
  ns.writePort(1, true)
}
function buttonBBIntMode(ns) {
  optionsDB["BBIntMode"] = !optionsDB["BBIntMode"]
  if (ns.peek(8) !== "NULL PORT DATA") ns.writePort(18, optionsDB["BBIntMode"] ? "int mode on" : "int mode off")
  ns.writePort(1, true)
}
function buttonBBInfilOnly(ns) {
  optionsDB["BBInfilOnly"] = !optionsDB["BBInfilOnly"]
  if (ns.peek(8) !== "NULL PORT DATA") ns.writePort(18, optionsDB["BBInfilOnly"] ? "sleeve infil on" : "sleeve infil off")
  ns.writePort(1, true)
}
/** @param {NS} ns */
async function buttonStanekStart(ns) {
  if (ns.peek(11) === "NULL PORT DATA") {
    const frags = await proxyTry(ns, "stanek.activeFragments")

    if (frags.length > 0) {
      const val = await runIt(ns, "SphyxOS/stanek/startCharge.js", true, [])
      if (val > 0) ns.writePort(11, val)
      ns.writePort(1, true)
    }
    else ns.toast("Please select a loadout first", "error", 3000)
  }
}
async function buttonStanekSaveConfig(ns) {
  ns.exec("SphyxOS/stanek/saveStanek.js", "home", 1)
  ns.writePort(1, true)
}
function buttonStanekLoadConfig(ns) {
  if (optionsDB["StanekDefault"])
    ns.exec("SphyxOS/stanek/loadStanek.js", "home", 1, "default")
  else
    ns.exec("SphyxOS/stanek/loadStanek.js", "home", 1)
  ns.writePort(1, true)
}
function buttonStanekUseDefault(ns) {
  optionsDB["StanekDefault"] = !optionsDB["StanekDefault"]
  ns.writePort(1, true)
}
async function buttonDevMenu(ns) {
  await runIt(ns, "SphyxOS/cheats/devMenu.js", false, [])
  ns.writePort(1, true)
}
async function buttonUnlockAll(ns) {
  await runIt(ns, "SphyxOS/cheats/achievements.js", false, [])
  ns.writePort(1, true)
}
async function buttonCasinoStart(ns) {
  if (ns.peek(10) !== "NULL PORT DATA") {
    await proxy(ns, "kill", ns.peek(10))
  }
  else {
    await runIt(ns, "SphyxOS/cheats/casino.js", true, [])
  }
  ns.writePort(1, true)
}
async function buttonAutoInfilStart(ns) {
  if (wnd.tmrAutoInf) { //Stop it
    await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, [])
    ns.clearPort(30)
  }
  else { //Start it
    if (!optionsDB["AutoInfilAuto"]) ns.writePort(30, await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, []))
    else if (optionsDB["AutoInfilMoneyMode"]) ns.writePort(30, await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, ["--auto"]))
    else ns.writePort(30, await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, ["--auto", "--faction", optionsDB["AutoInfilFaction"]]))
  }
  ns.writePort(1, true)
}
async function buttonAutoInfilAuto(ns) {
  optionsDB["AutoInfilAuto"] = !optionsDB["AutoInfilAuto"]
  if (!optionsDB["AutoInfilAuto"]) { //Turn it off
    optionsDB["AutoInfilFaction"] = ""
    optionsDB["AutoInfilMoneyMode"] = false
    if (wnd.tmrAutoInf) await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, ["--update", "--quiet"])
  }
  else { //Turn it on
    optionsDB["AutoInfilMoneyMode"] = true
    optionsDB["AutoInfilFaction"] = ""
    if (wnd.tmrAutoInf) await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, ["--auto", "--update", "--quiet"])
  }
  ns.writePort(1, true)
}
async function buttonAutoInfilMoney(ns) {
  optionsDB["AutoInfilMoneyMode"] = !optionsDB["AutoInfilMoneyMode"]
  if (optionsDB["AutoInfilMoneyMode"]) { //Already on, just abort
    return
  }
  else { //Turn it on
    optionsDB["AutoInfilAuto"] = true
    optionsDB["AutoInfilMoneyMode"] = true
    optionsDB["AutoInfilFaction"] = ""
    optionsDB["AutoInfilFactionMode"] = false
    if (wnd.tmrAutoInf) await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, ["--auto", "--update", "--quiet"])
  }
  ns.writePort(1, true)
}
async function buttonAutoInfilFaction(ns) {
  const player = await proxy(ns, "getPlayer")
  let gangFac = ""
  const mygang = await proxyTry(ns, "gang.getGangInformation")
  if (mygang) gangFac = mygang.faction

  const factions = player.factions.filter((f) => ![gangFac, "Bladeburners", "Church of the Machine God", "Shadows of Anarchy"].includes(f))
  if (factions.length === 0) {
    optionsDB["AutoInfilMoneyMode"] = true
    optionsDB["AutoInfilFactionMode"] = false
    ns.writePort(1, true)
    return
  }
  else if (factions.length > 1)
    optionsDB["AutoInfilFaction"] = await ns.prompt("Select Faction", { type: "select", choices: factions })
  else
    optionsDB["AutoInfilFaction"] = factions.pop()

  if (optionsDB["AutoInfilFaction"] === "") {
    optionsDB["AutoInfilMoneyMode"] = true
    optionsDB["AutoInfilFactionMode"] = false
    ns.writePort(1, true)
    return
  }
  optionsDB["AutoInfilAuto"] = true
  optionsDB["AutoInfilMoneyMode"] = false
  optionsDB["AutoInfilFactionMode"] = true
  if (wnd.tmrAutoInf) await runIt(ns, "SphyxOS/cheats/autoInfil.js", false, ["--auto", "--faction", optionsDB["AutoInfilFaction"], "--update", "--quiet"])
  ns.writePort(1, true)
}
/** @param {NS} ns */
async function setOptionsDB(ns) {
  if (optionsDB["BatcherUseHacknet"] === undefined)
    optionsDB["BatcherUseHacknet"] = false
  if (optionsDB["BatcherAutoHash"] === undefined)
    optionsDB["BatcherAutoHash"] = false
  if (optionsDB["BatcherAutoBuyServers"] === undefined)
    optionsDB["BatcherAutoBuyServers"] = true
  if (optionsDB["BatcherAutoBuyHacknet"] === undefined)
    optionsDB["BatcherAutoBuyHacknet"] = false
  if (optionsDB["BatcherMoney"] === undefined)
    optionsDB["BatcherMoney"] = true
  if (optionsDB["BatcherXP"] === undefined)
    optionsDB["BatcherXP"] = true
  if (optionsDB["BatcherStanek"] === undefined)
    optionsDB["BatcherStanek"] = false
  if (optionsDB["BatcherPad"] === undefined)
    optionsDB["BatcherPad"] = false
  if (optionsDB["BatcherLog"] === undefined)
    optionsDB["BatcherLog"] = false
  if (optionsDB["BatcherPopout"] === undefined)
    optionsDB["BatcherPopout"] = false
  if (optionsDB["DisplayToggleHelper"] === undefined)
    optionsDB["DisplayToggleHelper"] = false
  if (optionsDB["DisplayToggleCollapse"] === undefined)
    optionsDB["DisplayToggleCollapse"] = true
  if (optionsDB["StocksToggleAutoBuy"] === undefined)
    optionsDB["StocksToggleAutoBuy"] = false
  if (optionsDB["StocksPopOut"] === undefined)
    optionsDB["StocksPopOut"] = false
  if (optionsDB["IPvGoPlayAsWhite"] === undefined)
    optionsDB["IPvGoPlayAsWhite"] = false
  if (optionsDB["IPvGoRepeat"] === undefined)
    optionsDB["IPvGoRepeat"] = true
  if (optionsDB["IPvGoCheats"] === undefined)
    optionsDB["IPvGoCheats"] = true
  if (optionsDB["IPvGoLogging"] === undefined)
    optionsDB["IPvGoLogging"] = false
  if (optionsDB["IPvGoNetburners"] === undefined)
    optionsDB["IPvGoNetburners"] = true
  if (optionsDB["IPvGoSlumSnakes"] === undefined)
    optionsDB["IPvGoSlumSnakes"] = true
  if (optionsDB["IPvGoTheBlackHand"] === undefined)
    optionsDB["IPvGoTheBlackHand"] = true
  if (optionsDB["IPvGoTetrads"] === undefined)
    optionsDB["IPvGoTetrads"] = true
  if (optionsDB["IPvGoDaedalus"] === undefined)
    optionsDB["IPvGoDaedalus"] = true
  if (optionsDB["IPvGoIlluminati"] === undefined)
    optionsDB["IPvGoIlluminati"] = true
  if (optionsDB["IPvGoUnknown"] === undefined)
    optionsDB["IPvGoUnknown"] = true
  if (optionsDB["IPvGoNoAI"] === undefined)
    optionsDB["IPvGoNoAI"] = false
  if (optionsDB["IPvGoSlowMode"] === undefined)
    optionsDB["IPvGoSlowMode"] = false
  if (optionsDB["IPvGoPopOut"] === undefined)
    optionsDB["IPvGoPopOut"] = false
  if (optionsDB["GangAutoAscend"] === undefined)
    optionsDB["GangAutoAscend"] = true
  if (optionsDB["GangAutoEQ"] === undefined)
    optionsDB["GangAutoEQ"] = true
  if (optionsDB["GangMode"] === undefined)
    optionsDB["GangMode"] = "AutoMode"
  if (optionsDB["GangPopOut"] === undefined)
    optionsDB["GangPopOut"] = false
  if (optionsDB["SleeveMode"] === undefined) {
    if (hasBN(resetInfo, sourceFiles, 10, 1)) {
      const slvs = await proxy(ns, "sleeve.getNumSleeves")
      if (slvs)
        for (let i = 0; i < slvs; i++)
          await proxy(ns, "sleeve.setToIdle", i)
      optionsDB["SleeveMode"] = "Idle"
      if (optionsDB["SleeveInstall"] === undefined)
        optionsDB["SleeveInstall"] = false
      if (optionsDB["SleevePopOut"] === undefined)
        optionsDB["SleevePopOut"] = false
    }
  }
  if (optionsDB["BBFinisher"] === undefined)
    optionsDB["BBFinisher"] = false
  if (optionsDB["BBIntMode"] === undefined)
    optionsDB["BBIntMode"] = false
  if (optionsDB["BBInfilOnly"] === undefined)
    optionsDB["BBInfilOnly"] = false
  if (optionsDB["BBPopOut"] === undefined)
    optionsDB["BBPopOut"] = false
  if (optionsDB["AutoInfilAuto"] === undefined)
    optionsDB["AutoInfilAuto"] = true
  if (optionsDB["AutoInfilMoneyMode"] === undefined)
    optionsDB["AutoInfilMoneyMode"] = true
  if (optionsDB["AutoInfilFactionMode"] === undefined)
    optionsDB["AutoInfilFactionMode"] = false
  if (optionsDB["AutoInfilFaction"] === undefined)
    optionsDB["AutoInfilFaction"] = ""
  if (optionsDB["ShareMode"] === undefined)
    optionsDB["ShareMode"] = false
  if (optionsDB["StanekDefault"] === undefined)
    optionsDB["StanekDefault"] === true
  if (optionsDB["AutoPilotMoveOn"] === undefined)
    optionsDB["AutoPilotMoveOn"] === false
  if (optionsDB["AutoPilotPopOut"] === undefined)
    optionsDB["AutoPilotPopOut"] === false
  if (optionsDB["GraftingPopOut"] === undefined)
    optionsDB["GraftingPopOut"] === false
}
function hasBN(resetInfo, sourceFiles, bn, sfLvl = 1) {
  if (resetInfo.currentNode === bn) return true
  try {
    for (const sf of sourceFiles) if (sf.n === bn && sf.lvl >= sfLvl) return true
    return false
  }
  catch { return false }
}
function Row({ title, buttons }) {
  //Why doesn't .padEnd() work?  Sadness
  let buffer = getBuffer(title.length)
  if (optionsDB["DisplayToggleCollapse"] && openDB.has(title))
    return (
      <div>
        <details open onToggle={(e) => {
          if (e.currentTarget.open)
            openDB.add(title)
          else
            openDB.delete(title)
        }}>
          <summary style={{ fontSize: 18 }}>{title}</summary>
          {buttons}
        </details>
      </div>
    )
  else if (optionsDB["DisplayToggleCollapse"])
    return (
      <div>
        <details onToggle={(e) => {
          if (e.currentTarget.open)
            openDB.add(title)
          else
            openDB.delete(title)
        }}>
          <summary style={{ fontSize: 18 }}>{title}</summary>
          {buttons}
        </details>

      </div >
    )
  else
    return (
      <div>
        {title}{buffer}{buttons}
      </div>
    )
}
const greenStyle = {
  backgroundColor: "green",
  color: "black"
}
const redStyle = {
  backgroundColor: "red",
  color: "black"
}