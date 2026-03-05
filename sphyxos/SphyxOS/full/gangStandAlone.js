const WIDTH = 1055;
const HEIGHT = 660;
const GANG_NAME = "Slum Snakes";
const MAX_MEMBERS = 12;
const WIN_WAR_CHANCE = 0.8;
const WAR_CUTOFF = 0.9;
const PURCHASE_UNLOCK = 6000;
const MIN_TERRITORY_START_WAR = 0.99;
const COMBAT_STAT_TRAIN = 60;
const WORKERS = 9 / 12;
let BUYING_GEAR = false;
let MODE = "Respect"; //Respect, Money, Regular
let AUTO = true; //Whether or not we automatically switch workers, turn on buying eq, ascend, etc.
let memberNames;
let fullMembers;
let gangInfo;
let otherGangInfo;
let respectForNext;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();

    let count = 0;
    let prev = 0;
    //Are we in a gang yet?
    ns.gang.createGang(GANG_NAME);
    while (!ns.gang.inGang()) {
        ns.gang.createGang(GANG_NAME);
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
            ns.clearLog();
            ns.printf(
                "Karma: %s / -54000  ETA: %s",
                karma.toFixed(0),
                ns.format.time(result),
            );
            ns.printf("Join Slum Snakes");
            prev = karma;
        }
        await ns.sleep(1000);
    }
    ns.ui.resizeTail(WIDTH, HEIGHT);
    MODE = ns.args.includes("money") ? "Money" : "Respect";
    while (true) {
        memberNames = ns.gang.getMemberNames();
        fullMembers = memberNames.map((m) => ns.gang.getMemberInformation(m));
        gangInfo = ns.gang.getGangInformation();
        otherGangInfo = ns.gang.getOtherGangInformation();
        respectForNext = ns.gang.respectForNextRecruit();

        BUYING_GEAR =
            AUTO && memberNames.length === MAX_MEMBERS
                ? true
                : AUTO
                  ? false
                  : BUYING_GEAR;
        if (memberNames.length !== MAX_MEMBERS) gangRecruit(ns);
        if (AUTO && BUYING_GEAR) gangEquip(ns);
        gangAscend(ns);
        const territoryWinChance = war(ns);
        assignMembers(ns, territoryWinChance);

        updateDisplay(ns);
        //Read in commands - auto, reputation, money, equip, ascend
        await ns.sleep(200);
    }
}

function war(ns) {
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
                ns.gang.setTerritoryWarfare(true);
            }
        } else if (gangInfo.territoryWarfareEngaged) {
            ns.gang.setTerritoryWarfare(false);
        }
        return lowestwinchance;
    } else if (gangInfo.territoryWarfareEngaged) {
        ns.gang.setTerritoryWarfare(false);
    }
    return 1;
}
/** @param {NS} ns */
function assignMembers(ns, territoryWinChance) {
    const sortedNames = fullMembers.sort(
        (a, b) => memberCombatStats(b) - memberCombatStats(a),
    );
    let workJobs = Math.ceil(memberNames.length * WORKERS);
    let wantedLevelIncrease = 0;
    for (let member of sortedNames) {
        let highestTaskValue = 0;
        let highestValueTask = "Train Combat";
        const vigilanteDecrease = fWantedGain(
            member,
            ns.gang.getTaskStats("Vigilante Justice"),
        );
        if (
            workJobs > 0 &&
            gangInfo.territory < 1 &&
            memberNames.length >= MAX_MEMBERS &&
            territoryWinChance < WAR_CUTOFF
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
                if (taskValue(ns, member, task) > highestTaskValue) {
                    highestTaskValue = taskValue(ns, member, task);
                    highestValueTask = task;
                }
            }
            wantedLevelIncrease += fWantedGain(member, highestValueTask) * 5;
            highestValueTask = highestValueTask.name;
        }

        if (member.task != highestValueTask) {
            //ns.tprintf("Assign " + member + " to " + highestValueTask);
            ns.gang.setMemberTask(member.name, highestValueTask);
        }
    }
}
function memberCombatStats(member) {
    return (member.str + member.def + member.dex + member.agi) / 4;
}
/** @param {NS} ns */
function taskValue(ns, member, task) {
    // determine money and reputation gain for a task
    let respect = fRespectGain(ns, member, task);
    let cash = fMoneyGain(ns, member, task); //ns.formulas.gang.moneyGain(gangInfo, member, ns.gang.getTaskStats(task));
    let wantedLevelIncrease = fWantedGain(member, task);
    let vigilanteWantedDecrease = fWantedGain(
        member,
        ns.gang.getTaskStats("Vigilante Justice"),
    );

    if (wantedLevelIncrease + vigilanteWantedDecrease > 0) {
        // avoid tasks where more than one vigilante justice is needed to compensate
        return 0;
    }
    //else if ((2 * wantedLevelIncrease) + vigilanteWantedDecrease > 0) {
    // Simple compensation for wanted level since we need more vigilante then
    // ToDo: Could be a more sophisticated formula here
    //  cash *= 0.75;
    //}
    if (ns.gang.getMemberNames().length >= MAX_MEMBERS) return cash;
    return MODE === "Respect" ? respect : cash;
}
/** @param {NS} ns */
function updateDisplay(ns) {
    ns.clearLog();
    ns.printf("Name: %s", gangInfo.faction);
    ns.printf(
        "Respect: %s (%s/s)",
        ns.format.number(gangInfo.respect),
        ns.format.number(gangInfo.respectGainRate * 5),
    );
    ns.printf(
        "Next Recruit: %s",
        respectForNext === Number.POSITIVE_INFINITY
            ? "MAXED"
            : ns.format.number(respectForNext),
    );
    ns.printf("Mode: %s", MODE);
    ns.printf(
        "Wanted Level: %s (%s/s)",
        ns.format.number(gangInfo.wantedLevel, 3),
        ns.format.number(gangInfo.wantedLevelGainRate * 5, 2),
    );
    ns.printf(
        "Wanted Penalty: %s%s",
        ns.format.number((gangInfo.wantedPenalty - 1) * 100),
        "%",
    );
    ns.printf("Money Gains: %s/s", ns.format.number(moneyIncrease(ns) * 5));
    //ns.printf("Reputation: %s", ns.format.number(ns.singularity.getFactionRep(gangInfo.faction)))
    //if (hasBN(4, 2)) ns.printf("Reputation: %s", ns.format.number(ns.singularity.getFactionRep(gangInfo.faction)))
    ns.printf(
        "Territory: %s%s",
        ns.format.number(gangInfo.territory * 100, 2),
        "%",
    );
    ns.printf("Power: %s", ns.format.number(gangInfo.power));
    ns.printf(
        "Clash Win Chance: %s%s",
        ns.format.number(clashwin(ns) * 100, 2),
        "%",
    );
    ns.printf(
        "Territory Warfare: %s",
        gangInfo.territoryWarfareEngaged
            ? "Engaged"
            : gangInfo.territory == 1
              ? "Finished"
              : "Waiting",
    );
    ns.printf(
        "------------------------------------------------------------------------------------------------------------",
    );
    ns.printf(
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
    );
    for (const me of fullMembers.sort((a, b) => a.str > b.str)) {
        ns.printf(
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
function clashwin(ns) {
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
function fRespectGain(ns, member, task) {
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
    let territoryPenalty;
    try {
        territoryPenalty =
            (0.2 * gangInfo.territory + 0.8) * getBNMults(ns).GangSoftcap;
    } catch {
        territoryPenalty = 0.2 * gangInfo.territory + 0.8;
    }
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    const respectMult = calculateWantedPenalty();
    return Math.pow(
        11 * task.baseRespect * statWeight * territoryMult * respectMult,
        territoryPenalty,
    );
}
/** @param {NS} ns */
function fMoneyGain(ns, member, task) {
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
    let territoryPenalty;
    try {
        territoryPenalty =
            (0.2 * gangInfo.territory + 0.8) * getBNMults(ns).GangSoftcap;
    } catch {
        territoryPenalty = 0.2 * gangInfo.territory + 0.8;
    }
    return Math.pow(
        5 * task.baseMoney * statWeight * territoryMult * respectMult,
        territoryPenalty,
    );
}

function calculateWantedPenalty() {
    return gangInfo.respect / (gangInfo.respect + gangInfo.wantedLevel);
}
/** @param {NS} ns */
function gangEquip(ns) {
    const weaps =
        ns.ui.getGameInfo()?.versionNumber >= 44 ? weaps_new : weaps_old;
    const vehicles =
        ns.ui.getGameInfo()?.versionNumber >= 44 ? vehicles_new : vehicles_old;
    ns.gang.getMemberNames().forEach((m) => {
        augs.forEach((a) => ns.gang.purchaseEquipment(m, a));
        weaps.forEach((a) => ns.gang.purchaseEquipment(m, a));
        armors.forEach((a) => ns.gang.purchaseEquipment(m, a));
        vehicles.forEach((a) => ns.gang.purchaseEquipment(m, a));
        //rootkits.forEach((a) => ns.gang.purchaseEquipment(m, a))
    });
}
/** @param {NS} ns */
function gangAscend(ns) {
    for (let member of memberNames) {
        const memberAscensionResult = ns.gang.getAscensionResult(member);
        if (memberAscensionResult !== undefined) {
            const ascendRequirement = calculateAscendTreshold(ns, member);
            const memberAscensionResultMultiplier =
                (memberAscensionResult.agi +
                    memberAscensionResult.def +
                    memberAscensionResult.dex +
                    memberAscensionResult.str) /
                4;
            if (memberAscensionResultMultiplier > ascendRequirement) {
                ns.gang.ascendMember(member);
            }
        }
    }
}
/** @param {NS} ns */
function calculateAscendTreshold(ns, soldier) {
    const member = ns.gang.getMemberInformation(soldier);
    const mult =
        (member.agi_asc_mult +
            member.def_asc_mult +
            member.dex_asc_mult +
            member.str_asc_mult) /
        4;
    if (mult < 1.632) return 1.6326;
    if (mult < 2.336) return 1.4315;
    if (mult < 2.999) return 1.284;
    if (mult < 3.363) return 1.2125;
    if (mult < 4.253) return 1.1698;
    if (mult < 4.86) return 1.1428;
    if (mult < 5.455) return 1.1225;
    if (mult < 5.977) return 1.0957;
    if (mult < 6.496) return 1.0869;
    if (mult < 7.008) return 1.0789;
    if (mult < 7.519) return 1.073;
    if (mult < 8.025) return 1.0673;
    if (mult < 8.513) return 1.0631;
    if (mult < 20) return 1.0591;
    return 1.04;
}
/** @param {NS} ns */
function gangRecruit(ns) {
    if (ns.gang.canRecruitMember()) {
        let name = names[Math.floor(Math.random() * names.length)];
        while (memberNames.includes(name))
            name = names[Math.floor(Math.random() * names.length)];
        //ns.printf(`INFO: Recruiting: ${name}`)
        ns.gang.recruitMember(name);
    }
}
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
const names = [
    "Rocko",
    "Mike",
    "Jack",
    "Rudo",
    "Charmichal",
    "Percy",
    "Gloria",
    "Jessica",
    "Kelly",
    "Sam",
    "Gloria",
    "Sarah",
    "Jackson",
    "Adam",
    "Bob",
    "Carl",
    "Dominique",
    "Enrique",
    "Falcon",
    "Garry",
    "Helen",
    "Ivana",
    "Jeremy",
    "Kyle",
    "Lucca",
    "Max",
    "Nordic",
    "Oscar",
    "Paul",
    "Q",
    "Rodric",
    "Steve",
    "Trevor",
    "Ulfric",
    "Volcof",
    "Wilson",
    "Xena",
    "Yoril",
    "Z",
];
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
const augs = [
    "Bionic Arms",
    "Bionic Legs",
    "Bionic Spine",
    "BrachiBlades",
    "Nanofiber Weave",
    "Synthetic Heart",
    "Synfibril Muscle",
    "Graphene Bone Lacings",
    "BitWire",
    "Neuralstimulator",
    "DataJack",
];
const weaps_new = [
    "Baseball Bat",
    "Katana",
    "Malorian-3516",
    "Hansen-HA7",
    "Arasaka-HJSH18",
    "Militech-M251s",
    "Nokota-D5",
    "Techtronika-SPT32",
];
const weaps_old = [
    "Baseball Bat",
    "Katana",
    "Glock 18C",
    "P90C",
    "Steyr AUG",
    "AK-47",
    "M15A10 Assault Rifle",
    "AWM Sniper Rifle",
];
const armors = [
    "Bulletproof Vest",
    "Full Body Armor",
    "Liquid Body Armor",
    "Graphene Plating Armor",
];
const vehicles_new = [
    "Herrera Outlaw GTS",
    "Yaiba ASM-R250 Muramasa",
    "Rayfield Caliburn",
    "Quadra Sport R-7",
];
const vehicles_old = [
    "Ford Flex V20",
    "ATX1070 Superbike",
    "Mercedes-Benz S9001",
    "White Ferrari",
];
const rootkits = [
    "NUKE Rootkit",
    "Soulstealer Rootkit",
    "Demon Rootkit",
    "Hmap Node",
    "Jack the Ripper",
];
const combatGangs = [
    "Speakers for the Dead",
    "The Dark Army",
    "The Syndicate",
    "Tetrads",
    "Slum Snakes",
];
const hackingGangs = ["NiteSec", "The Black Hand"];
