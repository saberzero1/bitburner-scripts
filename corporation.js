import { log, getConfiguration, disableLogs, formatMoney, getErrorInfo } from './helpers.js'
import {
    INDUSTRIES, CITIES, calculateOptimalBoostMaterials, calculateOptimalPrice,
    calculateSmartSupplyQuantities, calculateOptimalPartyCost, waitForState,
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
    disableLogs(ns, ['sleep', 'getServerMoneyAvailable']);

    const corp = ns.corporation;
    const state = new CorpState(ns, options);

    if (!corp.hasCorporation()) {
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
        this.round = options.round || this.detectRound(ns);
        this.productVersion = 1;
        this.lastTeaParty = 0;
    }

    detectRound(ns) {
        const corp = ns.corporation;
        if (!corp.hasCorporation()) return 0;

        const corpData = corp.getCorporation();
        const numInvestments = corpData.numShares > 1e9 ? 0 : 
            corpData.numShares > 900e6 ? 1 :
            corpData.numShares > 800e6 ? 2 :
            corpData.numShares > 700e6 ? 3 : 4;

        return numInvestments + 1;
    }
}

async function createCorporation(ns, state) {
    const corp = ns.corporation;
    const options = state.options;

    log(ns, `Creating corporation: ${options['corp-name']}`);

    if (options['self-fund']) {
        const cost = 150e9;
        if (ns.getServerMoneyAvailable('home') < cost) {
            log(ns, `ERROR: Need ${formatMoney(cost)} to self-fund corporation`, true, 'error');
            return false;
        }
        corp.createCorporation(options['corp-name'], true);
    } else {
        corp.createCorporation(options['corp-name'], false);
    }

    state.round = 1;
    return true;
}

async function runCorpCycle(ns, state) {
    const corp = ns.corporation;
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
    const corp = ns.corporation;
    const corpData = corp.getCorporation();

    for (const division of corpData.divisions) {
        for (const city of CITIES) {
            try {
                const office = corp.getOffice(division, city);
                if (!office) continue;

                if (office.avgEnergy < 99) {
                    corp.buyTea(division, city);
                }

                if (office.avgMorale < 99) {
                    const partyCost = calculateOptimalPartyCost(office.avgMorale, 100);
                    corp.throwParty(division, city, partyCost);
                }
            } catch { }
        }
    }
}

async function runSmartSupply(ns, state) {
    const corp = ns.corporation;
    const corpData = corp.getCorporation();

    if (corpData.prevState !== 'SALE') return;

    for (const division of corpData.divisions) {
        const divData = corp.getDivision(division);
        
        for (const city of CITIES) {
            try {
                if (!corp.hasWarehouse(division, city)) continue;

                const supplies = calculateSmartSupplyQuantities(ns, division, city);
                
                for (const [material, amount] of Object.entries(supplies)) {
                    if (amount > 0) {
                        corp.buyMaterial(division, city, material, amount);
                    } else {
                        corp.buyMaterial(division, city, material, 0);
                    }
                }
            } catch { }
        }
    }
}

async function updatePricing(ns, state) {
    const corp = ns.corporation;
    const corpData = corp.getCorporation();

    for (const division of corpData.divisions) {
        const divData = corp.getDivision(division);
        const industry = INDUSTRIES[divData.type];
        if (!industry) continue;

        for (const city of CITIES) {
            try {
                if (!corp.hasWarehouse(division, city)) continue;

                if (industry.outputMaterials) {
                    for (const material of industry.outputMaterials) {
                        const mat = corp.getMaterial(division, city, material);
                        if (mat.stored > 0) {
                            const price = calculateOptimalPrice(ns, division, city, material, false);
                            corp.sellMaterial(division, city, material, 'MAX', price.toString());
                        }
                    }
                }

                if (industry.makesProducts) {
                    for (const productName of divData.products) {
                        const product = corp.getProduct(division, city, productName);
                        if (product.developmentProgress >= 100 && product.stored > 0) {
                            const price = calculateOptimalPrice(ns, division, city, productName, true);
                            corp.sellProduct(division, city, productName, 'MAX', price.toString(), false);
                        }
                    }
                }
            } catch { }
        }
    }
}

async function runRound1(ns, state) {
    const corp = ns.corporation;
    const corpData = corp.getCorporation();
    const verbose = state.options.verbose;

    const hasAgriculture = corpData.divisions.includes('Agriculture');
    
    if (!hasAgriculture) {
        log(ns, 'Round 1: Creating Agriculture division');
        corp.expandIndustry('Agriculture', 'Agriculture');
        
        for (const city of CITIES) {
            if (city !== 'Sector-12') {
                corp.expandCity('Agriculture', city);
            }
            corp.purchaseWarehouse('Agriculture', city);
            
            corp.upgradeOfficeSize('Agriculture', city, 1);
            
            for (let i = 0; i < 4; i++) {
                corp.hireEmployee('Agriculture', city);
            }
            corp.setAutoJobAssignment('Agriculture', city, 'Research & Development', 4);
        }
        return;
    }

    const agDiv = corp.getDivision('Agriculture');
    const sectorOffice = corp.getOffice('Agriculture', 'Sector-12');
    
    if (agDiv.researchPoints < 55 && sectorOffice.avgMorale >= 95) {
        if (verbose) log(ns, `Round 1: Waiting for RP (${agDiv.researchPoints.toFixed(0)}/55)`);
        return;
    }

    if (sectorOffice.employeeJobs['Research & Development'] === 4) {
        log(ns, 'Round 1: Switching employees from R&D to production');
        for (const city of CITIES) {
            corp.setAutoJobAssignment('Agriculture', city, 'Research & Development', 0);
            corp.setAutoJobAssignment('Agriculture', city, 'Operations', 1);
            corp.setAutoJobAssignment('Agriculture', city, 'Engineer', 1);
            corp.setAutoJobAssignment('Agriculture', city, 'Business', 1);
            corp.setAutoJobAssignment('Agriculture', city, 'Management', 1);
        }
    }

    await buyBoostMaterials(ns, 'Agriculture');

    const smartStorageLevel = corp.getUpgradeLevel('Smart Storage');
    if (smartStorageLevel < 10 && corpData.funds > 2e9) {
        corp.levelUpgrade('Smart Storage');
    }

    const advertLevel = corp.getHireAdVertCount('Agriculture');
    if (advertLevel < 2 && corpData.funds > 1e9) {
        corp.hireAdVert('Agriculture');
    }

    for (const city of CITIES) {
        const warehouse = corp.getWarehouse('Agriculture', city);
        if (warehouse.level < 3 && corpData.funds > 1e9) {
            corp.upgradeWarehouse('Agriculture', city);
        }
    }

    for (const city of CITIES) {
        const mat = corp.getMaterial('Agriculture', city, 'Plants');
        if (mat.stored > 0 && !mat.desiredSellPrice) {
            corp.sellMaterial('Agriculture', city, 'Plants', 'MAX', 'MP');
            corp.sellMaterial('Agriculture', city, 'Food', 'MAX', 'MP');
        }
    }
}

async function runRound2(ns, state) {
    const corp = ns.corporation;
    const corpData = corp.getCorporation();
    const verbose = state.options.verbose;

    if (!corp.hasUnlock('Export')) {
        if (corpData.funds > 20e9) {
            corp.purchaseUnlock('Export');
            log(ns, 'Round 2: Purchased Export unlock');
        }
        return;
    }

    const hasChemical = corpData.divisions.includes('Chemical');
    
    if (!hasChemical) {
        if (corpData.funds > 1e9) {
            log(ns, 'Round 2: Creating Chemical division');
            corp.expandIndustry('Chemical', 'Chemical');
            
            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    corp.expandCity('Chemical', city);
                }
                corp.purchaseWarehouse('Chemical', city);
                
                for (let i = 0; i < 3; i++) {
                    corp.hireEmployee('Chemical', city);
                }
                corp.setAutoJobAssignment('Chemical', city, 'Research & Development', 3);
            }
        }
        return;
    }

    const chemDiv = corp.getDivision('Chemical');
    if (chemDiv.researchPoints < 390) {
        if (verbose) log(ns, `Round 2: Waiting for Chemical RP (${chemDiv.researchPoints.toFixed(0)}/390)`);
    }

    const agDiv = corp.getDivision('Agriculture');
    if (agDiv.researchPoints < 700) {
        if (verbose) log(ns, `Round 2: Waiting for Agriculture RP (${agDiv.researchPoints.toFixed(0)}/700)`);
    }

    setupExportRoutes(ns);

    for (const city of CITIES) {
        const office = corp.getOffice('Agriculture', city);
        if (office.size < 8 && corpData.funds > 4e9) {
            const toAdd = 8 - office.size;
            corp.upgradeOfficeSize('Agriculture', city, toAdd);
            for (let i = 0; i < toAdd; i++) {
                corp.hireEmployee('Agriculture', city);
            }
        }
    }

    const advertLevel = corp.getHireAdVertCount('Agriculture');
    if (advertLevel < 8 && corpData.funds > 1e9) {
        corp.hireAdVert('Agriculture');
    }

    const smartStorageLevel = corp.getUpgradeLevel('Smart Storage');
    if (smartStorageLevel < 15 && corpData.funds > 2e9) {
        corp.levelUpgrade('Smart Storage');
    }

    const smartFactoriesLevel = corp.getUpgradeLevel('Smart Factories');
    if (smartFactoriesLevel < 10 && corpData.funds > 2e9) {
        corp.levelUpgrade('Smart Factories');
    }

    await buyBoostMaterials(ns, 'Agriculture');
}

async function runRound3Plus(ns, state) {
    const corp = ns.corporation;
    const corpData = corp.getCorporation();
    const verbose = state.options.verbose;

    const hasTobacco = corpData.divisions.includes('Tobacco');
    
    if (!hasTobacco) {
        if (corpData.funds > 20e9) {
            log(ns, 'Round 3+: Creating Tobacco division');
            corp.expandIndustry('Tobacco', 'Tobacco');
            
            for (const city of CITIES) {
                if (city !== 'Sector-12') {
                    corp.expandCity('Tobacco', city);
                }
                corp.purchaseWarehouse('Tobacco', city);
                
                corp.upgradeOfficeSize('Tobacco', city, 27);
                for (let i = 0; i < 30; i++) {
                    corp.hireEmployee('Tobacco', city);
                }
                
                if (city === 'Sector-12') {
                    corp.setAutoJobAssignment('Tobacco', city, 'Operations', 6);
                    corp.setAutoJobAssignment('Tobacco', city, 'Engineer', 6);
                    corp.setAutoJobAssignment('Tobacco', city, 'Business', 6);
                    corp.setAutoJobAssignment('Tobacco', city, 'Management', 6);
                    corp.setAutoJobAssignment('Tobacco', city, 'Research & Development', 6);
                } else {
                    corp.setAutoJobAssignment('Tobacco', city, 'Research & Development', 30);
                }
            }
            
            setupTobaccoExports(ns);
        }
        return;
    }

    const tobaccoDiv = corp.getDivision('Tobacco');
    
    if (tobaccoDiv.products.length === 0 || canDevelopNewProduct(ns, 'Tobacco', state)) {
        await developNewProduct(ns, 'Tobacco', state);
    }

    await buyWilsonAndAdvert(ns, 'Tobacco');

    await buyResearch(ns, 'Tobacco');

    await upgradeProductionCapability(ns);
}

function setupExportRoutes(ns) {
    const corp = ns.corporation;
    
    try {
        for (const city of CITIES) {
            corp.cancelExportMaterial('Agriculture', city, 'Chemical', city, 'Plants');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            corp.exportMaterial('Agriculture', city, 'Chemical', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }

    try {
        for (const city of CITIES) {
            corp.cancelExportMaterial('Chemical', city, 'Agriculture', city, 'Chemicals');
        }
    } catch { }

    for (const city of CITIES) {
        try {
            corp.exportMaterial('Chemical', city, 'Agriculture', city, 'Chemicals', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

function setupTobaccoExports(ns) {
    const corp = ns.corporation;
    
    for (const city of CITIES) {
        try {
            corp.exportMaterial('Agriculture', city, 'Tobacco', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function buyBoostMaterials(ns, division) {
    const corp = ns.corporation;
    const divData = corp.getDivision(division);

    for (const city of CITIES) {
        try {
            if (!corp.hasWarehouse(division, city)) continue;
            
            const warehouse = corp.getWarehouse(division, city);
            const freeSpace = warehouse.size - warehouse.sizeUsed;
            
            if (freeSpace < 100) continue;

            const optimal = calculateOptimalBoostMaterials(divData.type, freeSpace * 0.8);
            if (!optimal) continue;

            for (const [material, targetQty] of Object.entries(optimal)) {
                const current = corp.getMaterial(division, city, material);
                const toBuy = targetQty - current.stored;
                
                if (toBuy > 0) {
                    corp.buyMaterial(division, city, material, toBuy / 10);
                }
            }
        } catch { }
    }

    await ns.sleep(10000);

    for (const city of CITIES) {
        try {
            corp.buyMaterial(division, city, 'AI Cores', 0);
            corp.buyMaterial(division, city, 'Hardware', 0);
            corp.buyMaterial(division, city, 'Real Estate', 0);
            corp.buyMaterial(division, city, 'Robots', 0);
        } catch { }
    }
}

function canDevelopNewProduct(ns, division, state) {
    const corp = ns.corporation;
    const divData = corp.getDivision(division);
    
    for (const productName of divData.products) {
        const product = corp.getProduct(division, 'Sector-12', productName);
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
    const corp = ns.corporation;
    const corpData = corp.getCorporation();
    const divData = corp.getDivision(division);

    if (divData.products.length >= 3) {
        let oldestProduct = divData.products[0];
        let oldestRating = Infinity;
        
        for (const productName of divData.products) {
            const product = corp.getProduct(division, 'Sector-12', productName);
            if (product.developmentProgress >= 100 && product.effectiveRating < oldestRating) {
                oldestRating = product.effectiveRating;
                oldestProduct = productName;
            }
        }
        
        corp.discontinueProduct(division, oldestProduct);
        log(ns, `Discontinued product: ${oldestProduct}`);
    }

    const productName = getProductName(division, state.productVersion++);
    const investment = Math.max(1e9, corpData.funds * 0.01);
    
    corp.makeProduct(division, 'Sector-12', productName, investment, investment);
    log(ns, `Started developing product: ${productName}`);
}

async function buyWilsonAndAdvert(ns, division) {
    const corp = ns.corporation;
    const corpData = corp.getCorporation();
    const divData = corp.getDivision(division);

    if (divData.awareness >= Number.MAX_VALUE * 0.9) return;

    const wilsonCost = corp.getUpgradeLevelCost('Wilson Analytics');
    if (corpData.funds > wilsonCost * 2) {
        corp.levelUpgrade('Wilson Analytics');
    }

    const advertCost = corp.getHireAdVertCost(division);
    if (corpData.funds > advertCost * 5) {
        corp.hireAdVert(division);
    }
}

async function buyResearch(ns, division) {
    const corp = ns.corporation;
    const divData = corp.getDivision(division);
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
                if (!corp.hasResearched(division, research.name)) {
                    corp.research(division, research.name);
                    log(ns, `Researched: ${research.name}`);
                    break;
                }
            } catch { }
        }
    }
}

async function upgradeProductionCapability(ns) {
    const corp = ns.corporation;
    const corpData = corp.getCorporation();

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
            const cost = corp.getUpgradeLevelCost(upgrade);
            if (corpData.funds > cost * 10) {
                corp.levelUpgrade(upgrade);
            }
        } catch { }
    }
}

async function checkInvestment(ns, state) {
    const corp = ns.corporation;
    
    if (shouldAcceptInvestment(ns, state.round, 0)) {
        const offer = corp.getInvestmentOffer();
        corp.acceptInvestmentOffer();
        log(ns, `Accepted investment offer: ${formatMoney(offer.funds)}`, true, 'success');
        state.round++;
    }
}
