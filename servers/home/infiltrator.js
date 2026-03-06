import {
    log,
    getConfiguration,
    instanceCount,
    formatMoney,
    parseShortNumber,
    formatNumberShort,
    tryGetBitNodeMultipliers,
    getStocksValue,
    getNsDataThroughFile,
    getFilePath,
    waitForProcessToComplete,
    autoRetry,
} from "./helpers";

// =============================================================================
// Configuration
// =============================================================================
const argsSchema = [
    // The set of all command line arguments
    ["info", false], // get info in output_file: /Temp/infiltrator.txt
    ["boost-Faction", ""], // boost one Faction
    ["ignore-Faction", []], // ignored Faction will not boosted
    ["target", ""], // use only this target
    ["max-loop", Infinity], //15// Max Loops (Infinity = run until no faction needs rep)
    ["sleep-Between-Infiltration-Time", 20000], //5000// Sleep between Infiltration
    ["getMoney", ""], // Use this to boost Player Money
    ["stock", true], // Use Stockvalue for getMoney
    ["verbose", false], // Print Output to terminal
    ["click-sleep-time", 100],
    ["auto", false], // Auto-replay infiltrations
    ["faction", ""], // Auto-accept reputation for this faction instead of money
    ["company", ""], // Auto-navigate to this company and start infiltration
    ["quiet", false], // Suppress tprint messages
    ["no-tail", false], // Suppress opening tail windows (for dashboard integration)
    ["stop", false], // Stop running infiltration automation
    ["status", false], // Check if automation is active
];

/**
 * @param data
 * @param args
 * @returns An array of strings.
 */
export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--boost-Faction"].includes(lastFlag))
        return factions.map((f) => f.replaceAll(" ", "_"));
    if (["--ignore-Faction"].includes(lastFlag))
        return factions.map((f) => f.replaceAll(" ", "_"));
    if (["--target"].includes(lastFlag))
        return companies.map((f) => f.replaceAll(" ", "_"));
    return [];
}

// =============================================================================
// Constants
// =============================================================================
const default_priority_augs = [
        "The Red Pill",
        "The Blade's Simulacrum",
        "Neuroreceptor Management Implant",
    ],
    strNF = "NeuroFlux Governor",
    factions = [
        "Illuminati",
        "Daedalus",
        "The Covenant",
        "ECorp",
        "MegaCorp",
        "Bachman & Associates",
        "Blade Industries",
        "NWO",
        "Clarke Incorporated",
        "OmniTek Incorporated",
        "Four Sigma",
        "KuaiGong International",
        "Fulcrum Secret Technologies",
        "BitRunners",
        "The Black Hand",
        "NiteSec",
        "Aevum",
        "Chongqing",
        "Ishima",
        "New Tokyo",
        "Sector-12",
        "Volhaven",
        "Speakers for the Dead",
        "The Dark Army",
        "The Syndicate",
        "Silhouette",
        "Tetrads",
        "Slum Snakes",
        "Netburners",
        "Tian Di Hui",
        "CyberSec",
    ],
    specialFaction = [
        "Bladeburners",
        "Shadows of Anarchy",
        "Church of the Machine God",
    ],
    companies = [
        "AeroCorp",
        "Bachman & Associates",
        "Clarke Incorporated",
        "ECorp",
        "Fulcrum Technologies",
        "Galactic Cybersystems",
        "NetLink Technologies",
        "Aevum Police Headquarters",
        "Rho Construction",
        "Watchdog Security",
        "KuaiGong International",
        "Solaris Space Systems",
        "Nova Medical",
        "Omega Software",
        "Storm Technologies",
        "DefComm",
        "Global Pharmaceuticals",
        "Noodle Bar",
        "VitaLife",
        "Alpha Enterprises",
        "Blade Industries",
        "Carmichael Security",
        "DeltaOne",
        "Four Sigma",
        "Icarus Microsystems",
        "MegaCorp",
        "Universal Energy",
        "CompuTek",
        "Helios Labs",
        "LexoCorp",
        "OmniTek Incorporated",
        "Omnia Cybersystems",
        "SysCore Securities",
    ],
    output_file = "/Temp/infiltrator.txt",
    ignoreTarget = ["NWO", "Joe's Guns"];

// =============================================================================
// Global State
// =============================================================================
let wnd,
    doc,
    btnSaveGame,
    verbose,
    desiredStatsFilters = [],
    desiredAugs,
    dictFactionAugs,
    augmentationData = {},
    factionData = {},
    favorToDonate = null,
    gangFaction = null,
    player = null,
    infiltrationStack = [],
    locations = [],
    options = null,
    autoMode = false,
    repFaction = "",
    targetCompany = "",
    postTimeout = null,
    infiltrationStart = 0,
    orchestratorMode = false,
    isInfiltrating = false,
    victoryHandled = false,
    lastStageName = "",
    orchestratorRewardResolve = null,
    orchestratorRewardFaction = "";

/**
 * Cache for the game's internal InfiltrationState object.
 * Found via webpack require — used to detect and repair corrupted market state.
 */
let gameInfiltrationState = null;

/**
 * Get the game's internal InfiltrationState object via webpack.
 * InfiltrationState = { floors: number, lastChangeTimestamp: number }
 * This is the global state that tracks market demand decay.
 *
 * The module (game.ts) also exports InfiltrationStateDefault with the same shape.
 * We use Object.entries to find the exact export named "InfiltrationState".
 * Webpack preserves export names even in production builds.
 */
function getGameInfiltrationState() {
    if (gameInfiltrationState) return gameInfiltrationState;
    try {
        // Ensure webpack_require is available
        if (!globalThis.webpack_require) {
            globalThis.webpackChunkbitburner.push([
                [-1],
                {},
                (w) => (globalThis.webpack_require = w),
            ]);
        }
        const wr = globalThis.webpack_require;
        for (const key of Object.keys(wr.m)) {
            try {
                const mod = wr(key);
                if (!mod || typeof mod !== "object") continue;

                // Strategy 1: Look for the exact export name "InfiltrationState"
                // Webpack preserves named exports.
                for (const [name, exp] of Object.entries(mod)) {
                    if (
                        name === "InfiltrationState" &&
                        exp &&
                        typeof exp === "object" &&
                        typeof exp.floors === "number" &&
                        typeof exp.lastChangeTimestamp === "number"
                    ) {
                        gameInfiltrationState = exp;
                        return exp;
                    }
                }
            } catch {
                // skip modules that throw on require
            }
        }

        // Strategy 2: Fallback duck-typing — find module with 2 matching objects
        // (InfiltrationStateDefault + InfiltrationState)
        for (const key of Object.keys(wr.m)) {
            try {
                const mod = wr(key);
                if (!mod || typeof mod !== "object") continue;
                const candidates = [];
                for (const exp of Object.values(mod)) {
                    if (
                        exp &&
                        typeof exp === "object" &&
                        typeof exp.floors === "number" &&
                        typeof exp.lastChangeTimestamp === "number" &&
                        Object.keys(exp).length === 2
                    ) {
                        candidates.push(exp);
                    }
                }
                // game.ts exports exactly 2 such objects
                if (candidates.length === 2) {
                    // Pick the corrupted one, or the last one
                    const pick =
                        candidates.find(
                            (c) =>
                                c.floors !== 0 || c.lastChangeTimestamp !== 0,
                        ) || candidates[1];
                    gameInfiltrationState = pick;
                    return pick;
                }
            } catch {
                // skip modules that throw on require
            }
        }
    } catch (e) {
        console.warn("Failed to find InfiltrationState via webpack:", e);
    }
    console.warn("[infiltrator] Could NOT find InfiltrationState via webpack");
    return null;
}

/**
 * Check and repair the game's InfiltrationState if corrupted.
 * Previous bugs could set floors to Infinity via decreaseMarketDemandMultiplier
 * being called with gameStartTimestamp=-1, causing all future rewards to be 0.
 */
function repairGameMarketState() {
    const state = getGameInfiltrationState();
    if (!state) return;
    if (
        !Number.isFinite(state.floors) ||
        state.floors < 0 ||
        !Number.isFinite(state.lastChangeTimestamp) ||
        state.lastChangeTimestamp < 0
    ) {
        console.warn(
            "Detected corrupted InfiltrationState:",
            `floors=${state.floors}, lastChangeTimestamp=${state.lastChangeTimestamp}`,
            "- resetting both to 0",
        );
        state.floors = 0;
        state.lastChangeTimestamp = 0;
    }
}

// =============================================================================
// Webpack Helpers — Game Object Access
// =============================================================================

/**
 * Cached references to game internals found via webpack.
 * These are populated lazily the first time they're needed.
 */
let gamePlayer = null;
let gameFactions = null;
let gameNodeMults = null;
let gameLocationsMetadata = null;

/**
 * Ensure webpack_require is available. Called before any webpack lookup.
 */
function ensureWebpackRequire() {
    if (!globalThis.webpack_require) {
        globalThis.webpackChunkbitburner.push([
            [-1],
            {},
            (w) => (globalThis.webpack_require = w),
        ]);
    }
    return globalThis.webpack_require;
}

/**
 * Find the Player singleton via webpack.
 * Player is `export let Player: PlayerObject` in src/Player.ts.
 * We identify it by named export "Player" with setPlayer companion.
 */
function getGamePlayer() {
    if (gamePlayer) return gamePlayer;
    try {
        const wr = ensureWebpackRequire();
        for (const key of Object.keys(wr.m)) {
            try {
                const mod = wr(key);
                if (!mod || typeof mod !== "object") continue;
                for (const val of Object.values(mod)) {
                    if (
                        val &&
                        typeof val === "object" &&
                        typeof val.giveExploit === "function" &&
                        Array.isArray(val.factions) &&
                        typeof val.money === "number" &&
                        typeof val.gainMoney === "function" &&
                        typeof val.hasAugmentation === "function"
                    ) {
                        gamePlayer = val;
                        return gamePlayer;
                    }
                }
            } catch {
                // skip
            }
        }
    } catch (e) {
        console.warn("[infiltrator] Failed to find Player via webpack:", e);
    }
    console.warn("[infiltrator] Could NOT find Player via webpack");
    return null;
}

/**
 * Find the Factions record via webpack.
 * Factions is `export const Factions` in src/Faction/Factions.ts.
 * It's an object keyed by FactionName where each value has playerReputation,
 * augmentations (array), name (string), isMember (boolean).
 */
function getGameFactions() {
    if (gameFactions) return gameFactions;
    try {
        const wr = ensureWebpackRequire();
        for (const key of Object.keys(wr.m)) {
            try {
                const mod = wr(key);
                if (!mod || typeof mod !== "object") continue;
                for (const val of Object.values(mod)) {
                    if (val && typeof val === "object" && !Array.isArray(val)) {
                        const sample = val["Illuminati"] || val["CyberSec"];
                        if (
                            sample &&
                            typeof sample.playerReputation === "number" &&
                            Array.isArray(sample.augmentations) &&
                            typeof sample.name === "string" &&
                            typeof sample.isMember === "boolean"
                        ) {
                            gameFactions = val;
                            return gameFactions;
                        }
                    }
                }
            } catch {
                // skip
            }
        }
    } catch (e) {
        console.warn("[infiltrator] Failed to find Factions via webpack:", e);
    }
    console.warn("[infiltrator] Could NOT find Factions via webpack");
    return null;
}

function getGameNodeMults() {
    if (gameNodeMults) return gameNodeMults;
    try {
        const wr = ensureWebpackRequire();
        for (const key of Object.keys(wr.m)) {
            try {
                const mod = wr(key);
                if (!mod || typeof mod !== "object") continue;
                for (const val of Object.values(mod)) {
                    if (
                        val &&
                        typeof val === "object" &&
                        !Array.isArray(val) &&
                        typeof val.InfiltrationMoney === "number" &&
                        typeof val.InfiltrationRep === "number" &&
                        typeof val.HackingLevelMultiplier === "number"
                    ) {
                        gameNodeMults = val;
                        return gameNodeMults;
                    }
                }
            } catch {
                // skip
            }
        }
    } catch (e) {
        console.warn(
            "[infiltrator] Failed to find currentNodeMults via webpack:",
            e,
        );
    }
    console.warn("[infiltrator] Could NOT find currentNodeMults via webpack");
    return null;
}

function getGameLocationsMetadata() {
    if (gameLocationsMetadata) return gameLocationsMetadata;
    try {
        const wr = ensureWebpackRequire();
        for (const key of Object.keys(wr.m)) {
            try {
                const mod = wr(key);
                if (!mod || typeof mod !== "object") continue;
                for (const val of Object.values(mod)) {
                    if (Array.isArray(val) && val.length > 10) {
                        const sample = val.find(
                            (e) =>
                                e &&
                                e.infiltrationData &&
                                typeof e.infiltrationData
                                    .startingSecurityLevel === "number",
                        );
                        if (sample && typeof sample.name === "string") {
                            gameLocationsMetadata = val;
                            return gameLocationsMetadata;
                        }
                    }
                }
            } catch {
                // skip
            }
        }
    } catch (e) {
        console.warn(
            "[infiltrator] Failed to find LocationsMetadata via webpack:",
            e,
        );
    }
    console.warn("[infiltrator] Could NOT find LocationsMetadata via webpack");
    return null;
}

const DecayRate = -2e-5;
const MarketDemandFactor = 1e-3;

function inlineDecreaseMarketDemand(timestamp, floors) {
    const state = getGameInfiltrationState();
    if (!state) return;
    const currentFloors =
        state.floors *
        Math.exp(DecayRate * (timestamp - state.lastChangeTimestamp));
    state.floors = currentFloors + floors;
    state.lastChangeTimestamp = timestamp;
}

function inlineCalculateMarketDemandMultiplier(timestamp) {
    const state = getGameInfiltrationState();
    if (!state) return 1;
    const currentFloors =
        state.floors *
        Math.exp(DecayRate * (timestamp - state.lastChangeTimestamp));
    const mult = 1 - MarketDemandFactor * currentFloors * currentFloors;
    return Math.max(0, Math.min(1, mult));
}

function inlineCalculateReward(startingSecurityLevel) {
    const gPlayer = getGamePlayer();
    const intelligence = gPlayer ? gPlayer.skills?.intelligence || 0 : 0;
    const raw =
        startingSecurityLevel - Math.pow(465, 0.9) / 250 - intelligence / 1600;
    return Math.max(0, Math.min(3, Math.max(0, raw)));
}

function inlineCalculateSellCash(
    reward,
    maxLevel,
    startingSecurityLevel,
    timestamp,
) {
    const gPlayer = getGamePlayer();
    const nodeMults = getGameNodeMults();
    const levelBonus = maxLevel * Math.pow(1.01, maxLevel);
    const marketMult = inlineCalculateMarketDemandMultiplier(timestamp);
    const hasWKS =
        gPlayer && typeof gPlayer.hasAugmentation === "function"
            ? gPlayer.hasAugmentation("WKSharmonizer", true)
            : false;
    const infiltrationMoney = nodeMults ? nodeMults.InfiltrationMoney : 1;
    return (
        Math.pow(reward + 1, 2) *
        Math.pow(startingSecurityLevel, 3) *
        marketMult *
        3e3 *
        levelBonus *
        (hasWKS ? 1.5 : 1) *
        infiltrationMoney
    );
}

function inlineCalculateTradeRep(
    reward,
    maxLevel,
    startingSecurityLevel,
    timestamp,
) {
    const gPlayer = getGamePlayer();
    const nodeMults = getGameNodeMults();
    const levelBonus = maxLevel * Math.pow(1.005, maxLevel);
    const marketMult = inlineCalculateMarketDemandMultiplier(timestamp);
    let balanceMultiplier;
    if (startingSecurityLevel < 4) balanceMultiplier = 0.45;
    else if (startingSecurityLevel < 5) balanceMultiplier = 0.4;
    else if (startingSecurityLevel < 7) balanceMultiplier = 0.35;
    else if (startingSecurityLevel < 12) balanceMultiplier = 0.3;
    else if (startingSecurityLevel < 14) balanceMultiplier = 0.26;
    else if (startingSecurityLevel < 15) balanceMultiplier = 0.25;
    else balanceMultiplier = 0.2;
    const hasWKS =
        gPlayer && typeof gPlayer.hasAugmentation === "function"
            ? gPlayer.hasAugmentation("WKSharmonizer", true)
            : false;
    const infiltrationRep = nodeMults ? nodeMults.InfiltrationRep : 1;
    return (
        Math.pow(reward + 1, 1.1) *
        Math.pow(startingSecurityLevel, 1.1) *
        balanceMultiplier *
        marketMult *
        30 *
        levelBonus *
        (hasWKS ? 1.2 : 1) *
        infiltrationRep
    );
}

function inlineCalculateSoARep(
    faction,
    maxLevel,
    startingSecurityLevel,
    timestamp,
) {
    const gPlayer = getGamePlayer();
    const locMeta = getGameLocationsMetadata();
    let maxSSL = 0;
    if (locMeta) {
        for (const loc of locMeta) {
            const ssl = loc.infiltrationData?.startingSecurityLevel || 0;
            if (ssl > maxSSL) maxSSL = ssl;
        }
    }
    if (maxSSL === 0) maxSSL = 1;
    const baseRepGain = (startingSecurityLevel / maxSSL) * 5000;
    const balanceMultiplier = 0.8 + 0.05 * (maxLevel - 5);
    const marketMult = inlineCalculateMarketDemandMultiplier(timestamp);
    const hasWKS =
        gPlayer && typeof gPlayer.hasAugmentation === "function"
            ? gPlayer.hasAugmentation("WKSharmonizer", true)
            : false;
    const favor =
        faction && typeof faction.favor === "number" ? faction.favor : 0;
    return (
        baseRepGain *
        balanceMultiplier *
        marketMult *
        (hasWKS ? 2 : 1) *
        (1 + favor / 100)
    );
}

/**
 * Claim infiltration rewards directly via game internals.
 * This mirrors Victory.tsx's trade()/sell()/handleInfiltrators() functions
 * but without depending on DOM/UI elements being rendered.
 *
 * @param {object} infiltration - The Infiltration instance from fiber walk
 * @param {string} faction - Faction name to trade rep for, or empty/"none" to sell for money
 * @returns {string|null} Description of what was claimed, or null if direct claim failed
 */
function claimRewardDirect(infiltration, faction) {
    const gPlayer = getGamePlayer();
    const gFactions = getGameFactions();

    if (!gPlayer || !gFactions) {
        console.warn(
            "[claimRewardDirect] Missing game internals:",
            "player:",
            !!gPlayer,
            "factions:",
            !!gFactions,
        );
        return null; // Caller should fall back to DOM-based claiming
    }

    const reward = inlineCalculateReward(infiltration.startingSecurityLevel);
    const ts = infiltration.gameStartTimestamp;

    // 1. Handle ShadowsOfAnarchy: invite + give rep (mirrors handleInfiltrators in Victory.tsx)
    const soaName = "Shadows of Anarchy";
    const soaFaction = gFactions[soaName];
    if (soaFaction) {
        if (gPlayer.factions.includes(soaName)) {
            const soaRep = inlineCalculateSoARep(
                soaFaction,
                infiltration.maxLevel,
                infiltration.startingSecurityLevel,
                ts,
            );
            soaFaction.playerReputation += soaRep;
        }
    }

    // 2. Claim the actual reward FIRST, before decreasing market demand.
    //    In Victory.tsx, repGain is computed at render time (before any button click),
    //    while decreaseMarketDemandMultiplier is called inside quitInfiltration() (on click).
    //    We must match this order: calculate rewards THEN decrease demand.
    let description;
    if (faction && faction !== "none" && faction.length && gFactions[faction]) {
        const repGain = inlineCalculateTradeRep(
            reward,
            infiltration.maxLevel,
            infiltration.startingSecurityLevel,
            ts,
        );
        gFactions[faction].playerReputation += repGain;
        description = `Trade for ${formatNumberShort(repGain, 6, 1)} rep (${faction})`;
    } else {
        const cashGain = inlineCalculateSellCash(
            reward,
            infiltration.maxLevel,
            infiltration.startingSecurityLevel,
            ts,
        );
        gPlayer.gainMoney(cashGain, "infiltration");
        description = `Sell for ${formatMoney(cashGain)}`;
    }

    // 3. Decrease market demand AFTER calculating rewards (mirrors quitInfiltration in Victory.tsx)
    inlineDecreaseMarketDemand(ts, infiltration.maxLevel);

    // 4. Cancel the infiltration (cleans up timeouts, navigates back to city)
    try {
        infiltration.cancel();
    } catch (e) {
        console.warn("[claimRewardDirect] infiltration.cancel() threw:", e);
    }

    return description;
}

// =============================================================================
// Game Solving Engine
// =============================================================================
// Speed of the main loop interval, in milliseconds
const speed = 50;

/**
 * Find the Infiltration model instance through React's internal fiber tree.
 * Uses a multi-strategy approach for reliability:
 *
 *   Strategy 1 (Bottom-Up): Find a known infiltration DOM element, get its
 *                           fiber, walk UP via fiber.return to find props
 *                           containing the Infiltration instance.
 *
 *   Strategy 2 (Top-Down):  Walk the full fiber tree from the root downward
 *                           searching all fibers' memoizedProps, stateNode,
 *                           and hook state chains.
 *
 * The game's InfiltrationRoot.tsx reads Player.infiltration and passes it
 * as `state` prop to stage components: <StageComponent state={state} stage={state.stage} />
 *
 * Returns the Infiltration instance, or null if not currently infiltrating.
 */
function getInfiltrationState() {
    try {
        const infil = findInfiltrationBottomUp();
        if (infil) return infil;
        return findInfiltrationTopDown();
    } catch {
        return null;
    }
}

/**
 * Strategy 1: Bottom-up fiber walk.
 * Find DOM elements unique to the infiltration UI, get their React fiber,
 * then walk UP through fiber.return to find the Infiltration instance
 * in a parent fiber's memoizedProps.
 */
function findInfiltrationBottomUp() {
    const selectors = [
        "button",
        'div[class*="MuiPaper"]',
        'div[class*="MuiContainer"]',
    ];

    for (const selector of selectors) {
        const elements = doc.querySelectorAll(selector);
        for (const el of elements) {
            const fiber = getReactFiber(el);
            if (!fiber) continue;

            const infil = walkFiberUp(fiber);
            if (infil) return infil;
        }
    }

    return null;
}

/**
 * Strategy 2: Top-down fiber tree walk from the React root.
 * Searches the entire fiber tree using iterative DFS (avoids stack overflow).
 */
function findInfiltrationTopDown() {
    const root = doc.getElementById("root");
    if (!root) return null;

    const fiberKey = Object.keys(root).find((k) =>
        k.startsWith("__reactFiber$"),
    );
    if (!fiberKey) return null;

    const rootFiber = root[fiberKey];
    if (!rootFiber) return null;

    const stack = [rootFiber];
    const visited = new WeakSet();

    while (stack.length > 0) {
        const fiber = stack.pop();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);

        const infil = extractInfiltrationFromFiber(fiber);
        if (infil) return infil;

        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
    }

    return null;
}

/**
 * Get the React fiber attached to a DOM element.
 */
function getReactFiber(element) {
    if (!element) return null;
    const key = Object.keys(element).find(
        (k) =>
            k.startsWith("__reactFiber$") ||
            k.startsWith("__reactInternalInstance$"),
    );
    return key ? element[key] : null;
}

/**
 * Walk UP the fiber tree from a starting fiber, checking each fiber's
 * memoizedProps for the Infiltration instance. This is the most reliable
 * path since InfiltrationRoot passes `state={Player.infiltration}` as a
 * prop to its child stage components.
 */
function walkFiberUp(fiber) {
    let current = fiber;
    let steps = 0;
    while (current && steps < 100) {
        const infil = extractInfiltrationFromFiber(current);
        if (infil) return infil;
        current = current.return;
        steps++;
    }
    return null;
}

/**
 * Extract the Infiltration instance from a single fiber node.
 * Checks memoizedProps, stateNode, and the hook state chain.
 */
function extractInfiltrationFromFiber(fiber) {
    if (!fiber) return null;

    try {
        const props = fiber.memoizedProps;
        if (props && typeof props === "object") {
            const infil = extractInfiltration(props);
            if (infil) return infil;
        }
    } catch {
        /* ignore */
    }

    try {
        const sn = fiber.stateNode;
        if (
            sn &&
            typeof sn === "object" &&
            sn !== doc &&
            !(sn instanceof wnd.HTMLElement)
        ) {
            const infil = extractInfiltration(sn);
            if (infil) return infil;
            if (sn.state) {
                const infil2 = extractInfiltration(sn.state);
                if (infil2) return infil2;
            }
            if (sn.props) {
                const infil3 = extractInfiltration(sn.props);
                if (infil3) return infil3;
            }
        }
    } catch {
        /* ignore */
    }

    try {
        let hookState = fiber.memoizedState;
        let hookCount = 0;
        while (hookState && hookCount < 20) {
            if (hookState.queue && hookState.queue.lastRenderedState) {
                const infil = extractInfiltration(
                    hookState.queue.lastRenderedState,
                );
                if (infil) return infil;
            }
            if (
                hookState.memoizedState &&
                typeof hookState.memoizedState === "object"
            ) {
                const infil = extractInfiltration(hookState.memoizedState);
                if (infil) return infil;
            }
            hookState = hookState.next;
            hookCount++;
        }
    } catch {
        /* ignore */
    }

    return null;
}

/**
 * Given an object, determine if it IS or CONTAINS the Infiltration instance.
 * The Infiltration class has distinctive properties: stage, level, maxLevel,
 * onSuccess, onFailure, results, location, startingSecurityLevel, gameIds.
 */
function extractInfiltration(obj) {
    if (!obj || typeof obj !== "object") return null;

    if (isInfiltrationInstance(obj)) return obj;

    for (const key of ["state", "infiltration", "props", "children"]) {
        try {
            const val = obj[key];
            if (val && typeof val === "object" && isInfiltrationInstance(val)) {
                return val;
            }
        } catch {
            /* ignore getter errors */
        }
    }

    return null;
}

/**
 * Duck-type check for the Infiltration class instance.
 * Matches the signature of the Infiltration class from Infiltration.ts.
 */
function isInfiltrationInstance(obj) {
    return (
        obj &&
        typeof obj === "object" &&
        typeof obj.onSuccess === "function" &&
        typeof obj.onFailure === "function" &&
        typeof obj.level === "number" &&
        typeof obj.maxLevel === "number" &&
        obj.stage !== undefined &&
        typeof obj.results === "string"
    );
}

/**
 * Identify the current stage type via duck-typing.
 * Class names are minified in the production webpack build (e.g. "r" instead
 * of "IntroModel"), so we cannot rely on constructor.name. Instead, we detect
 * each model by its distinctive runtime properties.
 */
function identifyStage(stage, infiltration) {
    if (!stage || typeof stage !== "object") return "unknown";

    // --- Game models (have unique property signatures) ---

    // BackwardModel: has "answer" (string) + "guess" (string)
    if (typeof stage.answer === "string" && typeof stage.guess === "string") {
        return "BackwardModel";
    }

    // BracketModel: has "left" (string) + "right" (string)
    if (typeof stage.left === "string" && typeof stage.right === "string") {
        return "BracketModel";
    }

    // BribeModel: has "choices" (array) + "correctIndex" (number)
    if (
        Array.isArray(stage.choices) &&
        typeof stage.correctIndex === "number"
    ) {
        return "BribeModel";
    }

    // CheatCodeModel: has "code" (array) + "index" (number) — but NOT "choices"
    if (Array.isArray(stage.code) && typeof stage.index === "number") {
        return "CheatCodeModel";
    }

    // Cyberpunk2077Model: has "grid" (2d array) + "answers" (array) + "currentAnswerIndex"
    if (
        Array.isArray(stage.grid) &&
        Array.isArray(stage.answers) &&
        "currentAnswerIndex" in stage
    ) {
        return "Cyberpunk2077Model";
    }

    // MinesweeperModel: has "minefield" (2d array) + "memoryPhase" (boolean)
    if (
        Array.isArray(stage.minefield) &&
        typeof stage.memoryPhase === "boolean"
    ) {
        return "MinesweeperModel";
    }

    // SlashModel: has "phase" (number) + "guardingTime" (number)
    if (
        typeof stage.phase === "number" &&
        typeof stage.guardingTime === "number"
    ) {
        return "SlashModel";
    }

    // WireCuttingModel: has "wires" (array) + "wiresToCut" (Set) + "cutWires" (array)
    if (
        Array.isArray(stage.wires) &&
        stage.wiresToCut instanceof Set &&
        Array.isArray(stage.cutWires)
    ) {
        return "WireCuttingModel";
    }

    // --- Non-game models (sparse, use infiltration state to distinguish) ---

    // CountdownModel: has "count" (number) property
    if (typeof stage.count === "number") {
        return "CountdownModel";
    }

    // IntroModel vs VictoryModel: both are empty objects with only onKey().
    // Distinguish by infiltration state:
    //   - VictoryModel: created after all stages complete (results.length >= maxLevel)
    //   - IntroModel: created at start (results is empty, gameStartTimestamp is -1)
    if (infiltration) {
        if (
            infiltration.results &&
            infiltration.results.length >= infiltration.maxLevel
        ) {
            return "VictoryModel";
        }
        if (
            infiltration.gameStartTimestamp === -1 ||
            infiltration.results === ""
        ) {
            return "IntroModel";
        }
    }

    return "unknown";
}

/**
 * Instantly win the current mini-game by calling onSuccess() on the
 * Infiltration model. Returns true if successful.
 */
function winGame(infiltration) {
    try {
        if (!infiltration || !infiltration.stage) return false;

        const stageName = identifyStage(infiltration.stage, infiltration);
        if (
            stageName === "IntroModel" ||
            stageName === "CountdownModel" ||
            stageName === "VictoryModel"
        ) {
            return false;
        }

        // Before calling onSuccess(), ensure gameStartTimestamp is valid.
        // If this is the last level, onSuccess() creates VictoryModel, which
        // React renders synchronously — calling decreaseMarketDemandMultiplier
        // with gameStartTimestamp. If it's -1, that corrupts InfiltrationState.
        if (infiltration.gameStartTimestamp === -1) {
            infiltration.gameStartTimestamp = Date.now();
        }

        infiltration.onSuccess();
        return true;
    } catch {
        return false;
    }
}

const fallbackSolvers = {
    BackwardModel(stage) {
        const nextCharIndex = stage.guess.length;
        if (nextCharIndex < stage.answer.length) {
            sendKey(stage, stage.answer[nextCharIndex]);
        }
    },
    BracketModel(stage) {
        const closingMap = { "[": "]", "<": ">", "(": ")", "{": "}" };
        const nextIndex = stage.right.length;
        const openBracket = stage.left[stage.left.length - 1 - nextIndex];
        if (openBracket && closingMap[openBracket]) {
            sendKey(stage, closingMap[openBracket]);
        }
    },
    BribeModel(stage) {
        if (stage.index === stage.correctIndex) {
            sendKey(stage, " ");
        } else if (stage.index < stage.correctIndex) {
            sendKey(stage, "ArrowUp");
        } else {
            sendKey(stage, "ArrowDown");
        }
    },
    CheatCodeModel(stage) {
        const arrowToKey = {
            "↑": "ArrowUp",
            "↓": "ArrowDown",
            "←": "ArrowLeft",
            "→": "ArrowRight",
        };
        if (stage.index < stage.code.length) {
            const arrow = stage.code[stage.index];
            const key = arrowToKey[arrow];
            if (key) sendKey(stage, key);
        }
    },
    Cyberpunk2077Model(stage) {
        const targetSymbol = stage.answers[stage.currentAnswerIndex];
        if (!targetSymbol) return;

        let targetX = -1;
        let targetY = -1;
        for (let y = 0; y < stage.grid.length; y++) {
            for (let x = 0; x < stage.grid[y].length; x++) {
                if (stage.grid[y][x] === targetSymbol) {
                    targetX = x;
                    targetY = y;
                    break;
                }
            }
            if (targetX >= 0) break;
        }

        if (targetX < 0) return;

        if (stage.y < targetY) {
            sendKey(stage, "ArrowDown");
        } else if (stage.y > targetY) {
            sendKey(stage, "ArrowUp");
        } else if (stage.x < targetX) {
            sendKey(stage, "ArrowRight");
        } else if (stage.x > targetX) {
            sendKey(stage, "ArrowLeft");
        } else {
            sendKey(stage, " ");
        }
    },
    MinesweeperModel(stage) {
        if (stage.memoryPhase) return;

        let targetX = -1;
        let targetY = -1;
        for (let y = 0; y < stage.minefield.length; y++) {
            for (let x = 0; x < stage.minefield[y].length; x++) {
                if (stage.minefield[y][x] && !stage.answer[y][x]) {
                    targetX = x;
                    targetY = y;
                    break;
                }
            }
            if (targetX >= 0) break;
        }

        if (targetX < 0) return;

        if (stage.y < targetY) {
            sendKey(stage, "ArrowDown");
        } else if (stage.y > targetY) {
            sendKey(stage, "ArrowUp");
        } else if (stage.x < targetX) {
            sendKey(stage, "ArrowRight");
        } else if (stage.x > targetX) {
            sendKey(stage, "ArrowLeft");
        } else {
            sendKey(stage, " ");
        }
    },
    SlashModel(stage) {
        if (stage.phase === 1) {
            sendKey(stage, " ");
        }
    },
    WireCuttingModel(stage) {
        for (const wireIndex of stage.wiresToCut) {
            if (!stage.cutWires[wireIndex]) {
                sendKey(stage, String(wireIndex + 1));
                return;
            }
        }
    },
};

/**
 * Attempt to solve the current minigame using the fallback solver.
 * Returns true if a solver was found and executed.
 */
function solveGame(infiltration) {
    try {
        if (!infiltration || !infiltration.stage) return false;

        const stageName = identifyStage(infiltration.stage, infiltration);
        const solver = fallbackSolvers[stageName];

        if (solver) {
            solver(infiltration.stage);
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Dispatch a synthetic keyboard event on the document.
 * The wrapEventListeners() shim ensures isTrusted appears true to the game's
 * anti-automation check in InfiltrationRoot.tsx.
 */
function pressKey(keyOrCode) {
    let key = "";
    let keyCode = 0;

    if (typeof keyOrCode === "string") {
        key = keyOrCode;
        if (key.length === 1) {
            keyCode = key.toLowerCase().charCodeAt(0);
        }
    } else if (typeof keyOrCode === "number") {
        keyCode = keyOrCode;
        key = String.fromCharCode(keyCode);
    }

    if (!key) return;

    doc.dispatchEvent(
        new KeyboardEvent("keydown", {
            key,
            keyCode,
            code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
            bubbles: true,
        }),
    );
}

/**
 * Send a key directly to a stage's onKey() method, bypassing the DOM event
 * system entirely. This avoids InfiltrationRoot's isTrusted check which blocks
 * synthetic KeyboardEvents dispatched via document.dispatchEvent().
 * The stage.onKey() expects a KeyboardLikeEvent: { key, altKey, ctrlKey, metaKey, shiftKey, preventDefault? }
 */
function sendKey(stage, key) {
    if (!stage || typeof stage.onKey !== "function") return;
    stage.onKey({
        key: key,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: () => {},
    });
}

/**
 * Find the first button matching text content.
 */
function findButton(text) {
    return Array.from(doc.querySelectorAll("button")).find(
        (x) => x.innerText.indexOf(text) >= 0,
    );
}

/**
 * Click a button via its React fiber onClick handler (bypasses isTrusted checks).
 */
function clickButton(btn) {
    const reactKey = Object.keys(btn).find(
        (k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"),
    );
    if (reactKey && btn[reactKey] && btn[reactKey].onClick) {
        btn[reactKey].onClick({ isTrusted: true });
    } else {
        btn.click();
    }
}

/** Tracks whether we've detected an active infiltration this session */
/** Tracks the last known stage name to detect transitions */
function infLoop() {
    const infiltration = getInfiltrationState();

    if (!infiltration) {
        if (isInfiltrating) {
            console.log(
                "[infLoop] Lost infiltration state — was infiltrating, now not.",
            );
            isInfiltrating = false;
            victoryHandled = false;
            lastStageName = "";
            if (autoMode && !orchestratorMode) {
                selectCompany();
            }
        }
        return;
    }

    const stage = infiltration.stage;
    if (!stage) return;

    const stageName = identifyStage(stage, infiltration);

    if (stageName !== lastStageName) {
        lastStageName = stageName;
    }

    if (stageName === "IntroModel") {
        victoryHandled = false;
        if (!isInfiltrating) {
            isInfiltrating = true;
            infiltrationStart = Date.now();
            console.log(
                `[infLoop] Starting infiltration: ${infiltration.location?.name || "unknown"}`,
            );
        }
        try {
            infiltration.startInfiltration();
        } catch (e) {
            console.warn("startInfiltration() threw:", e);
            const btnStart = findButton("Start");
            if (btnStart) clickButton(btnStart);
        }
        // Defensive fix: if startInfiltration() didn't set the timestamp
        // (or button click fallback was used), set it manually to prevent
        // the Infinity corruption in decreaseMarketDemandMultiplier.
        if (infiltration.gameStartTimestamp === -1) {
            console.warn(
                "gameStartTimestamp still -1 after startInfiltration — setting manually",
            );
            infiltration.gameStartTimestamp = Date.now();
        }
        return;
    }

    if (stageName === "CountdownModel") {
        if (!infiltrationStart) infiltrationStart = Date.now();
        isInfiltrating = true;
        return;
    }

    if (stageName === "VictoryModel") {
        if (victoryHandled) return;
        victoryHandled = true;
        const infState = getGameInfiltrationState();
        console.log(
            `[infLoop] VictoryModel: ${infiltration.level}/${infiltration.maxLevel} ✓`,
        );
        // Defensive fix: ensure timestamp is valid before Victory screen
        // calculates rewards via calculateMarketDemandMultiplier(gameStartTimestamp).
        // If timestamp is -1, the formula produces Infinity floors → multiplier=0 → rewards=0,
        // AND corrupts InfiltrationState.floors permanently.
        if (infiltration.gameStartTimestamp === -1) {
            console.warn(
                "VictoryModel: gameStartTimestamp is -1 — setting to Date.now() to prevent corruption",
            );
            infiltration.gameStartTimestamp = Date.now();
        }
        // Also repair InfiltrationState in case it was corrupted during this run.
        repairGameMarketState();
        // Primary: claim rewards directly via game internals (bypasses DOM/UI timing issues).
        // Determine which faction to trade for (orchestrator or CLI flag).
        const rewardFaction = orchestratorMode
            ? orchestratorRewardFaction
            : repFaction;
        const directResult = claimRewardDirect(infiltration, rewardFaction);
        if (directResult) {
            const elapsed = infiltrationStart
                ? ((Date.now() - infiltrationStart) / 1000).toFixed(1)
                : "?";
            console.info(
                `SUCCESSFUL INFILTRATION (direct) - ${elapsed} sec: ${directResult}`,
            );
            infiltrationStart = 0;
            isInfiltrating = false;
            victoryHandled = false;
            lastStageName = "";
            // If orchestrator is waiting for the result, resolve the promise.
            if (orchestratorRewardResolve) {
                const resolve = orchestratorRewardResolve;
                orchestratorRewardResolve = null;
                orchestratorRewardFaction = "";
                resolve(true);
            }
            // In auto mode (no orchestrator), navigate back to company for next run.
            if (autoMode && !orchestratorMode) {
                selectCompany();
            }
            return;
        }
        // Fallback: DOM-based reward claiming (if webpack lookups failed).
        console.warn(
            "[infLoop] claimRewardDirect failed — falling back to DOM-based claiming",
        );
        if (orchestratorMode) {
            acceptOrchestratorReward();
        } else {
            acceptReward();
        }
        return;
    }

    isInfiltrating = true;
    // Primary: winGame() calls onSuccess() directly for instant completion.
    // Fallback: solveGame() plays the game move-by-move via stage.onKey().
    // Ensure gameStartTimestamp is valid before any game-solving attempt.
    // If this is the last level, onSuccess() triggers VictoryModel render which
    // calls decreaseMarketDemandMultiplier(gameStartTimestamp) synchronously.
    if (infiltration.gameStartTimestamp === -1) {
        infiltration.gameStartTimestamp = Date.now();
    }
    if (!winGame(infiltration)) {
        solveGame(infiltration);
    }
}

/**
 * Cancel any pending timeout.
 */
function cancelMyTimeout() {
    if (postTimeout) {
        clearTimeout(postTimeout);
        postTimeout = null;
    }
}

/**
 * Accept the infiltration reward (money or faction rep).
 */
function acceptReward() {
    if (!autoMode || orchestratorMode) return;
    if (postTimeout) return;

    cancelMyTimeout();

    if (repFaction && repFaction.length) {
        acceptReputation();
        return;
    }

    postTimeout = setTimeout(() => {
        cancelMyTimeout();
        const btn = findButton("Sell for");
        if (btn) {
            if (infiltrationStart) {
                console.info(
                    `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec: ${btn.innerText}`,
                );
                infiltrationStart = 0;
            }
            clickButton(btn);
        }
        selectCompany();
    }, 1000);
}

/**
 * Accept reputation reward for the configured faction.
 */
function acceptReputation() {
    if (!autoMode || orchestratorMode) return;
    cancelMyTimeout();

    postTimeout = setTimeout(() => {
        postTimeout = null;

        let combobox = Array.from(
            doc.querySelectorAll('[role="combobox"]'),
        ).find((x) => x.innerText.indexOf("none") >= 0);
        if (!combobox) {
            combobox = Array.from(
                doc.querySelectorAll('[role="combobox"]'),
            ).find((x) => x.innerText.indexOf(repFaction) >= 0);
        }

        if (combobox) {
            const reactKey = Object.keys(combobox).find((k) =>
                k.startsWith("__reactProps$"),
            );
            if (reactKey && combobox[reactKey].onKeyDown) {
                combobox[reactKey].onKeyDown(
                    new KeyboardEvent("keydown", { key: " " }),
                );
            }

            postTimeout = setTimeout(() => {
                const option = Array.from(
                    doc.querySelectorAll('li[role="option"]'),
                ).find((x) => x.innerText.indexOf(repFaction) >= 0);
                if (option) option.click();

                postTimeout = setTimeout(() => {
                    const btn = findButton("Trade for");
                    if (btn) {
                        clickButton(btn);
                        if (infiltrationStart) {
                            console.info(
                                `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec - ${btn.innerText}`,
                                repFaction,
                            );
                            infiltrationStart = 0;
                        }
                    }
                    selectCompany();
                }, 500);
            }, 1000);
        }
    }, 1000);
}

/**
 * Accept reward in orchestrator mode using the same proven mechanism
 * as auto mode. Called by infLoop when VictoryModel is detected.
 * Resolves orchestratorRewardResolve so infiltrate() can continue.
 */
function acceptOrchestratorReward() {
    if (!orchestratorMode) return;
    if (!orchestratorRewardResolve) {
        // No orchestrator is waiting for this reward (e.g. manual run without --auto).
        // Fall back to auto-claiming: use repFaction if set, otherwise sell for money.
        if (postTimeout) return; // Already processing a reward claim
        console.log(
            "[acceptOrchestratorReward] No orchestrator resolve \u2014 falling back to auto-claim",
        );
        if (repFaction && repFaction.length) {
            // Trade for reputation — inline to bypass acceptReputation() mode guards
            postTimeout = setTimeout(() => {
                postTimeout = null;
                let combobox = Array.from(
                    doc.querySelectorAll('[role="combobox"]'),
                ).find((x) => x.innerText.indexOf("none") >= 0);
                if (!combobox) {
                    combobox = Array.from(
                        doc.querySelectorAll('[role="combobox"]'),
                    ).find((x) => x.innerText.indexOf(repFaction) >= 0);
                }
                if (combobox) {
                    const reactKey = Object.keys(combobox).find((k) =>
                        k.startsWith("__reactProps$"),
                    );
                    if (reactKey && combobox[reactKey].onKeyDown) {
                        combobox[reactKey].onKeyDown(
                            new KeyboardEvent("keydown", { key: " " }),
                        );
                    }
                    postTimeout = setTimeout(() => {
                        const option = Array.from(
                            doc.querySelectorAll('li[role="option"]'),
                        ).find((x) => x.innerText.indexOf(repFaction) >= 0);
                        if (option) option.click();
                        postTimeout = setTimeout(() => {
                            const btn = findButton("Trade for");
                            if (btn) {
                                clickButton(btn);
                                if (infiltrationStart) {
                                    console.info(
                                        `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec - ${btn.innerText}`,
                                        repFaction,
                                    );
                                    infiltrationStart = 0;
                                }
                            }
                            selectCompany();
                        }, 500);
                    }, 1000);
                } else {
                    // Combobox not found — fall back to selling for money
                    postTimeout = setTimeout(() => {
                        cancelMyTimeout();
                        const btn = findButton("Sell for");
                        if (btn) clickButton(btn);
                        selectCompany();
                    }, 500);
                }
            }, 1000);
        } else {
            // Sell for money after a short delay for the UI to render
            postTimeout = setTimeout(() => {
                cancelMyTimeout();
                const btn = findButton("Sell for");
                if (btn) {
                    if (infiltrationStart) {
                        console.info(
                            `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec: ${btn.innerText}`,
                        );
                        infiltrationStart = 0;
                    }
                    clickButton(btn);
                }
                selectCompany();
            }, 1000);
        }
        return;
    }
    if (postTimeout) return;

    cancelMyTimeout();
    const faction = orchestratorRewardFaction;
    const resolve = orchestratorRewardResolve;

    if (faction && faction !== "none" && faction.length) {
        // Trade for reputation — same approach as acceptReputation()
        postTimeout = setTimeout(() => {
            postTimeout = null;

            let combobox = Array.from(
                doc.querySelectorAll('[role="combobox"]'),
            ).find((x) => x.innerText.indexOf("none") >= 0);
            if (!combobox) {
                combobox = Array.from(
                    doc.querySelectorAll('[role="combobox"]'),
                ).find((x) => x.innerText.indexOf(faction) >= 0);
            }

            if (combobox) {
                const reactKey = Object.keys(combobox).find((k) =>
                    k.startsWith("__reactProps$"),
                );
                if (reactKey && combobox[reactKey].onKeyDown) {
                    combobox[reactKey].onKeyDown(
                        new KeyboardEvent("keydown", { key: " " }),
                    );
                }

                postTimeout = setTimeout(() => {
                    const option = Array.from(
                        doc.querySelectorAll('li[role="option"]'),
                    ).find((x) => x.innerText.indexOf(faction) >= 0);
                    if (option) option.click();

                    postTimeout = setTimeout(() => {
                        const btn = findButton("Trade for");
                        if (btn) {
                            clickButton(btn);
                            if (infiltrationStart) {
                                console.info(
                                    `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec - ${btn.innerText}`,
                                    faction,
                                );
                                infiltrationStart = 0;
                            }
                            orchestratorRewardResolve = null;
                            orchestratorRewardFaction = "";
                            resolve(true);
                        } else {
                            // Button not found, signal failure
                            orchestratorRewardResolve = null;
                            orchestratorRewardFaction = "";
                            resolve(false);
                        }
                    }, 500);
                }, 1000);
            } else {
                // Combobox not found — fallback to selling
                postTimeout = setTimeout(() => {
                    const btn = findButton("Sell for");
                    if (btn) {
                        clickButton(btn);
                        if (infiltrationStart) {
                            console.info(
                                `SUCCESSFUL INFILTRATION (sell fallback) - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec: ${btn.innerText}`,
                            );
                            infiltrationStart = 0;
                        }
                    }
                    orchestratorRewardResolve = null;
                    orchestratorRewardFaction = "";
                    resolve(btn ? true : false);
                }, 500);
            }
        }, 1000);
    } else {
        // Sell for money
        postTimeout = setTimeout(() => {
            cancelMyTimeout();
            const btn = findButton("Sell for");
            if (btn) {
                if (infiltrationStart) {
                    console.info(
                        `SUCCESSFUL INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec: ${btn.innerText}`,
                    );
                    infiltrationStart = 0;
                }
                clickButton(btn);
            }
            orchestratorRewardResolve = null;
            orchestratorRewardFaction = "";
            resolve(btn ? true : false);
        }, 1000);
    }
}

/**
 * Navigate back to the company and start a new infiltration (auto mode only).
 * Uses Singularity API if available, with DOM fallback.
 */
function selectCompany() {
    if (!autoMode || orchestratorMode) return;
    cancelMyTimeout();

    const company = targetCompany;
    if (!company) return;

    postTimeout = setTimeout(() => {
        postTimeout = null;

        if (infiltrationStart) {
            console.info(
                `FAILED INFILTRATION - ${((Date.now() - infiltrationStart) / 1000).toFixed(1)} sec`,
            );
            infiltrationStart = 0;
        }

        const selector = 'span[aria-label="' + company + '"]';
        const companyEle = doc.querySelector(selector);
        if (companyEle) {
            companyEle.click();

            postTimeout = setTimeout(() => {
                postTimeout = null;
                const btn = findButton("Infiltrate Company");
                if (btn) clickButton(btn);
            }, 1000);
        }
    }, 1000);
}

/**
 * Wrap document event listeners so that synthetic keyboard events appear trusted.
 * Note: The fallback solvers now use sendKey() which calls stage.onKey() directly,
 * bypassing the DOM entirely. This shim is kept as a safety net for any remaining
 * pressKey() call sites outside the solvers.
 */
function wrapEventListeners() {
    if (!doc._addEventListener) {
        doc._addEventListener = doc.addEventListener;

        doc.addEventListener = function (type, callback, options) {
            if (options === undefined) options = false;
            let handler = false;

            if ("keydown" === type) {
                handler = function (...args) {
                    if (!args[0].isTrusted) {
                        const hackedEv = {};
                        for (const key in args[0]) {
                            if ("isTrusted" === key) {
                                hackedEv.isTrusted = true;
                            } else if ("function" === typeof args[0][key]) {
                                hackedEv[key] = args[0][key].bind(args[0]);
                            } else {
                                hackedEv[key] = args[0][key];
                            }
                        }
                        Object.setPrototypeOf(
                            hackedEv,
                            KeyboardEvent.prototype,
                        );
                        args[0] = hackedEv;
                    }
                    return callback.apply(callback, args);
                };
                for (const prop in callback) {
                    if ("function" === typeof callback[prop]) {
                        handler[prop] = callback[prop].bind(callback);
                    } else {
                        handler[prop] = callback[prop];
                    }
                }
            }

            if (!this.eventListeners) this.eventListeners = {};
            if (!this.eventListeners[type]) this.eventListeners[type] = [];

            this.eventListeners[type].push({
                listener: callback,
                useCapture: options,
                wrapped: handler,
            });

            return this._addEventListener(type, handler || callback, options);
        };
    }

    if (!doc._removeEventListener) {
        doc._removeEventListener = doc.removeEventListener;

        doc.removeEventListener = function (type, callback, options) {
            if (options === undefined) options = false;

            if (!this.eventListeners) this.eventListeners = {};
            if (!this.eventListeners[type]) this.eventListeners[type] = [];

            for (let i = 0; i < this.eventListeners[type].length; i++) {
                if (
                    this.eventListeners[type][i].listener === callback &&
                    this.eventListeners[type][i].useCapture === options
                ) {
                    if (this.eventListeners[type][i].wrapped) {
                        callback = this.eventListeners[type][i].wrapped;
                    }
                    this.eventListeners[type].splice(i, 1);
                    break;
                }
            }

            if (this.eventListeners[type].length === 0) {
                delete this.eventListeners[type];
            }

            return this._removeEventListener(type, callback, options);
        };
    }
}

function restoreEventListeners() {
    if (doc._addEventListener) {
        doc.addEventListener = doc._addEventListener;
        delete doc._addEventListener;
    }
    if (doc._removeEventListener) {
        doc.removeEventListener = doc._removeEventListener;
        delete doc._removeEventListener;
    }
}

// =============================================================================
// Market Demand System
// =============================================================================
const DECAY_RATE = -2e-5;
const MARKET_DEMAND_FACTOR = 1e-3;

let marketState = {
    floors: 0,
    lastTimestamp: Date.now(),
};

function getCurrentFloors() {
    return (
        marketState.floors *
        Math.exp(DECAY_RATE * (Date.now() - marketState.lastTimestamp))
    );
}

function getMarketDemandMultiplier() {
    const floors = getCurrentFloors();
    return Math.max(0, Math.min(1, 1 - MARKET_DEMAND_FACTOR * floors * floors));
}

function recordInfiltration(maxLevel) {
    // Re-sync from game's InfiltrationState when available (claimRewardDirect
    // already updated it via inlineDecreaseMarketDemand), otherwise track locally.
    const gameState = getGameInfiltrationState();
    if (
        gameState &&
        Number.isFinite(gameState.floors) &&
        Number.isFinite(gameState.lastChangeTimestamp)
    ) {
        marketState.floors = gameState.floors;
        marketState.lastTimestamp = gameState.lastChangeTimestamp;
    } else {
        marketState.floors = getCurrentFloors() + maxLevel;
        marketState.lastTimestamp = Date.now();
    }
}

function getActualReward(apiReward) {
    return apiReward * getMarketDemandMultiplier();
}

function getOptimalDelay(maxLevel) {
    const currentFloors = getCurrentFloors();
    const floorsAfterNext = currentFloors + maxLevel;
    const multiplierAfter = Math.max(
        0,
        1 - MARKET_DEMAND_FACTOR * floorsAfterNext * floorsAfterNext,
    );

    if (multiplierAfter > 0.5) return 0;

    const threshold = 0.67;
    const targetFloors = Math.sqrt((1 - threshold) / MARKET_DEMAND_FACTOR);

    if (floorsAfterNext <= targetFloors) return 0;

    const delay = Math.log(targetFloors / floorsAfterNext) / DECAY_RATE;
    return Math.max(0, delay);
}

// =============================================================================
// Orchestration
// =============================================================================
/** @param {NS} ns  */
export async function main(ns) {
    augmentationData = {};
    const args = ns.flags(argsSchema);
    const print = (msg) => {
        if (!args.quiet) ns.tprint(`\n${msg}\n`);
    };

    wnd = globalThis;
    doc = wnd["document"];

    // Repair any corrupted InfiltrationState from previous runs.
    // A bug with gameStartTimestamp=-1 can set floors to Infinity,
    // causing all future infiltration rewards to be 0.
    const infState = getGameInfiltrationState();
    if (infState) {
        repairGameMarketState();
        console.log(
            `[infiltrator] InfiltrationState: floors=${infState.floors.toFixed(2)}, ts=${infState.lastChangeTimestamp}`,
        );
    } else {
        console.warn(
            "[infiltrator] Could NOT find InfiltrationState via webpack!",
        );
    }

    // Sync local marketState from the game's InfiltrationState so the orchestrator's
    // delay/multiplier estimates match the actual game state (including prior runs).
    if (
        infState &&
        Number.isFinite(infState.floors) &&
        Number.isFinite(infState.lastChangeTimestamp)
    ) {
        marketState.floors = infState.floors;
        marketState.lastTimestamp = infState.lastChangeTimestamp;
    }

    if (args.status) {
        print(
            wnd.tmrAutoInf
                ? "Automated infiltration is active"
                : "Automated infiltration is inactive",
        );
        return;
    }

    if (args.stop) {
        if (wnd.tmrAutoInf) {
            print("Stopping automated infiltration...");
            clearInterval(wnd.tmrAutoInf);
            delete wnd.tmrAutoInf;
            ns.clearPort(30);
            ns.writePort(1, 1);
        }
        restoreEventListeners();
        setTimeout(() => {
            const btn = findButton("Cancel");
            if (btn) clickButton(btn);
        }, 1000);
        return;
    }

    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || (await instanceCount(ns)) > 1) return;
    options = runOptions;

    const boostFaction = options["boost-Faction"]
        ? args["boost-Faction"].replaceAll("_", " ")
        : "";
    const ignoreFaction =
        options["ignore-Faction"].length > 0
            ? args["ignore-Faction"].map((f) => f.replaceAll("_", " "))
            : [];
    const forceTarget = options["target"]
        ? args.target.replaceAll("_", " ")
        : "";

    verbose = options["verbose"];
    autoMode = args.auto;
    orchestratorMode = !args.auto;
    repFaction = args.faction && args.faction.length ? args.faction : "";
    targetCompany = args.company && args.company.length ? args.company : "";

    if (!options["info"] && !autoMode && !options["no-tail"]) ns.ui.openTail();

    if (!options["info"]) {
        // Always replace any existing interval (could be from old infiltration.js
        // or a previous run with stale closure). This ensures OUR infLoop runs.
        if (wnd.tmrAutoInf) {
            clearInterval(wnd.tmrAutoInf);
        }
        wrapEventListeners();
        wnd.tmrAutoInf = setInterval(infLoop, speed);
    }

    if (options["info"]) {
        infiltrationStack = [];
        await buildInfiltrationStack(
            ns,
            ignoreFaction,
            boostFaction,
            forceTarget,
        );
        if (infiltrationStack.length === 0) {
            await ns.write(output_file, "", "w");
        } else {
            await ns.write(output_file, JSON.stringify(infiltrationStack), "w");
        }
        return;
    }

    if (autoMode) {
        print(
            "Automated infiltration is enabled...\n" +
                "All infiltration tasks are completed automatically using direct model access.\n" +
                `Auto-replay: ${autoMode ? "ON" : "OFF"} | ` +
                `Reward: ${repFaction || "MONEY"}` +
                (targetCompany ? ` | Target: ${targetCompany}` : ""),
        );

        ns.writePort(30, ns.pid);

        if (targetCompany) {
            let navigated = false;
            try {
                const locations = ns.infiltration.getPossibleLocations();
                const match = locations.find(
                    (loc) =>
                        loc.name.toLowerCase() === targetCompany.toLowerCase(),
                );
                if (match) {
                    const player = ns.getPlayer();
                    if (player.city !== match.city) {
                        if (ns.singularity) {
                            ns.singularity.travelToCity(match.city);
                        }
                    }
                    if (ns.singularity) {
                        ns.singularity.goToLocation(match.name);
                        navigated = true;
                    }
                }
            } catch {
                // fall through to DOM fallback
            }

            if (!navigated) {
                postTimeout = setTimeout(() => {
                    postTimeout = null;
                    const selector = 'span[aria-label="' + targetCompany + '"]';
                    const companyEle = doc.querySelector(selector);
                    if (companyEle) companyEle.click();
                }, 500);
            }
        }

        return;
    }

    btnSaveGame = await findRetry(ns, "//button[@aria-label = 'save game']");
    if (!btnSaveGame)
        return log(
            ns,
            'ERROR: Sorry, couldn\'t find the Overview Save (💾) button. Is your "Overview" panel collapsed or modded?',
            verbose,
        );

    const bnMults = await tryGetBitNodeMultipliers(ns);
    const wks = await hasSoaAug(ns);

    log(
        ns,
        `Infiltration multipliers: ${bnMults.InfiltrationRep}× rep, ${bnMults.InfiltrationMoney}× money`,
        verbose,
    );
    log(ns, `WKS harmonizer aug: ${wks ? "yes" : "no"}`, verbose);

    player = await getPlayerInfo(ns);
    locations = await getLocations(ns, verbose);
    if (verbose) console.log(locations);

    infiltrationStack = [];

    // Signal other scripts (e.g. work-for-factions.js) that infiltration is active.
    // The --auto path writes port 30 separately; this covers the orchestrator path.
    ns.writePort(30, ns.pid);
    if (!options["getMoney"]) {
        // Load augmentation data (refreshed each iteration at end of loop)
        await updateAugmentationData(ns, player, ignoreFaction);

        // Recompute best faction+target before each infiltration using live reputation
        let totalLoops = 0;
        let goal;
        while (
            (goal = await computeNextGoal(
                ns,
                ignoreFaction,
                boostFaction,
                forceTarget,
            )) !== null
        ) {
            if (!options["no-tail"]) ns.ui.openTail();
            if (options["sleep-Between-Infiltration-Time"]) {
                ns.clearPort(30); // Release lock so faction worker can run during downtime
                await ns.sleep(options["sleep-Between-Infiltration-Time"]);
                ns.writePort(30, ns.pid); // Re-acquire lock before next infiltration
            }

            const marketMultiplier = getMarketDemandMultiplier();
            log(
                ns,
                `Market demand multiplier: ${marketMultiplier.toFixed(3)}`,
                verbose,
            );

            player = await getPlayerInfo(ns);

            log(
                ns,
                `[${totalLoops + 1}] Infiltrating ${goal.target.name} for ${goal.faction} ` +
                    `(need ${formatNumberShort(goal.repNeed, 5)} rep, ` +
                    `~${formatNumberShort(getActualReward(goal.target.reward.tradeRep), 6, 1)} rep/run, ` +
                    `unlocks ${goal.augsAtThreshold}/${goal.totalUnlockableAugs} augs at threshold)`,
            );

            // Ensure we can afford travel if target is in another city
            let city =
                player.city === goal.target.city ? false : goal.target.city;
            if (city && player.money < 2e5) {
                let cityMax = Math.min(
                    ...locations
                        .filter(
                            (location) =>
                                location.city === player.city &&
                                location.reward.sellCash > 2e5,
                        )
                        .map((location) => location.reward.sellCash),
                );
                let cityTarget = locations.filter(
                    (location) => location.reward.sellCash === cityMax,
                )[0];
                log(
                    ns,
                    `Player money is too low (${formatMoney(player.money, 6, 1)}), will Infiltrate 1x ${cityTarget.name}`,
                );
                await infiltrateForMoney(ns, player, 2e5, cityTarget, false);
                continue;
            }

            const MAX_RETRIES = 3;
            let completet = false;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                completet = await infiltrate(
                    ns,
                    city,
                    goal.target.name,
                    goal.faction,
                );
                if (completet === true) break;
                if (attempt < MAX_RETRIES) {
                    log(
                        ns,
                        `Infiltration timed out or failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`,
                    );
                    ns.clearPort(30);
                    await ns.sleep(2000);
                    ns.writePort(30, ns.pid);
                } else {
                    log(
                        ns,
                        `Infiltration failed after ${MAX_RETRIES} attempts, skipping`,
                    );
                }
            }
            if (completet === true) {
                totalLoops++;
                recordInfiltration(goal.target.maxClearanceLevel);
                const delay = getOptimalDelay(goal.target.maxClearanceLevel);
                if (delay > 0) {
                    log(
                        ns,
                        `Market demand low \u2014 waiting ${(delay / 1000).toFixed(1)}s for recovery`,
                        verbose,
                    );
                    ns.clearPort(30); // Release lock during market demand wait
                    await ns.sleep(delay);
                    ns.writePort(30, ns.pid); // Re-acquire lock
                }
            }

            await click(ns, btnSaveGame);
            await ns.sleep(10);

            // Refresh stale data so next computeNextGoal() sees current state
            player = await getPlayerInfo(ns);
            locations = await getLocations(ns, verbose);
            await updateAugmentationData(ns, player, ignoreFaction);
        }

        if (goal === null) {
            log(
                ns,
                "No Faction need Reputation, grinding money instead",
                verbose,
            );
            let maxMoney =
                options["getMoney"] === ""
                    ? 1e39
                    : parseShortNumber(options["getMoney"]);
            let stock = options["stock"];
            await infiltrateForMoney(ns, player, maxMoney, forceTarget, stock);
        }
    } else {
        let maxMoney =
            options["getMoney"] === ""
                ? 1e39
                : parseShortNumber(options["getMoney"]);
        let stock = options["stock"];
        await infiltrateForMoney(ns, player, maxMoney, forceTarget, stock);
    }
    // Clear the infiltration-active signal so other scripts can resume.
    ns.clearPort(30);
}

/**
 * It will infiltrate the location with the highest moneyScore until the player has at least maxMoney
 * @param {NS} ns
 * @param {Player} player
 * @param {number} maxMoney - The maximum amount of money you want to have.
 * @param {{name, city, moneyGain, moneyScore} | undefined} [target] - If you want to force a specific target, put it here.
 * @param {boolean} [stock] - If true, the script will take into account the value of your stocks when calculating how much money you have.
 * @returns {Promise<void>}
 */
async function infiltrateForMoney(ns, player, maxMoney, target, stock = true) {
    let faction = "none";
    let loop = 1;
    let currentMoney = player.money + (stock ? await getStocksValue(ns) : 0);
    let moneyNeed = maxMoney - currentMoney;
    if (moneyNeed < 0) return log(ns, "Max Money < current Money");

    if (!target) {
        let locationsfiltered = locations.filter(
            (location) => location.reward.actualSellCash > moneyNeed,
        );
        if (locationsfiltered.length > 0) {
            let min = Math.min(
                ...locationsfiltered.map(
                    (location) => location.reward.actualSellCash,
                ),
            );
            target = locations.filter(
                (location) => location.reward.actualSellCash === min,
            )[0];
        } else {
            let max = Math.max(
                ...locations.map((location) => location.reward.moneyScore),
            );
            target = locations.filter(
                (location) => location.reward.moneyScore === max,
            )[0];
        }
    } else if (typeof target === "string") {
        target = locations.filter((location) => location.name === target)[0];
    }

    const expectedSellCash = getActualReward(target.reward.sellCash);
    log(
        ns,
        `Infiltrate ${target.name} to get ${formatMoney(moneyNeed)}, need ${Math.ceil(moneyNeed / Math.max(1, expectedSellCash))} loops`,
        verbose,
    );

    if (options["info"]) return;

    while (currentMoney < maxMoney) {
        if (loop > options["max-loop"]) return log(ns, "maximum loops reached");

        if (!options["no-tail"]) ns.ui.openTail();
        if (options["sleep-Between-Infiltration-Time"])
            await ns.sleep(options["sleep-Between-Infiltration-Time"]);

        const marketMultiplier = getMarketDemandMultiplier();
        log(
            ns,
            `Market demand multiplier: ${marketMultiplier.toFixed(3)}`,
            verbose,
        );

        let city = player.city === target.city ? false : target.city;
        if (city && player.money < 2e5) {
            let cityMax = Math.min(
                ...locations
                    .filter(
                        (location) =>
                            location.city === player.city &&
                            location.reward.sellCash > 2e5,
                    )
                    .map((location) => location.reward.sellCash),
            );
            let cityTarget = locations.filter(
                (location) => location.reward.sellCash === cityMax,
            )[0];
            log(
                ns,
                `Player money is too low (${formatMoney(player.money, 6, 1)}), will Infiltrate 1x ${cityTarget.name}`,
            );
            await infiltrateForMoney(ns, player, 2e5, cityTarget, false);
            continue;
        }

        let completet = await infiltrate(ns, city, target.name, faction);
        if (completet === true) {
            loop++;
            recordInfiltration(target.maxClearanceLevel);
            const delay = getOptimalDelay(target.maxClearanceLevel);
            if (delay > 0) {
                log(
                    ns,
                    `Market demand low — waiting ${(delay / 1000).toFixed(1)}s for recovery`,
                    verbose,
                );
                await ns.sleep(delay);
            }
        }

        await click(ns, btnSaveGame);
        await ns.sleep(10);

        player = await getPlayerInfo(ns);
        currentMoney = player.money + (stock ? await getStocksValue(ns) : 0);
    }
}

/** It tries to infiltrate the target, and then trades it to the faction
 * @param {NS} ns
 * @param {string | false} city - The city to travel to.
 * @param {string} target - The name of the company you want to infiltrate.
 * @param {string} faction - The faction to trade with
 * @returns {Promise<boolean>} completet */
async function infiltrate(ns, city, target, faction) {
    let completet = false;

    // Clean up any stale state from a previous infiltration
    orchestratorRewardResolve = null;
    orchestratorRewardFaction = "";

    // Set up the promise BEFORE starting infiltration so infLoop can
    // resolve it as soon as VictoryModel is reached, even while we're
    // still navigating.
    orchestratorRewardFaction = faction;
    const rewardPromise = new Promise((resolve) => {
        orchestratorRewardResolve = resolve;
    });

    // Primary: use Singularity API for navigation (immune to focus/sidebar issues).
    // Fallback: DOM clicking (fragile — fails if another script has focus).
    let navigated = false;
    try {
        if (city) {
            await getNsDataThroughFile(
                ns,
                "ns.singularity.travelToCity(ns.args[0])",
                null,
                [city],
            );
            player = await getPlayerInfo(ns);
        }
        // Try Singularity goToLocation — this navigates the UI directly without
        // needing sidebar buttons to be visible.
        const goResult = await getNsDataThroughFile(
            ns,
            "ns.singularity.goToLocation(ns.args[0])",
            null,
            [target],
        );
        if (goResult) {
            navigated = true;
            // We're now on the location page — click "Infiltrate Company".
            await click(
                ns,
                await findRetry(
                    ns,
                    "//button[contains(text(), 'Infiltrate Company')]",
                ),
            );
            try {
                await click(
                    ns,
                    await findRetry(ns, "//button[contains(text(), 'Start')]"),
                );
            } catch (err) {
                /* Start button may not exist yet — infLoop handles it */
            }
        }
    } catch (err) {
        // Singularity API unavailable (no SF4) or goToLocation failed.
        // Fall through to DOM-based navigation.
    }

    // Fallback: DOM clicking (original method — needs sidebar visible).
    if (!navigated) {
        try {
            await click(
                ns,
                await findRetry(
                    ns,
                    "//div[(@role = 'button') and (contains(., 'Travel'))]",
                ),
            ); // Workaround, sometimes click on "City" will not show the right City
            await click(
                ns,
                await findRetry(
                    ns,
                    "//div[(@role = 'button') and (contains(., 'City'))]",
                ),
            );
            await click(
                ns,
                await findRetry(ns, `//span[@aria-label = '${target}']`),
            );
            await click(
                ns,
                await findRetry(
                    ns,
                    "//button[contains(text(), 'Infiltrate Company')]",
                ),
            );
            try {
                await click(
                    ns,
                    await findRetry(ns, "//button[contains(text(), 'Start')]"),
                );
            } catch (err) {}
        } catch (err) {
            log(ns, `Couldn't navigate to ${target}: ${err}`, verbose);
        }
    }

    // Wait for infLoop to detect VictoryModel and claim the reward,
    // or detect that we left the infiltration screen (cancelled/failed).
    // IMPORTANT: We use setTimeout-based delays instead of ns.sleep() to avoid
    // Bitburner's "CONCURRENCY ERROR: Concurrent calls to Netscript functions".
    // ns.sleep() returns a Netscript promise that can't be cancelled; if the
    // rewardPromise resolves first, the dangling ns.sleep lingers and collides
    // with the next ns.sleep call in the main orchestrator loop.
    const TIMEOUT_MS = 60000; // 60 second timeout (normal run ~35s)
    const pollInterval = 1000;
    let elapsed = 0;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    while (elapsed < TIMEOUT_MS) {
        const result = await Promise.race([
            rewardPromise,
            delay(pollInterval).then(() => "__poll__"),
        ]);
        if (result !== "__poll__") {
            completet = result === true;
            break;
        }
        elapsed += pollInterval;

        // Check if we're back to city view (infiltration cancelled/failed)
        if (find("//div[(@role = 'button') and (contains(., 'City'))]")) {
            log(ns, "Infiltration canceled?", verbose);
            orchestratorRewardResolve = null;
            orchestratorRewardFaction = "";
            break;
        }
    }
    if (elapsed >= TIMEOUT_MS) {
        log(ns, "WARNING: Infiltration reward timeout", verbose);
        orchestratorRewardResolve = null;
        orchestratorRewardFaction = "";
    }
    // Single ns.sleep at the end — safe because no other ns.sleep is pending.
    await ns.sleep(1000);
    return completet;
}

/**
 * @param {NS} ns
 * @param {boolean} [display=]
 * @returns {Promise<Array<{city: string, maxClearanceLevel: number, name: string, reward: {SoARep: number, tradeRep: number, sellCash: number, repScore: number, moneyScore: number, actualTradeRep: number, actualSellCash: number}}>>} Array of locations
 */
async function getLocations(ns, display = false) {
    let locations = [];
    let locationsRAW = await getNsDataThroughFile(
        ns,
        "ns.infiltration.getPossibleLocations()",
        "/Temp/infiltration-getPossibleLocations.txt",
    );
    const marketMultiplier = getMarketDemandMultiplier();
    for (const l of locationsRAW) {
        if (ignoreTarget.some((location) => location === l.name)) continue;
        let info = await getNsDataThroughFile(
            ns,
            "ns.infiltration.getInfiltration(ns.args[0])",
            "/Temp/infiltration-getInfiltration.txt",
            [l.name],
        );
        // Skip locations that are too difficult — the game immediately fails
        // if difficulty >= 3.5 (MaxDifficultyForInfiltration in source).
        // difficulty = startingSecurityLevel - (totalStats^0.9)/250 - intelligence/1600
        const MAX_DIFFICULTY = 3.5;
        if (info.difficulty >= MAX_DIFFICULTY) {
            if (display)
                log(
                    ns,
                    `Skipping ${info.location.name} (difficulty ${info.difficulty.toFixed(2)} >= ${MAX_DIFFICULTY} — stats too low)`,
                    true,
                );
            continue;
        }
        let location = {
            name: info.location.name,
            city: info.location.city,
            difficulty: info.difficulty,
            startingSecurityLevel: info.startingSecurityLevel,
            maxClearanceLevel: info.maxClearanceLevel,
            reward: info.reward,
            toString: function () {
                return (
                    `${this.name.padEnd(25)}  ${this.maxClearanceLevel.toString().padStart(2)}   ` +
                    `${formatNumberShort(this.reward.tradeRep, 4).padEnd(6)} (${formatNumberShort(this.reward.repScore, 3).padStart(5)})   ` +
                    `${formatMoney(this.reward.sellCash, 4).padEnd(7)} (${formatMoney(this.reward.moneyScore, 4).padStart(6)})`
                );
            },
        };
        location.reward.repScore =
            location.reward.tradeRep / location.maxClearanceLevel;
        location.reward.moneyScore =
            location.reward.sellCash / location.maxClearanceLevel;
        location.reward.actualTradeRep =
            location.reward.tradeRep * marketMultiplier;
        location.reward.actualSellCash =
            location.reward.sellCash * marketMultiplier;
        locations.push(location);
    }
    locations.sort((a, b) => a.reward.repScore - b.reward.repScore);
    if (display) {
        log(
            ns,
            `Locations:\n  Faction                    Lvl  Rep    (/ lvl)   Money   ( / lvl) \n  ${locations.join("\n  ")}`,
            true,
        );
    }
    return locations;
}

/** Builds a list of targets to infiltrate
 * @param {NS} ns
 * @param {Array<string>} [ignoreFaction] - This is a faction that you want to ignore.
 * @param {string} [boostFaction] - If you want to boost a specific faction, put it here.
 * @param {string} [forceTarget] - If you want to force a specific target, you can put it here.
/** Compute the best faction+target for the next infiltration using live reputation.
 * Returns { faction, target, repNeed, reputation } or null if no faction needs rep.
 * Uses already-loaded augmentationData — only re-fetches current faction rep.
 * @param {NS} ns
 * @param {string[]} ignoreFaction
 * @param {string} boostFaction
 * @param {string} forceTarget */
async function computeNextGoal(ns, ignoreFaction, boostFaction, forceTarget) {
    const unownedAugs = Object.values(augmentationData).filter(
        (aug) => !aug.owned || aug.name === strNF,
    );
    const availableAugs = unownedAugs.filter(
        (aug) => aug.getFromJoined() != null,
    );

    // Build live factionsNeedReputation from current rep.
    // For each faction, track ALL aug thresholds (not just the highest),
    // so we can prioritize factions where we're close to unlocking many augs.
    const factionsNeedReputation = {};
    const factionRepCache = {};
    for (const aug of availableAugs) {
        const faction = aug.getFromJoined();
        if (boostFaction && boostFaction !== faction) continue;
        if (!(faction in factionRepCache))
            factionRepCache[faction] = await getFactionReputation(ns, faction);
        const currentRep = factionRepCache[faction];
        const repNeed = aug.reputation - currentRep;
        if (repNeed <= 0) continue;
        if (!factionsNeedReputation[faction]) {
            factionsNeedReputation[faction] = {
                reputation: aug.reputation,
                repNeed,
                currentRep,
                // All individual aug thresholds still needing rep
                augThresholds: [
                    { repNeed, name: aug.name, desired: aug.desired },
                ],
            };
        } else {
            if (factionsNeedReputation[faction].reputation < aug.reputation) {
                factionsNeedReputation[faction].reputation = aug.reputation;
                factionsNeedReputation[faction].repNeed = repNeed;
            }
            factionsNeedReputation[faction].augThresholds.push({
                repNeed,
                name: aug.name,
                desired: aug.desired,
            });
        }
    }

    const entries = Object.entries(factionsNeedReputation);
    if (entries.length === 0) return null;

    // For each faction, compute a priority score that rewards unlocking
    // many augmentations quickly (i.e. close to thresholds).
    // Score = number of augs unlockable at the cheapest threshold / repNeed
    // to reach that threshold.  This means "3 augs for 5k rep" beats
    // "1 aug for 2k rep" (0.6 vs 0.5 augs/rep).
    for (const [, data] of entries) {
        // Sort thresholds ascending by repNeed
        data.augThresholds.sort((a, b) => a.repNeed - b.repNeed);
        // Count augs at each distinct threshold
        let best = 0;
        let bestRepNeed = Infinity;
        let cumulative = 0;
        let prevThreshold = -1;
        for (const t of data.augThresholds) {
            cumulative++;
            if (t.repNeed !== prevThreshold) {
                // At this threshold we'd unlock `cumulative` augs total
                const score = cumulative / Math.max(t.repNeed, 1);
                if (score > best) {
                    best = score;
                    bestRepNeed = t.repNeed;
                }
                prevThreshold = t.repNeed;
            }
        }
        data.augsPerRep = best;
        data.bestThresholdRepNeed = bestRepNeed;
        data.totalUnlockableAugs = data.augThresholds.length;
        // Count augs at the best threshold
        data.augsAtBestThreshold = data.augThresholds.filter(
            (t) => t.repNeed <= bestRepNeed,
        ).length;
        data.hasDesired = data.augThresholds.some((t) => t.desired);
    }

    // Sort: prioritize factions that unlock the most augs per rep spent.
    // Tie-break: desired augs > more total unlockable augs > lower repNeed.
    entries.sort(function (a, b) {
        const da = a[1],
            db = b[1];
        // Primary: augs-per-rep score (higher is better)
        if (db.augsPerRep !== da.augsPerRep)
            return db.augsPerRep - da.augsPerRep;
        // Secondary: factions with desired augs first
        if (da.hasDesired !== db.hasDesired) return da.hasDesired ? -1 : 1;
        // Tertiary: more total unlockable augs first
        if (db.totalUnlockableAugs !== da.totalUnlockableAugs)
            return db.totalUnlockableAugs - da.totalUnlockableAugs;
        // Quaternary: lower repNeed to best threshold first
        return da.bestThresholdRepNeed - db.bestThresholdRepNeed;
    });

    // Pick the first (highest-priority) faction.
    // Use bestThresholdRepNeed for target selection — this is the rep level
    // that maximizes augment unlocks per rep spent.
    const [factionName, fData] = entries[0];
    const targetRepNeed = fData.bestThresholdRepNeed;
    const optimal = selectOptimalTarget(targetRepNeed);
    const resolvedTarget =
        typeof forceTarget === "string" && forceTarget.length
            ? locations.find((loc) => loc.name === forceTarget) ||
              optimal.target
            : optimal.target;

    return {
        faction: factionName,
        target: resolvedTarget,
        repNeed: targetRepNeed,
        reputation: fData.reputation,
        loop: optimal.loop,
        augsAtThreshold: fData.augsAtBestThreshold,
        totalUnlockableAugs: fData.totalUnlockableAugs,
    };
}

/** Build the full infiltration stack for --info mode or initial planning.
 * @returns {Promise<void>} */
async function buildInfiltrationStack(
    ns,
    ignoreFaction = [],
    boostFaction = "",
    forceTarget = "",
) {
    let factionsNeedReputation = {};
    await updateAugmentationData(ns, player, ignoreFaction);

    const unownedAugs = Object.values(augmentationData).filter(
        (aug) => !aug.owned || aug.name === strNF,
    );
    let availableAugs = unownedAugs.filter(
        (aug) => aug.getFromJoined() != null,
    );

    for (const aug of availableAugs) {
        let faction = aug.getFromJoined();
        if (boostFaction && boostFaction !== faction) continue;
        let reputation = aug.reputation;
        let repNeed = reputation - (await getFactionReputation(ns, faction));
        if (repNeed < 0) continue;
        if (!factionsNeedReputation[faction]) {
            factionsNeedReputation[faction] = { reputation, repNeed };
        } else if (
            factionsNeedReputation[faction].reputation < aug.reputation
        ) {
            factionsNeedReputation[faction].reputation = reputation;
            factionsNeedReputation[faction].repNeed = repNeed;
        }
    }
    if (factionsNeedReputation.length === 0)
        return log(ns, "No Faction need Reputation", verbose);

    Object.entries(factionsNeedReputation)
        .sort(function (a, b) {
            let x = a[1].repNeed;
            let y = b[1].repNeed;
            if (
                x - y ||
                dictFactionAugs[b[0]].some((aug) => desiredAugs.includes(aug))
            )
                return 1;
            if (
                y - x ||
                dictFactionAugs[a[0]].some((aug) => desiredAugs.includes(aug))
            )
                return -1;
            return 0;
        })
        .forEach((faction) => {
            getTarget(ns, locations, faction, forceTarget);
        });
    return;
}

/** Select the optimal infiltration target for a given reputation need.
 * Pure function — no side effects, does not modify infiltrationStack.
 * Uses the same logic as getTarget: picks the smallest location whose tradeRep
 * covers repNeed in one run, or falls back to the best repScore location.
 * @param {number} repNeed - Remaining reputation needed
 * @returns {{ target: object, loop: number }} */
function selectOptimalTarget(repNeed) {
    // Can any single location cover the remaining need?
    const canCover = locations.filter((loc) => loc.reward.tradeRep > repNeed);
    if (canCover.length > 0) {
        // Pick the smallest location that still covers it (most efficient)
        let min = Math.min(...canCover.map((loc) => loc.reward.tradeRep));
        let target = canCover.find((loc) => loc.reward.tradeRep === min);
        return { target, loop: 1 };
    }
    // No single run covers it — pick the best repScore location and loop
    let max = Math.max(...locations.map((loc) => loc.reward.repScore));
    let target = locations.find((loc) => loc.reward.repScore === max);
    const tradeRep = Math.max(target.reward.actualTradeRep, 1);
    let loop = Math.ceil(repNeed / tradeRep);
    if (loop > options["max-loop"]) loop = options["max-loop"];
    return { target, loop };
}

/** Get optimized Target for faction
 * @param {NS} ns
 * @param {Array<{city: string, maxClearanceLevel: number, name: string, reward: {SoARep: number, tradeRep: number, sellCash: number, repScore: number, moneyScore: number, actualTradeRep: number, actualSellCash: number}}>} locations - Array of locations
 * @param {[string, {repNeed: number, reputation: number}]} faction - The faction you want to boost.
 * @param {string} [target] - The target to infiltrate.
 * @param {number} [loop] - The number of times to run the infiltration.
 * @returns {Promise<void>} */
function getTarget(ns, locations, faction, target = undefined, loop = 1) {
    let target2;
    let repNeed = faction[1].repNeed;
    let reputation = faction[1].reputation;
    let factionName = faction[0];

    if (!target) {
        if (
            locations.filter((location) => location.reward.tradeRep > repNeed)
                .length > 0
        ) {
            let min = Math.min(
                ...locations
                    .filter((location) => location.reward.tradeRep > repNeed)
                    .map((location) => location.reward.tradeRep),
            );
            target = locations.filter(
                (location) => location.reward.tradeRep === min,
            )[0];
        } else {
            let max = Math.max(
                ...locations.map((location) => location.reward.repScore),
            );
            target = locations.filter(
                (location) => location.reward.repScore === max,
            )[0];

            const tradeRep = Math.max(target.reward.actualTradeRep, 1);
            loop = Math.ceil(repNeed / tradeRep);
            if (loop > options["max-loop"]) loop = options["max-loop"];
        }
    }
    if (typeof target === "string") {
        target = locations.filter(
            (location) => location.name === forceTarget[0],
        )[0];
    }

    infiltrationStack.push({
        faction: factionName,
        target,
        loop,
        repNeed,
        reputation,
    });

    if (loop > 1 && loop !== options["max-loop"]) {
        loop--;
        let repNeed2 = repNeed - target.reward.tradeRep * loop;

        let min2 = Math.min(
            ...locations
                .filter((location) => location.reward.tradeRep > repNeed2)
                .map((location) => location.reward.tradeRep),
        );
        target2 = locations.filter(
            (location) => location.reward.tradeRep === min2,
        )[0];

        if (target.name === target2.name) {
            target2 = null;
            loop++;
        } else {
            infiltrationStack[infiltrationStack.length - 1].loop--;
            infiltrationStack.push({
                faction: factionName,
                target: target2,
                loop: 1,
                repNeed: repNeed2,
                reputation,
            });
        }
    }
    log(
        ns,
        `Faction ${factionName} need ${formatNumberShort(repNeed, 5)} Rep, infiltrate ${loop}x ${target.name} (${formatNumberShort(target.reward.actualTradeRep, 6, 1)}/loop)` +
            (target2
                ? ` and 1x ${target2.name} (${formatNumberShort(target2.reward.actualTradeRep, 6, 1)})/loop)`
                : ""),
        verbose,
    );

    return;
}

/** Helper to launch a script and log whether if it succeeded or failed
 * @param {NS} ns  */
function launchScriptHelper(
    ns,
    baseScriptName,
    args = [],
    convertFileName = true,
) {
    if (!options["no-tail"]) ns.ui.openTail();
    const pid = ns.run(
        convertFileName ? getFilePath(baseScriptName) : baseScriptName,
        1,
        ...args,
    );
    if (!pid)
        log(
            ns,
            `ERROR: Failed to launch ${baseScriptName} with args: [${args.join(", ")}]`,
            true,
            "error",
        );
    else
        log(
            ns,
            `INFO: Launched ${baseScriptName} (pid: ${pid}) with args: [${args.join(", ")}]`,
            true,
        );
    return pid;
}

// Ram-dodging helper, runs a command for all items in a list and returns a dictionary.
const dictCommand = (command) =>
    `Object.fromEntries(ns.args.map(o => [o, ${command}]))`;

/** Ram-dodge getting updated player info.
 * @param {NS } ns
 * @returns {Promise<Player>} */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(
        ns,
        `ns.getPlayer()`,
        "/Temp/player-info.txt",
    );
}

/** Ram-dodge getting updated Gang info.
 * @param {NS} ns
 *  @returns {Promise<GangGenInfo|boolean>} Gang information, if we're in a gang, or False */
async function getGangInfo(ns) {
    return await getNsDataThroughFile(
        ns,
        "ns.gang.inGang() ? ns.gang.getGangInformation() : false",
        "/Temp/gang-stats.txt",
    );
}

/** Ram-dodge getting Faction Reputation.
 * @param {NS} ns
 * @param {string} factionName
 * @returns {Promise<Number>} Current reputation with the specified faction */
async function getFactionReputation(ns, factionName) {
    return await getNsDataThroughFile(
        ns,
        `ns.singularity.getFactionRep(ns.args[0])`,
        "/Temp/getFactionRep.txt",
        [factionName],
    );
}

// TODO: Share instead of copy-paste from casino -->
/**
 * It clicks on an element
 * @param {NS} ns
 * @param elem - The element you want to click.
 */
async function click(ns, elem) {
    await elem[Object.keys(elem)[1]].onClick({
        isTrusted: true,
    });
    if (options["click-sleep-time"])
        await ns.sleep(options["click-sleep-time"]);
}

/**
 * It sets the text of an input field
 * @param {NS} ns
 * @param input - The input field you want to set text to.
 * @param text - The text you want to set the input to.
 */
async function setText(ns, input, text) {
    await input[Object.keys(input)[1]].onChange({
        isTrusted: true,
        target: { value: text },
    });
    if (options["click-sleep-time"])
        await ns.sleep(options["click-sleep-time"]);
}

/**
 * It takes an XPath expression and returns the first element that matches it
 * @param xpath - The XPath expression to evaluate.
 * @returns The first element that matches the xpath expression.
 */
function find(xpath) {
    return doc.evaluate(
        xpath,
        doc,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
    ).singleNodeValue;
}

/**
 * "Find an element with the given xpath, retrying up to 10 times if it's not found, and throwing an
 * error if it's not found after 10 tries."
 *
 * @param {NS} ns
 * @param xpath - The xpath of the element you're looking for
 * @param [expectFailure=false] - If true, the function will throw an error if the element is found.
 * @param [retries=null] - The number of times to retry the function.
 * @returns
 */
async function findRetry(ns, xpath, expectFailure = false, retries = null) {
    try {
        return await autoRetry(
            ns,
            () => find(xpath),
            (e) => e !== undefined,
            () =>
                expectFailure
                    ? `It's looking like the element with xpath: ${xpath} isn't present...`
                    : `Could not find the element with xpath: ${xpath}\nSomething may have re-routed the UI`,
            retries != null ? retries : expectFailure ? 3 : 10,
            1,
            2,
        );
    } catch (e) {
        if (!expectFailure) throw e;
    }
}

/** Forces the game to reload (without saving). Great for save scumming.
 * WARNING: Doesn't work if the user last ran the game with "Reload and kill all scripts"
 * @param {NS} ns */
async function reload(ns) {
    globalThis.onbeforeunload = null;
    await ns.sleep(1000);
    location.reload();
    await ns.sleep(10000);
}

void waitForProcessToComplete;
void launchScriptHelper;
void reload;

// =============================================================================
// Augmentation/Faction helpers
// =============================================================================
/** SoA aug check
 * @param {NS} ns
 * @returns {Promise<Boolean>} */
async function hasSoaAug(ns) {
    try {
        const augs = await getNsDataThroughFile(
            ns,
            "ns.singularity.getOwnedAugmentations()",
            "/Temp/player-augs-installed.txt",
        );
        return augs.some((aug) => aug.toLowerCase().includes("wks harmonizer"));
    } catch (err) {
        log(ns, `WARN: Could not get list of owned augs: ${err.toString()}`);
        log(ns, "WARN: Assuming no WKS harmonizer aug is installed.");
    }
    return false;
}

/**
 * @param {NS} ns
 * @param {Player} player
 * @param {Array<string>} ignoreFaction
 */
async function updateAugmentationData(ns, player, ignoreFaction) {
    const invitations = await getNsDataThroughFile(
        ns,
        "ns.singularity.checkFactionInvitations()",
        "/Temp/checkFactionInvitations.txt",
    );
    let joinedFactions = player.factions;
    let factionNames = joinedFactions.concat(invitations);
    factionNames.push(...factions.filter((f) => !factionNames.includes(f)));
    factionNames = factionNames.filter(
        (f) => !specialFaction.includes(f) && !ignoreFaction.includes(f),
    );

    dictFactionAugs = await getNsDataThroughFile(
        ns,
        dictCommand("ns.singularity.getAugmentationsFromFaction(o)"),
        "/Temp/getAugmentationsFromFactions.txt",
        factionNames,
    );
    let dictFactionReps = await getNsDataThroughFile(
        ns,
        dictCommand("ns.singularity.getFactionRep(o)"),
        "/Temp/getFactionReps.txt",
        factionNames,
    );
    let dictFactionFavors = await getNsDataThroughFile(
        ns,
        dictCommand("ns.singularity.getFactionFavor(o)"),
        "/Temp/getFactionFavors.txt",
        factionNames,
    );

    const gangInfo = await getGangInfo(ns);
    gangFaction = gangInfo ? gangInfo.faction : false;
    favorToDonate = await getNsDataThroughFile(
        ns,
        "ns.getFavorToDonate()",
        "/Temp/favor-to-donate.txt",
    );

    factionData = Object.fromEntries(
        factionNames.map((faction) => [
            faction,
            {
                name: faction,
                invited: invitations.includes(faction),
                joined: joinedFactions.includes(faction),
                reputation: dictFactionReps[faction] || 0,
                favor: dictFactionFavors[faction],
                donationsUnlocked:
                    dictFactionFavors[faction] >= favorToDonate &&
                    ![gangFaction, ...specialFaction].includes(faction),
                augmentations: dictFactionAugs[faction],
                unownedAugmentations: function (includeNf = false) {
                    return this.augmentations.filter(
                        (aug) =>
                            !simulatedOwnedAugmentations.includes(aug) &&
                            (aug !== strNF || includeNf),
                    );
                },
                mostExpensiveAugCost: function () {
                    return this.augmentations
                        .map((augName) => augmentationData[augName])
                        .reduce((max, aug) => Math.max(max, aug.price), 0);
                },
                totalUnownedMults: function () {
                    return this.unownedAugmentations()
                        .map((augName) => augmentationData[augName])
                        .reduce((arr, aug) => {
                            for (const stat of Object.keys(aug.stats)) {
                                arr[stat] = (arr[stat] || 1) * aug.stats[stat];
                            }
                            return arr;
                        }, new Map());
                },
            },
        ]),
    );

    const augmentationNames = [
        ...new Set(Object.values(factionData).flatMap((f) => f.augmentations)),
    ];
    const dictAugRepReqs = await getNsDataThroughFile(
        ns,
        dictCommand("ns.singularity.getAugmentationRepReq(o)"),
        "/Temp/getAugmentationRepReqs.txt",
        augmentationNames,
    );
    const dictAugPrices = await getNsDataThroughFile(
        ns,
        dictCommand("ns.singularity.getAugmentationPrice(o)"),
        "/Temp/getAugmentationPrices.txt",
        augmentationNames,
    );
    const dictAugStats = await getNsDataThroughFile(
        ns,
        dictCommand("ns.singularity.getAugmentationStats(o)"),
        "/Temp/getAugmentationStats.txt",
        augmentationNames,
    );
    const dictAugPrereqs = await getNsDataThroughFile(
        ns,
        dictCommand("ns.singularity.getAugmentationPrereq(o)"),
        "/Temp/getAugmentationPrereqs.txt",
        augmentationNames,
    );
    const ownedAugmentations = await getNsDataThroughFile(
        ns,
        `ns.singularity.getOwnedAugmentations(true)`,
        "/Temp/player-augs-purchased.txt",
    );
    let simulatedOwnedAugmentations = ownedAugmentations.filter(
        (a) => a !== strNF,
    );
    let priorityAugs = default_priority_augs;
    desiredAugs = priorityAugs.filter(
        (name) => !simulatedOwnedAugmentations.includes(name),
    );

    if ((desiredStatsFilters?.length ?? 0) === 0)
        desiredStatsFilters =
            ownedAugmentations.length > 40
                ? ["_"]
                : player.bitNodeN === 6 ||
                    player.bitNodeN === 7 ||
                    player.factions.includes("Bladeburners")
                  ? ["_"]
                  : [
                        "hacking",
                        "faction_rep",
                        "company_rep",
                        "charisma",
                        "hacknet",
                        "crime_money",
                    ];

    let getReqDonationForRep = (rep, faction) =>
        Math.ceil(
            (1e6 *
                Math.max(
                    0,
                    rep -
                        (faction.name ? faction : factionData[faction])
                            .reputation,
                )) /
                player.mults.faction_rep,
        );
    let getReqDonationForAug = (aug, faction) =>
        getReqDonationForRep(aug.reputation, faction || aug.getFromJoined());

    augmentationData = Object.fromEntries(
        augmentationNames.map((aug) => [
            aug,
            {
                name: aug,
                displayName: aug,
                owned: simulatedOwnedAugmentations.includes(aug),
                reputation: dictAugRepReqs[aug],
                price: dictAugPrices[aug],
                stats: Object.fromEntries(
                    Object.entries(dictAugStats[aug]).filter(
                        ([, v]) => v !== 1,
                    ),
                ),
                prereqs: dictAugPrereqs[aug] || [],
                desired:
                    desiredAugs.includes(aug) ||
                    Object.keys(dictAugStats[aug]).length === 0 ||
                    Object.keys(dictAugStats[aug]).some((key) =>
                        desiredStatsFilters.some((filter) =>
                            key.includes(filter),
                        ),
                    ),
                getFromAny:
                    factionNames
                        .map((f) => factionData[f])
                        .sort(
                            (a, b) =>
                                a.mostExpensiveAugCost - b.mostExpensiveAugCost,
                        )
                        .filter((f) => f.augmentations.includes(aug))[0]
                        ?.name ?? "(unknown)",
                joinedFactionsWithAug: function () {
                    return factionNames
                        .map((f) => factionData[f])
                        .filter(
                            (f) =>
                                f.joined && f.augmentations.includes(this.name),
                        );
                },
                canAfford: function () {
                    return this.joinedFactionsWithAug().some(
                        (f) => f.reputation >= this.reputation,
                    );
                },
                canAffordWithDonation: function () {
                    return this.joinedFactionsWithAug().some(
                        (f) => f.donationsUnlocked,
                    );
                },
                getFromJoined: function () {
                    return (
                        this.joinedFactionsWithAug().filter(
                            (f) => f.reputation >= this.reputation,
                        )[0] ||
                        this.joinedFactionsWithAug()
                            .filter((f) => f.donationsUnlocked)
                            .sort(
                                (a, b) =>
                                    getReqDonationForAug(this, a) -
                                    getReqDonationForAug(this, b),
                            )[0] ||
                        this.joinedFactionsWithAug()[0]
                    )?.name;
                },
            },
        ]),
    );
    let propagateDesired = (aug) => {
        if (!aug.desired || !aug.prereqs) return;
        for (const prereqName of aug.prereqs) {
            let pa = augmentationData[prereqName];
            if (!pa) {
                log(
                    ns,
                    `WARNING: Missing info about aug ${aug.name} prerequisite ${prereqName}. We likely don't have access.`,
                );
                continue;
            }
            if (pa.owned) continue;
            if (!pa.desired) {
                log(
                    ns,
                    `INFO: Promoting aug "${prereqName}" to "desired" status, because desired aug "${aug.name}" depends on it.`,
                );
                pa.desired = true;
            }
            if (
                priorityAugs.includes(aug.name) &&
                !priorityAugs.includes(prereqName)
            ) {
                log(
                    ns,
                    `INFO: Promoting aug "${prereqName}" to "priority" status, because priority aug "${aug.name}" depends on it.`,
                    true,
                );
                priorityAugs.splice(
                    priorityAugs.indexOf(aug.name),
                    0,
                    prereqName,
                );
            }
            propagateDesired(pa);
        }
    };
    Object.values(augmentationData).forEach((a) => {
        propagateDesired(a);
    });
}
