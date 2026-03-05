import { hasBN } from "SphyxOS/util.js";
import {
    sleeveSetToCrime,
    sleeveSetToGym,
    sleeveSetToUniversity,
    sleeveGetAugs,
    sleeveIdle,
} from "SphyxOS/util.js";
import {
    getSleeveObject,
    sleeveTravel,
    sleeveShockRecovery,
    sleeveSync,
    sleeveInstallAugs,
    makeNewWindow,
} from "SphyxOS/util.js";

let MODE = "Recovery"; //Training, Money, Recovery, Sync, Karma, Int, Idle
let IMODE = false; // Install Mode
let HASBN5 = 0;
const WIDTH = 1000;
const HEIGHT = 300;
let win;
/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearPort(7);
    ns.writePort(7, ns.pid);
    ns.atExit(() => {
        ns.clearPort(7);
        ns.writePort(1, 1);
        if (win) {
            win.close();
            ns.writePort(1, "sleeves popout off");
        }
    });
    win = false;
    HASBN5 = await hasBN(ns, 5, 1);
    ns.ui.openTail();
    ns.ui.resizeTail(WIDTH, HEIGHT);

    while (true) {
        await getCommands(ns);
        //me, num, task
        const sleeves = await getSleeveObject(ns);
        if (IMODE) await sleeveInstallAugs(ns);
        await displaySleeves(ns, sleeves);
        await ns.sleep(1000);
        for (const slv of sleeves) {
            if (MODE === "Recovery") {
                await sleeveShockRecovery(ns, slv.num);
                continue;
            }
            if (MODE === "Sync") {
                await sleeveSync(ns, slv.num);
                continue;
            }
            if (MODE === "Idle") {
                await sleeveIdle(ns, slv.num);
                continue;
            }
            if (MODE === "Training") {
                debugger;
                const skls = slv.me.skills;
                //Make sure we are in Sector-12
                if (slv.me.city !== "Sector-12") {
                    if (!(await sleeveTravel(ns, slv.num, "Sector-12")))
                        continue;
                }
                if (
                    skls.hacking ===
                    Math.min(
                        skls.hacking,
                        skls.strength,
                        skls.defense,
                        skls.dexterity,
                        skls.agility,
                        skls.charisma,
                    )
                ) {
                    if (
                        slv.task === null ||
                        slv.task.classType !== "Computer Science"
                    ) {
                        await sleeveSetToUniversity(
                            ns,
                            slv.num,
                            "Rothman University",
                            "Computer Science",
                        );
                    }
                    continue;
                }
                if (
                    skls.strength ===
                    Math.min(
                        skls.hacking,
                        skls.strength,
                        skls.defense,
                        skls.dexterity,
                        skls.agility,
                        skls.charisma,
                    )
                ) {
                    if (slv.task === null || slv.task.classType !== "str") {
                        await sleeveSetToGym(
                            ns,
                            slv.num,
                            "Powerhouse Gym",
                            "str",
                        );
                    }
                    continue;
                }
                if (
                    skls.defense ===
                    Math.min(
                        skls.hacking,
                        skls.strength,
                        skls.defense,
                        skls.dexterity,
                        skls.agility,
                        skls.charisma,
                    )
                ) {
                    if (slv.task === null || slv.task.classType !== "def") {
                        await sleeveSetToGym(
                            ns,
                            slv.num,
                            "Powerhouse Gym",
                            "def",
                        );
                    }
                    continue;
                }
                if (
                    skls.dexterity ===
                    Math.min(
                        skls.hacking,
                        skls.strength,
                        skls.defense,
                        skls.dexterity,
                        skls.agility,
                        skls.charisma,
                    )
                ) {
                    if (slv.task === null || slv.task.classType !== "dex") {
                        await sleeveSetToGym(
                            ns,
                            slv.num,
                            "Powerhouse Gym",
                            "dex",
                        );
                    }
                    continue;
                }
                if (
                    skls.agility ===
                    Math.min(
                        skls.hacking,
                        skls.strength,
                        skls.defense,
                        skls.dexterity,
                        skls.agility,
                        skls.charisma,
                    )
                ) {
                    if (slv.task === null || slv.task.classType !== "agi") {
                        await sleeveSetToGym(
                            ns,
                            slv.num,
                            "Powerhouse Gym",
                            "agi",
                        );
                    }
                    continue;
                }
                if (
                    skls.charisma ===
                    Math.min(
                        skls.hacking,
                        skls.strength,
                        skls.defense,
                        skls.dexterity,
                        skls.agility,
                        skls.charisma,
                    )
                ) {
                    if (
                        slv.task === null ||
                        slv.task.classType !== "Leadership"
                    ) {
                        await sleeveSetToUniversity(
                            ns,
                            slv.num,
                            "Rothman University",
                            "Leadership",
                        );
                    }
                    continue;
                }
                ns.tprintf("Error!  Failed to train.");
                continue;
            } //End Training
            if (["Money", "Karma", "Int"].includes(MODE)) {
                //Cycle our crimes and find the best for our mode.
                let bestRatio = 0;
                let bestCrime = "Mug";
                for (const crime of crimes) {
                    const chance = getChance(ns, crime, slv.me);
                    const gain =
                        MODE === "Money"
                            ? crime.money
                            : IMODE
                              ? crime.money
                              : MODE === "Karma"
                                ? crime.karma
                                : crime.intelligence_exp;
                    const ratio = (gain * chance) / crime.time;
                    if (ratio > bestRatio) {
                        bestRatio = ratio;
                        bestCrime = crime.name;
                    }
                }
                if (
                    slv.task === null ||
                    (slv.task && slv.task.crimeType !== bestCrime)
                )
                    await sleeveSetToCrime(ns, slv.num, bestCrime);
                continue;
            }
        } //End of sleeves
    } //End While True
}
/** @param {NS} ns */
async function displaySleeves(ns, sleeves) {
    clearAll(ns);
    update(ns, "Sleeve Statistics:");
    update(ns, ns.sprintf("Mode: %s  Install: %s", MODE, IMODE));
    if (HASBN5)
        update(
            ns,
            ns.sprintf(
                "%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s",
                "#",
                "Hack",
                "Str",
                "Def",
                "Dex",
                "Agi",
                "Cha",
                "Int",
                "Aug",
                "Shock",
                "Action",
                "Name",
            ),
        );
    else
        update(
            ns,
            ns.sprintf(
                "%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s",
                "#",
                "Hack",
                "Str",
                "Def",
                "Dex",
                "Agi",
                "Cha",
                "Aug",
                "Shock",
                "Action",
                "Name",
            ),
        );
    //num, me, task
    for (const slv of sleeves) {
        const augs = await sleeveGetAugs(ns, slv.num);
        if (ns.ui.getGameInfo()?.versionNumber >= 44) {
            if (HASBN5)
                update(
                    ns,
                    ns.sprintf(
                        "%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s %s",
                        slv.num,
                        ns.format.number(slv.me.skills.hacking, 3),
                        ns.format.number(slv.me.skills.strength, 3),
                        ns.format.number(slv.me.skills.defense, 3),
                        ns.format.number(slv.me.skills.dexterity, 3),
                        ns.format.number(slv.me.skills.agility, 3),
                        ns.format.number(slv.me.skills.charisma, 3),
                        ns.format.number(slv.me.skills.intelligence),
                        augs,
                        ns.format.number(slv.me.shock, 2),
                        slv.task === null ? "Shock Recovery" : slv.task?.type,
                        slv.task?.actionType ||
                            slv.task?.classType ||
                            slv.task?.crimeType ||
                            "n/a",
                    ),
                );
            else
                update(
                    ns,
                    ns.sprintf(
                        "%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s %s",
                        slv.num,
                        ns.format.number(slv.me.skills.hacking, 3),
                        ns.format.number(slv.me.skills.strength, 3),
                        ns.format.number(slv.me.skills.defense, 3),
                        ns.format.number(slv.me.skills.dexterity, 3),
                        ns.format.number(slv.me.skills.agility, 3),
                        ns.format.number(slv.me.skills.charisma, 3),
                        augs,
                        ns.format.number(slv.me.shock, 2),
                        slv.task === null ? "Shock Recovery" : slv.task?.type,
                        slv.task?.actionType ||
                            slv.task?.classType ||
                            slv.task?.crimeType ||
                            "n/a",
                    ),
                );
        } else {
            if (HASBN5)
                update(
                    ns,
                    ns.sprintf(
                        "%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s %s",
                        slv.num,
                        ns.formatNumber(slv.me.skills.hacking, 3),
                        ns.formatNumber(slv.me.skills.strength, 3),
                        ns.formatNumber(slv.me.skills.defense, 3),
                        ns.formatNumber(slv.me.skills.dexterity, 3),
                        ns.formatNumber(slv.me.skills.agility, 3),
                        ns.formatNumber(slv.me.skills.charisma, 3),
                        ns.formatNumber(slv.me.skills.intelligence),
                        augs,
                        ns.formatNumber(slv.me.shock, 2),
                        slv.task === null ? "Shock Recovery" : slv.task?.type,
                        slv.task?.actionType ||
                            slv.task?.classType ||
                            slv.task?.crimeType ||
                            "n/a",
                    ),
                );
            else
                update(
                    ns,
                    ns.sprintf(
                        "%s: %8s %8s %8s %8s %8s %8s %8s %3s %5s %8s %s",
                        slv.num,
                        ns.formatNumber(slv.me.skills.hacking, 3),
                        ns.formatNumber(slv.me.skills.strength, 3),
                        ns.formatNumber(slv.me.skills.defense, 3),
                        ns.formatNumber(slv.me.skills.dexterity, 3),
                        ns.formatNumber(slv.me.skills.agility, 3),
                        ns.formatNumber(slv.me.skills.charisma, 3),
                        augs,
                        ns.formatNumber(slv.me.shock, 2),
                        slv.task === null ? "Shock Recovery" : slv.task?.type,
                        slv.task?.actionType ||
                            slv.task?.classType ||
                            slv.task?.crimeType ||
                            "n/a",
                    ),
                );
        }
    }
}
async function getCommands(ns) {
    let silent = false;
    while (ns.peek(17) !== "NULL PORT DATA") {
        let result = ns.readPort(17);
        switch (result) {
            case "popout":
                win = await makeNewWindow("Sleeves", ns.ui.getTheme());
                if (!silent) ns.tprintf("Sleeves: Will use a popout");
                break;
            case "nopopout":
                if (win) win.close();
                win = false;
                if (!silent) ns.tprintf("Sleeves: Will not use a popout");
                break;
            case "Training":
                if (!silent) ns.tprintf("Sleeves: Switched to Training Mode!");
                MODE = "Training";
                break;
            case "Idle":
                if (!silent) ns.tprintf("Sleeves: Switched to Idle Mode!");
                MODE = "Idle";
                break;
            case "Money":
                if (!silent) ns.tprintf("Sleeves: Switched to Money Mode!");
                MODE = "Money";
                break;
            case "Recovery":
                if (!silent) ns.tprintf("Sleeves: Switched to Recovery Mode!");
                MODE = "Recovery";
                break;
            case "Sync":
                if (!silent) ns.tprintf("Sleeves: Switched to Sync Mode!");
                MODE = "Sync";
                break;
            case "Karma":
                if (!silent) ns.tprintf("Sleeves: Switched to Karma Mode!");
                MODE = "Karma";
                break;
            case "Int":
                if (!silent) ns.tprintf("Sleeves: Switched to Int Mode!");
                MODE = "Int";
                break;
            case "Install On":
                if (!silent) ns.tprintf("Sleeves: Switched to Install Mode!");
                IMODE = true;
                break;
            case "Install Off":
                if (!silent) ns.tprintf("Sleeves: Switched off Install Mode!");
                IMODE = false;
                break;
            case "Silent":
                silent = true;
                break;
            default:
                ns.tprintf("Invalid command received in tSleeves: %s", result);
                break;
        }
    }
}
function getChance(ns, crimestats, wsleeve) {
    let hackweight = crimestats.hacking_success_weight * wsleeve.skills.hacking;
    let strweight =
        crimestats.strength_success_weight * wsleeve.skills.strength;
    let defweight = crimestats.defense_success_weight * wsleeve.skills.defense;
    let dexweight =
        crimestats.dexterity_success_weight * wsleeve.skills.dexterity;
    let agiweight = crimestats.agility_success_weight * wsleeve.skills.agility;
    let chaweight =
        crimestats.charisma_success_weight * wsleeve.skills.charisma;
    let intweight = HASBN5 ? 0.025 * wsleeve.skills.intelligence : 0;
    let chance =
        hackweight +
        strweight +
        defweight +
        dexweight +
        agiweight +
        chaweight +
        intweight;
    chance /= 975;
    chance /= crimestats.difficulty;
    chance *= wsleeve.mults.crime_success;
    if (HASBN5)
        chance *= 1 + (1 * Math.pow(wsleeve.skills.intelligence, 0.8)) / 600;
    chance *= 100;
    return Math.min(chance, 100);
}
/** @param {NS} ns */
function clearAll(ns) {
    ns.clearLog();
    if (win) win.clear();
}
/** @param {NS} ns */
function update(ns, text) {
    ns.printf(text);
    if (win && win.closed) {
        win = false;
        ns.writePort(1, "sleeves popout off");
    }
    if (win) win.update(text);
}

const crimes = [
    {
        name: "Shoplift",
        time: 2e3,
        money: 15e3,
        difficulty: 1 / 20,
        karma: 0.1,
        hacking_success_weight: 0,
        strength_success_weight: 0,
        defense_success_weight: 0,
        dexterity_success_weight: 1,
        agility_success_weight: 1,
        charisma_success_weight: 0,
        intelligence_exp: 0,
    },
    {
        name: "Rob Store",
        time: 60e3,
        money: 400e3,
        difficulty: 1 / 5,
        karma: 0.5,
        hacking_success_weight: 0.5,
        strength_success_weight: 0,
        defense_success_weight: 0,
        dexterity_success_weight: 1,
        agility_success_weight: 1,
        charisma_success_weight: 0,
        intelligence_exp: 7.5 * 0.05,
    },
    {
        name: "Mug",
        time: 4e3,
        money: 36e3,
        difficulty: 1 / 5,
        karma: 0.25,
        hacking_success_weight: 0,
        strength_success_weight: 1.5,
        defense_success_weight: 0.5,
        dexterity_success_weight: 1.5,
        agility_success_weight: 0.5,
        charisma_success_weight: 0,
        intelligence_exp: 0,
    },
    {
        name: "Larceny",
        time: 90e3,
        money: 800e3,
        difficulty: 1 / 3,
        karma: 1.5,
        hacking_success_weight: 0.5,
        strength_success_weight: 0,
        defense_success_weight: 0,
        dexterity_success_weight: 1,
        agility_success_weight: 1,
        charisma_success_weight: 0,
        intelligence_exp: 15 * 0.05,
    },
    {
        name: "Deal Drugs",
        time: 10e3,
        money: 120e3,
        difficulty: 1,
        karma: 0.5,
        hacking_success_weight: 0,
        strength_success_weight: 0,
        defense_success_weight: 0,
        charisma_success_weight: 3,
        dexterity_success_weight: 2,
        agility_success_weight: 1,
        intelligence_exp: 0,
    },
    {
        name: "Bond Forgery",
        time: 300e3,
        money: 4.5e6,
        difficulty: 1 / 2,
        karma: 0.1,
        hacking_success_weight: 0.05,
        strength_success_weight: 0,
        defense_success_weight: 0,
        dexterity_success_weight: 1.25,
        agility_success_weight: 0,
        charisma_success_weight: 0,
        intelligence_exp: 60 * 0.05,
    },
    {
        name: "Traffick Arms",
        time: 40e3,
        money: 600e3,
        difficulty: 2,
        karma: 1,
        hacking_success_weight: 0,
        charisma_success_weight: 1,
        strength_success_weight: 1,
        defense_success_weight: 1,
        dexterity_success_weight: 1,
        agility_success_weight: 1,
        charisma_success_weight: 0,
        intelligence_exp: 0,
    },
    {
        name: "Homicide",
        time: 3e3,
        money: 45e3,
        difficulty: 1,
        karma: 3,
        hacking_success_weight: 0,
        strength_success_weight: 2,
        defense_success_weight: 2,
        dexterity_success_weight: 0.5,
        agility_success_weight: 0.5,
        charisma_success_weight: 0,
        intelligence_exp: 0,
    },
    {
        name: "Grand Theft Auto",
        time: 80e3,
        money: 1.6e6,
        difficulty: 8,
        karma: 5,
        hacking_success_weight: 1,
        strength_success_weight: 1,
        defense_success_weight: 0,
        dexterity_success_weight: 4,
        agility_success_weight: 2,
        charisma_success_weight: 2,
        intelligence_exp: 16 * 0.05,
    },
    {
        name: "Kidnap",
        time: 120e3,
        money: 3.6e6,
        difficulty: 5,
        karma: 6,
        hacking_success_weight: 0,
        strength_success_weight: 1,
        defense_success_weight: 0,
        dexterity_success_weight: 1,
        agility_success_weight: 1,
        charisma_success_weight: 1,
        intelligence_exp: 26 * 0.05,
    },
    {
        name: "Assassination",
        time: 300e3,
        money: 12e6,
        difficulty: 8,
        karma: 10,
        hacking_success_weight: 0,
        strength_success_weight: 1,
        defense_success_weight: 0,
        dexterity_success_weight: 2,
        agility_success_weight: 1,
        charisma_success_weight: 0,
        intelligence_exp: 65 * 0.05,
    },
    {
        name: "Heist",
        time: 600e3,
        money: 120e6,
        difficulty: 18,
        karma: 15,
        hacking_success_weight: 1,
        strength_success_weight: 1,
        defense_success_weight: 1,
        dexterity_success_weight: 1,
        agility_success_weight: 1,
        charisma_success_weight: 1,
        intelligence_exp: 130 * 0.05,
    },
];
