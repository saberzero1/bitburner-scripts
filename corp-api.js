/**
 * Corporation API wrappers using temp script pattern
 * Each function executes a single corporation API call via temp script
 * 
 * Usage: import { corpApi } from './corp-api.js'
 *        await corpApi.getCorporation(ns)
 *        await corpApi.buyMaterial(ns, division, city, material, amount)
 */

import { getNsDataThroughFile } from './helpers.js'

// Helper to build temp file path for corporation commands
const corpFile = (cmd) => `/Temp/corp-${cmd}.txt`;

/**
 * Corporation API wrapper object
 * All methods are async and use temp scripts to minimize RAM
 */
export const corpApi = {
    // ==================== READ OPERATIONS (10GB each if called directly) ====================

    /** Check if player has a corporation */
    hasCorporation: async (ns) =>
        await getNsDataThroughFile(ns, 'ns.corporation.hasCorporation()', corpFile('hasCorporation')),

    /** Get corporation data */
    getCorporation: async (ns) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getCorporation()', corpFile('getCorporation')),

    /** Get division data */
    getDivision: async (ns, division) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getDivision(ns.args[0])', corpFile('getDivision'), [division]),

    /** Get office data */
    getOffice: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getOffice(ns.args[0], ns.args[1])', corpFile('getOffice'), [division, city]),

    /** Get warehouse data */
    getWarehouse: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getWarehouse(ns.args[0], ns.args[1])', corpFile('getWarehouse'), [division, city]),

    /** Check if division has warehouse in city */
    hasWarehouse: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.hasWarehouse(ns.args[0], ns.args[1])', corpFile('hasWarehouse'), [division, city]),

    /** Get material data */
    getMaterial: async (ns, division, city, material) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getMaterial(ns.args[0], ns.args[1], ns.args[2])', corpFile('getMaterial'), [division, city, material]),

    /** Get product data */
    getProduct: async (ns, division, city, product) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getProduct(ns.args[0], ns.args[1], ns.args[2])', corpFile('getProduct'), [division, city, product]),

    /** Get upgrade level */
    getUpgradeLevel: async (ns, upgrade) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getUpgradeLevel(ns.args[0])', corpFile('getUpgradeLevel'), [upgrade]),

    /** Get upgrade cost */
    getUpgradeLevelCost: async (ns, upgrade) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getUpgradeLevelCost(ns.args[0])', corpFile('getUpgradeLevelCost'), [upgrade]),

    /** Get AdVert hire count */
    getHireAdVertCount: async (ns, division) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getHireAdVertCount(ns.args[0])', corpFile('getHireAdVertCount'), [division]),

    /** Get AdVert hire cost */
    getHireAdVertCost: async (ns, division) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getHireAdVertCost(ns.args[0])', corpFile('getHireAdVertCost'), [division]),

    /** Check if corporation has unlock */
    hasUnlock: async (ns, unlock) =>
        await getNsDataThroughFile(ns, 'ns.corporation.hasUnlock(ns.args[0])', corpFile('hasUnlock'), [unlock]),

    /** Check if division has researched something */
    hasResearched: async (ns, division, research) =>
        await getNsDataThroughFile(ns, 'ns.corporation.hasResearched(ns.args[0], ns.args[1])', corpFile('hasResearched'), [division, research]),

    /** Get investment offer */
    getInvestmentOffer: async (ns) =>
        await getNsDataThroughFile(ns, 'ns.corporation.getInvestmentOffer()', corpFile('getInvestmentOffer')),

    // ==================== WRITE OPERATIONS (20GB each if called directly) ====================

    /** Create a new corporation */
    createCorporation: async (ns, name, selfFund) =>
        await getNsDataThroughFile(ns, 'ns.corporation.createCorporation(ns.args[0], ns.args[1])', corpFile('createCorporation'), [name, selfFund]),

    /** Buy tea for office */
    buyTea: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.buyTea(ns.args[0], ns.args[1])', corpFile('buyTea'), [division, city]),

    /** Throw party for office */
    throwParty: async (ns, division, city, costPerEmployee) =>
        await getNsDataThroughFile(ns, 'ns.corporation.throwParty(ns.args[0], ns.args[1], ns.args[2])', corpFile('throwParty'), [division, city, costPerEmployee]),

    /** Buy material */
    buyMaterial: async (ns, division, city, material, amount) =>
        await getNsDataThroughFile(ns, 'ns.corporation.buyMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', corpFile('buyMaterial'), [division, city, material, amount]),

    /** Sell material */
    sellMaterial: async (ns, division, city, material, amount, price) =>
        await getNsDataThroughFile(ns, 'ns.corporation.sellMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', corpFile('sellMaterial'), [division, city, material, amount, price]),

    /** Sell product */
    sellProduct: async (ns, division, city, product, amount, price, allCities) =>
        await getNsDataThroughFile(ns, 'ns.corporation.sellProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', corpFile('sellProduct'), [division, city, product, amount, price, allCities]),

    /** Expand into new industry */
    expandIndustry: async (ns, industry, divisionName) =>
        await getNsDataThroughFile(ns, 'ns.corporation.expandIndustry(ns.args[0], ns.args[1])', corpFile('expandIndustry'), [industry, divisionName]),

    /** Expand into new city */
    expandCity: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.expandCity(ns.args[0], ns.args[1])', corpFile('expandCity'), [division, city]),

    /** Purchase warehouse */
    purchaseWarehouse: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.purchaseWarehouse(ns.args[0], ns.args[1])', corpFile('purchaseWarehouse'), [division, city]),

    /** Upgrade warehouse */
    upgradeWarehouse: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.upgradeWarehouse(ns.args[0], ns.args[1])', corpFile('upgradeWarehouse'), [division, city]),

    /** Upgrade office size */
    upgradeOfficeSize: async (ns, division, city, size) =>
        await getNsDataThroughFile(ns, 'ns.corporation.upgradeOfficeSize(ns.args[0], ns.args[1], ns.args[2])', corpFile('upgradeOfficeSize'), [division, city, size]),

    /** Hire employee */
    hireEmployee: async (ns, division, city) =>
        await getNsDataThroughFile(ns, 'ns.corporation.hireEmployee(ns.args[0], ns.args[1])', corpFile('hireEmployee'), [division, city]),

    /** Set auto job assignment */
    setAutoJobAssignment: async (ns, division, city, job, amount) =>
        await getNsDataThroughFile(ns, 'ns.corporation.setAutoJobAssignment(ns.args[0], ns.args[1], ns.args[2], ns.args[3])', corpFile('setAutoJobAssignment'), [division, city, job, amount]),

    /** Level up an upgrade */
    levelUpgrade: async (ns, upgrade) =>
        await getNsDataThroughFile(ns, 'ns.corporation.levelUpgrade(ns.args[0])', corpFile('levelUpgrade'), [upgrade]),

    /** Hire AdVert */
    hireAdVert: async (ns, division) =>
        await getNsDataThroughFile(ns, 'ns.corporation.hireAdVert(ns.args[0])', corpFile('hireAdVert'), [division]),

    /** Purchase an unlock */
    purchaseUnlock: async (ns, unlock) =>
        await getNsDataThroughFile(ns, 'ns.corporation.purchaseUnlock(ns.args[0])', corpFile('purchaseUnlock'), [unlock]),

    /** Export material */
    exportMaterial: async (ns, srcDiv, srcCity, dstDiv, dstCity, material, amount) =>
        await getNsDataThroughFile(ns, 'ns.corporation.exportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4], ns.args[5])', corpFile('exportMaterial'), [srcDiv, srcCity, dstDiv, dstCity, material, amount]),

    /** Cancel export material */
    cancelExportMaterial: async (ns, srcDiv, srcCity, dstDiv, dstCity, material) =>
        await getNsDataThroughFile(ns, 'ns.corporation.cancelExportMaterial(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', corpFile('cancelExportMaterial'), [srcDiv, srcCity, dstDiv, dstCity, material]),

    /** Make a new product */
    makeProduct: async (ns, division, city, productName, designInvest, marketingInvest) =>
        await getNsDataThroughFile(ns, 'ns.corporation.makeProduct(ns.args[0], ns.args[1], ns.args[2], ns.args[3], ns.args[4])', corpFile('makeProduct'), [division, city, productName, designInvest, marketingInvest]),

    /** Discontinue a product */
    discontinueProduct: async (ns, division, product) =>
        await getNsDataThroughFile(ns, 'ns.corporation.discontinueProduct(ns.args[0], ns.args[1])', corpFile('discontinueProduct'), [division, product]),

    /** Research something */
    research: async (ns, division, researchName) =>
        await getNsDataThroughFile(ns, 'ns.corporation.research(ns.args[0], ns.args[1])', corpFile('research'), [division, researchName]),

    /** Accept investment offer */
    acceptInvestmentOffer: async (ns) =>
        await getNsDataThroughFile(ns, 'ns.corporation.acceptInvestmentOffer()', corpFile('acceptInvestmentOffer')),
};

/**
 * Batch operations helper - reduces overhead when doing multiple reads
 * Returns object with results keyed by operation name
 */
export async function corpBatchRead(ns, operations) {
    const results = {};
    // Run all read operations in parallel
    const promises = operations.map(async (op) => {
        const [name, ...args] = op;
        results[name] = await corpApi[name](ns, ...args);
    });
    await Promise.all(promises);
    return results;
}
