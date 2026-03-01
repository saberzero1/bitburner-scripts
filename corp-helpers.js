/**
 * Corporation helper functions - Based on BitBurner source code analysis
 * https://github.com/bitburner-official/bitburner-src/tree/dev/src/Corporation
 * 
 * Key formulas extracted from:
 * - Division.ts: Production calculation, boost materials
 * - OfficeSpace.ts: Employee productivity
 * - Warehouse.ts: Storage mechanics
 * - Corporation.ts: Investment valuation
 */

// ============================================================================
// INDUSTRY DEFINITIONS (from IndustryData.ts)
// ============================================================================

export const INDUSTRIES = {
    Agriculture: {
        name: 'Agriculture',
        makesProducts: false,
        // Input ratios per unit of production
        inputMaterials: { Water: 0.5, Chemicals: 0.2 },
        outputMaterials: ['Plants', 'Food'],
        // Boost material factors (exponents in production formula)
        boostFactors: { realEstate: 0.72, hardware: 0.2, robots: 0.3, aiCores: 0.3 },
        scienceFactor: 0.5,
        advertisingFactor: 0.04
    },
    Chemical: {
        name: 'Chemical',
        makesProducts: false,
        inputMaterials: { Plants: 1, Water: 0.5 },
        outputMaterials: ['Chemicals'],
        boostFactors: { realEstate: 0.25, hardware: 0.2, robots: 0.25, aiCores: 0.2 },
        scienceFactor: 0.75,
        advertisingFactor: 0.07
    },
    Tobacco: {
        name: 'Tobacco',
        makesProducts: true,
        inputMaterials: { Plants: 1 },
        outputMaterials: [],
        boostFactors: { realEstate: 0.15, hardware: 0.15, robots: 0.25, aiCores: 0.15 },
        scienceFactor: 0.75,
        advertisingFactor: 0.2
    },
    // Water Utilities - CRITICAL for breaking the quality ceiling
    // Without this, Agriculture is capped at ~4.7 quality because purchased Water has Q=1
    Water: {
        name: 'Water Utilities',
        makesProducts: false,
        inputMaterials: { Hardware: 0.1 },
        outputMaterials: ['Water'],
        boostFactors: { realEstate: 0.5, hardware: 0.4, robots: 0.4, aiCores: 0.4 },
        scienceFactor: 0.5,
        advertisingFactor: 0.08
    }
};

// ============================================================================
// MATERIAL SIZES (from MaterialInfo.ts)
// ============================================================================

export const MATERIAL_SIZES = {
    // Boost materials
    'Real Estate': 0.005,
    'Hardware': 0.06,
    'Robots': 0.5,
    'AI Cores': 0.1,
    // Production materials
    'Water': 0.05,
    'Plants': 0.05,
    'Food': 0.03,
    'Chemicals': 0.05,
    'Ore': 0.01,
    'Minerals': 0.04,
    'Metal': 0.1,
    'Drugs': 0.02
};

export const CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];

// Game constants from Corporation/data/Constants.ts
const SECONDS_PER_MARKET_CYCLE = 10;  // corpConstants.secondsPerMarketCycle

// ============================================================================
// WAREHOUSE SPACE BUDGET CALCULATOR
// The key insight: warehouse must have room for OUTPUT materials
// ============================================================================

/**
 * Calculate warehouse space budget allocation
 * 
 * Space must be divided between:
 * 1. Boost materials (permanent, for production multiplier)
 * 2. Input materials (consumed each cycle)
 * 3. OUTPUT headroom (produced each cycle - CRITICAL!)
 * 
 * The formula for net space change per production cycle:
 * netSpaceChange = Σ(outputSize × outputQty) - Σ(inputSize × inputRatio × prod)
 * 
 * For Agriculture: produces Plants(0.05) + Food(0.03), consumes Water(0.05×0.5) + Chemicals(0.05×0.2)
 * Net per unit: 0.05 + 0.03 - 0.025 - 0.01 = +0.045
 * 
 * @param {string} industryType - Industry type
 * @param {number} warehouseSize - Total warehouse size
 * @param {number} productionRate - Expected production per second
 * @returns {Object} Space budget allocation
 */
export function calculateWarehouseSpaceBudget(industryType, warehouseSize, productionRate = 10) {
    const industry = INDUSTRIES[industryType];
    if (!industry) return null;

    // Calculate space needed for one production cycle worth of materials
    // Production happens over SECONDS_PER_MARKET_CYCLE seconds
    const cycleProduction = productionRate * SECONDS_PER_MARKET_CYCLE;

    // Calculate input space needed per cycle
    let inputSpacePerCycle = 0;
    for (const [mat, ratio] of Object.entries(industry.inputMaterials)) {
        inputSpacePerCycle += MATERIAL_SIZES[mat] * ratio * cycleProduction;
    }

    // Calculate output space needed per cycle
    let outputSpacePerCycle = 0;
    for (const mat of industry.outputMaterials) {
        outputSpacePerCycle += MATERIAL_SIZES[mat] * cycleProduction;
    }

    // Net space change per cycle (positive = warehouse fills up)
    const netSpaceChange = outputSpacePerCycle - inputSpacePerCycle;

    // Reserve space for 3 cycles of production buffer
    // This ensures production doesn't stall when sales lag
    const productionBuffer = Math.max(0, netSpaceChange * 3);
    
    // Reserve space for 2 cycles of input materials
    const inputBuffer = inputSpacePerCycle * 2;

    // Total reserved for production flow
    const reservedForProduction = productionBuffer + inputBuffer;

    // Remaining space for boost materials (with 10% safety margin)
    const boostSpace = Math.max(0, (warehouseSize - reservedForProduction) * 0.9);

    return {
        warehouseSize,
        boostSpace,                    // Space available for boost materials
        inputBuffer,                   // Space reserved for input materials
        productionBuffer,              // Space reserved for output materials
        netSpaceChangePerCycle: netSpaceChange,
        utilizationTarget: 0.8,        // Target 80% max utilization
        maxInputMaterials: inputSpacePerCycle * 2  // Don't buy more than 2 cycles worth
    };
}

/**
 * Calculate optimal boost material distribution within a space budget
 * Uses Lagrange multiplier optimization for maximum production multiplier
 * 
 * Production formula from Division.ts:
 * cityMult = (0.002 × realEstate + 1)^factor × (0.002 × hardware + 1)^factor × ...
 * totalMult = Σ(cityMult^0.73)
 * 
 * @param {string} industryType - Industry type
 * @param {number} availableSpace - Space allocated for boost materials
 * @returns {Object} Optimal quantities for each boost material
 */
export function calculateOptimalBoostMaterials(industryType, availableSpace) {
    const industry = INDUSTRIES[industryType];
    if (!industry || availableSpace <= 0) return null;

    const factors = industry.boostFactors;
    
    // For optimal allocation, each material should contribute proportionally to its factor
    // This is derived from Lagrange multiplier optimization
    const totalFactor = factors.realEstate + factors.hardware + factors.robots + factors.aiCores;
    
    // Calculate proportional space allocation based on factor weights
    // Higher factor = more space allocated (more bang for the buck)
    const realEstateWeight = factors.realEstate / totalFactor;
    const hardwareWeight = factors.hardware / totalFactor;
    const robotsWeight = factors.robots / totalFactor;
    const aiCoresWeight = factors.aiCores / totalFactor;

    // Calculate quantities from allocated space
    const result = {
        'Real Estate': Math.floor((availableSpace * realEstateWeight) / MATERIAL_SIZES['Real Estate']),
        'Hardware': Math.floor((availableSpace * hardwareWeight) / MATERIAL_SIZES['Hardware']),
        'Robots': Math.floor((availableSpace * robotsWeight) / MATERIAL_SIZES['Robots']),
        'AI Cores': Math.floor((availableSpace * aiCoresWeight) / MATERIAL_SIZES['AI Cores'])
    };

    // Verify we don't exceed space
    let totalUsed = 0;
    for (const [mat, qty] of Object.entries(result)) {
        totalUsed += qty * MATERIAL_SIZES[mat];
    }

    // Scale down if we exceeded (rounding errors)
    if (totalUsed > availableSpace) {
        const scale = availableSpace / totalUsed * 0.95;
        for (const mat of Object.keys(result)) {
            result[mat] = Math.floor(result[mat] * scale);
        }
    }

    return result;
}

/**
 * Calculate the production multiplier from boost materials
 * Formula from Division.ts calculateProductionFactors()
 * 
 * @param {Object} boostMaterials - Current boost material quantities
 * @param {string} industryType - Industry type
 * @returns {number} Production multiplier
 */
export function calculateProductionMultiplier(boostMaterials, industryType) {
    const industry = INDUSTRIES[industryType];
    if (!industry) return 1;

    const factors = industry.boostFactors;
    const realEstate = boostMaterials['Real Estate'] || 0;
    const hardware = boostMaterials['Hardware'] || 0;
    const robots = boostMaterials['Robots'] || 0;
    const aiCores = boostMaterials['AI Cores'] || 0;

    // Formula from Division.ts L123-137
    const cityMult = 
        Math.pow(0.002 * realEstate + 1, factors.realEstate) *
        Math.pow(0.002 * hardware + 1, factors.hardware) *
        Math.pow(0.002 * robots + 1, factors.robots) *
        Math.pow(0.002 * aiCores + 1, factors.aiCores);

    // Per-city multiplier with diminishing returns
    return Math.pow(cityMult, 0.73);
}

// ============================================================================
// EMPLOYEE OPTIMIZATION
// ============================================================================

/**
 * Calculate optimal employee distribution for material production
 * 
 * From Division.ts getOfficeProductivity():
 * prod = (opProd^0.4 + engrProd^0.3) × mgmtFactor × 0.05
 * mgmtFactor = 1 + mgmtProd / (1.2 × total)
 * 
 * Optimal distribution prioritizes Operations > Engineering > Management
 * 
 * @param {number} totalEmployees - Total employees in office
 * @param {boolean} forProducts - If true, optimize for product development
 * @returns {Object} Job assignments
 */
export function calculateOptimalEmployeeDistribution(totalEmployees, forProducts = false) {
    if (totalEmployees < 4) {
        // Minimum viable: 1 each of the core roles
        return {
            Operations: Math.min(1, totalEmployees),
            Engineer: Math.min(1, Math.max(0, totalEmployees - 1)),
            Business: Math.min(1, Math.max(0, totalEmployees - 2)),
            Management: Math.min(1, Math.max(0, totalEmployees - 3)),
            'Research & Development': 0
        };
    }

    if (forProducts) {
        // Product development: Engineer^0.34 + Operations^0.2
        // Prioritize Engineers more
        return {
            Operations: Math.floor(totalEmployees * 0.20),
            Engineer: Math.floor(totalEmployees * 0.35),
            Business: Math.floor(totalEmployees * 0.15),
            Management: Math.floor(totalEmployees * 0.15),
            'Research & Development': Math.floor(totalEmployees * 0.15)
        };
    } else {
        // Material production: Operations^0.4 + Engineer^0.3
        // Prioritize Operations slightly more
        return {
            Operations: Math.floor(totalEmployees * 0.35),
            Engineer: Math.floor(totalEmployees * 0.25),
            Business: Math.floor(totalEmployees * 0.15),
            Management: Math.floor(totalEmployees * 0.15),
            'Research & Development': Math.floor(totalEmployees * 0.10)
        };
    }
}

/**
 * Calculate estimated office productivity
 * From Division.ts getOfficeProductivity() and OfficeSpace.ts
 * 
 * @param {Object} employeeJobs - Jobs distribution
 * @param {number} avgMorale - Average morale (0-100)
 * @param {number} avgEnergy - Average energy (0-100)
 * @returns {number} Estimated productivity
 */
export function estimateOfficeProductivity(employeeJobs, avgMorale = 100, avgEnergy = 100) {
    // Base production from morale and energy
    const prodBase = avgMorale * avgEnergy * 1e-4;

    // Assume average employee stats (50 each for simplicity)
    const avgStat = 50;
    const avgExp = 100;

    // Calculate production by job
    const opsProdMult = 0.6 * avgStat + 0.1 * avgStat + avgExp + 0.5 * avgStat + avgStat;
    const engrProdMult = avgStat + 0.1 * avgStat + 1.5 * avgExp + avgStat;
    const mgmtProdMult = 2 * avgStat + avgExp + 0.2 * avgStat + 0.7 * avgStat;

    const opsProd = (employeeJobs.Operations || 0) * opsProdMult * prodBase;
    const engrProd = (employeeJobs.Engineer || 0) * engrProdMult * prodBase;
    const mgmtProd = (employeeJobs.Management || 0) * mgmtProdMult * prodBase;

    const total = opsProd + engrProd + mgmtProd;
    if (total <= 0) return 0;

    // Management factor
    const mgmtFactor = 1 + mgmtProd / (1.2 * total);

    // Final productivity formula
    const prod = (Math.pow(opsProd, 0.4) + Math.pow(engrProd, 0.3)) * mgmtFactor;

    return prod * 0.05; // balancingMult
}

// ============================================================================
// SMART SUPPLY (Input Material Management)
// ============================================================================

/**
 * Calculate how much of each input material to buy
 * 
 * Key insight: Don't fill warehouse to 100%!
 * Leave room for production outputs.
 * 
 * @param {Object} divData - Division data from API
 * @param {Object} warehouse - Warehouse data from API
 * @param {Object} materials - Map of material name to material data
 * @param {number} targetUtilization - Target warehouse utilization (default 0.7 = 70%)
 * @returns {Object} Buy amounts per second for each input material
 */
export function calculateSmartSupplyQuantities(divData, warehouse, materials, targetUtilization = 0.7) {
    const industry = INDUSTRIES[divData.type];
    if (!industry || !industry.inputMaterials) return {};

    // Calculate current boost material space
    let boostSpace = 0;
    for (const mat of ['Real Estate', 'Hardware', 'Robots', 'AI Cores']) {
        const stored = materials[mat]?.stored || 0;
        boostSpace += stored * MATERIAL_SIZES[mat];
    }

    // Available space for input materials (after boost and safety margin)
    const targetSpace = warehouse.size * targetUtilization;
    const inputBudget = Math.max(0, targetSpace - boostSpace);

    // Calculate proportional buy amounts based on input ratios
    const result = {};
    let totalInputRatio = 0;
    for (const ratio of Object.values(industry.inputMaterials)) {
        totalInputRatio += ratio;
    }

    for (const [material, ratio] of Object.entries(industry.inputMaterials)) {
        const currentStored = materials[material]?.stored || 0;
        const currentSpace = currentStored * MATERIAL_SIZES[material];
        
        // Target space for this material
        const targetMaterialSpace = (inputBudget * ratio) / totalInputRatio;
        
        // Target quantity
        const targetQty = targetMaterialSpace / MATERIAL_SIZES[material];
        
        // How much more do we need?
        const deficit = Math.max(0, targetQty - currentStored);
        
        // Buy rate (amount per second, divided by 10 for the API)
        // Spread purchase over 10 seconds (1 market cycle)
        result[material] = deficit / SECONDS_PER_MARKET_CYCLE;
    }

    return result;
}

/**
 * Check if warehouse utilization is safe for production
 * 
 * @param {Object} warehouse - Warehouse data
 * @returns {Object} Status with utilization and safety
 */
export function checkWarehouseHealth(warehouse) {
    const utilization = warehouse.sizeUsed / warehouse.size;
    return {
        utilization,
        isSafe: utilization < 0.9,    // Safe if under 90%
        isHealthy: utilization < 0.7, // Healthy if under 70%
        isCritical: utilization > 0.95, // Critical if over 95%
        freeSpace: warehouse.size - warehouse.sizeUsed
    };
}

// ============================================================================
// PRICING (Market-TA2 based)
// ============================================================================

/**
 * Calculate optimal selling price
 * Based on Market-TA2 formula
 * 
 * @param {Object} item - Material or Product object from API
 * @param {Object} divData - Division data from API
 * @param {Object} office - Office data from API
 * @param {boolean} isProduct - Whether the item is a product
 * @returns {number} Optimal price
 */
export function calculateOptimalPrice(item, divData, office, isProduct, productionAmount = null) {
    // Implementation based on BitBurner source: Division.ts#L370-396
    // Market-TA.II formula: optimalPrice = markupLimit / sqrt(sellAmt / sqrtDenominator) + marketPrice
    
    const industry = INDUSTRIES[divData.type];
    if (!industry) return item.marketPrice || 1;
    
    // Get market price and markup limit
    let marketPrice, markupLimit, qualityFactor;
    
    if (isProduct) {
        marketPrice = item.productionCost || 0;
        const effectiveRating = Math.max(item.effectiveRating || 0.001, 0.001);
        qualityFactor = 0.5 * Math.pow(effectiveRating, 0.65);
        // Product markup calculation
        const quality = item.stats?.quality || 1;
        const markup = 100 / (1.01 * Math.pow(quality + 0.001, 0.65) * 0.2);
        markupLimit = effectiveRating / markup;
    } else {
        marketPrice = item.marketPrice || 1;
        const quality = Math.max(item.quality || 0.001, 0.001);
        qualityFactor = quality + 0.001;
        markupLimit = quality;  // For materials, markupLimit = quality
    }
    
    // Calculate all the factors (matching BitBurner source)
    // businessFactor = calculateEffectWithFactors(1 + businessProd, 0.26, 10e3)
    const businessProd = office.employeeProductionByJob?.Business || 0;
    const businessFactor = Math.pow(1 + businessProd, 0.26) + (1 + businessProd) / 10000;
    
    // marketFactor = max(0.1, demand * (100 - competition) / 100)
    const demand = item.demand ?? 50;
    const competition = item.competition ?? 50;
    const marketFactor = Math.max(0.1, (demand * (100 - competition)) / 100);
    
    // advertisingFactor from getAdvertisingFactors()
    const awareness = divData.awareness + 1;
    const popularity = divData.popularity + 1;
    const ratio = awareness > 0 ? popularity / awareness : 0.01;
    const advertisingFactor = Math.pow(awareness, industry.advertisingFactor) *
                              Math.pow(popularity, industry.advertisingFactor) *
                              Math.pow(ratio, 0.85);
    
    // Assume salesMult = 1 (no upgrades accounted for here)
    const salesMult = 1;
    
    // The sell amount we want to achieve (production rate)
    // If not provided, use stored / 10 as estimate
    const sellAmt = productionAmount || item.productionAmount || (item.stored / 10) || 1;
    
    // sqrtDenominator = qualityFactor * marketFactor * businessFactor * salesMult * advertisingFactor
    const sqrtDenominator = qualityFactor * marketFactor * businessFactor * salesMult * advertisingFactor;
    
    // Handle edge cases
    if (sqrtDenominator <= 0 || sellAmt <= 0) {
        return marketPrice + markupLimit;
    }
    
    // Market-TA.II formula: optimalPrice = markupLimit / sqrt(sellAmt / sqrtDenominator) + marketPrice
    const denominator = Math.sqrt(sellAmt / sqrtDenominator);
    
    if (denominator <= 0) {
        return marketPrice + markupLimit;
    }
    
    const optimalPrice = markupLimit / denominator + marketPrice;
    
    // Sanity check: if optimal price is > 2x market price, it's probably too high
    // for early-game when awareness/popularity are low. Use market price instead.
    if (optimalPrice > marketPrice * 2 && awareness < 10) {
        return marketPrice;  // Fall back to market price for better sales
    }
    
    // Price must be at least market price
    return Math.max(optimalPrice, marketPrice);
}

// ============================================================================
// INVESTMENT LOGIC
// ============================================================================

/**
 * Investment round configuration from Constants.ts
 * 
 * Round 1: 10% shares × 3x multiplier = 30% of valuation
 * Round 2: 35% shares × 2x multiplier = 70% of valuation
 * Round 3: 25% shares × 2x multiplier = 50% of valuation
 * Round 4: 20% shares × 1.5x multiplier = 30% of valuation
 */
export const INVESTMENT_ROUNDS = {
    1: { sharePercent: 0.10, multiplier: 3.0, description: 'Seed funding' },
    2: { sharePercent: 0.35, multiplier: 2.0, description: 'Series A' },
    3: { sharePercent: 0.25, multiplier: 2.0, description: 'Series B' },
    4: { sharePercent: 0.20, multiplier: 1.5, description: 'Pre-IPO' }
};

/**
 * Calculate minimum acceptable investment offer
 * 
 * Based on what we need to progress:
 * - Round 1: Enough to expand Agriculture (warehouses + boosts)
 * - Round 2: Enough to set up Chemical division
 * - Round 3: Enough for Tobacco + initial products
 * - Round 4: Maximize valuation before going public
 * 
 * @param {number} round - Current investment round
 * @returns {number} Minimum acceptable offer
 */
export function getMinimumInvestmentOffer(round) {
    // Lowered thresholds to escape death spirals
    // When in trouble, any investment is better than none
    const minimums = {
        1: 500e6,    // $500m - basic Agriculture setup
        2: 2e9,      // $2b - Chemical division
        3: 5e9,      // $5b - lowered to escape death spiral
        4: 50e9      // $50b - going public
    };
    return minimums[round] || 0;
}

/**
 * Check if an investment offer should be accepted
 * 
 * IMPORTANT: When funds are negative (death spiral), accept ANY positive offer
 * 
 * @param {Object} offer - Investment offer from API
 * @param {number} round - Current investment round
 * @param {number} customMinimum - Override minimum (optional)
 * @param {number} currentFunds - Current corporation funds (optional, for emergency logic)
 * @returns {boolean} Whether to accept the offer
 */
export function shouldAcceptInvestment(offer, round, customMinimum = 0, currentFunds = null) {
    if (!offer || offer.funds <= 0) return false;
    
    // EMERGENCY: If funds are negative (death spiral), accept ANY investment
    if (currentFunds !== null && currentFunds < 0) {
        return true;  // Accept any offer to escape death spiral
    }
    
    const minimum = customMinimum > 0 ? customMinimum : getMinimumInvestmentOffer(round);
    return offer.funds >= minimum;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate party cost to reach target morale
 * From game source
 */
export function calculateOptimalPartyCost(currentMorale, targetMorale = 100, perfMult = 1.002) {
    const a = currentMorale;
    const b = targetMorale;
    const k = perfMult;

    const discriminant = Math.pow(a * k - 10, 2) + 40 * b;
    if (discriminant < 0) return 500000;

    const cost = 500000 * (Math.sqrt(discriminant) - a * k - 10);
    return Math.max(0, Math.min(cost, 10e6));
}

/**
 * Generate product name
 */
export function getProductName(divisionName, version) {
    return `${divisionName.substring(0, 3)}-v${version}`;
}

/**
 * Calculate upgrade costs
 */
export function getUpgradeCost(basePrice, priceMult, currentLevel, targetLevel) {
    if (targetLevel <= currentLevel) return 0;
    return basePrice * (Math.pow(priceMult, targetLevel) - Math.pow(priceMult, currentLevel)) / (priceMult - 1);
}

export function getOfficeSizeUpgradeCost(currentSize, targetSize) {
    const basePrice = 4e9;
    return basePrice * (Math.pow(1.09, targetSize / 3) - Math.pow(1.09, currentSize / 3)) / 0.09;
}

export function getWarehouseUpgradeCost(currentLevel, targetLevel) {
    const basePrice = 1e9;
    const priceMult = 1.07;
    return getUpgradeCost(basePrice, priceMult, currentLevel, targetLevel);
}

// ============================================================================
// DIAGNOSTIC HELPERS
// ============================================================================

/**
 * Diagnose why production might be zero
 * 
 * @param {Object} divData - Division data
 * @param {Object} warehouse - Warehouse data
 * @param {Object} office - Office data
 * @param {Object} materials - Materials map
 * @returns {Object} Diagnosis with issues found
 */
export function diagnoseZeroProduction(divData, warehouse, office, materials) {
    const issues = [];
    const industry = INDUSTRIES[divData.type];
    
    // Check 1: Employee distribution
    const ops = office.employeeJobs?.Operations || 0;
    const eng = office.employeeJobs?.Engineer || 0;
    const mgmt = office.employeeJobs?.Management || 0;
    
    if (ops + eng + mgmt === 0) {
        issues.push({
            severity: 'critical',
            issue: 'No production employees',
            detail: 'Need Operations, Engineer, or Management employees for production',
            fix: 'Assign employees to production roles'
        });
    }
    
    // Check 2: Morale and energy
    if (office.avgMorale < 50) {
        issues.push({
            severity: 'high',
            issue: 'Low morale',
            detail: `Morale at ${office.avgMorale.toFixed(0)}% reduces productivity`,
            fix: 'Throw parties to boost morale'
        });
    }
    
    if (office.avgEnergy < 50) {
        issues.push({
            severity: 'high',
            issue: 'Low energy',
            detail: `Energy at ${office.avgEnergy.toFixed(0)}% reduces productivity`,
            fix: 'Buy tea to restore energy'
        });
    }
    
    // Check 3: Warehouse capacity
    const utilization = warehouse.sizeUsed / warehouse.size;
    if (utilization > 0.95) {
        issues.push({
            severity: 'critical',
            issue: 'Warehouse full',
            detail: `${(utilization * 100).toFixed(1)}% utilized - no room for output`,
            fix: 'Reduce boost materials or upgrade warehouse'
        });
    }
    
    // Check 4: Input materials
    if (industry?.inputMaterials) {
        for (const [mat, ratio] of Object.entries(industry.inputMaterials)) {
            const stored = materials[mat]?.stored || 0;
            if (stored < ratio * 10) {  // Need at least 10 units worth
                issues.push({
                    severity: 'high',
                    issue: `Low ${mat}`,
                    detail: `Only ${stored.toFixed(0)} units (need ~${(ratio * 100).toFixed(0)} for production)`,
                    fix: `Buy more ${mat} or set up smart supply`
                });
            }
        }
    }
    
    // Check 5: Selling not set up
    if (industry?.outputMaterials) {
        for (const mat of industry.outputMaterials) {
            const matData = materials[mat];
            if (matData && (!matData.desiredSellPrice || matData.desiredSellPrice === '0')) {
                issues.push({
                    severity: 'medium',
                    issue: `${mat} not selling`,
                    detail: 'Output materials will accumulate and fill warehouse',
                    fix: `Set sell order for ${mat}`
                });
            }
        }
    }
    
    return {
        isHealthy: issues.length === 0,
        hasCritical: issues.some(i => i.severity === 'critical'),
        issues
    };
}

// ============================================================================
// QUALITY TRACKING & OPTIMIZATION (Post-2022 Rework)
// ============================================================================

/**
 * Find the best quality city for exporting a specific material
 * Only export from the highest-quality source to avoid dilution
 * 
 * @param {Object} materialDataByCity - { cityName: materialData } from getMaterial API
 * @returns {Object} { bestCity, bestQuality, allQualities }
 */
export function findBestQualityCity(materialDataByCity) {
    let bestCity = null;
    let bestQuality = 0;
    const allQualities = {};
    
    for (const [city, matData] of Object.entries(materialDataByCity)) {
        const quality = matData.quality || 0;
        allQualities[city] = quality;
        if (quality > bestQuality) {
            bestQuality = quality;
            bestCity = city;
        }
    }
    
    return { bestCity, bestQuality, allQualities };
}

/**
 * Check if adding a new export source would dilute quality
 * Based on weighted average formula: newQ = (destQ × destS + srcQ × amt) / (destS + amt)
 * 
 * @param {number} destQuality - Current destination quality
 * @param {number} destStored - Current destination stored amount
 * @param {number} srcQuality - Source material quality
 * @param {number} srcAmount - Amount to export
 * @returns {Object} { wouldDilute, newQuality, qualityChange }
 */
export function checkExportDilution(destQuality, destStored, srcQuality, srcAmount) {
    if (destStored === 0) {
        // Empty destination - no dilution possible
        return { wouldDilute: false, newQuality: srcQuality, qualityChange: srcQuality };
    }
    
    const newQuality = Math.max(0.1, 
        (destQuality * destStored + srcQuality * srcAmount) / (destStored + srcAmount));
    const qualityChange = newQuality - destQuality;
    
    return {
        wouldDilute: srcQuality < destQuality,
        newQuality,
        qualityChange
    };
}

/**
 * Calculate the quality threshold needed for Tobacco products
 * Products are input-capped when: avgInputQuality < sqrt(productRating)
 * 
 * @param {number} productRating - The product's base rating
 * @returns {number} Minimum input quality needed to avoid capping
 */
export function calculateQualityThreshold(productRating) {
    // effectiveRating = min(rating, avgInputQuality × sqrt(rating))
    // To be uncapped: avgInputQuality × sqrt(rating) >= rating
    // Therefore: avgInputQuality >= sqrt(rating)
    return Math.sqrt(productRating);
}

/**
 * Check if a division is ready to expand to products
 * Based on input material quality meeting the threshold
 * 
 * @param {number} avgInputQuality - Average quality of input materials
 * @param {number} targetProductRating - Expected product rating (estimate 50-100 initially)
 * @returns {Object} { isReady, currentQuality, threshold, qualityGap }
 */
export function checkProductReadiness(avgInputQuality, targetProductRating = 50) {
    const threshold = calculateQualityThreshold(targetProductRating);
    const isReady = avgInputQuality >= threshold;
    
    return {
        isReady,
        currentQuality: avgInputQuality,
        threshold,
        qualityGap: threshold - avgInputQuality,
        // How much of product rating is being utilized
        effectiveRatingPercent: isReady ? 100 : (avgInputQuality / threshold) * 100
    };
}

/**
 * Calculate optimal employee distribution for QUALITY focus
 * Engineers directly affect quality: tempQlt = Engineers/90 + ...
 * 
 * @param {number} totalEmployees - Total employees in office
 * @param {string} focus - 'quality' for material quality, 'production' for throughput, 'product' for products
 * @returns {Object} Job assignments
 */
export function calculateQualityFocusedDistribution(totalEmployees, focus = 'quality') {
    if (totalEmployees < 4) {
        // Minimum viable: prioritize Engineer for quality
        return {
            Operations: Math.min(1, Math.max(0, totalEmployees - 1)),
            Engineer: Math.min(1, totalEmployees),
            Business: Math.min(1, Math.max(0, totalEmployees - 3)),
            Management: Math.min(1, Math.max(0, totalEmployees - 2)),
            'Research & Development': 0
        };
    }

    if (focus === 'quality') {
        // Quality focus: Engineers drive quality formula (Engineers/90 term)
        // 60-70% Engineers as recommended by Oracle
        return {
            Operations: Math.floor(totalEmployees * 0.15),
            Engineer: Math.floor(totalEmployees * 0.65),
            Business: Math.floor(totalEmployees * 0.05),
            Management: Math.floor(totalEmployees * 0.10),
            'Research & Development': Math.floor(totalEmployees * 0.05)
        };
    } else if (focus === 'product') {
        // Product focus: Balance for rating development
        return {
            Operations: Math.floor(totalEmployees * 0.20),
            Engineer: Math.floor(totalEmployees * 0.35),
            Business: Math.floor(totalEmployees * 0.15),
            Management: Math.floor(totalEmployees * 0.15),
            'Research & Development': Math.floor(totalEmployees * 0.15)
        };
    } else {
        // Production focus: Operations^0.4 + Engineer^0.3 for throughput
        return {
            Operations: Math.floor(totalEmployees * 0.35),
            Engineer: Math.floor(totalEmployees * 0.25),
            Business: Math.floor(totalEmployees * 0.15),
            Management: Math.floor(totalEmployees * 0.15),
            'Research & Development': Math.floor(totalEmployees * 0.10)
        };
    }
}

/**
 * Determine if a city should be used for export vs local sales
 * Export cities need high quality; local sales cities just need throughput
 * 
 * @param {number} cityQuality - Material quality in this city
 * @param {number} bestQuality - Best quality across all cities
 * @param {number} qualityThreshold - Minimum quality needed for export
 * @returns {Object} { role, reason }
 */
export function determineCityRole(cityQuality, bestQuality, qualityThreshold = 10) {
    if (cityQuality >= bestQuality * 0.95) {
        // Within 5% of best - this is an export hub
        return { role: 'export', reason: 'Highest quality - use for exports' };
    } else if (cityQuality >= qualityThreshold) {
        // Above threshold but not best - can be secondary export
        return { role: 'secondary', reason: 'Good quality - secondary export source' };
    } else {
        // Below threshold - sell locally, don't export
        return { role: 'local', reason: 'Low quality - sell locally to avoid dilution' };
    }
}

/**
 * Calculate maximum safe export amount to maintain quality floor
 * 
 * @param {number} destQuality - Destination quality
 * @param {number} destStored - Destination stored amount
 * @param {number} srcQuality - Source quality (lower)
 * @param {number} minQuality - Minimum quality to maintain
 * @returns {number} Maximum amount that can be exported while staying above minQuality
 */
export function calculateMaxExportWithoutDilution(destQuality, destStored, srcQuality, minQuality) {
    // newQ = (destQ × destS + srcQ × amt) / (destS + amt) >= minQ
    // Solving for amt:
    // destQ × destS + srcQ × amt >= minQ × (destS + amt)
    // destQ × destS + srcQ × amt >= minQ × destS + minQ × amt
    // srcQ × amt - minQ × amt >= minQ × destS - destQ × destS
    // amt × (srcQ - minQ) >= destS × (minQ - destQ)
    // amt <= destS × (destQ - minQ) / (minQ - srcQ)  [when srcQ < minQ]
    
    if (srcQuality >= minQuality) {
        return Infinity; // No limit - source quality is above floor
    }
    if (destQuality <= minQuality) {
        return 0; // Destination already at or below floor
    }
    
    return destStored * (destQuality - minQuality) / (minQuality - srcQuality);
}
