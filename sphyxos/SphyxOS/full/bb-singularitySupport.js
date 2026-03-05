const STARTUP_SCRIPT = "Loader.js";
let FINISHER = false;
let INTMODE = true;
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
const SLEEVE_CHANCE = 0.9;
let PRIORITY_CITY = false;
let sleeve_infil = false;
let sleeve_analyze = false;
let sleeve_bounty = false;
let sleeve_retire = false;
let sleeve_tracking = false;
let sleeve_diplomacy = false;
const queues = [];
let queuestask = [null, null, null, null];
let queueswait = 0;

const argsSchema = [
    ["intmode", false],
    ["finisher", false],
    ["lvlup", 1],
    ["sleeveinfilonly", false],
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}
/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    const b = ns.bladeburner;
    init(ns);
    //Are we already in or do we have the stats for it?
    while (!b.joinBladeburnerDivision()) {
        trainUp(ns);
        await ns.sleep(1000);
    }
    ns.ui.resizeTail(WIDTH, HEIGHT);
    for (const contract of ns.bladeburner.getContractNames())
        ns.bladeburner.setActionAutolevel("Contracts", contract, false);
    for (const op of ns.bladeburner.getOperationNames())
        ns.bladeburner.setActionAutolevel("Operations", op, false);
    while (true) {
        //Main loop
        if (HASBN4 && FINISHER) endIt(ns);
        updatedisplay(ns);
        await b.nextUpdate();
        b.joinBladeburnerFaction();
        await updateskills(ns);
        if (SLEEVES_ENABLED) updatesleeves(ns);
        if (queueswait > performance.now()) continue; //Trap inside the start of the loop until our job is done
        if (queues.length > 0) {
            //We have a queued command
            runmission(ns, queues.shift());
            continue;
        }
        if (checkChaos(ns)) {
            queue("General", "Diplomacy", checkChaos(ns), 1);
            continue;
        }
        if (
            gettrainstats(ns) < TRAIN_STATS ||
            b.getStamina()[1] < TRAIN_STAMINA
        ) {
            queue("General", "Training", b.getCity(), 1);
            continue;
        }
        if (b.getStamina()[0] / b.getStamina()[1] < 0.5) {
            queue("General", "Hyperbolic Regeneration Chamber", b.getCity(), 1);
            queue("General", "Training", b.getCity(), 1);
            continue;
        }
        if (checkTracking(ns)) {
            queue("General", "Field Analysis", checkTracking(ns), 1);
            continue;
        }
        const best = getBestMission(ns); // Get the best mission.  null means there are none
        if (best === null) {
            queue("General", "Training", b.getCity(), 1);
            continue;
        } else {
            queue(best[0], best[1], best[2], best[3]);
            continue;
        }
    }
} //End of main
/** @param {NS} ns */
function updatesleeves(ns) {
    let s = ns.sleeve;
    let b = ns.bladeburner;

    // get our sleeve ratings
    const isleeves = [];
    for (let islv = 0; islv < s.getNumSleeves(); islv++) {
        let record = {
            Sleeve: islv,
            Power: getslvpower(ns, islv),
        };
        isleeves.push(record);
        if (s.getSleeve(islv).shock > SLEEVE_SHOCK) {
            s.setToShockRecovery(islv);
        } else if (s.getTask(islv)?.type === "RECOVERY") {
            s.setToIdle(islv);
        }
    }
    isleeves.sort((a, b) => {
        return (
            s.getSleeve(b.Sleeve).storedCycles -
            s.getSleeve(a.Sleeve).storedCycles
        );
    }); //Lowest first so we cycle

    if (SLEEVEINFILSTATUS) {
        const bestslv = isleeves.shift();
        if (!sleeve_infil && s.getTask(bestslv.Sleeve) === null) {
            s.setToBladeburnerAction(bestslv.Sleeve, "Infiltrate Synthoids");
            if (
                s.getSleeve(bestslv.Sleeve).storedCycles >
                s.getTask(bestslv.Sleeve).cyclesNeeded
            ) {
                sleeve_infil = true;
                s.getTask(bestslv.Sleeve).nextCompletion.then(() => {
                    sleeve_infil = false;
                    s.setToIdle(bestslv.Sleeve);
                });
            } else s.setToIdle(bestslv.Sleeve);
        }
    } else {
        //We are assigning all sleeves to their respective tasks
        const cityChaos = b.getCityChaos(b.getCity());
        const analyze =
            b.getActionEstimatedSuccessChance("Contracts", "Tracking")[0] !==
            b.getActionEstimatedSuccessChance("Contracts", "Tracking")[1];
        const stamina = b.getStamina();
        const stamPerc = stamina[0] / stamina[1];
        for (const me of isleeves) {
            let trainSlv = false;
            if (s.getTask(me.Sleeve) !== null) {
                continue; //Our sleeve is working...
            }
            if (
                getsleevestats(ns, me.Sleeve) < SLEEVE_STATS &&
                stamPerc > 0.55
            ) {
                if (s.setToBladeburnerAction(me.Sleeve, "Training")) {
                    if (
                        s.getSleeve(me.Sleeve).storedCycles >
                        s.getTask(me.Sleeve).cyclesNeeded
                    ) {
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            s.setToIdle(me.Sleeve);
                        });
                        continue;
                    } else s.setToIdle(me.Sleeve);
                    continue; // Save up for training.  Move on to the next
                }
            }
            if (
                s.getSleeve(me.Sleeve).hp.current + 2 <=
                s.getSleeve(me.Sleeve).hp.max
            ) {
                s.setToBladeburnerAction(
                    me.Sleeve,
                    "Hyperbolic Regeneration Chamber",
                );
                if (me.Cycles > s.getTask(me.Sleeve).cyclesNeeded) {
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        s.setToIdle(me.Sleeve);
                    });
                    continue;
                } else s.setToIdle(me.Sleeve);
                continue;
            }
            if (!sleeve_analyze && analyze) {
                if (s.setToBladeburnerAction(me.Sleeve, "Field Analysis")) {
                    if (
                        s.getSleeve(me.Sleeve).storedCycles >
                        s.getTask(me.Sleeve).cyclesNeeded
                    ) {
                        sleeve_analyze = true;
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            sleeve_analyze = false;
                            s.setToIdle(me.Sleeve);
                        });
                        continue;
                    } else s.setToIdle(me.Sleeve);
                }
            }
            if (
                !analyze &&
                cityChaos <= CHAOS_FLOOR &&
                !sleeve_tracking &&
                b.getCurrentAction()?.name !== "Tracking" &&
                b.getActionCountRemaining("Contracts", "Tracking") >= 1
            ) {
                for (
                    let i = b.getActionMaxLevel("Contracts", "Tracking");
                    i > 0;
                    i--
                ) {
                    b.setActionLevel("Contracts", "Tracking", i);
                    if (
                        b.getActionEstimatedSuccessChance(
                            "Contracts",
                            "Tracking",
                            me.Sleeve,
                        )[1] >= SLEEVE_CHANCE
                    ) {
                        break;
                    }
                }
                const chance = b.getActionEstimatedSuccessChance(
                    "Contracts",
                    "Tracking",
                    me.Sleeve,
                );
                if (chance[1] < SLEEVE_CHANCE) trainSlv = true;
                else {
                    s.setToBladeburnerAction(
                        me.Sleeve,
                        "Take on contracts",
                        "Tracking",
                    );
                    if (
                        s.getSleeve(me.Sleeve).storedCycles >
                        s.getTask(me.Sleeve).cyclesNeeded
                    ) {
                        sleeve_tracking = true;
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            sleeve_tracking = false;
                            s.setToIdle(me.Sleeve);
                        });
                        continue;
                    } else s.setToIdle(me.Sleeve);
                }
            }
            if (
                !analyze &&
                cityChaos <= CHAOS_FLOOR &&
                b.getCurrentAction()?.name !== "Bounty Hunter" &&
                !sleeve_bounty &&
                b.getActionCountRemaining("Contracts", "Bounty Hunter") >= 1
            ) {
                for (
                    let i = b.getActionMaxLevel("Contracts", "Bounty Hunter");
                    i > 0;
                    i--
                ) {
                    b.setActionLevel("Contracts", "Bounty Hunter", i);
                    if (
                        b.getActionEstimatedSuccessChance(
                            "Contracts",
                            "Bounty Hunter",
                            me.Sleeve,
                        )[1] >= SLEEVE_CHANCE
                    ) {
                        break;
                    }
                }
                const chance = b.getActionEstimatedSuccessChance(
                    "Contracts",
                    "Bounty Hunter",
                    me.Sleeve,
                );
                if (chance[1] < SLEEVE_CHANCE) trainSlv = true;
                else {
                    s.setToBladeburnerAction(
                        me.Sleeve,
                        "Take on contracts",
                        "Bounty Hunter",
                    );
                    if (
                        s.getSleeve(me.Sleeve).storedCycles >
                        s.getTask(me.Sleeve).cyclesNeeded
                    ) {
                        sleeve_bounty = true;
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            sleeve_bounty = false;
                            s.setToIdle(me.Sleeve);
                        });
                        continue;
                    } else s.setToIdle(me.Sleeve);
                }
            }
            if (
                !analyze &&
                cityChaos <= CHAOS_FLOOR &&
                b.getCurrentAction()?.name !== "Retirement" &&
                !sleeve_retire &&
                b.getActionCountRemaining("Contracts", "Retirement") >= 1
            ) {
                for (
                    let i = b.getActionMaxLevel("Contracts", "Retirement");
                    i > 0;
                    i--
                ) {
                    b.setActionLevel("Contracts", "Retirement", i);
                    if (
                        b.getActionEstimatedSuccessChance(
                            "Contracts",
                            "Retirement",
                            me.Sleeve,
                        )[1] >= SLEEVE_CHANCE
                    ) {
                        break;
                    }
                }
                const chance = b.getActionEstimatedSuccessChance(
                    "Contracts",
                    "Retirement",
                    me.Sleeve,
                );
                if (chance[1] < SLEEVE_CHANCE) trainSlv = true;
                else {
                    s.setToBladeburnerAction(
                        me.Sleeve,
                        "Take on contracts",
                        "Retirement",
                    );
                    if (
                        s.getSleeve(me.Sleeve).storedCycles >
                        s.getTask(me.Sleeve).cyclesNeeded
                    ) {
                        sleeve_retire = true;
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            sleeve_retire = false;
                            s.setToIdle(me.Sleeve);
                        });
                        continue;
                    } else s.setToIdle(me.Sleeve);
                }
            }
            if (cityChaos > CHAOS_FLOOR && !sleeve_diplomacy) {
                s.setToBladeburnerAction(me.Sleeve, "Diplomacy");
                if (
                    s.getSleeve(me.Sleeve).storedCycles >
                    s.getTask(me.Sleeve).cyclesNeeded
                ) {
                    sleeve_diplomacy = true;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeve_diplomacy = false;
                        s.setToIdle(me.Sleeve);
                    });
                    continue;
                } else s.setToIdle(me.Sleeve);
            }
            if (!sleeve_infil) {
                s.setToBladeburnerAction(me.Sleeve, "Infiltrate Synthoids");
                if (
                    s.getSleeve(me.Sleeve).storedCycles >
                    s.getTask(me.Sleeve).cyclesNeeded
                ) {
                    sleeve_infil = true;
                    s.getTask(me.Sleeve).nextCompletion.then(() => {
                        sleeve_infil = false;
                        s.setToIdle(me.Sleeve);
                    });
                    continue;
                } else s.setToIdle(me.Sleeve);
            }
            if (trainSlv && stamPerc > 0.55) {
                if (s.setToBladeburnerAction(me.Sleeve, "Training")) {
                    if (
                        s.getSleeve(me.Sleeve).storedCycles >
                        s.getTask(me.Sleeve).cyclesNeeded
                    ) {
                        s.getTask(me.Sleeve).nextCompletion.then(() => {
                            s.setToIdle(me.Sleeve);
                        });
                        continue;
                    } else s.setToIdle(me.Sleeve);
                    continue; // Save up for training.  Move on to the next
                }
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
            const maxUpgrade = calcMaxUpgradeCount(
                ns,
                "Hyperdrive",
                b.getSkillPoints(),
            );
            if (!maxUpgrade) break;
            if (b.getSkillLevel("Hyperdrive") <= Number.MAX_SAFE_INTEGER - 1) {
                b.upgradeSkill("Hyperdrive", maxUpgrade);
                break;
            } else if (maxUpgrade >= b.getSkillLevel("Hyperdrive") / 1e8) {
                b.upgradeSkill("Hyperdrive", maxUpgrade);
                break;
            } else break;
        } else {
            let bestcost = Number.POSITIVE_INFINITY;
            let bestskill = "Hyperdrive";
            for (const skl of b.getSkillNames()) {
                if (skillrating(ns, skl) < bestcost) {
                    bestcost = skillrating(ns, skl);
                    bestskill = skl;
                }
            }
            if (LVLUP > 0 && !b.upgradeSkill(bestskill, LVLUP)) break;
            if (
                LVLUP <= 0 &&
                !b.upgradeSkill(
                    bestskill,
                    calcMaxUpgradeCount(ns, bestskill, b.getSkillPoints()),
                )
            )
                break;
        }
    }
}
function skillrating(ns, skill) {
    let b = ns.bladeburner;
    let mod = 0;
    skillmods.map((x) => {
        x[0] === skill ? (mod = x[1]) : null;
    }); //  ((x => {
    //let cost = calculateCost(ns, skill)
    let cost = b.getSkillUpgradeCost(skill);
    return cost / mod === 0 ? Number.POSITIVE_INFINITY : cost / mod;
}
function cityneedsanalysis(ns, city) {
    const b = ns.bladeburner;
    const startcity = b.getCity();
    b.switchCity(city);
    for (const bop of b.getBlackOpNames()) {
        let chance = b.getActionEstimatedSuccessChance("Black Ops", bop);
        if (chance[0] !== chance[1]) {
            b.switchCity(startcity);
            return true;
        }
    }
    for (const contract of b.getContractNames()) {
        let chance = b.getActionEstimatedSuccessChance("Contracts", contract);
        if (chance[0] !== chance[1]) {
            b.switchCity(startcity);
            return true;
        }
    }
    for (const op of b.getOperationNames()) {
        let chance = b.getActionEstimatedSuccessChance("Operations", op);
        if (chance[0] !== chance[1]) {
            b.switchCity(startcity);
            return true;
        }
    }
    b.switchCity(startcity);
    return false;
}
function checkTracking(ns) {
    for (const city of cities) {
        if (cityneedsanalysis(ns, city)) return city;
    }
    return false;
}
//Returns an array.  [0] is missions name, [1] is missions type, [2] is the city
/** @param {NS} ns */
function getBestMission(ns) {
    let b = ns.bladeburner;

    const startcity = b.getCity();
    let bestresult = 0;
    let bestoperation = null;
    let bestoperationtype = null;
    let bestoperationcity = null;
    let bestoperationlevel = 1;

    let blackops = b
        .getBlackOpNames()
        .filter((x) => b.getActionCountRemaining("Black Ops", x) > 0);
    blackops = blackops.sort((x, y) => {
        return b.getBlackOpRank(y) - b.getBlackOpRank(x);
    });
    let next = blackops.pop();
    if (
        next !== undefined &&
        b.getActionEstimatedSuccessChance("Black Ops", next)[1] >=
            BOPS_SUCCESS_TRY &&
        b.getBlackOpRank(next) <= b.getRank()
    )
        return ["BlackOp", next, b.getCity(), 1];

    for (const city of cities) {
        b.switchCity(city);
        for (const contract of b.getContractNames()) {
            if (contract === "Tracking" && sleeve_tracking) continue; // If a sleeve is doing something, move on.
            if (contract === "Bounty Hunter" && sleeve_bounty) continue; // Not because it causes a conflict
            if (contract === "Retirement" && sleeve_retire) continue; // But so we can focus on getting to Operations
            if (b.getActionCountRemaining("Contracts", contract) < 1) continue;
            for (
                let level = b.getActionMaxLevel("Contracts", contract);
                level > 0;
                level--
            ) {
                b.setActionLevel("Contracts", contract, level);
                if (
                    b.getActionEstimatedSuccessChance(
                        "Contracts",
                        contract,
                    )[1] >= MIN_CHANCE_SUCCESS
                ) {
                    const result =
                        (b.getActionEstimatedSuccessChance(
                            "Contracts",
                            contract,
                        )[1] *
                            b.getActionRepGain("Contracts", contract)) /
                        b.getActionTime("Contracts", contract);
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
            if (b.getActionCountRemaining("Operations", o) < 1) continue;
            for (
                let level = b.getActionMaxLevel("Operations", o);
                level > 0;
                level--
            ) {
                b.setActionLevel("Operations", o, level);
                if (
                    b.getActionEstimatedSuccessChance("Operations", o)[1] >=
                    MIN_CHANCE_SUCCESS
                ) {
                    const result =
                        (b.getActionEstimatedSuccessChance("Operations", o)[1] *
                            b.getActionRepGain("Operations", o)) /
                        b.getActionTime("Operations", o);
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
    b.switchCity(startcity);
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
function checkChaos(ns) {
    let b = ns.bladeburner;

    if (PRIORITY_CITY && b.getCityChaos(PRIORITY_CITY) <= CHAOS_FLOOR)
        PRIORITY_CITY = false;
    if (!PRIORITY_CITY) {
        for (const city of cities) {
            //New emergency?
            if (b.getCityChaos(city) >= CHAOS_TOP) {
                PRIORITY_CITY = city;
                return PRIORITY_CITY;
            }
        }
    }
    return PRIORITY_CITY;
}
/** @param {NS} ns */
function updatedisplay(ns) {
    ns.clearLog();
    const b = ns.bladeburner;
    const s = ns.sleeve;
    ns.printf(
        "Rank: %s  Operations Queued: %s",
        ns.format.number(b.getRank()),
        queues.length,
    );
    ns.printf(
        "Stamina: %s/%s(%s%s)",
        ns.format.number(b.getStamina()[0]),
        ns.format.number(b.getStamina()[1]),
        ns.format.number((b.getStamina()[0] / b.getStamina()[1]) * 100, 2),
        "%",
    );
    ns.printf("Current City: %s", b.getCity());
    ns.printf(
        "Est. Population: %s",
        ns.format.number(b.getCityEstimatedPopulation(b.getCity())),
    );
    ns.printf(
        "Synth Comms: %s",
        ns.format.number(b.getCityCommunities(b.getCity()), 0),
    );
    ns.printf("Chaos: %s", ns.format.number(b.getCityChaos(b.getCity())));
    ns.printf(
        "Skill Points: %s",
        b.getSkillPoints() > 1000
            ? ns.format.number(b.getSkillPoints())
            : b.getSkillPoints(),
    );
    ns.printf(
        "Bonus Time: %s",
        b.getBonusTime() / 1000 >= 1000
            ? ns.format.number(b.getBonusTime() / 1000)
            : b.getBonusTime() / 1000,
    );
    updatemissions(ns);
    if (queuestask.Type === undefined) ns.printf("Current Task: None(0/0)");
    else
        ns.printf(
            "Current Task: %s(%s/%s)  %s",
            queuestask.Type,
            queuestask.Level,
            queuestask.Type === "BlackOp" || queuestask.Type === "General"
                ? 1
                : b.getActionMaxLevel(queuestask.Type, queuestask.Name),
            queuestask.Name,
        );
    queuestask.Type !== undefined
        ? ns.printf(
              "Progress: %s Time: %s",
              updateprogress(
                  b.getActionTime(queuestask.Type, queuestask.Name),
                  b.getActionCurrentTime(),
              ),
              ns.format.time(
                  b.getActionTime(queuestask.Type, queuestask.Name) -
                      b.getActionCurrentTime(),
              ),
          )
        : ns.printf("Progress: %s Time: n/a", updateprogress(10, 0));
    ns.printf(
        "------------------------------------------------------------------------------",
    );
    if (!SLEEVES_ENABLED) ns.printf("SLEEVE SUPPORT DISABLED");
    else {
        for (let slv = 0; slv < s.getNumSleeves(); slv++) {
            let task = s.getTask(slv);
            let cycles =
                s.getSleeve(slv).storedCycles > 1000
                    ? ns.format.number(s.getSleeve(slv).storedCycles, 2)
                    : s.getSleeve(slv).storedCycles;
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
            buf += ns.sprintf(
                "  Augs: %2s%s",
                s.getSleeveAugmentations(slv).length,
                "\n",
            );
            ns.printf("%s", buf);
        }
    }
}
/** @param {NS} ns */
function updatemissions(ns) {
    //Cycle through all the mission types and show how many we currently have in our city and how many we have overall
    let b = ns.bladeburner;

    for (const contract of b.getContractNames()) {
        b.getActionCountRemaining("Contract", contract) >= 1000
            ? ns.printf(
                  "Contracts: " +
                      ns.format.number(
                          b.getActionCountRemaining("Contract", contract),
                      ) +
                      " " +
                      contract,
              )
            : ns.printf(
                  "Contracts: " +
                      ns.format.number(
                          b.getActionCountRemaining("Contract", contract),
                          2,
                      ) +
                      " " +
                      contract,
              );
    }
    for (const operation of b.getOperationNames()) {
        b.getActionCountRemaining("Operation", operation) >= 1000
            ? ns.printf(
                  "Operation: " +
                      ns.format.number(
                          b.getActionCountRemaining("Operation", operation),
                      ) +
                      " " +
                      operation,
              )
            : ns.printf(
                  "Operation: " +
                      ns.format.number(
                          b.getActionCountRemaining("Operation", operation),
                          2,
                      ) +
                      " " +
                      operation,
              );
    }
}
/** @param {NS} ns */
function updateprogress(max_time, run_time) {
    let done = run_time > 0 ? Math.max(max_time / run_time, 1) : 0;
    let buffer = "[";
    if (done > 0) buffer = buffer.padEnd(Math.round(20 / done), "|");
    if (done > 0) buffer += "*";
    buffer = buffer.padEnd(21, "-");
    buffer += "]";

    return buffer;
}
/** @param {NS} ns */
function runmission(ns, best) {
    //best.Type, best.Name, best.City, best.Level
    let b = ns.bladeburner;
    queuestask = best;
    const action = b.getCurrentAction();
    //Resuming?
    if (
        action !== null &&
        best.City === b.getCity() &&
        best.Type === action.type &&
        best.Name === action.name &&
        (best.Type === "General" ||
            best.Type === "BlackOp" ||
            best.Level === b.getActionCurrentLevel(best.Type, best.Name))
    ) {
        if (b.getBonusTime() - 1000 > b.getActionTime(best.Type, best.Name)) {
            //All under bonus time
            queueswait =
                performance.now() +
                Math.max(
                    b.getActionTime(best.Type, best.Name) / 5 -
                        b.getActionCurrentTime(),
                    500,
                );
        } else
            queueswait =
                performance.now() +
                Math.max(
                    b.getActionTime(best.Type, best.Name) -
                        b.getBonusTime() -
                        b.getActionCurrentTime(),
                    500,
                );
    } else {
        //New action
        if (b.getCity() !== best.City) b.switchCity(best.City);
        try {
            b.setActionLevel(best.Type, best.Name, best.Level);
        } catch {
            /*Catch the unlevelable actions*/
        }
        b.startAction(best.Type, best.Name);
        if (b.getBonusTime() - 1000 > b.getActionTime(best.Type, best.Name)) {
            //All under bonus time
            queueswait =
                performance.now() +
                Math.max(b.getActionTime(best.Type, best.Name) / 5, 500);
        } else
            queueswait =
                performance.now() +
                Math.max(
                    b.getActionTime(best.Type, best.Name) - b.getBonusTime(),
                    500,
                );
    }
}
function gettrainstats(ns) {
    const me = ns.getPlayer();
    return (
        (me.skills.agility +
            me.skills.defense +
            me.skills.dexterity +
            me.skills.strength) /
        4
    );
}
/** @param {NS} ns */
function getsleevestats(ns, slv) {
    const s = ns.sleeve.getSleeve(slv);
    return (
        (s.skills.agility +
            s.skills.defense +
            s.skills.dexterity +
            s.skills.strength) /
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
function init(ns) {
    try {
        // Enable Sleeves
        ns.sleeve.getNumSleeves();
        SLEEVES_ENABLED = true;
    } catch {
        SLEEVES_ENABLED = false;
    }
    sleeve_infil = false;
    sleeve_analyze = false;
    sleeve_tracking = false;
    sleeve_bounty = false;
    sleeve_retire = false;
    sleeve_diplomacy = false;
    queues.length = 0;
    if (SLEEVES_ENABLED)
        for (let slv = 0; slv < ns.sleeve.getNumSleeves(); slv++)
            ns.sleeve.setToIdle(slv);
    HASBN4 = hasBN(ns, 4, 2);
    queuestask = [null, null, null, null];
    queueswait = 0;
    PRIORITY_CITY = false;
    const data = ns.flags(argsSchema);
    LVLUP = data.lvlup;
    FINISHER = data.finisher;
    INTMODE = data.intmode;
    SLEEVEINFILSTATUS = data.sleeveinfilonly;
}
/** @param {NS} ns */
function trainUp(ns) {
    const me = ns.getPlayer();
    const skls = me.skills;
    const wrk = HASBN4 ? ns.singularity.getCurrentWork() : false;
    if (me.city !== "Sector-12") {
        ns.clearLog();
        //Travel to our Gym
        ns.print("Please go to Sector-12");
        if (HASBN4) ns.singularity.travelToCity("Sector-12");
    } else if (skls.strength < CSTATS) {
        ns.clearLog();
        ns.print("Train Str to 100");
        if (HASBN4 && (wrk === null || wrk.classType !== "str"))
            ns.singularity.gymWorkout("Powerhouse Gym", "str", false);
    } else if (skls.defense < CSTATS) {
        ns.clearLog();
        ns.print("Train Def to 100");
        if (HASBN4 && (wrk === null || (wrk && wrk.classType !== "def")))
            ns.singularity.gymWorkout("Powerhouse Gym", "def", false);
    } else if (skls.dexterity < CSTATS) {
        ns.clearLog();
        ns.print("Train Dex to 100");
        if (HASBN4 && (wrk === null || (wrk && wrk.classType !== "dex")))
            ns.singularity.gymWorkout("Powerhouse Gym", "dex", false);
    } else if (skls.agility < CSTATS) {
        ns.clearLog();
        ns.print("Train Agi to 100");
        if (HASBN4 && (wrk === null || (wrk && wrk.classType !== "agi")))
            ns.singularity.gymWorkout("Powerhouse Gym", "agi", false);
    }
}
/** @param {NS} ns */
function hasBN(ns, bn, bnLvl = 1) {
    const resetInfo = ns.getResetInfo();
    const sourceFiles = [];
    for (const item of ns.getResetInfo().ownedSF) {
        const record = {
            n: item[0],
            lvl: item[1],
        };
        sourceFiles.push(record);
    }
    if (resetInfo.currentNode === bn) {
        return true;
    }
    for (const sf of sourceFiles)
        if (sf.n === bn && sf.lvl >= bnLvl) {
            return true;
        }
    return false;
}
/** @param {NS} ns */
function getslvpower(ns, slv) {
    let s = ns.sleeve;
    let skill = s.getSleeve(slv).skills;
    return (
        (skill.agility +
            skill.defense +
            skill.dexterity +
            skill.strength +
            skill.charisma +
            skill.hacking) /
        6
    );
}
/** @param {NS} ns */
function calcMaxUpgradeCount(ns, skill, cost) {
    const b = ns.bladeburner;
    let baseCost;
    let costInc;
    const currentLevel = b.getSkillLevel(skill);
    const currentNodeMults = getBNMults(ns);
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
    const costOfResultPlus1 = calculateCost(ns, skill, result + 1);
    if (costOfResultPlus1 <= cost) {
        return result + 1;
    }
    const costOfResult = calculateCost(ns, skill, result);
    if (costOfResult <= cost) {
        return result;
    }
    return result - 1;
}
function calculateCost(ns, skill, count = 1) {
    const currentLevel = ns.bladeburner.getSkillLevel(skill);
    const actualCount = currentLevel + count - currentLevel;
    let baseCost;
    let costInc;
    const currentNodeMults = getBNMults(ns);
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
function endIt(ns) {
    ns.singularity.destroyW0r1dD43m0n(getNextBN(ns), STARTUP_SCRIPT);
}
/** @param {NS} ns */
function getNextBN(ns) {
    let nextbn = 0;
    let nextbnlvl = 0;
    for (let check of bnorder) {
        let isthere = false;
        for (const bn of ns.singularity.getOwnedSourceFiles()) {
            let bonus = 0;
            if (ns.getResetInfo().currentNode == check[0]) bonus = 1;
            if (bn.n == check[0] && bn.lvl + bonus >= check[1]) isthere = true;
            if (bn.n == ns.getResetInfo().currentNode && 1 >= check[1])
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
/** @param {NS} ns */
function getBNMults(ns) {
    let mults;
    try {
        mults = ns.getBitNodeMultipliers();
    } catch {
        const resetInfo = ns.getResetInfo();
        let record = {
            AgilityLevelMultiplier: 1,
            AugmentationMoneyCost: 1,
            AugmentationRepCost: 1,
            BladeburnerRank: 1,
            BladeburnerSkillCost: 1,
            CharismaLevelMultiplier: 1,
            ClassGymExpGain: 1,
            CodingContractMoney: 1,
            CompanyWorkExpGain: 1,
            CompanyWorkMoney: 1,
            CompanyWorkRepGain: 1,
            CorporationValuation: 1,
            CrimeExpGain: 1,
            CrimeMoney: 1,
            CrimeSuccessRate: 1,
            DaedalusAugsRequirement: 30,
            DefenseLevelMultiplier: 1,
            DexterityLevelMultiplier: 1,
            FactionPassiveRepGain: 1,
            FactionWorkExpGain: 1,
            FactionWorkRepGain: 1,
            FourSigmaMarketDataApiCost: 1,
            FourSigmaMarketDataCost: 1,
            GangSoftcap: 1,
            GangUniqueAugs: 1,
            GoPower: 1,
            HackExpGain: 1,
            HackingLevelMultiplier: 1,
            HackingSpeedMultiplier: 1,
            HacknetNodeMoney: 1,
            HomeComputerRamCost: 1,
            InfiltrationMoney: 1,
            InfiltrationRep: 1,
            ManualHackMoney: 1,
            PurchasedServerCost: 1,
            PurchasedServerSoftcap: 1,
            PurchasedServerLimit: 1,
            PurchasedServerMaxRam: 1,
            FavorToDonateToFaction: 1, //New
            RepToDonateToFaction: 1, //Old
            ScriptHackMoney: 1,
            ScriptHackMoneyGain: 1,
            ServerGrowthRate: 1,
            ServerMaxMoney: 1,
            ServerStartingMoney: 1,
            ServerStartingSecurity: 1,
            ServerWeakenRate: 1,
            StrengthLevelMultiplier: 1,
            StaneksGiftPowerMultiplier: 1,
            StaneksGiftExtraSize: 0,
            WorldDaemonDifficulty: 1,
            CorporationSoftcap: 1,
            CorporationDivisions: 1,
        };
        switch (resetInfo.currentNode) {
            case 1:
                break;
            case 2:
                record.HackingLevelMultiplier = 0.8;
                record.ServerGrowthRate = 0.8;
                record.ServerStartingMoney = 0.4;
                record.PurchasedServerSoftcap = 1.3;
                record.CrimeMoney = 3;
                record.FactionPassiveRepGain = 0;
                record.FactionWorkRepGain = 0.5;
                record.CorporationSoftcap = 0.9;
                record.CorporationDivisions = 0.9;
                record.InfiltrationMoney = 3;
                record.StaneksGiftPowerMultiplier = 2;
                record.StaneksGiftExtraSize = -6;
                record.WorldDaemonDifficulty = 5;
                break;
            case 3:
                record.HackingLevelMultiplier = 0.8;
                record.ServerGrowthRate = 0.2;
                record.ServerMaxMoney = 0.04;
                record.ServerStartingMoney = 0.2;
                record.HomeComputerRamCost = 1.5;
                record.PurchasedServerCost = 2;
                record.PurchasedServerSoftcap = 1.3;
                record.CompanyWorkMoney = 0.25;
                record.CrimeMoney = 0.25;
                record.HacknetNodeMoney = 0.25;
                record.ScriptHackMoney = 0.2;
                record.FavorToDonateToFaction = 0.5; //New
                record.RepToDonateToFaction = 0.5; //Old
                record.AugmentationMoneyCost = 3;
                record.AugmentationRepCost = 3;
                record.GangSoftcap = 0.9;
                record.GangUniqueAugs = 0.5;
                record.StaneksGiftPowerMultiplier = 0.75;
                record.StaneksGiftExtraSize = -2;
                record.WorldDaemonDifficulty = 2;
                break;
            case 4:
                record.ServerMaxMoney = 0.1125;
                record.ServerStartingMoney = 0.75;
                record.PurchasedServerSoftcap = 1.2;
                record.CompanyWorkMoney = 0.1;
                record.CrimeMoney = 0.2;
                record.HacknetNodeMoney = 0.05;
                record.ScriptHackMoney = 0.2;
                record.ClassGymExpGain = 0.5;
                record.CompanyWorkExpGain = 0.5;
                record.CrimeExpGain = 0.5;
                record.FactionWorkExpGain = 0.5;
                record.HackExpGain = 0.4;
                record.FactionWorkRepGain = 0.75;
                record.GangUniqueAugs = 0.5;
                record.StaneksGiftPowerMultiplier = 1.5;
                record.StaneksGiftExtraSize = 0;
                record.WorldDaemonDifficulty = 3;
                break;
            case 5:
                record.ServerStartingSecurity = 2;
                record.ServerStartingMoney = 0.5;
                record.PurchasedServerSoftcap = 1.2;
                record.CrimeMoney = 0.5;
                record.HacknetNodeMoney = 0.2;
                record.ScriptHackMoney = 0.15;
                record.HackExpGain = 0.5;
                record.AugmentationMoneyCost = 2;
                record.InfiltrationMoney = 1.5;
                record.InfiltrationRep = 1.5;
                record.CorporationValuation = 0.75;
                record.CorporationDivisions = 0.75;
                record.GangUniqueAugs = 0.5;
                record.StaneksGiftPowerMultiplier = 1.3;
                record.StaneksGiftExtraSize = 0;
                record.WorldDaemonDifficulty = 1.5;
                break;
            case 6:
                record.HackingLevelMultiplier = 0.35;
                record.ServerMaxMoney = 0.2;
                record.ServerStartingMoney = 0.5;
                record.ServerStartingSecurity = 1.5;
                record.PurchasedServerSoftcap = 2;
                record.CompanyWorkMoney = 0.5;
                record.CrimeMoney = 0.75;
                record.HacknetNodeMoney = 0.2;
                record.ScriptHackMoney = 0.75;
                record.HackExpGain = 0.25;
                record.InfiltrationMoney = 0.75;
                record.CorporationValuation = 0.2;
                record.CorporationSoftcap = 0.9;
                record.CorporationDivisions = 0.8;
                record.GangSoftcap = 0.7;
                record.GangUniqueAugs = 0.2;
                record.DaedalusAugsRequirement = 35;
                record.StaneksGiftPowerMultiplier = 0.5;
                record.StaneksGiftExtraSize = 2;
                record.WorldDaemonDifficulty = 2;
                break;
            case 7:
                record.HackingLevelMultiplier = 0.35;
                record.ServerMaxMoney = 0.2;
                record.ServerStartingMoney = 0.5;
                record.ServerStartingSecurity = 1.5;
                record.PurchasedServerSoftcap = 2;
                record.CompanyWorkMoney = 0.5;
                record.CrimeMoney = 0.75;
                record.HacknetNodeMoney = 0.2;
                record.ScriptHackMoney = 0.5;
                record.HackExpGain = 0.25;
                record.AugmentationMoneyCost = 3;
                record.InfiltrationMoney = 0.75;
                record.FourSigmaMarketDataCost = 2;
                record.FourSigmaMarketDataApiCost = 2;
                record.CorporationValuation = 0.2;
                record.CorporationSoftcap = 0.9;
                record.CorporationDivisions = 0.8;
                record.BladeburnerRank = 0.6;
                record.BladeburnerSkillCost = 2;
                record.GangSoftcap = 0.7;
                record.GangUniqueAugs = 0.2;
                record.DaedalusAugsRequirement = 35;
                record.StaneksGiftPowerMultiplier = 0.9;
                record.StaneksGiftExtraSize = -1;
                record.WorldDaemonDifficulty = 2;
                break;
            case 8:
                record.PurchasedServerSoftcap = 4;
                record.CompanyWorkMoney = 0;
                record.CrimeMoney = 0;
                record.HacknetNodeMoney = 0;
                record.ManualHackMoney = 0;
                record.ScriptHackMoney = 0.3;
                record.ScriptHackMoneyGain = 0;
                record.CodingContractMoney = 0;
                record.FavorToDonateToFaction = 0; //New
                record.RepToDonateToFaction = 0; //Old
                record.InfiltrationMoney = 0;
                record.CorporationValuation = 0;
                record.CorporationSoftcap = 0;
                record.CorporationDivisions = 0;
                record.BladeburnerRank = 0;
                record.GangSoftcap = 0;
                record.GangUniqueAugs = 0;
                record.StaneksGiftExtraSize = -99;
                break;
            case 9:
                record.HackingLevelMultiplier = 0.5;
                record.StrengthLevelMultiplier = 0.45;
                record.DefenseLevelMultiplier = 0.45;
                record.DexterityLevelMultiplier = 0.45;
                record.AgilityLevelMultiplier = 0.45;
                record.CharismaLevelMultiplier = 0.45;
                record.ServerMaxMoney = 0.01;
                record.ServerStartingMoney = 0.1;
                record.ServerStartingSecurity = 2.5;
                record.HomeComputerRamCost = 5;
                record.PurchasedServerLimit = 0;
                record.CrimeMoney = 0.5;
                record.ScriptHackMoney = 0.1;
                record.HackExpGain = 0.05;
                record.FourSigmaMarketDataCost = 5;
                record.FourSigmaMarketDataApiCost = 4;
                record.CorporationValuation = 0.5;
                record.CorporationSoftcap = 0.75;
                record.CorporationDivisions = 0.8;
                record.BladeburnerRank = 0.9;
                record.BladeburnerSkillCost = 1.2;
                record.GangSoftcap = 0.8;
                record.GangUniqueAugs = 0.25;
                record.StaneksGiftPowerMultiplier = 0.5;
                record.StaneksGiftExtraSize = 2;
                record.WorldDaemonDifficulty = 2;
                break;
            case 10:
                record.HackingLevelMultiplier = 0.35;
                record.StrengthLevelMultiplier = 0.4;
                record.DefenseLevelMultiplier = 0.4;
                record.DexterityLevelMultiplier = 0.4;
                record.AgilityLevelMultiplier = 0.4;
                record.CharismaLevelMultiplier = 0.4;
                record.HomeComputerRamCost = 1.5;
                record.PurchasedServerCost = 5;
                record.PurchasedServerSoftcap = 1.1;
                record.PurchasedServerLimit = 0.6;
                record.PurchasedServerMaxRam = 0.5;
                record.CompanyWorkMoney = 0.5;
                record.CrimeMoney = 0.5;
                record.HacknetNodeMoney = 0.5;
                record.ManualHackMoney = 0.5;
                record.ScriptHackMoney = 0.5;
                record.CodingContractMoney = 0.5;
                record.AugmentationMoneyCost = 5;
                record.AugmentationRepCost = 2;
                record.InfiltrationMoney = 0.5;
                record.CorporationValuation = 0.5;
                record.CorporationSoftcap = 0.9;
                record.CorporationDivisions = 0.9;
                record.BladeburnerRank = 0.8;
                record.GangSoftcap = 0.9;
                record.GangUniqueAugs = 0.25;
                record.StaneksGiftPowerMultiplier = 0.75;
                record.StaneksGiftExtraSize = -3;
                record.WorldDaemonDifficulty = 2;
                break;
            case 11:
                record.HackingLevelMultiplier = 0.6;
                record.ServerGrowthRate = 0.2;
                record.ServerMaxMoney = 0.01;
                record.ServerStartingMoney = 0.1;
                record.ServerWeakenRate = 2;
                record.PurchasedServerSoftcap = 2;
                record.CompanyWorkMoney = 0.5;
                record.CrimeMoney = 3;
                record.HacknetNodeMoney = 0.1;
                record.CodingContractMoney = 0.25;
                record.HackExpGain = 0.5;
                record.AugmentationMoneyCost = 2;
                record.InfiltrationMoney = 2.5;
                record.InfiltrationRep = 2.5;
                record.FourSigmaMarketDataCost = 4;
                record.FourSigmaMarketDataApiCost = 4;
                record.CorporationValuation = 0.1;
                record.CorporationSoftcap = 0.9;
                record.CorporationDivisions = 0.9;
                record.GangUniqueAugs = 0.75;
                record.WorldDaemonDifficulty = 1.5;
                break;
            case 12:
                const sourceFiles = [];
                for (const item of ns.getResetInfo().ownedSF) {
                    const record = {
                        n: item[0],
                        lvl: item[1],
                    };
                    sourceFiles.push(record);
                }
                let SF12LVL = 1;
                for (const sf of sourceFiles) {
                    if (sf.n === 12) {
                        SF12LVL = sf.lvl + 1;
                        break;
                    }
                }
                const inc = Math.pow(1.02, SF12LVL);
                const dec = 1 / inc;

                record.DaedalusAugsRequirement = Math.floor(
                    Math.min(record.DaedalusAugsRequirement + inc, 40),
                );
                record.HackingLevelMultiplier = dec;
                record.StrengthLevelMultiplier = dec;
                record.DefenseLevelMultiplier = dec;
                record.DexterityLevelMultiplier = dec;
                record.AgilityLevelMultiplier = dec;
                record.CharismaLevelMultiplier = dec;
                record.ServerGrowthRate = dec;
                record.ServerMaxMoney = dec * dec;
                record.ServerStartingMoney = dec;
                record.ServerWeakenRate = dec;
                record.ServerStartingSecurity = 1.5;
                record.HomeComputerRamCost = inc;
                record.PurchasedServerCost = inc;
                record.PurchasedServerSoftcap = inc;
                record.PurchasedServerLimit = dec;
                record.PurchasedServerMaxRam = dec;
                record.CompanyWorkMoney = dec;
                record.CrimeMoney = dec;
                record.HacknetNodeMoney = dec;
                record.ManualHackMoney = dec;
                record.ScriptHackMoney = dec;
                record.CodingContractMoney = dec;
                record.ClassGymExpGain = dec;
                record.CompanyWorkExpGain = dec;
                record.CrimeExpGain = dec;
                record.FactionWorkExpGain = dec;
                record.HackExpGain = dec;
                record.FactionPassiveRepGain = dec;
                record.FactionWorkRepGain = dec;
                record.FavorToDonateToFaction = inc;
                record.AugmentationMoneyCost = inc;
                record.AugmentationRepCost = inc;
                record.InfiltrationMoney = dec;
                record.InfiltrationRep = dec;
                record.FourSigmaMarketDataCost = inc;
                record.FourSigmaMarketDataApiCost = inc;
                record.CorporationValuation = dec;
                record.CorporationSoftcap = 0.8;
                record.CorporationDivisions = 0.5;
                record.BladeburnerRank = dec;
                record.BladeburnerSkillCost = inc;
                record.GangSoftcap = 0.8;
                record.GangUniqueAugs = dec;
                record.StaneksGiftPowerMultiplier = inc;
                record.StaneksGiftExtraSize = inc;
                record.WorldDaemonDifficulty = inc;
                break;
            case 13:
                record.HackingLevelMultiplier = 0.25;
                record.StrengthLevelMultiplier = 0.7;
                record.DefenseLevelMultiplier = 0.7;
                record.DexterityLevelMultiplier = 0.7;
                record.AgilityLevelMultiplier = 0.7;
                record.PurchasedServerSoftcap = 1.6;
                record.ServerMaxMoney = 0.3375;
                record.ServerStartingMoney = 0.75;
                record.ServerStartingSecurity = 3;
                record.CompanyWorkMoney = 0.4;
                record.CrimeMoney = 0.4;
                record.HacknetNodeMoney = 0.4;
                record.ScriptHackMoney = 0.2;
                record.CodingContractMoney = 0.4;
                record.ClassGymExpGain = 0.5;
                record.CompanyWorkExpGain = 0.5;
                record.CrimeExpGain = 0.5;
                record.FactionWorkExpGain = 0.5;
                record.HackExpGain = 0.1;
                record.FactionWorkRepGain = 0.6;
                record.FourSigmaMarketDataCost = 10;
                record.FourSigmaMarketDataApiCost = 10;
                record.CorporationValuation = 0.001;
                record.CorporationSoftcap = 0.4;
                record.CorporationDivisions = 0.4;
                record.BladeburnerRank = 0.45;
                record.BladeburnerSkillCost = 2;
                record.GangSoftcap = 0.3;
                record.GangUniqueAugs = 0.1;
                record.StaneksGiftPowerMultiplier = 2;
                record.StaneksGiftExtraSize = 1;
                record.WorldDaemonDifficulty = 3;
                break;
            case 14:
                record.GoPower = 4;
                record.HackingLevelMultiplier = 0.4;
                record.HackingSpeedMultiplier = 0.3;
                record.ServerMaxMoney = 0.7;
                record.ServerStartingMoney = 0.5;
                record.ServerStartingSecurity = 1.5;
                record.CrimeMoney = 0.75;
                record.CrimeSuccessRate = 0.4;
                record.HacknetNodeMoney = 0.25;
                record.ScriptHackMoney = 0.3;
                record.StrengthLevelMultiplier = 0.5;
                record.DexterityLevelMultiplier = 0.5;
                record.AgilityLevelMultiplier = 0.5;
                record.AugmentationMoneyCost = 1.5;
                record.InfiltrationMoney = 0.75;
                record.FactionWorkRepGain = 0.2;
                record.CompanyWorkRepGain = 0.2;
                record.CorporationValuation = 0.4;
                record.CorporationSoftcap = 0.9;
                record.CorporationDivisions = 0.8;
                record.BladeburnerRank = 0.6;
                record.BladeburnerSkillCost = 2;
                record.GangSoftcap = 0.7;
                record.GangUniqueAugs = 0.4;
                record.StaneksGiftPowerMultiplier = 0.5;
                record.StaneksGiftExtraSize = -1;
                record.WorldDaemonDifficulty = 5;
                break;
        }
        mults = record;
    }
    return mults;
}
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
