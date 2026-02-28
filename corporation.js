/**
 * Corporation management script using temp script pattern for low RAM usage
 * Manages corporation from creation through all investment rounds
 */

import { log, getConfiguration, disableLogs, formatMoney, getErrorInfo, getNsDataThroughFile } from './helpers.js'
import {
    INDUSTRIES, CITIES, calculateOptimalBoostMaterials, calculateOptimalPrice,
    calculateSmartSupplyQuantities, calculateOptimalPartyCost,
    getProductName, shouldAcceptInvestment
} from './corp-helpers.js'

const argsSchema = [
    ['tail', false],
    ['self-fund', false],
    ['corp-name', 'NoodleCorp'],
    ['round', 0],
    ['target-round', 4],
    ['auto-invest', true],
    ['smart-supply', true],
    ['market-ta', true],
    ['verbose', false],
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

// Ram dodging helper to execute a corporation function
const execCorpFunc = async (ns, strFunction, ...args) =>
    await getNsDataThroughFile(ns, `ns.corporation.${strFunction}`, null, args);

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    if (options.tail) ns.tail();
    disableLogs(ns, ['sleep', 'getServerMoneyAvailable', 'run', 'read', 'write', 'isRunning']);

    const state = new CorpState(ns, options);

    if (!(await execCorpFunc(ns, 'hasCorporation()'))) {
        await initCorporation(ns, state);
    }

    log(ns, 'INFO: Corporation manager starting...', true, 'info');

    while (true) {
        try {
            await runCorpCycle(ns, state);
        } catch (err) {
            log(ns, `WARNING: Corp cycle error: ${getErrorInfo(err)}`, false, 'warning');
        }
        await ns.sleep(1000);
    }
}

class CorpState {
    constructor(ns, options) {
        this.options = options;
        this.round = options.round || 0;
        this.productVersion = 1;
        this.lastTeaParty = 0;
        this.initialized = false;
    }

    async init(ns) {
        if (this.initialized) return;
        this.round = this.options.round || await this.detectRound(ns);
        this.initialized = true;
    }

    async detectRound(ns) {
        if (!(await execCorpFunc(ns, 'hasCorporation()'))) return 0;

        const corpData = await execCorpFunc(ns, 'getCorporation()');
        const numInvestments = corpData.numShares > 1e9 ? 0 :
            corpData.numShares > 900e6 ? 1 :
                corpData.numShares > 800e6 ? 2 :
                    corpData.numShares > 700e6 ? 3 : 4;

        return numInvestments + 1;
    }
}

async function initCorporation(ns, state) {
    const options = state.options;

    log(ns, `Creating corporation: ${options['corp-name']}`);

    if (options['self-fund']) {
        const cost = 150e9;
        if (ns.getServerMoneyAvailable('home') < cost) {
            log(ns, `ERROR: Need ${formatMoney(cost)} to self-fund corporation`, true, 'error');
            return false;
        }
        await execCorpFunc(ns, 'createCorporation(ns.args[0], ns.args[1])', options['corp-name'], true);
    } else {
        await execCorpFunc(ns, 'createCorporation(ns.args[0], ns.args[1])', options['corp-name'], false);
    }

    state.round = 1;
    return true;
}

async function runCorpCycle(ns, state) {
    await state.init(ns);

    await maintainEmployees(ns, state);

    if (state.options['smart-supply']) {
        await runSmartSupply(ns, state);
    }

    if (state.options['market-ta']) {
        await updatePricing(ns, state);
    }

    switch (state.round) {
        case 1:
            await runRound1(ns, state);
            break;
        case 2:
            await runRound2(ns, state);
            break;
        default:
            await runRound3Plus(ns, state);
            break;
    }

    if (state.options['auto-invest'] && state.round < state.options['target-round']) {
        await checkInvestment(ns, state);
    }
}

async function maintainEmployees(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    for (const division of corpData.divisions) {
        for (const city of CITIES) {
            try {
                const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', division, city);
                if (!office) continue;

                if (office.avgEnergy < 99) {
                    await execCorpFunc(ns, 'buyTea(ns.args[0], ns.args[1])', division, city);
                }

                if (office.avgMorale < 99) {
                    const partyCost = calculateOptimalPartyCost(office.avgMorale, 100);
                    await execCorpFunc(ns, 'throwParty(ns.args[0], ns.args[1], ns.args[2])', division, city, partyCost);
                }
            } catch { }
        }
    }
}

async function runSmartSupply(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    if (corpData.prevState !== 'SALE') return;

    for (const division of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);
        const industry = INDUSTRIES[divData.type];
        if (!industry || !industry.inputMaterials) continue;

        for (const city of CITIES) {
            try {
                if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', division, city))) continue;

                const warehouse = await execCorpFunc(ns, 'getWarehouse(ns.args[0], ns.args[1])', division, city);

                // Fetch all input materials for this city
                const materials = {};
                for (const material of Object.keys(industry.inputMaterials)) {
                    materials[material] = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', division, city, material);
                }

                const supplies = calculateSmartSupplyQuantities(divData, warehouse, materials);

                for (const [material, amount] of Object.entries(supplies)) {
                    if (amount > 0) {
                        await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', division, city, material, amount);
                    } else {
                        await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', division, city, material, 0);
                    }
                }
            } catch { }
        }
    }
}

async function updatePricing(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    for (const division of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);
        const industry = INDUSTRIES[divData.type];
        if (!industry) continue;

        for (const city of CITIES) {
            try {
                if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', division, city))) continue;

                const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', division, city);

                if (industry.outputMaterials) {
                    for (const material of industry.outputMaterials) {
                        const mat = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', division, city, material);
                        if (mat.stored > 0) {
                            const price = calculateOptimalPrice(mat, divData, office, false);
                            await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', division, city, material, 'MAX', price.toString());
                        }
                    }
                }

                if (industry.makesProducts) {
                    for (const productName of divData.products) {
                        const product = await execCorpFunc(ns, 'getProduct(ns.args[0], ns.args[1], ns.args[2])', division, city, productName);
                        if (product.developmentProgress >= 100 && product.stored > 0) {
                            const price = calculateOptimalPrice(product, divData, office, true);
                            await execCorpFunc(ns, 'sellProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', division, city, productName, 'MAX', price.toString(), false);
                        }
                    }
                }
            } catch { }
        }
    }
}

async function runRound1(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    const verbose = state.options.verbose;

    const hasAgriculture = corpData.divisions.includes('Agriculture');

    if (!hasAgriculture) {
        log(ns, 'Round 1: Creating Agriculture division');
        await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Agriculture', 'Agriculture');

        for (const city of CITIES) {
            if (city !== 'Sector-12') {
                await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Agriculture', city);
            }
            await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);

            await execCorpFunc(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', 'Agriculture', city, 1);

            for (let i = 0; i < 4; i++) {
                await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Agriculture', city);
            }
            await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Research & Development', 4);
        }
        return;
    }

    const agDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Agriculture');
    const sectorOffice = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Agriculture', 'Sector-12');

    if (agDiv.researchPoints < 55 && sectorOffice.avgMorale >= 95) {
        if (verbose) log(ns, `Round 1: Waiting for RP (${agDiv.researchPoints.toFixed(0)}/55)`);
        return;
    }

    if (sectorOffice.employeeJobs['Research & Development'] === 4) {
        log(ns, 'Round 1: Switching employees from R&D to production');
        for (const city of CITIES) {
            await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Research & Development', 0);
            await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Operations', 1);
            await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Engineer', 1);
            await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Business', 1);
            await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Management', 1);
        }
    }

    await buyBoostMaterials(ns, 'Agriculture');

    const smartStorageLevel = await execCorpFunc(ns, 'getUpgradeLevel(ns.args[0])', 'Smart Storage');
    if (smartStorageLevel < 10 && corpData.funds > 2e9) {
        await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', 'Smart Storage');
    }

    const advertLevel = await execCorpFunc(ns, 'getHireAdVertCount(ns.args[0])', 'Agriculture');
    if (advertLevel < 2 && corpData.funds > 1e9) {
        await execCorpFunc(ns, 'hireAdVert(ns.args[0])', 'Agriculture');
    }

    for (const city of CITIES) {
        const warehouse = await execCorpFunc(ns, 'getWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (warehouse.level < 3 && corpData.funds > 1e9) {
            await execCorpFunc(ns, 'upgradeWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        }
    }

    for (const city of CITIES) {
        const mat = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', 'Agriculture', city, 'Plants');
        if (mat.stored > 0 && !mat.desiredSellPrice) {
            await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', 'Agriculture', city, 'Plants', 'MAX', 'MP');
            await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', 'Agriculture', city, 'Food', 'MAX', 'MP');
        }
    }
}

async function runRound2(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    const verbose = state.options.verbose;

    if (!(await execCorpFunc(ns, 'hasUnlock(ns.args[0])', 'Export'))) {
        if (corpData.funds > 20e9) {
            await execCorpFunc(ns, 'purchaseUnlock(ns.args[0])', 'Export');
            log(ns, 'Round 2: Purchased Export unlock');
        }
        return;
    }

    const hasChemical = corpData.divisions.includes('Chemical');

    if (!hasChemical) {
        if (corpData.funds > 1e9) {
            log(ns, 'Round 2: Creating Chemical division');
            await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Chemical', 'Chemical');

            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Chemical', city);
                }
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Chemical', city);

                for (let i = 0; i < 3; i++) {
                    await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Chemical', city);
                }
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Chemical', city, 'Research & Development', 3);
            }
        }
        return;
    }

    const chemDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Chemical');
    if (chemDiv.researchPoints < 390) {
        if (verbose) log(ns, `Round 2: Waiting for Chemical RP (${chemDiv.researchPoints.toFixed(0)}/390)`);
    }

    const agDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Agriculture');
    if (agDiv.researchPoints < 700) {
        if (verbose) log(ns, `Round 2: Waiting for Agriculture RP (${agDiv.researchPoints.toFixed(0)}/700)`);
    }

    await setupExportRoutes(ns);

    for (const city of CITIES) {
        const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (office.size < 8 && corpData.funds > 4e9) {
            const toAdd = 8 - office.size;
            await execCorpFunc(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', 'Agriculture', city, toAdd);
            for (let i = 0; i < toAdd; i++) {
                await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Agriculture', city);
            }
        }
    }

    const advertLevel = await execCorpFunc(ns, 'getHireAdVertCount(ns.args[0])', 'Agriculture');
    if (advertLevel < 8 && corpData.funds > 1e9) {
        await execCorpFunc(ns, 'hireAdVert(ns.args[0])', 'Agriculture');
    }

    const smartStorageLevel = await execCorpFunc(ns, 'getUpgradeLevel(ns.args[0])', 'Smart Storage');
    if (smartStorageLevel < 15 && corpData.funds > 2e9) {
        await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', 'Smart Storage');
    }

    const smartFactoriesLevel = await execCorpFunc(ns, 'getUpgradeLevel(ns.args[0])', 'Smart Factories');
    if (smartFactoriesLevel < 10 && corpData.funds > 2e9) {
        await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', 'Smart Factories');
    }

    await buyBoostMaterials(ns, 'Agriculture');
}

async function runRound3Plus(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    const verbose = state.options.verbose;

    const hasTobacco = corpData.divisions.includes('Tobacco');

    if (!hasTobacco) {
        if (corpData.funds > 20e9) {
            log(ns, 'Round 3+: Creating Tobacco division');
            await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Tobacco', 'Tobacco');

            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Tobacco', city);
                }
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Tobacco', city);

                await execCorpFunc(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', 'Tobacco', city, 27);
                for (let i = 0; i < 30; i++) {
                    await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Tobacco', city);
                }

                if (city === 'Sector-12') {
                    await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Tobacco', city, 'Operations', 6);
                    await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Tobacco', city, 'Engineer', 6);
                    await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Tobacco', city, 'Business', 6);
                    await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Tobacco', city, 'Management', 6);
                    await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Tobacco', city, 'Research & Development', 6);
                } else {
                    await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Tobacco', city, 'Research & Development', 30);
                }
            }

            await setupTobaccoExports(ns);
        }
        return;
    }

    const tobaccoDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Tobacco');

    if (tobaccoDiv.products.length === 0 || await canDevelopNewProduct(ns, 'Tobacco', state)) {
        await developNewProduct(ns, 'Tobacco', state);
    }

    await buyWilsonAndAdvert(ns, 'Tobacco');

    await buyResearch(ns, 'Tobacco');

    await upgradeProductionCapability(ns);
}

async function setupExportRoutes(ns) {
    try {
        for (const city of CITIES) {
            await execCorpFunc(ns, 'cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', 'Agriculture', city, 'Chemical', city, 'Plants');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            await execCorpFunc(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', 'Agriculture', city, 'Chemical', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }

    try {
        for (const city of CITIES) {
            await execCorpFunc(ns, 'cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', 'Chemical', city, 'Agriculture', city, 'Chemicals');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            await execCorpFunc(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', 'Chemical', city, 'Agriculture', city, 'Chemicals', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function setupTobaccoExports(ns) {
    for (const city of CITIES) {
        try {
            await execCorpFunc(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', 'Agriculture', city, 'Tobacco', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function buyBoostMaterials(ns, division) {
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);

    for (const city of CITIES) {
        try {
            if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', division, city))) continue;

            const warehouse = await execCorpFunc(ns, 'getWarehouse(ns.args[0], ns.args[1])', division, city);
            const freeSpace = warehouse.size - warehouse.sizeUsed;

            if (freeSpace < 100) continue;

            const optimal = calculateOptimalBoostMaterials(divData.type, freeSpace * 0.8);
            if (!optimal) continue;

            for (const [material, targetQty] of Object.entries(optimal)) {
                const current = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', division, city, material);
                const toBuy = targetQty - current.stored;

                if (toBuy > 0) {
                    await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', division, city, material, toBuy / 10);
                }
            }
        } catch { }
    }

    await ns.sleep(10000);

    for (const city of CITIES) {
        try {
            await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', division, city, 'AI Cores', 0);
            await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', division, city, 'Hardware', 0);
            await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', division, city, 'Real Estate', 0);
            await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', division, city, 'Robots', 0);
        } catch { }
    }
}

async function canDevelopNewProduct(ns, division, state) {
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);

    for (const productName of divData.products) {
        const product = await execCorpFunc(ns, 'getProduct(ns.args[0], ns.args[1], ns.args[2])', division, 'Sector-12', productName);
        if (product.developmentProgress < 100) {
            return false;
        }
    }

    if (divData.products.length >= 3) {
        return true;
    }

    return divData.products.length < 3;
}

async function developNewProduct(ns, division, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);

    if (divData.products.length >= 3) {
        let oldestProduct = divData.products[0];
        let oldestRating = Infinity;

        for (const productName of divData.products) {
            const product = await execCorpFunc(ns, 'getProduct(ns.args[0], ns.args[1], ns.args[2])', division, 'Sector-12', productName);
            if (product.developmentProgress >= 100 && product.effectiveRating < oldestRating) {
                oldestRating = product.effectiveRating;
                oldestProduct = productName;
            }
        }

        await execCorpFunc(ns, 'discontinueProduct(ns.args[0], ns.args[1])', division, oldestProduct);
        log(ns, `Discontinued product: ${oldestProduct}`);
    }

    const productName = getProductName(division, state.productVersion++);
    const investment = Math.max(1e9, corpData.funds * 0.01);

    await execCorpFunc(ns, 'makeProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', division, 'Sector-12', productName, investment, investment);
    log(ns, `Started developing product: ${productName}`);
}

async function buyWilsonAndAdvert(ns, division) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);

    if (divData.awareness >= Number.MAX_VALUE * 0.9) return;

    const wilsonCost = await execCorpFunc(ns, 'getUpgradeLevelCost(ns.args[0])', 'Wilson Analytics');
    if (corpData.funds > wilsonCost * 2) {
        await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', 'Wilson Analytics');
    }

    const advertCost = await execCorpFunc(ns, 'getHireAdVertCost(ns.args[0])', division);
    if (corpData.funds > advertCost * 5) {
        await execCorpFunc(ns, 'hireAdVert(ns.args[0])', division);
    }
}

async function buyResearch(ns, division) {
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);
    const rp = divData.researchPoints;

    const priorityResearch = [
        { name: 'Hi-Tech R&D Laboratory', cost: 5000 },
        { name: 'Market-TA.I', cost: 20000 },
        { name: 'Market-TA.II', cost: 50000 },
        { name: 'Overclock', cost: 15000 },
        { name: 'Sti.mu', cost: 30000 },
        { name: 'Automatic Drug Administration', cost: 10000 },
        { name: 'Go-Juice', cost: 25000 },
        { name: 'CPH4 Injections', cost: 25000 },
        { name: 'Drones', cost: 5000 },
        { name: 'Drones - Assembly', cost: 25000 },
        { name: 'Drones - Transport', cost: 30000 },
        { name: 'Self-Correcting Assemblers', cost: 25000 },
        { name: 'uPgrade: Fulcrum', cost: 10000 },
    ];

    for (const researchItem of priorityResearch) {
        if (rp > researchItem.cost * 2) {
            try {
                if (!(await execCorpFunc(ns, 'hasResearched(ns.args[0], ns.args[1])', division, researchItem.name))) {
                    await execCorpFunc(ns, 'research(ns.args[0], ns.args[1])', division, researchItem.name);
                    log(ns, `Researched: ${researchItem.name}`);
                    break;
                }
            } catch { }
        }
    }
}

async function upgradeProductionCapability(ns) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    const upgrades = [
        'Smart Storage',
        'Smart Factories',
        'FocusWires',
        'Neural Accelerators',
        'Speech Processor Implants',
        'Nuoptimal Nootropic Injector Implants',
        'Project Insight',
        'ABC SalesBots'
    ];

    for (const upgrade of upgrades) {
        try {
            const cost = await execCorpFunc(ns, 'getUpgradeLevelCost(ns.args[0])', upgrade);
            if (corpData.funds > cost * 10) {
                await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', upgrade);
            }
        } catch { }
    }
}

async function checkInvestment(ns, state) {
    const offer = await execCorpFunc(ns, 'getInvestmentOffer()');

    if (shouldAcceptInvestment(offer, state.round, 0)) {
        await execCorpFunc(ns, 'acceptInvestmentOffer()');
        log(ns, `Accepted investment offer: ${formatMoney(offer.funds)}`, true, 'success');
        state.round++;
    }
}
