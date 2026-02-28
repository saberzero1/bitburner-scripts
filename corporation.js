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

/** Execute a corporation function with no arguments */
const getCorpInfo = async (ns, strFunction) =>
    await getNsDataThroughFile(ns, `ns.corporation.${strFunction}`, `/Temp/corp-${strFunction.split('(')[0]}.txt`);

/** Execute a corporation function with arguments passed via ns.args */
const execCorp = async (ns, strFunction, args = []) =>
    await getNsDataThroughFile(ns, `ns.corporation.${strFunction}`, `/Temp/corp-${strFunction.split('(')[0]}.txt`, args);

// Specific helpers for common operations
const corp = {
    // Read operations
    hasCorporation: (ns) => getCorpInfo(ns, 'hasCorporation()'),
    getCorporation: (ns) => getCorpInfo(ns, 'getCorporation()'),
    getDivision: (ns, div) => execCorp(ns, 'getDivision(ns.args[0])', [div]),
    getOffice: (ns, div, city) => execCorp(ns, 'getOffice(ns.args[0], ns.args[1])', [div, city]),
    getWarehouse: (ns, div, city) => execCorp(ns, 'getWarehouse(ns.args[0], ns.args[1])', [div, city]),
    hasWarehouse: (ns, div, city) => execCorp(ns, 'hasWarehouse(ns.args[0], ns.args[1])', [div, city]),
    getMaterial: (ns, div, city, mat) => execCorp(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', [div, city, mat]),
    getProduct: (ns, div, city, prod) => execCorp(ns, 'getProduct(ns.args[0], ns.args[1], ns.args[2])', [div, city, prod]),
    getUpgradeLevel: (ns, upgrade) => execCorp(ns, 'getUpgradeLevel(ns.args[0])', [upgrade]),
    getUpgradeLevelCost: (ns, upgrade) => execCorp(ns, 'getUpgradeLevelCost(ns.args[0])', [upgrade]),
    getHireAdVertCount: (ns, div) => execCorp(ns, 'getHireAdVertCount(ns.args[0])', [div]),
    getHireAdVertCost: (ns, div) => execCorp(ns, 'getHireAdVertCost(ns.args[0])', [div]),
    hasUnlock: (ns, unlock) => execCorp(ns, 'hasUnlock(ns.args[0])', [unlock]),
    hasResearched: (ns, div, research) => execCorp(ns, 'hasResearched(ns.args[0], ns.args[1])', [div, research]),
    getInvestmentOffer: (ns) => getCorpInfo(ns, 'getInvestmentOffer()'),

    // Write operations
    createCorporation: (ns, name, selfFund) => execCorp(ns, 'createCorporation(ns.args[0], ns.args[1])', [name, selfFund]),
    buyTea: (ns, div, city) => execCorp(ns, 'buyTea(ns.args[0], ns.args[1])', [div, city]),
    throwParty: (ns, div, city, cost) => execCorp(ns, 'throwParty(ns.args[0], ns.args[1], ns.args[2])', [div, city, cost]),
    buyMaterial: (ns, div, city, mat, amt) => execCorp(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', [div, city, mat, amt]),
    sellMaterial: (ns, div, city, mat, amt, price) => execCorp(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', [div, city, mat, amt, price]),
    sellProduct: (ns, div, city, prod, amt, price, all) => execCorp(ns, 'sellProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', [div, city, prod, amt, price, all]),
    expandIndustry: (ns, ind, name) => execCorp(ns, 'expandIndustry(ns.args[0], ns.args[1])', [ind, name]),
    expandCity: (ns, div, city) => execCorp(ns, 'expandCity(ns.args[0], ns.args[1])', [div, city]),
    purchaseWarehouse: (ns, div, city) => execCorp(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', [div, city]),
    upgradeWarehouse: (ns, div, city) => execCorp(ns, 'upgradeWarehouse(ns.args[0], ns.args[1])', [div, city]),
    upgradeOfficeSize: (ns, div, city, size) => execCorp(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', [div, city, size]),
    hireEmployee: (ns, div, city) => execCorp(ns, 'hireEmployee(ns.args[0], ns.args[1])', [div, city]),
    setAutoJobAssignment: (ns, div, city, job, amt) => execCorp(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', [div, city, job, amt]),
    levelUpgrade: (ns, upgrade) => execCorp(ns, 'levelUpgrade(ns.args[0])', [upgrade]),
    hireAdVert: (ns, div) => execCorp(ns, 'hireAdVert(ns.args[0])', [div]),
    purchaseUnlock: (ns, unlock) => execCorp(ns, 'purchaseUnlock(ns.args[0])', [unlock]),
    exportMaterial: (ns, srcDiv, srcCity, dstDiv, dstCity, mat, amt) => execCorp(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', [srcDiv, srcCity, dstDiv, dstCity, mat, amt]),
    cancelExportMaterial: (ns, srcDiv, srcCity, dstDiv, dstCity, mat) => execCorp(ns, 'cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', [srcDiv, srcCity, dstDiv, dstCity, mat]),
    makeProduct: (ns, div, city, name, design, marketing) => execCorp(ns, 'makeProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', [div, city, name, design, marketing]),
    discontinueProduct: (ns, div, prod) => execCorp(ns, 'discontinueProduct(ns.args[0], ns.args[1])', [div, prod]),
    research: (ns, div, name) => execCorp(ns, 'research(ns.args[0], ns.args[1])', [div, name]),
    acceptInvestmentOffer: (ns) => getCorpInfo(ns, 'acceptInvestmentOffer()'),
};

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    if (options.tail) ns.tail();
    disableLogs(ns, ['sleep', 'getServerMoneyAvailable', 'run', 'read', 'write', 'isRunning']);

    const state = new CorpState(ns, options);

    if (!(await corp.hasCorporation(ns))) {
        await createCorporation(ns, state);
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
        if (!(await corp.hasCorporation(ns))) return 0;

        const corpData = await corp.getCorporation(ns);
        const numInvestments = corpData.numShares > 1e9 ? 0 :
            corpData.numShares > 900e6 ? 1 :
                corpData.numShares > 800e6 ? 2 :
                    corpData.numShares > 700e6 ? 3 : 4;

        return numInvestments + 1;
    }
}

async function createCorporation(ns, state) {
    const options = state.options;

    log(ns, `Creating corporation: ${options['corp-name']}`);

    if (options['self-fund']) {
        const cost = 150e9;
        if (ns.getServerMoneyAvailable('home') < cost) {
            log(ns, `ERROR: Need ${formatMoney(cost)} to self-fund corporation`, true, 'error');
            return false;
        }
        await corp.createCorporation(ns, options['corp-name'], true);
    } else {
        await corp.createCorporation(ns, options['corp-name'], false);
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
    const corpData = await corp.getCorporation(ns);

    for (const division of corpData.divisions) {
        for (const city of CITIES) {
            try {
                const office = await corp.getOffice(ns, division, city);
                if (!office) continue;

                if (office.avgEnergy < 99) {
                    await corp.buyTea(ns, division, city);
                }

                if (office.avgMorale < 99) {
                    const partyCost = calculateOptimalPartyCost(office.avgMorale, 100);
                    await corp.throwParty(ns, division, city, partyCost);
                }
            } catch { }
        }
    }
}

async function runSmartSupply(ns, state) {
    const corpData = await corp.getCorporation(ns);

    if (corpData.prevState !== 'SALE') return;

    for (const division of corpData.divisions) {
        const divData = await corp.getDivision(ns, division);
        const industry = INDUSTRIES[divData.type];
        if (!industry || !industry.inputMaterials) continue;

        for (const city of CITIES) {
            try {
                if (!(await corp.hasWarehouse(ns, division, city))) continue;

                const warehouse = await corp.getWarehouse(ns, division, city);

                // Fetch all input materials for this city
                const materials = {};
                for (const material of Object.keys(industry.inputMaterials)) {
                    materials[material] = await corp.getMaterial(ns, division, city, material);
                }

                const supplies = calculateSmartSupplyQuantities(divData, warehouse, materials);

                for (const [material, amount] of Object.entries(supplies)) {
                    if (amount > 0) {
                        await corp.buyMaterial(ns, division, city, material, amount);
                    } else {
                        await corp.buyMaterial(ns, division, city, material, 0);
                    }
                }
            } catch { }
        }
    }
}

async function updatePricing(ns, state) {
    const corpData = await corp.getCorporation(ns);

    for (const division of corpData.divisions) {
        const divData = await corp.getDivision(ns, division);
        const industry = INDUSTRIES[divData.type];
        if (!industry) continue;

        for (const city of CITIES) {
            try {
                if (!(await corp.hasWarehouse(ns, division, city))) continue;

                const office = await corp.getOffice(ns, division, city);

                if (industry.outputMaterials) {
                    for (const material of industry.outputMaterials) {
                        const mat = await corp.getMaterial(ns, division, city, material);
                        if (mat.stored > 0) {
                            const price = calculateOptimalPrice(mat, divData, office, false);
                            await corp.sellMaterial(ns, division, city, material, 'MAX', price.toString());
                        }
                    }
                }

                if (industry.makesProducts) {
                    for (const productName of divData.products) {
                        const product = await corp.getProduct(ns, division, city, productName);
                        if (product.developmentProgress >= 100 && product.stored > 0) {
                            const price = calculateOptimalPrice(product, divData, office, true);
                            await corp.sellProduct(ns, division, city, productName, 'MAX', price.toString(), false);
                        }
                    }
                }
            } catch { }
        }
    }
}

async function runRound1(ns, state) {
    const corpData = await corp.getCorporation(ns);
    const verbose = state.options.verbose;

    const hasAgriculture = corpData.divisions.includes('Agriculture');

    if (!hasAgriculture) {
        log(ns, 'Round 1: Creating Agriculture division');
        await corp.expandIndustry(ns, 'Agriculture', 'Agriculture');

        for (const city of CITIES) {
            if (city !== 'Sector-12') {
                await corp.expandCity(ns, 'Agriculture', city);
            }
            await corp.purchaseWarehouse(ns, 'Agriculture', city);

            await corp.upgradeOfficeSize(ns, 'Agriculture', city, 1);

            for (let i = 0; i < 4; i++) {
                await corp.hireEmployee(ns, 'Agriculture', city);
            }
            await corp.setAutoJobAssignment(ns, 'Agriculture', city, 'Research & Development', 4);
        }
        return;
    }

    const agDiv = await corp.getDivision(ns, 'Agriculture');
    const sectorOffice = await corp.getOffice(ns, 'Agriculture', 'Sector-12');

    if (agDiv.researchPoints < 55 && sectorOffice.avgMorale >= 95) {
        if (verbose) log(ns, `Round 1: Waiting for RP (${agDiv.researchPoints.toFixed(0)}/55)`);
        return;
    }

    if (sectorOffice.employeeJobs['Research & Development'] === 4) {
        log(ns, 'Round 1: Switching employees from R&D to production');
        for (const city of CITIES) {
            await corp.setAutoJobAssignment(ns, 'Agriculture', city, 'Research & Development', 0);
            await corp.setAutoJobAssignment(ns, 'Agriculture', city, 'Operations', 1);
            await corp.setAutoJobAssignment(ns, 'Agriculture', city, 'Engineer', 1);
            await corp.setAutoJobAssignment(ns, 'Agriculture', city, 'Business', 1);
            await corp.setAutoJobAssignment(ns, 'Agriculture', city, 'Management', 1);
        }
    }

    await buyBoostMaterials(ns, 'Agriculture');

    const smartStorageLevel = await corp.getUpgradeLevel(ns, 'Smart Storage');
    if (smartStorageLevel < 10 && corpData.funds > 2e9) {
        await corp.levelUpgrade(ns, 'Smart Storage');
    }

    const advertLevel = await corp.getHireAdVertCount(ns, 'Agriculture');
    if (advertLevel < 2 && corpData.funds > 1e9) {
        await corp.hireAdVert(ns, 'Agriculture');
    }

    for (const city of CITIES) {
        const warehouse = await corp.getWarehouse(ns, 'Agriculture', city);
        if (warehouse.level < 3 && corpData.funds > 1e9) {
            await corp.upgradeWarehouse(ns, 'Agriculture', city);
        }
    }

    for (const city of CITIES) {
        const mat = await corp.getMaterial(ns, 'Agriculture', city, 'Plants');
        if (mat.stored > 0 && !mat.desiredSellPrice) {
            await corp.sellMaterial(ns, 'Agriculture', city, 'Plants', 'MAX', 'MP');
            await corp.sellMaterial(ns, 'Agriculture', city, 'Food', 'MAX', 'MP');
        }
    }
}

async function runRound2(ns, state) {
    const corpData = await corp.getCorporation(ns);
    const verbose = state.options.verbose;

    if (!(await corp.hasUnlock(ns, 'Export'))) {
        if (corpData.funds > 20e9) {
            await corp.purchaseUnlock(ns, 'Export');
            log(ns, 'Round 2: Purchased Export unlock');
        }
        return;
    }

    const hasChemical = corpData.divisions.includes('Chemical');

    if (!hasChemical) {
        if (corpData.funds > 1e9) {
            log(ns, 'Round 2: Creating Chemical division');
            await corp.expandIndustry(ns, 'Chemical', 'Chemical');

            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    await corp.expandCity(ns, 'Chemical', city);
                }
                await corp.purchaseWarehouse(ns, 'Chemical', city);

                for (let i = 0; i < 3; i++) {
                    await corp.hireEmployee(ns, 'Chemical', city);
                }
                await corp.setAutoJobAssignment(ns, 'Chemical', city, 'Research & Development', 3);
            }
        }
        return;
    }

    const chemDiv = await corp.getDivision(ns, 'Chemical');
    if (chemDiv.researchPoints < 390) {
        if (verbose) log(ns, `Round 2: Waiting for Chemical RP (${chemDiv.researchPoints.toFixed(0)}/390)`);
    }

    const agDiv = await corp.getDivision(ns, 'Agriculture');
    if (agDiv.researchPoints < 700) {
        if (verbose) log(ns, `Round 2: Waiting for Agriculture RP (${agDiv.researchPoints.toFixed(0)}/700)`);
    }

    await setupExportRoutes(ns);

    for (const city of CITIES) {
        const office = await corp.getOffice(ns, 'Agriculture', city);
        if (office.size < 8 && corpData.funds > 4e9) {
            const toAdd = 8 - office.size;
            await corp.upgradeOfficeSize(ns, 'Agriculture', city, toAdd);
            for (let i = 0; i < toAdd; i++) {
                await corp.hireEmployee(ns, 'Agriculture', city);
            }
        }
    }

    const advertLevel = await corp.getHireAdVertCount(ns, 'Agriculture');
    if (advertLevel < 8 && corpData.funds > 1e9) {
        await corp.hireAdVert(ns, 'Agriculture');
    }

    const smartStorageLevel = await corp.getUpgradeLevel(ns, 'Smart Storage');
    if (smartStorageLevel < 15 && corpData.funds > 2e9) {
        await corp.levelUpgrade(ns, 'Smart Storage');
    }

    const smartFactoriesLevel = await corp.getUpgradeLevel(ns, 'Smart Factories');
    if (smartFactoriesLevel < 10 && corpData.funds > 2e9) {
        await corp.levelUpgrade(ns, 'Smart Factories');
    }

    await buyBoostMaterials(ns, 'Agriculture');
}

async function runRound3Plus(ns, state) {
    const corpData = await corp.getCorporation(ns);
    const verbose = state.options.verbose;

    const hasTobacco = corpData.divisions.includes('Tobacco');

    if (!hasTobacco) {
        if (corpData.funds > 20e9) {
            log(ns, 'Round 3+: Creating Tobacco division');
            await corp.expandIndustry(ns, 'Tobacco', 'Tobacco');

            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    await corp.expandCity(ns, 'Tobacco', city);
                }
                await corp.purchaseWarehouse(ns, 'Tobacco', city);

                await corp.upgradeOfficeSize(ns, 'Tobacco', city, 27);
                for (let i = 0; i < 30; i++) {
                    await corp.hireEmployee(ns, 'Tobacco', city);
                }

                if (city === 'Sector-12') {
                    await corp.setAutoJobAssignment(ns, 'Tobacco', city, 'Operations', 6);
                    await corp.setAutoJobAssignment(ns, 'Tobacco', city, 'Engineer', 6);
                    await corp.setAutoJobAssignment(ns, 'Tobacco', city, 'Business', 6);
                    await corp.setAutoJobAssignment(ns, 'Tobacco', city, 'Management', 6);
                    await corp.setAutoJobAssignment(ns, 'Tobacco', city, 'Research & Development', 6);
                } else {
                    await corp.setAutoJobAssignment(ns, 'Tobacco', city, 'Research & Development', 30);
                }
            }

            await setupTobaccoExports(ns);
        }
        return;
    }

    const tobaccoDiv = await corp.getDivision(ns, 'Tobacco');

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
            await corp.cancelExportMaterial(ns, 'Agriculture', city, 'Chemical', city, 'Plants');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            await corp.exportMaterial(ns, 'Agriculture', city, 'Chemical', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }

    try {
        for (const city of CITIES) {
            await corp.cancelExportMaterial(ns, 'Chemical', city, 'Agriculture', city, 'Chemicals');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            await corp.exportMaterial(ns, 'Chemical', city, 'Agriculture', city, 'Chemicals', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function setupTobaccoExports(ns) {
    for (const city of CITIES) {
        try {
            await corp.exportMaterial(ns, 'Agriculture', city, 'Tobacco', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function buyBoostMaterials(ns, division) {
    const divData = await corp.getDivision(ns, division);

    for (const city of CITIES) {
        try {
            if (!(await corp.hasWarehouse(ns, division, city))) continue;

            const warehouse = await corp.getWarehouse(ns, division, city);
            const freeSpace = warehouse.size - warehouse.sizeUsed;

            if (freeSpace < 100) continue;

            const optimal = calculateOptimalBoostMaterials(divData.type, freeSpace * 0.8);
            if (!optimal) continue;

            for (const [material, targetQty] of Object.entries(optimal)) {
                const current = await corp.getMaterial(ns, division, city, material);
                const toBuy = targetQty - current.stored;

                if (toBuy > 0) {
                    await corp.buyMaterial(ns, division, city, material, toBuy / 10);
                }
            }
        } catch { }
    }

    await ns.sleep(10000);

    for (const city of CITIES) {
        try {
            await corp.buyMaterial(ns, division, city, 'AI Cores', 0);
            await corp.buyMaterial(ns, division, city, 'Hardware', 0);
            await corp.buyMaterial(ns, division, city, 'Real Estate', 0);
            await corp.buyMaterial(ns, division, city, 'Robots', 0);
        } catch { }
    }
}

async function canDevelopNewProduct(ns, division, state) {
    const divData = await corp.getDivision(ns, division);

    for (const productName of divData.products) {
        const product = await corp.getProduct(ns, division, 'Sector-12', productName);
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
    const corpData = await corp.getCorporation(ns);
    const divData = await corp.getDivision(ns, division);

    if (divData.products.length >= 3) {
        let oldestProduct = divData.products[0];
        let oldestRating = Infinity;

        for (const productName of divData.products) {
            const product = await corp.getProduct(ns, division, 'Sector-12', productName);
            if (product.developmentProgress >= 100 && product.effectiveRating < oldestRating) {
                oldestRating = product.effectiveRating;
                oldestProduct = productName;
            }
        }

        await corp.discontinueProduct(ns, division, oldestProduct);
        log(ns, `Discontinued product: ${oldestProduct}`);
    }

    const productName = getProductName(division, state.productVersion++);
    const investment = Math.max(1e9, corpData.funds * 0.01);

    await corp.makeProduct(ns, division, 'Sector-12', productName, investment, investment);
    log(ns, `Started developing product: ${productName}`);
}

async function buyWilsonAndAdvert(ns, division) {
    const corpData = await corp.getCorporation(ns);
    const divData = await corp.getDivision(ns, division);

    if (divData.awareness >= Number.MAX_VALUE * 0.9) return;

    const wilsonCost = await corp.getUpgradeLevelCost(ns, 'Wilson Analytics');
    if (corpData.funds > wilsonCost * 2) {
        await corp.levelUpgrade(ns, 'Wilson Analytics');
    }

    const advertCost = await corp.getHireAdVertCost(ns, division);
    if (corpData.funds > advertCost * 5) {
        await corp.hireAdVert(ns, division);
    }
}

async function buyResearch(ns, division) {
    const divData = await corp.getDivision(ns, division);
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

    for (const research of priorityResearch) {
        if (rp > research.cost * 2) {
            try {
                if (!(await corp.hasResearched(ns, division, research.name))) {
                    await corp.research(ns, division, research.name);
                    log(ns, `Researched: ${research.name}`);
                    break;
                }
            } catch { }
        }
    }
}

async function upgradeProductionCapability(ns) {
    const corpData = await corp.getCorporation(ns);

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
            const cost = await corp.getUpgradeLevelCost(ns, upgrade);
            if (corpData.funds > cost * 10) {
                await corp.levelUpgrade(ns, upgrade);
            }
        } catch { }
    }
}

async function checkInvestment(ns, state) {
    const offer = await corp.getInvestmentOffer(ns);

    if (shouldAcceptInvestment(offer, state.round, 0)) {
        await corp.acceptInvestmentOffer(ns);
        log(ns, `Accepted investment offer: ${formatMoney(offer.funds)}`, true, 'success');
        state.round++;
    }
}
