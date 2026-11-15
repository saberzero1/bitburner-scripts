/**
 * Corporation manager.
 *
 * Strategy follows the in-game corporation guide (Documentation > Advanced > Corporation, by catloversg) and
 * catloversg's scripts (https://github.com/catloversg/bitburner-scripts, MIT License, Copyright (c) 2023 catloversg):
 * round presets, office job ratios, boost-material optimum, export string, offer-acceptance heuristic, research
 * priorities and budget splits are ported from there. Their optimizers are not ported; this script uses the built-in
 * Smart Supply. Selling uses a custom Market-TA2 (see "Custom Market-TA2" below) once the two market-data unlocks are
 * bought (round 3+), and MP / an adaptive product price before that.
 *
 *  Round 1: Agriculture in 6 cities, 4 employees (R&D until 55 RP, then 1/1/1/1), Smart Supply, 2 AdVerts,
 *           Smart Storage/warehouse/Smart Factories, boost materials (84% of warehouse). Accept offer when it plateaus.
 *  Round 2: Export, Agriculture office 8 + AdVert 8, minimal Chemical division, Plants/Chemicals export loop,
 *           wait for 700/390 RP, boost materials, accept offer when it plateaus.
 *  Round 3+: Tobacco product division (Plants exported to it first), dummy divisions for valuation, continuous
 *           product development, Wilson/AdVert, budgeted upgrades of product and support divisions.
 *           Round 3/4: develop 1/2 products, switch to a profit setup, accept offer when it plateaus.
 *  After round 4: go public, set dividends.
 *
 * RAM: the corporation API costs 10-20 GB per function, so every call goes through small batched temp scripts
 * (each <= ~62 GB). The main script itself only uses the free functions (hasCorporation, nextUpdate, getConstants).
 * NOTE: the game charges RAM for any identifier matching an NS function name, so corporation function names only
 * appear inside the op source strings below, never as identifiers in this file.
 */
import {
    log,
    getConfiguration,
    disableLogs,
    formatMoney,
    getNsDataThroughFile,
} from "./helpers.js";

const argsSchema = [
    ["corp-name", "NoodleCorp"],
    ["self-fund", false], // Self-fund even in BN3 (outside BN3 self-funding is mandatory)
    ["round1-office-size", 4],
    ["round1-rp", 55], // Agriculture RP to wait for in round 1 before switching off R&D
    ["round2-agriculture-rp", 700],
    ["round2-chemical-rp", 390],
    ["no-dummy-divisions", false], // Dummy divisions raise valuation (offers); disable to save funds
    ["no-public", false], // Don't go public after the last investment round
    ["investment-rounds", 4], // Investment offers to accept (0-4) before going public. Each round sells shares (10/35/25/20%).
    ["dividend-rate", 0.1], // Dividend rate once public (0-1)
    ["verbose", false],
];

export function autocomplete(data) {
    data.flags(argsSchema);
    return [];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CITIES = ["Sector-12", "Aevum", "Chongqing", "New Tokyo", "Ishima", "Volhaven"];
const MAIN_CITY = "Sector-12"; // Product development city
const SUPPORT_CITIES = CITIES.filter((c) => c !== MAIN_CITY);
const BOOST_MATERIALS = ["AI Cores", "Hardware", "Real Estate", "Robots"];
const AGRI = "Agriculture";
const CHEM = "Chemical";
const TOB = "Tobacco";
const DUMMY_PREFIX = "z-";
const DUMMY_INDUSTRY = "Restaurant";
// BitNode CorporationDivisions multipliers (max divisions = 20 x this), used when getBitNodeMultipliers is
// unavailable (it needs SF5)
const DIVISION_MULTS = { 2: 0.9, 5: 0.75, 6: 0.8, 7: 0.8, 8: 0, 9: 0.8, 10: 0.9, 11: 0.9, 12: 0.5, 13: 0.4, 14: 0.8, 15: 0.4 };
const EXPORT_STRING = "(IPROD+IINV/10)*(-1)";
const JOB_NAMES = ["Operations", "Engineer", "Business", "Management", "Research & Development", "Intern"];
const STATE_FILE = "/data/corp-state.txt";
const STATIC_FILE = "/data/corp-static.txt";
const PRODUCT_PREFIX = "Tob-";

// Precalculated employee ratios (catloversg corporationOptimizer.ts)
const RATIO_SUPPORT = { Operations: 0.22, Engineer: 0.632, Business: 0, Management: 0.148 };
const RATIO_PRODUCT = {
    3: { Operations: 0.037, Engineer: 0.513, Business: 0.011, Management: 0.44 },
    4: { Operations: 0.03, Engineer: 0.531, Business: 0.003, Management: 0.436 },
    5: { Operations: 0.032, Engineer: 0.462, Business: 0.067, Management: 0.439 },
};
const RATIO_PROFIT = {
    3: { Operations: 49 / 138, Engineer: 5 / 138, Business: 51 / 138, Management: 33 / 138 },
    4: { Operations: 68 / 369, Engineer: 12 / 369, Business: 244 / 369, Management: 45 / 369 },
};

// Research priorities and RP multipliers (catloversg corporation.ts / corporationUtils.ts)
const RESEARCH_SUPPORT = [
    "Hi-Tech R&D Laboratory",
    "Overclock",
    "Sti.mu",
    "Automatic Drug Administration",
    "Go-Juice",
    "CPH4 Injections",
    "Self-Correcting Assemblers",
    "Drones",
    "Drones - Assembly",
    "Drones - Transport",
];
const RESEARCH_PRODUCT = [...RESEARCH_SUPPORT, "uPgrade: Fulcrum"];
const RESEARCH_TA = ["Market-TA.I", "Market-TA.II"];
const RESEARCH_COST_MULT = {
    "Hi-Tech R&D Laboratory": 1,
    Overclock: 5,
    "Sti.mu": 5,
    "Go-Juice": 5,
    "CPH4 Injections": 5,
    "Automatic Drug Administration": 13.5,
    "Self-Correcting Assemblers": 10,
    "Drones - Assembly": 10,
    "Drones - Transport": 10,
    "uPgrade: Fulcrum": 10,
    Drones: 50,
};

// Product division budget split (catloversg defaultBudgetRatioForProductDivision)
const PRODUCT_BUDGET = {
    rawProduction: 1 / 23,
    wilsonAdvert: 4 / 23,
    office: 8 / 23,
    employeeStats: 8 / 23,
    salesBot: 1 / 23,
    projectInsight: 1 / 23,
};
const EMPLOYEE_STAT_UPGRADES = [
    "Nuoptimal Nootropic Injector Implants",
    "Speech Processor Implants",
    "Neural Accelerators",
    "FocusWires",
];
const MARKET_UNLOCKS = ["Market Research - Demand", "Market Data - Competition"];
const UNLOCKS = ["Smart Supply", "Export", ...MARKET_UNLOCKS];
const UPGRADES = [
    "Smart Storage",
    "Smart Factories",
    "Wilson Analytics",
    "ABC SalesBots",
    "Project Insight",
    ...EMPLOYEE_STAT_UPGRADES,
];

// ─── Batched corporation ops ──────────────────────────────────────────────────
// Each op is a temp script with constant source; its payload is passed as JSON in ns.args[0].
// Generic ops take a list of [functionName, ...args] calls and return one result (or {error}) per call.

const dispatchOp = (fns) =>
    `(()=>{const c=ns.corporation;const F={${fns.map((f) => `${f}:(...a)=>c.${f}(...a)`).join(",")}};` +
    `return JSON.parse(ns.args[0]).map(([f,...a])=>{try{const r=F[f](...a);return r===undefined?true:r;}` +
    `catch(e){return {error:String(e?.message??e)};}});})()`;

const OPS = {
    // Reads (50 + 20 + 60 GB)
    snapA: `(()=>{const c=ns.corporation;const p=JSON.parse(ns.args[0]);const corp=c.getCorporation();const out={corp,offer:c.getInvestmentOffer(),divs:{}};
for(const d of corp.divisions){const div=c.getDivision(d);const o={div,offices:{},warehouses:{}};out.divs[d]=o;
if(d.startsWith(p.dummyPrefix))continue;
for(const city of div.cities){try{o.offices[city]=c.getOffice(d,city);}catch{}try{o.warehouses[city]=c.getWarehouse(d,city);}catch{}}}
return out;})()`,
    snapB: `(()=>{const c=ns.corporation;const p=JSON.parse(ns.args[0]);const out={};
for(const [d,q] of Object.entries(p.divs)){const o={materials:{},products:{}};out[d]=o;
for(const city of q.cities){o.materials[city]={};for(const m of q.materials){try{o.materials[city][m]=c.getMaterial(d,city,m);}catch{}}}
for(const name of q.products){o.products[name]={};for(const city of q.cities){try{o.products[name][city]=c.getProduct(d,city,name);}catch{}}}}
return out;})()`,
    meta: `(()=>{const c=ns.corporation;const p=JSON.parse(ns.args[0]);const t=(f)=>{try{return f();}catch{return null;}};
const out={unlocks:{},unlockCosts:{},upgrades:{},adverts:{},rd:{}};
for(const u of p.unlocks){out.unlocks[u]=t(()=>c.hasUnlock(u));out.unlockCosts[u]=t(()=>c.getUnlockCost(u));}
for(const u of p.upgrades)out.upgrades[u]=t(()=>c.getUpgradeLevel(u));
for(const [d,list] of Object.entries(p.rd)){out.adverts[d]=t(()=>c.getHireAdVertCount(d));out.rd[d]={};
for(const r of list){const has=t(()=>c.hasResearched(d,r));out.rd[d][r]={has,cost:has?0:t(()=>c.getResearchCost(d,r))};}}
return out;})()`,
    staticData: `(()=>{const c=ns.corporation;const p=JSON.parse(ns.args[0]);const out={industries:{},materials:{}};
for(const i of p.industries){try{out.industries[i]=c.getIndustryData(i);}catch{}}
for(const m of p.materials){try{out.materials[m]=c.getMaterialData(m);}catch{}}
let dm=null;try{dm=ns.getBitNodeMultipliers().CorporationDivisions;}catch{dm=p.divisionMults[ns.getResetInfo().currentNode]??1;}
out.maxDivisions=Math.floor(20*dm);return out;})()`,
    // Office growth with budgets (50 GB): [{div, city, size, budget, hire:{job:count}}]
    officeGrow: `(()=>{const c=ns.corporation;const out=[];for(const o of JSON.parse(ns.args[0])){const r={div:o.div,city:o.city,grown:0,hired:0};
try{if(o.grow>0){const cost=c.getOfficeSizeUpgradeCost(o.div,o.city,o.grow);if(cost<=o.budget){c.upgradeOfficeSize(o.div,o.city,o.grow);r.grown=o.grow;r.cost=cost;}}
for(const [job,n] of Object.entries(o.hire||{}))for(let i=0;i<n;i++){if(c.hireEmployee(o.div,o.city,job))r.hired++;else break;}}catch(e){r.error=String(e?.message??e);}out.push(r);}return out;})()`,
    // Job assignment, tea and parties (60 GB)
    jobs: dispatchOp(["setJobAssignment", "buyTea", "throwParty"]),
    // Materials (60 GB)
    supply: dispatchOp(["buyMaterial", "sellMaterial", "setSmartSupply"]),
    // Exports and product sales (60 GB)
    trade: dispatchOp(["exportMaterial", "cancelExportMaterial", "sellProduct"]),
    // Market-TA2 and Smart Supply options (60 GB)
    market: dispatchOp(["setProductMarketTA2", "setMaterialMarketTA2", "setSmartSupplyOption"]),
    // Structure (60 GB)
    build: dispatchOp(["expandIndustry", "expandCity", "purchaseWarehouse"]),
    // Unlocks, research, new products (60 GB)
    misc: dispatchOp(["purchaseUnlock", "research", "makeProduct"]),
    // Products and investment (60 GB)
    finance: dispatchOp(["discontinueProduct", "acceptInvestmentOffer", "goPublic"]),
    // Dividends and creation (40 GB)
    finance2: dispatchOp(["issueDividends", "createCorporation"]),
    // Budgeted levelling (60 GB): [{kind:"upgrade"|"advert", name|div, budget, maxLevels}]
    spend: `(()=>{const c=ns.corporation;const out=[];for(const o of JSON.parse(ns.args[0])){let budget=o.budget,n=0,spent=0;
try{for(;n<(o.maxLevels??1e9);n++){const cost=o.kind==="upgrade"?c.getUpgradeLevelCost(o.name):c.getHireAdVertCost(o.div);
if(!(cost<=budget))break;if(o.kind==="upgrade")c.levelUpgrade(o.name);else c.hireAdVert(o.div);budget-=cost;spent+=cost;}}catch(e){out.push({error:String(e?.message??e)});continue;}
out.push({n,spent});}return out;})()`,
    // Warehouse space (60 GB): greedily buy warehouse levels vs Smart Storage by space per $.
    // payload: [{budget, smartStorage, divs:{div:{city:level}}, maxWarehouseLevel?, allowSmartStorage}]
    space: `(()=>{const c=ns.corporation;return JSON.parse(ns.args[0]).map(p=>{let budget=p.budget,ss=p.smartStorage,spent=0,bought={ss:0,wh:0};
const lv=p.divs;for(let guard=0;guard<500;guard++){let best=null;
const totalLevels=Object.values(lv).reduce((s,cities)=>s+Object.values(cities).reduce((a,b)=>a+b,0),0);
if(p.allowSmartStorage){const cost=c.getUpgradeLevelCost("Smart Storage");best={kind:"ss",cost,gain:10*totalLevels/cost};}
for(const [d,cities] of Object.entries(lv)){if(p.maxWarehouseLevel&&Object.values(cities).some(l=>l>=p.maxWarehouseLevel))continue;
let cost=0;for(const city of Object.keys(cities))cost+=c.getUpgradeWarehouseCost(d,city,1);
const gain=100*(1+0.1*ss)*Object.keys(cities).length/cost;if(!best||gain>best.gain)best={kind:"wh",d,cost,gain};}
if(!best||!(best.cost<=budget))break;
if(best.kind==="ss"){c.levelUpgrade("Smart Storage");ss++;bought.ss++;}else{for(const city of Object.keys(lv[best.d])){c.upgradeWarehouse(best.d,city,1);lv[best.d][city]++;}bought.wh++;}
budget-=best.cost;spent+=best.cost;}return {spent,bought};});})()`,
};

// Custom Market-TA2 (61.6 GB). Runs between EXPORT and SALE, so the stock it reads is exactly what SALE will sell.
// Same formula as the game's Market-TA2 (Division.ts), except it never prices below MP + markup limit: when the
// item can't sell out anyway, the extra price costs no volume.
// payload: {sales, divs: {div: {adv, cities: {city: businessFactor}, mats: {name: baseMarkup}, inputs: {name: coefficient}, prods: {name: markup}}}}
OPS.price = `(()=>{const c=ns.corporation;const p=JSON.parse(ns.args[0]);const out=[];
const best=(mp,ml,pot,amt)=>mp+ml*Math.max(1,Math.sqrt(pot/amt));
const mkt=(x)=>Math.max(0.1,x.demand*(100-x.competition)/100);
for(const [d,q] of Object.entries(p.divs))for(const [city,bf] of Object.entries(q.cities)){const k=q.adv*bf*p.sales;
for(const [m,mu] of Object.entries(q.mats)){try{const x=c.getMaterial(d,city,m);const amt=x.stored/10;if(!(amt>1e-5))continue;
const v=best(x.marketPrice,x.quality/mu,(x.quality+0.001)*mkt(x)*k,amt);
c.sellMaterial(d,city,m,"MAX",v.toFixed(3));out.push({d,city,m,amt,mp:x.marketPrice,v});}catch(e){out.push({d,city,m,error:String(e?.message??e)});}}
const names=Object.keys(q.prods);if(!names.length)continue;
let mp=0;try{for(const [m,co] of Object.entries(q.inputs))mp+=co*c.getMaterial(d,city,m).marketPrice;}catch{continue;}mp*=5;
for(const n of names){try{const x=c.getProduct(d,city,n);const amt=x.stored/10;if(!(amt>1e-5))continue;const er=x.effectiveRating;
const v=best(mp,Math.max(er,0.001)/q.prods[n],0.5*Math.pow(er,0.65)*mkt(x)*k,amt);
c.sellProduct(d,city,n,"MAX",v.toFixed(3),false);out.push({d,city,n,amt,mp,v});}catch(e){out.push({d,city,n,error:String(e?.message??e)});}}}
return out;})()`;

/** Run a batched op. Returns the op's result, or null on failure. */
async function runOp(ns, name, payload) {
    try {
        return await getNsDataThroughFile(
            ns,
            OPS[name],
            `/Temp/corp-op-${name}.txt`,
            [JSON.stringify(payload ?? [])],
        );
    } catch (err) {
        log(ns, `WARNING: corp op '${name}' failed: ${err?.message ?? err}`, false, "warning");
        return null;
    }
}

/** Collects calls per op during a cycle, then runs each op once. */
class Plan {
    constructor() {
        this.calls = {};
        this.banks = {}; // op -> bank key per call (see bankBudget), parallel to calls
        this.descriptions = [];
    }
    add(op, call, description, bank = null) {
        (this.calls[op] ??= []).push(call);
        (this.banks[op] ??= []).push(bank);
        if (description) this.descriptions.push(description);
    }
    /** Debit each bank by what its calls actually spent. */
    settleBanks(st, results) {
        for (const [op, banks] of Object.entries(this.banks))
            banks.forEach((key, i) => {
                if (!key || st.bank?.[key] === undefined) return;
                const r = results[op]?.[i];
                const spent = Number(r?.spent ?? r?.cost ?? 0) || 0;
                st.bank[key] = Math.max(0, st.bank[key] - spent);
            });
    }
    async execute(ns, verbose) {
        // Order matters: structure first (finance before misc: a product must be discontinued before a new one is made), then supply/trade, then jobs.
        const order = ["build", "finance", "misc", "finance2", "officeGrow", "spend", "space", "supply", "market", "trade", "jobs"];
        const results = {};
        for (const op of order) {
            const calls = this.calls[op];
            if (!calls?.length) continue;
            results[op] = await runOp(ns, op, calls);
            if (verbose && Array.isArray(results[op]))
                results[op].forEach((r, i) => r?.error && log(ns, `  ${op} ${JSON.stringify(calls[i])}: ${r.error}`));
        }
        for (const d of this.descriptions) log(ns, d);
        return results;
    }
}

// ─── Persistent state ─────────────────────────────────────────────────────────

function loadJson(ns, file, fallback) {
    try {
        const raw = ns.read(file);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function newState() {
    return {
        offerWait: null, // {round, readyCycle, bestOffer, cyclesWaited}
        priceMult: {}, // product name -> MP multiplier (before Market-TA2)
        lastImprove: {}, // division -> cycle of last budgeted improvement
        cycle: 0,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** @param {NS} ns */
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    disableLogs(ns, ["sleep", "read", "write", "run", "getServerMoneyAvailable"]);

    const st = { ...newState(), ...loadJson(ns, STATE_FILE, {}) };
    let staticData = loadJson(ns, STATIC_FILE, null);
    let meta = null;
    let lastStatus = 0;
    let pricing = null; // custom Market-TA2 payload, rebuilt every cycle by planCycle
    const priceStats = { runs: 0, late: 0, lastWarn: 0 };

    while (true) {
        try {
            if (!ns.corporation.hasCorporation()) {
                await tryCreateCorporation(ns, options);
                await ns.sleep(10000);
                continue;
            }
            let justFinished = await ns.corporation.nextUpdate();
            if (justFinished === "EXPORT" && pricing) {
                // Prices must land before SALE. nextUpdate() reports the next state processed, so "SALE" means on time.
                await runOp(ns, "price", pricing);
                justFinished = await ns.corporation.nextUpdate();
                priceStats.runs++;
                if (justFinished !== "SALE") {
                    priceStats.late++;
                    if (Date.now() - priceStats.lastWarn > 600_000) {
                        priceStats.lastWarn = Date.now();
                        log(ns, `WARNING: Custom prices landed after SALE ${priceStats.late}/${priceStats.runs} times (they apply a cycle late; bonus time makes states fast).`);
                    }
                }
                justFinished = "SALE"; // plan this cycle either way
            }
            if (justFinished !== "SALE") continue; // Act once per cycle, right before START

            if (!staticData?.industries?.[TOB] || staticData.maxDivisions === undefined) {
                staticData = await runOp(ns, "staticData", {
                    industries: [AGRI, CHEM, TOB, DUMMY_INDUSTRY],
                    materials: ["Water", "Food", "Plants", "Chemicals", ...BOOST_MATERIALS],
                    divisionMults: DIVISION_MULTS,
                });
                if (staticData) ns.write(STATIC_FILE, JSON.stringify(staticData), "w");
                else continue;
            }

            st.cycle++;
            const snap = await takeSnapshot(ns, staticData);
            if (!snap) continue;
            if (!meta || st.cycle % 5 === 0 || st.metaDirty) {
                meta = (await fetchMeta(ns, snap)) ?? meta;
                st.metaDirty = false;
            }
            if (!meta) continue;

            const ctx = makeContext(ns, options, st, snap, meta, staticData);
            const plan = new Plan();
            planCycle(ctx, plan);
            pricing = ctx.pricing;
            const results = await plan.execute(ns, options.verbose);
            plan.settleBanks(st, results);
            if (Object.keys(plan.calls).some((op) => ["build", "misc", "spend", "space", "finance"].includes(op)))
                st.metaDirty = true;

            // Boost materials are bought "per second" so they can run into debt (no upfront cost). Stop the
            // orders right after the next PURCHASE so exactly one cycle's worth is bought.
            if (ctx.boostOrders.length) {
                while ((await ns.corporation.nextUpdate()) !== "PURCHASE");
                await runOp(ns, "supply", ctx.boostOrders.map(([d, city, m]) => ["buyMaterial", d, city, m, 0]));
            }

            ns.write(STATE_FILE, JSON.stringify(st), "w");
            ns.write("/Temp/corp-heartbeat.txt", String(Date.now()), "w"); // lets dashboard.jsx tell if the snapshot is current
            if (Date.now() - lastStatus > 60000) {
                lastStatus = Date.now();
                logStatus(ctx);
            }
        } catch (err) {
            log(ns, `WARNING: Corp cycle error: ${err?.message ?? err}`, false, "warning");
            await ns.sleep(1000);
        }
    }
}

async function tryCreateCorporation(ns, options) {
    const resetInfo = await getNsDataThroughFile(ns, "ns.getResetInfo()");
    const selfFund = resetInfo.currentNode !== 3 || options["self-fund"];
    if (selfFund && ns.getServerMoneyAvailable("home") < 150e9) return;
    const result = await runOp(ns, "finance2", [["createCorporation", options["corp-name"], selfFund]]);
    if (result?.[0] === true) {
        log(ns, `SUCCESS: Created corporation ${options["corp-name"]}`, true, "success");
        ns.write(STATE_FILE, JSON.stringify(newState()), "w");
        ns.write(STATIC_FILE, "", "w"); // a new corporation may be in a different BitNode (division limit)
    }
}

async function takeSnapshot(ns, staticData) {
    const a = await runOp(ns, "snapA", { dummyPrefix: DUMMY_PREFIX });
    if (!a) return null;
    const divs = {};
    for (const [name, d] of Object.entries(a.divs)) {
        if (name.startsWith(DUMMY_PREFIX)) continue;
        const ind = staticData.industries[d.div.type] ?? {};
        const materials = [
            ...Object.keys(ind.requiredMaterials ?? {}),
            ...(ind.producedMaterials ?? []),
            ...BOOST_MATERIALS,
        ];
        divs[name] = { cities: Object.keys(d.warehouses), materials, products: d.div.products };
    }
    const b = await runOp(ns, "snapB", { divs });
    if (!b) return null;
    for (const [name, d] of Object.entries(b)) Object.assign(a.divs[name], d);
    return a;
}

async function fetchMeta(ns, snap) {
    const rd = {};
    for (const [name, d] of Object.entries(snap.divs)) {
        if (name.startsWith(DUMMY_PREFIX)) continue;
        rd[name] = d.div.makesProducts ? [...RESEARCH_PRODUCT, ...RESEARCH_TA] : RESEARCH_SUPPORT;
    }
    return await runOp(ns, "meta", { unlocks: UNLOCKS, upgrades: UPGRADES, rd });
}

// ─── Planning ─────────────────────────────────────────────────────────────────

function makeContext(ns, options, st, snap, meta, staticData) {
    const corp = snap.corp;
    // offer.round is 1-4 while rounds remain, 5 once all 4 offers are accepted
    const round = corp.public ? 6 : snap.offer.round;
    const constants = ns.corporation.getConstants(); // 0 GB
    return {
        ns,
        options,
        st,
        snap,
        meta,
        staticData,
        corp,
        round,
        constants,
        // Round 3+: keep working capital (3 cycles of input purchases, at least $1b) out of discretionary spending.
        // Spending everything after SALE left nothing for Smart Supply at PURCHASE, which stopped production and
        // revenue for good when funds were small (found by simulating BN12-sized offers).
        funds: round >= 3 ? corp.funds - Math.max(1e9, corp.expenses * 10 * 3) - bankedFunds(st, corp.funds - Math.max(1e9, corp.expenses * 10 * 3)) : corp.funds,
        profit: corp.revenue - corp.expenses,
        boostOrders: [],
        has: (d) => corp.divisions.includes(d),
        div: (d) => snap.divs[d],
    };
}

/** Budget savings ("banks"): budgets are split into many items, and a slice smaller than its item's next level
 * buys nothing. With BN3-sized funds that never happens, but with small funds it left money idle indefinitely
 * (seen in simulation). Each bank keeps its unspent budget until it can afford something; banked money is held
 * back from other spending. Returns the total banked, after scaling banks down if funds no longer cover them. */
function bankedFunds(st, available) {
    st.bank ??= {};
    const total = Object.values(st.bank).reduce((a, b) => a + b, 0);
    if (total > 0 && total > Math.max(0, available)) {
        const k = Math.max(0, available) / total;
        for (const key of Object.keys(st.bank)) st.bank[key] *= k;
        return Math.max(0, available);
    }
    return total;
}

/** Add a fresh budget to a bank and return everything that bank holds. */
function bankBudget(ctx, key, fresh) {
    ctx.st.bank ??= {};
    ctx.st.bank[key] = (ctx.st.bank[key] ?? 0) + Math.max(0, fresh);
    return ctx.st.bank[key];
}

/** Spend from the cycle's available funds. Returns the granted amount (may be less than asked). */
function take(ctx, amount) {
    const granted = Math.max(0, Math.min(amount, ctx.funds));
    ctx.funds -= granted;
    return granted;
}

function planCycle(ctx, plan) {
    const r = ctx.round;
    ctx.pricing = buildPricing(ctx);
    planStructure(ctx, plan);
    planSales(ctx, plan);
    planSmartSupply(ctx, plan);
    planExports(ctx, plan);
    planOfficesAndJobs(ctx, plan);
    planTeaAndParties(ctx, plan);
    planProducts(ctx, plan); // before discretionary spending: new products are the main growth driver
    if (r <= 2) planEarlySpending(ctx, plan);
    else planLateSpending(ctx, plan);
    planBoostMaterials(ctx, plan);
    planResearch(ctx, plan);
    planInvestment(ctx, plan);
}

// Division layout for the current round
function wantedDivisions(ctx) {
    const list = [AGRI];
    if (ctx.round >= 3) list.push(TOB); // before Chemical, so Tobacco gets the funds first when both can't be afforded
    if (ctx.round >= 2 && !skipChemicalInRound2(ctx)) list.push(CHEM);
    return list;
}

/** Round 2 without a Chemical division. The guide's round 2 assumes the round-1 offer covers Chemical ($70b) plus
 * Export ($20b). With reduced valuations (BN12 scales them by 1.02^-level) it can't, and waiting on it would stall
 * the corp in round 2 indefinitely. Decided once, at the start of round 2, so spending can't flip the decision. */
function skipChemicalInRound2(ctx) {
    const { st } = ctx;
    if (ctx.round !== 2 || ctx.has(CHEM)) return false;
    if (st.round2AgriOnly === undefined) {
        const chemCost = ctx.staticData.industries[CHEM]?.startingCost ?? 70e9;
        const exportCost = ctx.meta.unlocks.Export ? 0 : (ctx.meta.unlockCosts.Export ?? 20e9);
        st.round2AgriOnly = ctx.funds < chemCost + exportCost;
        if (st.round2AgriOnly)
            log(ctx.ns, `Round 2: funds (${formatMoney(ctx.funds)}) can't cover Chemical + Export (${formatMoney(chemCost + exportCost)}). Running round 2 with Agriculture only.`);
    }
    return st.round2AgriOnly;
}

function planStructure(ctx, plan) {
    const { constants, meta, round } = ctx;
    // Unlocks: Smart Supply (round 1), Export (round 2)
    const unlockWanted = ["Smart Supply"];
    // Export: in round 2 only once Chemical exists (it's only for the Plants/Chemicals loop); round 3+ also feeds Tobacco
    if (round >= 3 || (round === 2 && ctx.has(CHEM))) unlockWanted.push("Export");
    // Demand and competition data make the custom Market-TA2 possible (catloversg buys them at the start of round 3)
    if (round >= 3) unlockWanted.push(...MARKET_UNLOCKS);
    for (const u of unlockWanted) {
        if (meta.unlocks[u]) continue;
        const cost = meta.unlockCosts[u] ?? Infinity;
        if (cost <= ctx.funds) {
            take(ctx, cost);
            plan.add("misc", ["purchaseUnlock", u], `Buying unlock: ${u}`);
        }
    }
    // Divisions, cities and warehouses
    const ensureDivision = (name, industry) => {
        if (!ctx.has(name)) {
            const cost = ctx.staticData.industries[industry]?.startingCost ?? Infinity;
            // Chemical after round 2 is an optional upgrade for Agriculture: only with funds to spare
            const needed = name === CHEM && round >= 3 ? cost * 2 : cost;
            if (needed <= ctx.funds) {
                take(ctx, cost);
                plan.add("build", ["expandIndustry", industry, name], `Creating division ${name} (${industry})`);
            }
            return;
        }
        const d = ctx.div(name);
        for (const city of CITIES) {
            if (!d.div.cities.includes(city)) {
                if (constants.officeInitialCost <= ctx.funds) {
                    take(ctx, constants.officeInitialCost);
                    plan.add("build", ["expandCity", name, city], `Expanding ${name} to ${city}`);
                }
            } else if (!d.warehouses[city] && !name.startsWith(DUMMY_PREFIX)) {
                if (constants.warehouseInitialCost <= ctx.funds) {
                    take(ctx, constants.warehouseInitialCost);
                    plan.add("build", ["purchaseWarehouse", name, city], `Buying warehouse for ${name} in ${city}`);
                }
            }
        }
    };
    for (const name of wantedDivisions(ctx)) ensureDivision(name, name);

    // Dummy divisions (round 3+) raise valuation: each office+warehouse adds to the 1.1^(n/12) multiplier
    if (round >= 3 && !ctx.options["no-dummy-divisions"] && ctx.has(TOB)) {
        const dummyCost =
            (ctx.staticData.industries[DUMMY_INDUSTRY]?.startingCost ?? 10e9) +
            5 * constants.officeInitialCost +
            6 * constants.warehouseInitialCost;
        const existing = ctx.corp.divisions.filter((d) => d.startsWith(DUMMY_PREFIX));
        // Finish setting up existing dummies (cities + warehouses); snapA skips their details, so use the division info
        for (const name of existing) {
            const d = ctx.snap.divs[name];
            for (const city of CITIES) {
                if (!d.div.cities.includes(city) && constants.officeInitialCost <= ctx.funds * 0.2) {
                    take(ctx, constants.officeInitialCost);
                    plan.add("build", ["expandCity", name, city]);
                }
            }
            if (d.div.cities.length === 6 && !ctx.st.dummyDone?.[name] && 6 * constants.warehouseInitialCost <= ctx.funds * 0.2) {
                take(ctx, 6 * constants.warehouseInitialCost);
                for (const city of CITIES) plan.add("build", ["purchaseWarehouse", name, city]); // no-op if it exists
                (ctx.st.dummyDone ??= {})[name] = true;
            }
        }
        // Add at most one new dummy per cycle, only with plenty of spare funds
        const maxDivisions = ctx.staticData.maxDivisions ?? 20;
        if (ctx.corp.divisions.length < maxDivisions && dummyCost * 5 <= ctx.funds) {
            for (let i = 0; i < maxDivisions; i++) {
                const name = DUMMY_PREFIX + String(i).padStart(2, "0");
                if (ctx.corp.divisions.includes(name)) continue;
                take(ctx, dummyCost);
                plan.add("build", ["expandIndustry", DUMMY_INDUSTRY, name], `Creating dummy division ${name}`);
                break;
            }
        }
    }
}

function planSales(ctx, plan) {
    for (const name of [AGRI, CHEM]) {
        const d = ctx.div(name);
        if (!d) continue;
        const produced = ctx.staticData.industries[d.div.type]?.producedMaterials ?? [];
        const hasTA2 = ctx.meta.rd[name]?.["Market-TA.II"]?.has; // support divisions don't research it, but handle it
        if (!hasTA2 && ctx.pricing?.divs[name]) continue; // custom Market-TA2 sets these prices before each SALE
        for (const city of Object.keys(d.warehouses)) {
            for (const m of produced) {
                const mat = d.materials[city]?.[m];
                if (!mat) continue;
                if (mat.desiredSellAmount !== "MAX" || mat.desiredSellPrice !== "MP")
                    plan.add("supply", ["sellMaterial", name, city, m, "MAX", "MP"]);
                if (hasTA2) plan.add("market", ["setMaterialMarketTA2", name, city, m, true]);
            }
        }
    }
}

function planSmartSupply(ctx, plan) {
    const hasSmartSupply = ctx.meta.unlocks["Smart Supply"];
    for (const name of wantedDivisions(ctx)) {
        const d = ctx.div(name);
        if (!d) continue;
        const required = Object.keys(ctx.staticData.industries[d.div.type]?.requiredMaterials ?? {});
        for (const [city, wh] of Object.entries(d.warehouses)) {
            if (hasSmartSupply) {
                if (!wh.smartSupplyEnabled) {
                    plan.add("supply", ["setSmartSupply", name, city, true]);
                    for (const m of required) plan.add("market", ["setSmartSupplyOption", name, city, m, "leftovers"]);
                }
                // Clear manual input orders left by older scripts (Smart Supply manages these)
                for (const m of required)
                    if ((d.materials[city]?.[m]?.buyAmount ?? 0) > 0 && !wh.smartSupplyEnabled)
                        plan.add("supply", ["buyMaterial", name, city, m, 0]);
                continue;
            }
            // Fallback until Smart Supply is affordable: keep ~2 cycles of consumption in stock, capped by space.
            const ind = ctx.staticData.industries[d.div.type];
            for (const m of required) {
                const mat = d.materials[city]?.[m];
                if (!mat) continue;
                const consumption = Math.max(0, -mat.productionAmount); // per second, last cycle
                const size = ctx.staticData.materials[m]?.size ?? 0.05;
                const freeSpace = wh.size - wh.sizeUsed;
                const target = Math.max(consumption * 20, (ind.requiredMaterials[m] ?? 0.5) * 20);
                const wanted = Math.max(0, Math.min(target - mat.stored, (freeSpace * 0.25) / size));
                const rate = wanted / 10;
                if (Math.abs(rate - mat.buyAmount) > 0.01) plan.add("supply", ["buyMaterial", name, city, m, rate]);
            }
        }
    }
}

function planExports(ctx, plan) {
    if (!ctx.meta.unlocks["Export"]) return;
    // Wanted routes, in priority order per source material (export routes are FIFO: Tobacco before Chemical)
    const routes = [];
    if (ctx.has(TOB)) routes.push([AGRI, TOB, "Plants"]);
    if (ctx.has(CHEM)) routes.push([AGRI, CHEM, "Plants"], [CHEM, AGRI, "Chemicals"]);
    for (const city of CITIES) {
        const bySource = {};
        for (const [from, to, m] of routes) {
            const fromWh = ctx.div(from)?.warehouses[city];
            const toWh = ctx.div(to)?.warehouses[city];
            if (!fromWh || !toWh) continue;
            (bySource[`${from}|${m}`] ??= []).push(to);
        }
        for (const [key, targets] of Object.entries(bySource)) {
            const [from, m] = key.split("|");
            const existing = (ctx.div(from).materials[city]?.[m]?.exports ?? []).filter((e) => e.city === city);
            const existingOrder = existing.map((e) => e.division);
            const correct =
                existingOrder.length === targets.length &&
                targets.every((t, i) => existingOrder[i] === t && existing[i].amount === EXPORT_STRING);
            if (correct) continue;
            for (const e of existing) plan.add("trade", ["cancelExportMaterial", from, city, e.division, city, m]);
            for (const t of targets) plan.add("trade", ["exportMaterial", from, city, t, city, m, EXPORT_STRING]);
        }
    }
}

// ─── Offices ──────────────────────────────────────────────────────────────────

/** Spread `n` employees over jobs by ratio (remainder goes to the largest-ratio job). */
function jobsByRatio(n, ratio) {
    const jobs = {};
    let assigned = 0;
    for (const job of ["Operations", "Engineer", "Business", "Management"]) {
        jobs[job] = Math.floor(n * (ratio[job] ?? 0));
        assigned += jobs[job];
    }
    const top = Object.entries(ratio).sort((a, b) => b[1] - a[1])[0][0];
    jobs[top] += n - assigned;
    return jobs;
}

/** Early-round office setups (catloversg generateOfficeSetupsForEarlyRounds). */
function earlyJobs(size, increaseBusiness = false) {
    const table = {
        1: [0, 1, 0, 0],
        2: [1, 1, 0, 0],
        3: [1, 1, 1, 0],
        4: [1, 1, 1, 1],
        5: [2, 1, 1, 1],
        6: increaseBusiness ? [2, 1, 2, 1] : [2, 1, 1, 2],
        7: increaseBusiness ? [2, 1, 2, 2] : [3, 1, 1, 2],
        8: increaseBusiness ? [3, 1, 2, 2] : [3, 1, 1, 3],
    };
    if (table[size]) {
        const [o, e, b, m] = table[size];
        return { Operations: o, Engineer: e, Business: b, Management: m };
    }
    // Offices of 9+ (e.g. from older scripts): offices this large lose energy/morale every cycle unless at
    // least 1/9 of employees are Interns, so reserve those first.
    const interns = Math.ceil(size / 9);
    return { ...jobsByRatio(size - interns, { Operations: 3 / 8, Engineer: 1 / 8, Business: 2 / 8, Management: 2 / 8 }), Intern: interns };
}

/** Target office size and job split for every office this cycle. */
function officeTargets(ctx) {
    const { round, options } = ctx;
    const targets = []; // {div, city, size, jobs}
    const rp = (d) => ctx.div(d)?.div.researchPoints ?? 0;
    const add = (div, city, size, jobsFn) => targets.push({ div, city, size, jobsFn });

    if (ctx.has(AGRI)) {
        if (round <= 2) {
            const size = round === 1 ? options["round1-office-size"] : 8;
            const rpTarget = round === 1 ? options["round1-rp"] : options["round2-agriculture-rp"];
            for (const city of CITIES)
                add(AGRI, city, size, (n) =>
                    rp(AGRI) < rpTarget ? { "Research & Development": n } : earlyJobs(n, round === 2),
                );
        } else {
            // Support division: same size everywhere (grown by budget), 20% R&D, rest by support ratio
            for (const city of CITIES) add(AGRI, city, 0, supportJobs);
        }
    }
    if (ctx.has(CHEM)) {
        if (round <= 2) {
            for (const city of CITIES)
                add(CHEM, city, 3, (n) => (rp(CHEM) < options["round2-chemical-rp"] ? { "Research & Development": n } : earlyJobs(n)));
        } else for (const city of CITIES) add(CHEM, city, 0, supportJobs);
    }
    if (ctx.has(TOB)) {
        const profitSetup = ctx.st.offerWait?.profitSetup && (round === 3 || round === 4);
        add(TOB, MAIN_CITY, 0, (n) => {
            if (profitSetup) return jobsByRatio(n, RATIO_PROFIT[round]);
            return jobsByRatio(n, RATIO_PRODUCT[Math.min(round, 5)]);
        });
        for (const city of SUPPORT_CITIES)
            add(TOB, city, 0, (n) => {
                if (round === 3) return { "Research & Development": n };
                if (round === 4 || n < 8) {
                    // One each of the four main jobs (as many as fit), the rest R&D
                    const jobs = { "Research & Development": Math.max(0, n - 4) };
                    ["Operations", "Engineer", "Business", "Management"].slice(0, n).forEach((j) => (jobs[j] = 1));
                    return jobs;
                }
                const rnd = Math.min(Math.floor(n * 0.5), n - 4);
                return { ...jobsByRatio(n - rnd, RATIO_PROFIT[4]), "Research & Development": rnd };
            });
    }
    return targets;
}

function supportJobs(n) {
    if (n < 6) return earlyJobs(n);
    const rnd = Math.min(Math.floor(n * 0.2), n - 3);
    return { ...jobsByRatio(n - rnd, RATIO_SUPPORT), "Research & Development": rnd };
}

function planOfficesAndJobs(ctx, plan) {
    for (const t of officeTargets(ctx)) {
        const office = ctx.div(t.div)?.offices[t.city];
        if (!office) continue;
        // Grow the office to its fixed early-round size (later rounds grow offices through budgets)
        let size = office.size;
        if (t.size > size) {
            const cost = officeUpgradeCost(ctx, size, t.size - size);
            if (cost > ctx.funds) continue; // try again once affordable
            take(ctx, cost);
            plan.add("officeGrow", { div: t.div, city: t.city, grow: t.size - size, budget: cost * 1.01, hire: {} });
            size = t.size;
        }
        const wanted = t.jobsFn(size);
        assignJobs(ctx, plan, t.div, t.city, office, size, wanted);
    }
}

/** Hire into empty positions and move existing employees to match `wanted` (decreases first, then increases). */
function assignJobs(ctx, plan, div, city, office, size, wanted) {
    const current = office.employeeJobs;
    const toHire = Math.max(0, size - office.numEmployees);
    // New hires go straight into the jobs that are most under target
    const hire = {};
    const deficit = (job) => (wanted[job] ?? 0) - (current[job] ?? 0) - (hire[job] ?? 0);
    for (let i = 0; i < toHire; i++) {
        const job = JOB_NAMES.reduce((best, j) => (deficit(j) > deficit(best) ? j : best), "Operations");
        hire[job] = (hire[job] ?? 0) + 1;
    }
    if (toHire > 0) plan.add("officeGrow", { div, city, grow: 0, budget: 0, hire });
    const after = { ...current };
    for (const [job, n] of Object.entries(hire)) after[job] = (after[job] ?? 0) + n;
    after.Unassigned = 0;
    const changes = JOB_NAMES.filter((j) => (wanted[j] ?? 0) !== (after[j] ?? 0));
    if (!changes.length && !(current.Unassigned > 0)) return;
    for (const j of changes.filter((j) => (wanted[j] ?? 0) < (after[j] ?? 0)))
        plan.add("jobs", ["setJobAssignment", div, city, j, wanted[j] ?? 0]);
    for (const j of changes.filter((j) => (wanted[j] ?? 0) > (after[j] ?? 0)))
        plan.add("jobs", ["setJobAssignment", div, city, j, wanted[j] ?? 0]);
}

function planTeaAndParties(ctx, plan) {
    // Only when energy/morale are below max. (catloversg buys every cycle from round 3; at ~$1m per employee per
    // cycle that is noise at BN3 scale but was the entire profit of a BN12-sized corp in simulation.)
    const everyCycle = false;
    const epsilon = 0.5;
    for (const [name, d] of Object.entries(ctx.snap.divs)) {
        if (name.startsWith(DUMMY_PREFIX)) continue;
        for (const [city, office] of Object.entries(d.offices ?? {})) {
            if (!office.numEmployees) continue;
            if (everyCycle || office.avgEnergy < office.maxEnergy - epsilon) {
                const cost = ctx.constants.teaCostPerEmployee * office.numEmployees;
                if (cost <= ctx.funds) {
                    take(ctx, cost);
                    plan.add("jobs", ["buyTea", name, city]);
                }
            }
            if (everyCycle || office.avgMorale < office.maxMorale - epsilon) {
                // Party multiplier is 1 + cost/1e7 and adds cost/1e6 morale: size it to reach max morale when
                // possible (capped), but at least the standard $500k per employee.
                const perEmployee = Math.max(500e3, Math.min(partyCostToMax(office), 5e6));
                const cost = perEmployee * office.numEmployees;
                if (cost <= ctx.funds) {
                    take(ctx, cost);
                    plan.add("jobs", ["throwParty", name, city, perEmployee]);
                }
            }
        }
    }
}

/** Per-employee party cost so that (morale + c/1e6) * (1 + c/1e7) reaches max morale. */
function partyCostToMax(office) {
    const m = office.avgMorale;
    const target = office.maxMorale;
    // (m + x/10)(1 + x/100) = target, x = c/1e5  ->  x^2/1000 + x(m/100 + 1/10) + m - target = 0
    const a = 1 / 1000;
    const b = m / 100 + 1 / 10;
    const c = m - target;
    const x = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    return Math.max(0, x * 1e5);
}

// ─── Spending ─────────────────────────────────────────────────────────────────

function warehouseLevels(ctx, div) {
    const out = {};
    for (const [city, wh] of Object.entries(ctx.div(div)?.warehouses ?? {})) out[city] = wh.level;
    return out;
}

function planEarlySpending(ctx, plan) {
    const { round, meta } = ctx;
    if (!ctx.has(AGRI) || Object.keys(ctx.div(AGRI).warehouses).length < 6) return; // finish setup first
    if (!meta.unlocks["Smart Supply"]) return; // Smart Supply comes first
    if (round === 2 && !ctx.has(CHEM) && !skipChemicalInRound2(ctx)) return; // wait for the Chemical division
    // Once the RP wait is over, stop buying upgrades: larger warehouses would raise the boost material target,
    // and re-buying boost materials would keep resetting the offer wait (catloversg upgrades once, then waits).
    const rp = (d) => ctx.div(d)?.div.researchPoints ?? 0;
    const rpReached =
        round === 1
            ? rp(AGRI) >= ctx.options["round1-rp"]
            : rp(AGRI) >= ctx.options["round2-agriculture-rp"] && (skipChemicalInRound2(ctx) || rp(CHEM) >= ctx.options["round2-chemical-rp"]);

    // AdVert: 2 in round 1, 8 in round 2
    const advertTarget = round === 1 ? 2 : 8;
    const adverts = meta.adverts[AGRI] ?? 0;
    if (adverts < advertTarget)
        plan.add("spend", { kind: "advert", div: AGRI, budget: take(ctx, ctx.funds * 0.5), maxLevels: advertTarget - adverts });

    // Chemical (round 2): exactly one warehouse upgrade
    if (round === 2 && ctx.has(CHEM)) {
        const levels = warehouseLevels(ctx, CHEM);
        if (Object.keys(levels).length === 6 && Object.values(levels).some((l) => l < 2))
            plan.add("space", { budget: take(ctx, ctx.funds * 0.2), smartStorage: meta.upgrades["Smart Storage"], divs: { [CHEM]: levels }, maxWarehouseLevel: 2, allowSmartStorage: false });
    }

    if (rpReached) return;
    // Keep a small reserve for tea/parties; the rest goes to space (Smart Storage/warehouses) and Smart Factories.
    const reserve = 1e9;
    const spare = ctx.funds - reserve;
    if (spare <= 1e9) return;
    plan.add("space", {
        budget: take(ctx, spare * 0.7),
        smartStorage: meta.upgrades["Smart Storage"],
        divs: { [AGRI]: warehouseLevels(ctx, AGRI) },
        allowSmartStorage: true,
    });
    plan.add("spend", { kind: "upgrade", name: "Smart Factories", budget: take(ctx, spare * 0.3) });
}

function planLateSpending(ctx, plan) {
    const { st, meta, round } = ctx;
    if (!ctx.has(TOB) || Object.keys(ctx.div(TOB).warehouses).length < 6) return;
    const tob = ctx.div(TOB);
    const profit = Math.max(0, ctx.profit);


    // Product division: big budgeted improvement every 5 cycles (immediately the first time)
    const since = (d) => st.cycle - (st.lastImprove[d] ?? -1e9);
    // Once, when the product division is new: give support divisions a starting budget, since their regular budgets
    // come from (still tiny) profit. catloversg round 3 gives $150b Agriculture and $30b Chemical out of ~$400b+; use
    // the same shares of whatever we have, so it also works when valuations (and so offers) are scaled down.
    if (!st.supportSeeded && ctx.funds > 1e9) {
        st.supportSeeded = true;
        st.lastImprove[AGRI] = st.lastImprove[CHEM] = st.cycle;
        const seed = Math.min(ctx.funds, 400e9);
        improveSupportDivision(ctx, plan, AGRI, take(ctx, seed * 0.375));
        if (ctx.has(CHEM)) improveSupportDivision(ctx, plan, CHEM, take(ctx, seed * 0.075));
    }

    if (since(TOB) >= 5) {
        st.lastImprove[TOB] = st.cycle;
        const budget = take(ctx, ctx.funds * 0.9);
        const mainShare = round === 3 ? 0.75 : 0.5; // offices: main office gets most of the budget
        const parts = {
            employeeStats: PRODUCT_BUDGET.employeeStats,
            salesBot: PRODUCT_BUDGET.salesBot,
            projectInsight: PRODUCT_BUDGET.projectInsight,
            smartFactories: PRODUCT_BUDGET.rawProduction / 2,
            space: PRODUCT_BUDGET.rawProduction / 2,
            wilson: PRODUCT_BUDGET.wilsonAdvert / 2,
            advert: PRODUCT_BUDGET.wilsonAdvert / 2,
            mainOffice: PRODUCT_BUDGET.office * mainShare,
            supportOffices: PRODUCT_BUDGET.office * (1 - mainShare),
        };
        const b = {};
        for (const [k, share] of Object.entries(parts)) b[k] = bankBudget(ctx, `${TOB}:${k}`, budget * share);
        for (const name of EMPLOYEE_STAT_UPGRADES) plan.add("spend", { kind: "upgrade", name, budget: b.employeeStats / 4 }, null, `${TOB}:employeeStats`);
        plan.add("spend", { kind: "upgrade", name: "ABC SalesBots", budget: b.salesBot }, null, `${TOB}:salesBot`);
        plan.add("spend", { kind: "upgrade", name: "Project Insight", budget: b.projectInsight }, null, `${TOB}:projectInsight`);
        plan.add("spend", { kind: "upgrade", name: "Smart Factories", budget: b.smartFactories }, null, `${TOB}:smartFactories`);
        plan.add("space", { budget: b.space, smartStorage: meta.upgrades["Smart Storage"], divs: { [TOB]: warehouseLevels(ctx, TOB) }, allowSmartStorage: true }, null, `${TOB}:space`);
        // Wilson first (it multiplies AdVert), then AdVert
        plan.add("spend", { kind: "upgrade", name: "Wilson Analytics", budget: b.wilson }, null, `${TOB}:wilson`);
        plan.add("spend", { kind: "advert", div: TOB, budget: b.advert }, null, `${TOB}:advert`);
        growOffice(ctx, plan, TOB, [MAIN_CITY], b.mainOffice, `${TOB}:mainOffice`);
        growOffice(ctx, plan, TOB, SUPPORT_CITIES, b.supportOffices, `${TOB}:supportOffices`);
    }

    // Support divisions: smaller budgets from profit
    const agriBudget = Math.max(0, Math.min(profit * (round <= 4 ? 0.9 : 0.99), ctx.funds * 0.09));
    if (since(AGRI) >= 10 && ctx.has(AGRI) && agriBudget > 0) {
        st.lastImprove[AGRI] = st.cycle;
        improveSupportDivision(ctx, plan, AGRI, take(ctx, agriBudget));
    }
    const chemBudget = Math.max(0, Math.min(profit * (round <= 4 ? 0.1 : 0.01), ctx.funds * 0.01));
    if (since(CHEM) >= 15 && ctx.has(CHEM) && chemBudget > 0) {
        st.lastImprove[CHEM] = st.cycle;
        improveSupportDivision(ctx, plan, CHEM, take(ctx, chemBudget));
    }
}

function improveSupportDivision(ctx, plan, div, budget) {
    // 10% warehouses, 90% offices (catloversg defaultBudgetRatioForSupportDivision), saved per part (see bankBudget)
    const space = bankBudget(ctx, `${div}:space`, budget * 0.1);
    const offices = bankBudget(ctx, `${div}:offices`, budget * 0.9);
    plan.add("space", { budget: space, smartStorage: ctx.meta.upgrades["Smart Storage"], divs: { [div]: warehouseLevels(ctx, div) }, allowSmartStorage: false }, null, `${div}:space`);
    growOffice(ctx, plan, div, CITIES, offices, `${div}:offices`);
}

/** Grow offices in `cities` using `budget`, split evenly (the op re-checks the exact cost). */
function growOffice(ctx, plan, div, cities, budget, bank = null) {
    const per = budget / cities.length;
    for (const city of cities) {
        const office = ctx.div(div)?.offices[city];
        if (!office || per <= 0) continue;
        const grow = affordableOfficeGrowth(ctx, office.size, per);
        if (grow < 3) continue;
        plan.add("officeGrow", { div, city, grow, budget: per, hire: {} }, null, bank);
    }
}

/** Office upgrade cost (Corporation/helpers.ts calculateOfficeSizeUpgradeCost). */
function officeUpgradeCost(ctx, size, increase) {
    if (increase <= 0) return 0;
    return (ctx.constants.officeInitialCost / 0.09) * 1.09 ** (size / 3) * (1.09 ** (increase / 3) - 1);
}

/** Largest office size increase (multiple of 3) affordable with `budget`: inverse of officeUpgradeCost. */
function affordableOfficeGrowth(ctx, size, budget) {
    const base = (ctx.constants.officeInitialCost / 0.09) * 1.09 ** (size / 3);
    const increase = 3 * Math.log(1 + budget / base) / Math.log(1.09);
    return Math.max(0, Math.floor(increase / 3) * 3);
}

// ─── Boost materials ──────────────────────────────────────────────────────────

/** Optimal boost material quantities for a space budget (Lagrange solution from the in-game guide). */
function optimalBoost(ind, materialSizes, space) {
    const coeff = [ind.aiCoreFactor ?? 0, ind.hardwareFactor ?? 0, ind.realEstateFactor ?? 0, ind.robotFactor ?? 0];
    const sizes = BOOST_MATERIALS.map((m) => materialSizes[m]?.size ?? [0.1, 0.06, 0.005, 0.5][BOOST_MATERIALS.indexOf(m)]);
    const solve = (c, s) => {
        const sumC = c.reduce((a, b) => a + b, 0);
        const sumS = s.reduce((a, b) => a + b, 0);
        const result = [];
        for (let i = 0; i < s.length; i++) {
            const qty = (space - 500 * ((s[i] / c[i]) * (sumC - c[i]) - (sumS - s[i]))) / (sumC / c[i]) / s[i];
            if (c[i] <= 0 || qty < 0) return solve(c.toSpliced(i, 1), s.toSpliced(i, 1)).toSpliced(i, 0, 0);
            result.push(Math.floor(qty));
        }
        return result;
    };
    return solve(coeff, sizes);
}

function planBoostMaterials(ctx, plan) {
    const { round, options } = ctx;
    for (const name of wantedDivisions(ctx)) {
        const d = ctx.div(name);
        if (!d || Object.keys(d.warehouses).length < 6) continue;
        const ind = ctx.staticData.industries[d.div.type];
        const rp = d.div.researchPoints;
        // Early rounds: only once employees are off R&D (catloversg buys boost after the RP wait)
        let ratio;
        if (round === 1) {
            if (name !== AGRI || rp < options["round1-rp"] || !ctx.meta.unlocks["Smart Supply"]) continue;
            ratio = 0.84;
        } else if (round === 2) {
            if (ctx.div(AGRI)?.div.researchPoints < options["round2-agriculture-rp"]) continue;
            if (ctx.has(CHEM) && ctx.div(CHEM).div.researchPoints < options["round2-chemical-rp"]) continue;
            ratio = name === AGRI ? 0.76 : 0.95;
        }
        for (const [city, wh] of Object.entries(d.warehouses)) {
            const mats = d.materials[city] ?? {};
            let targets;
            if (ratio) {
                targets = optimalBoost(ind, ctx.staticData.materials, wh.size * ratio);
            } else {
                // Round 3+: top up with part of the free space while keeping room for production
                const reserve = ind.makesProducts ? 0.1 : 0.2;
                const free = wh.size - wh.sizeUsed;
                if (free < wh.size * reserve) continue;
                const add = optimalBoost(ind, ctx.staticData.materials, (free - wh.size * reserve) * 0.5);
                targets = add.map((q, i) => q + (mats[BOOST_MATERIALS[i]]?.stored ?? 0));
            }
            BOOST_MATERIALS.forEach((m, i) => {
                const stored = mats[m]?.stored ?? 0;
                const deficit = targets[i] - stored;
                if (deficit > Math.max(1, targets[i] * 0.02)) {
                    const cost = deficit * (mats[m]?.marketPrice ?? 0);
                    // Early rounds: per-second orders may run into debt (small offices aren't penalised).
                    // Later: large offices lose morale while in debt, so only buy what we can pay for.
                    // Debt limit: $10b, or 20% of the current offer when valuations are scaled down
                    const debtLimit = Math.min(10e9, 0.2 * (ctx.snap.offer?.funds ?? 0));
                    if (ratio ? ctx.funds < -debtLimit && cost > 0 : cost > ctx.funds) return;
                    ctx.funds -= cost;
                    plan.add("supply", ["buyMaterial", name, city, m, deficit / 10]);
                    ctx.boostOrders.push([name, city, m]);
                } else if ((mats[m]?.buyAmount ?? 0) > 0) {
                    plan.add("supply", ["buyMaterial", name, city, m, 0]); // stale order from an older script
                }
            });
        }
    }
}

// ─── Research ─────────────────────────────────────────────────────────────────

function planResearch(ctx, plan) {
    const { round, meta } = ctx;
    if (round < 4) return; // Keep RP for quality in early rounds (catloversg buys from round 4)
    for (const [name, list] of Object.entries(meta.rd)) {
        const d = ctx.div(name);
        if (!d) continue;
        let rp = d.div.researchPoints;
        const isProduct = d.div.makesProducts;
        // Don't drain RP right before a product finishes
        if (isProduct && Object.values(d.products).some((p) => (p[MAIN_CITY]?.developmentProgress ?? 100) > 90 && p[MAIN_CITY].developmentProgress < 100))
            continue;
        const priorities = isProduct ? RESEARCH_PRODUCT : RESEARCH_SUPPORT;
        for (const r of priorities) {
            const info = list[r];
            if (!info || info.has) continue;
            if (round === 4 && r !== "Hi-Tech R&D Laboratory") break;
            const mult = isProduct ? (RESEARCH_COST_MULT[r] ?? 10) : 2;
            if (rp < info.cost * mult) break;
            rp -= info.cost;
            plan.add("misc", ["research", name, r], `Researching ${r} in ${name}`);
        }
        // Market-TA.I + II for product pricing: once RP is comfortably above their combined cost
        // (Not needed once the custom Market-TA2 runs: it uses the same formula, and the RP is better spent elsewhere.)
        if (isProduct && !list["Market-TA.II"]?.has && !MARKET_UNLOCKS.every((u) => meta.unlocks[u])) {
            const cost = RESEARCH_TA.reduce((s, r) => s + (list[r]?.has ? 0 : (list[r]?.cost ?? Infinity)), 0);
            if (rp >= cost * (round >= 5 ? 2 : 3))
                for (const r of RESEARCH_TA) if (!list[r]?.has) plan.add("misc", ["research", name, r], `Researching ${r} in ${name}`);
        }
    }
}

// ─── Custom Market-TA2 ────────────────────────────────────────────────────────
// The game's sale volume (Division.ts) is
//   min(stored/10, itemMult * marketFactor * markupMult * businessFactor * salesBots * advertFactor)
// with markupMult = (markupLimit / (price - MP))^2 above MP + markupLimit. The highest price that still sells all
// stock is MP + markupLimit * sqrt(potential / (stored/10)). Stock, quality, demand and competition are read right
// before SALE by the "price" op; the office and division factors come from this cycle's snapshot.

// How each product stat depends on the job factors accumulated while it was developed (Product.ts finishProduct).
// Columns: Engineer, Management, R&D, Operations, Business. Rows: quality, performance, durability, reliability,
// aesthetics, features. All rows share one multiplier, so the job mix can be recovered exactly from the stats.
const PRODUCT_STAT_WEIGHTS = [
    [0.1, 0.05, 0.05, 0.02, 0.02],
    [0.15, 0.02, 0.02, 0.02, 0.02],
    [0.05, 0.02, 0.08, 0.05, 0.05],
    [0.02, 0.08, 0.02, 0.05, 0.08],
    [0, 0.08, 0.05, 0.02, 0.1],
    [0.08, 0.05, 0.02, 0.05, 0.05],
];

/** Least squares solve of PRODUCT_STAT_WEIGHTS * x = statValues (normal equations, Gauss-Jordan elimination). */
function solveJobFactors(statValues) {
    const A = PRODUCT_STAT_WEIGHTS;
    const n = 5;
    const M = [];
    for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j < n; j++) row.push(A.reduce((t, r) => t + r[i] * r[j], 0));
        row.push(A.reduce((t, r, k) => t + r[i] * statValues[k], 0));
        M.push(row);
    }
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
        [M[col], M[pivot]] = [M[pivot], M[col]];
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col] / M[col][col];
            for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
        }
    }
    return M.map((r, i) => r[n] / r[i]);
}

/** A product's hidden markup (Product.ts finishProduct), from its public stats. Null if it can't be worked out. */
function productMarkup(product) {
    const st = product?.stats;
    if (!st) return null;
    const x = solveJobFactors([st.quality, st.performance, st.durability, st.reliability, st.aesthetics, st.features]);
    const total = x.reduce((a, b) => a + b, 0);
    const busMgmtRatio = (x[1] + x[4]) / total;
    if (!(busMgmtRatio > 0) || !(total > 0)) return null;
    const advMult = 1 + Math.pow(product.advertisingInvestment ?? 0, 0.1) / 100;
    const markup = 100 / (advMult * Math.pow(st.quality + 0.001, 0.65) * busMgmtRatio);
    return Number.isFinite(markup) && markup > 0 ? markup : null;
}

/** Payload for the "price" op, or null when the custom Market-TA2 can't run yet (market-data unlocks missing). */
function buildPricing(ctx) {
    const { meta, staticData } = ctx;
    if (!MARKET_UNLOCKS.every((u) => meta.unlocks[u])) return null;
    const divs = {};
    for (const name of [AGRI, CHEM, TOB]) {
        const d = ctx.div(name);
        const ind = d && staticData.industries[d.div.type];
        if (!ind) continue;
        if (meta.rd[name]?.["Market-TA.II"]?.has) continue; // the built-in one is just as good when researched
        const aw = d.div.awareness;
        const pop = d.div.popularity;
        const f = ind.advertisingFactor ?? 0;
        const ratio = aw === 0 ? 0.01 : Math.max((pop + 0.001) / aw, 0.01);
        const adv = Math.pow(Math.pow(aw + 1, f) * Math.pow(pop + 1, f) * ratio, 0.85);
        const cities = {};
        for (const city of Object.keys(d.warehouses)) {
            const office = d.offices[city];
            if (!office) continue;
            const business = 1 + (office.employeeProductionByJob?.Business ?? 0);
            cities[city] = Math.pow(business, 0.26) + business / 10e3;
        }
        const mats = {};
        for (const m of ind.producedMaterials ?? []) {
            const mu = staticData.materials[m]?.baseMarkup;
            if (mu > 0) mats[m] = mu;
        }
        const prods = {};
        if (d.div.makesProducts)
            for (const n of d.div.products) {
                const product = d.products[n]?.[MAIN_CITY];
                if (!product || product.developmentProgress < 100) continue;
                const markup = productMarkup(product);
                if (markup) prods[n] = markup;
            }
        if (!Object.keys(mats).length && !Object.keys(prods).length) continue;
        divs[name] = { adv, cities, mats, inputs: ind.requiredMaterials ?? {}, prods };
    }
    if (!Object.keys(divs).length) return null;
    return { sales: 1 + 0.01 * (meta.upgrades["ABC SalesBots"] ?? 0), divs };
}

// ─── Products ─────────────────────────────────────────────────────────────────

function productIds(names) {
    return names.map((n) => parseInt(n.slice(PRODUCT_PREFIX.length), 10)).filter((n) => Number.isFinite(n));
}

function planProducts(ctx, plan) {
    const { round, st, meta } = ctx;
    const tob = ctx.div(TOB);
    if (!tob || Object.keys(tob.warehouses).length < 6) return;
    const names = tob.div.products;
    const mainOf = (n) => tob.products[n]?.[MAIN_CITY];
    const developing = names.filter((n) => (mainOf(n)?.developmentProgress ?? 0) < 100);
    const finished = names.filter((n) => (mainOf(n)?.developmentProgress ?? 0) >= 100);
    const ids = productIds(names);
    const developedCount = ids.length ? Math.max(...ids) + 1 : 0;
    const maxForRound = round === 3 ? 1 : round === 4 ? 2 : Infinity;

    // Develop a new product when none is in progress (limited count in rounds 3/4)
    if (!developing.length && developedCount < maxForRound) {
        const budget = Math.max(1e9, Math.min(ctx.funds, ctx.corp.funds * 0.01));
        if (budget > ctx.funds) {
            // Save up for it: without this, upgrades bought from each cycle's profit never leave enough
            ctx.funds = 0;
        } else {
            if (names.length >= (tob.div.maxProducts || 3)) {
                const worst = finished.reduce((w, n) => ((mainOf(n)?.rating ?? 0) < (mainOf(w)?.rating ?? 0) ? n : w), finished[0]);
                if (worst) plan.add("finance", ["discontinueProduct", TOB, worst], `Discontinuing product ${worst}`);
            }
            take(ctx, budget);
            const name = `${PRODUCT_PREFIX}${developedCount}`;
            plan.add("misc", ["makeProduct", TOB, MAIN_CITY, name, budget / 2, budget / 2], `Developing product ${name} (${formatMoney(budget)})`);
        }
    }

    // Selling: Market-TA2 once researched, otherwise adaptive MP multiplier per product
    const hasTA2 = meta.rd[TOB]?.["Market-TA.II"]?.has;
    for (const n of finished) {
        const perCity = tob.products[n] ?? {};
        if (hasTA2) {
            const main = perCity[MAIN_CITY];
            if (main?.desiredSellPrice !== "MP" || main?.desiredSellAmount !== "MAX") {
                plan.add("trade", ["sellProduct", TOB, MAIN_CITY, n, "MAX", "MP", true]);
                plan.add("market", ["setProductMarketTA2", TOB, n, true]);
            }
            continue;
        }
        if (ctx.pricing?.divs[TOB]?.prods[n]) continue; // custom Market-TA2 prices it before each SALE
        let k = st.priceMult[n] ?? 1;
        let stored = 0;
        let produced = 0;
        for (const p of Object.values(perCity)) {
            stored += p.stored ?? 0;
            produced += Math.max(0, p.productionAmount ?? 0);
        }
        // Raise price while stock stays near empty (everything sells); lower it when stock builds up
        if (produced > 0) {
            if (stored < produced * 2) k *= 1.08;
            else if (stored > produced * 10) k *= 0.9;
        }
        k = Math.min(Math.max(k, 1), 1e6);
        st.priceMult[n] = k;
        plan.add("trade", ["sellProduct", TOB, MAIN_CITY, n, "MAX", `MP*${k.toFixed(3)}`, true]);
    }
    for (const n of Object.keys(st.priceMult)) if (!names.includes(n)) delete st.priceMult[n];
}

// ─── Investment ───────────────────────────────────────────────────────────────

/** Is the corp in its "ready to accept an offer" state for the current round? */
function readyForOffer(ctx) {
    const { round, options } = ctx;
    const rp = (d) => ctx.div(d)?.div.researchPoints ?? 0;
    const boostStocked = (d) => !ctx.boostOrders.some(([div]) => div === d) && ctx.has(d);
    if (round === 1) return rp(AGRI) >= options["round1-rp"] && ctx.meta.unlocks["Smart Supply"] && boostStocked(AGRI);
    if (round === 2) {
        const agriReady = rp(AGRI) >= options["round2-agriculture-rp"] && boostStocked(AGRI);
        if (skipChemicalInRound2(ctx)) return agriReady;
        return agriReady && rp(CHEM) >= options["round2-chemical-rp"] && boostStocked(CHEM);
    }
    if (round === 3 || round === 4) {
        const tob = ctx.div(TOB);
        if (!tob) return false;
        const ids = productIds(tob.div.products);
        const needed = round === 3 ? 1 : 2;
        const developed = ids.length ? Math.max(...ids) + 1 : 0;
        return developed >= needed && tob.div.products.every((n) => (tob.products[n]?.[MAIN_CITY]?.developmentProgress ?? 0) >= 100);
    }
    return false;
}

function planInvestment(ctx, plan) {
    const { round, st, snap, options } = ctx;
    const lastRound = Math.max(0, Math.min(4, options["investment-rounds"]));
    if (round >= 1 && round <= 5 && round > lastRound && !options["no-public"]) {
        plan.add("finance", ["goPublic", 0], "Going public");
        plan.add("finance2", ["issueDividends", options["dividend-rate"]]);
        return;
    }
    if (round > 4) return;
    if (st.offerWait && st.offerWait.round !== round) st.offerWait = null;
    if (!readyForOffer(ctx)) {
        if (st.offerWait && !st.offerWait.profitSetup) st.offerWait = null;
        return;
    }
    // catloversg waitForOffer: wait N cycles (valuation is a 10-cycle average), then accept once the offer
    // grows by less than 0.1% per cycle or after M more cycles.
    const [initCycles, extraCycles] = round === 1 ? [10, 10] : round === 2 ? [15, 10] : [10, 5];
    const offer = snap.offer.funds;
    if (!st.offerWait) {
        st.offerWait = { round, start: st.cycle, best: offer, profitSetup: round >= 3 };
        log(ctx.ns, `Round ${round}: ready, waiting for the investment offer to settle (now ${formatMoney(offer)})`);
        return;
    }
    const w = st.offerWait;
    const waited = st.cycle - w.start;
    if (waited < initCycles) return;
    const plateaued = offer < w.best * 1.001;
    w.best = Math.max(w.best, offer);
    if (plateaued || waited >= initCycles + extraCycles) {
        plan.add("finance", ["acceptInvestmentOffer"], `SUCCESS: Accepting round ${round} investment: ${formatMoney(offer)}`);
        st.offerWait = null;
    }
}

// ─── Status ───────────────────────────────────────────────────────────────────

function logStatus(ctx) {
    const { corp, snap, round } = ctx;
    const parts = [
        `Round ${round > 4 ? (corp.public ? "public" : "done") : round}`,
        `funds ${formatMoney(corp.funds)}`,
        `profit ${formatMoney(corp.revenue - corp.expenses)}/s`,
    ];
    if (round <= 4) parts.push(`offer ${formatMoney(snap.offer.funds)}`);
    for (const name of [AGRI, CHEM, TOB]) {
        const d = ctx.div(name);
        if (!d) continue;
        const offices = Object.values(d.offices);
        const energy = offices.reduce((s, o) => s + o.avgEnergy, 0) / (offices.length || 1);
        const morale = offices.reduce((s, o) => s + o.avgMorale, 0) / (offices.length || 1);
        parts.push(`${name}: RP ${Math.floor(d.div.researchPoints)}, E/M ${energy.toFixed(0)}/${morale.toFixed(0)}`);
    }
    if (ctx.st.offerWait) parts.push(`waiting for offer since cycle ${ctx.st.offerWait.start}`);
    log(ctx.ns, parts.join(" | "));
}
