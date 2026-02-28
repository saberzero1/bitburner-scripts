/**
 * Corporation Management Script - Rewritten based on BitBurner source code analysis
 * 
 * Key insights from source code:
 * 1. Production requires warehouse space for OUTPUT (not just inputs)
 * 2. Boost materials provide exponential multipliers
 * 3. Employee productivity = (Ops^0.4 + Eng^0.3) × MgmtFactor × 0.05
 * 4. Smart supply trails by 1 cycle
 * 5. Valuation = 10B + funds/3 + profit/s × 315000 (for private corps)
 * 
 * Architecture:
 * - Warehouse space is budgeted: boost materials + input buffer + output headroom
 * - Employees optimized for production roles (not stuck in R&D)
 * - Selling is ALWAYS set up before buying inputs
 * - Investment accepted when profitable, not when hitting arbitrary thresholds
 */

import { log, getConfiguration, disableLogs, formatMoney, getErrorInfo, getNsDataThroughFile } from './helpers.js'
import {
    INDUSTRIES, CITIES, MATERIAL_SIZES,
    calculateWarehouseSpaceBudget, calculateOptimalBoostMaterials, calculateProductionMultiplier,
    calculateOptimalEmployeeDistribution, calculateSmartSupplyQuantities, checkWarehouseHealth,
    calculateOptimalPrice, calculateOptimalPartyCost, getProductName,
    shouldAcceptInvestment, diagnoseZeroProduction
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
    ['debug', false],          // Extra diagnostic output
    ['warehouse-target', 0.7], // Target warehouse utilization (0.7 = 70%)
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

// RAM-dodging helper to execute corporation functions
// Many corp functions return void/undefined, which causes getNsDataThroughFile to fail
// Wrap with ?? 'OK' to always return a serializable value
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
        if (!await initCorporation(ns, state)) {
            log(ns, 'ERROR: Failed to create corporation', true, 'error');
            return;
        }
    }

    log(ns, 'Corporation manager starting...', true, 'info');

    while (true) {
        try {
            await runCorpCycle(ns, state);
        } catch (err) {
            log(ns, `Corp cycle error: ${getErrorInfo(err)}`, false, 'warning');
        }
        await ns.sleep(1000);
    }
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

class CorpState {
    constructor(ns, options) {
        this.options = options;
        this.round = options.round || 0;
        this.productVersion = 1;
        this.lastStatusLog = 0;
        this.lastDiagnostic = 0;
        this.initialized = false;
        this.warehouseTarget = options['warehouse-target'] || 0.7;
    }

    async init(ns) {
        if (this.initialized) return;
        this.round = this.options.round || await this.detectRound(ns);
        this.initialized = true;
    }

    async detectRound(ns) {
        if (!(await execCorpFunc(ns, 'hasCorporation()'))) return 0;

        const corpData = await execCorpFunc(ns, 'getCorporation()');
        // Detect round based on shares sold
        const numInvestments = corpData.numShares > 1e9 ? 0 :
            corpData.numShares > 900e6 ? 1 :
                corpData.numShares > 800e6 ? 2 :
                    corpData.numShares > 700e6 ? 3 : 4;

        return numInvestments + 1;
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initCorporation(ns, state) {
    const options = state.options;
    log(ns, `Creating corporation: ${options['corp-name']}`);

    if (options['self-fund']) {
        const cost = 150e9;
        if (ns.getServerMoneyAvailable('home') < cost) {
            log(ns, `Need ${formatMoney(cost)} to self-fund corporation`, true, 'error');
            return false;
        }
        await execCorpFunc(ns, 'createCorporation(ns.args[0], ns.args[1])', options['corp-name'], true);
    } else {
        await execCorpFunc(ns, 'createCorporation(ns.args[0], ns.args[1])', options['corp-name'], false);
    }

    state.round = 1;
    return true;
}

// ============================================================================
// MAIN CYCLE
// ============================================================================

async function runCorpCycle(ns, state) {
    await state.init(ns);
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    // Periodic status logging
    const now = Date.now();
    if (now - state.lastStatusLog > 30000) {
        state.lastStatusLog = now;
        await logCorpStatus(ns, corpData, state);
    }

    // CRITICAL: These must run in the correct order
    // 1. Maintain employees (energy, morale)
    await maintainEmployees(ns);
    
    // 2. Ensure selling is set up BEFORE buying anything
    await ensureSelling(ns);
    
    // 3. Manage warehouse space (boost materials + inputs)
    await manageWarehouses(ns, state);
    
    // 4. Update pricing if Market-TA enabled
    if (state.options['market-ta']) {
        await updatePricing(ns);
    }

    // 5. Run round-specific logic
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

    // 6. Check for investment opportunities
    if (state.options['auto-invest'] && state.round < state.options['target-round']) {
        await checkInvestment(ns, state);
    }
}

// ============================================================================
// STATUS LOGGING & DIAGNOSTICS
// ============================================================================

async function logCorpStatus(ns, corpData, state) {
    log(ns, `Status: Round ${state.round}, Funds: ${formatMoney(corpData.funds)}, Revenue: ${formatMoney(corpData.revenue)}/s`);
    
    for (const divName of corpData.divisions) {
        const div = await execCorpFunc(ns, 'getDivision(ns.args[0])', divName);
        const industry = INDUSTRIES[div.type];
        
        // Count cities with warehouses
        let warehouseCities = [];
        for (const city of div.cities) {
            if (await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', divName, city)) {
                warehouseCities.push(city);
            }
        }
        
        log(ns, `  ${divName}: ${div.cities.length}/6 cities, ${warehouseCities.length} warehouses, Revenue: ${formatMoney(div.lastCycleRevenue)}/cycle`);
        
        // Show main office stats
        if (div.cities.includes('Sector-12')) {
            const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', divName, 'Sector-12');
            const jobs = office.employeeJobs;
            log(ns, `    Employees: Ops=${jobs.Operations||0} Eng=${jobs.Engineer||0} Bus=${jobs.Business||0} Mgmt=${jobs.Management||0} R&D=${jobs['Research & Development']||0}`);
            log(ns, `    Energy=${office.avgEnergy.toFixed(0)}, Morale=${office.avgMorale.toFixed(0)}`);
        }
        
        // Show warehouse and production stats
        if (warehouseCities.length > 0 && industry) {
            const city = warehouseCities[0];
            const warehouse = await execCorpFunc(ns, 'getWarehouse(ns.args[0], ns.args[1])', divName, city);
            const health = checkWarehouseHealth(warehouse);
            
            log(ns, `    Warehouse: ${warehouse.sizeUsed.toFixed(0)}/${warehouse.size} (${(health.utilization * 100).toFixed(1)}%)${health.isCritical ? ' CRITICAL!' : ''}`);
            
            // Show output materials for non-product industries
            if (industry.outputMaterials?.length > 0) {
                for (const mat of industry.outputMaterials) {
                    const matData = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', divName, city, mat);
                    log(ns, `    ${mat}: ${matData.stored.toFixed(0)} (prod=${matData.productionAmount.toFixed(2)}/s, sell=${matData.actualSellAmount.toFixed(2)}/s)`);
                }
            }
            
            // Run diagnostics if production is zero
            if (state.options.debug && industry.outputMaterials?.length > 0) {
                const firstOutput = industry.outputMaterials[0];
                const outputMat = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', divName, city, firstOutput);
                
                if (outputMat.productionAmount === 0) {
                    // Gather all materials for diagnosis
                    const materials = {};
                    for (const matName of [...Object.keys(industry.inputMaterials || {}), ...industry.outputMaterials, 'Real Estate', 'Hardware', 'Robots', 'AI Cores']) {
                        try {
                            materials[matName] = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', divName, city, matName);
                        } catch {}
                    }
                    
                    const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', divName, city);
                    const diagnosis = diagnoseZeroProduction(div, warehouse, office, materials);
                    
                    if (!diagnosis.isHealthy) {
                        log(ns, `    PRODUCTION ISSUES FOUND:`, false, 'warning');
                        for (const issue of diagnosis.issues) {
                            log(ns, `      [${issue.severity.toUpperCase()}] ${issue.issue}: ${issue.detail}`, false, issue.severity === 'critical' ? 'error' : 'warning');
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// EMPLOYEE MANAGEMENT
// ============================================================================

async function maintainEmployees(ns) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    for (const divName of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', divName);
        
        for (const city of divData.cities) {
            try {
                const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', divName, city);
                if (!office || office.numEmployees === 0) continue;

                // Buy tea if energy is low
                if (office.avgEnergy < 98) {
                    await execCorpFunc(ns, 'buyTea(ns.args[0], ns.args[1])', divName, city);
                }

                // Throw party if morale is low
                if (office.avgMorale < 98) {
                    const partyCost = calculateOptimalPartyCost(office.avgMorale, 100);
                    await execCorpFunc(ns, 'throwParty(ns.args[0], ns.args[1], ns.args[2])', divName, city, partyCost);
                }
            } catch { }
        }
    }
}

/**
 * Assign employees to optimal production distribution
 */
async function assignEmployeesToProduction(ns, divName, city, forProducts = false) {
    const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', divName, city);
    const distribution = calculateOptimalEmployeeDistribution(office.numEmployees, forProducts);
    
    // Clear all assignments first
    for (const job of ['Operations', 'Engineer', 'Business', 'Management', 'Research & Development']) {
        await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, job, 0);
    }
    
    // Assign to optimal distribution
    for (const [job, count] of Object.entries(distribution)) {
        if (count > 0) {
            await execCorpFunc(ns, 'setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, job, count);
        }
    }
    
    return distribution;
}

// ============================================================================
// SELLING MANAGEMENT
// ============================================================================

async function ensureSelling(ns) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    
    for (const divName of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', divName);
        const industry = INDUSTRIES[divData.type];
        if (!industry) continue;
        
        for (const city of divData.cities) {
            try {
                if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', divName, city))) continue;
                
                // Set up selling for all OUTPUT materials
                for (const material of industry.outputMaterials || []) {
                    const mat = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', divName, city, material);
                    // Set up selling if not already configured
                    if (!mat.desiredSellPrice || mat.desiredSellPrice === '0' || mat.desiredSellPrice === 0) {
                        await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', divName, city, material, 'MAX', 'MP');
                    }
                }
                
                // Ensure INPUT materials are NOT being sold (they should only be consumed)
                for (const material of Object.keys(industry.inputMaterials || {})) {
                    await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', divName, city, material, '0', '0');
                }
            } catch { }
        }
    }
}

// ============================================================================
// WAREHOUSE MANAGEMENT - THE CRITICAL PIECE
// ============================================================================

async function manageWarehouses(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    
    for (const divName of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', divName);
        const industry = INDUSTRIES[divData.type];
        if (!industry) continue;
        
        for (const city of divData.cities) {
            try {
                if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', divName, city))) continue;
                
                const warehouse = await execCorpFunc(ns, 'getWarehouse(ns.args[0], ns.args[1])', divName, city);
                const health = checkWarehouseHealth(warehouse);
                
                // Get current materials
                const materials = {};
                for (const matName of ['Real Estate', 'Hardware', 'Robots', 'AI Cores', ...Object.keys(industry.inputMaterials || {})]) {
                    try {
                        materials[matName] = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', divName, city, matName);
                    } catch {}
                }
                
                // If warehouse is critically full (>95%), emergency measures
                if (health.isCritical) {
                    // Stop ALL buying
                    for (const mat of ['Real Estate', 'Hardware', 'Robots', 'AI Cores']) {
                        await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, mat, 0);
                    }
                    for (const mat of Object.keys(industry.inputMaterials || {})) {
                        await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, mat, 0);
                    }
                    
                    // EMERGENCY: Sell some boost materials to make room for production
                    // Prioritize selling Robots (largest size: 0.5) first
                    const robotsStored = materials['Robots']?.stored || 0;
                    if (robotsStored > 100) {
                        // Sell half of robots to free up space
                        const toSell = Math.floor(robotsStored * 0.5);
                        await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', divName, city, 'Robots', toSell.toString(), 'MP');
                        log(ns, `EMERGENCY: Selling ${toSell} Robots in ${divName}/${city} to free warehouse space`);
                    }
                    
                    // Also sell some AI Cores (size: 0.1)
                    const aiCoresStored = materials['AI Cores']?.stored || 0;
                    if (aiCoresStored > 500) {
                        const toSell = Math.floor(aiCoresStored * 0.3);
                        await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', divName, city, 'AI Cores', toSell.toString(), 'MP');
                        log(ns, `EMERGENCY: Selling ${toSell} AI Cores in ${divName}/${city} to free warehouse space`);
                    }
                    
                    continue;
                }
                
                // Calculate space budget
                const budget = calculateWarehouseSpaceBudget(divData.type, warehouse.size);
                if (!budget) continue;
                
                // Calculate current boost material space
                let currentBoostSpace = 0;
                for (const mat of ['Real Estate', 'Hardware', 'Robots', 'AI Cores']) {
                    const stored = materials[mat]?.stored || 0;
                    currentBoostSpace += stored * MATERIAL_SIZES[mat];
                }
                
                // When NOT critical, stop selling boost materials (cleanup from emergency)
                for (const mat of ['Real Estate', 'Hardware', 'Robots', 'AI Cores']) {
                    await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', divName, city, mat, '0', '0');
                }
                
                // Only buy boost materials if we have room and are healthy
                if (health.isHealthy && currentBoostSpace < budget.boostSpace * 0.9) {
                    const remainingBoostBudget = budget.boostSpace - currentBoostSpace;
                    if (remainingBoostBudget > 100) {
                        const optimal = calculateOptimalBoostMaterials(divData.type, remainingBoostBudget * 0.5);
                        if (optimal) {
                            for (const [mat, targetQty] of Object.entries(optimal)) {
                                const current = materials[mat]?.stored || 0;
                                const toBuy = targetQty - current;
                                if (toBuy > 0) {
                                    // Buy over 10 seconds
                                    await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, mat, toBuy / 10);
                                }
                            }
                        }
                    }
                }
                
                // Smart supply for input materials
                if (state.options['smart-supply'] && industry.inputMaterials) {
                    const supplies = calculateSmartSupplyQuantities(divData, warehouse, materials, state.warehouseTarget);
                    
                    for (const [mat, amount] of Object.entries(supplies)) {
                        if (amount > 0 && health.isSafe) {
                            await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, mat, amount);
                        } else {
                            await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, mat, 0);
                        }
                    }
                }
            } catch { }
        }
    }
    
    // After buying, wait a bit then stop boost purchases (one-time buy pattern)
    await ns.sleep(5000);
    
    for (const divName of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', divName);
        for (const city of divData.cities) {
            try {
                if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', divName, city))) continue;
                // Stop boost material purchases
                for (const mat of ['Real Estate', 'Hardware', 'Robots', 'AI Cores']) {
                    await execCorpFunc(ns, 'buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', divName, city, mat, 0);
                }
            } catch { }
        }
    }
}

// ============================================================================
// PRICING (Market-TA)
// ============================================================================

async function updatePricing(ns) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');

    for (const divName of corpData.divisions) {
        const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', divName);
        const industry = INDUSTRIES[divData.type];
        if (!industry) continue;

        for (const city of divData.cities) {
            try {
                if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', divName, city))) continue;

                const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', divName, city);

                // Price output materials
                for (const material of industry.outputMaterials || []) {
                    const mat = await execCorpFunc(ns, 'getMaterial(ns.args[0], ns.args[1], ns.args[2])', divName, city, material);
                    if (mat.stored > 0) {
                        const price = calculateOptimalPrice(mat, divData, office, false);
                        await execCorpFunc(ns, 'sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', divName, city, material, 'MAX', price.toString());
                    }
                }

                // Price products
                if (industry.makesProducts) {
                    for (const productName of divData.products) {
                        const product = await execCorpFunc(ns, 'getProduct(ns.args[0], ns.args[1], ns.args[2])', divName, city, productName);
                        if (product.developmentProgress >= 100 && product.stored > 0) {
                            const price = calculateOptimalPrice(product, divData, office, true);
                            await execCorpFunc(ns, 'sellProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', divName, city, productName, 'MAX', price.toString(), false);
                        }
                    }
                }
            } catch { }
        }
    }
}

// ============================================================================
// ROUND 1: AGRICULTURE SETUP
// ============================================================================

async function runRound1(ns, state) {
    let corpData = await execCorpFunc(ns, 'getCorporation()');
    const verbose = state.options.verbose;

    // Create Agriculture division if needed
    if (!corpData.divisions.includes('Agriculture')) {
        log(ns, 'Round 1: Creating Agriculture division');
        await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Agriculture', 'Agriculture');
        await ns.sleep(500);
        return;
    }

    const agDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Agriculture');
    
    // Expand to all cities and set up warehouses
    let allCitiesReady = true;
    for (const city of CITIES) {
        corpData = await execCorpFunc(ns, 'getCorporation()');

        // Expand to city
        if (!agDiv.cities.includes(city)) {
            if (city !== 'Sector-12' && corpData.funds > 4e9) {
                log(ns, `Round 1: Expanding to ${city}`);
                await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Agriculture', city);
                await ns.sleep(200);
            }
            allCitiesReady = false;
            continue;
        }

        // Purchase warehouse
        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (!hasWarehouse) {
            if (corpData.funds > 5e9) {
                log(ns, `Round 1: Purchasing warehouse in ${city}`);
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
                await ns.sleep(200);
            }
            allCitiesReady = false;
            continue;
        }

        // Hire employees and assign to production roles
        const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (office.numEmployees < 4) {
            if (corpData.funds > 1e9) {
                if (office.size < 4) {
                    await execCorpFunc(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', 'Agriculture', city, 4 - office.size);
                }
                for (let i = office.numEmployees; i < 4; i++) {
                    await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Agriculture', city);
                }
                // Assign to PRODUCTION roles immediately (not R&D!)
                await assignEmployeesToProduction(ns, 'Agriculture', city, false);
                log(ns, `Round 1: Hired employees in ${city} and assigned to production`);
            }
            allCitiesReady = false;
            continue;
        }
        
        // Check if employees are in production roles
        const opsCount = office.employeeJobs['Operations'] || 0;
        if (opsCount === 0 && office.numEmployees >= 4) {
            // Switch from R&D to production
            await assignEmployeesToProduction(ns, 'Agriculture', city, false);
            log(ns, `Round 1: Reassigned ${city} employees to production`);
            allCitiesReady = false;
        }
    }

    if (!allCitiesReady) {
        if (verbose) log(ns, 'Round 1: Setting up cities...');
    }

    // Upgrades
    corpData = await execCorpFunc(ns, 'getCorporation()');
    
    const smartStorageLevel = await execCorpFunc(ns, 'getUpgradeLevel(ns.args[0])', 'Smart Storage');
    if (smartStorageLevel < 10 && corpData.funds > 2e9) {
        await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', 'Smart Storage');
    }

    const advertLevel = await execCorpFunc(ns, 'getHireAdVertCount(ns.args[0])', 'Agriculture');
    if (advertLevel < 2 && corpData.funds > 1e9) {
        await execCorpFunc(ns, 'hireAdVert(ns.args[0])', 'Agriculture');
    }

    // Upgrade warehouses
    for (const city of agDiv.cities) {
        if (!(await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city))) continue;
        const warehouse = await execCorpFunc(ns, 'getWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        if (warehouse.level < 3 && corpData.funds > 1e9) {
            await execCorpFunc(ns, 'upgradeWarehouse(ns.args[0], ns.args[1])', 'Agriculture', city);
        }
    }
}

// ============================================================================
// ROUND 2: CHEMICAL DIVISION
// ============================================================================

async function runRound2(ns, state) {
    let corpData = await execCorpFunc(ns, 'getCorporation()');
    const verbose = state.options.verbose;

    // Verify Agriculture is set up
    if (!corpData.divisions.includes('Agriculture')) {
        await runRound1(ns, state);
        return;
    }

    // Verify Agriculture has production employees
    const agDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Agriculture');
    const agOffice = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Agriculture', 'Sector-12');
    if ((agOffice.employeeJobs['Operations'] || 0) === 0) {
        await runRound1(ns, state);
        return;
    }

    // Purchase Export unlock
    if (!(await execCorpFunc(ns, 'hasUnlock(ns.args[0])', 'Export'))) {
        if (corpData.funds > 20e9) {
            await execCorpFunc(ns, 'purchaseUnlock(ns.args[0])', 'Export');
            log(ns, 'Round 2: Purchased Export unlock');
        }
        return;
    }

    // Create Chemical division
    if (!corpData.divisions.includes('Chemical')) {
        if (corpData.funds > 70e9) {
            log(ns, 'Round 2: Creating Chemical division');
            await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Chemical', 'Chemical');
            await ns.sleep(500);
        }
        return;
    }

    const chemDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Chemical');
    
    // Expand Chemical to all cities
    for (const city of CITIES) {
        corpData = await execCorpFunc(ns, 'getCorporation()');

        if (!chemDiv.cities.includes(city)) {
            if (city !== 'Sector-12' && corpData.funds > 4e9) {
                log(ns, `Round 2: Expanding Chemical to ${city}`);
                await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Chemical', city);
                await ns.sleep(200);
            }
            continue;
        }

        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Chemical', city);
        if (!hasWarehouse) {
            if (corpData.funds > 5e9) {
                log(ns, `Round 2: Purchasing warehouse for Chemical in ${city}`);
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Chemical', city);
                await ns.sleep(200);
            }
            continue;
        }

        const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Chemical', city);
        if (office.numEmployees < 3) {
            if (corpData.funds > 1e6) {
                for (let i = office.numEmployees; i < 3; i++) {
                    await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Chemical', city);
                }
                await assignEmployeesToProduction(ns, 'Chemical', city, false);
                log(ns, `Round 2: Hired employees for Chemical in ${city}`);
            }
        }
    }

    // Set up export routes: Agriculture -> Chemical (Plants)
    await setupExportRoutes(ns, 'Agriculture', 'Chemical', 'Plants');
    
    // Set up export routes: Chemical -> Agriculture (Chemicals)
    await setupExportRoutes(ns, 'Chemical', 'Agriculture', 'Chemicals');

    // Upgrades
    const smartStorageLevel = await execCorpFunc(ns, 'getUpgradeLevel(ns.args[0])', 'Smart Storage');
    if (smartStorageLevel < 15 && corpData.funds > 2e9) {
        await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', 'Smart Storage');
    }

    const smartFactoriesLevel = await execCorpFunc(ns, 'getUpgradeLevel(ns.args[0])', 'Smart Factories');
    if (smartFactoriesLevel < 10 && corpData.funds > 2e9) {
        await execCorpFunc(ns, 'levelUpgrade(ns.args[0])', 'Smart Factories');
    }
}

// ============================================================================
// ROUND 3+: TOBACCO & PRODUCTS
// ============================================================================

async function runRound3Plus(ns, state) {
    let corpData = await execCorpFunc(ns, 'getCorporation()');
    const verbose = state.options.verbose;

    // Verify prerequisites - must have both divisions with employees
    if (!corpData.divisions.includes('Agriculture') || !corpData.divisions.includes('Chemical')) {
        await runRound2(ns, state);
        return;
    }

    // Verify Chemical has employees (critical for production chain)
    const chemOffice = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Chemical', 'Sector-12');
    if (chemOffice.numEmployees === 0) {
        log(ns, 'Round 3+: Chemical has no employees, running Round 2 setup');
        await runRound2(ns, state);
        return;
    }

    // Create Tobacco division
    if (!corpData.divisions.includes('Tobacco')) {
        if (corpData.funds > 20e9) {
            log(ns, 'Round 3+: Creating Tobacco division');
            await execCorpFunc(ns, 'expandIndustry(ns.args[0], ns.args[1])', 'Tobacco', 'Tobacco');
            await ns.sleep(500);
        }
        return;
    }

    const tobaccoDiv = await execCorpFunc(ns, 'getDivision(ns.args[0])', 'Tobacco');
    
    // Expand Tobacco to all cities
    for (const city of CITIES) {
        corpData = await execCorpFunc(ns, 'getCorporation()');

        if (!tobaccoDiv.cities.includes(city)) {
            if (city !== 'Sector-12' && corpData.funds > 4e9) {
                log(ns, `Round 3+: Expanding Tobacco to ${city}`);
                await execCorpFunc(ns, 'expandCity(ns.args[0], ns.args[1])', 'Tobacco', city);
                await ns.sleep(200);
            }
            continue;
        }

        const hasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', 'Tobacco', city);
        if (!hasWarehouse) {
            if (corpData.funds > 5e9) {
                log(ns, `Round 3+: Purchasing warehouse for Tobacco in ${city}`);
                await execCorpFunc(ns, 'purchaseWarehouse(ns.args[0], ns.args[1])', 'Tobacco', city);
                await ns.sleep(200);
            }
            continue;
        }

        const office = await execCorpFunc(ns, 'getOffice(ns.args[0], ns.args[1])', 'Tobacco', city);
        const targetSize = city === 'Sector-12' ? 30 : 9;
        
        if (office.size < targetSize && corpData.funds > 2e9) {
            await execCorpFunc(ns, 'upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', 'Tobacco', city, targetSize - office.size);
        }
        
        if (office.numEmployees < targetSize) {
            for (let i = office.numEmployees; i < Math.min(targetSize, office.size); i++) {
                await execCorpFunc(ns, 'hireEmployee(ns.args[0], ns.args[1])', 'Tobacco', city);
            }
            // Products need Engineers prioritized
            await assignEmployeesToProduction(ns, 'Tobacco', city, true);
        }
    }

    // Set up export routes: Agriculture -> Tobacco (Plants)
    await setupExportRoutes(ns, 'Agriculture', 'Tobacco', 'Plants');

    // Product development
    if (tobaccoDiv.products.length === 0 || await canDevelopNewProduct(ns, 'Tobacco')) {
        await developNewProduct(ns, 'Tobacco', state);
    }

    // Buy Wilson Analytics and AdVert
    await buyWilsonAndAdvert(ns, 'Tobacco');

    // Buy research upgrades
    await buyResearch(ns, 'Tobacco');

    // General upgrades
    await upgradeProductionCapability(ns);
}

// ============================================================================
// EXPORT MANAGEMENT
// ============================================================================

async function setupExportRoutes(ns, fromDiv, toDiv, material) {
    const fromDivData = await execCorpFunc(ns, 'getDivision(ns.args[0])', fromDiv);
    const toDivData = await execCorpFunc(ns, 'getDivision(ns.args[0])', toDiv);
    
    for (const city of CITIES) {
        // Check both divisions have warehouses in this city
        if (!fromDivData.cities.includes(city) || !toDivData.cities.includes(city)) continue;
        
        const fromHasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', fromDiv, city);
        const toHasWarehouse = await execCorpFunc(ns, 'hasWarehouse(ns.args[0], ns.args[1])', toDiv, city);
        
        if (!fromHasWarehouse || !toHasWarehouse) continue;

        try {
            // Cancel existing export
            await execCorpFunc(ns, 'cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', fromDiv, city, toDiv, city, material);
        } catch { }
        
        try {
            // Set up new export: export production + 10% of inventory
            await execCorpFunc(ns, 'exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', fromDiv, city, toDiv, city, material, '(IPROD+IINV/10)*(-1)');
        } catch { }
    }
}

// ============================================================================
// PRODUCT MANAGEMENT
// ============================================================================

async function canDevelopNewProduct(ns, division) {
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);

    for (const productName of divData.products) {
        const product = await execCorpFunc(ns, 'getProduct(ns.args[0], ns.args[1], ns.args[2])', division, 'Sector-12', productName);
        if (product.developmentProgress < 100) {
            return false;
        }
    }

    return true;
}

async function developNewProduct(ns, division, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    const divData = await execCorpFunc(ns, 'getDivision(ns.args[0])', division);

    // Discontinue worst product if at max
    if (divData.products.length >= 3) {
        let worstProduct = divData.products[0];
        let worstRating = Infinity;

        for (const productName of divData.products) {
            const product = await execCorpFunc(ns, 'getProduct(ns.args[0], ns.args[1], ns.args[2])', division, 'Sector-12', productName);
            if (product.developmentProgress >= 100 && product.effectiveRating < worstRating) {
                worstRating = product.effectiveRating;
                worstProduct = productName;
            }
        }

        await execCorpFunc(ns, 'discontinueProduct(ns.args[0], ns.args[1])', division, worstProduct);
        log(ns, `Discontinued product: ${worstProduct}`);
    }

    const productName = getProductName(division, state.productVersion++);
    const investment = Math.max(1e9, corpData.funds * 0.01);

    await execCorpFunc(ns, 'makeProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', division, 'Sector-12', productName, investment, investment);
    log(ns, `Started developing product: ${productName}`);
}

// ============================================================================
// UPGRADES
// ============================================================================

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

// ============================================================================
// INVESTMENT
// ============================================================================

async function checkInvestment(ns, state) {
    const corpData = await execCorpFunc(ns, 'getCorporation()');
    const offer = await execCorpFunc(ns, 'getInvestmentOffer()');

    if (offer && offer.funds > 0) {
        const isEmergency = corpData.funds < 0;
        log(ns, `Investment offer: ${formatMoney(offer.funds)} for ${(offer.shares / 1e6).toFixed(0)}M shares (Round ${state.round})${isEmergency ? ' [EMERGENCY - negative funds]' : ''}`);
    }

    // Pass current funds to enable emergency acceptance when in death spiral
    if (shouldAcceptInvestment(offer, state.round, 0, corpData.funds)) {
        await execCorpFunc(ns, 'acceptInvestmentOffer()');
        log(ns, `Accepted investment: ${formatMoney(offer.funds)}`, true, 'success');
        state.round++;
    }
}
