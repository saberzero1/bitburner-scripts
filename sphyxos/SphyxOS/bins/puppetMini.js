//Puppet2 by Sphyxis
import {
    getServers,
    getSrvr,
    getOptimalTarget,
    getHackP,
    weakenStr,
    getGrowThreads,
    doGetScriptRam,
} from "SphyxOS/util.js";
import {
    getHckTimeBasic,
    getIsRunning,
    getPlay,
    profitPerSecond,
    doGetServerCurSec,
    doGetServerMinSec,
} from "SphyxOS/util.js";
import {
    virus,
    serverPurchaser,
    serverRun,
    getPortOpeners,
    getServersLight,
    getServerAvailRam,
    maxRun,
    proxy,
} from "SphyxOS/util.js";
import {
    hashIt,
    getPortOpenersSing,
    hasBN,
    hacknetPurchaser,
    upgHomeRam,
    reservedRam,
    getHckTime,
    getBNMults,
    runIt,
    makeNewWindow,
} from "SphyxOS/util.js";
import { hackReady } from "SphyxOS/basic/hack.js";
import { growReady } from "SphyxOS/basic/grow.js";
import { weakenReady } from "SphyxOS/basic/weaken.js";
/** @type {Server[]} baseServers */
let baseServers;

//For the tail logs:
/** @type {Server} TARGET */
let TARGET = ""; //Who you are hacking
/** @type {Server} NEXTTARGET */
let NEXTTARGET = ""; //Whos next up
let TARGETUPDATE = false;
let ZERGSTATUS = false;
let ZERGSENT = 0;
let ZERGREQUIRED = -1;
let RECALC_GOOD = false;
let RECALC_BAD = false;
let PORTS_OPEN = 0;
let BMODE = "B"; //Batch mode:  b is not batching,  B is batching
let THREADSLEFT = 0; //Total threads used
let THREADSMAX = 0; //Total threads available
let BATCHESTOTAL = 0; //Total batches done
let BATCHESRUN = 0; //Actual batches run
let PREPW1 = 0; //Prep wave
let PREPG1 = 0;
let PREPW2 = 0;
let PREPH1 = 1;
let PREPW3 = 0;
let PREPG2 = 0;
let PREPW4 = 0;
let BATCHINFO;
let STARTTIME = 0;
let ENDTIME = 0;
let BETWEENSTART = 0;
let BETWEENEND = 0;
let HACKTIME = 0;
let WEAKENTIME = 0;
let USEHACKNET = false;
let PURCHASE = true;
let AUTOHASH = false;
let AUTOBUYHACKNET = false;
let MONEYMODE = true;
let XPMODE = true;
let STANEKMODE = false;
let LOGMODE = false;
let PADMODE = false;
const WIDTH = 540;
const HEIGHT = 300;
let win;
//Configuration
let lastpid = 0;
let weakenStrength = 1;
let mults;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    win = false;
    ns.clearPort(2);
    ns.writePort(2, ns.pid);
    ns.atExit(() => {
        ns.clearPort(2);
        ns.clearPort(3);
        ns.writePort(1, 1);
        if (win) win.close();
    });
    if (!hackReady || !growReady || !weakenReady) {
        ns.tprintf("Error with importing workers");
        ns.exit();
    }
    ns.ui.resizeTail(WIDTH, HEIGHT);
    mults = await getBNMults(ns);
    USEHACKNET = ns.args.includes("usehacknet");
    PURCHASE = !ns.args.includes("nopurchase");
    AUTOHASH = ns.args.includes("autohash");
    AUTOBUYHACKNET = ns.args.includes("autobuyhacknet");
    MONEYMODE = !ns.args.includes("nomoney");
    XPMODE = !ns.args.includes("noxp");
    STANEKMODE = ns.args.includes("stanek");
    LOGMODE = ns.args.includes("logging");
    PADMODE = ns.args.includes("pad");
    await getCommands(ns);
    await virus(ns);
    await init(ns);
    weakenStrength = await weakenStr(ns);
    /**@type {Player} player */
    let player = await getPlay(ns);
    //Is argument not null and is it a server?  We target it, otherwise find the best
    /*Arguments
     * ns.args[0] is target - if one is to be specified.  If no valid target is listed, it will get the best one.
     * nohacknet
     * nopurchase
     */
    const basicservers = await getServersLight(ns);
    if (ns.args[0] && basicservers.includes(ns.args[0]))
        TARGET = await getSrvr(ns, ns.args[0]);
    else if (player.skills.hacking < 10) TARGET = await getSrvr(ns, "n00dles");
    else TARGET = await getOptimalTarget(ns, true);
    NEXTTARGET = TARGET;

    //Get the batch info.  Contains: H1 W1 G1 W2 Type Take HackP
    BATCHINFO = await getHackP(ns, TARGET.hostname, -1, -1, 1);
    ns.clearPort(3);
    ns.writePort(3, TARGET.hostname); //emit our target/next target for Hash targets
    ns.writePort(1, 1);
    ns.clearPort(1);
    let spending = true;
    let new_ports_open = 0;
    PORTS_OPEN = 0;
    let overflowed = false;
    const SING = await hasBN(ns, 4, 2);
    const PORTOPENERRAM = await doGetScriptRam(
        ns,
        "SphyxOS/extras/getPortOpenersSing.js",
    );
    const UPGRAM = await doGetScriptRam(
        ns,
        "SphyxOS/singularity/upgradeHomeRam.js",
    );
    while (true) {
        await ns.sleep(4); //Let things catch up.
        TARGET = await getSrvr(ns, TARGET.hostname);
        //Calc wave
        const wavew1 = Math.ceil(
            (TARGET.hackDifficulty - TARGET.minDifficulty) / weakenStrength,
        );
        const waveg1 = Math.ceil(
            await getGrowThreads(
                ns,
                TARGET.hostname,
                TARGET.moneyAvailable,
                TARGET.minDifficulty,
            ),
        );

        //Refresh times.  Hack Time is the constant for that.  3.2x for Grow, 4x for Weaken
        HACKTIME = await getHckTimeBasic(ns, TARGET.hostname);
        WEAKENTIME = HACKTIME * 4;
        //Refresh base servers
        baseServers = await getServers(ns);
        //Get thread information
        THREADSLEFT = 0;
        let emergencyReserve =
            (await getServerAvailRam(ns, "home")) <= 16 ? true : false;
        const max = emergencyReserve ? await maxRun(ns, false, USEHACKNET) : 0;
        const resRam = !emergencyReserve
            ? 0
            : max >= 256
              ? 256
              : max >= 128
                ? 128
                : max >= 64
                  ? 64
                  : max >= 32
                    ? 32
                    : 16;
        for (const server of baseServers) {
            if (server.hostname.startsWith("hacknet") && !USEHACKNET) continue;
            if (server.hasAdminRights && server.maxRam > 0) {
                let tmpramavailable = await getServerAvailRam(
                    ns,
                    server.hostname,
                );
                if (emergencyReserve && tmpramavailable >= resRam) {
                    emergencyReserve = false;
                    tmpramavailable -= resRam;
                } //Reserve if home ram is 16GB or less
                if (server.hostname === "home")
                    tmpramavailable = Math.max(
                        tmpramavailable - reservedRam,
                        0,
                    );
                let tmpthreads = Math.floor(tmpramavailable / 1.75);
                THREADSLEFT += tmpthreads;
            }
        }
        THREADSMAX = THREADSLEFT;

        //Figure out how many threads to assign to the wave, and where they will go for best usage.
        //First weaken
        if (MONEYMODE) {
            if (wavew1 > THREADSLEFT) {
                //We need too many!
                PREPW1 = THREADSLEFT;
                THREADSLEFT = 0;
            } else {
                //Enough to fit
                PREPW1 = wavew1;
                THREADSLEFT -= PREPW1; //Could be as low as 0 now
            }

            // If we have threads left, move on to Grow/Weaken
            if (waveg1 > THREADSLEFT) {
                //We need more grow than we can handle
                PREPW2 = Math.ceil((THREADSLEFT * 0.004) / weakenStrength); //Figure out how many weaken threads we need to accomodate the highest
                PREPG1 = THREADSLEFT - PREPW2; //Fill in as many grows as can fit now
                THREADSLEFT = 0;
            } else {
                //We can handle the total grow threads, but can we handle it with weaken?
                PREPW2 = Math.ceil((waveg1 * 0.004) / weakenStrength); //total weakens we need for a full grow
                if (PREPW2 + waveg1 <= THREADSLEFT) {
                    //We have enough for both grow and weaken!
                    PREPG1 = waveg1;
                    THREADSLEFT -= PREPG1 + PREPW2; //Could be as low as 0 now
                } else {
                    //We don't have enough.  Calculate optimal
                    const growP = 0.004 / weakenStrength;
                    const remainder = waveg1 + PREPW2 - THREADSLEFT;
                    const weakremove = Math.floor(remainder * growP);
                    const growremove = remainder - weakremove;
                    PREPG1 = waveg1 - growremove;
                    PREPW2 -= weakremove;
                    THREADSLEFT = 0;
                }
            }

            //If we have threads left, move on to Hack/Weaken
            if (BATCHINFO.H1 > THREADSLEFT) {
                //We don't have enough to fully hack!
                PREPW3 = Math.ceil((THREADSLEFT * 0.002) / weakenStrength);
                PREPH1 = THREADSLEFT - PREPW3;
                THREADSLEFT = 0;
            } else {
                //We can handle the total hack threads, but what about the weakens it produces?
                PREPW3 = Math.ceil((BATCHINFO.H1 * 0.002) / weakenStrength);
                if (PREPW3 + BATCHINFO.H1 <= THREADSLEFT) {
                    //We have enough for both hack and weaken
                    PREPH1 = BATCHINFO.H1;
                    THREADSLEFT -= PREPH1 + PREPW3;
                } else {
                    //We don'thave enough.  Calculate optimal
                    const hackP = 0.002 / weakenStrength;
                    const remainder = BATCHINFO.H1 + PREPW3 - THREADSLEFT;
                    const weakenremove = Math.ceil(remainder * hackP);
                    const hackremove = remainder - weakenremove;
                    PREPH1 = BATCHINFO.H1 - hackremove;
                    PREPW3 -= weakenremove;
                    THREADSLEFT = 0;
                }
            }

            // If we have threads left, move on to Grow/Weaken
            if (BATCHINFO.G1 > THREADSLEFT) {
                //We need more grow than we can handle
                PREPW4 = Math.ceil((THREADSLEFT * 0.004) / weakenStrength); //Figure out how many weaken threads we need to accomodate the highest
                PREPG2 = THREADSLEFT - PREPW4; //Fill in as many grows as can fit now
                THREADSLEFT = 0;
            } else {
                //We can handle the total grow threads, but can we handle it with weaken?
                PREPW4 = Math.ceil((BATCHINFO.G1 * 0.004) / weakenStrength); //total weakens we need for a full grow
                if (PREPW4 + BATCHINFO.G1 <= THREADSLEFT) {
                    //We have enough for both grow and weaken!
                    PREPG2 = BATCHINFO.G1;
                    THREADSLEFT -= PREPG2 + PREPW4; //Could be as low as 0 now
                } else {
                    //We don't have enough.  Calculate optimal
                    const growP = 0.004 / weakenStrength;
                    const remainder = BATCHINFO.G1 + PREPW4 - THREADSLEFT;
                    const weakremove = Math.floor(remainder * growP);
                    const growremove = remainder - weakremove;
                    PREPG2 = BATCHINFO.G1 - growremove;
                    PREPW4 -= weakremove;
                    THREADSLEFT = 0;
                }
            }
            BATCHESTOTAL = Math.floor(
                THREADSLEFT /
                    (BATCHINFO.H1 + BATCHINFO.W1 + BATCHINFO.G1 + BATCHINFO.W2),
            );
            if (ZERGSTATUS && ZERGREQUIRED !== ZERGSENT && BATCHESTOTAL > 3)
                BATCHESTOTAL = Math.max(
                    Math.max(
                        Math.floor((BATCHESTOTAL * 4) / 5),
                        BATCHESTOTAL - 50,
                    ),
                    0,
                ); //Reserve a few batches to send as zerglings
        }
        BETWEENEND = performance.now();
        STARTTIME = performance.now();
        //Start it all and get the results
        let results;
        if (MONEYMODE) {
            await ns.asleep(4);
            results = await serverRun(
                ns,
                LOGMODE,
                TARGET.hostname,
                PREPW1,
                PREPG1,
                PREPW2,
                PREPH1,
                PREPW3,
                PREPG2,
                PREPW4,
                BATCHINFO.H1,
                BATCHINFO.W1,
                BATCHINFO.G1,
                BATCHINFO.W2,
                BATCHESTOTAL,
                USEHACKNET,
            );
            THREADSLEFT -=
                (BATCHINFO.H1 + BATCHINFO.W1 + BATCHINFO.G1 + BATCHINFO.W2) *
                results.batches;
        }

        if (
            MONEYMODE &&
            ZERGSTATUS &&
            THREADSLEFT > 0 &&
            ZERGREQUIRED !== ZERGSENT &&
            BATCHESTOTAL > 2
        ) {
            await ns.asleep(4);
            await zerglings(ns, THREADSLEFT); //If zerg is on, send the lings!
        }
        let xpResults;
        if (XPMODE) {
            await ns.asleep(4);
            xpResults = await generateXP(ns, THREADSLEFT, player);
            THREADSLEFT = 0;
        }
        ENDTIME = performance.now();
        if (MONEYMODE) {
            lastpid = results.lastpid;
            RECALC_BAD = results.recalc;
            BATCHESRUN = results.batches;
            BMODE = results.batching ? "B" : "b";
        } else {
            lastpid = xpResults[0].lastpid;
            RECALC_BAD = false;
            BATCHESRUN = 1;
            BMODE = "B";
            WEAKENTIME = xpResults[1];
            BMODE = "XP";
        }
        //Now that we have the next batch ready, we wait...
        if (!lastpid) {
            BMODE = "WAITING FOR RAM";
            await ns.sleep(1000);
        } else {
            while (await getIsRunning(ns, lastpid)) {
                update_hud(ns);
                await ns.sleep(20);
                await getCommands(ns);
            }
        }

        update_hud(ns);
        await ns.sleep(4);
        await getCommands(ns);

        //If our hacking has gone up, recalculate
        const maxRam = await maxRun(ns, false);
        const homeRam = await getServerAvailRam(ns, "home");
        if (SING && homeRam < reservedRam && maxRam > UPGRAM)
            await upgHomeRam(ns);
        if (PORTS_OPEN < 5)
            new_ports_open =
                SING && PORTOPENERRAM <= maxRam
                    ? await getPortOpenersSing(ns)
                    : await getPortOpeners(ns);
        if (PURCHASE && spending)
            if (!(await serverPurchaser(ns))) spending = false;
        if (AUTOHASH) {
            await hashIt(ns, "max");
            await hashIt(ns, "min");
        }
        if (AUTOBUYHACKNET) {
            if (!(await hacknetPurchaser(ns))) {
                AUTOBUYHACKNET = false;
                ns.writePort(1, "puppet hacknet off");
            }
        }
        //Charge Stanek here
        if (STANEKMODE && lastpid) {
            const stanekPid = await runIt(
                ns,
                "SphyxOS/stanek/startCharge.js",
                true,
                ["quiet"],
            );
            BMODE = "Stanek";
            const frags = await proxy(ns, "stanek.activeFragments");
            const numFrags = frags.reduce(
                (val, a) => (a.id < 100 ? (val += 1) : (val = val)),
                0,
            );
            BATCHINFO.Type = "Charging " + numFrags + " Stanek pieces";
            WEAKENTIME += (numFrags + 1) * 1000;
            while (await getIsRunning(ns, stanekPid)) {
                update_hud(ns);
                await ns.sleep(20);
                await getCommands(ns);
            }
        }
        BETWEENSTART = performance.now();
        let portsChanged = false;
        if (PORTS_OPEN !== new_ports_open) {
            PORTS_OPEN = new_ports_open;
            await virus(ns);
            portsChanged = true;
        }
        /**@type {Player} player2 */
        const player2 = await getPlay(ns);
        if (
            (player2.skills.hacking > player.skills.hacking + 10 &&
                BATCHESTOTAL >= 2 &&
                MONEYMODE) ||
            (BATCHESTOTAL >= 2 && portsChanged && MONEYMODE)
        ) {
            player = player2;
            RECALC_GOOD = true;
            TARGETUPDATE = true;
        }

        if (NEXTTARGET.hostname === TARGET.hostname && TARGETUPDATE) {
            //Nexttarget is target.  We are open for a new target
            /**@type {Server} upcoming */
            const upcoming = await getOptimalTarget(ns);
            if (upcoming && upcoming.hostname !== TARGET.hostname) {
                //We have an up and commer that's better.  Start zerglings
                NEXTTARGET = upcoming;
                ZERGSTATUS = true;
            }
            TARGETUPDATE = false;
        } else if (
            NEXTTARGET.hostname !== TARGET.hostname &&
            (await doGetServerCurSec(ns, NEXTTARGET.hostname)) ===
                (await doGetServerMinSec(ns, NEXTTARGET.hostname))
        ) {
            //Ready for the change over
            TARGET = NEXTTARGET;
            ZERGSTATUS = false;
            ZERGSENT = 0;
            ZERGREQUIRED = -1;
            RECALC_BAD = false;
            RECALC_GOOD = false;
            overflowed = false;
            //Get the batch info.  Contains: H1 W1 G1 W2 Type Take HackP
            BATCHINFO = await getHackP(ns, TARGET.hostname, -1, -1, 1);
            TARGETUPDATE = true;
        }
        ns.clearPort(3);
        ns.writePort(3, TARGET.hostname); //emit our target/next target for Hash targets

        if (RECALC_BAD) {
            BATCHINFO = await getHackP(
                ns,
                TARGET.hostname,
                BATCHESRUN,
                THREADSMAX,
                BATCHINFO.H1,
            );
            RECALC_BAD = false;
            overflowed = true;
        } else if (RECALC_GOOD && !overflowed) {
            BATCHINFO = await getHackP(ns, TARGET.hostname, -1, -1, 1);
            RECALC_GOOD = false;
        } else
            BATCHINFO = await getHackP(
                ns,
                TARGET.hostname,
                -1,
                -1,
                Math.max(BATCHINFO.H1 - 1, 1),
            );
        if (PADMODE) {
            BATCHINFO.G1 += Math.ceil(BATCHINFO.G1 * 0.15);
            BATCHINFO.W2 = Math.ceil(
                (BATCHINFO.G1 * 0.004 +
                    Math.max(
                        (BATCHINFO.H1 * 0.002) / weakenStrength -
                            BATCHINFO.W1 * weakenStrength,
                        0,
                    )) /
                    weakenStrength,
            );
        }
    } //while (true) loop
}

/** @param {NS} ns */
function update_hud(ns) {
    ns.clearLog();
    ns.printf("%s[%s] - (%s)", TARGET.hostname, BMODE, BATCHINFO.Type);
    ns.printf(
        "%s%s%s%s%s%s%s%s%s",
        MONEYMODE ? "Money " : "",
        XPMODE ? "XP " : "",
        PURCHASE ? "BuyServers " : "",
        STANEKMODE ? "Stanek " : "",
        USEHACKNET ? "UseHacknet " : "",
        AUTOBUYHACKNET ? "BuyHacknet" : "",
        AUTOHASH ? "AutoHash" : "",
        PADMODE ? "Padding" : "",
        LOGMODE ? "Logging" : "",
    );
    if (TARGET.hostname !== NEXTTARGET.hostname)
        ns.printf(
            "Next: %s  Zerglings: %s/%s",
            NEXTTARGET.hostname,
            ZERGSENT,
            ZERGREQUIRED === -1 ? "Waiting" : ZERGREQUIRED,
        );
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        ns.printf(
            "%s/%s(%s) Batches: %s  Take: $%s",
            THREADSMAX - THREADSLEFT,
            THREADSMAX,
            THREADSLEFT,
            BATCHESRUN + 1,
            ns.format.number(
                (BATCHINFO.Take * (BATCHESRUN + 1) * PREPH1) / BATCHINFO.H1,
            ),
        );
        ns.printf(
            "HackP: %s%s ($%s/each)  Chance: %s%s",
            Math.round(BATCHINFO.HackP * 10000 * PREPH1) / 100,
            "%",
            ns.format.number((BATCHINFO.Take * PREPH1) / BATCHINFO.H1),
            ns.format.number(BATCHINFO.Chance * 100, 2),
            "%",
        );
        ns.printf(
            "Prep Wave: W:%s G:%s W:%s H:%s W:%s G:%s W:%s",
            PREPW1,
            PREPG1,
            PREPW2,
            PREPH1,
            PREPW3,
            PREPG2,
            PREPW4,
        );
        ns.printf(
            "Batching Composition: H:%s W:%s G:%s W:%s",
            BATCHINFO.H1,
            BATCHINFO.W1,
            BATCHINFO.G1,
            BATCHINFO.W2,
        );
        ns.printf(
            "%s  Countdown: %s",
            "$" +
                profitPerSecond(
                    ns,
                    WEAKENTIME,
                    (BATCHINFO.Take * BATCHINFO.H1) / PREPH1,
                    BATCHESRUN + 1,
                ),
            ns.format.time(WEAKENTIME + ENDTIME - performance.now()),
        );
        ns.printf(
            "Preptime : %s",
            ns.format.time(BETWEENEND - BETWEENSTART, true),
        );
        ns.printf("Loadtime : %s", ns.format.time(ENDTIME - STARTTIME, true));
        ns.printf("Batchtime: %s", ns.format.time(WEAKENTIME, true));
    } else {
        ns.printf(
            "%s/%s(%s) Batches: %s  Take: $%s",
            THREADSMAX - THREADSLEFT,
            THREADSMAX,
            THREADSLEFT,
            BATCHESRUN + 1,
            ns.formatNumber(
                (BATCHINFO.Take * (BATCHESRUN + 1) * PREPH1) / BATCHINFO.H1,
            ),
        );
        ns.printf(
            "HackP: %s%s ($%s/each)  Chance: %s%s",
            Math.round(BATCHINFO.HackP * 10000 * PREPH1) / 100,
            "%",
            ns.formatNumber((BATCHINFO.Take * PREPH1) / BATCHINFO.H1),
            ns.formatNumber(BATCHINFO.Chance * 100, 2),
            "%",
        );
        ns.printf(
            "Prep Wave: W:%s G:%s W:%s H:%s W:%s G:%s W:%s",
            PREPW1,
            PREPG1,
            PREPW2,
            PREPH1,
            PREPW3,
            PREPG2,
            PREPW4,
        );
        ns.printf(
            "Batching Composition: H:%s W:%s G:%s W:%s",
            BATCHINFO.H1,
            BATCHINFO.W1,
            BATCHINFO.G1,
            BATCHINFO.W2,
        );
        ns.printf(
            "%s  Countdown: %s",
            "$" +
                profitPerSecond(
                    ns,
                    WEAKENTIME,
                    (BATCHINFO.Take * BATCHINFO.H1) / PREPH1,
                    BATCHESRUN + 1,
                ),
            ns.tFormat(WEAKENTIME + ENDTIME - performance.now()),
        );
        ns.printf("Preptime : %s", ns.tFormat(BETWEENEND - BETWEENSTART, true));
        ns.printf("Loadtime : %s", ns.tFormat(ENDTIME - STARTTIME, true));
        ns.printf("Batchtime: %s", ns.tFormat(WEAKENTIME, true));
    }
    if (win && win.closed) {
        win = false;
        ns.writePort(1, "puppet popout off");
    }
    if (win) {
        win.clear();
        win.update(
            ns.sprintf("%s[%s] - (%s)", TARGET.hostname, BMODE, BATCHINFO.Type),
        );
        win.update(
            ns.sprintf(
                "%s%s%s%s%s%s%s",
                MONEYMODE ? "Money " : "",
                XPMODE ? "XP " : "",
                PURCHASE ? "BuyServers " : "",
                STANEKMODE ? "Stanek " : "",
                USEHACKNET ? "UseHacknet " : "",
                AUTOBUYHACKNET ? "BuyHacknet" : "",
                AUTOHASH ? "BuyHashes" : "",
            ),
        );
        if (TARGET.hostname !== NEXTTARGET.hostname)
            win.update(
                ns.sprintf(
                    "Next: %s  Zerglings: %s/%s",
                    NEXTTARGET.hostname,
                    ZERGSENT,
                    ZERGREQUIRED === -1 ? "Waiting" : ZERGREQUIRED,
                ),
            );
        if (ns.ui.getGameInfo()?.versionNumber >= 44) {
            win.update(
                ns.sprintf(
                    "%s/%s(%s) Batches: %s  Take: $%s",
                    THREADSMAX - THREADSLEFT,
                    THREADSMAX,
                    THREADSLEFT,
                    BATCHESRUN + 1,
                    ns.format.number(
                        (BATCHINFO.Take * (BATCHESRUN + 1) * PREPH1) /
                            BATCHINFO.H1,
                    ),
                ),
            );
            win.update(
                ns.sprintf(
                    "HackP: %s%s ($%s/each)  Chance: %s%s",
                    Math.round(BATCHINFO.HackP * 10000 * PREPH1) / 100,
                    "%",
                    ns.format.number((BATCHINFO.Take * PREPH1) / BATCHINFO.H1),
                    ns.format.number(BATCHINFO.Chance * 100, 2),
                    "%",
                ),
            );
            win.update(
                ns.sprintf(
                    "Prep Wave: W:%s G:%s W:%s H:%s W:%s G:%s W:%s",
                    PREPW1,
                    PREPG1,
                    PREPW2,
                    PREPH1,
                    PREPW3,
                    PREPG2,
                    PREPW4,
                ),
            );
            win.update(
                ns.sprintf(
                    "Batching Composition: H:%s W:%s G:%s W:%s",
                    BATCHINFO.H1,
                    BATCHINFO.W1,
                    BATCHINFO.G1,
                    BATCHINFO.W2,
                ),
            );
            win.update(
                ns.sprintf(
                    "%s  Countdown: %s",
                    "$" +
                        profitPerSecond(
                            ns,
                            WEAKENTIME,
                            (BATCHINFO.Take * BATCHINFO.H1) / PREPH1,
                            BATCHESRUN + 1,
                        ),
                    ns.format.time(WEAKENTIME + ENDTIME - performance.now()),
                ),
            );
            win.update(
                ns.sprintf(
                    "Preptime : %s",
                    ns.format.time(BETWEENEND - BETWEENSTART, true),
                ),
            );
            win.update(
                ns.sprintf(
                    "Loadtime : %s",
                    ns.format.time(ENDTIME - STARTTIME, true),
                ),
            );
            win.update(
                ns.sprintf("Batchtime: %s", ns.format.time(WEAKENTIME, true)),
            );
        } else {
            win.update(
                ns.sprintf(
                    "%s/%s(%s) Batches: %s  Take: $%s",
                    THREADSMAX - THREADSLEFT,
                    THREADSMAX,
                    THREADSLEFT,
                    BATCHESRUN + 1,
                    ns.formatNumber(
                        (BATCHINFO.Take * (BATCHESRUN + 1) * PREPH1) /
                            BATCHINFO.H1,
                    ),
                ),
            );
            win.update(
                ns.sprintf(
                    "HackP: %s%s ($%s/each)  Chance: %s%s",
                    Math.round(BATCHINFO.HackP * 10000 * PREPH1) / 100,
                    "%",
                    ns.formatNumber((BATCHINFO.Take * PREPH1) / BATCHINFO.H1),
                    ns.formatNumber(BATCHINFO.Chance * 100, 2),
                    "%",
                ),
            );
            win.update(
                ns.sprintf(
                    "Prep Wave: W:%s G:%s W:%s H:%s W:%s G:%s W:%s",
                    PREPW1,
                    PREPG1,
                    PREPW2,
                    PREPH1,
                    PREPW3,
                    PREPG2,
                    PREPW4,
                ),
            );
            win.update(
                ns.sprintf(
                    "Batching Composition: H:%s W:%s G:%s W:%s",
                    BATCHINFO.H1,
                    BATCHINFO.W1,
                    BATCHINFO.G1,
                    BATCHINFO.W2,
                ),
            );
            win.update(
                ns.sprintf(
                    "%s  Countdown: %s",
                    "$" +
                        profitPerSecond(
                            ns,
                            WEAKENTIME,
                            (BATCHINFO.Take * BATCHINFO.H1) / PREPH1,
                            BATCHESRUN + 1,
                        ),
                    ns.tFormat(WEAKENTIME + ENDTIME - performance.now()),
                ),
            );
            win.update(
                ns.sprintf(
                    "Preptime : %s",
                    ns.tFormat(BETWEENEND - BETWEENSTART, true),
                ),
            );
            win.update(
                ns.sprintf(
                    "Loadtime : %s",
                    ns.tFormat(ENDTIME - STARTTIME, true),
                ),
            );
            win.update(
                ns.sprintf("Batchtime: %s", ns.tFormat(WEAKENTIME, true)),
            );
        }
    }
}

/** @param {NS} ns */
async function zerglings(ns, threads) {
    if (ZERGREQUIRED <= 0)
        ZERGREQUIRED =
            Math.ceil(
                (NEXTTARGET.hackDifficulty - NEXTTARGET.minDifficulty) /
                    weakenStrength,
            ) + 1;
    if (ZERGSENT >= ZERGREQUIRED || threads === 0) return;
    const weakthreadsneeded =
        Math.ceil(
            (NEXTTARGET.hackDifficulty - NEXTTARGET.minDifficulty) /
                weakenStrength,
        ) +
        1 -
        ZERGSENT;
    const threadsthisround =
        weakthreadsneeded >= threads ? threads : weakthreadsneeded;

    if (threadsthisround > 0) {
        //We are sending zerglings
        ZERGSENT += threadsthisround;
        THREADSLEFT -= threadsthisround;
        await serverRun(
            ns,
            LOGMODE,
            NEXTTARGET.hostname,
            threadsthisround,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            USEHACKNET,
        );
    }
}
/** @param {NS} ns */
async function generateXP(ns, threads, player) {
    if (threads === 0) return [false, 0];
    const servers = await getServersLight(ns);
    let bestServer = "";
    let bestTime = Infinity;
    let bestXPRatio = 0;
    for (const server of servers) {
        const sObj = await getSrvr(ns, server);
        if (
            !sObj.hasAdminRights ||
            sObj.hostname === "home" ||
            sObj.moneyMax === 0 ||
            sObj.purchasedByPlayer ||
            sObj.minDifficulty <= 1
        )
            continue;
        const time = await getHckTime(ns, server, sObj.minDifficulty);
        if (xpGain(player, sObj) / time > bestXPRatio) {
            bestServer = server;
            bestTime = time;
            bestXPRatio = xpGain(player, sObj) / time;
        }
    }
    const sObj = await getSrvr(ns, bestServer);
    bestTime = await getHckTimeBasic(ns, bestServer);
    let wavew1 = Math.ceil(
        (sObj.hackDifficulty - sObj.minDifficulty) / weakenStrength,
    );
    let waveg1 = Math.ceil(
        await getGrowThreads(
            ns,
            bestServer,
            sObj.moneyAvailable,
            sObj.minDifficulty,
        ),
    );
    let wavew2 = 0;
    if (wavew1 > threads) {
        //We need too many!
        wavew1 = threads;
        threads = 0;
    } else {
        //Enough to fit
        threads -= wavew1; //Could be as low as 0 now
    }

    // If we have threads left, move on to Grow/Weaken
    if (waveg1 > threads) {
        //We need more grow than we can handle
        wavew2 = Math.ceil((threads * 0.004) / weakenStrength); //Figure out how many weaken threads we need to accomodate the highest
        waveg1 = threads - wavew2; //Fill in as many grows as can fit now
        threads = 0;
    } else {
        //We can handle the total grow threads, but can we handle it with weaken?
        wavew2 = Math.ceil((waveg1 * 0.004) / weakenStrength); //total weakens we need for a full grow
        if (wavew2 + waveg1 <= threads) {
            //We have enough for both grow and weaken!
            threads -= waveg1 + wavew2; //Could be as low as 0 now
        } else {
            //We don't have enough.  Calculate optimal
            const growP = 0.004 / weakenStrength;

            //const remainder = waveg1 + wavew2 - threads //Threads left after
            const weakremove = Math.ceil(threads * growP); //Weakens needed
            const growremove = threads - weakremove;
            waveg1 = growremove;
            wavew2 = weakremove;
            threads = 0;
        }
    }
    const result = await serverRun(
        ns,
        LOGMODE,
        bestServer,
        wavew1,
        waveg1,
        wavew2,
        0,
        0,
        threads,
        0,
        0,
        0,
        0,
        0,
        0,
        USEHACKNET,
    );
    THREADSLEFT = 0;
    const time = wavew1 + wavew2 > 0 ? bestTime * 4 : bestTime * 3.2;
    return [result, time];
}
/** @param {NS} ns */
async function getCommands(ns) {
    let silent = false;
    while (ns.peek(12) !== "NULL PORT DATA") {
        //1-4  1: noHacknet, 2: !noHacknet, 3: buyServers, 4: !buyServers
        let result = ns.readPort(12);
        switch (result) {
            case "popout":
                win = await makeNewWindow("Batcher", ns.ui.getTheme());
                if (!silent)
                    ns.tprintf("Command received.  Puppet will use a popout");
                break;
            case "nopopout":
                if (win) win.close();
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not use a popout",
                    );
                break;
            case "silent":
                silent = true;
                break;
            case "nohacknet":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not use Hacknet nodes now",
                    );
                USEHACKNET = false;
                break;
            case "hacknet":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will use Hacknet nodes now",
                    );
                USEHACKNET = true;
                break;
            case "purchaseservers":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will purchase servers",
                    );
                PURCHASE = true;
                break;
            case "nopurchaseservers":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not purchase servers",
                    );
                PURCHASE = false;
                break;
            case "autohash":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will automatically spend hashes",
                    );
                AUTOHASH = true;
                break;
            case "autobuyhacknet":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will automatically buy hacknet servers",
                    );
                AUTOBUYHACKNET = true;
                break;
            case "noautobuyhacknet":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not buy hacknet servers",
                    );
                AUTOBUYHACKNET = false;
                break;
            case "noautohash":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not automatically spend hashes",
                    );
                AUTOHASH = false;
                break;
            case "money":
                if (!silent)
                    ns.tprintf("Command received.  Puppet will generate money");
                MONEYMODE = true;
                break;
            case "nomoney":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not generate money",
                    );
                MONEYMODE = false;
                break;
            case "xp":
                if (!silent)
                    ns.tprintf("Command received.  Puppet will generate xp");
                XPMODE = true;
                break;
            case "noxp":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not generate xp",
                    );
                XPMODE = false;
                break;
            case "stanek":
                if (!silent)
                    ns.tprintf("Command received.  Puppet will charge Stanek");
                STANEKMODE = true;
                break;
            case "nostanek":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not charge Stanek",
                    );
                STANEKMODE = false;
                break;
            case "log":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will generate error logs",
                    );
                LOGMODE = true;
                break;
            case "nolog":
                if (!silent)
                    ns.tprintf(
                        "Command received.  Puppet will not generate error logs",
                    );
                LOGMODE = false;
                break;
            case "pad":
                if (!silent)
                    ns.tprintf("Command received.  Puppet will pad grows");
                PADMODE = true;
                break;
            case "nopad":
                if (!silent)
                    ns.tprintf("Command received.  Puppet will not pad grows");
                PADMODE = false;
                break;
            default:
                ns.tprintf(
                    "Invalid command received in puppetMini: %s",
                    result,
                );
                break;
        }
    }
}

/** @param {NS} ns */
async function init(ns) {
    baseServers = await getServers(ns);
    TARGET = ""; //Who you are hacking
    NEXTTARGET = ""; //Whos next up
    TARGETUPDATE = false;
    ZERGSTATUS = false;
    ZERGSENT = 0;
    ZERGREQUIRED = -1;
    RECALC_GOOD = false;
    RECALC_BAD = false;
    PORTS_OPEN = await getPortOpeners(ns);
    BMODE = "B"; //Batching style.  b is not batching, B is batching
    THREADSMAX = 0; //Total threads available
    BATCHESTOTAL = 0; //Total batches done
    BATCHESRUN = 0; //Total batches actually run
    PREPW1 = 0; //Prep wave
    PREPG1 = 0;
    PREPW2 = 0;
    PREPH1 = 1;
    PREPW3 = 0;
    PREPG2 = 0;
    PREPW4 = 0;
    STARTTIME = 0;
    ENDTIME = 0;
    BETWEENSTART = performance.now();
    BETWEENEND = 0;
    WEAKENTIME = 0;
}
function xpGain(person, server) {
    const baseDifficulty = server.baseDifficulty;
    if (!baseDifficulty) return 0;
    const baseExpGain = 3;
    const diffFactor = 0.3;
    let expGain = baseExpGain;
    expGain += baseDifficulty * diffFactor;
    return expGain * person.mults.hacking_exp * mults.HackExpGain;
}
