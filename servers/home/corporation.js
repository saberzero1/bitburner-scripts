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

import {
    log,
    getConfiguration,
    disableLogs,
    formatMoney,
    getErrorInfo,
    getNsDataThroughFile,
} from "./helpers.js";
import {
    INDUSTRIES,
    CITIES,
    MATERIAL_SIZES,
    calculateWarehouseSpaceBudget,
    calculateOptimalBoostMaterials,
    calculateProductionMultiplier,
    calculateOptimalEmployeeDistribution,
    calculateSmartSupplyQuantities,
    checkWarehouseHealth,
    calculateOptimalPrice,
    calculateOptimalPartyCost,
    getProductName,
    shouldAcceptInvestment,
    diagnoseZeroProduction,
    // Quality-focused helpers (post-2022 rework)
    findBestQualityCity,
    checkExportDilution,
    calculateQualityThreshold,
    checkProductReadiness,
    calculateQualityFocusedDistribution,
    determineCityRole,
} from "./corp-helpers.js";

void getErrorInfo;
void calculateProductionMultiplier;
void calculateOptimalEmployeeDistribution;
void checkExportDilution;
void calculateQualityThreshold;
void shouldAcceptInvestment;

const argsSchema = [
    ["self-fund", false],
    ["corp-name", "NoodleCorp"],
    ["round", 0],
    ["target-round", 4],
    ["auto-invest", true],
    ["smart-supply", true],
    ["market-ta", true],
    ["verbose", false],
    ["debug", false], // Extra diagnostic output
    ["warehouse-target", 0.7], // Target warehouse utilization (0.7 = 70%)
];

export function autocomplete(data, args) {
    void args;
    data.flags(argsSchema);
    return [];
}

// RAM-dodging helpers to execute corporation functions
// readCorpFunc: For functions that return values (hasCorporation, getCorporation, getDivision, etc.)
// execCorpFunc: For void-returning functions - wraps with ?? 'OK' to ensure serializable value
const readCorpFunc = async (ns, strFunction, ...args) =>
    await getNsDataThroughFile(ns, `ns.corporation.${strFunction}`, null, args);
const execCorpFunc = async (ns, strFunction, ...args) =>
    await getNsDataThroughFile(
        ns,
        `ns.corporation.${strFunction} ?? 'OK'`,
        null,
        args,
    );

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;

    disableLogs(ns, [
        "sleep",
        "getServerMoneyAvailable",
        "run",
        "read",
        "write",
        "isRunning",
    ]);

    const state = new CorpState(ns, options);

    // Main loop - handles both waiting for corporation creation and running cycles
    let lastFundCheck = 0;
    const FUND_CHECK_INTERVAL = 60000; // Check funds every 60 seconds when waiting

    while (true) {
        try {
            // Check if we have a corporation
            const hasCorp = await readCorpFunc(ns, "hasCorporation()");

            if (!hasCorp) {
                // Try to create corporation
                const created = await initCorporation(ns, state);
                if (!created) {
                    // Not enough funds - wait and retry periodically
                    const now = Date.now();
                    if (now - lastFundCheck > FUND_CHECK_INTERVAL) {
                        lastFundCheck = now;
                        const currentMoney = ns.getServerMoneyAvailable("home");
                        log(
                            ns,
                            `Waiting for funds to create corporation... Have ${formatMoney(currentMoney)} / need ${formatMoney(150e9)}`,
                        );
                    }
                    await ns.sleep(5000); // Check every 5 seconds
                    continue;
                }
                log(
                    ns,
                    "Corporation created! Starting manager...",
                    true,
                    "success",
                );
            }

            // Run normal corporation cycle
            await runCorpCycle(ns, state);
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const errStack = err instanceof Error ? err.stack : "";
            log(ns, `Corp cycle error: ${errMsg}`, false, "warning");
            if (errStack) ns.print(`Stack: ${errStack}`);
        }
        // Sync with corporation game cycle using direct nextUpdate() call
        // nextUpdate() costs 0 GB RAM, so no need for RAM-dodging file proxy
        // Using the file proxy for nextUpdate() causes UI freezes because:
        //   1. The temp script blocks on nextUpdate() for ~2-10s
        //   2. Meanwhile waitForProcessToComplete_Custom polls in a tight loop
        //   3. This polling loop starves the game engine of render cycles
        try {
            const hasCorp = await readCorpFunc(ns, "hasCorporation()");
            if (hasCorp) {
                await ns.corporation.nextUpdate();
            } else {
                await ns.sleep(5000);
            }
        } catch {
            await ns.sleep(1000);
        }
    }
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

class CorpState {
    constructor(ns, options) {
        void ns;
        this.options = options;
        this.round = options.round || 0;
        this.productVersion = 1;
        this.lastStatusLog = 0;
        this.lastDiagnostic = 0;
        this.lastInvestmentCheck = "";
        this.initialized = false;
        this.warehouseTarget = options["warehouse-target"] || 0.7;
        this.boostBuysPending = false; // Track if boost material purchases are active (need stopping next cycle)
        this.roundTrigger = false;
        this.oldRound = 0;
        this.bnMults = null;
    }

    async init(ns) {
        if (this.initialized) return;
        if (this.options.round && this.options.round > 0) {
            this.round = this.options.round;
        } else {
            this.round = await this.detectRound(ns);
        }
        this.bnMults = await getNsDataThroughFile(
            ns,
            "ns.getBitNodeMultipliers()",
        );
        this.initialized = true;
    }

    async detectRound(ns) {
        if (!(await readCorpFunc(ns, "hasCorporation()"))) return 0;
        const offer = await readCorpFunc(ns, "getInvestmentOffer()");
        return offer?.round || 5;
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initCorporation(ns, state) {
    const options = state.options;

    // Check what BitNode we're in
    const resetInfo = await getNsDataThroughFile(ns, "ns.getResetInfo()");
    const currentBitNode = resetInfo.currentNode;
    const isInBN3 = currentBitNode === 3;

    // Outside BN3, you MUST self-fund (seed money not available)
    // In BN3, you can use seed money (free $150B)
    const mustSelfFund = !isInBN3 || options["self-fund"];

    if (mustSelfFund) {
        const cost = 150e9;
        const currentMoney = ns.getServerMoneyAvailable("home");
        if (currentMoney < cost) {
            // Return false without logging - the main loop will log periodically
            return false;
        }
        log(
            ns,
            `Creating self-funded corporation: ${options["corp-name"]} (cost: ${formatMoney(cost)})`,
        );
        await execCorpFunc(
            ns,
            "createCorporation(ns.args[0], ns.args[1])",
            options["corp-name"],
            true,
        );
    } else {
        log(
            ns,
            `Creating corporation with seed money (BN3): ${options["corp-name"]}`,
        );
        await execCorpFunc(
            ns,
            "createCorporation(ns.args[0], ns.args[1])",
            options["corp-name"],
            false,
        );
    }

    state.round = 1;
    return true;
}

// ============================================================================
// MAIN CYCLE
// ============================================================================

async function prepDivisions(ns, state, corpData) {
    const round = state.round;
    const divisions = corpData.divisions;

    // Prep-specific helpers: single attempt, silent (no retry storm)
    const tryExec = async (strFunction, ...args) =>
        await getNsDataThroughFile(
            ns,
            `ns.corporation.${strFunction} ?? 'OK'`,
            null,
            args,
            false,
            1,
            50,
            true,
        );
    const tryRead = async (strFunction, ...args) =>
        await getNsDataThroughFile(
            ns,
            `ns.corporation.${strFunction}`,
            null,
            args,
            false,
            1,
            50,
            true,
        );

    // Helper: attempt to expand a division to all cities + buy warehouses
    // Only runs if the division actually exists in divisions list
    async function expandDivision(divName) {
        if (!divisions.includes(divName)) return;
        for (const city of CITIES) {
            try {
                await tryExec(
                    "expandCity(ns.args[0], ns.args[1])",
                    divName,
                    city,
                );
            } catch {}
            try {
                await tryExec(
                    "purchaseWarehouse(ns.args[0], ns.args[1])",
                    divName,
                    city,
                );
            } catch {}
        }
    }

    // Helper: try to purchase an unlock if not already unlocked
    async function tryUnlock(unlockName) {
        try {
            const hasIt = await tryRead("hasUnlock(ns.args[0])", unlockName);
            if (hasIt) return true;
            await tryExec("purchaseUnlock(ns.args[0])", unlockName);
            return await tryRead("hasUnlock(ns.args[0])", unlockName);
        } catch {
            return false;
        }
    }

    // Helper: try to create a division if it doesn't already exist
    async function tryCreateDivision(industryName, divName) {
        if (divisions.includes(divName)) return true;
        try {
            await tryExec(
                "expandIndustry(ns.args[0], ns.args[1])",
                industryName,
                divName,
            );
            // Verify it was actually created
            await tryRead("getDivision(ns.args[0])", divName);
            divisions.push(divName); // Update local cache
            return true;
        } catch {
            return false;
        }
    }

    // Round 1+: Agriculture
    if (round >= 1) {
        await tryCreateDivision("Agriculture", "Agriculture");
        await expandDivision("Agriculture");
    }

    // Round 2+: Export unlock, then Chemical (only if Export succeeded)
    if (round >= 2) {
        const hasExport = await tryUnlock("Export");
        if (hasExport) {
            await tryCreateDivision("Chemical", "Chemical");
            await expandDivision("Chemical");
        }
    }

    // Round 3+: Market unlocks, then Tobacco
    if (round >= 3) {
        await tryUnlock("Market Research - Demand");
        await tryUnlock("Market Data - Competition");
        await tryCreateDivision("Tobacco", "Tobacco");
        await expandDivision("Tobacco");
    }
}

async function runCorpCycle(ns, state) {
    await state.init(ns);

    const corpData = await readCorpFunc(ns, "getCorporation()");
    const corpState = corpData.nextState;

    await prepDivisions(ns, state, corpData);

    // Periodic status logging (lightweight, runs every state)
    const now = Date.now();
    if (now - state.lastStatusLog > 30000) {
        state.lastStatusLog = now;
        await logCorpStatus(ns, corpData, state);
    }

    // State machine: only run operations relevant to the current corp phase.
    // The corporation cycles through: START -> PURCHASE -> PRODUCTION -> EXPORT -> SALE
    // Each nextUpdate() advances to the next phase. By dispatching per-state,
    // we reduce API calls per tick from 100+ to ~20-30, preventing UI freezes.
    switch (corpState) {
        case "SALE":
            // SALE phase: update sell orders and pricing
            await ensureSelling(ns);
            if (state.options["market-ta"]) {
                await updatePricing(ns);
            }
            break;

        case "PURCHASE":
            // PURCHASE phase: manage warehouse materials (boost buys, smart supply)
            await manageWarehouses(ns, state);
            break;

        case "START":
            // START phase: employee maintenance, investment checks, round detection
            await maintainEmployees(ns);

            // Re-detect round each cycle to catch investment changes
            // Only when round wasn't forced via --round flag
            if (!state.options.round || state.options.round <= 0) {
                const detectedRound = await state.detectRound(ns);
                if (detectedRound > state.round) {
                    log(
                        ns,
                        `Round advanced: ${state.round} -> ${detectedRound} (detected from offer)`,
                    );
                    state.round = detectedRound;
                }
            }

            // Check for investment opportunities
            if (
                state.options["auto-invest"] &&
                state.round < state.options["target-round"]
            ) {
                await checkInvestment(ns, state);
            }
            break;

        case "EXPORT":
            // EXPORT phase: expansion and round-specific setup
            await expandAllDivisions(ns, state);
            await buyResearchForAllDivisions(ns);

            // Run round-specific logic
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
            break;

        default:
            // PRODUCTION or unknown state — lightweight yield, no heavy operations
            break;
    }
}

// ============================================================================
// STATUS LOGGING & DIAGNOSTICS
// ============================================================================

async function logCorpStatus(ns, corpData, state) {
    log(
        ns,
        `Status: Round ${state.round}, Funds: ${formatMoney(corpData.funds)}, Revenue: ${formatMoney(corpData.revenue)}/s`,
    );

    for (const divName of corpData.divisions) {
        const div = await readCorpFunc(ns, "getDivision(ns.args[0])", divName);
        const industry = INDUSTRIES[div.industry];

        // Count cities with warehouses
        let warehouseCities = [];
        for (const city of div.cities) {
            if (
                await readCorpFunc(
                    ns,
                    "hasWarehouse(ns.args[0], ns.args[1])",
                    divName,
                    city,
                )
            ) {
                warehouseCities.push(city);
            }
        }

        log(
            ns,
            `  ${divName}: ${div.cities.length}/6 cities, ${warehouseCities.length} warehouses, Revenue: ${formatMoney(div.lastCycleRevenue)}/cycle`,
        );

        // Show main office stats
        if (div.cities.includes("Sector-12")) {
            const office = await readCorpFunc(
                ns,
                "getOffice(ns.args[0], ns.args[1])",
                divName,
                "Sector-12",
            );
            const jobs = office.employeeJobs;
            log(
                ns,
                `    Employees: Ops=${jobs.Operations || 0} Eng=${jobs.Engineer || 0} Bus=${jobs.Business || 0} Mgmt=${jobs.Management || 0} R&D=${jobs["Research & Development"] || 0}`,
            );
            log(
                ns,
                `    Energy=${office.avgEnergy.toFixed(0)}, Morale=${office.avgMorale.toFixed(0)}`,
            );
        }

        // Show warehouse and production stats
        if (warehouseCities.length > 0 && industry) {
            const city = warehouseCities[0];
            const warehouse = await readCorpFunc(
                ns,
                "getWarehouse(ns.args[0], ns.args[1])",
                divName,
                city,
            );
            const health = checkWarehouseHealth(warehouse);

            log(
                ns,
                `    Warehouse: ${warehouse.sizeUsed.toFixed(0)}/${warehouse.size} (${(health.utilization * 100).toFixed(1)}%)${health.isCritical ? " CRITICAL!" : ""}`,
            );

            // Show output materials for non-product industries
            if (industry.outputMaterials?.length > 0) {
                for (const mat of industry.outputMaterials) {
                    const matData = await readCorpFunc(
                        ns,
                        "getMaterial(ns.args[0], ns.args[1], ns.args[2])",
                        divName,
                        city,
                        mat,
                    );
                    // Show quality for export chain optimization
                    const qualityStr = matData.quality
                        ? ` Q=${matData.quality.toFixed(1)}`
                        : "";
                    log(
                        ns,
                        `    ${mat}: ${matData.stored.toFixed(0)}${qualityStr} (prod=${matData.productionAmount.toFixed(2)}/s, sell=${matData.actualSellAmount.toFixed(2)}/s)`,
                    );
                }
            }

            // Run diagnostics if production is zero
            if (state.options.debug && industry.outputMaterials?.length > 0) {
                const firstOutput = industry.outputMaterials[0];
                const outputMat = await readCorpFunc(
                    ns,
                    "getMaterial(ns.args[0], ns.args[1], ns.args[2])",
                    divName,
                    city,
                    firstOutput,
                );

                if (outputMat.productionAmount === 0) {
                    // Gather all materials for diagnosis
                    const materials = {};
                    for (const matName of [
                        ...Object.keys(industry.inputMaterials || {}),
                        ...industry.outputMaterials,
                        "Real Estate",
                        "Hardware",
                        "Robots",
                        "AI Cores",
                    ]) {
                        try {
                            materials[matName] = await readCorpFunc(
                                ns,
                                "getMaterial(ns.args[0], ns.args[1], ns.args[2])",
                                divName,
                                city,
                                matName,
                            );
                        } catch (e) {}
                    }

                    const office = await readCorpFunc(
                        ns,
                        "getOffice(ns.args[0], ns.args[1])",
                        divName,
                        city,
                    );
                    const diagnosis = diagnoseZeroProduction(
                        div,
                        warehouse,
                        office,
                        materials,
                    );

                    if (!diagnosis.isHealthy) {
                        log(
                            ns,
                            `    PRODUCTION ISSUES FOUND:`,
                            false,
                            "warning",
                        );
                        for (const issue of diagnosis.issues) {
                            log(
                                ns,
                                `      [${issue.severity.toUpperCase()}] ${issue.issue}: ${issue.detail}`,
                                false,
                                issue.severity === "critical"
                                    ? "error"
                                    : "warning",
                            );
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
    const corpData = await readCorpFunc(ns, "getCorporation()");

    for (const divName of corpData.divisions) {
        await ns.sleep(0); // Yield to game engine between divisions
        const divData = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            divName,
        );

        for (const city of divData.cities) {
            try {
                const office = await readCorpFunc(
                    ns,
                    "getOffice(ns.args[0], ns.args[1])",
                    divName,
                    city,
                );
                if (!office || office.numEmployees === 0) continue;

                // Buy tea if energy is low
                if (office.avgEnergy < 98) {
                    await execCorpFunc(
                        ns,
                        "buyTea(ns.args[0], ns.args[1])",
                        divName,
                        city,
                    );
                }

                // Throw party if morale is low
                if (office.avgMorale < 98) {
                    const partyCost = calculateOptimalPartyCost(
                        office.avgMorale,
                        100,
                    );
                    await execCorpFunc(
                        ns,
                        "throwParty(ns.args[0], ns.args[1], ns.args[2])",
                        divName,
                        city,
                        partyCost,
                    );
                }
            } catch (e) {}
        }
    }
}

/**
 * Assign employees to optimal distribution based on division focus
 * Material divisions: Quality-focused (60-70% Engineers) for export chain
 * Product divisions: Balanced for product development
 *
 * @param {NS} ns
 * @param {string} divName - Division name
 * @param {string} city - City name
 * @param {boolean} forProducts - If true, optimize for product development
 * @param {string} qualityFocus - 'quality' for export hubs, 'production' for local sales
 */
async function assignEmployeesToProduction(
    ns,
    divName,
    city,
    forProducts = false,
    qualityFocus = "quality",
    round = 0,
    divisionRP = 0,
) {
    const office = await readCorpFunc(
        ns,
        "getOffice(ns.args[0], ns.args[1])",
        divName,
        city,
    );

    // Use quality-focused distribution for material divisions that export
    // Use production-focused for local sales cities
    // Use product-focused for Tobacco/product divisions
    let distribution;
    if (forProducts) {
        distribution = calculateQualityFocusedDistribution(
            office.numEmployees,
            "product",
        );
    } else {
        if (round <= 1 && divisionRP < 60) {
            distribution = {
                Operations: 0,
                Engineer: 0,
                Business: 0,
                Management: 0,
                "Research & Development": office.numEmployees,
            };
        } else if (round <= 2 && divisionRP < 700) {
            distribution = {
                Operations: 0,
                Engineer: 0,
                Business: 0,
                Management: 0,
                "Research & Development": office.numEmployees,
            };
        } else {
            // Material divisions: use quality focus for export cities
            distribution = calculateQualityFocusedDistribution(
                office.numEmployees,
                qualityFocus,
            );
        }
    }

    // Clear all assignments first
    for (const job of [
        "Operations",
        "Engineer",
        "Business",
        "Management",
        "Research & Development",
    ]) {
        await execCorpFunc(
            ns,
            "setJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
            divName,
            city,
            job,
            0,
        );
    }

    // Assign to optimal distribution
    for (const [job, count] of Object.entries(distribution)) {
        if (count > 0) {
            await execCorpFunc(
                ns,
                "setJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                divName,
                city,
                job,
                count,
            );
        }
    }

    return distribution;
}

// ============================================================================
// SELLING MANAGEMENT
// ============================================================================

async function ensureSelling(ns) {
    const corpData = await readCorpFunc(ns, "getCorporation()");

    for (const divName of corpData.divisions) {
        await ns.sleep(0); // Yield to game engine between divisions
        const divData = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            divName,
        );
        const industry = INDUSTRIES[divData.industry];
        if (!industry) continue;

        for (const city of divData.cities) {
            try {
                if (
                    !(await readCorpFunc(
                        ns,
                        "hasWarehouse(ns.args[0], ns.args[1])",
                        divName,
                        city,
                    ))
                )
                    continue;

                // Set up selling for all OUTPUT materials
                for (const material of industry.outputMaterials || []) {
                    const mat = await readCorpFunc(
                        ns,
                        "getMaterial(ns.args[0], ns.args[1], ns.args[2])",
                        divName,
                        city,
                        material,
                    );
                    // Set up selling if not already configured
                    if (
                        !mat.desiredSellPrice ||
                        mat.desiredSellPrice === "0" ||
                        mat.desiredSellPrice === 0
                    ) {
                        await execCorpFunc(
                            ns,
                            "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                            divName,
                            city,
                            material,
                            "MAX",
                            "MP",
                        );
                    }
                }

                // Ensure INPUT materials are NOT being sold (they should only be consumed)
                for (const material of Object.keys(
                    industry.inputMaterials || {},
                )) {
                    await execCorpFunc(
                        ns,
                        "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                        divName,
                        city,
                        material,
                        "0",
                        "0",
                    );
                }
            } catch (e) {}
        }
    }
}

// ============================================================================
// WAREHOUSE MANAGEMENT - THE CRITICAL PIECE
// ============================================================================

async function manageWarehouses(ns, state) {
    const corpData = await readCorpFunc(ns, "getCorporation()");

    // If boost buys were issued last cycle, stop them now before doing anything else
    if (state.boostBuysPending) {
        for (const divName of corpData.divisions) {
            const divData = await readCorpFunc(
                ns,
                "getDivision(ns.args[0])",
                divName,
            );
            for (const city of divData.cities) {
                try {
                    if (
                        !(await readCorpFunc(
                            ns,
                            "hasWarehouse(ns.args[0], ns.args[1])",
                            divName,
                            city,
                        ))
                    )
                        continue;
                    for (const mat of [
                        "Real Estate",
                        "Hardware",
                        "Robots",
                        "AI Cores",
                    ]) {
                        await execCorpFunc(
                            ns,
                            "buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                            divName,
                            city,
                            mat,
                            0,
                        );
                    }
                } catch (e) {}
            }
        }
        state.boostBuysPending = false;
    }

    for (const divName of corpData.divisions) {
        await ns.sleep(0); // Yield to game engine between divisions
        const divData = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            divName,
        );
        const industry = INDUSTRIES[divData.industry];
        if (!industry) continue;

        for (const city of divData.cities) {
            try {
                if (
                    !(await readCorpFunc(
                        ns,
                        "hasWarehouse(ns.args[0], ns.args[1])",
                        divName,
                        city,
                    ))
                )
                    continue;

                const warehouse = await readCorpFunc(
                    ns,
                    "getWarehouse(ns.args[0], ns.args[1])",
                    divName,
                    city,
                );
                const health = checkWarehouseHealth(warehouse);

                // Get current materials
                const materials = {};
                for (const matName of [
                    "Real Estate",
                    "Hardware",
                    "Robots",
                    "AI Cores",
                    ...Object.keys(industry.inputMaterials || {}),
                ]) {
                    try {
                        materials[matName] = await readCorpFunc(
                            ns,
                            "getMaterial(ns.args[0], ns.args[1], ns.args[2])",
                            divName,
                            city,
                            matName,
                        );
                    } catch (e) {}
                }

                // If warehouse is critically full (>95%), emergency measures
                if (health.isCritical) {
                    // Stop ALL buying
                    for (const mat of [
                        "Real Estate",
                        "Hardware",
                        "Robots",
                        "AI Cores",
                    ]) {
                        await execCorpFunc(
                            ns,
                            "buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                            divName,
                            city,
                            mat,
                            0,
                        );
                    }
                    for (const mat of Object.keys(
                        industry.inputMaterials || {},
                    )) {
                        await execCorpFunc(
                            ns,
                            "buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                            divName,
                            city,
                            mat,
                            0,
                        );
                    }

                    // EMERGENCY: Sell boost materials to make room for production
                    // Log what we have for debugging
                    const robotsStored = materials["Robots"]?.stored || 0;
                    const aiCoresStored = materials["AI Cores"]?.stored || 0;
                    const hardwareStored = materials["Hardware"]?.stored || 0;
                    const realEstateStored =
                        materials["Real Estate"]?.stored || 0;

                    log(
                        ns,
                        `EMERGENCY ${divName}/${city}: Warehouse FULL. Boost materials: RE=${realEstateStored.toFixed(0)}, HW=${hardwareStored.toFixed(0)}, Robots=${robotsStored.toFixed(0)}, AI=${aiCoresStored.toFixed(0)}`,
                    );

                    // Sell ALL boost materials to clear space quickly
                    // Set sell amount to current stored amount (sells everything)
                    let soldAny = false;

                    // Sell Real Estate (size 0.005, but often have lots)
                    if (realEstateStored > 100) {
                        // Lowered from 1000
                        const toSell = Math.floor(realEstateStored * 0.5);
                        await execCorpFunc(
                            ns,
                            "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                            divName,
                            city,
                            "Real Estate",
                            toSell.toString(),
                            "MP",
                        );
                        log(
                            ns,
                            `  Selling ${toSell} Real Estate (${(toSell * 0.005).toFixed(1)} space)`,
                        );
                        soldAny = true;
                    }

                    // Sell Hardware (size 0.06)
                    if (hardwareStored > 10) {
                        // Lowered from 100
                        const toSell = Math.floor(hardwareStored * 0.5);
                        await execCorpFunc(
                            ns,
                            "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                            divName,
                            city,
                            "Hardware",
                            toSell.toString(),
                            "MP",
                        );
                        log(
                            ns,
                            `  Selling ${toSell} Hardware (${(toSell * 0.06).toFixed(1)} space)`,
                        );
                        soldAny = true;
                    }

                    // Sell Robots (size 0.5 - largest)
                    if (robotsStored > 1) {
                        // Lowered from 10
                        const toSell = Math.floor(robotsStored * 0.5);
                        await execCorpFunc(
                            ns,
                            "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                            divName,
                            city,
                            "Robots",
                            toSell.toString(),
                            "MP",
                        );
                        log(
                            ns,
                            `  Selling ${toSell} Robots (${(toSell * 0.5).toFixed(1)} space)`,
                        );
                        soldAny = true;
                    }

                    // Sell AI Cores (size 0.1)
                    if (aiCoresStored > 5) {
                        // Lowered from 50
                        const toSell = Math.floor(aiCoresStored * 0.5);
                        await execCorpFunc(
                            ns,
                            "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                            divName,
                            city,
                            "AI Cores",
                            toSell.toString(),
                            "MP",
                        );
                        log(
                            ns,
                            `  Selling ${toSell} AI Cores (${(toSell * 0.1).toFixed(1)} space)`,
                        );
                        soldAny = true;
                    }

                    if (!soldAny) {
                        log(
                            ns,
                            `  WARNING: No boost materials to sell! Check input materials.`,
                        );
                        // Warehouse is full of INPUT materials - sell aggressively
                        for (const mat of Object.keys(
                            industry.inputMaterials || {},
                        )) {
                            const stored = materials[mat]?.stored || 0;
                            if (stored > 50) {
                                // Sell 50% of stored input materials to clear space quickly
                                const toSell = Math.floor(stored * 0.5);
                                await execCorpFunc(
                                    ns,
                                    "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                                    divName,
                                    city,
                                    mat,
                                    toSell.toString(),
                                    "MP",
                                );
                                log(ns, `  Selling excess ${mat}: ${toSell}`);
                            }
                        }
                    }
                    continue;
                }
                // Calculate space budget
                const budget = calculateWarehouseSpaceBudget(
                    divData.industry,
                    warehouse.size,
                );
                if (!budget) continue;

                // Calculate current boost material space
                let currentBoostSpace = 0;
                for (const mat of [
                    "Real Estate",
                    "Hardware",
                    "Robots",
                    "AI Cores",
                ]) {
                    const stored = materials[mat]?.stored || 0;
                    currentBoostSpace += stored * MATERIAL_SIZES[mat];
                }

                // When NOT critical, stop selling boost materials (cleanup from emergency)
                for (const mat of [
                    "Real Estate",
                    "Hardware",
                    "Robots",
                    "AI Cores",
                ]) {
                    await execCorpFunc(
                        ns,
                        "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                        divName,
                        city,
                        mat,
                        "0",
                        "0",
                    );
                }

                // Only buy boost materials if:
                // 1. Warehouse is healthy (not critical)
                // 2. We have room for more boost materials
                // 3. We have enough funds (>$100m buffer)
                const canAffordBoost = corpData.funds > 100e6;
                if (
                    health.isHealthy &&
                    currentBoostSpace < budget.boostSpace * 0.9 &&
                    canAffordBoost
                ) {
                    const remainingBoostBudget =
                        budget.boostSpace - currentBoostSpace;
                    if (remainingBoostBudget > 100) {
                        const optimal = calculateOptimalBoostMaterials(
                            divData.industry,
                            remainingBoostBudget * 0.5,
                        );
                        if (optimal) {
                            for (const [mat, targetQty] of Object.entries(
                                optimal,
                            )) {
                                const current = materials[mat]?.stored || 0;
                                const toBuy = targetQty - current;
                                if (toBuy > 0) {
                                    // Buy over 10 seconds
                                    await execCorpFunc(
                                        ns,
                                        "buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                                        divName,
                                        city,
                                        mat,
                                        toBuy / 10,
                                    );
                                }
                            }
                            state.boostBuysPending = true;
                        }
                    }
                }

                // Smart supply for input materials - ONLY buy when warehouse is healthy
                // Stop buying inputs completely when warehouse > 80% to leave room for output
                if (
                    state.options["smart-supply"] &&
                    industry.inputMaterials &&
                    health.isHealthy
                ) {
                    const utilization = warehouse.sizeUsed / warehouse.size;

                    if (utilization < 0.85) {
                        // Buy inputs more aggressively - target 70% utilization
                        const supplies = calculateSmartSupplyQuantities(
                            divData,
                            warehouse,
                            materials,
                            0.7,
                        );
                        for (const [mat, amount] of Object.entries(supplies)) {
                            if (amount > 0) {
                                await execCorpFunc(
                                    ns,
                                    "buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                                    divName,
                                    city,
                                    mat,
                                    amount,
                                );
                            }
                        }
                    } else {
                        // Stop all input buying when warehouse > 85%
                        for (const mat of Object.keys(
                            industry.inputMaterials,
                        )) {
                            await execCorpFunc(
                                ns,
                                "buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                                divName,
                                city,
                                mat,
                                0,
                            );
                        }
                    }
                } else if (industry.inputMaterials) {
                    // Stop buying when unhealthy
                    for (const mat of Object.keys(industry.inputMaterials)) {
                        await execCorpFunc(
                            ns,
                            "buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                            divName,
                            city,
                            mat,
                            0,
                        );
                    }
                }
            } catch (e) {}
        }
    }
}

// ============================================================================
// AGGRESSIVE EXPANSION - Expand all divisions to all cities
// ============================================================================

async function expandAllDivisions(ns, state) {
    let corpData = await readCorpFunc(ns, "getCorporation()");

    for (const divName of corpData.divisions) {
        await ns.sleep(0); // Yield to game engine between divisions
        const divData = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            divName,
        );
        const industry = INDUSTRIES[divData.industry];

        for (const city of CITIES) {
            // Expand to city if not present
            if (!divData.cities.includes(city)) {
                if (city !== "Sector-12") {
                    try {
                        await execCorpFunc(
                            ns,
                            "expandCity(ns.args[0], ns.args[1])",
                            divName,
                            city,
                        );
                        log(ns, `Expanded ${divName} to ${city}`);
                        corpData = await readCorpFunc(ns, "getCorporation()");
                        await ns.sleep(100);
                    } catch (e) {}
                }
                continue;
            }

            // Purchase warehouse if missing
            const hasWarehouse = await readCorpFunc(
                ns,
                "hasWarehouse(ns.args[0], ns.args[1])",
                divName,
                city,
            );
            if (!hasWarehouse) {
                try {
                    await execCorpFunc(
                        ns,
                        "purchaseWarehouse(ns.args[0], ns.args[1])",
                        divName,
                        city,
                    );
                    log(ns, `Purchased warehouse for ${divName} in ${city}`);
                    corpData = await readCorpFunc(ns, "getCorporation()");
                    await ns.sleep(100);
                } catch (e) {}
                continue;
            }

            // Upgrade warehouse if small
            try {
                const warehouse = await readCorpFunc(
                    ns,
                    "getWarehouse(ns.args[0], ns.args[1])",
                    divName,
                    city,
                );
                if (warehouse.level < 5) {
                    await execCorpFunc(
                        ns,
                        "upgradeWarehouse(ns.args[0], ns.args[1])",
                        divName,
                        city,
                    );
                }
            } catch (e) {}

            // Continuously scale employees - more employees = more production
            try {
                const office = await readCorpFunc(
                    ns,
                    "getOffice(ns.args[0], ns.args[1])",
                    divName,
                    city,
                );
                const isMainCity = city === "Sector-12";
                const targetSize = industry?.makesProducts
                    ? isMainCity
                        ? 30
                        : 9
                    : 9;

                // Upgrade office size if needed and we can afford it
                if (office.size < targetSize) {
                    const toAdd = Math.min(3, targetSize - office.size);
                    await execCorpFunc(
                        ns,
                        "upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])",
                        divName,
                        city,
                        toAdd,
                    );
                    log(
                        ns,
                        `Upgraded ${divName} office in ${city} (+${toAdd} slots)`,
                    );
                    corpData = await readCorpFunc(ns, "getCorporation()");
                }

                // Hire employees up to office size - employees are very cheap (~$50K)
                if (office.numEmployees < office.size) {
                    for (let i = office.numEmployees; i < office.size; i++) {
                        await execCorpFunc(
                            ns,
                            "hireEmployee(ns.args[0], ns.args[1])",
                            divName,
                            city,
                        );
                    }
                    // Quality-focused for material divisions, product-focused for products
                    const focus = industry?.makesProducts
                        ? "product"
                        : "quality";
                    await assignEmployeesToProduction(
                        ns,
                        divName,
                        city,
                        industry?.makesProducts || false,
                        focus,
                        state.round,
                        divData.researchPoints || 0,
                    );
                    log(
                        ns,
                        `Hired employees for ${divName} in ${city} (now ${office.size})`,
                    );
                }
            } catch (e) {}
        }

        // Buy AdVerts aggressively for product divisions
        if (industry?.makesProducts) {
            try {
                const advertCost = await execCorpFunc(
                    ns,
                    "getHireAdVertCost(ns.args[0])",
                    divName,
                );
                if (corpData.funds > advertCost * 2) {
                    await execCorpFunc(ns, "hireAdVert(ns.args[0])", divName);
                }
            } catch (e) {}
        }
    }
}

// ============================================================================
// PRICING (Market-TA)
// ============================================================================

async function updatePricing(ns) {
    const corpData = await readCorpFunc(ns, "getCorporation()");

    for (const divName of corpData.divisions) {
        const divData = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            divName,
        );
        const industry = INDUSTRIES[divData.industry];
        if (!industry) continue;

        for (const city of divData.cities) {
            try {
                if (
                    !(await readCorpFunc(
                        ns,
                        "hasWarehouse(ns.args[0], ns.args[1])",
                        divName,
                        city,
                    ))
                )
                    continue;

                const office = await readCorpFunc(
                    ns,
                    "getOffice(ns.args[0], ns.args[1])",
                    divName,
                    city,
                );

                // Price output materials
                // For materials, just use 'MP' (market price) - it guarantees sales = production
                // Complex pricing only matters for products where you want to maximize profit
                for (const material of industry.outputMaterials || []) {
                    // Check if division has Market-TA.II research
                    let hasMarketTA2 = false;
                    try {
                        hasMarketTA2 = await execCorpFunc(
                            ns,
                            "hasResearched(ns.args[0], ns.args[1])",
                            divName,
                            "Market-TA.II",
                        );
                    } catch (e) {}

                    if (hasMarketTA2) {
                        // Use built-in Market-TA.II auto-pricing (best option)
                        await execCorpFunc(
                            ns,
                            "setMaterialMarketTA2(ns.args[0], ns.args[1], ns.args[2], ns.args[3])",
                            divName,
                            city,
                            material,
                            true,
                        );
                    } else {
                        // Use simple 'MP' (market price) - reliable, guarantees sales
                        await execCorpFunc(
                            ns,
                            "sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                            divName,
                            city,
                            material,
                            "MAX",
                            "MP",
                        );
                    }
                }

                // Price products
                if (industry.makesProducts) {
                    for (const productName of divData.products) {
                        const product = await execCorpFunc(
                            ns,
                            "getProduct(ns.args[0], ns.args[1], ns.args[2])",
                            divName,
                            city,
                            productName,
                        );
                        if (
                            product.developmentProgress >= 100 &&
                            product.stored > 0
                        ) {
                            const price = calculateOptimalPrice(
                                product,
                                divData,
                                office,
                                true,
                            );
                            await execCorpFunc(
                                ns,
                                "sellProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])",
                                divName,
                                city,
                                productName,
                                "MAX",
                                price.toString(),
                                false,
                            );
                        }
                    }
                }
            } catch (e) {}
        }
    }
}

// ============================================================================
// ROUND 1: AGRICULTURE SETUP
// ============================================================================

async function runRound1(ns, state) {
    let corpData = await readCorpFunc(ns, "getCorporation()");
    const verbose = state.options.verbose;

    // Create Agriculture division if needed
    if (!corpData.divisions.includes("Agriculture")) {
        log(ns, "Round 1: Creating Agriculture division");
        await execCorpFunc(
            ns,
            "expandIndustry(ns.args[0], ns.args[1])",
            "Agriculture",
            "Agriculture",
        );
        await ns.sleep(500);
        return;
    }

    const agDiv = await readCorpFunc(
        ns,
        "getDivision(ns.args[0])",
        "Agriculture",
    );

    // Expand to all cities and set up warehouses
    let allCitiesReady = true;
    for (const city of CITIES) {
        corpData = await readCorpFunc(ns, "getCorporation()");

        // Expand to city
        if (!agDiv.cities.includes(city)) {
            if (city !== "Sector-12" && corpData.funds > 4e9) {
                log(ns, `Round 1: Expanding to ${city}`);
                await execCorpFunc(
                    ns,
                    "expandCity(ns.args[0], ns.args[1])",
                    "Agriculture",
                    city,
                );
                await ns.sleep(200);
            }
            allCitiesReady = false;
            continue;
        }

        // Purchase warehouse
        const hasWarehouse = await readCorpFunc(
            ns,
            "hasWarehouse(ns.args[0], ns.args[1])",
            "Agriculture",
            city,
        );
        if (!hasWarehouse) {
            if (corpData.funds > 5e9) {
                log(ns, `Round 1: Purchasing warehouse in ${city}`);
                await execCorpFunc(
                    ns,
                    "purchaseWarehouse(ns.args[0], ns.args[1])",
                    "Agriculture",
                    city,
                );
                await ns.sleep(200);
            }
            allCitiesReady = false;
            continue;
        }

        // Hire employees and assign to production roles
        // Target 9 employees per city (more production capacity)
        const office = await readCorpFunc(
            ns,
            "getOffice(ns.args[0], ns.args[1])",
            "Agriculture",
            city,
        );
        const targetEmployees = 9; // Increased from 4

        if (office.numEmployees < targetEmployees) {
            // Employees are cheap - use lower threshold ($10M instead of $1B)
            if (corpData.funds > 10e6) {
                if (office.size < targetEmployees) {
                    const toAdd = Math.min(3, targetEmployees - office.size); // Add 3 at a time
                    await execCorpFunc(
                        ns,
                        "upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])",
                        "Agriculture",
                        city,
                        toAdd,
                    );
                }
                for (
                    let i = office.numEmployees;
                    i < Math.min(targetEmployees, office.size);
                    i++
                ) {
                    await execCorpFunc(
                        ns,
                        "hireEmployee(ns.args[0], ns.args[1])",
                        "Agriculture",
                        city,
                    );
                }
                // Quality-focused distribution (65% Engineers)
                await assignEmployeesToProduction(
                    ns,
                    "Agriculture",
                    city,
                    false,
                    "quality",
                    state.round,
                    agDiv.researchPoints || 0,
                );
                log(
                    ns,
                    `Round 1: Hired employees in ${city} (${office.numEmployees} -> ${Math.min(targetEmployees, office.size)})`,
                );
            }
            allCitiesReady = false;
            continue;
        }

        // Check if employees are in quality-focused distribution
        const engCount = office.employeeJobs["Engineer"] || 0;
        if (engCount < office.numEmployees * 0.5) {
            // Switch to quality-focused distribution
            await assignEmployeesToProduction(
                ns,
                "Agriculture",
                city,
                false,
                "quality",
                state.round,
                agDiv.researchPoints || 0,
            );
            log(ns, `Round 1: Reassigned ${city} employees to quality focus`);
            allCitiesReady = false;
        }
    }

    if (!allCitiesReady) {
        if (verbose) log(ns, "Round 1: Setting up cities...");
    }

    // Upgrades
    corpData = await readCorpFunc(ns, "getCorporation()");

    const smartStorageLevel = await execCorpFunc(
        ns,
        "getUpgradeLevel(ns.args[0])",
        "Smart Storage",
    );
    if (smartStorageLevel < 10 && corpData.funds > 2e9) {
        await execCorpFunc(ns, "levelUpgrade(ns.args[0])", "Smart Storage");
    }

    const advertLevel = await execCorpFunc(
        ns,
        "getHireAdVertCount(ns.args[0])",
        "Agriculture",
    );
    if (advertLevel < 2 && corpData.funds > 1e9) {
        await execCorpFunc(ns, "hireAdVert(ns.args[0])", "Agriculture");
    }

    // Upgrade warehouses
    for (const city of agDiv.cities) {
        if (
            !(await readCorpFunc(
                ns,
                "hasWarehouse(ns.args[0], ns.args[1])",
                "Agriculture",
                city,
            ))
        )
            continue;
        const warehouse = await readCorpFunc(
            ns,
            "getWarehouse(ns.args[0], ns.args[1])",
            "Agriculture",
            city,
        );
        if (warehouse.level < 3 && corpData.funds > 1e9) {
            await execCorpFunc(
                ns,
                "upgradeWarehouse(ns.args[0], ns.args[1])",
                "Agriculture",
                city,
            );
        }
    }
}

// ============================================================================
// ROUND 2: CHEMICAL DIVISION
// ============================================================================

async function runRound2(ns, state) {
    let corpData = await readCorpFunc(ns, "getCorporation()");

    // Verify Agriculture is set up
    if (!corpData.divisions.includes("Agriculture")) {
        await runRound1(ns, state);
        return;
    }

    // Verify Agriculture has production employees
    const agOffice = await readCorpFunc(
        ns,
        "getOffice(ns.args[0], ns.args[1])",
        "Agriculture",
        "Sector-12",
    );
    if ((agOffice.employeeJobs["Operations"] || 0) === 0) {
        await runRound1(ns, state);
        return;
    }

    // Purchase Export unlock
    if (!(await execCorpFunc(ns, "hasUnlock(ns.args[0])", "Export"))) {
        if (corpData.funds > 20e9) {
            await execCorpFunc(ns, "purchaseUnlock(ns.args[0])", "Export");
            log(ns, "Round 2: Purchased Export unlock");
        }
        return;
    }

    // Create Chemical division (if we can afford it)
    if (!corpData.divisions.includes("Chemical")) {
        if (corpData.funds > 70e9) {
            log(ns, "Round 2: Creating Chemical division");
            await execCorpFunc(
                ns,
                "expandIndustry(ns.args[0], ns.args[1])",
                "Chemical",
                "Chemical",
            );
            await ns.sleep(500);
        }
        // Don't return - continue to export routes and upgrades below
    }

    // Chemical-specific setup: expand to cities, hire employees
    if (corpData.divisions.includes("Chemical")) {
        const chemDiv = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            "Chemical",
        );

        // Expand Chemical to all cities
        for (const city of CITIES) {
            corpData = await readCorpFunc(ns, "getCorporation()");

            if (!chemDiv.cities.includes(city)) {
                if (city !== "Sector-12" && corpData.funds > 4e9) {
                    log(ns, `Round 2: Expanding Chemical to ${city}`);
                    await execCorpFunc(
                        ns,
                        "expandCity(ns.args[0], ns.args[1])",
                        "Chemical",
                        city,
                    );
                    await ns.sleep(200);
                }
                continue;
            }

            const hasWarehouse = await readCorpFunc(
                ns,
                "hasWarehouse(ns.args[0], ns.args[1])",
                "Chemical",
                city,
            );
            if (!hasWarehouse) {
                if (corpData.funds > 5e9) {
                    log(
                        ns,
                        `Round 2: Purchasing warehouse for Chemical in ${city}`,
                    );
                    await execCorpFunc(
                        ns,
                        "purchaseWarehouse(ns.args[0], ns.args[1])",
                        "Chemical",
                        city,
                    );
                    await ns.sleep(200);
                }
                continue;
            }

            const office = await readCorpFunc(
                ns,
                "getOffice(ns.args[0], ns.args[1])",
                "Chemical",
                city,
            );
            const targetEmployees = 9; // Increased from 3

            if (office.numEmployees < targetEmployees) {
                if (corpData.funds > 10e6) {
                    // Lowered threshold
                    if (office.size < targetEmployees) {
                        const toAdd = Math.min(
                            3,
                            targetEmployees - office.size,
                        );
                        await execCorpFunc(
                            ns,
                            "upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])",
                            "Chemical",
                            city,
                            toAdd,
                        );
                    }
                    for (
                        let i = office.numEmployees;
                        i < Math.min(targetEmployees, office.size);
                        i++
                    ) {
                        await execCorpFunc(
                            ns,
                            "hireEmployee(ns.args[0], ns.args[1])",
                            "Chemical",
                            city,
                        );
                    }
                    await assignEmployeesToProduction(
                        ns,
                        "Chemical",
                        city,
                        false,
                        "quality",
                        state.round,
                        chemDiv.researchPoints || 0,
                    );
                    log(ns, `Round 2: Hired employees for Chemical in ${city}`);
                }
            }
        }

        // Set up export routes: Agriculture -> Chemical (Plants)
        await setupExportRoutes(ns, "Agriculture", "Chemical", "Plants");

        // Set up export routes: Chemical -> Agriculture (Chemicals)
        await setupExportRoutes(ns, "Chemical", "Agriculture", "Chemicals");
    }

    // Upgrades
    const smartStorageLevel = await execCorpFunc(
        ns,
        "getUpgradeLevel(ns.args[0])",
        "Smart Storage",
    );
    if (smartStorageLevel < 15 && corpData.funds > 2e9) {
        await execCorpFunc(ns, "levelUpgrade(ns.args[0])", "Smart Storage");
    }

    const smartFactoriesLevel = await execCorpFunc(
        ns,
        "getUpgradeLevel(ns.args[0])",
        "Smart Factories",
    );
    if (smartFactoriesLevel < 10 && corpData.funds > 2e9) {
        await execCorpFunc(ns, "levelUpgrade(ns.args[0])", "Smart Factories");
    }
}

// ============================================================================
// ROUND 3+: TOBACCO & PRODUCTS
// ============================================================================

async function runRound3Plus(ns, state) {
    let corpData = await readCorpFunc(ns, "getCorporation()");

    // Verify prerequisites - must have both divisions with employees
    if (
        !corpData.divisions.includes("Agriculture") ||
        !corpData.divisions.includes("Chemical")
    ) {
        await runRound2(ns, state);
        return;
    }

    // Verify Chemical has employees (critical for production chain)
    const chemOffice = await readCorpFunc(
        ns,
        "getOffice(ns.args[0], ns.args[1])",
        "Chemical",
        "Sector-12",
    );
    if (chemOffice.numEmployees === 0) {
        log(ns, "Round 3+: Chemical has no employees, running Round 2 setup");
        await runRound2(ns, state);
        return;
    }

    // ========================================================================
    // QUALITY GATE: Check if Agriculture Plants quality is high enough for Tobacco
    // Products are input-capped when avgInputQuality < sqrt(productRating)
    // ========================================================================

    // Get Plants quality from Agriculture's best city
    const agDiv = await readCorpFunc(
        ns,
        "getDivision(ns.args[0])",
        "Agriculture",
    );
    const plantsQualityByCity = {};
    for (const city of agDiv.cities) {
        const hasWarehouse = await readCorpFunc(
            ns,
            "hasWarehouse(ns.args[0], ns.args[1])",
            "Agriculture",
            city,
        );
        if (!hasWarehouse) continue;
        const plantsData = await readCorpFunc(
            ns,
            "getMaterial(ns.args[0], ns.args[1], ns.args[2])",
            "Agriculture",
            city,
            "Plants",
        );
        plantsQualityByCity[city] = plantsData;
    }

    const { bestCity: bestPlantsCity, bestQuality: bestPlantsQuality } =
        findBestQualityCity(plantsQualityByCity);

    const readiness = checkProductReadiness(bestPlantsQuality, 25);
    const bypassByFunds = corpData.funds >= 20e9;
    const qualityGateReady = readiness.isReady || bypassByFunds;
    log(
        ns,
        `Round 3+: Tobacco gate - Plants Q=${bestPlantsQuality.toFixed(1)} threshold=${readiness.threshold.toFixed(1)} (effective ${readiness.effectiveRatingPercent.toFixed(0)}%), Funds=${formatMoney(corpData.funds)}, Bypass=${bypassByFunds ? "funds" : readiness.isReady ? "quality" : "none"}`,
    );

    // Create Tobacco division - only if quality is sufficient OR we have lots of funds
    if (!corpData.divisions.includes("Tobacco")) {
        if (!qualityGateReady) {
            log(
                ns,
                `Round 3+: Delaying Tobacco - Plants quality ${bestPlantsQuality.toFixed(1)} < threshold ${readiness.threshold.toFixed(1)} (${readiness.effectiveRatingPercent.toFixed(0)}% effective), Funds=${formatMoney(corpData.funds)}`,
            );
            log(
                ns,
                `Focusing on Agriculture quality in ${bestPlantsCity} (Q=${bestPlantsQuality.toFixed(1)})`,
            );
        } else if (corpData.funds > 20e9) {
            log(
                ns,
                `Round 3+: Creating Tobacco division (Plants Q=${bestPlantsQuality.toFixed(1)}, threshold=${readiness.threshold.toFixed(1)})`,
            );
            await execCorpFunc(
                ns,
                "expandIndustry(ns.args[0], ns.args[1])",
                "Tobacco",
                "Tobacco",
            );
            await ns.sleep(500);
        }
        // Don't return - fall through to general upgrades below
    }

    // Tobacco-specific setup: expand cities, exports, products, research
    if (corpData.divisions.includes("Tobacco")) {
        const tobaccoDiv = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            "Tobacco",
        );

        // Expand Tobacco to all cities
        for (const city of CITIES) {
            corpData = await readCorpFunc(ns, "getCorporation()");

            if (!tobaccoDiv.cities.includes(city)) {
                if (city !== "Sector-12" && corpData.funds > 4e9) {
                    log(ns, `Round 3+: Expanding Tobacco to ${city}`);
                    await execCorpFunc(
                        ns,
                        "expandCity(ns.args[0], ns.args[1])",
                        "Tobacco",
                        city,
                    );
                    await ns.sleep(200);
                }
                continue;
            }

            const hasWarehouse = await readCorpFunc(
                ns,
                "hasWarehouse(ns.args[0], ns.args[1])",
                "Tobacco",
                city,
            );
            if (!hasWarehouse) {
                if (corpData.funds > 5e9) {
                    log(
                        ns,
                        `Round 3+: Purchasing warehouse for Tobacco in ${city}`,
                    );
                    await execCorpFunc(
                        ns,
                        "purchaseWarehouse(ns.args[0], ns.args[1])",
                        "Tobacco",
                        city,
                    );
                    await ns.sleep(200);
                }
                continue;
            }

            const office = await readCorpFunc(
                ns,
                "getOffice(ns.args[0], ns.args[1])",
                "Tobacco",
                city,
            );
            const targetSize = city === "Sector-12" ? 30 : 9;

            if (office.size < targetSize && corpData.funds > 2e9) {
                await execCorpFunc(
                    ns,
                    "upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])",
                    "Tobacco",
                    city,
                    targetSize - office.size,
                );
            }

            if (office.numEmployees < targetSize) {
                for (
                    let i = office.numEmployees;
                    i < Math.min(targetSize, office.size);
                    i++
                ) {
                    await execCorpFunc(
                        ns,
                        "hireEmployee(ns.args[0], ns.args[1])",
                        "Tobacco",
                        city,
                    );
                }
                // Products need Engineers prioritized
                await assignEmployeesToProduction(
                    ns,
                    "Tobacco",
                    city,
                    true,
                    "product",
                    state.round,
                    tobaccoDiv.researchPoints || 0,
                );
            }
        }

        // Set up export routes: Agriculture -> Tobacco (Plants)
        await setupExportRoutes(ns, "Agriculture", "Tobacco", "Plants");

        // Product development
        if (
            tobaccoDiv.products.length === 0 ||
            (await canDevelopNewProduct(ns, "Tobacco"))
        ) {
            await developNewProduct(ns, "Tobacco", state);
        }

        // Buy Wilson Analytics and AdVert
        await buyWilsonAndAdvert(ns, "Tobacco");

        // Buy research upgrades
        await buyResearchForAllDivisions(ns);
    }

    // General upgrades (always run regardless of Tobacco status)
    await upgradeProductionCapability(ns);
}

// ============================================================================
// EXPORT MANAGEMENT
// ============================================================================

async function setupExportRoutes(ns, fromDiv, toDiv, material) {
    const fromDivData = await readCorpFunc(
        ns,
        "getDivision(ns.args[0])",
        fromDiv,
    );
    const toDivData = await readCorpFunc(ns, "getDivision(ns.args[0])", toDiv);

    // Collect material quality from all source cities
    const materialDataByCity = {};
    for (const city of fromDivData.cities) {
        const hasWarehouse = await readCorpFunc(
            ns,
            "hasWarehouse(ns.args[0], ns.args[1])",
            fromDiv,
            city,
        );
        if (!hasWarehouse) continue;
        const matData = await readCorpFunc(
            ns,
            "getMaterial(ns.args[0], ns.args[1], ns.args[2])",
            fromDiv,
            city,
            material,
        );
        materialDataByCity[city] = matData;
    }

    // Find the best quality city for exports
    const { bestCity, bestQuality, allQualities } =
        findBestQualityCity(materialDataByCity);

    if (bestCity) {
        log(
            ns,
            `Export ${material}: Best quality city is ${bestCity} (Q=${bestQuality.toFixed(1)})`,
        );
    }

    for (const city of CITIES) {
        // Check both divisions have warehouses in this city
        if (
            !fromDivData.cities.includes(city) ||
            !toDivData.cities.includes(city)
        )
            continue;

        const fromHasWarehouse = await readCorpFunc(
            ns,
            "hasWarehouse(ns.args[0], ns.args[1])",
            fromDiv,
            city,
        );
        const toHasWarehouse = await readCorpFunc(
            ns,
            "hasWarehouse(ns.args[0], ns.args[1])",
            toDiv,
            city,
        );

        if (!fromHasWarehouse || !toHasWarehouse) continue;

        // Determine this city's role based on quality
        const cityQuality = allQualities[city] || 0;
        const cityRole = determineCityRole(cityQuality, bestQuality, 5);

        try {
            // Cancel existing export first
            await execCorpFunc(
                ns,
                "cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
                fromDiv,
                city,
                toDiv,
                city,
                material,
            );
        } catch (e) {}

        if (cityRole.role === "export" || cityRole.role === "secondary") {
            // This city has good quality - set up export
            try {
                // Export production + 10% of inventory
                await execCorpFunc(
                    ns,
                    "exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])",
                    fromDiv,
                    city,
                    toDiv,
                    city,
                    material,
                    "(IPROD+IINV/10)*(-1)",
                );
            } catch (e) {}
        } else {
            // Low quality city - don't export, sell locally instead
            // This prevents quality dilution in the destination
            log(
                ns,
                `Skipping export from ${city} (Q=${cityQuality.toFixed(1)}) - selling locally to avoid dilution`,
            );
        }
    }
}

// ============================================================================
// PRODUCT MANAGEMENT
// ============================================================================

async function canDevelopNewProduct(ns, division) {
    const divData = await readCorpFunc(ns, "getDivision(ns.args[0])", division);

    for (const productName of divData.products) {
        const product = await execCorpFunc(
            ns,
            "getProduct(ns.args[0], ns.args[1], ns.args[2])",
            division,
            "Sector-12",
            productName,
        );
        if (product.developmentProgress < 100) {
            return false;
        }
    }

    return true;
}

async function developNewProduct(ns, division, state) {
    const corpData = await readCorpFunc(ns, "getCorporation()");
    const divData = await readCorpFunc(ns, "getDivision(ns.args[0])", division);

    // Discontinue worst product if at max
    if (divData.products.length >= 3) {
        let worstProduct = divData.products[0];
        let worstRating = Infinity;

        for (const productName of divData.products) {
            const product = await execCorpFunc(
                ns,
                "getProduct(ns.args[0], ns.args[1], ns.args[2])",
                division,
                "Sector-12",
                productName,
            );
            if (
                product.developmentProgress >= 100 &&
                product.effectiveRating < worstRating
            ) {
                worstRating = product.effectiveRating;
                worstProduct = productName;
            }
        }

        await execCorpFunc(
            ns,
            "discontinueProduct(ns.args[0], ns.args[1])",
            division,
            worstProduct,
        );
        log(ns, `Discontinued product: ${worstProduct}`);
    }

    const productName = getProductName(division, state.productVersion++);
    const investment = Math.max(1e9, corpData.funds * 0.01);

    await execCorpFunc(
        ns,
        "makeProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])",
        division,
        "Sector-12",
        productName,
        investment,
        investment,
    );
    log(ns, `Started developing product: ${productName}`);
}

// ============================================================================
// UPGRADES
// ============================================================================

async function buyWilsonAndAdvert(ns, division) {
    const corpData = await readCorpFunc(ns, "getCorporation()");
    const divData = await readCorpFunc(ns, "getDivision(ns.args[0])", division);

    if (divData.awareness >= Number.MAX_VALUE * 0.9) return;

    const wilsonCost = await execCorpFunc(
        ns,
        "getUpgradeLevelCost(ns.args[0])",
        "Wilson Analytics",
    );
    if (corpData.funds > wilsonCost * 2) {
        await execCorpFunc(ns, "levelUpgrade(ns.args[0])", "Wilson Analytics");
    }

    const advertCost = await execCorpFunc(
        ns,
        "getHireAdVertCost(ns.args[0])",
        division,
    );
    if (corpData.funds > advertCost * 5) {
        await execCorpFunc(ns, "hireAdVert(ns.args[0])", division);
    }
}

async function buyResearchForAllDivisions(ns) {
    const corpData = await readCorpFunc(ns, "getCorporation()");

    for (const divName of corpData.divisions) {
        const divData = await readCorpFunc(
            ns,
            "getDivision(ns.args[0])",
            divName,
        );
        const rp = divData.researchPoints || 0;
        const industry = divData.industry;

        const isMaterialDivision = [
            "Agriculture",
            "Chemical",
            "Water",
        ].includes(industry);
        const isProductDivision = ["Tobacco"].includes(industry);

        if (!isMaterialDivision && !isProductDivision) continue;

        const researchPlan = isMaterialDivision
            ? [
                  "Hi-Tech R&D Laboratory",
                  "Overclock",
                  "Sti.mu",
                  "Automatic Drug Administration",
                  "Go-Juice",
                  "CPH4 Injections",
              ]
            : [
                  "Hi-Tech R&D Laboratory",
                  "uPgrade: Fulcrum",
                  "Self-Correcting Assemblers",
                  "Drones",
                  "Drones - Assembly",
                  "Drones - Transport",
              ];

        for (const researchName of researchPlan) {
            try {
                const hasIt = await readCorpFunc(
                    ns,
                    "hasResearched(ns.args[0], ns.args[1])",
                    divName,
                    researchName,
                );
                if (hasIt) continue;
                const cost = await readCorpFunc(
                    ns,
                    "getResearchCost(ns.args[0], ns.args[1])",
                    divName,
                    researchName,
                );
                const threshold =
                    researchName === "Hi-Tech R&D Laboratory"
                        ? rp / 2
                        : rp / 10;
                if (threshold > cost) {
                    await execCorpFunc(
                        ns,
                        "research(ns.args[0], ns.args[1])",
                        divName,
                        researchName,
                    );
                }
            } catch {}
        }
    }
}

async function upgradeProductionCapability(ns) {
    // Priority upgrades with more aggressive purchasing
    // Smart Factories (+3% production) and Smart Storage (+10% warehouse) are most impactful
    const priorityUpgrades = [
        { name: "Smart Factories", fundsMult: 1.5 },
        { name: "Smart Storage", fundsMult: 1.5 },
        { name: "Wilson Analytics", fundsMult: 3 }, // Advertising effectiveness
        { name: "ABC SalesBots", fundsMult: 3 }, // +1% sales per level
        { name: "FocusWires", fundsMult: 4 },
        { name: "Neural Accelerators", fundsMult: 4 },
        { name: "Speech Processor Implants", fundsMult: 4 },
        { name: "Nuoptimal Nootropic Injector Implants", fundsMult: 4 },
        { name: "Project Insight", fundsMult: 5 },
    ];

    for (const upgrade of priorityUpgrades) {
        let iterations = 0;
        while (iterations++ < 20) {
            try {
                const cost = await readCorpFunc(
                    ns,
                    "getUpgradeLevelCost(ns.args[0])",
                    upgrade.name,
                );
                const currentCorpData = await readCorpFunc(
                    ns,
                    "getCorporation()",
                );
                if (currentCorpData.funds > cost * upgrade.fundsMult) {
                    await execCorpFunc(
                        ns,
                        "levelUpgrade(ns.args[0])",
                        upgrade.name,
                    );
                } else {
                    break;
                }
            } catch {
                break;
            }
        }
    }
}

// ============================================================================
// INVESTMENT
// ============================================================================

async function checkInvestment(ns, state) {
    const corpData = await readCorpFunc(ns, "getCorporation()");
    const offer = await readCorpFunc(ns, "getInvestmentOffer()");
    if (!offer || offer.funds <= 0) return;

    const round = offer.round;
    const bnMult = state.bnMults?.CorporationValuation || 1;
    const thresholds = { 1: 440e9, 2: 8.8e12, 3: 12e15, 4: 500e18 };
    const threshold = thresholds[round] || 0;

    const currentValue = offer.funds + corpData.funds * bnMult;

    if (threshold * bnMult < currentValue || state.roundTrigger) {
        state.roundTrigger = true;
        if (state.oldRound <= currentValue) {
            state.oldRound = currentValue;
        } else {
            await execCorpFunc(ns, "acceptInvestmentOffer()");
            log(
                ns,
                `Accepted investment round ${round}: ${formatMoney(offer.funds)}`,
                true,
                "success",
            );
            state.round = round + 1;
            state.roundTrigger = false;
            state.oldRound = 0;
        }
    }

    log(
        ns,
        `Investment: Round ${round}, Offer ${formatMoney(offer.funds)}, Value ${formatMoney(currentValue)}, Threshold ${formatMoney(threshold * bnMult)}, Trigger=${state.roundTrigger}`,
    );
}
