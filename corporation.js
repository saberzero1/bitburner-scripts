/**
 * Corporation management script using temp script pattern for low RAM usage
 * Manages corporation from creation through all investment rounds
 */

import { log, getConfiguration, disableLogs, formatMoney, getErrorInfo } from './helpers.js'
import { corpApi } from './corp-api.js'
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

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    if (options.tail) ns.tail();
    disableLogs(ns, ['sleep', 'getServerMoneyAvailable', 'run', 'read', 'write', 'isRunning']);

    const state = new CorpState(ns, options);

    if (!(await corpApi.hasCorporation(ns))) {
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
        this.round = options.round || 0; // Will be detected async
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
        if (!(await corpApi.hasCorporation(ns))) return 0;

        const corpData = await corpApi.getCorporation(ns);
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
        await corpApi.createCorporation(ns, options['corp-name'], true);
    } else {
        await corpApi.createCorporation(ns, options['corp-name'], false);
    }

    state.round = 1;
    return true;
}

async function runCorpCycle(ns, state) {
    await state.init(ns);
    const verbose = state.options.verbose;

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
    const corpData = await corpApi.getCorporation(ns);

    for (const division of corpData.divisions) {
        for (const city of CITIES) {
            try {
                const office = await corpApi.getOffice(ns, division, city);
                if (!office) continue;

                if (office.avgEnergy < 99) {
                    await corpApi.buyTea(ns, division, city);
                }

                if (office.avgMorale < 99) {
                    const partyCost = calculateOptimalPartyCost(office.avgMorale, 100);
                    await corpApi.throwParty(ns, division, city, partyCost);
                }
            } catch { }
        }
    }
}

async function runSmartSupply(ns, state) {
    const corpData = await corpApi.getCorporation(ns);

    if (corpData.prevState !== 'SALE') return;

    for (const division of corpData.divisions) {
        const divData = await corpApi.getDivision(ns, division);
        const industry = INDUSTRIES[divData.type];
        if (!industry || !industry.inputMaterials) continue;

        for (const city of CITIES) {
            try {
                if (!(await corpApi.hasWarehouse(ns, division, city))) continue;

                const warehouse = await corpApi.getWarehouse(ns, division, city);

                // Fetch all input materials for this city
                const materials = {};
                for (const material of Object.keys(industry.inputMaterials)) {
                    materials[material] = await corpApi.getMaterial(ns, division, city, material);
                }

                const supplies = calculateSmartSupplyQuantities(divData, warehouse, materials);

                for (const [material, amount] of Object.entries(supplies)) {
                    if (amount > 0) {
                        await corpApi.buyMaterial(ns, division, city, material, amount);
                    } else {
                        await corpApi.buyMaterial(ns, division, city, material, 0);
                    }
                }
            } catch { }
        }
    }
}

async function updatePricing(ns, state) {
    const corpData = await corpApi.getCorporation(ns);

    for (const division of corpData.divisions) {
        const divData = await corpApi.getDivision(ns, division);
        const industry = INDUSTRIES[divData.type];
        if (!industry) continue;

        for (const city of CITIES) {
            try {
                if (!(await corpApi.hasWarehouse(ns, division, city))) continue;

                const office = await corpApi.getOffice(ns, division, city);

                if (industry.outputMaterials) {
                    for (const material of industry.outputMaterials) {
                        const mat = await corpApi.getMaterial(ns, division, city, material);
                        if (mat.stored > 0) {
                            const price = calculateOptimalPrice(mat, divData, office, false);
                            await corpApi.sellMaterial(ns, division, city, material, 'MAX', price.toString());
                        }
                    }
                }

                if (industry.makesProducts) {
                    for (const productName of divData.products) {
                        const product = await corpApi.getProduct(ns, division, city, productName);
                        if (product.developmentProgress >= 100 && product.stored > 0) {
                            const price = calculateOptimalPrice(product, divData, office, true);
                            await corpApi.sellProduct(ns, division, city, productName, 'MAX', price.toString(), false);
                        }
                    }
                }
            } catch { }
        }
    }
}

async function runRound1(ns, state) {
    const corpData = await corpApi.getCorporation(ns);
    const verbose = state.options.verbose;

    const hasAgriculture = corpData.divisions.includes('Agriculture');

    if (!hasAgriculture) {
        log(ns, 'Round 1: Creating Agriculture division');
        await corpApi.expandIndustry(ns, 'Agriculture', 'Agriculture');

        for (const city of CITIES) {
            if (city !== 'Sector-12') {
                await corpApi.expandCity(ns, 'Agriculture', city);
            }
            await corpApi.purchaseWarehouse(ns, 'Agriculture', city);

            await corpApi.upgradeOfficeSize(ns, 'Agriculture', city, 1);

            for (let i = 0; i < 4; i++) {
                await corpApi.hireEmployee(ns, 'Agriculture', city);
            }
            await corpApi.setAutoJobAssignment(ns, 'Agriculture', city, 'Research & Development', 4);
        }
        return;
    }

    const agDiv = await corpApi.getDivision(ns, 'Agriculture');
    const sectorOffice = await corpApi.getOffice(ns, 'Agriculture', 'Sector-12');

    if (agDiv.researchPoints < 55 && sectorOffice.avgMorale >= 95) {
        if (verbose) log(ns, `Round 1: Waiting for RP (${agDiv.researchPoints.toFixed(0)}/55)`);
        return;
    }

    if (sectorOffice.employeeJobs['Research & Development'] === 4) {
        log(ns, 'Round 1: Switching employees from R&D to production');
        for (const city of CITIES) {
            await corpApi.setAutoJobAssignment(ns, 'Agriculture', city, 'Research & Development', 0);
            await corpApi.setAutoJobAssignment(ns, 'Agriculture', city, 'Operations', 1);
            await corpApi.setAutoJobAssignment(ns, 'Agriculture', city, 'Engineer', 1);
            await corpApi.setAutoJobAssignment(ns, 'Agriculture', city, 'Business', 1);
            await corpApi.setAutoJobAssignment(ns, 'Agriculture', city, 'Management', 1);
        }
    }

    await buyBoostMaterials(ns, 'Agriculture');

    const smartStorageLevel = await corpApi.getUpgradeLevel(ns, 'Smart Storage');
    if (smartStorageLevel < 10 && corpData.funds > 2e9) {
        await corpApi.levelUpgrade(ns, 'Smart Storage');
    }

    const advertLevel = await corpApi.getHireAdVertCount(ns, 'Agriculture');
    if (advertLevel < 2 && corpData.funds > 1e9) {
        await corpApi.hireAdVert(ns, 'Agriculture');
    }

    for (const city of CITIES) {
        const warehouse = await corpApi.getWarehouse(ns, 'Agriculture', city);
        if (warehouse.level < 3 && corpData.funds > 1e9) {
            await corpApi.upgradeWarehouse(ns, 'Agriculture', city);
        }
    }

    for (const city of CITIES) {
        const mat = await corpApi.getMaterial(ns, 'Agriculture', city, 'Plants');
        if (mat.stored > 0 && !mat.desiredSellPrice) {
            await corpApi.sellMaterial(ns, 'Agriculture', city, 'Plants', 'MAX', 'MP');
            await corpApi.sellMaterial(ns, 'Agriculture', city, 'Food', 'MAX', 'MP');
        }
    }
}

async function runRound2(ns, state) {
    const corpData = await corpApi.getCorporation(ns);
    const verbose = state.options.verbose;

    if (!(await corpApi.hasUnlock(ns, 'Export'))) {
        if (corpData.funds > 20e9) {
            await corpApi.purchaseUnlock(ns, 'Export');
            log(ns, 'Round 2: Purchased Export unlock');
        }
        return;
    }

    const hasChemical = corpData.divisions.includes('Chemical');

    if (!hasChemical) {
        if (corpData.funds > 1e9) {
            log(ns, 'Round 2: Creating Chemical division');
            await corpApi.expandIndustry(ns, 'Chemical', 'Chemical');

            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    await corpApi.expandCity(ns, 'Chemical', city);
                }
                await corpApi.purchaseWarehouse(ns, 'Chemical', city);

                for (let i = 0; i < 3; i++) {
                    await corpApi.hireEmployee(ns, 'Chemical', city);
                }
                await corpApi.setAutoJobAssignment(ns, 'Chemical', city, 'Research & Development', 3);
            }
        }
        return;
    }

    const chemDiv = await corpApi.getDivision(ns, 'Chemical');
    if (chemDiv.researchPoints < 390) {
        if (verbose) log(ns, `Round 2: Waiting for Chemical RP (${chemDiv.researchPoints.toFixed(0)}/390)`);
    }

    const agDiv = await corpApi.getDivision(ns, 'Agriculture');
    if (agDiv.researchPoints < 700) {
        if (verbose) log(ns, `Round 2: Waiting for Agriculture RP (${agDiv.researchPoints.toFixed(0)}/700)`);
    }

    await setupExportRoutes(ns);

    for (const city of CITIES) {
        const office = await corpApi.getOffice(ns, 'Agriculture', city);
        if (office.size < 8 && corpData.funds > 4e9) {
            const toAdd = 8 - office.size;
            await corpApi.upgradeOfficeSize(ns, 'Agriculture', city, toAdd);
            for (let i = 0; i < toAdd; i++) {
                await corpApi.hireEmployee(ns, 'Agriculture', city);
            }
        }
    }

    const advertLevel = await corpApi.getHireAdVertCount(ns, 'Agriculture');
    if (advertLevel < 8 && corpData.funds > 1e9) {
        await corpApi.hireAdVert(ns, 'Agriculture');
    }

    const smartStorageLevel = await corpApi.getUpgradeLevel(ns, 'Smart Storage');
    if (smartStorageLevel < 15 && corpData.funds > 2e9) {
        await corpApi.levelUpgrade(ns, 'Smart Storage');
    }

    const smartFactoriesLevel = await corpApi.getUpgradeLevel(ns, 'Smart Factories');
    if (smartFactoriesLevel < 10 && corpData.funds > 2e9) {
        await corpApi.levelUpgrade(ns, 'Smart Factories');
    }

    await buyBoostMaterials(ns, 'Agriculture');
}

async function runRound3Plus(ns, state) {
    const corpData = await corpApi.getCorporation(ns);
    const verbose = state.options.verbose;

    const hasTobacco = corpData.divisions.includes('Tobacco');

    if (!hasTobacco) {
        if (corpData.funds > 20e9) {
            log(ns, 'Round 3+: Creating Tobacco division');
            await corpApi.expandIndustry(ns, 'Tobacco', 'Tobacco');

            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    await corpApi.expandCity(ns, 'Tobacco', city);
                }
                await corpApi.purchaseWarehouse(ns, 'Tobacco', city);

                await corpApi.upgradeOfficeSize(ns, 'Tobacco', city, 27);
                for (let i = 0; i < 30; i++) {
                    await corpApi.hireEmployee(ns, 'Tobacco', city);
                }

                if (city === 'Sector-12') {
                    await corpApi.setAutoJobAssignment(ns, 'Tobacco', city, 'Operations', 6);
                    await corpApi.setAutoJobAssignment(ns, 'Tobacco', city, 'Engineer', 6);
                    await corpApi.setAutoJobAssignment(ns, 'Tobacco', city, 'Business', 6);
                    await corpApi.setAutoJobAssignment(ns, 'Tobacco', city, 'Management', 6);
                    await corpApi.setAutoJobAssignment(ns, 'Tobacco', city, 'Research & Development', 6);
                } else {
                    await corpApi.setAutoJobAssignment(ns, 'Tobacco', city, 'Research & Development', 30);
                }
            }

            await setupTobaccoExports(ns);
        }
        return;
    }

    const tobaccoDiv = await corpApi.getDivision(ns, 'Tobacco');

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
            await corpApi.cancelExportMaterial(ns, 'Agriculture', city, 'Chemical', city, 'Plants');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            await corpApi.exportMaterial(ns, 'Agriculture', city, 'Chemical', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }

    try {
        for (const city of CITIES) {
            await corpApi.cancelExportMaterial(ns, 'Chemical', city, 'Agriculture', city, 'Chemicals');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            await corpApi.exportMaterial(ns, 'Chemical', city, 'Agriculture', city, 'Chemicals', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function setupTobaccoExports(ns) {
    for (const city of CITIES) {
        try {
            await corpApi.exportMaterial(ns, 'Agriculture', city, 'Tobacco', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function buyBoostMaterials(ns, division) {
    const divData = await corpApi.getDivision(ns, division);

    for (const city of CITIES) {
        try {
            if (!(await corpApi.hasWarehouse(ns, division, city))) continue;

            const warehouse = await corpApi.getWarehouse(ns, division, city);
            const freeSpace = warehouse.size - warehouse.sizeUsed;

            if (freeSpace < 100) continue;

            const optimal = calculateOptimalBoostMaterials(divData.type, freeSpace * 0.8);
            if (!optimal) continue;

            for (const [material, targetQty] of Object.entries(optimal)) {
                const current = await corpApi.getMaterial(ns, division, city, material);
                const toBuy = targetQty - current.stored;

                if (toBuy > 0) {
                    await corpApi.buyMaterial(ns, division, city, material, toBuy / 10);
                }
            }
        } catch { }
    }

    await ns.sleep(10000);

    for (const city of CITIES) {
        try {
            await corpApi.buyMaterial(ns, division, city, 'AI Cores', 0);
            await corpApi.buyMaterial(ns, division, city, 'Hardware', 0);
            await corpApi.buyMaterial(ns, division, city, 'Real Estate', 0);
            await corpApi.buyMaterial(ns, division, city, 'Robots', 0);
        } catch { }
    }
}

async function canDevelopNewProduct(ns, division, state) {
    const divData = await corpApi.getDivision(ns, division);

    for (const productName of divData.products) {
        const product = await corpApi.getProduct(ns, division, 'Sector-12', productName);
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
    const corpData = await corpApi.getCorporation(ns);
    const divData = await corpApi.getDivision(ns, division);

    if (divData.products.length >= 3) {
        let oldestProduct = divData.products[0];
        let oldestRating = Infinity;

        for (const productName of divData.products) {
            const product = await corpApi.getProduct(ns, division, 'Sector-12', productName);
            if (product.developmentProgress >= 100 && product.effectiveRating < oldestRating) {
                oldestRating = product.effectiveRating;
                oldestProduct = productName;
            }
        }

        await corpApi.discontinueProduct(ns, division, oldestProduct);
        log(ns, `Discontinued product: ${oldestProduct}`);
    }

    const productName = getProductName(division, state.productVersion++);
    const investment = Math.max(1e9, corpData.funds * 0.01);

    await corpApi.makeProduct(ns, division, 'Sector-12', productName, investment, investment);
    log(ns, `Started developing product: ${productName}`);
}

async function buyWilsonAndAdvert(ns, division) {
    const corpData = await corpApi.getCorporation(ns);
    const divData = await corpApi.getDivision(ns, division);

    if (divData.awareness >= Number.MAX_VALUE * 0.9) return;

    const wilsonCost = await corpApi.getUpgradeLevelCost(ns, 'Wilson Analytics');
    if (corpData.funds > wilsonCost * 2) {
        await corpApi.levelUpgrade(ns, 'Wilson Analytics');
    }

    const advertCost = await corpApi.getHireAdVertCost(ns, division);
    if (corpData.funds > advertCost * 5) {
        await corpApi.hireAdVert(ns, division);
    }
}

async function buyResearch(ns, division) {
    const divData = await corpApi.getDivision(ns, division);
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
                if (!(await corpApi.hasResearched(ns, division, research.name))) {
                    await corpApi.research(ns, division, research.name);
                    log(ns, `Researched: ${research.name}`);
                    break;
                }
            } catch { }
        }
    }
}

async function upgradeProductionCapability(ns) {
    const corpData = await corpApi.getCorporation(ns);

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
            const cost = await corpApi.getUpgradeLevelCost(ns, upgrade);
            if (corpData.funds > cost * 10) {
                await corpApi.levelUpgrade(ns, upgrade);
            }
        } catch { }
    }
}

async function checkInvestment(ns, state) {
    const offer = await corpApi.getInvestmentOffer(ns);

    if (shouldAcceptInvestment(offer, state.round, 0)) {
        await corpApi.acceptInvestmentOffer(ns);
        log(ns, `Accepted investment offer: ${formatMoney(offer.funds)}`, true, 'success');
        state.round++;
    }
}
