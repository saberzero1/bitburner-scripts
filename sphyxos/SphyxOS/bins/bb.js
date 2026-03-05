import {
    hasBN,
    getPlay,
    getBNMults,
    getResetInf,
    doGetScriptRam,
    getServerAvailRam,
    maxRun,
} from "SphyxOS/util.js";
import {
    doCrime,
    stopAct,
    getWork,
    travelCity,
    setGym,
    getOwnedSF,
    destroyWD,
    upgHomeRam,
} from "SphyxOS/util.js";
import {
    sleeveGetNum,
    sleeveGet,
    sleeveShockRecovery,
    sleeveIdle,
    sleeveSetToBBAction,
    sleeveGetAugs,
} from "SphyxOS/util.js";
import {
    bbJoinBBDiv,
    bbJoinBBFac,
    bbGetStam,
    bbGetCity,
    bbGetCityChaos,
    bbGetActionEstSuccessChance,
    bbGetSkillPoints,
} from "SphyxOS/util.js";
import {
    bbSetActionAutoLvl,
    bbGetSkillLevel,
    bbGetActionMaxLvl,
    bbGetActionCountRemain,
    bbGetCurrentAction,
    bbUpgradeSkill,
} from "SphyxOS/util.js";
import {
    bbGetSkillUpgradeCost,
    bbSwitchCity,
    bbSetActionLevel,
    bbGetActionTime,
    bbStartAction,
    bbGetActionCurTime,
    bbGetRank,
} from "SphyxOS/util.js";
import {
    bbGetCityEstPop,
    bbGetCityComms,
    bbGetActionRepGain,
    bbGetBlackOpRank,
    bbGetActionCurLvl,
    makeNewWindow,
    proxy,
    proxyTry,
} from "SphyxOS/util.js";
import { reservedRam } from "SphyxOS/util.js";

const STARTUP_SCRIPT = "SphyxOS/bladeBurner/restart.js";
let FINISHER = false;
let INTMODE = false;
let LVLUP = 1;
let SLEEVEINFILSTATUS = false;
let SLEEVES_ENABLED = false;
let HASBN4 = false;
const HEIGHT = 710;
const WIDTH = 760;
const CSTATS = 100;
const TRAIN_STATS = 110;
const SLEEVE_STATS = 5;
const TRAIN_STAMINA = 50;
const CHAOS_TOP = 60;
const CHAOS_FLOOR = 55;
const BOPS_SUCCESS_TRY = 0.8;
const MIN_CHANCE_SUCCESS = 0.85;
const SLEEVE_SHOCK = 98;
const SLEEVE_CHANCE = 0.85;
let PRIORITY_CITY = false;
let sleeve_infil = false;
let sleeve_analyze = false;
let sleeve_bounty = false;
let sleeve_retire = false;
let sleeve_tracking = false;
let sleeve_diplomacy = false;
let sleeve_working = 0;
const queues = [];
let queuestask = [null, null, null, null];
let queueswait = 0;
let endItCost;
let win;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    win = false;
    ns.atExit(() => {
        ns.clearPort(8);
        ns.writePort(1, 1);
        if (win) win.close();
    });
    ns.clearPort(8);
    ns.writePort(8, ns.pid);
    ns.writePort(1, true);

    await getCommands(ns);
    await init(ns);

    //Are we already in or do we have the stats for it?
    let joined = await bbJoinBBDiv(ns);
    while (!joined) {
        joined = await bbJoinBBDiv(ns);
        await trainUp(ns);
        await ns.sleep(1000);
    }
    if (
        HASBN4 &&
        (await hasBN(ns, 7, 3)) &&
        (await maxRun(ns, false)) >=
            (await doGetScriptRam(ns, "SphyxOS/singularity/commitCrime.js"))
    )
        await doCrime(ns, "Mug");
    ns.ui.resizeTail(WIDTH, HEIGHT);
    for (const contract of ns.bladeburner.getContractNames())
        await bbSetActionAutoLvl(ns, "Contracts", contract, false);
    for (const op of ns.bladeburner.getOperationNames())
        await bbSetActionAutoLvl(ns, "Operations", op, false);
    const joinBBFacCost = await doGetScriptRam(
        ns,
        "SphyxOS/bladeBurner/joinBBFac.js",
    );

    while (true) {
        //Main loop
        await getCommands(ns);
        const maxRam = await maxRun(ns, false);
        if (HASBN4) await endIt(ns);
        if (maxRam >= joinBBFacCost) await bbJoinBBFac(ns);
        await ns.asleep(0);
        await updatedisplay(ns);
        ns.ui.renderTail();
        await ns.bladeburner.nextUpdate();
        await updateskills(ns);
        await ns.asleep(0);
        if (SLEEVES_ENABLED) await updatesleeves(ns);
        await ns.asleep(0);
        if (queueswait > performance.now()) continue; //Trap inside the start of the loop until our job is done
        if (queues.length > 0) {
            //We have a queued command
            await runmission(ns, queues.shift());
            continue;
        }
        const chaos = await checkChaos(ns);
        if (chaos) {
            queue("General", "Diplomacy", chaos, 1);
            continue;
        }
        const stamina = await bbGetStam(ns);
        const city = await bbGetCity(ns);
        const trainStats = await getTrainStats(ns);
        if (trainStats < TRAIN_STATS || stamina[1] < TRAIN_STAMINA) {
            queue("General", "Training", city, 1);
            continue;
        }
        if (stamina[0] / stamina[1] < 0.55) {
            queue("General", "Hyperbolic Regeneration Chamber", city, 1);
            queue("General", "Training", city, 1);
            continue;
        }
        let diff = 0.15;
        if (SLEEVES_ENABLED) diff = 0;
        const tracking = await checkTracking(ns, diff);
        if (tracking) {
            const bestAna = await getBestAnalysisMission(ns, tracking);
            queue(bestAna[0], bestAna[1], bestAna[2], bestAna[3]);
            continue;
        }
        const best = await getBestMission(ns); // Get the best mission.  null means there are none
        if (best === null) {
            queue("General", "Training", city, 1);
            continue;
        } else {
            queue(best[0], best[1], best[2], best[3]);
            continue;
        }
    }
} //End of main
/** @param {NS} ns */
async function updatesleeves(ns) {
    let s = ns.sleeve;

    // get our sleeve ratings
    const isleeves = [];
    const slvnum = await sleeveGetNum(ns);
    for (let islv = 0; islv < slvnum; islv++) {
        const slv = await sleeveGet(ns, islv);
        let record = {
            Sleeve: islv,
            Power: getslvpower(slv),
            Cycles: slv.storedCycles,
            Person: slv,
        };
        isleeves.push(record);
        if (slv.shock > SLEEVE_SHOCK) {
            await sleeveShockRecovery(ns, islv);
        } else if (ns.sleeve.getTask(islv)?.type === "RECOVERY") {
            await sleeveIdle(ns, islv);
        }
    }
    isleeves.sort((a, b) => {
        return b.Cycles - a.Cycles;
    }); //Lowest first so we cycle

    if (SLEEVEINFILSTATUS) {
        const bestslv = isleeves.shift();
        if (!sleeve_infil && s.getTask(bestslv.Sleeve) === null) {
            await sleeveSetToBBAction(
                ns,
                bestslv.Sleeve,
                "Infiltrate Synthoids",
            );
            if (bestslv.Cycles > s.getTask(bestslv.Sleeve).cyclesNeeded) {
                sleeve_infil = true;
                s.getTask(bestslv.Sleeve).nextCompletion.then(() => {
                    sleeve_infil = false;
                    sleeveIdle(ns, bestslv.Sleeve).then();
                });
            } else await sleeveIdle(ns, bestslv.Sleeve);
        }
    } else {
        //We are assigning all sleeves to their respective tasks
        const city = await bbGetCity(ns);
        const cityChaos = await bbGetCityChaos(ns, city);
        let diff = 0.15;
        if (SLEEVES_ENABLED) diff = 0;
        const analyze = await cityneedsanalysis(ns, city, diff);
        const stamina = await bbGetStam(ns);
        const stamPerc = stamina[0] / stamina[1];
        const maxHome = await getServerAvailRam(ns, "home");
        const maxRam = maxHome <= 16 ? await maxRun(ns, false, true) : maxHome;
        const idleCost = await doGetScriptRam(
            ns,
            "SphyxOS/sleeves/setToIdle.js",
        );
        const maxWork = Math.min(
            Math.max(1, Math.floor(maxRam / (idleCost * 3))),
            slvnum,
        );
        for (const me of isleeves) {
            let trainSlv = false;
            if (s.getTask(me.Sleeve) !== null) {
                continue; //Our sleeve is working...
            }
            if (
                me.Power < SLEEVE_STATS &&
                stamPerc > 0.55 &&
                sleeve_working < maxWork
            ) {
                await sleeveSetToBBAction(ns, me.Sleeve, "Training");
                if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                    sleeve_working++;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeveIdle(ns, me.Sleeve).then();
                        sleeve_working--;
                    });
                    continue;
                } else {
                    await sleeveIdle(ns, me.Sleeve);
                    continue; // Save up for training.  Move on to the next
                }
            }
            if (
                me.Person.hp.current + 2 <= me.Person.hp.max &&
                sleeve_working < maxWork
            ) {
                await sleeveSetToBBAction(
                    ns,
                    me.Sleeve,
                    "Hyperbolic Regeneration Chamber",
                );
                if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                    sleeve_working++;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeveIdle(ns, me.Sleeve).then();
                        sleeve_working--;
                    });
                    continue;
                } else await sleeveIdle(ns, me.Sleeve);
                continue;
            }
            if (!sleeve_analyze && analyze && sleeve_working < maxWork) {
                await sleeveSetToBBAction(ns, me.Sleeve, "Field Analysis");
                if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                    sleeve_working++;
                    sleeve_analyze = true;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeve_analyze = false;
                        sleeve_working--;
                        sleeveIdle(ns, me.Sleeve).then();
                    });
                    continue;
                } else await sleeveIdle(ns, me.Sleeve);
            }
            const countTracking = await bbGetActionCountRemain(
                ns,
                "Contracts",
                "Tracking",
            );
            const currentAction = await bbGetCurrentAction(ns);
            if (
                !analyze &&
                sleeve_working < maxWork &&
                cityChaos <= CHAOS_FLOOR &&
                !sleeve_tracking &&
                currentAction?.name !== "Tracking" &&
                countTracking >= 1
            ) {
                const maxTrack = await bbGetActionMaxLvl(
                    ns,
                    "Contracts",
                    "Tracking",
                );
                for (let i = maxTrack; i > 0; i--) {
                    await bbSetActionLevel(ns, "Contracts", "Tracking", i);
                    const chance = await bbGetActionEstSuccessChance(
                        ns,
                        "Contracts",
                        "Tracking",
                        me.Sleeve,
                    );
                    if (chance[0] >= SLEEVE_CHANCE) {
                        break;
                    }
                }
                const chance = await bbGetActionEstSuccessChance(
                    ns,
                    "Contracts",
                    "Tracking",
                    me.Sleeve,
                );
                //ns.tprintf("Contracts-Sleeve:%s %s", me.Sleeve, chance[0])
                if (chance[0] < SLEEVE_CHANCE) trainSlv = true;
                else {
                    await sleeveSetToBBAction(
                        ns,
                        me.Sleeve,
                        "Take on contracts",
                        "Tracking",
                    );
                    if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                        sleeve_working++;
                        sleeve_tracking = true;
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            sleeve_tracking = false;
                            sleeve_working--;
                            sleeveIdle(ns, me.Sleeve).then();
                        });
                        continue;
                    } else await sleeveIdle(ns, me.Sleeve);
                }
            }
            await ns.asleep(0);
            const countBounty = await bbGetActionCountRemain(
                ns,
                "Contracts",
                "Bounty Hunter",
            );
            if (
                !analyze &&
                sleeve_working < maxWork &&
                cityChaos <= CHAOS_FLOOR &&
                currentAction?.name !== "Bounty Hunter" &&
                !sleeve_bounty &&
                countBounty >= 1
            ) {
                const maxBounty = await bbGetActionMaxLvl(
                    ns,
                    "Contracts",
                    "Bounty Hunter",
                );
                for (let i = maxBounty; i > 0; i--) {
                    await bbSetActionLevel(ns, "Contracts", "Bounty Hunter", i);
                    const chance = await bbGetActionEstSuccessChance(
                        ns,
                        "Contracts",
                        "Bounty Hunter",
                        me.Sleeve,
                    );
                    if (chance[0] >= SLEEVE_CHANCE) {
                        break;
                    }
                }
                const chance = await bbGetActionEstSuccessChance(
                    ns,
                    "Contracts",
                    "Bounty Hunter",
                    me.Sleeve,
                );
                //ns.tprintf("BHunter-Sleeve:%s %s", me.Sleeve, chance[0])
                if (chance[0] < SLEEVE_CHANCE) trainSlv = true;
                else {
                    await sleeveSetToBBAction(
                        ns,
                        me.Sleeve,
                        "Take on contracts",
                        "Bounty Hunter",
                    );
                    if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                        sleeve_working++;
                        sleeve_bounty = true;
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            sleeve_working--;
                            sleeve_bounty = false;
                            sleeveIdle(ns, me.Sleeve).then();
                        });
                        continue;
                    } else await sleeveIdle(ns, me.Sleeve);
                }
            }
            await ns.asleep(0);
            const countRetire = await bbGetActionCountRemain(
                ns,
                "Contracts",
                "Retirement",
            );
            if (
                !analyze &&
                sleeve_working < maxWork &&
                cityChaos <= CHAOS_FLOOR &&
                currentAction?.name !== "Retirement" &&
                !sleeve_retire &&
                countRetire >= 1
            ) {
                const maxRet = await bbGetActionMaxLvl(
                    ns,
                    "Contracts",
                    "Retirement",
                );
                for (let i = maxRet; i > 0; i--) {
                    await bbSetActionLevel(ns, "Contracts", "Retirement", i);
                    const chance = await bbGetActionEstSuccessChance(
                        ns,
                        "Contracts",
                        "Retirement",
                        me.Sleeve,
                    );
                    if (chance[0] >= SLEEVE_CHANCE) {
                        break;
                    }
                }
                const chance = await bbGetActionEstSuccessChance(
                    ns,
                    "Contracts",
                    "Retirement",
                    me.Sleeve,
                );
                //ns.tprintf("Retirement-Sleeve:%s %s", me.Sleeve, chance[0])
                if (chance[0] < SLEEVE_CHANCE) trainSlv = true;
                else {
                    await sleeveSetToBBAction(
                        ns,
                        me.Sleeve,
                        "Take on contracts",
                        "Retirement",
                    );
                    if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                        sleeve_working++;
                        sleeve_retire = true;
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            sleeve_retire = false;
                            sleeve_working--;
                            sleeveIdle(ns, me.Sleeve).then();
                        });
                        continue;
                    }
                    await sleeveIdle(ns, me.Sleeve);
                }
            }
            await ns.asleep(0);
            if (
                cityChaos > CHAOS_FLOOR &&
                !sleeve_diplomacy &&
                sleeve_working < maxWork
            ) {
                await sleeveSetToBBAction(ns, me.Sleeve, "Diplomacy");
                if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                    sleeve_working++;
                    sleeve_diplomacy = true;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeve_diplomacy = false;
                        sleeve_working--;
                        sleeveIdle(ns, me.Sleeve).then();
                    });
                    continue;
                } else await sleeveIdle(ns, me.Sleeve);
            }
            if (trainSlv && stamPerc > 0.55 && sleeve_working < maxWork) {
                await sleeveSetToBBAction(ns, me.Sleeve, "Training");
                if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                    sleeve_working++;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeveIdle(ns, me.Sleeve).then();
                        sleeve_working--;
                    });
                    continue;
                } else {
                    await sleeveIdle(ns, me.Sleeve);
                    continue;
                }
            }
            if (!sleeve_infil && sleeve_working < maxWork) {
                await sleeveSetToBBAction(
                    ns,
                    me.Sleeve,
                    "Infiltrate Synthoids",
                );
                if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                    sleeve_working++;
                    sleeve_infil = true;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeve_working--;
                        sleeve_infil = false;
                        sleeveIdle(ns, me.Sleeve).then();
                    });
                    continue;
                } else await sleeveIdle(ns, me.Sleeve);
            }
        }
    }
} // Updatesleeves function
/** @param {NS} ns */
async function updateskills(ns) {
    let b = ns.bladeburner;
    let count = 0;
    while (true) {
        count++;
        if (count > 2000) {
            await ns.asleep(4);
            count = 0;
        }
        if (INTMODE) {
            const maxUpgrade = await calcMaxUpgradeCount(
                ns,
                "Hyperdrive",
                await bbGetSkillPoints(ns),
            );
            if (!maxUpgrade) break;
            const hyperSkill = await bbGetSkillLevel(ns, "Hyperdrive");
            if (hyperSkill <= Number.MAX_SAFE_INTEGER - 1) {
                await bbUpgradeSkill(ns, "Hyperdrive", maxUpgrade);
                break;
            } else if (maxUpgrade >= hyperSkill / 1e8) {
                await bbUpgradeSkill(ns, "Hyperdrive", maxUpgrade);
                break;
            } else break;
        } else {
            let bestcost = Number.POSITIVE_INFINITY;
            let bestskill = "Hyperdrive";
            for (const skl of b.getSkillNames()) {
                const skillRating = await skillrating(ns, skl);
                if (skillRating < bestcost) {
                    bestcost = skillRating;
                    bestskill = skl;
                }
            }
            if (LVLUP > 0) {
                const update = await bbUpgradeSkill(ns, bestskill, LVLUP);
                if (!update) break;
            }

            if (LVLUP <= 0) {
                const maxUpgrade = await calcMaxUpgradeCount(
                    ns,
                    bestskill,
                    await bbGetSkillPoints(ns),
                );
                const update = await bbUpgradeSkill(bestskill, maxUpgrade);
                if (!update) break;
            }
        }
    }
}
async function skillrating(ns, skill) {
    let mod = 0;
    skillmods.map((x) => {
        x[0] === skill ? (mod = x[1]) : null;
    });
    let cost = await bbGetSkillUpgradeCost(ns, skill);
    return cost / mod === 0 ? Number.POSITIVE_INFINITY : cost / mod;
}
/** @param {NS} ns */
async function cityneedsanalysis(ns, city, diff = 0) {
    const b = ns.bladeburner;
    const startcity = await bbGetCity(ns);
    await bbSwitchCity(ns, city);
    for (const bop of b.getBlackOpNames()) {
        if (
            (await proxy(
                ns,
                "bladeburner.getActionCountRemaining",
                "Black Operations",
                bop,
            )) >= 1
        ) {
            let chance = await bbGetActionEstSuccessChance(
                ns,
                "Black Operations",
                bop,
            );
            if (chance[1] - chance[0] > diff) {
                await bbSwitchCity(ns, startcity);
                return true;
            }
            break;
        }
    }
    for (const contract of b.getContractNames()) {
        const max = await proxy(
            ns,
            "bladeburner.getActionMaxLevel",
            "Contracts",
            contract,
        );
        await proxy(
            ns,
            "bladeburner.setActionLevel",
            "Contracts",
            contract,
            max,
        );
        let chance = await bbGetActionEstSuccessChance(
            ns,
            "Contracts",
            contract,
        );
        if (chance[1] - chance[0] > diff) {
            await bbSwitchCity(ns, startcity);
            return true;
        }
    }
    for (const op of b.getOperationNames()) {
        const max = await proxy(
            ns,
            "bladeburner.getActionMaxLevel",
            "Operations",
            op,
        );
        await proxy(ns, "bladeburner.setActionLevel", "Operations", op, max);
        let chance = await bbGetActionEstSuccessChance(ns, "Operations", op);
        if (chance[1] - chance[0] > diff) {
            await bbSwitchCity(ns, startcity);
            return true;
        }
    }
    await bbSwitchCity(ns, startcity);
    return false;
}
async function checkTracking(ns, diff) {
    for (const city of cities) {
        const analyze = await cityneedsanalysis(ns, city, diff);
        if (analyze) return city;
    }
    return false;
}
//Returns an array.  [0] is missions name, [1] is missions type, [2] is the city
/** @param {NS} ns */
async function getBestMission(ns) {
    let b = ns.bladeburner;

    const startcity = await bbGetCity(ns);
    let bestresult = 0;
    let bestoperation = null;
    let bestoperationtype = null;
    let bestoperationcity = null;
    let bestoperationlevel = 1;

    let blackops = [];
    for (const bop of b.getBlackOpNames()) {
        const count = await bbGetActionCountRemain(ns, "Black Operations", bop);
        if (count > 0) {
            let record = {
                BOP: bop,
                Rank: await bbGetBlackOpRank(ns, bop),
            };
            blackops.push(record);
        }
    }
    blackops = blackops.sort((x, y) => {
        return y.Rank - x.Rank;
    });
    const next = blackops.pop();
    let bopchance;
    if (next !== undefined)
        bopchance = await bbGetActionEstSuccessChance(
            ns,
            "Black Operations",
            next.BOP,
        );
    const rank = await bbGetRank(ns);
    if (
        next !== undefined &&
        (bopchance[0] + bopchance[1]) / 2 >= BOPS_SUCCESS_TRY &&
        next.Rank <= rank
    )
        return ["Black Operations", next.BOP, startcity, 1];

    for (const city of cities) {
        await bbSwitchCity(ns, city);
        for (const contract of b.getContractNames()) {
            if (contract === "Tracking" && sleeve_tracking) continue; // If a sleeve is doing something, move on.
            if (contract === "Bounty Hunter" && sleeve_bounty) continue; // Not because it causes a conflict
            if (contract === "Retirement" && sleeve_retire) continue; // But so we can focus on getting to Operations
            const count = await bbGetActionCountRemain(
                ns,
                "Contracts",
                contract,
            );
            if (count < 1) continue;
            const maxCLvl = await bbGetActionMaxLvl(ns, "Contracts", contract);
            for (let level = maxCLvl; level > 0; level--) {
                await bbSetActionLevel(ns, "Contracts", contract, level);
                const chance = await bbGetActionEstSuccessChance(
                    ns,
                    "Contracts",
                    contract,
                );
                if ((chance[0] + chance[1]) / 2 >= MIN_CHANCE_SUCCESS) {
                    const result =
                        (((chance[0] + chance[1]) / 2) *
                            (await bbGetActionRepGain(
                                ns,
                                "Contracts",
                                contract,
                            ))) /
                        (await bbGetActionTime(ns, "Contracts", contract));
                    if (result > bestresult) {
                        bestresult = result;
                        bestoperation = contract;
                        bestoperationtype = "Contracts";
                        bestoperationcity = city;
                        bestoperationlevel = level;
                    } else break;
                }
            }
        }
        const ops = [
            "Undercover Operation",
            "Sting Operation",
            "Assassination",
        ];
        for (const o of ops) {
            const count = await bbGetActionCountRemain(ns, "Operations", o);
            if (count < 1) continue;
            const maxOLvl = await bbGetActionMaxLvl(ns, "Operations", o);
            for (let level = maxOLvl; level > 0; level--) {
                await bbSetActionLevel(ns, "Operations", o, level);
                const chance = await bbGetActionEstSuccessChance(
                    ns,
                    "Operations",
                    o,
                );
                if ((chance[0] + chance[1]) / 2 >= MIN_CHANCE_SUCCESS) {
                    const bonus = o === "Assassination" ? 10 : 1;
                    const result =
                        (((chance[0] + chance[1]) / 2) *
                            (await bbGetActionRepGain(ns, "Operations", o)) *
                            bonus) /
                        (await bbGetActionTime(ns, "Operations", o));
                    if (result > bestresult) {
                        bestresult = result;
                        bestoperation = o;
                        bestoperationtype = "Operations";
                        bestoperationcity = city;
                        bestoperationlevel = level;
                    } else break;
                }
            }
        }
    }
    await bbSwitchCity(ns, startcity);
    return bestoperation !== null
        ? [
              bestoperationtype,
              bestoperation,
              bestoperationcity,
              bestoperationlevel,
          ]
        : null;
}
/** @param {NS} ns */
async function getBestAnalysisMission(ns, city) {
    const startcity = await bbGetCity(ns);
    let bestresult = 0;
    let bestoperation = null;
    let bestoperationtype = null;
    let bestoperationlevel = 1;

    for (const operation of ["Undercover Operation", "Investigation"]) {
        const count = await bbGetActionCountRemain(ns, "Operations", operation);
        if (count >= 1) {
            const maxOLvl = await bbGetActionMaxLvl(
                ns,
                "Operations",
                operation,
            );
            for (let level = maxOLvl; level > 0; level--) {
                await bbSetActionLevel(ns, "Operations", operation, level);
                const chance = await bbGetActionEstSuccessChance(
                    ns,
                    "Operations",
                    operation,
                );
                if ((chance[0] + chance[1]) / 2 >= MIN_CHANCE_SUCCESS) {
                    const result =
                        (((chance[0] + chance[1]) / 2) *
                            (await bbGetActionRepGain(
                                ns,
                                "Operations",
                                operation,
                            ))) /
                        (await bbGetActionTime(
                            ns,
                            "Operations",
                            "Undercover Operation",
                        ));
                    if (result > bestresult) {
                        bestresult = result;
                        bestoperation = operation;
                        bestoperationtype = "Operations";
                        bestoperationlevel = level;
                    } else break;
                }
            }
        }
    }
    await bbSwitchCity(ns, startcity);
    return bestoperation !== null
        ? [bestoperationtype, bestoperation, city, bestoperationlevel]
        : ["General", "Field Analysis", city, 1];
}
/** @param {NS} ns */
async function checkChaos(ns) {
    const priorityCityChaos = PRIORITY_CITY
        ? await bbGetCityChaos(ns, PRIORITY_CITY)
        : 0;
    if (PRIORITY_CITY && priorityCityChaos <= CHAOS_FLOOR)
        PRIORITY_CITY = false;
    if (!PRIORITY_CITY) {
        for (const city of cities) {
            //New emergency?
            const cityChaos = await bbGetCityChaos(ns, city);
            if (cityChaos >= CHAOS_TOP) {
                PRIORITY_CITY = city;
                return PRIORITY_CITY;
            }
        }
    }
    return PRIORITY_CITY;
}
/** @param {NS} ns */
async function updatedisplay(ns) {
    clearLogs(ns);
    const b = ns.bladeburner;
    const s = ns.sleeve;
    const city = await bbGetCity(ns);
    const stamina = await bbGetStam(ns);
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        update(
            ns,
            ns.sprintf(
                "Rank: %s  Operations Queued: %s",
                ns.format.number(await bbGetRank(ns)),
                queues.length,
            ),
        );
    else
        update(
            ns,
            ns.sprintf(
                "Rank: %s  Operations Queued: %s",
                ns.formatNumber(await bbGetRank(ns)),
                queues.length,
            ),
        );
    if (ns.ui.getGameInfo()?.versionNumber >= 44)
        update(
            ns,
            ns.sprintf(
                "Stamina: %s/%s(%s%s)",
                ns.format.number(stamina[0]),
                ns.format.number(stamina[1]),
                ns.format.number((stamina[0] / stamina[1]) * 100, 2),
                "%",
            ),
        );
    else
        update(
            ns,
            ns.sprintf(
                "Stamina: %s/%s(%s%s)",
                ns.formatNumber(stamina[0]),
                ns.formatNumber(stamina[1]),
                ns.formatNumber((stamina[0] / stamina[1]) * 100, 2),
                "%",
            ),
        );
    update(ns, ns.sprintf("Current City: %s", city));
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        update(
            ns,
            ns.sprintf(
                "Est. Population: %s",
                ns.format.number(await bbGetCityEstPop(ns, city)),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Synth Comms: %s",
                ns.format.number(await bbGetCityComms(ns, city), 0),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Chaos: %s",
                ns.format.number(await bbGetCityChaos(ns, city)),
            ),
        );
    } else {
        update(
            ns,
            ns.sprintf(
                "Est. Population: %s",
                ns.formatNumber(await bbGetCityEstPop(ns, city)),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Synth Comms: %s",
                ns.formatNumber(await bbGetCityComms(ns, city), 0),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Chaos: %s",
                ns.formatNumber(await bbGetCityChaos(ns, city)),
            ),
        );
    }
    const skillPoints = await bbGetSkillPoints(ns);
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        update(
            ns,
            ns.sprintf(
                "Skill Points: %s",
                skillPoints > 1000
                    ? ns.format.number(skillPoints)
                    : skillPoints,
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Bonus Time: %s",
                b.getBonusTime() / 1000 >= 1000
                    ? ns.format.number(b.getBonusTime() / 1000)
                    : b.getBonusTime() / 1000,
            ),
        );
    } else {
        update(
            ns,
            ns.sprintf(
                "Skill Points: %s",
                skillPoints > 1000 ? ns.formatNumber(skillPoints) : skillPoints,
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Bonus Time: %s",
                b.getBonusTime() / 1000 >= 1000
                    ? ns.formatNumber(b.getBonusTime() / 1000)
                    : b.getBonusTime() / 1000,
            ),
        );
    }
    await updatemissions(ns);
    if (queuestask.Type === undefined) update(ns, "Current Task: None(0/0)");
    else
        update(
            ns,
            ns.sprintf(
                "Current Task: %s(%s/%s)  %s",
                queuestask.Type,
                queuestask.Level,
                queuestask.Type === "Black Operations" ||
                    queuestask.Type === "General"
                    ? 1
                    : await bbGetActionMaxLvl(
                          ns,
                          queuestask.Type,
                          queuestask.Name,
                      ),
                queuestask.Name,
            ),
        );
    const actionCurTime = await bbGetActionCurTime(ns);
    if (queuestask.Type !== undefined) {
        const actionTime = await bbGetActionTime(
            ns,
            queuestask.Type,
            queuestask.Name,
        );
        if (ns.ui.getGameInfo()?.versionNumber >= 44)
            update(
                ns,
                ns.sprintf(
                    "Progress: %s Time: %s",
                    updateprogress(actionTime, actionCurTime),
                    ns.format.time(actionTime - actionCurTime),
                ),
            );
        else
            update(
                ns,
                ns.sprintf(
                    "Progress: %s Time: %s",
                    updateprogress(actionTime, actionCurTime),
                    ns.tFormat(actionTime - actionCurTime),
                ),
            );
    } else
        update(ns, ns.sprintf("Progress: %s Time: n/a", updateprogress(10, 0)));
    update(
        ns,
        "------------------------------------------------------------------------------",
    );
    if (!SLEEVES_ENABLED) update(ns, "SLEEVE SUPPORT DISABLED");
    else {
        const numSleeves = await sleeveGetNum(ns);
        for (let slv = 0; slv < numSleeves; slv++) {
            let task = s.getTask(slv);
            const currentSlv = await sleeveGet(ns, slv);
            let cycles;
            if (ns.ui.getGameInfo()?.versionNumber >= 44)
                cycles =
                    currentSlv.storedCycles > 1000
                        ? ns.format.number(currentSlv.storedCycles, 2)
                        : currentSlv.storedCycles;
            else
                cycles =
                    currentSlv.storedCycles > 1000
                        ? ns.formatNumber(currentSlv.storedCycles, 2)
                        : currentSlv.storedCycles;
            let buf = ns.sprintf("Sleeve: %s  Cycles: %-7s ", slv, cycles);
            if (task !== null) {
                if (task.type === "INFILTRATE")
                    buf += ns.sprintf("%-18s ", "BB: Infiltration");
                else if (task.type === "CRIME")
                    buf += ns.sprintf("%-18s ", "Crime: " + task.crimeType);
                else if (task.type === "BLADEBURNER")
                    buf += ns.sprintf(
                        "%-18s ",
                        "BB: " + task.actionName.substring(0, 14),
                    );
                else if (task.type === "RECOVERY")
                    buf += ns.sprintf("%-18s ", "Shock Recovery");
                else buf += ns.sprintf("%-18s ", "?" + task.type);
            } else buf += ns.sprintf("%-18s ", "Idle: ------------");
            if (task !== null)
                buf += ns.sprintf(
                    updateprogress(task.cyclesNeeded, task.cyclesWorked),
                );
            else buf += ns.sprintf(updateprogress(10, 0));
            const slvAugs = await sleeveGetAugs(ns, slv);
            buf += ns.sprintf("  Augs: %2s%s", slvAugs, "\n");
            update(ns, buf);
        }
    }
}
/** @param {NS} ns */
async function updatemissions(ns) {
    //Cycle through all the mission types and show how many we currently have in our city and how many we have overall
    let b = ns.bladeburner;
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        for (const contract of b.getContractNames()) {
            const count = await bbGetActionCountRemain(
                ns,
                "Contracts",
                contract,
            );
            count >= 1000
                ? update(
                      ns,
                      ns.sprintf(
                          "Contracts: " +
                              ns.format.number(count) +
                              " " +
                              contract,
                      ),
                  )
                : update(
                      ns,
                      ns.sprintf(
                          "Contracts: " +
                              ns.format.number(count, 2) +
                              " " +
                              contract,
                      ),
                  );
        }
        for (const operation of b.getOperationNames()) {
            const count = await bbGetActionCountRemain(
                ns,
                "Operations",
                operation,
            );
            count >= 1000
                ? update(
                      ns,
                      ns.sprintf(
                          "Operation: " +
                              ns.format.number(count) +
                              " " +
                              operation,
                      ),
                  )
                : update(
                      ns,
                      ns.sprintf(
                          "Operation: " +
                              ns.format.number(count, 2) +
                              " " +
                              operation,
                      ),
                  );
        }
    } else {
        for (const contract of b.getContractNames()) {
            const count = await bbGetActionCountRemain(
                ns,
                "Contracts",
                contract,
            );
            count >= 1000
                ? update(
                      ns,
                      ns.sprintf(
                          "Contracts: " +
                              ns.formatNumber(count) +
                              " " +
                              contract,
                      ),
                  )
                : update(
                      ns,
                      ns.sprintf(
                          "Contracts: " +
                              ns.formatNumber(count, 2) +
                              " " +
                              contract,
                      ),
                  );
        }
        for (const operation of b.getOperationNames()) {
            const count = await bbGetActionCountRemain(
                ns,
                "Operations",
                operation,
            );
            count >= 1000
                ? update(
                      ns,
                      ns.sprintf(
                          "Operation: " +
                              ns.formatNumber(count) +
                              " " +
                              operation,
                      ),
                  )
                : update(
                      ns,
                      ns.sprintf(
                          "Operation: " +
                              ns.formatNumber(count, 2) +
                              " " +
                              operation,
                      ),
                  );
        }
    }
}
/** @param {NS} ns */
function updateprogress(max_time, run_time, bar_length = 20) {
    let done = run_time > 0 ? Math.max(max_time / run_time, 1) : 0;
    let buffer = "[";
    if (done > 0) {
        buffer = buffer.padEnd(Math.round((bar_length - 2) / done), "|"); // open square bracket + asterisk
        buffer += "*";
    }
    buffer = buffer.padEnd(bar_length - 1, "-");
    buffer += "]";

    return buffer;
}
/** @param {NS} ns */
async function runmission(ns, best) {
    //best.Type, best.Name, best.City, best.Level
    let b = ns.bladeburner;
    queuestask = best;
    const action = await bbGetCurrentAction(ns);
    //Resuming?
    const myCity = await bbGetCity(ns);
    const actionCurrentLvl = await bbGetActionCurLvl(ns, best.Type, best.Name);
    const blackOpTimeAddition = best.Type === "BlackOp" ? 2000 : 0; //BOPs seem to lag a few seconds
    if (
        action !== null &&
        best.City === myCity &&
        best.Type === action.type &&
        best.Name === action.name &&
        (best.Type === "General" ||
            best.Type === "BlackOp" ||
            best.Level === actionCurrentLvl)
    ) {
        const actionTime = await bbGetActionTime(ns, best.Type, best.Name);
        const actionCurTime = await bbGetActionCurTime(ns);
        if (b.getBonusTime() - 1000 > actionTime) {
            //All under bonus time
            queueswait =
                performance.now() +
                Math.max(
                    actionTime / 5 - actionCurTime + blackOpTimeAddition,
                    500,
                );
        } else
            queueswait =
                performance.now() +
                Math.max(
                    actionTime -
                        b.getBonusTime() -
                        actionCurTime +
                        blackOpTimeAddition / 2,
                    500,
                );
    } else {
        //New action
        if (best.City !== myCity) await bbSwitchCity(ns, best.City);
        await proxyTry(
            ns,
            "bladeburner.setActionLevel",
            best.Type,
            best.Name,
            best.Level,
        );
        await bbStartAction(ns, best.Type, best.Name);
        const actionTime = await bbGetActionTime(ns, best.Type, best.Name);
        if (b.getBonusTime() - 1000 > actionTime) {
            //All under bonus time
            queueswait =
                performance.now() +
                Math.max(actionTime / 5 + blackOpTimeAddition, 500);
        } else
            queueswait =
                performance.now() +
                Math.max(
                    actionTime - b.getBonusTime() + blackOpTimeAddition / 2,
                    500,
                );
    }
}
async function getTrainStats(ns) {
    const me = await getPlay(ns);
    return (
        (me.skills.agility +
            me.skills.defense +
            me.skills.dexterity +
            me.skills.strength) /
        4
    );
}
function queue(type, name, city, level) {
    let mission = {
        Type: type,
        Name: name,
        City: city,
        Level: level,
    };
    queues.push(mission);
}
/** @param {NS} ns */
async function init(ns) {
    sleeve_infil = false;
    sleeve_analyze = false;
    sleeve_tracking = false;
    sleeve_bounty = false;
    sleeve_retire = false;
    sleeve_diplomacy = false;
    sleeve_working = 0;
    queues.length = 0;
    if (SLEEVES_ENABLED) {
        const sleeves = await sleeveGetNum(ns);
        for (let slv = 0; slv < sleeves; slv++) await sleeveIdle(ns, slv);
    }
    HASBN4 = await hasBN(ns, 4, 2);
    queuestask = [null, null, null, null];
    queueswait = 0;
    PRIORITY_CITY = false;
    LVLUP = 1;
    endItCost = await doGetScriptRam(ns, "SphyxOS/singularity/destroyWD.js");
}
/** @param {NS} ns */
async function trainUp(ns) {
    const me = await getPlay(ns);
    const skls = me.skills;
    const wrk = HASBN4 ? await getWork(ns) : false;
    if (me.city !== "Sector-12") {
        clearLogs(ns);
        update(ns, "Please go to Sector-12");
        //Travel to our Gym
        if (HASBN4) await travelCity(ns, "Sector-12");
    } else if (skls.charisma < CSTATS) {
        clearLogs(ns);
        update(ns, "Train Cha to 100");
        if (HASBN4 && (wrk === null || wrk.classType !== "Leadership"))
            await proxy(
                ns,
                "singularity.universityCourse",
                "Rothman University",
                "Leadership",
                false,
            );
    } else if (skls.strength < CSTATS) {
        clearLogs(ns);
        update(ns, "Train Str to 100");
        if (HASBN4 && (wrk === null || wrk.classType !== "str"))
            await setGym(ns, "Powerhouse Gym", "str", false);
    } else if (skls.defense < CSTATS) {
        clearLogs(ns);
        update(ns, "Train Def to 100");
        if (HASBN4 && (wrk === null || wrk.classType !== "def"))
            await setGym(ns, "Powerhouse Gym", "def", false);
    } else if (skls.dexterity < CSTATS) {
        clearLogs(ns);
        update(ns, "Train Dex to 100");
        if (HASBN4 && (wrk === null || wrk.classType !== "dex"))
            await setGym(ns, "Powerhouse Gym", "dex", false);
    } else if (skls.agility < CSTATS) {
        clearLogs(ns);
        update(ns, "Train Agi to 100");
        if (HASBN4 && (wrk === null || wrk.classType !== "agi"))
            await setGym(ns, "Powerhouse Gym", "agi", false);
    }
}
/** @param {NS} ns */
function getslvpower(slv) {
    let skill = slv.skills;
    return (
        (skill.agility + skill.defense + skill.dexterity + skill.strength) / 4
    );
}
/** @param {NS} ns */
async function calcMaxUpgradeCount(ns, skill, cost) {
    let baseCost;
    let costInc;
    const currentLevel = await bbGetSkillLevel(ns, skill);
    const currentNodeMults = await getBNMults(ns);
    for (const skl of skillmods)
        if (skl[0] === skill) {
            baseCost = skl[2];
            costInc = skl[3];
            break;
        }
    const m = -baseCost - costInc * currentLevel + costInc / 2;
    const delta = Math.sqrt(
        m * m + (2 * costInc * cost) / currentNodeMults.BladeburnerSkillCost,
    );
    const result = Math.round((m + delta) / costInc);
    const costOfResultPlus1 = await calculateCost(ns, skill, result + 1);
    if (costOfResultPlus1 <= cost) {
        return result + 1;
    }
    const costOfResult = await calculateCost(ns, skill, result);
    if (costOfResult <= cost) {
        return result;
    }
    return result - 1;
}
async function calculateCost(ns, skill, count = 1) {
    const currentLevel = await bbGetSkillLevel(ns, skill);
    const actualCount = currentLevel + count - currentLevel;
    let baseCost;
    let costInc;
    const currentNodeMults = await getBNMults(ns);
    for (const skl of skillmods)
        if (skl[0] === skill) {
            baseCost = skl[2];
            costInc = skl[3];
            break;
        }
    return Math.round(
        actualCount *
            currentNodeMults.BladeburnerSkillCost *
            (baseCost + costInc * (currentLevel + (actualCount - 1) / 2)),
    );
}
/** @param {NS} ns */
async function endIt(ns) {
    //We need to upgrade ram to a certain minimum.
    const maxRam = await maxRun(ns, false);
    if ((await getServerAvailRam(ns, "home")) < reservedRam) {
        const upgCost = await doGetScriptRam(
            ns,
            "SphyxOS/singularity/upgradeHomeRam.js",
        );
        if (maxRam >= upgCost) await upgHomeRam(ns);
    } else if (FINISHER && maxRam >= endItCost) {
        const nextBN = await getNextBN(ns);
        await destroyWD(ns, nextBN, STARTUP_SCRIPT);
    }
}
/** @param {NS} ns */
async function getNextBN(ns) {
    let nextbn = 0;
    let nextbnlvl = 0;
    for (let check of bnorder) {
        let isthere = false;
        const sourceFiles = await getOwnedSF(ns);
        for (const bn of sourceFiles) {
            let bonus = 0;
            const resetInfo = await getResetInf(ns);
            if (resetInfo.currentNode == check[0]) bonus = 1;
            if (bn.n == check[0] && bn.lvl + bonus >= check[1]) isthere = true;
            if (bn.n == resetInfo.currentNode && 1 >= check[1]) isthere = true;
            if (resetInfo.currentNode === check[0] && 1 >= check[1])
                isthere = true;
        }
        if (isthere == false) {
            nextbn = check[0];
            nextbnlvl = check[1];
            break;
        }
    }
    let value = ns.sprintf("%s" + "." + "%s", nextbn, nextbnlvl);
    return Number.parseInt(value);
}
function clearLogs(ns) {
    ns.clearLog();
    if (win && win.closed) {
        win.close();
        win = false;
        ns.writePort(1, "bb popout off");
    }
    if (win) win.clear();
}
function update(ns, text) {
    ns.printRaw(text);
    if (win) win.update(text);
}
/** @param {NS} ns */
async function getCommands(ns) {
    let quiet = false;
    while (ns.peek(18) !== "NULL PORT DATA") {
        let result = ns.readPort(18);
        switch (result) {
            case "popout":
                win = await makeNewWindow("BladeBurner", ns.ui.getTheme());
                if (!quiet) ns.tprintf("BB:  Will use a popout");
                break;
            case "nopopout":
                if (win) win.close();
                if (!quiet) ns.tprintf("BB:  Will not use a popout");
                break;
            case "sleeve infil on":
                if (!quiet) ns.tprintf("BB: Sleeves set to infil only");
                SLEEVEINFILSTATUS = true;
                break;
            case "sleeve infil off":
                if (!quiet) ns.tprintf("BB: Sleeves will not focus on infil");
                SLEEVEINFILSTATUS = false;
                break;
            case "int mode on":
                if (!quiet) ns.tprintf("BB: Int mode ON");
                INTMODE = true;
                break;
            case "int mode off":
                if (!quiet) ns.tprintf("BB: Int mode OFF");
                INTMODE = false;
                break;
            case "sleeves on":
                if (!quiet) ns.tprintf("BB: Sleeves activated");
                SLEEVES_ENABLED = true;
                const slvNum = await sleeveGetNum(ns);
                for (let slv = 0; slv < slvNum; slv++)
                    await sleeveIdle(ns, slv);
                break;
            case "sleeves off":
                if (!quiet) ns.tprintf("BB: Sleeves deactivated");
                SLEEVES_ENABLED = false;
                break;
            case "finisher on":
                if (!quiet) ns.tprintf("BB: Finisher activated");
                FINISHER = true;
                break;
            case "finisher off":
                if (!quiet) ns.tprintf("BB: Finisher deactivated");
                FINISHER = false;
                break;
            case "quiet":
                quiet = true;
                break;
            default:
                ns.tprintf("Invalid command received in BB: %s", result);
                break;
        }
    }
}

//[0] is Node, [1] is lvl
const bnorder = [
    [1, 3],
    [2, 3],
    [5, 1],
    [4, 3],
    [7, 3],
    [6, 3],
    [3, 3],
    [13, 3],
    [5, 3],
    [9, 3],
    [10, 3],
    [11, 3],
    [14, 3],
    [8, 3],
    [12, 36000],
];
const cities = [
    "Sector-12",
    "Aevum",
    "Volhaven",
    "Chongqing",
    "New Tokyo",
    "Ishima",
];
//skillmods [0] name, [1] My rating, [2] baseCost, [3] costInc
const skillmods = [
    ["Blade\'s Intuition", 2.0, 3, 2.1],
    ["Cloak", 0.8, 1, 1.1],
    ["Short-Circuit", 1.0, 2, 2.1],
    ["Digital Observer", 1.6, 2, 2.1],
    ["Tracer", 1.0, 2, 2.1],
    ["Overclock", 2.2, 3, 1.4],
    ["Reaper", 1.0, 2, 2.1],
    ["Evasive System", 2.0, 2, 2.1],
    ["Datamancer", 1.0, 3, 1],
    ["Cyber\'s Edge", 1.0, 1, 3],
    ["Hands of Midas", 0.1, 2, 2.5],
    ["Hyperdrive", 2.5, 1, 2.5],
];
