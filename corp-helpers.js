/**
 * Corporation helper functions
 * Includes boost material optimization, pricing algorithms, and utility functions
 */

export const INDUSTRIES = {
    Agriculture: {
        name: 'Agriculture',
        makesProducts: false,
        inputMaterials: { Water: 0.5, Chemicals: 0.2 },
        outputMaterials: ['Plants', 'Food'],
        boostFactors: { aiCores: 0.3, hardware: 0.2, realEstate: 0.72, robots: 0.3 },
        scienceFactor: 0.5,
        advertisingFactor: 0.04
    },
    Chemical: {
        name: 'Chemical',
        makesProducts: false,
        inputMaterials: { Plants: 1, Water: 0.5 },
        outputMaterials: ['Chemicals'],
        boostFactors: { aiCores: 0.2, hardware: 0.2, realEstate: 0.25, robots: 0.25 },
        scienceFactor: 0.75,
        advertisingFactor: 0.07
    },
    Tobacco: {
        name: 'Tobacco',
        makesProducts: true,
        inputMaterials: { Plants: 1 },
        outputMaterials: [],
        boostFactors: { aiCores: 0.15, hardware: 0.15, realEstate: 0.15, robots: 0.25 },
        scienceFactor: 0.75,
        advertisingFactor: 0.2
    }
};

export const MATERIAL_SIZES = {
    'AI Cores': 0.1,
    'Hardware': 0.06,
    'Real Estate': 0.005,
    'Robots': 0.5,
    'Plants': 0.05,
    'Food': 0.03,
    'Water': 0.05,
    'Chemicals': 0.05
};

export const CITIES = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];

export function calculateOptimalBoostMaterials(industry, storageSpace) {
    const factors = INDUSTRIES[industry]?.boostFactors;
    if (!factors) return null;

    const c1 = factors.realEstate;
    const c2 = factors.hardware;
    const c3 = factors.robots;
    const c4 = factors.aiCores;

    const s1 = MATERIAL_SIZES['Real Estate'];
    const s2 = MATERIAL_SIZES['Hardware'];
    const s3 = MATERIAL_SIZES['Robots'];
    const s4 = MATERIAL_SIZES['AI Cores'];

    const totalC = c1 + c2 + c3 + c4;

    const realEstateSpace = (storageSpace - 500 * ((s1 / c1) * (c2 + c3 + c4) - (s2 + s3 + s4))) / (totalC / c1);
    const hardwareSpace = (storageSpace - 500 * ((s2 / c2) * (c1 + c3 + c4) - (s1 + s3 + s4))) / (totalC / c2);
    const robotsSpace = (storageSpace - 500 * ((s3 / c3) * (c1 + c2 + c4) - (s1 + s2 + s4))) / (totalC / c3);
    const aiCoresSpace = (storageSpace - 500 * ((s4 / c4) * (c1 + c2 + c3) - (s1 + s2 + s3))) / (totalC / c4);

    let result = {
        'Real Estate': Math.max(0, Math.floor(realEstateSpace / s1)),
        'Hardware': Math.max(0, Math.floor(hardwareSpace / s2)),
        'Robots': Math.max(0, Math.floor(robotsSpace / s3)),
        'AI Cores': Math.max(0, Math.floor(aiCoresSpace / s4))
    };

    let totalUsed = Object.entries(result).reduce((sum, [mat, qty]) => sum + qty * MATERIAL_SIZES[mat], 0);
    
    if (totalUsed > storageSpace) {
        const scale = storageSpace / totalUsed * 0.95;
        for (const mat of Object.keys(result)) {
            result[mat] = Math.floor(result[mat] * scale);
        }
    }

    return result;
}

export function calculateDivisionProductionMultiplier(boostMaterials, industry) {
    const factors = INDUSTRIES[industry]?.boostFactors;
    if (!factors) return 1;

    const realEstate = boostMaterials['Real Estate'] || 0;
    const hardware = boostMaterials['Hardware'] || 0;
    const robots = boostMaterials['Robots'] || 0;
    const aiCores = boostMaterials['AI Cores'] || 0;

    const cityMult = Math.pow(0.002 * realEstate + 1, factors.realEstate) *
                     Math.pow(0.002 * hardware + 1, factors.hardware) *
                     Math.pow(0.002 * robots + 1, factors.robots) *
                     Math.pow(0.002 * aiCores + 1, factors.aiCores);

    return Math.pow(cityMult, 0.73);
}

export function calculateOptimalPrice(ns, division, city, itemName, isProduct) {
    const corp = ns.corporation;
    
    let item, marketPrice, markupLimit, stored;
    
    if (isProduct) {
        item = corp.getProduct(division, city, itemName);
        stored = item.stored;
        marketPrice = item.productionCost;
        const effectiveRating = Math.max(item.effectiveRating, 0.001);
        const productMarkup = estimateProductMarkup(item);
        markupLimit = effectiveRating / productMarkup;
    } else {
        item = corp.getMaterial(division, city, itemName);
        stored = item.stored;
        marketPrice = item.marketPrice;
        const quality = Math.max(item.quality, 0.001);
        markupLimit = quality / 1;
    }

    const expectedSalesVolume = stored / 10;
    const potentialSalesVolume = calculatePotentialSalesVolume(ns, division, city, item, isProduct);

    if (potentialSalesVolume <= expectedSalesVolume || expectedSalesVolume === 0) {
        return marketPrice + markupLimit;
    }

    const optimalPrice = (markupLimit * Math.sqrt(potentialSalesVolume)) / Math.sqrt(expectedSalesVolume) + marketPrice;
    return Math.max(optimalPrice, marketPrice);
}

function estimateProductMarkup(product) {
    const quality = product.stats?.quality || 1;
    const businessManagementRatio = 0.2;
    const advertInvestMult = 1.01;
    return 100 / (advertInvestMult * Math.pow(quality + 0.001, 0.65) * businessManagementRatio);
}

function calculatePotentialSalesVolume(ns, division, city, item, isProduct) {
    const corp = ns.corporation;
    const divData = corp.getDivision(division);
    const office = corp.getOffice(division, city);
    
    const industry = INDUSTRIES[divData.type];
    if (!industry) return 1;

    let itemMult;
    if (isProduct) {
        itemMult = 0.5 * Math.pow(Math.max(item.effectiveRating, 0.001), 0.65);
    } else {
        itemMult = Math.max(item.quality, 0.001);
    }

    const businessProd = 1 + (office.employeeProductionByJob?.Business || 0);
    const businessFactor = Math.pow(businessProd, 0.26) + businessProd * 0.0001;

    const awareness = divData.awareness + 1;
    const popularity = divData.popularity + 1;
    const advertFactor = industry.advertisingFactor;
    
    const awarenessFactor = Math.pow(awareness, advertFactor);
    const popularityFactor = Math.pow(popularity, advertFactor);
    const ratioFactor = awareness > 1 ? Math.max(0.01, (popularity - 1 + 0.001) / (awareness - 1)) : 0.01;
    const advertMult = Math.pow(awarenessFactor * popularityFactor * ratioFactor, 0.85);

    const demand = item.demand || 50;
    const competition = item.competition || 50;
    const marketFactor = Math.max(0.1, demand * (100 - competition) * 0.01);

    return itemMult * businessFactor * advertMult * marketFactor;
}

export function calculateSmartSupplyQuantities(ns, division, city) {
    const corp = ns.corporation;
    const divData = corp.getDivision(division);
    const warehouse = corp.getWarehouse(division, city);
    const industry = INDUSTRIES[divData.type];
    
    if (!industry || !industry.inputMaterials) return {};

    const freeSpace = warehouse.size - warehouse.sizeUsed;
    const result = {};

    for (const [material, coefficient] of Object.entries(industry.inputMaterials)) {
        const currentMat = corp.getMaterial(division, city, material);
        const currentStored = currentMat.stored;
        
        const targetProduction = 100;
        const needed = targetProduction * coefficient * 10;
        const toBuy = Math.max(0, needed - currentStored);
        
        const materialSize = MATERIAL_SIZES[material] || 0.05;
        const maxCanBuy = Math.floor(freeSpace * 0.8 / materialSize);
        
        result[material] = Math.min(toBuy, maxCanBuy) / 10;
    }

    return result;
}

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

export function calculateOptimalPartyCost(currentMorale, targetMorale = 100, perfMult = 1.002) {
    const a = currentMorale;
    const b = targetMorale;
    const k = perfMult;
    
    const discriminant = Math.pow(a * k - 10, 2) + 40 * b;
    if (discriminant < 0) return 500000;
    
    const cost = 500000 * (Math.sqrt(discriminant) - a * k - 10);
    return Math.max(0, Math.min(cost, 10e6));
}

export async function waitForState(ns, targetState) {
    const corp = ns.corporation;
    const states = ['START', 'PURCHASE', 'PRODUCTION', 'EXPORT', 'SALE'];
    
    while (true) {
        const currentState = corp.getCorporation().prevState;
        if (currentState === targetState) {
            return;
        }
        await ns.sleep(100);
    }
}

export function getProductName(divisionName, version) {
    return `${divisionName.substring(0, 3)}-v${version}`;
}

export function shouldAcceptInvestment(ns, round, targetValuation) {
    const corp = ns.corporation.getCorporation();
    const offer = ns.corporation.getInvestmentOffer();
    
    if (!offer || offer.funds <= 0) return false;
    
    const minimums = {
        1: 500e9,
        2: 5e12,
        3: 500e12,
        4: 50e15
    };
    
    const minimum = minimums[round] || targetValuation;
    return offer.funds >= minimum;
}
