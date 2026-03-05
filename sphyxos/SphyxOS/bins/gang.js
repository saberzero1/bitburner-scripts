import {
    gangRecruit,
    gangAscend,
    gangEquip,
    setWar,
    gangCreate,
    gangGetMembers,
    gangGetMembersFull,
    gangInGang,
} from "SphyxOS/util.js";
import {
    gangGetGangInfo,
    gangGetOtherGangInfo,
    gangRespectForNext,
    getBNMults,
    hasBN,
    getFacRep,
    gangSetMemberTask,
} from "SphyxOS/util.js";
import {
    joinFac,
    getPlay,
    travelCity,
    getWork,
    setGym,
    getMoneyAvail,
    doCrime,
} from "SphyxOS/util.js";
import { hasSleeves, sleeveShockRecovery, sleeveSync } from "SphyxOS/util.js";
import {
    sleeveTravel,
    sleeveSetToGym,
    sleeveSetToCrime,
    getSleeveObject,
    proxy,
    makeNewWindow,
} from "SphyxOS/util.js";
const WIDTH = 1055;
const HEIGHT = 660;
const STATS = 30;
const GANG_NAME = "Slum Snakes";
const MAX_MEMBERS = 12;
const WIN_WAR_CHANCE = 0.55;
const WAR_CUTOFF = 0.9;
const MIN_TERRITORY_START_WAR = 0.99;
const COMBAT_STAT_TRAIN = 20;
const WORKERS = 9 / 12;
let MODE = "Respect"; //Respect, Money, Auto
let AUTOASCEND = true; //Whether or not we automatically switch workers, turn on buying eq, ascend, etc.
let AUTOEQ = true;
let SLEEVES = false;
let SLEEVEACCESS = false;
let WARFARE_TICK = -1;
const SLEEVESTATS = 30;
const SLEEVESHOCK = 97;
let HASBN4 = false;
let NOTRAIN = false;
let memberNames;
let fullMembers;
let gangInfo;
let otherGangInfo;
let respectForNext;
let bitnodeMults;
let win;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.resizeTail(WIDTH, HEIGHT);
    ns.clearPort(6);
    ns.writePort(6, ns.pid);
    ns.writePort(1, true);
    ns.atExit(() => {
        ns.clearPort(6);
        ns.writePort(1, 1);
        if (win) {
            win.close();
            win = false;
            ns.writePort(1, "gang popout off");
        }
    });

    //Are we strong enough?
    /** @type {Player} me */
    let me = await getPlay(ns);
    let skls = me.skills;
    HASBN4 = await hasBN(ns, 4, 2);
    let wrk = HASBN4 ? await getWork(ns) : false;
    let haveGang = await gangInGang(ns);
    SLEEVEACCESS = await hasSleeves(ns);
    WARFARE_TICK = -1;

    while (
        !haveGang &&
        !NOTRAIN &&
        (skls.agility < STATS ||
            skls.defense < STATS ||
            skls.dexterity < STATS ||
            skls.strength < STATS)
    ) {
        await getCommands(ns);
        me = await getPlay(ns);
        skls = me.skills;
        wrk = HASBN4 ? await getWork(ns) : false;
        if (SLEEVEACCESS && SLEEVES) await sleeveWork(ns);

        if (me.city !== "Sector-12") {
            //Travel to our Gym
            clearLogs(ns);
            update(ns, "Please go to Sector-12");
            if (HASBN4) await travelCity(ns, "Sector-12");
            await ns.sleep(1000);
            continue;
        }
        if (skls.strength < STATS) {
            clearLogs(ns);
            update(ns, "Train Str to 30");
            if (SLEEVEACCESS && SLEEVES) await displaySleeves(ns);
            if (wrk === null || (wrk && wrk.classType !== "str")) {
                await setGym(ns, "Powerhouse Gym", "str");
            }
            await ns.sleep(1000);
            continue;
        }
        if (skls.defense < STATS) {
            clearLogs(ns);
            update(ns, "Train Def to 30");
            if (SLEEVEACCESS && SLEEVES) await displaySleeves(ns);
            if (wrk === null || (wrk && wrk.classType !== "def")) {
                await setGym(ns, "Powerhouse Gym", "def");
            }
            await ns.sleep(1000);
            continue;
        }
        if (skls.dexterity < STATS) {
            clearLogs(ns);
            update(ns, "Train Dex to 30");
            if (SLEEVEACCESS && SLEEVES) await displaySleeves(ns);
            if (wrk === null || (wrk && wrk.classType !== "dex")) {
                await setGym(ns, "Powerhouse Gym", "dex");
            }
            await ns.sleep(1000);
            continue;
        }
        if (skls.agility < STATS) {
            clearLogs(ns);
            update(ns, "Train Agi to 30");
            if (SLEEVEACCESS && SLEEVES) await displaySleeves(ns);
            if (wrk === null || (wrk && wrk.classType !== "agi")) {
                await setGym(ns, "Powerhouse Gym", "agi");
            }
            await ns.sleep(1000);
            continue;
        }
    }
    update(ns, "Do Homicide");
    if (HASBN4 && !NOTRAIN) await doCrime(ns, "Homicide"); //Automatic switch to homicide
    //Do we have enough money, and are we bad enough yet?
    let currentMoney = await getMoneyAvail(ns, "home");
    while ((currentMoney < 1000000 || ns.heart.break() > -9) && !haveGang) {
        await getCommands(ns);
        if (SLEEVEACCESS && SLEEVES) await sleeveWork(ns);
        currentMoney = await getMoneyAvail(ns, "home");
        haveGang = await gangInGang(ns);
        let wrk = HASBN4 ? await getWork(ns) : false;
        clearLogs(ns);
        update(ns, "Do Homicide for Money and Karma");
        update(ns, "Join Slum Snakes when you can");
        if (SLEEVEACCESS && SLEEVES) await displaySleeves(ns);
        if (HASBN4 && !NOTRAIN && wrk && wrk.crimeType !== "Homicide") {
            await doCrime(ns, "Homicide");
        }
        await ns.sleep(1000);
        continue;
    }

    let count = 0;
    let prev = 0;
    let buf = "";
    //Are we in a gang yet?
    await gangCreate(ns, GANG_NAME);
    while (!haveGang) {
        await getCommands(ns);
        if (HASBN4) await joinFac(ns, GANG_NAME);
        await gangCreate(ns, GANG_NAME);
        count--;
        if (count < 0) {
            count = 30;
            const karma = ns.heart.break();
            let result = 0;
            if (prev === 0) {
                result = 0;
            } else {
                result = ((-54000 - karma) / ((karma - prev) / 30)) * 1000;
            }
            if (ns.ui.getGameInfo()?.versionNumber >= 44)
                buf = ns.sprintf(
                    "Karma: %s / -54000  ETA: %s",
                    karma.toFixed(0),
                    result === 0 ? "n/a" : ns.format.time(result),
                );
            else
                buf = ns.sprintf(
                    "Karma: %s / -54000  ETA: %s",
                    karma.toFixed(0),
                    result === 0 ? "n/a" : ns.tFormat(result),
                );
            prev = karma;
        }
        haveGang = await gangInGang(ns);
        clearLogs(ns);
        update(ns, buf);
        if (SLEEVEACCESS && SLEEVES) {
            await sleeveWork(ns);
            await displaySleeves(ns);
        }
        await ns.sleep(1000);
    }
    ns.ui.resizeTail(WIDTH, HEIGHT);
    bitnodeMults = await getBNMults(ns);
    MODE = ns.args.includes("money") ? "Money" : "Respect";
    gangInfo = await gangGetGangInfo(ns);
    let oldPower = gangInfo.power;
    let time = 0;
    while (true) {
        await getCommands(ns);
        memberNames = await gangGetMembers(ns);
        //if (MODE === "Auto" && memberNames.length === MAX_MEMBERS) MODE = "Money"
        fullMembers = await gangGetMembersFull(ns);
        gangInfo = await gangGetGangInfo(ns);

        otherGangInfo = await gangGetOtherGangInfo(ns);
        respectForNext = await gangRespectForNext(ns);
        if (SLEEVEACCESS && SLEEVES) await sleeveWork(ns);
        if (memberNames.length !== MAX_MEMBERS) await gangRecruit(ns);
        if (AUTOASCEND) await gangAscend(ns);
        if (AUTOEQ && memberNames.length > 3) await gangEquip(ns);
        const territoryWinChance = await war(ns);
        if (WARFARE_TICK === -1) {
            if (oldPower < gangInfo.power) {
                //We have our tick!  It was the last one
                WARFARE_TICK = 20000 - time;
            }
        } else if (
            WARFARE_TICK === 0 &&
            oldPower === gangInfo.power &&
            territoryWinChance < WAR_CUTOFF
        )
            //Reovery!  We may have run out of bonus time and things got messed up
            WARFARE_TICK = -1;
        else {
            WARFARE_TICK -= time;
            if (WARFARE_TICK < 0) WARFARE_TICK = 20000 - time; //+ WARFARE_TICK
        }

        await assignMembers(ns, territoryWinChance);

        //Get sleeve work:  if (SLEEVEACCESS && SLEEVES) sleeveWork(ns)

        await updateDisplay(ns);
        oldPower = gangInfo.power;
        time = await ns.gang.nextUpdate();
    }
}
/** @param {NS} ns */
function clearLogs(ns) {
    ns.clearLog();
    if (win) win.clear();
}
function update(ns, text) {
    ns.printRaw(text);
    if (win && win.closed) {
        win = false;
        ns.writePort(1, "gang popout off");
    }
    if (win) win.update(text);
}
/** @param {NS} ns */
async function sleeveWork(ns) {
    //We should have access to sleeves now to get here
    const sleeves = await getSleeveObject(ns);
    for (const slv of sleeves) {
        if (slv.me.shock > SLEEVESHOCK) {
            //We need to ensure we are deshocking
            await sleeveShockRecovery(ns, slv.num);
            continue;
        }
        if (slv.me.sync < 100) {
            //We need to ensure we are Synced up.  Shouldn't normally be an issue
            await sleeveSync(ns, slv.num);
            continue;
        }
        //Make sure we are in Sector-12
        if (slv.me.city !== "Sector-12") {
            if (!(await sleeveTravel(ns, slv.num, "Sector-12"))) continue;
        }
        if (slv.me.skills.strength < SLEEVESTATS) {
            if (slv.task === null || slv.task.classType !== "str") {
                await sleeveSetToGym(ns, slv.num, "Powerhouse Gym", "str");
            }
            continue;
        }
        if (slv.me.skills.defense < SLEEVESTATS) {
            if (slv.task === null || slv.task.classType !== "def") {
                await sleeveSetToGym(ns, slv.num, "Powerhouse Gym", "def");
            }
            continue;
        }
        if (slv.me.skills.dexterity < SLEEVESTATS) {
            if (slv.task === null || slv.task.classType !== "dex") {
                await sleeveSetToGym(ns, slv.num, "Powerhouse Gym", "dex");
            }
            continue;
        }
        if (slv.me.skills.agility < SLEEVESTATS) {
            if (slv.task === null || slv.task.classType !== "agi") {
                await sleeveSetToGym(ns, slv.num, "Powerhouse Gym", "agi");
            }
            continue;
        }
        //Done training, do crime
        if (slv.task === null || slv.task.crimeType !== "Homicide") {
            await sleeveSetToCrime(ns, slv.num, "Homicide");
            continue;
        }
    }
}

async function war(ns) {
    if (gangInfo.territory < MIN_TERRITORY_START_WAR) {
        let lowestwinchance = 1;

        for (const otherGang of combatGangs.concat(hackingGangs)) {
            if (otherGang == gangInfo.faction) {
                continue;
            } else if (otherGangInfo[otherGang].territory <= 0) {
                continue;
            } else {
                let othergangpower = otherGangInfo[otherGang].power;
                let winChance =
                    gangInfo.power / (gangInfo.power + othergangpower);
                lowestwinchance = Math.min(lowestwinchance, winChance);
            }
        }
        if (lowestwinchance > WIN_WAR_CHANCE) {
            if (!gangInfo.territoryWarfareEngaged) {
                await setWar(ns, true);
            }
        } else if (gangInfo.territoryWarfareEngaged) {
            await setWar(ns, false);
        }
        return lowestwinchance;
    } else if (gangInfo.territoryWarfareEngaged) {
        await setWar(ns, false);
    }
    return 1;
}
/** @param {NS} ns */
async function assignMembers(ns, territoryWinChance) {
    const sortedNames = fullMembers.toSorted(
        (a, b) => memberCombatStats(b) - memberCombatStats(a),
    );
    let workJobs = Math.ceil(memberNames.length * WORKERS);
    let wantedLevelIncrease = 0;
    let testJob = false;
    for (let member of sortedNames) {
        let highestTaskValue = 0;
        let highestValueTask = "Train Combat";
        const vigilanteDecrease = fWantedGain(
            member,
            ns.gang.getTaskStats("Vigilante Justice"),
        );
        if (WARFARE_TICK === -1 && !testJob) {
            workJobs--;
            testJob = true;
            highestValueTask = "Territory Warfare";
        } else if (
            workJobs > 0 &&
            gangInfo.territory < 1 &&
            WARFARE_TICK === 0 &&
            territoryWinChance < WAR_CUTOFF &&
            !gangInfo.territoryWarfareEngaged
        ) {
            // support territory warfare if max team size, not at max territory yet and win chance not high enough yet
            workJobs--;
            highestValueTask = "Territory Warfare";
        } else if (
            workJobs > 0 &&
            gangInfo.territory < 1 &&
            WARFARE_TICK === 0 &&
            territoryWinChance < WAR_CUTOFF &&
            gangInfo.territoryWarfareEngaged &&
            member.def > 300
        ) {
            // support territory warfare if max team size, not at max territory yet and win chance not high enough yet
            workJobs--;
            highestValueTask = "Territory Warfare";
        } else if (memberCombatStats(member) < COMBAT_STAT_TRAIN) {
            highestValueTask = "Train Combat";
        } else if (
            workJobs > 0 &&
            (wantedLevelIncrease + gangInfo.wantedLevel - 1 >
                vigilanteDecrease * -1 * 5 ||
                wantedLevelIncrease + gangInfo.wantedLevel > 20)
        ) {
            workJobs--;
            highestValueTask = "Vigilante Justice";
            wantedLevelIncrease += vigilanteDecrease * 5;
        } else if (workJobs > 0) {
            workJobs--;
            for (const task of tasks.map((t) => ns.gang.getTaskStats(t))) {
                if ((await taskValue(ns, member, task)) > highestTaskValue) {
                    highestTaskValue = await taskValue(ns, member, task);
                    highestValueTask = task;
                }
            }
            wantedLevelIncrease += fWantedGain(member, highestValueTask) * 5;
            highestValueTask = highestValueTask.name;
        }
        if (member.task !== highestValueTask) {
            await gangSetMemberTask(ns, member.name, highestValueTask);
        }
    }
}
function memberCombatStats(member) {
    return (member.str + member.def + member.dex + member.agi) / 4;
}
/** @param {NS} ns */
async function taskValue(ns, member, task) {
    // determine money and reputation gain for a task
    let respect = fRespectGain(member, task);
    let cash = fMoneyGain(member, task);
    let wantedLevelIncrease = fWantedGain(member, task);
    let vigilanteWantedDecrease = fWantedGain(
        member,
        ns.gang.getTaskStats("Vigilante Justice"),
    );

    if (wantedLevelIncrease + vigilanteWantedDecrease > 0) {
        //avoid tasks where more than one vigilante justice is needed to compensate
        return 0;
    }
    //else if ((2 * wantedLevelIncrease) + vigilanteWantedDecrease > 0) {
    // Simple compensation for wanted level since we need more vigilante then
    // ToDo: Could be a more sophisticated formula here
    //cash *= 0.75;
    //}
    let neededRep = 0;
    let hasRep = Infinity;
    if (HASBN4) {
        neededRep = await maxRepNeeded(ns, GANG_NAME);
        hasRep = await proxy(ns, "singularity.getFactionRep", GANG_NAME);
    }

    if (
        MODE === "Auto" &&
        (memberNames.length < MAX_MEMBERS || hasRep < neededRep)
    )
        return respect;
    else if (MODE === "Auto") return cash;
    else return MODE === "Respect" ? respect : cash;
}
/** @param {NS} ns */
async function updateDisplay(ns) {
    clearLogs(ns);
    update(ns, ns.sprintf("Name: %s", gangInfo.faction));
    if (ns.ui.getGameInfo()?.versionNumber >= 44) {
        update(
            ns,
            ns.sprintf(
                "Respect: %s (%s/s)",
                ns.format.number(gangInfo.respect),
                ns.format.number(gangInfo.respectGainRate * 5),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Next Recruit: %s",
                respectForNext === Number.POSITIVE_INFINITY
                    ? "MAXED"
                    : ns.format.number(respectForNext),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Mode: %s  Auto-Ascend: %s  Auto-EQ: %s",
                MODE,
                AUTOASCEND,
                AUTOEQ,
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Wanted Level: %s (%s/s)",
                ns.format.number(gangInfo.wantedLevel, 3),
                ns.format.number(gangInfo.wantedLevelGainRate * 5, 2),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Wanted Penalty: %s%s",
                ns.format.number((gangInfo.wantedPenalty - 1) * 100),
                "%",
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Money Gains: %s/s",
                ns.format.number(moneyIncrease(ns) * 5),
            ),
        );
        if (HASBN4)
            update(
                ns,
                ns.sprintf(
                    "Reputation: %s",
                    ns.format.number(await getFacRep(ns, gangInfo.faction)),
                ),
            );
        update(
            ns,
            ns.sprintf(
                "Territory: %s%s",
                ns.format.number(gangInfo.territory * 100, 2),
                "%",
            ),
        );
        update(ns, ns.sprintf("Power: %s", ns.format.number(gangInfo.power)));
        update(
            ns,
            ns.sprintf(
                "Clash Win Chance: %s%s",
                ns.format.number(clashwin() * 100, 2),
                "%",
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Territory Warfare: %s",
                gangInfo.territoryWarfareEngaged
                    ? "Engaged"
                    : gangInfo.territory == 1
                      ? "Finished"
                      : "Waiting",
            ),
        );
        update(
            ns,
            "------------------------------------------------------------------------------------------------------------",
        );
        update(
            ns,
            ns.sprintf(
                "%10s %20s %6s %6s %6s %6s %6s %6s %6s %8s %8s %6s %2s",
                "Name",
                "Task",
                "Hack",
                "Str",
                "Def",
                "Dex",
                "Agi",
                "Cha",
                "$/s",
                "R/s",
                "Wanted",
                "Respct",
                "EQ",
            ),
        );
        for (const me of fullMembers) {
            update(
                ns,
                ns.sprintf(
                    "%10s %20s %6s %6s %6s %6s %6s %6s %6s %8s %8s %6s %2s",
                    me.name,
                    me.task.substring(0, 19),
                    ns.format.number(me.hack, 1),
                    ns.format.number(me.str, 1),
                    ns.format.number(me.def, 1),
                    ns.format.number(me.dex, 1),
                    ns.format.number(me.agi, 1),
                    ns.format.number(me.cha, 1),
                    ns.format.number(me.moneyGain * 5, 1),
                    ns.format.number(me.respectGain * 5),
                    ns.format.number(me.wantedLevelGain * 5),
                    ns.format.number(me.earnedRespect, 1),
                    geteq(ns, me),
                ),
            );
        }
    } else {
        update(
            ns,
            ns.sprintf(
                "Respect: %s (%s/s)",
                ns.formatNumber(gangInfo.respect),
                ns.formatNumber(gangInfo.respectGainRate * 5),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Next Recruit: %s",
                respectForNext === Number.POSITIVE_INFINITY
                    ? "MAXED"
                    : ns.formatNumber(respectForNext),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Mode: %s  Auto-Ascend: %s  Auto-EQ: %s",
                MODE,
                AUTOASCEND,
                AUTOEQ,
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Wanted Level: %s (%s/s)",
                ns.formatNumber(gangInfo.wantedLevel, 3),
                ns.formatNumber(gangInfo.wantedLevelGainRate * 5, 2),
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Wanted Penalty: %s%s",
                ns.formatNumber((gangInfo.wantedPenalty - 1) * 100),
                "%",
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Money Gains: %s/s",
                ns.formatNumber(moneyIncrease(ns) * 5),
            ),
        );
        if (HASBN4)
            update(
                ns,
                ns.sprintf(
                    "Reputation: %s",
                    ns.formatNumber(await getFacRep(ns, gangInfo.faction)),
                ),
            );
        update(
            ns,
            ns.sprintf(
                "Territory: %s%s",
                ns.formatNumber(gangInfo.territory * 100, 2),
                "%",
            ),
        );
        update(ns, ns.sprintf("Power: %s", ns.formatNumber(gangInfo.power)));
        update(
            ns,
            ns.sprintf(
                "Clash Win Chance: %s%s",
                ns.formatNumber(clashwin() * 100, 2),
                "%",
            ),
        );
        update(
            ns,
            ns.sprintf(
                "Territory Warfare: %s",
                gangInfo.territoryWarfareEngaged
                    ? "Engaged"
                    : gangInfo.territory == 1
                      ? "Finished"
                      : "Waiting",
            ),
        );
        update(
            ns,
            "------------------------------------------------------------------------------------------------------------",
        );
        update(
            ns,
            ns.sprintf(
                "%10s %20s %6s %6s %6s %6s %6s %6s %6s %8s %8s %6s %2s",
                "Name",
                "Task",
                "Hack",
                "Str",
                "Def",
                "Dex",
                "Agi",
                "Cha",
                "$/s",
                "R/s",
                "Wanted",
                "Respct",
                "EQ",
            ),
        );
        for (const me of fullMembers) {
            update(
                ns,
                ns.sprintf(
                    "%10s %20s %6s %6s %6s %6s %6s %6s %6s %8s %8s %6s %2s",
                    me.name,
                    me.task.substring(0, 19),
                    ns.formatNumber(me.hack, 1),
                    ns.formatNumber(me.str, 1),
                    ns.formatNumber(me.def, 1),
                    ns.formatNumber(me.dex, 1),
                    ns.formatNumber(me.agi, 1),
                    ns.formatNumber(me.cha, 1),
                    ns.formatNumber(me.moneyGain * 5, 1),
                    ns.formatNumber(me.respectGain * 5),
                    ns.formatNumber(me.wantedLevelGain * 5),
                    ns.formatNumber(me.earnedRespect, 1),
                    geteq(ns, me),
                ),
            );
        }
    }
    ns.ui.renderTail();
}
/** @param {NS} ns */
async function displaySleeves(ns) {
    update(ns, "Sleeve Statistics:");
    update(
        ns,
        ns.sprintf(
            "%s: %8s %8s %8s %8s %8s %8s %8s %8s %s",
            "#",
            "Hack",
            "Str",
            "Def",
            "Dex",
            "Agi",
            "Cha",
            "Shock",
            "Action",
            "Name",
        ),
    );
    //num, me, task
    const sleeves = await getSleeveObject(ns);
    for (const slv of sleeves) {
        if (ns.ui.getGameInfo()?.versionNumber >= 44)
            update(
                ns,
                ns.sprintf(
                    "%s: %8s %8s %8s %8s %8s %8s %8s %8s %s",
                    slv.num,
                    ns.format.number(slv.me.skills.hacking, 3),
                    ns.format.number(slv.me.skills.strength, 3),
                    ns.format.number(slv.me.skills.defense, 3),
                    ns.format.number(slv.me.skills.dexterity, 3),
                    ns.format.number(slv.me.skills.agility, 3),
                    ns.format.number(slv.me.skills.charisma, 3),
                    ns.format.number(slv.me.shock, 2),
                    slv.task === null ? "Shock Recovery" : slv.task.type,
                    slv.task.actionType ||
                        slv.task.classType ||
                        slv.task.crimeType ||
                        "n/a",
                ),
            );
        else
            update(
                ns,
                ns.sprintf(
                    "%s: %8s %8s %8s %8s %8s %8s %8s %8s %s",
                    slv.num,
                    ns.formatNumber(slv.me.skills.hacking, 3),
                    ns.formatNumber(slv.me.skills.strength, 3),
                    ns.formatNumber(slv.me.skills.defense, 3),
                    ns.formatNumber(slv.me.skills.dexterity, 3),
                    ns.formatNumber(slv.me.skills.agility, 3),
                    ns.formatNumber(slv.me.skills.charisma, 3),
                    ns.formatNumber(slv.me.shock, 2),
                    slv.task === null ? "Shock Recovery" : slv.task.type,
                    slv.task.actionType ||
                        slv.task.classType ||
                        slv.task.crimeType ||
                        "n/a",
                ),
            );
    }
}

/** @param {NS} ns */
function moneyIncrease(ns) {
    let moneygain = 0;
    for (const name of fullMembers) moneygain += name.moneyGain;
    return moneygain;
}

/** @param {NS} ns */
function geteq(ns, soldier) {
    return soldier.augmentations.length + soldier.upgrades.length;
}

/** @param {NS} ns */
function clashwin() {
    let lowestwinchance = 1;
    for (const otherGang of combatGangs.concat(hackingGangs)) {
        if (otherGang === gangInfo.faction) continue;
        else if (otherGangInfo[otherGang].territory <= 0) continue;
        else {
            let othergangpower = otherGangInfo[otherGang].power;
            let winChance = gangInfo.power / (gangInfo.power + othergangpower);
            lowestwinchance = Math.min(lowestwinchance, winChance);
        }
    }
    return lowestwinchance;
}
/** @param {NS} ns */
function fWantedGain(member, task) {
    if (task.baseWanted === 0) return 0;
    let statWeight =
        (task.hackWeight / 100) * member.hack +
        (task.strWeight / 100) * member.str +
        (task.defWeight / 100) * member.def +
        (task.dexWeight / 100) * member.dex +
        (task.agiWeight / 100) * member.agi +
        (task.chaWeight / 100) * member.cha;
    statWeight -= 3.5 * task.difficulty;
    if (statWeight <= 0) return 0;
    const territoryMult = Math.max(
        0.005,
        Math.pow(gangInfo.territory * 100, task.territory.wanted) / 100,
    );
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    if (task.baseWanted < 0) {
        return 0.4 * task.baseWanted * statWeight * territoryMult;
    }
    const calc =
        (7 * task.baseWanted) / Math.pow(3 * statWeight * territoryMult, 0.8);

    // Put an arbitrary cap on this to prevent wanted level from rising too fast if the
    // denominator is very small. Might want to rethink formula later
    return Math.min(100, calc);
}
/** @param {NS} ns */
function fRespectGain(member, task) {
    if (task.baseRespect === 0) return 0;
    let statWeight =
        (task.hackWeight / 100) * member.hack +
        (task.strWeight / 100) * member.str +
        (task.defWeight / 100) * member.def +
        (task.dexWeight / 100) * member.dex +
        (task.agiWeight / 100) * member.agi +
        (task.chaWeight / 100) * member.cha;
    statWeight -= 4 * task.difficulty;
    if (statWeight <= 0) return 0;
    const territoryMult = Math.max(
        0.005,
        Math.pow(gangInfo.territory * 100, task.territory.respect) / 100,
    );
    const territoryPenalty = bitnodeMults
        ? (0.2 * gangInfo.territory + 0.8) * bitnodeMults.GangSoftcap
        : 0.2 * gangInfo.territory + 0.8;
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    const respectMult = calculateWantedPenalty();
    return Math.pow(
        11 * task.baseRespect * statWeight * territoryMult * respectMult,
        territoryPenalty,
    );
}
/** @param {NS} ns */
function fMoneyGain(member, task) {
    if (task.baseMoney === 0) return 0;
    let statWeight =
        (task.hackWeight / 100) * member.hack +
        (task.strWeight / 100) * member.str +
        (task.defWeight / 100) * member.def +
        (task.dexWeight / 100) * member.dex +
        (task.agiWeight / 100) * member.agi +
        (task.chaWeight / 100) * member.cha;

    statWeight -= 3.2 * task.difficulty;
    if (statWeight <= 0) return 0;
    const territoryMult = Math.max(
        0.005,
        Math.pow(gangInfo.territory * 100, task.territory.money) / 100,
    );
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    const respectMult = calculateWantedPenalty();
    let territoryPenalty = bitnodeMults
        ? (0.2 * gangInfo.territory + 0.8) * bitnodeMults.GangSoftcap
        : 0.2 * gangInfo.territory + 0.8;
    return Math.pow(
        5 * task.baseMoney * statWeight * territoryMult * respectMult,
        territoryPenalty,
    );
}

function calculateWantedPenalty() {
    return gangInfo.respect / (gangInfo.respect + gangInfo.wantedLevel);
}
/** @param {NS} ns */
async function maxRepNeeded(ns, faction) {
    const allAugs = await proxy(
        ns,
        "singularity.getAugmentationsFromFaction",
        faction,
    );
    const myAugs = await proxy(ns, "singularity.getOwnedAugmentations", true);
    const factionAugs = allAugs.filter(
        (f) => f !== "NeuroFlux Governor" && !myAugs.includes(f),
    );
    let repNeeded = 0;
    for (const aug of factionAugs)
        if (
            (await proxy(ns, "singularity.getAugmentationRepReq", aug)) >
            repNeeded
        )
            repNeeded = await proxy(
                ns,
                "singularity.getAugmentationRepReq",
                aug,
            );
    return repNeeded;
}
/** @param {NS} ns */
async function getCommands(ns) {
    let silent = false;
    while (ns.peek(16) !== "NULL PORT DATA") {
        let result = ns.readPort(16);
        switch (result) {
            case "popout":
                if (!silent) ns.tprintf("Gang: PopOut On!");
                win = await makeNewWindow("Gang", ns.ui.getTheme());
                break;
            case "nopopout":
                if (!silent) ns.tprintf("Gang: PopOut Off!");
                if (win) win.close();
                break;
            case "AutoAscend On":
                if (!silent) ns.tprintf("Gang: AutoAscend On!");
                AUTOASCEND = true;
                break;
            case "AutoAscend Off":
                if (!silent) ns.tprintf("Gang: AutoAscend Off!");
                AUTOASCEND = false;
                break;
            case "AutoEQ On":
                if (!silent) ns.tprintf("Gang: AutoEQ On!");
                AUTOEQ = true;
                break;
            case "AutoEQ Off":
                if (!silent) ns.tprintf("Gang: AutoEQ Off!");
                AUTOEQ = false;
                break;
            case "Sleeves On":
                if (!silent) ns.tprintf("Gang: Sleeves On!");
                SLEEVES = true;
                break;
            case "Sleeves Off":
                if (!silent) ns.tprintf("Gang: Sleeves Off!");
                SLEEVES = false;
                break;
            case "Respect":
                if (!silent) ns.tprintf("Gang: Respect Mode!");
                MODE = "Respect";
                break;
            case "Money":
                if (!silent) ns.tprintf("Gang: Money Mode!");
                MODE = "Money";
                break;
            case "AutoMode":
                if (!silent) ns.tprintf("Gang: Auto Mode!");
                MODE = "Auto";
                break;
            case "Buy EQ":
                if (!silent) ns.tprintf("Gang: Buy EQ for all!");
                await gangEquip(ns);
                break;
            case "Ascend":
                if (!silent) ns.tprintf("Gang: Ascend Forced");
                await gangAscend(ns, true);
                break;
            case "Silent":
                silent = true;
                break;
            case "NoTrain":
                NOTRAIN = true;
                break;
            default:
                ns.tprintf("Invalid command received in gang: %s", result);
                break;
        }
    }
}

/*const names = ["Rocko", "Mike", "Jack", "Rudo", "Charmichal", "Percy", "Gloria", "Jessica", "Kelly", "Sam", "Gloria", "Sarah",
  "Jackson", "Adam", "Bob", "Carl", "Dominique", "Enrique", "Falcon", "Garry", "Helen", "Ivana", "Jeremy", "Kyle", "Lucca",
  "Max", "Nordic", "Oscar", "Paul", "Q", "Rodric", "Steve", "Trevor", "Ulfric", "Volcof", "Wilson", "Xena", "Yoril", "Z"]
*/
const tasks = [
    "Mug People",
    "Deal Drugs",
    "Strongarm Civilians",
    "Run a Con",
    "Armed Robbery",
    "Traffick Illegal Arms",
    "Threaten & Blackmail",
    "Human Trafficking",
    "Terrorism",
];
const combatGangs = [
    "Speakers for the Dead",
    "The Dark Army",
    "The Syndicate",
    "Tetrads",
    "Slum Snakes",
];
const hackingGangs = ["NiteSec", "The Black Hand"];
