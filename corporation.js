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
// Many corp functions return void/undefined, which causes getNsDataThroughFile to fail
// (see helpers.js Issue #481). Wrap with ?? 'OK' to always return a serializable value.
const execCorpFunc = async (ns, strFunction, ...args) =>
    await getNsDataThroughFile(ns, `ns.corporation.${strFunction} ?? 'OK'`, null, args);

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
        this.lastStatusLog = 0;
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

    // Periodic status logging with detailed diagnostics
    const now = Date.now();
    if (now - state.lastStatusLog > 30000) {
        state.lastStatusLog = now;
        const corpData = await execCorpFunc(ns, 'getCorporation()');
        log(ns, `Status: Round ${state.round}, Funds: ${formatMoney(corpData.funds)}, Revenue: ${formatMoney(corpData.revenue)}/s`);
        for (const divName of corpData.divisions) {
            const div = await execCorpFunc(ns, 'getDivision(ns.args[0])', divName);
            const citiesWithWH = [];
            for (const city of div.cities) {
                if (await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', divName, city)) {
                    citiesWithWH.push(city);
                }
            }
            log(ns, `  ${divName}: ${div.cities.length}/6 cities, ${citiesWithWH.length} warehouses, Revenue: ${formatMoney(div.lastCycleRevenue)}/cycle`);
            // Show employee jobs for main city
            try {
                const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', divName, 'Sector-12');
                const jobs = office.employeeJobs;
                log(ns, `    Jobs: Ops=${jobs.Operations||0} Eng=${jobs.Engineer||0} Bus=${jobs.Business||0} Mgmt=${jobs.Management||0} R&D=${jobs['Research & Development']||0}`);
            } catch { }
        }
    }
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

async function maintainEmployees(ns, corpState) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    for (const division of corpData.divisions) {
        // Get division data to check which cities it has expanded to
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);
        
        for (const city of CITIES) {
            // Skip cities where this division doesn't have an office
            if (!divData.cities.includes(city)) continue;
            
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

    if (corpData.nextState !== 'SALE') return;

    for (const division of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);
        const industry = INDUSTRIES[divData.type];
        if (!industry || !industry.inputMaterials) continue;

        for (const city of CITIES) {
            // Skip cities where this division hasn't expanded
            if (!divData.cities.includes(city)) continue;
            
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
            // Skip cities where this division hasn't expanded
            if (!divData.cities.includes(city)) continue;
            
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
    let corpData = await execCorpFunc(ns, 'getCorporation()');
    const verbose = state.options.verbose;

    const hasAgriculture = corpData.divisions.includes('Agriculture');

    if (!hasAgriculture) {
        log(ns, 'Round 1: Creating Agriculture division');
        await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Agriculture', 'Agriculture');
        await ns.sleep(500);
        return;
    }

    const agDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Agriculture');

    // Costs (approximate): expandCity ~4b, warehouse ~5b
    const EXPAND_COST = 4e9;
    const WAREHOUSE_COST = 5e9;
    const MIN_FUNDS = 1e9;

    // Check if we need to expand to all cities and set up warehouses
    let allCitiesReady = true;
    for (const city of CITIES) {
        // Refresh corp data to get current funds
        corpData = await execCorpFunc(ns, 'getCorporation()');

        if (!agDiv.cities.includes(city)) {
            if (city !== 'Sector-12') {
                if (corpData.funds < EXPAND_COST) {
                    if (verbose) log(ns, `Round 1: Waiting for funds to expand to ${city}`);
                    allCitiesReady = false;
                    continue;
                }
                try {
                    log(ns, `Round 1: Expanding to ${city}`);
                    await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Agriculture', city);
                    await ns.sleep(200);
                } catch { allCitiesReady = false; continue; }
            }
            allCitiesReady = false;
            continue;
        }

        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (!hasWarehouse) {
            if (corpData.funds < WAREHOUSE_COST) {
                if (verbose) log(ns, `Round 1: Waiting for funds for warehouse in ${city}`);
                allCitiesReady = false;
                continue;
            }
            try {
                log(ns, `Round 1: Purchasing warehouse in ${city}`);
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
                await ns.sleep(200);
            } catch { allCitiesReady = false; continue; }
            allCitiesReady = false;
            continue;
        }

        const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (office.numEmployees < 4) {
            if (corpData.funds < MIN_FUNDS) {
                allCitiesReady = false;
                continue;
            }
            try {
                if (office.size < 4) {
                    await execCorpFunc(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', 'Agriculture', city, 4 - office.size);
                }
                for (let i = office.numEmployees; i < 4; i++) {
                    await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Agriculture', city);
                }
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Research & Development', 4);
            } catch { allCitiesReady = false; }
            allCitiesReady = false;
        }
    }

    if (!allCitiesReady) {
        if (verbose) log(ns, 'Round 1: Setting up cities...');
        return;
    }

    // All cities have warehouses and employees - now proceed with rest of Round 1
    const sectorOffice = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Agriculture', 'Sector-12');

    // Wait for research points OR low morale (need both conditions met to proceed)
    if (agDiv.researchPoints < 55 || sectorOffice.avgMorale < 95) {
        if (verbose) log(ns, `Round 1: Waiting for conditions (RP: ${agDiv.researchPoints.toFixed(0)}/55, Morale: ${sectorOffice.avgMorale.toFixed(0)}/95)`);
        return;
    }

    // Check if employees are still in R&D mode (any > 0 means we need to switch)
    const rdEmployees = sectorOffice.employeeJobs['Research & Development'] || 0;
    const opsEmployees = sectorOffice.employeeJobs['Operations'] || 0;
    
    // Switch from R&D to production if not already done
    if (rdEmployees > 0 || opsEmployees === 0) {
        log(ns, `Round 1: Switching employees from R&D (${rdEmployees}) to production jobs`);
        for (const city of CITIES) {
            if (!agDiv.cities.includes(city)) continue;
            try {
                // First clear R&D
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Research & Development', 0);
                // Then assign to production roles
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Operations', 1);
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Engineer', 1);
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Business', 1);
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Agriculture', city, 'Management', 1);
            } catch (err) {
                log(ns, `WARNING: Failed to assign jobs in ${city}: ${err}`, false, 'warning');
            }
        }
        log(ns, 'Round 1: Employees switched to production roles');
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
        if (!agDiv.cities.includes(city)) continue;
        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (!hasWarehouse) continue;
        const warehouse = await execCorpFunc(ns, 'getWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (warehouse.level < 3 && corpData.funds > 1e9) {
            await execCorpFunc(ns, 'upgradeWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        }
    }

    for (const city of CITIES) {
        if (!agDiv.cities.includes(city)) continue;
        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (!hasWarehouse) continue;
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

    // Check if Agriculture exists first - if not, we need to run Round 1 logic
    const hasAgriculture = corpData.divisions.includes('Agriculture');
    if (!hasAgriculture) {
        await runRound1(ns, state);
        return;
    }

    // Verify Agriculture is fully set up (all cities have warehouses)
    const agDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Agriculture');
    for (const city of CITIES) {
        if (!agDiv.cities.includes(city)) {
            if (verbose) log(ns, `Round 2: Agriculture not expanded to ${city}, running Round 1`);
            await runRound1(ns, state);
            return;
        }
        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (!hasWarehouse) {
            if (verbose) log(ns, `Round 2: Agriculture missing warehouse in ${city}, running Round 1`);
            await runRound1(ns, state);
            return;
        }
    }

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
            await ns.sleep(500); // Wait for division to initialize
        }
        return;
    }

    // Chemical division exists - ensure it's fully expanded with warehouses
    const chemDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Chemical');
    let chemicalFullySetUp = true;
    
    // Costs (approximate): expandCity ~4b, warehouse ~5b
    const EXPAND_COST = 4e9;
    const WAREHOUSE_COST = 5e9;

    for (const city of CITIES) {
        // Refresh corp data to get current funds
        corpData = await execCorpFunc(ns, 'getCorporation()');
        
        if (!chemDiv.cities.includes(city)) {
            // Expand to this city
            if (city !== 'Sector-12') {
                if (corpData.funds < EXPAND_COST) {
                    if (verbose) log(ns, `Round 2: Waiting for funds to expand Chemical to ${city}`);
                    chemicalFullySetUp = false;
                    continue;
                }
                try {
                    log(ns, `Round 2: Expanding Chemical to ${city}`);
                    await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Chemical', city);
                    await ns.sleep(200);
                } catch { chemicalFullySetUp = false; continue; }
            }
            chemicalFullySetUp = false;
            continue;
        }
        
        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Chemical', city);
        if (!hasWarehouse) {
            if (corpData.funds < WAREHOUSE_COST) {
                if (verbose) log(ns, `Round 2: Waiting for funds for warehouse in ${city}`);
                chemicalFullySetUp = false;
                continue;
            }
            try {
                log(ns, `Round 2: Purchasing warehouse for Chemical in ${city}`);
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Chemical', city);
                await ns.sleep(200);
            } catch { chemicalFullySetUp = false; continue; }
            chemicalFullySetUp = false;
            continue;
        }

        // Check employees - need funds to hire
        const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Chemical', city);
        if (office.numEmployees < 3) {
            if (corpData.funds < 1e6) {  // Hiring is cheap but needs SOME funds
                if (verbose) log(ns, `Round 2: Waiting for funds to hire Chemical employees in ${city}`);
                chemicalFullySetUp = false;
                continue;
            }
            try {
                for (let i = office.numEmployees; i < 3; i++) {
                    await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Chemical', city);
                }
                await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', 'Chemical', city, 'Research & Development', 3);
                log(ns, `Round 2: Hired ${3 - office.numEmployees} employees for Chemical in ${city}`);
            } catch (err) {
                log(ns, `WARNING: Failed to hire Chemical employees in ${city}: ${err}`, false, 'warning');
                chemicalFullySetUp = false;
                continue;
            }
            chemicalFullySetUp = false;
        }
    }

    if (!chemicalFullySetUp) {
        if (verbose) log(ns, 'Round 2: Setting up Chemical division...');
        return;
    }

    // Both divisions are fully set up - now we can safely set up export routes
    if (chemDiv.researchPoints < 390) {
        if (verbose) log(ns, `Round 2: Waiting for Chemical RP (${chemDiv.researchPoints.toFixed(0)}/390)`);
    }

    if (agDiv.researchPoints < 700) {
        if (verbose) log(ns, `Round 2: Waiting for Agriculture RP (${agDiv.researchPoints.toFixed(0)}/700)`);
    }

    await setupExportRoutes(ns, agDiv, chemDiv);

    for (const city of CITIES) {
        if (!agDiv.cities.includes(city)) continue;
        
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

    // Check prerequisites - need Agriculture and Chemical from earlier rounds
    const hasAgriculture = corpData.divisions.includes('Agriculture');
    const hasChemical = corpData.divisions.includes('Chemical');
    
    if (!hasAgriculture) {
        // Need to complete Round 1 first
        await runRound1(ns, state);
        return;
    }
    
    if (!hasChemical) {
        // Need to complete Round 2 first
        await runRound2(ns, state);
        return;
    }

    const hasTobacco = corpData.divisions.includes('Tobacco');
    if (!hasTobacco) {
        if (corpData.funds > 20e9) {
            log(ns, 'Round 3+: Creating Tobacco division');
            await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Tobacco', 'Tobacco');
            await ns.sleep(500); // Wait for division to initialize
        }
        return;
    }

    // Tobacco division exists - ensure it's fully expanded with warehouses
    const tobaccoDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Tobacco');
    let tobaccoFullySetUp = true;
    
    // Costs (approximate): expandCity ~4b, warehouse ~5b, upgradeOfficeSize varies
    const EXPAND_COST = 4e9;
    const WAREHOUSE_COST = 5e9;
    const OFFICE_UPGRADE_COST = 2e9;

    for (const city of CITIES) {
        // Refresh corp data to get current funds
        corpData = await execCorpFunc(ns, 'getCorporation()');
        
        if (!tobaccoDiv.cities.includes(city)) {
            if (city !== 'Sector-12') {
                if (corpData.funds < EXPAND_COST) {
                    if (verbose) log(ns, `Round 3+: Waiting for funds to expand Tobacco to ${city}`);
                    tobaccoFullySetUp = false;
                    continue;
                }
                try {
                    log(ns, `Round 3+: Expanding Tobacco to ${city}`);
                    await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Tobacco', city);
                    await ns.sleep(200);
                } catch { tobaccoFullySetUp = false; continue; }
            }
            tobaccoFullySetUp = false;
            continue;
        }

        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Tobacco', city);
        if (!hasWarehouse) {
            if (corpData.funds < WAREHOUSE_COST) {
                if (verbose) log(ns, `Round 3+: Waiting for funds for warehouse in ${city}`);
                tobaccoFullySetUp = false;
                continue;
            }
            try {
                log(ns, `Round 3+: Purchasing warehouse for Tobacco in ${city}`);
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Tobacco', city);
                await ns.sleep(200);
            } catch { tobaccoFullySetUp = false; continue; }
            tobaccoFullySetUp = false;
            continue;
        }

        // Check office size and employees
        const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Tobacco', city);
        if (office.size < 30) {
            if (corpData.funds < OFFICE_UPGRADE_COST) {
                if (verbose) log(ns, `Round 3+: Waiting for funds to upgrade office in ${city}`);
                tobaccoFullySetUp = false;
                continue;
            }
            try {
                const toAdd = 30 - office.size;
                await execCorpFunc(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', 'Tobacco', city, toAdd);
            } catch { tobaccoFullySetUp = false; continue; }
            tobaccoFullySetUp = false;
            continue;
        }

        if (office.numEmployees < 30) {
            for (let i = office.numEmployees; i < 30; i++) {
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
            tobaccoFullySetUp = false;
        }
    }

    if (!tobaccoFullySetUp) {
        if (verbose) log(ns, 'Round 3+: Setting up Tobacco division...');
        return;
    }

    // Set up exports from Agriculture to Tobacco
    const agDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Agriculture');
    await setupTobaccoExports(ns, agDiv, tobaccoDiv);

    if (tobaccoDiv.products.length === 0 || await canDevelopNewProduct(ns, 'Tobacco', state)) {
        await developNewProduct(ns, 'Tobacco', state);
    }

    await buyWilsonAndAdvert(ns, 'Tobacco');

    await buyResearch(ns, 'Tobacco');

    await upgradeProductionCapability(ns);
}

async function setupExportRoutes(ns, agDiv, chemDiv) {
    // Only set up exports for cities where BOTH divisions have warehouses
    for (const city of CITIES) {
        // Check Agriculture has warehouse in this city
        if (!agDiv.cities.includes(city)) continue;
        const agHasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (!agHasWarehouse) continue;

        // Check Chemical has warehouse in this city
        if (!chemDiv.cities.includes(city)) continue;
        const chemHasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Chemical', city);
        if (!chemHasWarehouse) continue;

        // Both have warehouses - set up export routes
        try {
            await execCorpFunc(ns, 'cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', 'Agriculture', city, 'Chemical', city, 'Plants');
        } catch { }
        
        try {
            await execCorpFunc(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', 'Agriculture', city, 'Chemical', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }

        try {
            await execCorpFunc(ns, 'cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', 'Chemical', city, 'Agriculture', city, 'Chemicals');
        } catch { }
        
        try {
            await execCorpFunc(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', 'Chemical', city, 'Agriculture', city, 'Chemicals', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function setupTobaccoExports(ns, agDiv, tobaccoDiv) {
    for (const city of CITIES) {
        // Check both divisions have warehouses
        if (!agDiv.cities.includes(city)) continue;
        const agHasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (!agHasWarehouse) continue;

        if (!tobaccoDiv.cities.includes(city)) continue;
        const tobaccoHasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Tobacco', city);
        if (!tobaccoHasWarehouse) continue;

        try {
            await execCorpFunc(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', 'Agriculture', city, 'Tobacco', city, 'Plants', '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

async function buyBoostMaterials(ns, division) {
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);

    for (const city of CITIES) {
        // Skip cities where division hasn't expanded
        if (!divData.cities.includes(city)) continue;

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
        if (!divData.cities.includes(city)) continue;
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

    // Log investment status with the periodic status update
    if (offer && offer.funds > 0) {
        const minimums = { 1: 100e9, 2: 200e9, 3: 5e12, 4: 50e12 };
        const needed = minimums[state.round] || 0;
        const canAccept = offer.funds >= needed;
        if (Date.now() - state.lastStatusLog < 1000) {
            log(ns, `Investment: ${formatMoney(offer.funds)} offered (need ${formatMoney(needed)})${canAccept ? ' - ACCEPTING!' : ''}`);
        }
    }

    if (shouldAcceptInvestment(offer, state.round, 0)) {
        await execCorpFunc(ns, 'acceptInvestmentOffer()');
        log(ns, `Accepted investment offer: ${formatMoney(offer.funds)}`, true, 'success');
        state.round++;
    }
}
