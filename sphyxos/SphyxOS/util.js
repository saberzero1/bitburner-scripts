export const reservedRam = 256;
/** @param {NS} ns */
export async function ramDodge(ns, scriptName, persistent, argmts) {
    const pidof = await runIt(ns, scriptName, persistent, argmts, 0);
    if (pidof === 0) throw new Error("Failed to run " + scriptName);
    await ns.nextPortWrite(pidof);
    return ns.readPort(pidof);
}
/** @param {NS} ns */
export async function ramDodgeProxy(ns, script, func, argmts) {
    //const pidof = ns.exec("SphyxOS/extras/runIt.js", "home", { threads: 1, temporary: true }, script, false, ns.getFunctionRamCost(func) + 1.6, ...[func, ...argmts])
    const pidof = await runIt(
        ns,
        script,
        false,
        [func, ...argmts],
        ns.getFunctionRamCost(func) + 1.6,
    );
    if (pidof === 0) throw new Error("Failed to run proxy " + func);
    await ns.nextPortWrite(pidof);
    return ns.readPort(pidof);
}
/** @param {NS} ns */
export async function ramDodgeLocal(ns, scriptName, argmts) {
    const pidof = ns.exec(
        scriptName,
        "home",
        { threads: 1, temporary: true },
        ...argmts,
    );
    if (pidof === 0)
        throw new Error("Failed to run " + scriptName + " locally");
    await ns.nextPortWrite(pidof);
    return ns.readPort(pidof);
}

/** @param {NS} ns */
export async function runIt(
    ns,
    script,
    persistent,
    argmts,
    scriptOverride = 0,
    quiet = false,
) {
    //Any runIt now has a persistent argument to pass along if it can run on hacknet servers.
    //This way you can choose to run something like puppet on a hacknet server
    let thispid = 0;
    let threads = 1;
    const scriptRam =
        scriptOverride === 0
            ? await doGetScriptRam(ns, script)
            : scriptOverride;
    const homeAvailRam = await getServerAvailRam(ns, "home");
    if (!persistent && Math.floor(homeAvailRam / scriptRam) >= 1) {
        thispid = ns.exec(
            script,
            "home",
            { threads: 1, temporary: true },
            ...argmts,
        );
        if (thispid > 0) threads--;
    }
    if (threads >= 1) {
        const servers = await getServersLight(ns);
        let emergencyReserve = !persistent
            ? false
            : (await getServerAvailRam(ns, "home")) <= 16
              ? true
              : false;
        const maxRam = !persistent ? 0 : await maxRun(ns, persistent);
        const resRam = !persistent
            ? 0
            : maxRam >= 256
              ? 256
              : maxRam >= 128
                ? 128
                : maxRam >= 64
                  ? 64
                  : maxRam >= 32
                    ? 32
                    : 16;
        for (const server of servers) {
            if (!(await getHasRootAccs(ns, server))) continue;
            if (server.startsWith("hacknet") && persistent) continue;
            let tmpramavailable = await getServerAvailRam(ns, server);
            if (persistent && emergencyReserve && tmpramavailable >= resRam) {
                emergencyReserve = false;
                tmpramavailable -= resRam;
            }
            if (server === "home" && persistent)
                tmpramavailable = Math.max(tmpramavailable - reservedRam, 0);
            if (tmpramavailable <= 0) continue;
            const threadsonserver = Math.floor(tmpramavailable / scriptRam);
            // How many threads can we run?  If we can run something, do it
            if (threadsonserver <= 0) continue;
            await doSCP(ns, script, server);
            await doSCP(ns, "SphyxOS/util.js", server, "home");
            await doSCP(ns, "SphyxOS/forms.js", server, "home");
            thispid = ns.exec(
                script,
                server,
                { threads: 1, temporary: true },
                ...argmts,
            );
            if (thispid === 0) continue; //ns.tprintf("Failed to run: %s on %s", script, server)
            threads--;
            break;
        } // All servers
    }
    if (threads >= 1 && !quiet)
        ns.tprintf("Failed to allocate all threads for script: %s", script);
    return thispid;
}
/** @param {NS} ns */
export async function maxRun(ns, persistent, useHacknet = false) {
    //Any runIt now has a persistent argument to pass along if it can run on hacknet servers.
    //This way you can choose to run something like puppet on a hacknet server
    let highest = 0;
    /**@type {String[]} servers */
    const servers = await getServersLight(ns);
    let emergencyReserve =
        (await getServerAvailRam(ns, "home")) <= 16 ? true : false;
    for (const server of servers) {
        if (!(await getHasRootAccs(ns, server))) continue;
        if (server.startsWith("hacknet") && !useHacknet) continue;
        let tmpramavailable = await getServerAvailRam(ns, server);
        if (server === "home" && persistent)
            tmpramavailable = Math.max(tmpramavailable - reservedRam, 0);
        if (tmpramavailable > highest) highest = tmpramavailable;
    } // All servers
    if (!persistent) return highest;
    //Highest is now max run
    const resRam =
        highest >= 256
            ? 256
            : highest >= 128
              ? 128
              : highest >= 64
                ? 64
                : highest >= 32
                  ? 32
                  : 16;
    //Now that we have the highest, we go again
    let highest2 = 0;
    for (const server of servers) {
        if (!(await getHasRootAccs(ns, server))) continue;
        if (server.startsWith("hacknet") && persistent) continue;
        let tmpramavailable = await getServerAvailRam(ns, server);
        if (persistent && emergencyReserve && tmpramavailable >= resRam) {
            emergencyReserve = false;
            tmpramavailable -= resRam;
        }
        if (server === "home" && persistent)
            tmpramavailable = Math.max(tmpramavailable - reservedRam, 0);
        if (tmpramavailable > highest2) highest2 = tmpramavailable;
    } // All servers
    return highest2;
}
export function printProfit(ns, tm, take, batches, threads, chance) {
    //tm is in milliseconds...
    tm = tm / 1000;
    //Profit per second
    let profit = (take / tm) * batches;
    profit = (profit / threads) * chance;
    return tm === 0 || take === 0 || isNaN(profit) ? 0 : profit;
}
/** @param {NS} ns */
export function profitPerSecond(ns, tm, take, batches) {
    //tm is in milliseconds...
    tm = tm / 1000;
    //Profit per second
    let profit = (take / tm) * batches;
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        return tm === 0 || take === 0 || isNaN(profit)
            ? "0" + "/s"
            : ns.format.number(profit, 2) + "/s";
    else
        return tm === 0 || take === 0 || isNaN(profit)
            ? "0" + "/s"
            : ns.formatNumber(profit, 2) + "/s";
}
export function terminal(text) {
    const input = eval("document").getElementById("terminal-input");
    const handler = Object.keys(input)[1];
    input[handler].onChange({ target: { value: text } });
    input[handler].onKeyDown({ key: "Enter", preventDefault: () => null });
}
// Thanks to omuretsu, jeek and sphyxis
let slp = (ms) => new Promise((r) => setTimeout(r, ms));
export async function makeNewWindow(title = "Default Window Title", theme) {
    //  let win = open("", title.replaceAll(" ", "_"), "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no");
    let win = open(
        "main.bundle.js",
        title.replaceAll(" ", "_"),
        "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no",
    );
    let good = false;
    let doc = 0;
    while (!good) {
        await slp(1000);
        try {
            doc = win["document"];
            doc.head.innerHTML = "No.";
            good = true;
        } catch {
            good = false;
        }
    }
    await slp(200);
    doc.head.innerHTML =
        `
  <title>${title}</title>
  <style>
    *{
      margin:0;
    }
    body{
      background:` +
        theme["backgroundprimary"] +
        `;
      color:` +
        theme["primary"] +
        `;
      overflow:hidden;
      height:100vh;
      width:100vw;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
      display:flex;
      flex-direction:column;
    }
    td{
      background:` +
        theme["backgroundsecondary"] +
        `;
      color:` +
        theme["primary"] +
        `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    a{
      color:` +
        theme["primary"] +
        `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    warning{
      color:` +
        theme["error"] +
        `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    .title{
      font-size:20px;
      text-align:center;
      flex: 0 0;
      display:flex;
      align-items:center;
      border-bottom:1px solid white;
    }
    .scrollQuery{
      font-size:12px;
      margin-left:auto;
    }
    .logs{
      width:100%;
      flex: 1;
      overflow-y:scroll;
      font-size:14px;
      white-space:normal;
    }
    .logs::-webkit-scrollbar,::-webkit-scrollbar-corner{
      background:` +
        theme["button"] +
        `;
      width:10px;
      height:10px;
    }
    .logs::-webkit-scrollbar-button{
      width:0px;
      height:0px;
    }
    .logs::-webkit-scrollbar-thumb{
      background:` +
        theme["primary"] +
        `;
    }
  </style>`;
    doc.body.innerHTML = `<div class=title>${title}</div><div class=logs><p></p></div>`;
    win.clear = () => {
        win["document"].body.querySelector(".logs").innerHTML = "";
    };
    win.header = (content) => {
        win["document"].body.innerHTML =
            `<div class=title>${content}</div><div class=logs><p></p></div>`;
    };
    win.update = (content) => {
        win["document"].body.querySelector(".logs").innerHTML =
            win["document"].body.querySelector(".logs").innterHTML === ""
                ? content
                      .replaceAll(" ", "&nbsp;")
                      .replaceAll("\r", "<br>")
                      .replaceAll("\n", "<br>")
                : win["document"].body.querySelector(".logs").innerHTML +
                  `<br>` +
                  content
                      .replaceAll(" ", "&nbsp;")
                      .replaceAll("\r", "<br>")
                      .replaceAll("\n", "<br>");
    };
    win.reopen = () =>
        open(
            "",
            title.replaceAll(" ", "_"),
            "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no",
        );
    win.focus();
    return win;
}
export async function proxy(ns, func, ...argmnts) {
    return await ramDodgeProxy(ns, "SphyxOS/extras/nsProxy.js", func, argmnts);
}
export async function proxyTry(ns, func, ...argmnts) {
    return await ramDodgeProxy(
        ns,
        "SphyxOS/extras/nsProxyTry.js",
        func,
        argmnts,
    );
}
export async function getServersLight(ns) {
    return await ramDodgeLocal(ns, "SphyxOS/extras/getServersLight.js", []);
}
export async function doSCP(ns, script, hostname) {
    return await ramDodgeLocal(ns, "SphyxOS/basic/doSCP.js", [
        script,
        hostname,
    ]);
}
export async function getHasRootAccs(ns, hostname) {
    return await ramDodgeLocal(ns, "SphyxOS/basic/getHasRootAccs.js", [
        hostname,
    ]);
}
export async function getServerAvailRam(ns, hostname) {
    return await ramDodgeLocal(ns, "SphyxOS/basic/getServerAvailRam.js", [
        hostname,
    ]);
}
export async function getMoneyAvail(ns, hostname) {
    return await ramDodgeLocal(ns, "SphyxOS/basic/getMoneyAvail.js", [
        hostname,
    ]);
}
export async function getIsRunning(ns, pidnumber) {
    return await ramDodgeLocal(ns, "SphyxOS/basic/getIsRunning.js", [
        pidnumber,
    ]);
}
export async function serverRun(
    ns,
    logging,
    target,
    w1,
    g1,
    w2,
    h1,
    w3,
    g2,
    w4,
    batchh1,
    batchw1,
    batchg1,
    batchw2,
    batches,
    nohacknet,
) {
    return await ramDodgeLocal(ns, "SphyxOS/extras/serverRun.js", [
        logging,
        target,
        w1,
        g1,
        w2,
        h1,
        w3,
        g2,
        w4,
        batchh1,
        batchw1,
        batchg1,
        batchw2,
        batches,
        nohacknet,
    ]);
}
export async function doGetScriptRam(ns, scriptname) {
    return await ramDodgeLocal(ns, "SphyxOS/basic/getScriptRam.js", [
        scriptname,
    ]);
}
export async function getSrvr(ns, hostname) {
    return await ramDodge(ns, "SphyxOS/basic/getServer.js", false, [hostname]);
}
export async function getHckTimeBasic(ns, hostname) {
    return await ramDodge(ns, "SphyxOS/basic/getHackTime.js", false, [
        hostname,
    ]);
}
export async function getServers(ns) {
    return await ramDodge(ns, "SphyxOS/extras/getServers.js", false, []);
}
export async function doScriptKill(ns, script, server) {
    return await ramDodge(ns, "SphyxOS/basic/scriptKill.js", false, [
        script,
        server,
    ]);
}
export async function hasBN(ns, bn, lvl = 1, forced = false) {
    return await ramDodge(ns, "SphyxOS/extras/hasBN.js", false, [
        bn,
        lvl,
        forced,
    ]);
}
export async function currentBN(ns) {
    return await ramDodge(ns, "SphyxOS/extras/currentBN.js", false, []);
}
export async function getBNMults(ns) {
    return await ramDodge(ns, "SphyxOS/basic/getbnmults.js", false, []);
}
export async function getMoneySource(ns) {
    return await ramDodge(ns, "SphyxOS/basic/getMoneySources.js", false, []);
}
export async function wastePids(ns) {
    return await ramDodge(ns, "SphyxOS/extras/wastePids.js", false, []);
}
export async function getResetInf(ns) {
    return await ramDodge(ns, "SphyxOS/basic/getResetInfo.js", false, []);
}
export async function getOptimalTarget(ns, first = false) {
    return await ramDodge(ns, "SphyxOS/extras/getOptimalTarget.js", false, [
        first,
    ]);
}
export async function getHackP(
    ns,
    target,
    batches,
    threadsavailable,
    starthack,
) {
    return await ramDodge(ns, "SphyxOS/extras/getHackP.js", false, [
        target,
        batches,
        threadsavailable,
        starthack,
    ]);
}
export async function getPlay(ns) {
    return await ramDodge(ns, "SphyxOS/basic/getPlay.js", false, []);
}
export async function weakenStr(ns) {
    return await ramDodge(ns, "SphyxOS/basic/weakenStr.js", false, []);
}
export async function getHackPercent(ns, hostname, minsecurity) {
    return await ramDodge(ns, "SphyxOS/forms/getHackPercent.js", false, [
        hostname,
        minsecurity,
    ]);
}
export async function getHackChance(ns, hostname, minsecurity) {
    return await ramDodge(ns, "SphyxOS/forms/getHackChance.js", false, [
        hostname,
        minsecurity,
    ]);
}
export async function getHckTime(ns, hostname, minsecurity) {
    return await ramDodge(ns, "SphyxOS/forms/getHckTime.js", false, [
        hostname,
        minsecurity,
    ]);
}
export async function getGrowThreads(ns, hostname, moneystate, minsecurity) {
    return await ramDodge(ns, "SphyxOS/forms/getGrowThreads.js", false, [
        hostname,
        moneystate,
        minsecurity,
    ]);
}
export async function getReputationFromDonation(ns, amount) {
    return await ramDodge(
        ns,
        "SphyxOS/forms/getReputationFromDonation.js",
        false,
        [amount],
    );
}
export async function doGetServerMinSec(ns, hostname) {
    return await ramDodge(ns, "SphyxOS/basic/doGetServerMinSec.js", false, [
        hostname,
    ]);
}
export async function doGetServerCurSec(ns, hostname) {
    return await ramDodge(ns, "SphyxOS/basic/doGetServerCurSec.js", false, [
        hostname,
    ]);
}
export async function doGetServerMaxMoney(ns, hostname) {
    return await ramDodge(ns, "SphyxOS/basic/doGetServerMaxMoney.js", false, [
        hostname,
    ]);
}
export async function doGetHostname(ns) {
    return await ramDodge(ns, "SphyxOS/basic/getHostname.js", false, []);
}
export async function hashIt(ns, type) {
    return await ramDodge(ns, "SphyxOS/extras/hashIt.js", false, [type]);
}
export async function virus(ns) {
    return await ramDodge(ns, "SphyxOS/extras/virus.js", false, []);
}
export async function serverPurchaser(ns) {
    return await ramDodge(ns, "SphyxOS/extras/serverPurchaser.js", false, []);
}
export async function hacknetPurchaser(ns) {
    return await ramDodge(ns, "SphyxOS/bins/hacknetPurchaser.js", false, []);
}
export async function getPortOpeners(ns) {
    return await ramDodge(ns, "SphyxOS/extras/getPortOpeners.js", false, []);
}
export async function getPortOpenersSing(ns) {
    return await ramDodge(
        ns,
        "SphyxOS/extras/getPortOpenersSing.js",
        false,
        [],
    );
}
export async function doKill(ns, pidnum) {
    return await ramDodge(ns, "SphyxOS/basic/kill.js", false, [pidnum]);
}
//Singularity
export async function destroyWD(ns, bn, script) {
    return await ramDodge(ns, "SphyxOS/singularity/destroyWD.js", false, [
        bn,
        script,
    ]);
}
export async function travelCity(ns, city) {
    return await ramDodge(ns, "SphyxOS/singularity/travelToCity.js", false, [
        city,
    ]);
}
export async function goToLoc(ns, city) {
    return await ramDodge(ns, "SphyxOS/singularity/goToLoc.js", false, [city]);
}
export async function getWork(ns) {
    return await ramDodge(ns, "SphyxOS/singularity/getWork.js", false, []);
}
export async function setGym(ns, gym, workout) {
    return await ramDodge(ns, "SphyxOS/singularity/setGym.js", false, [
        gym,
        workout,
    ]);
}
export async function doCrime(ns, crime) {
    return await ramDodge(ns, "SphyxOS/singularity/commitCrime.js", false, [
        crime,
    ]);
}
export async function getBestFavor(ns) {
    return await ramDodge(ns, "SphyxOS/singularity/getBestFavor.js", false, []);
}
export async function getBestRep(ns) {
    return await ramDodge(ns, "SphyxOS/singularity/getBestRep.js", false, []);
}
export async function joinFac(ns, faction) {
    return await ramDodge(ns, "SphyxOS/singularity/joinFaction.js", false, [
        faction,
    ]);
}
export async function getAugsFromFaction(ns, faction) {
    return await ramDodge(
        ns,
        "SphyxOS/singularity/getAugsFromFaction.js",
        false,
        [faction],
    );
}
export async function getOwnedAugs(ns, queued) {
    return await ramDodge(ns, "SphyxOS/singularity/getOwnedAugs.js", false, [
        queued,
    ]);
}
export async function getOwnedSF(ns) {
    return await ramDodge(ns, "SphyxOS/singularity/getOwnedSF.js", false, []);
}
export async function purchaseAug(ns, faction, aug) {
    return await ramDodge(ns, "SphyxOS/singularity/purchaseAug.js", false, [
        faction,
        aug,
    ]);
}
export async function upgHomeRam(ns) {
    return await ramDodge(
        ns,
        "SphyxOS/singularity/upgradeHomeRam.js",
        false,
        [],
    );
}
export async function getFactionFav(ns, faction) {
    return await ramDodge(ns, "SphyxOS/singularity/getFactionFavor.js", false, [
        faction,
    ]);
}
export async function getFacRep(ns, faction) {
    return await ramDodge(ns, "SphyxOS/singularity/getFactionRep.js", false, [
        faction,
    ]);
}
export async function donateToFac(ns, faction, amount) {
    return await ramDodge(ns, "SphyxOS/singularity/donateToFaction.js", false, [
        faction,
        amount,
    ]);
}
export async function purchTor(ns) {
    return await ramDodge(ns, "SphyxOS/singularity/purchaseTor.js", false, []);
}
export async function stopAct(ns) {
    return await ramDodge(ns, "SphyxOS/singularity/stopAction.js", false, []);
}
//Coding Contracts
export async function getCType(ns, filename, host) {
    return await ramDodge(
        ns,
        "SphyxOS/codingContracts/getContractType.js",
        false,
        [filename, host],
    );
}
export async function getCData(ns, filename, host) {
    return await ramDodge(
        ns,
        "SphyxOS/codingContracts/getContractData.js",
        false,
        [filename, host],
    );
}
//Stocks
export async function hasWSEAcct(ns) {
    return await ramDodge(ns, "SphyxOS/stock/hasWSEAccount.js", false, []);
}
export async function hasTIXAPIAccs(ns) {
    return await ramDodge(ns, "SphyxOS/stock/hasTIXAPIAccess.js", false, []);
}
export async function getSyms(ns) {
    return await ramDodge(ns, "SphyxOS/stock/getSymbols.js", false, []);
}
export async function shortEnabled(ns) {
    return await ramDodge(ns, "SphyxOS/stock/shortEnabled.js", false, []);
}
export async function getSalesGain(ns, sym, shares, type) {
    return await ramDodge(ns, "SphyxOS/stock/getSaleGain.js", false, [
        sym,
        shares,
        type,
    ]);
}
export async function has4SAPI(ns) {
    return await ramDodge(ns, "SphyxOS/stock/has4SDataTIXAPI.js", false, []);
}
export async function getBidP(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getBidPrice.js", false, [sym]);
}
export async function getAskP(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getAskPrice.js", false, [sym]);
}
export async function getPrices(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getPrice.js", false, [sym]);
}
export async function getPosi(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getPosition.js", false, [sym]);
}
export async function getFCast(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getForcast.js", false, [sym]);
}
export async function getVol(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getVolatility.js", false, [sym]);
}
export async function sellstock(ns, sym, shares) {
    return await ramDodge(ns, "SphyxOS/stock/sellStock.js", false, [
        sym,
        shares,
    ]);
}
export async function sellshort(ns, sym, shares) {
    return await ramDodge(ns, "SphyxOS/stock/sellShort.js", false, [
        sym,
        shares,
    ]);
}
export async function getmaxshares(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getMaxShares.js", false, [sym]);
}
export async function buyshort(ns, sym, shares) {
    return await ramDodge(ns, "SphyxOS/stock/buyShort.js", false, [
        sym,
        shares,
    ]);
}
export async function buystock(ns, sym, shares) {
    return await ramDodge(ns, "SphyxOS/stock/buyStock.js", false, [
        sym,
        shares,
    ]);
}
export async function getfv(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getF-V.js", false, [sym]);
}
export async function getSnap(ns, sym) {
    return await ramDodge(ns, "SphyxOS/stock/getSnap.js", false, [sym]);
}
export async function getWorth(ns) {
    return await ramDodge(ns, "SphyxOS/stock/getWorth.js", false, []);
}
//IPvGo
export async function getBState(ns) {
    return await ramDodge(ns, "SphyxOS/ipvgo/getbstate.js", false, []);
}
export async function getCEmptyNodes(ns) {
    return await ramDodge(
        ns,
        "SphyxOS/ipvgo/getcontrolledemptynodes.js",
        false,
        [],
    );
}
export async function getLibs(ns) {
    return await ramDodge(ns, "SphyxOS/ipvgo/getliberties.js", false, []);
}
export async function getValMoves(ns, playAsWhite) {
    return await ramDodge(ns, "SphyxOS/ipvgo/getvalidmoves.js", false, [
        playAsWhite,
    ]);
}
export async function getChain(ns) {
    return await ramDodge(ns, "SphyxOS/ipvgo/getchains.js", false, []);
}
export async function play2moves(ns, x1, y1, x2, y2, playAsWhite) {
    return await ramDodge(ns, "SphyxOS/ipvgo/play2moves.js", false, [
        x1,
        y1,
        x2,
        y2,
        playAsWhite,
    ]);
}
export async function destroyND(ns, x1, y1, playAsWhite) {
    return await ramDodge(ns, "SphyxOS/ipvgo/destroyNode.js", false, [
        x1,
        y1,
        playAsWhite,
    ]);
}
//Gangs
export async function gangRecruit(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/recruit.js", false, []);
}
export async function getGangFaction(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/getGangFaction.js", false, []);
}
export async function gangAscend(ns, forced = false) {
    return await ramDodge(ns, "SphyxOS/gangs/ascend.js", false, [forced]);
}
export async function gangEquip(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/equip.js", false, []);
}
export async function setWar(ns, setting) {
    return await ramDodge(ns, "SphyxOS/gangs/setTerritoryWarfare.js", false, [
        setting,
    ]);
}
export async function gangCreate(ns, name) {
    return await ramDodge(ns, "SphyxOS/gangs/createGang.js", false, [name]);
}
export async function gangGetMembers(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/getMemberNames.js", false, []);
}
export async function gangGetMembersFull(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/getMembersFull.js", false, []);
}
export async function gangGetGangInfo(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/getGangInfo.js", false, []);
}
export async function gangGetOtherGangInfo(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/getOtherGangInfo.js", false, []);
}
export async function gangRespectForNext(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/respectForNext.js", false, []);
}
export async function gangInGang(ns) {
    return await ramDodge(ns, "SphyxOS/gangs/inGang.js", false, []);
}
export async function gangSetMemberTask(ns, name, task) {
    return await ramDodge(ns, "SphyxOS/gangs/setMemberTask.js", false, [
        name,
        task,
    ]);
}
//Sleeves
export async function hasSleeves(ns) {
    return await ramDodge(ns, "SphyxOS/sleeves/hasSleeves.js", false, []);
}
export async function sleeveShockRecovery(ns, slv) {
    return await ramDodge(ns, "SphyxOS/sleeves/setToShockRecovery.js", false, [
        slv,
    ]);
}
export async function sleeveIdle(ns, slv) {
    return await ramDodge(ns, "SphyxOS/sleeves/setToIdle.js", false, [slv]);
}
export async function sleeveSync(ns, slv) {
    return await ramDodge(ns, "SphyxOS/sleeves/setToSynchronize.js", false, [
        slv,
    ]);
}
export async function sleeveTravel(ns, slv, location) {
    return await ramDodge(ns, "SphyxOS/sleeves/sleeveTravel.js", false, [
        slv,
        location,
    ]);
}
export async function sleeveSetToGym(ns, slv, gym, type) {
    return await ramDodge(ns, "SphyxOS/sleeves/setToGymWorkout.js", false, [
        slv,
        gym,
        type,
    ]);
}
export async function sleeveSetToCrime(ns, slv, crime) {
    return await ramDodge(ns, "SphyxOS/sleeves/setToCrime.js", false, [
        slv,
        crime,
    ]);
}
export async function sleeveSetToUniversity(ns, slv, uni, course) {
    return await ramDodge(ns, "SphyxOS/sleeves/setToUniversity.js", false, [
        slv,
        uni,
        course,
    ]);
}
export async function sleeveSetToBBAction(ns, slv, type, contract = "") {
    return await ramDodge(ns, "SphyxOS/sleeves/setToBBAction.js", false, [
        slv,
        type,
        contract,
    ]);
}
export async function getSleeveObject(ns) {
    return await ramDodge(ns, "SphyxOS/sleeves/getSleeveObject.js", false, []);
}
export async function sleeveGetNum(ns) {
    return await ramDodge(ns, "SphyxOS/sleeves/getNumSlvs.js", false, []);
}
export async function sleeveGet(ns, slv) {
    return await ramDodge(ns, "SphyxOS/sleeves/getSleeve.js", false, [slv]);
}
export async function sleeveGetAugs(ns, slv) {
    return await ramDodge(
        ns,
        "SphyxOS/sleeves/getSleeveAugmentations.js",
        false,
        [slv],
    );
}
export async function sleeveGetPurchasableAugs(ns, slv) {
    return await ramDodge(ns, "SphyxOS/sleeves/getPurchasableAugs.js", false, [
        slv,
    ]);
}
export async function sleevePurchaseAug(ns, slv, aug) {
    return await ramDodge(ns, "SphyxOS/sleeves/purchaseSleeveAug.js", false, [
        slv,
        aug,
    ]);
}
export async function sleeveInstallAugs(ns) {
    return await ramDodge(
        ns,
        "SphyxOS/sleeves/sleeveInstallAugs.js",
        false,
        [],
    );
}
//BladeBurner
export async function bbJoinBBFac(ns) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/joinBBFac.js", false, []);
}
export async function bbJoinBBDiv(ns) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/joinBBdiv.js", false, []);
}
export async function bbGetStam(ns) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getStam.js", false, []);
}
export async function bbGetCity(ns) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getCity.js", false, []);
}
export async function bbGetCityChaos(ns, city) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getCityChaos.js", false, [
        city,
    ]);
}
export async function bbGetActionEstSuccessChance(
    ns,
    type,
    name,
    slv = undefined,
) {
    return slv === undefined
        ? await ramDodge(
              ns,
              "SphyxOS/bladeBurner/getActionEstSuccessChance.js",
              false,
              [type, name],
          )
        : await ramDodge(
              ns,
              "SphyxOS/bladeBurner/getActionEstSuccessChance.js",
              false,
              [type, name, slv],
          );
}
export async function bbSetActionAutoLvl(ns, type, name, setting) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/setActionAutoLevel.js",
        false,
        [type, name, setting],
    );
}
export async function bbGetSkillLevel(ns, name) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getSkillLevel.js", false, [
        name,
    ]);
}
export async function bbGetActionMaxLvl(ns, type, name) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getActionMaxLevel.js",
        false,
        [type, name],
    );
}
export async function bbGetActionCountRemain(ns, type, name) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getActionCountRemain.js",
        false,
        [type, name],
    );
}
export async function bbGetCurrentAction(ns) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getCurrentAction.js",
        false,
        [],
    );
}
export async function bbGetSkillPoints(ns) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getSkillPoints.js",
        false,
        [],
    );
}
export async function bbUpgradeSkill(ns, name, level) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/upgradeSkill.js", false, [
        name,
        level,
    ]);
}
export async function bbGetSkillUpgradeCost(ns, name, level = 1) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getSkillUpgradeCost.js",
        false,
        [name, level],
    );
}
export async function bbSwitchCity(ns, city) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/switchCity.js", false, [
        city,
    ]);
}
export async function bbSetActionLevel(ns, type, name, level) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/setActionLevel.js", false, [
        type,
        name,
        level,
    ]);
}
export async function bbGetActionTime(ns, type, name) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getActionTime.js", false, [
        type,
        name,
    ]);
}
export async function bbStartAction(ns, type, name) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/startAction.js", false, [
        type,
        name,
    ]);
}
export async function bbGetActionCurTime(ns) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getActionCurrentTime.js",
        false,
        [],
    );
}
export async function bbGetRank(ns) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getRank.js", false, []);
}
export async function bbGetCityEstPop(ns, city) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getCityEstPop.js", false, [
        city,
    ]);
}
export async function bbGetCityComms(ns, city) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getCityComms.js", false, [
        city,
    ]);
}
export async function bbGetActionRepGain(ns, type, name) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getActionRepGain.js",
        false,
        [type, name],
    );
}
export async function bbGetBlackOpRank(ns, name) {
    return await ramDodge(ns, "SphyxOS/bladeBurner/getBlackOpRank.js", false, [
        name,
    ]);
}
export async function bbGetActionCurLvl(ns, type, name) {
    return await ramDodge(
        ns,
        "SphyxOS/bladeBurner/getActionCurLevel.js",
        false,
        [type, name],
    );
}
//Corp
export async function divExist(ns, div) {
    return await ramDodge(ns, "SphyxOS/corp/divExist.js", false, [div]);
}

/** @param {NS} ns */
export async function main(ns) {}
